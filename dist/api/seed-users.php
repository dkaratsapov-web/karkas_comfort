<?php
/*  Заводит учётные записи из users.seed.json на уже работающем сервере.
 *
 *  Сам по себе файл-зародыш применяется только когда список пуст: иначе
 *  добавленная учётка возвращалась бы после каждой выгрузки, даже если
 *  её намеренно удалили. Поэтому применение отмечается в самом списке,
 *  и второй раз один и тот же логин не заводится.
 *
 *  Запуск на сервере:  php seed-users.php
 */

declare(strict_types=1);

$dir   = __DIR__;
$seed  = $dir . '/users.seed.json';
$users = $dir . '/admin-users.json';

$read = static function (string $file): array {
    if (!is_file($file)) return [];
    $data = json_decode((string) file_get_contents($file), true);
    return is_array($data) ? $data : [];
};

$from = $read($seed)['users'] ?? [];
if (!$from) { echo "файла-зародыша нет — нечего заводить\n"; exit; }

$now     = $read($users);
$list    = $now['users'] ?? [];
$applied = $now['seed_applied'] ?? [];
$known   = array_map(static fn($u) => mb_strtolower((string) ($u['login'] ?? '')), $list);

$added = [];
foreach ($from as $user) {
    $login = mb_strtolower((string) ($user['login'] ?? ''));
    if ($login === '' || empty($user['hash'])) continue;
    if (in_array($login, $known, true))   { echo "$login: уже есть\n"; continue; }
    if (in_array($login, $applied, true)) { echo "$login: заводился раньше и был удалён — не возвращаю\n"; continue; }
    $list[]    = $user;
    $applied[] = $login;
    $added[]   = $login;
}

if (!$added) { echo "новых учётных записей нет\n"; exit; }

$out = ['users' => array_values($list), 'seed_applied' => array_values(array_unique($applied))];
$tmp = $users . '.tmp';
if (file_put_contents($tmp, json_encode($out, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), LOCK_EX) === false) {
    fwrite(STDERR, "не удалось записать $users\n");
    exit(1);
}
@chmod($tmp, 0660);
rename($tmp, $users);
echo 'заведены: ' . implode(', ', $added) . "\n";
