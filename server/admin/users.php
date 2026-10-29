<?php
/*  Пользователи админки: у каждого свой логин и пароль.
 *  Добавлять, менять роль и сбрасывать пароли может владелец;
 *  свой собственный пароль меняет каждый сам (внизу страницы).
 */

declare(strict_types=1);
require __DIR__ . '/_boot.php';

session_boot();
csrf_check();
$me = require_login();
$isOwner = ($me['role'] ?? '') === 'owner';

$error = '';
$action = post('action', 30);

if ($action === 'self') {
    /* свой пароль — без прав владельца */
    $old = (string) ($_POST['old'] ?? '');
    $new = (string) ($_POST['new'] ?? '');
    if (!password_verify($old, (string) $me['hash'])) $error = 'Текущий пароль не подошёл.';
    elseif (mb_strlen($new) < 10)                      $error = 'Новый пароль — от 10 символов.';
    else {
        $users = users_load();
        foreach ($users as &$u) {
            if ($u['login'] === $me['login']) $u['hash'] = password_hash($new, PASSWORD_DEFAULT);
        }
        unset($u);
        users_save($users);
        flash('Пароль изменён.');
        redirect('/admin/users.php');
    }
} elseif ($action !== '' && $isOwner) {
    $users = users_load();

    if ($action === 'add') {
        $login = post('login', 40);
        $name  = post('name', 80);
        $pass  = (string) ($_POST['password'] ?? '');
        $role  = post('role', 10) === 'owner' ? 'owner' : 'editor';
        if (!preg_match('/^[a-zA-Z0-9._-]{3,40}$/', $login)) $error = 'Логин: латиница, цифры, точка, дефис, подчёркивание, от 3 символов.';
        elseif (user_find($login))                           $error = 'Такой логин уже есть.';
        elseif (mb_strlen($pass) < 10)                       $error = 'Пароль — от 10 символов.';
        else {
            $users[] = [
                'login'   => $login,
                'name'    => $name !== '' ? $name : $login,
                'hash'    => password_hash($pass, PASSWORD_DEFAULT),
                'role'    => $role,
                'created' => date('c'),
                'last'    => '',
            ];
            users_save($users);
            flash('Пользователь ' . $login . ' добавлен.');
            redirect('/admin/users.php');
        }
    }

    if ($action === 'reset') {
        $login = post('login', 40);
        $pass  = (string) ($_POST['password'] ?? '');
        if (mb_strlen($pass) < 10) $error = 'Пароль — от 10 символов.';
        else {
            foreach ($users as &$u) {
                if ($u['login'] === $login) $u['hash'] = password_hash($pass, PASSWORD_DEFAULT);
            }
            unset($u);
            users_save($users);
            flash('Пароль для ' . $login . ' изменён.');
            redirect('/admin/users.php');
        }
    }

    if ($action === 'drop') {
        $login = post('login', 40);
        $owners = array_filter($users, static fn($u) => ($u['role'] ?? '') === 'owner');
        if ($login === $me['login'])                                   $error = 'Нельзя удалить самого себя.';
        elseif (count($owners) <= 1 && user_find($login)['role'] === 'owner') $error = 'Это последний владелец — удалять нельзя.';
        else {
            $users = array_filter($users, static fn($u) => $u['login'] !== $login);
            users_save($users);
            flash('Пользователь ' . $login . ' удалён.');
            redirect('/admin/users.php');
        }
    }
}

layout_head('Пользователи', $me, 'users.php');
flash_show();
if ($error) echo '<p class="flash flash--err">' . h($error) . '</p>';

echo '<h1>Пользователи</h1>';

if ($isOwner) {
    echo '<div class="card"><table class="table"><thead><tr><th>Логин</th><th>Имя</th><th>Роль</th><th>Последний вход</th><th></th></tr></thead><tbody>';
    foreach (users_load() as $u) {
        $last = ($u['last'] ?? '') !== '' ? date('d.m.Y H:i', strtotime($u['last'])) : 'ни разу';
        echo '<tr><td><b>' . h($u['login']) . '</b></td><td>' . h($u['name']) . '</td>';
        echo '<td>' . ($u['role'] === 'owner' ? 'владелец' : 'редактор') . '</td><td class="muted">' . h($last) . '</td><td class="row-actions">';
        echo '<form method="post" class="inline">' . csrf_field()
            . '<input type="hidden" name="action" value="reset"><input type="hidden" name="login" value="' . h($u['login']) . '">'
            . '<input type="password" name="password" placeholder="новый пароль" minlength="10" autocomplete="new-password">'
            . '<button class="btn btn--sm btn--ghost" type="submit">Сменить</button></form>';
        if ($u['login'] !== $me['login']) {
            echo '<form method="post" class="inline" onsubmit="return confirm(\'Удалить пользователя ' . h($u['login']) . '?\')">' . csrf_field()
                . '<input type="hidden" name="action" value="drop"><input type="hidden" name="login" value="' . h($u['login']) . '">'
                . '<button class="btn btn--sm btn--danger" type="submit">Удалить</button></form>';
        }
        echo '</td></tr>';
    }
    echo '</tbody></table></div>';

    echo '<div class="card card--narrow"><h2>Добавить пользователя</h2><form method="post" class="form">' . csrf_field();
    echo '<input type="hidden" name="action" value="add">';
    echo '<label>Логин<input name="login" required autocomplete="off"></label>';
    echo '<label>Имя<input name="name" placeholder="Как подписывать заявки"></label>';
    echo '<label>Пароль<input type="password" name="password" required minlength="10" autocomplete="new-password"></label>';
    echo '<label>Роль<select name="role"><option value="editor">Редактор: заявки и содержимое сайта</option><option value="owner">Владелец: ещё и пользователи с настройками</option></select></label>';
    echo '<button class="btn" type="submit">Добавить</button></form></div>';
}

echo '<div class="card card--narrow"><h2>Мой пароль</h2><form method="post" class="form">' . csrf_field();
echo '<input type="hidden" name="action" value="self">';
echo '<label>Текущий пароль<input type="password" name="old" required autocomplete="current-password"></label>';
echo '<label>Новый пароль<input type="password" name="new" required minlength="10" autocomplete="new-password"></label>';
echo '<button class="btn" type="submit">Сменить пароль</button></form></div>';

layout_foot();
