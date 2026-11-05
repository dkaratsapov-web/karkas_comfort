<?php
/*  Первый запуск: заводим владельца.
 *
 *  Чтобы кабинет не занял посторонний, который просто первым открыл
 *  адрес, нужен код установки — он лежит файлом на сервере и виден
 *  только тому, у кого есть к серверу доступ.
 *
 *  Подключается из index.php, когда ни одной учётной записи нет.
 */

declare(strict_types=1);

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

    layout_head('Установка админки', null, '', 'auth');
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
