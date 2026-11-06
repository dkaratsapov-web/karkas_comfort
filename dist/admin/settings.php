<?php
/*  Куда уходят заявки: почта, Telegram, вебхук CRM.
 *
 *  Правки пишутся в api/settings.json рядом с сайтом; он перекрывает
 *  значения из api/config.php и не трогается выгрузкой. Кнопка проверки
 *  отправляет тестовую заявку тем же кодом, что и сайт, — видно сразу,
 *  дошло или нет, а не «когда-нибудь позвонят и скажут».
 */

declare(strict_types=1);
require __DIR__ . '/_boot.php';
require_once API_DIR . '/max.php';

session_boot();
csrf_check();
$me = require_owner();

$now   = settings_all();
$error = '';
$test  = '';

if (post('action', 20) === 'save') {
    $values = [
        'to'               => post('to', 300),
        'from'             => post('from', 120),
        'from_name'        => post('from_name', 120),
        'subject'          => post('subject', 200),
        'smtp_host'        => post('smtp_host', 120),
        'smtp_port'        => (int) post('smtp_port', 5) ?: 465,
        'smtp_user'        => post('smtp_user', 120),
        /* Пустое поле пароля значит «оставить как было»: пароль в админке
           не показывается, и сохранение настроек не должно его стирать. */
        'smtp_pass'        => post('smtp_pass', 200) !== ''
            ? post('smtp_pass', 200)
            : (string) ($now['smtp_pass'] ?? ''),
        /* Пустое поле токена значит «оставить как было»: токен
           в админке не показывается, и сохранение не должно его
           стирать — иначе заявки молча перестают доходить. */
        'telegram_token'   => post('telegram_token', 120) !== ''
            ? post('telegram_token', 120)
            : (string) ($now['telegram_token'] ?? ''),
        'telegram_chat_id' => post('telegram_chat_id', 60),
        'max_token'        => post('max_token', 200) !== ''
            ? post('max_token', 200)
            : (string) ($now['max_token'] ?? ''),
        'max_chat_id'      => post('max_chat_id', 60),
        'max_user_id'      => post('max_user_id', 60),
        'max_secret'       => (string) ($now['max_secret'] ?? ''),
        'crm_webhook'      => post('crm_webhook', 500),
        'crm_format'       => post('crm_format', 10) === 'form' ? 'form' : 'json',
        'rate_limit'       => max(1, min(100, (int) post('rate_limit', 5))),
    ];
    if ($values['to'] === '' || !filter_var(explode(',', $values['to'])[0], FILTER_VALIDATE_EMAIL)) {
        $error = 'Укажите рабочий адрес почты (несколько — через запятую).';
    } elseif ($values['smtp_host'] !== '' && ($values['smtp_user'] === '' || $values['smtp_pass'] === '')) {
        $error = 'Для почтового сервера нужны логин и пароль ящика, через который идёт отправка.';
    } elseif ($values['smtp_host'] !== '' && !in_array((int) $values['smtp_port'], [25, 465, 587, 2525], true)) {
        $error = 'Порт почтового сервера обычно 465 (шифрование сразу) или 587 (STARTTLS).';
    } elseif ($values['crm_webhook'] !== '' && !filter_var($values['crm_webhook'], FILTER_VALIDATE_URL)) {
        $error = 'Адрес вебхука CRM должен начинаться с https://';
    } else {
        settings_save($values);
        flash('Настройки сохранены.');
        redirect('/admin/settings.php');
    }
}

/* Бот MAX: подключение и получатель.
   Чаты бот запоминает сам — при добавлении в чат и при сообщении.
   Поэтому вместо «найдите идентификатор» админка показывает список
   и даёт выбрать, а опрос событий остаётся запасным путём. */
$maxWho  = '';
$maxHook = '';
$action  = post('action', 20);

/* Последняя записанная причина, по которой не ушло письмо. */
function lead_mail_error(): string
{
    $file = API_DIR . '/leads.jsonl';
    if (!is_file($file)) return '';
    $lines = @file($file, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [];
    for ($i = count($lines) - 1; $i >= 0 && $i > count($lines) - 5; $i--) {
        $row = json_decode($lines[$i], true);
        if (is_array($row) && !empty($row['mail_error'])) {
            return (string) $row['mail_error'];
        }
    }
    return '';
}

function max_hook_url(): string
{
    $host = $_SERVER['HTTP_HOST'] ?? 'xn--80aa2abbmnbmggrx.xn--p1ai';
    return 'https://' . $host . '/api/max-bot.php';
}

if ($action === 'maxhook' || $action === 'maxoff') {
    $token = (string) ($now['max_token'] ?? '');
    if ($token === '') {
        $maxHook = 'Сначала впишите токен бота и сохраните настройки.';
    } elseif ($action === 'maxoff') {
        $r = max_unsubscribe($token, max_hook_url());
        $maxHook = $r['ok'] ? 'Бот отключён: события больше не приходят.' : 'Не получилось: ' . $r['error'];
    } else {
        /* Пока подписки нет, MAX отдаёт накопленные события опросом,
           а после подписки — перестаёт. Поэтому сначала забираем, что
           уже есть: бота могли добавить в чат раньше подключения,
           и это событие иначе потерялось бы. */
        $seen = max_updates($token, 100);
        if ($seen['ok']) {
            $chats = json_read(API_DIR . '/max-chats.json');
            $before = count($chats);
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
                json_write(API_DIR . '/max-chats.json', $chats);
                $maxWho = 'Из прошлых событий бота добавлено чатов: ' . (count($chats) - $before) . '. ';
            }
        }

        /* Секрет создаётся один раз и хранится на сервере: по нему
           страница бота отличает события MAX от чужих запросов. */
        $secret = (string) ($now['max_secret'] ?? '');
        if ($secret === '') {
            $secret = rtrim(strtr(base64_encode(random_bytes(18)), '+/', '-_'), '=');
            settings_save(['max_secret' => $secret]);
            $now['max_secret'] = $secret;
        }
        $me = max_me($token);
        if (!$me['ok']) {
            $maxHook = 'MAX не принял токен: ' . $me['error'];
        } else {
            /* Сначала стучимся на свой же адрес: если сервер закрывает
               его, MAX не доставит ни одного события, а понять это по
               молчанию бота потом тяжело. */
            $ch = curl_init(max_hook_url());
            curl_setopt_array($ch, [
                CURLOPT_POST           => true,
                CURLOPT_POSTFIELDS     => '{}',
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_HEADER         => true,
                CURLOPT_TIMEOUT        => 10,
            ]);
            $probe = (string) curl_exec($ch);
            $own   = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
            curl_close($ch);
            /* Запрос без секрета бот отклоняет сам: 403 с его
               заголовком — признак исправности, а не запрета. */
            if (stripos($probe, 'X-Max-Bot: ready') === false && ($own === 403 || $own === 404)) {
                $maxHook = 'Адрес для событий бота закрыт сервером (ответ ' . $own
                    . '). Сообщите об этом — нужно обновить конфигурацию сервера, без неё бот не получит ни одного события.';
                $own = 0;
            }
        }
        if ($me['ok'] && ($own ?? 0) !== 0) {
            $r = max_subscribe($token, max_hook_url(), $secret, [
                'message_created', 'message_callback', 'bot_added', 'bot_removed',
                'bot_started', 'chat_title_changed',
            ]);
            $botName = (string) ($me['data']['name'] ?? $me['data']['first_name'] ?? 'бот');
            $maxHook = $r['ok'] && !empty($r['data']['success'])
                ? 'Бот «' . $botName . '» подключён. Теперь добавьте его в рабочий чат и напишите там любое сообщение — чат сам появится в списке ниже, искать его номер не нужно.'
                : 'Не получилось подключить: ' . ($r['error'] ?: (string) ($r['data']['message'] ?? 'MAX отказал'));
        }
    }
}

if ($action === 'maxwho') {
    $token = (string) ($now['max_token'] ?? '');
    if ($token === '') {
        $maxWho = 'Сначала впишите токен бота и сохраните настройки.';
    } else {
        /* При включённом вебхуке опрос событий MAX не отдаёт, поэтому
           сперва смотрим, что бот запомнил сам. Названия события не
           приносят — дочитываем их по идентификаторам, иначе в списке
           одни номера и выбрать нужный чат невозможно. */
        $known = json_read(API_DIR . '/max-chats.json');
        if ($known) {
            $filled = max_chats_refresh($token, $known);
            if ($filled !== $known) {
                json_write(API_DIR . '/max-chats.json', $filled);
                $known = $filled;
            }
        }
        $found = [];
        foreach ($known as $chat) {
            if (empty($chat['chat_id'])) continue;
            $found[max_chat_label($chat)] = (string) $chat['chat_id'];
        }
        if (!$found) {
            $r = max_updates($token);
            $walk = static function ($node) use (&$walk, &$found) {
                if (!is_array($node)) return;
                if (isset($node['chat_id'])) $found['чат ' . $node['chat_id']] = (string) $node['chat_id'];
                foreach ($node as $child) $walk($child);
            };
            if ($r['ok']) $walk($r['data']);
            elseif (!$maxWho) $maxWho = 'MAX ответил: ' . $r['error'] . ' ';
        }
        $maxWho .= $found
            ? 'Бот знает эти чаты: ' . implode(' · ', array_map(static fn($k, $v) => "$k", array_keys($found), $found))
            : 'Чатов пока нет. Добавьте бота в рабочий чат или напишите ему — он запомнит сам.';
        $maxChats = $found;
    }
}

if (post('action', 20) === 'test') {
    $channel = post('channel', 20);
    $url     = (($_SERVER['HTTPS'] ?? '') === 'on' ? 'https' : 'http') . '://' . ($_SERVER['HTTP_HOST'] ?? 'localhost') . '/api/lead.php';
    $payload = json_encode([
        'name'    => 'Проверка связи',
        'phone'   => '+7 920 171-69-69',
        'message' => 'Тестовая заявка из админки (' . $me['login'] . '). Если письмо дошло — приём заявок работает.',
        'page'    => '/admin/settings.php',
        'consent' => true,
        'test'    => true,
    ], JSON_UNESCAPED_UNICODE);

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => $payload,
        CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 20,
    ]);
    $answer = (string) curl_exec($ch);
    $code   = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);
    $body = json_decode($answer, true);
    if ($code === 200 && !empty($body['ok'])) {
        $ways = $body['sent'] ?? [];
        $ok   = [];
        if (!empty($ways['mail']))     $ok[] = 'почта';
        if (!empty($ways['telegram'])) $ok[] = 'Telegram';
        if (!empty($ways['max']))      $ok[] = 'MAX';
        if (!empty($ways['crm']))      $ok[] = 'CRM';
        $test = $ok
            ? 'Заявка ушла: ' . implode(', ', $ok) . '. Письмо приходит в течение минуты.'
            : 'Заявка сохранена, но ни один канал её не принял.';
        /* Причину отказа почты пишет сам приёмник заявок — забираем её
           из последней записи, чтобы владелец видел, что именно не так. */
        if (empty($ways['mail'])) {
            $why = lead_mail_error();
            $test .= ' Почта: ' . ($why !== '' ? $why : 'письмо не отправлено.');
        }
    } else {
        $test = 'Не получилось: сервер ответил ' . $code . ' ' . mb_substr(strip_tags($answer), 0, 200);
    }
    $test = $channel === '' ? $test : $test;
}

layout_head('Настройки заявок', $me, 'settings.php');
flash_show();
if ($error) echo '<p class="flash flash--err">' . h($error) . '</p>';
if ($test)  echo '<p class="flash">' . h($test) . '</p>';

echo '<h1>Куда уходят заявки</h1>';
echo '<p class="muted lead-text">С формы сайта заявка уходит сразу в три места, если они заполнены: письмом на почту, сообщением в Telegram и в CRM по вебхуку. Любое поле можно оставить пустым — этот способ просто не будет использоваться. Заявки в любом случае сохраняются здесь, в разделе «Заявки».</p>';

echo '<form method="post" class="form card">' . csrf_field() . '<input type="hidden" name="action" value="save">';

echo '<h2>Почта</h2>';
echo '<label>Куда слать заявки<input name="to" value="' . h($now['to'] ?? '') . '" required placeholder="pochta@example.ru, vtoraya@example.ru"><small>Несколько адресов — через запятую.</small></label>';
echo '<label>Адрес отправителя<input name="from" value="' . h($now['from'] ?? '') . '"><small>Домен должен совпадать с сайтом, иначе письма уходят в спам.</small></label>';
echo '<label>Имя отправителя<input name="from_name" value="' . h($now['from_name'] ?? '') . '"></label>';
echo '<label>Тема письма<input name="subject" value="' . h($now['subject'] ?? '') . '"></label>';

echo '<h3>Через какой ящик отправлять</h3>';
echo '<p class="muted">На этом сервере своей почтовой службы нет, и письма с нового адреса без подписи попадают в спам. Поэтому сайт отправляет письма через обычный почтовый ящик компании — так же, как почтовая программа на компьютере. Для Яндекса: <b>smtp.yandex.ru</b>, порт <b>465</b>, логин — полный адрес ящика, пароль — <b>пароль приложения</b> (Яндекс ID → Безопасность → Пароли приложений), обычный пароль от входа не подойдёт. Для Mail.ru: <b>smtp.mail.ru</b>, порт 465, тоже пароль для внешнего приложения.</p>';
echo '<label>Почтовый сервер<input name="smtp_host" value="' . h((string) ($now['smtp_host'] ?? '')) . '" placeholder="smtp.yandex.ru"><small>Оставьте пустым, если сайт переедет на обычный хостинг со своей почтой.</small></label>';
echo '<label>Порт<input type="number" name="smtp_port" value="' . h((string) ($now['smtp_port'] ?? 465)) . '" min="1" max="65535"><small>465 — шифрование сразу, 587 — STARTTLS.</small></label>';
echo '<label>Логин ящика<input name="smtp_user" value="' . h((string) ($now['smtp_user'] ?? '')) . '" autocomplete="off" placeholder="zayavki@example.ru"></label>';
echo '<label>Пароль приложения<input type="password" name="smtp_pass" value="" autocomplete="new-password" placeholder="'
    . (($now['smtp_pass'] ?? '') !== '' ? 'сохранён — впишите новый, чтобы заменить' : 'пароль приложения, не от входа')
    . '"><small>Пароль не показывается. Пустое поле оставит прежний.</small></label>';

echo '<h2>Telegram</h2>';
echo '<p class="muted">Токен берётся у @BotFather, идентификатор чата — у @userinfobot. Для группы добавьте бота в неё и возьмите идентификатор группы (начинается с -100).</p>';
echo '<label>Токен бота<input type="password" name="telegram_token" value="" autocomplete="new-password" placeholder="'
    . (($now['telegram_token'] ?? '') !== '' ? 'сохранён — впишите новый, чтобы заменить' : '123456:AA...')
    . '"><small>Токен не показывается. Пустое поле оставит прежний.</small></label>';
echo '<label>Идентификатор чата<input name="telegram_chat_id" value="' . h($now['telegram_chat_id'] ?? '') . '" autocomplete="off"></label>';

echo '<h2>MAX</h2>';
echo '<p class="muted">Токен берётся в кабинете MAX: Чат-боты → ваш бот → Настройки. Впишите его, сохраните и нажмите «Подключить бота» внизу — дальше достаточно добавить бота в рабочий чат, он сам появится в списке ниже.</p>';
echo '<label>Токен бота<input type="password" name="max_token" value="" autocomplete="new-password" placeholder="'
    . (($now['max_token'] ?? '') !== '' ? 'сохранён — впишите новый, чтобы заменить' : 'из кабинета MAX')
    . '"><small>Токен не показывается. Пустое поле оставит прежний.</small></label>';
$chats = json_read(API_DIR . '/max-chats.json');
if ($chats) {
    echo '<label>Куда слать заявки<select name="max_chat_id">';
    echo '<option value="">— не выбрано —</option>';
    foreach ($chats as $chat) {
        $id    = (string) ($chat['chat_id'] ?? '');
        if ($id === '') continue;
        $sel   = ((string) ($now['max_chat_id'] ?? '') === $id) ? ' selected' : '';
        echo '<option value="' . h($id) . '"' . $sel . '>' . h(max_chat_label($chat)) . '</option>';
    }
    echo '</select><small>Список составляет сам бот: сюда попадают чаты, куда его добавили. Если вместо названия стоит «без названия» — нажмите «Обновить список чатов» внизу, названия дочитываются из MAX.</small></label>';
} else {
    echo '<label>Идентификатор чата<input name="max_chat_id" value="' . h($now['max_chat_id'] ?? '') . '" autocomplete="off" placeholder="заполнится сам, когда бота добавят в чат"></label>';
}
echo '<label>Идентификатор пользователя<input name="max_user_id" value="' . h($now['max_user_id'] ?? '') . '" autocomplete="off" placeholder="для личного диалога, если чат не нужен"></label>';

echo '<h2>CRM</h2>';
echo '<p class="muted">Входящий вебхук CRM: в Битрикс24 это «CRM → Настройки → Вебхуки», в amoCRM — «Настройки → Интеграции». Подойдёт и адрес сценария в Make или n8n.</p>';
echo '<label>Адрес вебхука<input name="crm_webhook" value="' . h($now['crm_webhook'] ?? '') . '" placeholder="https://..."></label>';
$fmt = ($now['crm_format'] ?? 'json');
echo '<label>Формат<select name="crm_format">'
    . '<option value="json"' . ($fmt === 'json' ? ' selected' : '') . '>JSON — подходит большинству сервисов, Make и n8n</option>'
    . '<option value="form"' . ($fmt === 'form' ? ' selected' : '') . '>Обычная форма — вебхуки amoCRM и Битрикс24</option>'
    . '</select></label>';

echo '<h2>Защита от спама</h2>';
echo '<label>Сколько заявок принимать с одного адреса за час<input type="number" name="rate_limit" min="1" max="100" value="' . h((string) ($now['rate_limit'] ?? 5)) . '"></label>';

echo '<button class="btn" type="submit">Сохранить</button></form>';

if ($maxHook) echo '<p class="flash">' . h($maxHook) . '</p>';
if ($maxWho)  echo '<p class="flash">' . h($maxWho) . '</p>';
echo '<form method="post" class="card card--narrow">' . csrf_field();
echo '<h2>Бот MAX</h2><p class="muted">Бот в групповом чате должен быть <b>администратором</b>: иначе MAX не отдаёт ему события этого чата, и чат не появится в списке. Подключение нужно один раз: после него бот получает события — его добавили в чат, нажали кнопку под заявкой, написали сообщение. Адрес для событий: ' . h(max_hook_url()) . '</p>';
echo '<button class="btn btn--ghost" type="submit" name="action" value="maxhook">Подключить бота</button> ';
echo '<button class="btn btn--ghost" type="submit" name="action" value="maxwho">Обновить список чатов</button> ';
echo '<button class="btn btn--ghost" type="submit" name="action" value="maxoff">Отключить</button>';
echo '</form>';

echo '<form method="post" class="card card--narrow">' . csrf_field() . '<input type="hidden" name="action" value="test">';
echo '<h2>Проверка</h2><p class="muted">Отправит тестовую заявку тем же путём, что и форма на сайте. В списке заявок она будет подписана как проверка.</p>';
echo '<button class="btn btn--ghost" type="submit">Отправить тестовую заявку</button></form>';

layout_foot();
