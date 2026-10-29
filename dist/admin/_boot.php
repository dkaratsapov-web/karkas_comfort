<?php
/*  Общая часть админки: доступ, хранилища, оболочка страницы.
 *
 *  Админка живёт на боевом сервере рядом с сайтом (/admin/) и работает
 *  с четырьмя файлами в соседней папке api/. Выгрузка сайта их не трогает
 *  и не удаляет — это состояние сервера, а не содержимое репозитория:
 *
 *    admin-users.json     кто может входить: логин, имя, хеш пароля, роль
 *    settings.json        куда уходят заявки (почта, Telegram, CRM)
 *    leads.jsonl          сами заявки, по одной в строке
 *    leads-state.json     что с заявкой сделали: статус и заметка
 *
 *  Пароли хранятся только хешем (password_hash, bcrypt). В репозиторий
 *  ни пароли, ни токены не попадают.
 */

declare(strict_types=1);

const API_DIR       = __DIR__ . '/../api';
const USERS_FILE    = API_DIR . '/admin-users.json';
const SETTINGS_FILE = API_DIR . '/settings.json';
const LEADS_FILE    = API_DIR . '/leads.jsonl';
const LEADS_CSV     = API_DIR . '/leads.csv';
const STATE_FILE    = API_DIR . '/leads-state.json';
const THROTTLE_FILE = API_DIR . '/admin-throttle.json';
const SETUP_FILE    = API_DIR . '/admin-setup.code';

const STATUSES = [
    'new'   => 'Новая',
    'work'  => 'В работе',
    'meet'  => 'Встреча',
    'deal'  => 'Договор',
    'lost'  => 'Отказ',
];

/* ---------- мелочи ---------- */

function h($value): string
{
    return htmlspecialchars((string) $value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function json_read(string $file, array $fallback = []): array
{
    if (!is_file($file)) return $fallback;
    $data = json_decode((string) file_get_contents($file), true);
    return is_array($data) ? $data : $fallback;
}

/* Запись через временный файл: если сервер упадёт на полпути, прежний
   файл останется целым, а не обрежется до половины. */
function json_write(string $file, array $data): bool
{
    $tmp = $file . '.tmp';
    $ok  = file_put_contents($tmp, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), LOCK_EX) !== false;
    if (!$ok) return false;
    @chmod($tmp, 0640);
    return rename($tmp, $file);
}

function post(string $key, int $max = 500): string
{
    $value = $_POST[$key] ?? '';
    $value = is_scalar($value) ? (string) $value : '';
    return mb_substr(trim(str_replace(["\r", "\n", "\0"], ' ', $value)), 0, $max);
}

function redirect(string $to): void
{
    header('Location: ' . $to);
    exit;
}

/* ---------- сессия ---------- */

function session_boot(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) return;
    $https = (($_SERVER['HTTPS'] ?? '') !== '' && ($_SERVER['HTTPS'] ?? '') !== 'off')
        || ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https';
    session_name('kkadmin');
    session_set_cookie_params([
        'lifetime' => 0,
        'path'     => '/admin/',
        'httponly' => true,
        'secure'   => $https,
        'samesite' => 'Strict',
    ]);
    session_start();
}

function csrf_token(): string
{
    if (empty($_SESSION['csrf'])) $_SESSION['csrf'] = bin2hex(random_bytes(16));
    return $_SESSION['csrf'];
}

function csrf_field(): string
{
    return '<input type="hidden" name="csrf" value="' . h(csrf_token()) . '">';
}

/* Проверка одноразовым сравнением: обычное === подсказывает длину токена
   по времени ответа. */
function csrf_check(): void
{
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') return;
    if (!hash_equals(csrf_token(), (string) ($_POST['csrf'] ?? ''))) {
        http_response_code(400);
        exit('Сессия устарела. Обновите страницу и повторите.');
    }
}

/* ---------- пользователи ---------- */

function users_load(): array
{
    $users = json_read(USERS_FILE);
    return isset($users['users']) && is_array($users['users']) ? $users['users'] : [];
}

function users_save(array $users): bool
{
    return json_write(USERS_FILE, ['users' => array_values($users)]);
}

function user_find(string $login): ?array
{
    foreach (users_load() as $user) {
        if (mb_strtolower($user['login'] ?? '') === mb_strtolower($login)) return $user;
    }
    return null;
}

function current_user(): ?array
{
    session_boot();
    $login = $_SESSION['login'] ?? '';
    return $login === '' ? null : user_find((string) $login);
}

function require_login(): array
{
    $user = current_user();
    if (!$user) redirect('/admin/?next=' . rawurlencode($_SERVER['REQUEST_URI'] ?? '/admin/'));
    return $user;
}

function require_owner(): array
{
    $user = require_login();
    if (($user['role'] ?? '') !== 'owner') {
        http_response_code(403);
        exit('Этот раздел доступен только владельцу.');
    }
    return $user;
}

function user_touch(string $login): void
{
    $users = users_load();
    foreach ($users as &$user) {
        if (mb_strtolower($user['login']) === mb_strtolower($login)) $user['last'] = date('c');
    }
    unset($user);
    users_save($users);
}

/* ---------- защита от перебора пароля ----------
   Пять неудачных попыток на связку «логин + адрес» запирают вход
   на четверть часа. Счётчик живёт в файле: отдельной базы у сайта нет. */

function throttle_key(string $login): string
{
    return md5(mb_strtolower($login) . '|' . ($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0'));
}

function throttle_blocked(string $login): int
{
    $all = json_read(THROTTLE_FILE);
    $row = $all[throttle_key($login)] ?? null;
    if (!$row) return 0;
    if (($row['until'] ?? 0) > time()) return (int) $row['until'] - time();
    return 0;
}

function throttle_fail(string $login): void
{
    $all = json_read(THROTTLE_FILE);
    $key = throttle_key($login);
    $row = $all[$key] ?? ['hits' => 0, 'until' => 0];
    $row['hits'] = (int) $row['hits'] + 1;
    if ($row['hits'] >= 5) { $row['until'] = time() + 900; $row['hits'] = 0; }
    $all[$key] = $row;
    /* старые записи не копим */
    foreach ($all as $k => $v) {
        if (($v['until'] ?? 0) < time() - 86400 && ($v['hits'] ?? 0) === 0) unset($all[$k]);
    }
    json_write(THROTTLE_FILE, $all);
}

function throttle_clear(string $login): void
{
    $all = json_read(THROTTLE_FILE);
    unset($all[throttle_key($login)]);
    json_write(THROTTLE_FILE, $all);
}

/* ---------- настройки приёма заявок ----------
   config.php задаёт значения по умолчанию при установке, settings.json —
   то, что потом правят в админке. Второе перекрывает первое. */

function config_base(): array
{
    $file = API_DIR . '/config.php';
    return is_file($file) ? (array) require $file : [];
}

function settings_all(): array
{
    return array_merge(config_base(), json_read(SETTINGS_FILE));
}

function settings_save(array $values): bool
{
    return json_write(SETTINGS_FILE, array_merge(json_read(SETTINGS_FILE), $values));
}

/* ---------- заявки ---------- */

function leads_state(): array
{
    return json_read(STATE_FILE);
}

function lead_state_set(string $id, array $patch): bool
{
    $all = leads_state();
    $all[$id] = array_merge($all[$id] ?? [], $patch, ['updated' => date('c')]);
    return json_write(STATE_FILE, $all);
}

/* Заявки лежат в leads.jsonl по одной в строке. Старые, пришедшие до
   появления админки, читаются из leads.csv — чтобы история не потерялась. */
function leads_load(): array
{
    $out = [];

    if (is_file(LEADS_FILE)) {
        foreach (file(LEADS_FILE, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [] as $line) {
            $row = json_decode($line, true);
            if (is_array($row) && !empty($row['id'])) $out[$row['id']] = $row;
        }
    }

    if (is_file(LEADS_CSV)) {
        $fh = fopen(LEADS_CSV, 'r');
        while ($fh && ($cells = fgetcsv($fh, 0, ';')) !== false) {
            if (count($cells) < 3) continue;
            if (!preg_match('/^\d{4}-\d{2}-\d{2}/', (string) $cells[0])) continue;   // строка заголовка
            $id = 'csv-' . md5(implode('|', $cells));
            if (isset($out[$id])) continue;
            $out[$id] = [
                'id'      => $id,
                'at'      => $cells[0],
                'name'    => $cells[1] ?? '',
                'phone'   => $cells[2] ?? '',
                'project' => $cells[3] ?? '',
                'message' => $cells[4] ?? '',
                'page'    => $cells[5] ?? '',
                'source'  => 'csv',
            ];
        }
        if ($fh) fclose($fh);
    }

    $state = leads_state();
    foreach ($out as $id => $row) {
        $out[$id]['status'] = $state[$id]['status'] ?? 'new';
        $out[$id]['note']   = $state[$id]['note']   ?? '';
        $out[$id]['by']     = $state[$id]['by']     ?? '';
    }

    uasort($out, static fn($a, $b) => strcmp((string) ($b['at'] ?? ''), (string) ($a['at'] ?? '')));
    return $out;
}

/* ---------- оболочка страницы ---------- */

function layout_head(string $title, ?array $user = null, string $active = ''): void
{
    $nav = [
        'index.php'    => 'Заявки',
        'content.php'  => 'Содержимое сайта',
        'settings.php' => 'Настройки заявок',
        'users.php'    => 'Пользователи',
    ];
    echo '<!doctype html><html lang="ru"><head><meta charset="utf-8">';
    echo '<meta name="viewport" content="width=device-width, initial-scale=1">';
    echo '<meta name="robots" content="noindex, nofollow">';
    echo '<title>' . h($title) . ' · Каркас Комфорт</title>';
    echo '<link rel="icon" href="/assets/img/favicon.svg">';
    echo '<link rel="stylesheet" href="/admin/admin.css?v=3">';
    echo '</head><body>';
    if ($user) {
        echo '<header class="top"><a class="top__logo" href="/admin/">Каркас Комфорт<span>админка</span></a><nav class="top__nav">';
        foreach ($nav as $file => $label) {
            if ($file === 'users.php' && ($user['role'] ?? '') !== 'owner') continue;
            $is = $file === $active ? ' class="is-on"' : '';
            echo '<a href="/admin/' . h($file) . '"' . $is . '>' . h($label) . '</a>';
        }
        echo '</nav><div class="top__user">' . h($user['name'] ?: $user['login'])
            . ' <a href="/admin/logout.php">выйти</a></div></header>';
    }
    echo '<main class="wrap">';
}

function layout_foot(): void
{
    echo '</main></body></html>';
}

function flash(string $text, string $kind = 'ok'): void
{
    session_boot();
    $_SESSION['flash'] = ['text' => $text, 'kind' => $kind];
}

function flash_show(): void
{
    session_boot();
    if (empty($_SESSION['flash'])) return;
    $flash = $_SESSION['flash'];
    unset($_SESSION['flash']);
    echo '<p class="flash flash--' . h($flash['kind']) . '">' . h($flash['text']) . '</p>';
}
