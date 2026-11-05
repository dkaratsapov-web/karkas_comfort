<?php
/*  Проверка админки на сервере без браузера.
 *
 *  Код 500 после входа не оставляет следов в журналах nginx, поэтому
 *  вызываем то же, что делает страница заявок: читаем пользователей,
 *  заявки и их статусы. Падение видно сразу и с текстом.
 *
 *  Запуск:  php admin-selftest.php /путь/к/сайту/public
 */

declare(strict_types=1);

$root = $argv[1] ?? dirname(__DIR__);
$boot = $root . '/admin/_boot.php';

if (!is_file($boot)) { echo "нет файла $boot\n"; exit(1); }

/* страница заявок работает в сессии, в командной строке её нет */
if (session_status() !== PHP_SESSION_ACTIVE) $_SESSION = [];

require $boot;

echo 'php: ' . PHP_VERSION . "\n";
foreach (['mbstring', 'curl', 'json', 'session', 'openssl'] as $ext) {
    echo "  расширение $ext: " . (extension_loaded($ext) ? 'есть' : 'НЕТ') . "\n";
}

try {
    $users = users_load();
    echo 'учётные записи: ' . count($users) . ' (' . implode(', ', array_map(static fn($u) => (string) ($u['login'] ?? '?'), $users)) . ")\n";
} catch (Throwable $e) {
    echo 'ошибка при чтении учётных записей: ' . $e->getMessage() . ' в ' . $e->getFile() . ':' . $e->getLine() . "\n";
}

try {
    $leads = leads_load();
    echo 'заявки: ' . count($leads) . "\n";
    $first = reset($leads);
    if ($first) echo '  последняя: ' . ($first['at'] ?? '?') . ' ' . ($first['name'] ?? '?') . "\n";
} catch (Throwable $e) {
    echo 'ОШИБКА при чтении заявок: ' . $e->getMessage() . ' в ' . $e->getFile() . ':' . $e->getLine() . "\n";
}

try {
    $s = settings_all();
    echo 'настройки прочитаны, ключей: ' . count($s) . "\n";
} catch (Throwable $e) {
    echo 'ошибка при чтении настроек: ' . $e->getMessage() . "\n";
}

$files = ['admin-users.json', 'settings.json', 'leads.jsonl', 'leads-state.json', 'leads.csv'];
echo "доступ на запись:\n";
foreach ($files as $f) {
    $path = $root . '/api/' . $f;
    $can  = is_file($path) ? (is_writable($path) ? 'да' : 'НЕТ') : 'файла нет';
    echo "  $f: $can\n";
}
echo 'каталог api/: ' . (is_writable($root . '/api') ? 'запись есть' : 'ЗАПИСИ НЕТ') . "\n";
