<?php
/*  Подключение бота MAX к сайту — из командной строки.
 *
 *  То же, что кнопка «Подключить бота» в админке, но выполняется
 *  на сервере при выгрузке: событиями бота управляет подписка, и
 *  держать её живой не должно зависеть от того, зашёл ли кто-то
 *  в кабинет. Запуск без токена ничего не делает.
 *
 *  Запуск: sudo -u www-data php api/max-link.php <домен>
 */

declare(strict_types=1);

if (PHP_SAPI !== 'cli') {           // по вебу страница не существует
    http_response_code(404);
    exit;
}

require_once __DIR__ . '/max.php';

$host = $argv[1] ?? 'xn--80aa2abbmnbmggrx.xn--p1ai';
$hook = 'https://' . $host . '/api/max-bot.php';
$file = __DIR__ . '/settings.json';

function say(string $line): void { echo $line, "\n"; }

$settings = is_file($file)
    ? (json_decode((string) file_get_contents($file), true) ?: [])
    : [];

$token = trim((string) ($settings['max_token'] ?? ''));
if ($token === '') {
    say('токена бота нет — подключать нечего');
    exit(0);
}

function store(string $file, array $settings): bool
{
    $tmp = $file . '.tmp';
    $ok  = @file_put_contents($tmp, json_encode($settings, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT)) !== false
        && @rename($tmp, $file);
    if (!$ok) { @unlink($tmp); say('ПРЕДУПРЕЖДЕНИЕ: не удалось записать settings.json — нет прав'); }
    return $ok;
}

/* Кто мы: заодно проверка, что токен живой. */
$me = max_me($token);
if (!$me['ok']) {
    say('MAX не принял токен: ' . $me['error']);
    exit(0);                        // выгрузку из-за этого не валим
}
$botName = (string) ($me['data']['name'] ?? $me['data']['first_name'] ?? 'бот');
say('бот: ' . $botName);

/* Пока подписки нет, MAX отдаёт накопленные события опросом, а после
   подписки перестаёт. Поэтому сначала забираем, что уже есть: бота
   могли добавить в чат раньше подключения. */
$chatsFile = __DIR__ . '/max-chats.json';
$chats = is_file($chatsFile)
    ? (json_decode((string) file_get_contents($chatsFile), true) ?: [])
    : [];
$before = count($chats);

$seen = max_updates($token, 100);
if ($seen['ok']) {
    $walk = static function ($node) use (&$walk, &$chats) {
        if (!is_array($node)) return;
        if (!empty($node['chat_id'])) {
            $id = (string) $node['chat_id'];
            $chats[$id] = array_merge($chats[$id] ?? [], [
                'chat_id' => $id,
                'title'   => (string) ($chats[$id]['title'] ?? ($node['title'] ?? '')),
                'kind'    => !empty($node['is_channel']) ? 'channel' : ($chats[$id]['kind'] ?? 'chat'),
                'seen'    => date('c'),
            ]);
        }
        foreach ($node as $child) $walk($child);
    };
    $walk($seen['data']);
    if (count($chats) > $before) {
        $tmp = $chatsFile . '.tmp';
        if (@file_put_contents($tmp, json_encode($chats, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT)) !== false) {
            @rename($tmp, $chatsFile);
        }
        say('из прошлых событий добавлено чатов: ' . (count($chats) - $before));
    }
}

/* Секрет живёт на сервере: по нему страница бота отличает события
   MAX от чужих запросов. Создаётся один раз. */
$secret = (string) ($settings['max_secret'] ?? '');
if ($secret === '') {
    $secret = rtrim(strtr(base64_encode(random_bytes(18)), '+/', '-_'), '=');
    $settings['max_secret'] = $secret;
    store($file, $settings);
    say('секрет для событий создан');
}

/* Свой же адрес: если сервер его закрывает, MAX не доставит ни одного
   события, а понять это по молчанию бота потом тяжело. */
$ch = curl_init($hook);
curl_setopt_array($ch, [
    CURLOPT_POST => true, CURLOPT_POSTFIELDS => '{}',
    CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 10,
]);
curl_exec($ch);
$own = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
curl_close($ch);
if ($own === 403 || $own === 404) {
    say('адрес для событий закрыт сервером (ответ ' . $own . ') — бот не получит ни одного события');
    exit(0);
}
say('адрес для событий отвечает: ' . $own . ' (403 на пустой запрос — так и задумано)');

/* Подписка. Повторный вызов с тем же адресом MAX принимает спокойно,
   поэтому шаг можно гонять на каждой выгрузке. */
$have = max_subscriptions($token);
$already = false;
if ($have['ok']) {
    foreach ((array) ($have['data']['subscriptions'] ?? []) as $s) {
        if (($s['url'] ?? '') === $hook) $already = true;
    }
}
$r = max_subscribe($token, $hook, $secret, [
    'message_created', 'message_callback', 'bot_added', 'bot_removed',
    'bot_started', 'chat_title_changed',
]);
say($r['ok'] && !empty($r['data']['success'])
    ? ($already ? 'подписка на события обновлена' : 'подписка на события создана')
    : 'подписка не удалась: ' . ($r['error'] ?: (string) ($r['data']['message'] ?? 'MAX отказал')));

/* Получатель заявок. Если он не выбран, а бот знает ровно один чат —
   выбираем его: это и есть тот рабочий чат, куда бота добавили. */
$to = trim((string) ($settings['max_chat_id'] ?? ''));
$user = trim((string) ($settings['max_user_id'] ?? ''));
if ($chats) {
    say('чаты, которые знает бот:');
    foreach ($chats as $c) {
        $mark = ((string) ($c['chat_id'] ?? '') === $to) ? ' ← получатель заявок' : '';
        say('  ' . ($c['title'] !== '' ? $c['title'] : ($c['kind'] ?? 'чат')) . ' · ' . $c['chat_id'] . $mark);
    }
} else {
    say('чатов бот пока не знает: напишите в рабочем чате любое сообщение — после подписки он запомнит его сам');
}

if ($to === '' && $user === '' && count($chats) === 1) {
    $only = (string) array_key_first($chats);
    $settings['max_chat_id'] = $only;
    if (store($file, $settings)) say('получателем заявок выбран единственный известный чат: ' . $only);
} elseif ($to === '' && $user === '' && count($chats) > 1) {
    say('получатель не выбран, а чатов несколько — выберите в админке, «Настройки заявок»');
} elseif ($to !== '' || $user !== '') {
    say('получатель заявок уже задан');
}
