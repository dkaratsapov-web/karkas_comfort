<?php
/*  Страница входа.
 *
 *  Подключается из index.php, когда посетитель ещё не вошёл.
 *  Подбор пароля ограничен: пять неудач на пару «логин и адрес»
 *  запирают вход на четверть часа.
 */

declare(strict_types=1);

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

    layout_head('Вход', null, '', 'auth');
    echo '<div class="card card--narrow"><h1>Вход в админку</h1>';
    if ($error) echo '<p class="flash flash--err">' . h($error) . '</p>';
    echo '<form method="post" class="form">' . csrf_field();
    echo '<input type="hidden" name="next" value="' . h((string) ($_GET['next'] ?? '/admin/')) . '">';
    echo '<label>Логин<input name="login" required autocomplete="username" autofocus></label>';
    echo '<label>Пароль<input type="password" name="password" required autocomplete="current-password"></label>';
    echo '<button class="btn" type="submit">Войти</button></form></div>';
layout_foot();
