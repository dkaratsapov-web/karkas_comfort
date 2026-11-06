<?php
/*  Бот MAX: приём событий.
 *
 *  Сюда MAX шлёт всё, что происходит с ботом: его добавили в чат,
 *  написали сообщение, нажали кнопку под заявкой. Адрес этой страницы
 *  задаётся один раз из админки кнопкой «Подключить бота».
 *
 *  Отвечать нужно за 30 секунд и кодом 200: иначе MAX считает доставку
 *  неудачной, повторяет её, а через 8 часов отписывает бота совсем.
 *  Поэтому отвечаем сразу, а разбираемся потом.
 *
 *  Состояние живёт рядом, в api/: max-chats.json (где бот),
 *  leads-state.json (что с заявкой), settings.json (токен и получатель).
 */

declare(strict_types=1);

ini_set('log_errors', '1');
ini_set('display_errors', '0');
ini_set('error_log', __DIR__ . '/admin-error.log');

require __DIR__ . '/max.php';
require __DIR__ . '/max-card.php';

const CHATS_FILE  = __DIR__ . '/max-chats.json';
const STATE_FILE  = __DIR__ . '/leads-state.json';
const LEADS_FILE  = __DIR__ . '/leads.jsonl';
const CONF_FILE   = __DIR__ . '/settings.json';
const BOT_LOG     = __DIR__ . '/max-bot.log';

/* ---------- хранилища ---------- */

function jload(string $file, array $fallback = []): array
{
    if (!is_file($file)) return $fallback;
    $data = json_decode((string) file_get_contents($file), true);
    return is_array($data) ? $data : $fallback;
}

function jsave(string $file, array $data): bool
{
    $tmp = $file . '.tmp';
    $ok  = file_put_contents($tmp, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), LOCK_EX) !== false;
    if (!$ok) return false;
    @chmod($tmp, 0660);
    return rename($tmp, $file);
}

/* Короткий дневник: без него разбираться, почему бот молчит,
   приходится вслепую. Храним последние 200 записей. */
function blog(string $text): void
{
    $line = date('c') . ' ' . $text;
    @file_put_contents(BOT_LOG, $line . "\n", FILE_APPEND | LOCK_EX);
    if (@filesize(BOT_LOG) > 200000) {
        $keep = array_slice(file(BOT_LOG) ?: [], -200);
        @file_put_contents(BOT_LOG, implode('', $keep), LOCK_EX);
    }
}

function settings(): array
{
    $conf = is_file(__DIR__ . '/config.php') ? (array) require __DIR__ . '/config.php' : [];
    return array_merge($conf, jload(CONF_FILE));
}

/* ---------- заявки ---------- */

function lead_find(string $id): ?array
{
    if (!is_file(LEADS_FILE)) return null;
    foreach (array_reverse(file(LEADS_FILE, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: []) as $line) {
        $row = json_decode($line, true);
        if (is_array($row) && ($row['id'] ?? '') === $id) return $row;
    }
    return null;
}

function leads_last(int $count = 5, ?string $status = null): array
{
    if (!is_file(LEADS_FILE)) return [];
    $state = jload(STATE_FILE);
    $out   = [];
    foreach (array_reverse(file(LEADS_FILE, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: []) as $line) {
        $row = json_decode($line, true);
        if (!is_array($row) || empty($row['id'])) continue;
        $row['status'] = $state[$row['id']]['status'] ?? 'new';
        if ($status !== null && $row['status'] !== $status) continue;
        $out[] = $row;
        if (count($out) >= $count) break;
    }
    return $out;
}

function lead_state_set(string $id, array $patch): void
{
    $all = jload(STATE_FILE);
    $all[$id] = array_merge($all[$id] ?? [], $patch, ['updated' => date('c')]);
    jsave(STATE_FILE, $all);
}

/* ---------- ответ MAX: сразу и коротко ---------- */

function done(int $code = 200): void
{
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo '{"ok":true}';
    if (function_exists('fastcgi_finish_request')) fastcgi_finish_request();
}

/* ---------- проверка запроса ---------- */

$conf   = settings();
$token  = (string) ($conf['max_token'] ?? '');
$secret = (string) ($conf['max_secret'] ?? '');
$domain = (string) ($conf['domain'] ?? 'xn--80aa2abbmnbmggrx.xn--p1ai');

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    http_response_code(405);
    exit('Только POST');
}

/* Секрет MAX присылает в заголовке. Сравниваем в постоянном времени:
   обычное сравнение по времени ответа подсказывает длину совпадения. */
$given = (string) ($_SERVER['HTTP_X_MAX_BOT_API_SECRET'] ?? '');
if ($secret !== '' && !hash_equals($secret, $given)) {
    blog('чужой запрос: секрет не совпал');
    http_response_code(403);
    exit('Нет доступа');
}

$raw    = file_get_contents('php://input') ?: '';
$update = json_decode($raw, true);
if (!is_array($update)) {
    blog('не разобрал тело события');
    done();
    exit;
}

done();   /* дальше MAX уже не ждёт */

$type = (string) ($update['update_type'] ?? '');

/* ---------- где живёт бот ---------- */

function chat_remember(int|string $chatId, string $title = '', string $kind = 'chat'): void
{
    $all = jload(CHATS_FILE);
    $key = (string) $chatId;
    $all[$key] = array_merge($all[$key] ?? [], [
        'chat_id' => $key,
        'title'   => $title !== '' ? $title : ($all[$key]['title'] ?? ''),
        'kind'    => $kind,
        'seen'    => date('c'),
    ]);
    jsave(CHATS_FILE, $all);
}

function chat_forget(int|string $chatId): void
{
    $all = jload(CHATS_FILE);
    unset($all[(string) $chatId]);
    jsave(CHATS_FILE, $all);
}

/** Первый чат, куда добавили бота, сразу становится получателем
 *  заявок: иначе владельцу пришлось бы искать и вписывать номер чата
 *  руками, а это ровно то, чего мы избегаем. */
function target_set_if_empty(string $chatId): bool
{
    $now = jload(CONF_FILE);
    if (!empty($now['max_chat_id']) || !empty($now['max_user_id'])) return false;
    $now['max_chat_id'] = $chatId;
    jsave(CONF_FILE, $now);
    return true;
}

/* ---------- разбор события ---------- */

switch ($type) {

    case 'bot_added': {
        $chatId = (string) ($update['chat_id'] ?? '');
        /* Событие названия чата не содержит — спрашиваем его у MAX,
           иначе в админке чат виден одним номером. */
        $about = max_chat($token, $chatId);
        chat_remember(
            $chatId,
            $about['ok'] ? trim((string) ($about['data']['title'] ?? '')) : '',
            $about['ok'] && ($about['data']['type'] ?? '') !== ''
                ? (string) $about['data']['type']
                : (!empty($update['is_channel']) ? 'channel' : 'chat')
        );
        $first = target_set_if_empty($chatId);
        blog("бот добавлен в чат $chatId" . ($first ? ', он выбран получателем заявок' : ''));
        max_send($token, ['chat_id' => $chatId], $first
            ? "Готово: заявки с сайта будут приходить сюда.\n\nПод каждой заявкой будут кнопки: взять в работу, встреча, договор, отказ. Статус сразу попадёт в карточку клиента на сайте."
            : "Бот на месте. Чтобы заявки приходили в этот чат, выберите его получателем в админке сайта: Настройки заявок → MAX.");
        break;
    }

    case 'bot_removed': {
        $chatId = (string) ($update['chat_id'] ?? '');
        chat_forget($chatId);
        blog("бот удалён из чата $chatId");
        break;
    }

    case 'chat_title_changed': {
        chat_remember((string) ($update['chat_id'] ?? ''), (string) ($update['title'] ?? ''));
        break;
    }

    case 'bot_started': {
        $chatId = (string) ($update['chat_id'] ?? '');
        $name   = (string) ($update['user']['first_name'] ?? $update['user']['name'] ?? '');
        chat_remember($chatId, $name, 'dialog');
        max_send($token, ['chat_id' => $chatId],
            "Здравствуйте" . ($name !== '' ? ", $name" : '') . "! Это бот компании «Каркас Комфорт», каркасные дома в Твери и области.\n\n"
            . "Напишите, что вас интересует: проект, цена, сроки, технология. Если нужен расчёт — оставьте номер телефона, перезвоним.");
        break;
    }

    case 'message_callback': {
        $cbId    = (string) ($update['callback']['callback_id'] ?? '');
        $payload = (string) ($update['callback']['payload'] ?? '');
        $who     = trim((string) ($update['callback']['user']['first_name'] ?? '') . ' ' . (string) ($update['callback']['user']['last_name'] ?? ''));
        if ($who === '') $who = (string) ($update['callback']['user']['username'] ?? 'сотрудник');

        if (!str_starts_with($payload, 'st:')) { blog("нажата кнопка без смысла: $payload"); break; }
        [, $status, $leadId] = array_pad(explode(':', $payload, 3), 3, '');
        if (!isset(MAX_STATUSES[$status]) || $leadId === '') { blog("непонятный статус: $payload"); break; }

        $lead = lead_find($leadId);
        if (!$lead) {
            max_answer($token, $cbId, "Заявка не найдена — возможно, её уже удалили.");
            blog("заявка $leadId не найдена");
            break;
        }

        lead_state_set($leadId, ['status' => $status, 'by' => $who, 'via' => 'max']);
        $text = max_lead_card($lead, $status, $who);
        max_answer($token, $cbId, $text, max_lead_buttons($lead, $status, $domain));
        blog("заявка $leadId: статус «" . MAX_STATUSES[$status] . "» поставил $who");
        break;
    }

    case 'message_created': {
        $msg    = $update['message'] ?? [];
        $text   = trim((string) ($msg['body']['text'] ?? ''));
        $chatId = (string) ($msg['recipient']['chat_id'] ?? '');
        $kind   = (string) ($msg['recipient']['chat_type'] ?? 'dialog');
        if ($chatId === '' || $text === '') break;
        chat_remember($chatId, '', $kind === 'dialog' ? 'dialog' : $kind);

        $cmd = mb_strtolower(ltrim($text, '/'));

        /* В общем чате бот молчит, пока к нему не обратились командой:
           иначе он влезал бы в каждую рабочую переписку. */
        if ($kind !== 'dialog' && !str_starts_with($text, '/')) break;

        if (in_array($cmd, ['start', 'начать', 'помощь', 'help'], true)) {
            max_send($token, ['chat_id' => $chatId],
                "Что умеет бот:\n"
                . "/zayavki — последние пять заявок\n"
                . "/novye — только новые\n"
                . "/chat — идентификатор этого чата\n\n"
                . "Заявки с сайта приходят сюда сами, с кнопками статусов.");
            break;
        }

        if (in_array($cmd, ['chat', 'chatid', 'чат'], true)) {
            max_send($token, ['chat_id' => $chatId], "Идентификатор этого чата: $chatId\nВпишите его в админке, если заявки должны приходить именно сюда.");
            break;
        }

        if (in_array($cmd, ['zayavki', 'заявки', 'novye', 'новые'], true)) {
            $onlyNew = in_array($cmd, ['novye', 'новые'], true);
            $leads   = leads_last(5, $onlyNew ? 'new' : null);
            if (!$leads) {
                max_send($token, ['chat_id' => $chatId], $onlyNew ? 'Новых заявок нет.' : 'Заявок пока нет.');
                break;
            }
            foreach ($leads as $lead) {
                max_send($token, ['chat_id' => $chatId],
                    max_lead_card($lead, (string) $lead['status']),
                    max_lead_buttons($lead, (string) $lead['status'], $domain));
            }
            break;
        }

        /* Остальное — вопрос человека. Пока бот не консультирует,
           поэтому честно говорим это и зовём к телефону, а не молчим. */
        if ($kind === 'dialog') {
            max_send($token, ['chat_id' => $chatId],
                "Записал ваш вопрос, скоро ответит специалист.\n\n"
                . "Если удобнее голосом — позвоните: 8 (920) 171-69-69. Проекты и цены: https://каркаскомфорт.рф/proekty/");
            blog("вопрос из диалога $chatId: " . mb_substr($text, 0, 120));
        }
        break;
    }

    default:
        blog("событие без обработчика: $type");
}
