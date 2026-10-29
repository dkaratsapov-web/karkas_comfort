<?php
/*  Вход в админку и список заявок (внутренняя CRM).
 *
 *  Первый запуск: пока нет ни одного пользователя, страница предлагает
 *  завести владельца. Чтобы этого не сделал посторонний, который просто
 *  первым открыл адрес, нужен код установки — он лежит файлом на сервере
 *  и виден только тому, у кого есть доступ к серверу.
 */

declare(strict_types=1);
require __DIR__ . '/_boot.php';

session_boot();
csrf_check();

$users = users_load();

/* ---------- первый запуск: заводим владельца ---------- */
if (!$users) {
    if (!is_file(SETUP_FILE)) {
        file_put_contents(SETUP_FILE, bin2hex(random_bytes(6)) . "\n");
        @chmod(SETUP_FILE, 0640);
    }
    $code  = trim((string) file_get_contents(SETUP_FILE));
    $error = '';

    if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
        $login = post('login', 40);
        $name  = post('name', 80);
        $pass  = (string) ($_POST['password'] ?? '');
        if (!hash_equals($code, post('code', 64)))      $error = 'Код установки не совпал.';
        elseif (!preg_match('/^[a-zA-Z0-9._-]{3,40}$/', $login)) $error = 'Логин: латиница, цифры, точка, дефис, подчёркивание, от 3 символов.';
        elseif (mb_strlen($pass) < 10)                   $error = 'Пароль — от 10 символов.';
        else {
            users_save([[
                'login'   => $login,
                'name'    => $name !== '' ? $name : $login,
                'hash'    => password_hash($pass, PASSWORD_DEFAULT),
                'role'    => 'owner',
                'created' => date('c'),
                'last'    => '',
            ]]);
            @unlink(SETUP_FILE);
            $_SESSION['login'] = $login;
            session_regenerate_id(true);
            flash('Готово. Вы вошли как владелец — теперь можно добавить остальных.');
            redirect('/admin/');
        }
    }

    layout_head('Установка админки');
    echo '<div class="card card--narrow"><h1>Первый вход</h1>';
    echo '<p class="muted">Пользователей ещё нет. Заведите владельца: он сможет добавлять остальных.</p>';
    echo '<p class="muted">Код установки лежит на сервере. Покажите его командой:<br><code>cat ' . h(SETUP_FILE) . '</code></p>';
    if ($error) echo '<p class="flash flash--err">' . h($error) . '</p>';
    echo '<form method="post" class="form">' . csrf_field();
    echo '<label>Код установки<input name="code" required autocomplete="off"></label>';
    echo '<label>Логин<input name="login" required autocomplete="username" placeholder="например, dmitriy"></label>';
    echo '<label>Имя<input name="name" placeholder="Как подписывать заявки"></label>';
    echo '<label>Пароль<input type="password" name="password" required minlength="10" autocomplete="new-password"></label>';
    echo '<button class="btn" type="submit">Создать владельца</button></form></div>';
    layout_foot();
    exit;
}

/* ---------- вход ---------- */
$user = current_user();
if (!$user) {
    $error = '';
    if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
        $login = post('login', 40);
        $pass  = (string) ($_POST['password'] ?? '');
        $wait  = throttle_blocked($login);
        if ($wait > 0) {
            $error = 'Слишком много попыток. Повторите через ' . ceil($wait / 60) . ' мин.';
        } else {
            $found = user_find($login);
            if ($found && password_verify($pass, (string) $found['hash'])) {
                throttle_clear($login);
                session_regenerate_id(true);
                $_SESSION['login'] = $found['login'];
                user_touch($found['login']);
                $next = (string) ($_POST['next'] ?? '/admin/');
                redirect(str_starts_with($next, '/admin/') ? $next : '/admin/');
            }
            throttle_fail($login);
            $error = 'Логин или пароль не подошли.';
        }
    }

    layout_head('Вход');
    echo '<div class="card card--narrow"><h1>Вход в админку</h1>';
    if ($error) echo '<p class="flash flash--err">' . h($error) . '</p>';
    echo '<form method="post" class="form">' . csrf_field();
    echo '<input type="hidden" name="next" value="' . h((string) ($_GET['next'] ?? '/admin/')) . '">';
    echo '<label>Логин<input name="login" required autocomplete="username" autofocus></label>';
    echo '<label>Пароль<input type="password" name="password" required autocomplete="current-password"></label>';
    echo '<button class="btn" type="submit">Войти</button></form></div>';
    layout_foot();
    exit;
}

/* ---------- действия со заявкой ---------- */
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST' && post('action') === 'state') {
    $id     = post('id', 80);
    $status = post('status', 20);
    if ($id !== '' && isset(STATUSES[$status])) {
        lead_state_set($id, [
            'status' => $status,
            'note'   => post('note', 1000),
            'by'     => (string) $user['login'],
        ]);
        flash('Заявка обновлена.');
    }
    redirect('/admin/' . (($_GET['q'] ?? '') !== '' ? '?q=' . rawurlencode((string) $_GET['q']) : ''));
}

/* ---------- выгрузка в CSV ---------- */
$leads = leads_load();
if (($_GET['export'] ?? '') === 'csv') {
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="zayavki-' . date('Y-m-d') . '.csv"');
    $out = fopen('php://output', 'w');
    fwrite($out, "\xEF\xBB\xBF");                       // метка для Excel
    fputcsv($out, ['Дата', 'Имя', 'Телефон', 'Проект', 'Сообщение', 'Страница', 'Статус', 'Заметка'], ';');
    foreach ($leads as $row) {
        fputcsv($out, [
            $row['at'] ?? '', $row['name'] ?? '', $row['phone'] ?? '', $row['project'] ?? '',
            $row['message'] ?? '', $row['page'] ?? '', STATUSES[$row['status']] ?? '', $row['note'] ?? '',
        ], ';');
    }
    exit;
}

/* ---------- отбор ---------- */
$q      = mb_strtolower(trim((string) ($_GET['q'] ?? '')));
$filter = (string) ($_GET['status'] ?? '');
$counts = ['all' => count($leads)];
foreach (array_keys(STATUSES) as $key) $counts[$key] = 0;
foreach ($leads as $row) $counts[$row['status']] = ($counts[$row['status']] ?? 0) + 1;

$shown = array_filter($leads, static function (array $row) use ($q, $filter) {
    if ($filter !== '' && ($row['status'] ?? '') !== $filter) return false;
    if ($q === '') return true;
    $hay = mb_strtolower(implode(' ', [$row['name'] ?? '', $row['phone'] ?? '', $row['project'] ?? '', $row['message'] ?? '', $row['note'] ?? '']));
    return str_contains($hay, $q);
});

layout_head('Заявки', $user, 'index.php');
flash_show();

echo '<div class="head"><h1>Заявки <span class="count">' . count($leads) . '</span></h1>';
echo '<form class="search" method="get"><input name="q" value="' . h((string) ($_GET['q'] ?? '')) . '" placeholder="Имя, телефон, проект" aria-label="Поиск по заявкам">';
if ($filter !== '') echo '<input type="hidden" name="status" value="' . h($filter) . '">';
echo '<button class="btn btn--sm" type="submit">Найти</button>';
echo '<a class="btn btn--ghost btn--sm" href="/admin/?export=csv">Выгрузить CSV</a></form></div>';

echo '<div class="chips">';
$chip = static function (string $key, string $label, int $n) use ($filter, $q) {
    $href = '/admin/?status=' . rawurlencode($key) . ($q !== '' ? '&q=' . rawurlencode($q) : '');
    $is   = ($filter === $key) ? ' is-on' : '';
    echo '<a class="chip' . $is . '" href="' . h($key === '' ? '/admin/' : $href) . '">' . h($label) . ' <b>' . $n . '</b></a>';
};
$chip('', 'Все', $counts['all']);
foreach (STATUSES as $key => $label) $chip($key, $label, $counts[$key]);
echo '</div>';

if (!$shown) {
    echo '<div class="card"><p class="muted">Заявок пока нет. Как только с сайта придёт первая, она появится здесь.</p></div>';
} else {
    echo '<div class="leads">';
    foreach ($shown as $row) {
        $when  = $row['at'] ?? '';
        $stamp = strtotime((string) $when);
        echo '<article class="lead lead--' . h($row['status']) . '">';
        echo '<div class="lead__head"><div><p class="lead__name">' . h($row['name'] ?: 'Без имени') . '</p>';
        echo '<p class="lead__phone"><a href="tel:' . h(preg_replace('/[^\d+]/', '', (string) $row['phone'])) . '">' . h($row['phone']) . '</a></p></div>';
        echo '<p class="lead__when">' . h($stamp ? date('d.m.Y H:i', $stamp) : $when) . '</p></div>';

        $meta = [];
        if (($row['project'] ?? '') !== '') $meta[] = 'Проект: ' . $row['project'];
        if (($row['page'] ?? '') !== '')    $meta[] = 'Страница: ' . $row['page'];
        if ($meta) echo '<p class="lead__meta">' . h(implode(' · ', $meta)) . '</p>';
        if (($row['message'] ?? '') !== '') echo '<p class="lead__text">' . h($row['message']) . '</p>';

        echo '<form class="lead__form" method="post">' . csrf_field();
        echo '<input type="hidden" name="action" value="state"><input type="hidden" name="id" value="' . h($row['id']) . '">';
        echo '<select name="status" aria-label="Статус заявки">';
        foreach (STATUSES as $key => $label) {
            echo '<option value="' . h($key) . '"' . ($row['status'] === $key ? ' selected' : '') . '>' . h($label) . '</option>';
        }
        echo '</select>';
        echo '<input name="note" value="' . h($row['note']) . '" placeholder="Заметка: о чём договорились">';
        echo '<button class="btn btn--sm" type="submit">Сохранить</button>';
        if (($row['by'] ?? '') !== '') echo '<span class="lead__by">' . h($row['by']) . '</span>';
        echo '</form></article>';
    }
    echo '</div>';
}

layout_foot();
