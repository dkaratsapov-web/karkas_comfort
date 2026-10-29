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
        'telegram_token'   => post('telegram_token', 120),
        'telegram_chat_id' => post('telegram_chat_id', 60),
        'crm_webhook'      => post('crm_webhook', 500),
        'crm_format'       => post('crm_format', 10) === 'form' ? 'form' : 'json',
        'rate_limit'       => max(1, min(100, (int) post('rate_limit', 5))),
    ];
    if ($values['to'] === '' || !filter_var(explode(',', $values['to'])[0], FILTER_VALIDATE_EMAIL)) {
        $error = 'Укажите рабочий адрес почты (несколько — через запятую).';
    } elseif ($values['crm_webhook'] !== '' && !filter_var($values['crm_webhook'], FILTER_VALIDATE_URL)) {
        $error = 'Адрес вебхука CRM должен начинаться с https://';
    } else {
        settings_save($values);
        flash('Настройки сохранены.');
        redirect('/admin/settings.php');
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
    $test = $code === 200 && !empty($body['ok'])
        ? 'Тестовая заявка отправлена. Проверьте почту' . ($now['telegram_token'] ? ' и Telegram' : '') . ' — письмо приходит в течение минуты.'
        : 'Не получилось: сервер ответил ' . $code . ' ' . mb_substr(strip_tags($answer), 0, 200);
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

echo '<h2>Telegram</h2>';
echo '<p class="muted">Токен берётся у @BotFather, идентификатор чата — у @userinfobot. Для группы добавьте бота в неё и возьмите идентификатор группы (начинается с -100).</p>';
echo '<label>Токен бота<input name="telegram_token" value="' . h($now['telegram_token'] ?? '') . '" autocomplete="off" placeholder="123456:AA..."></label>';
echo '<label>Идентификатор чата<input name="telegram_chat_id" value="' . h($now['telegram_chat_id'] ?? '') . '" autocomplete="off"></label>';

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

echo '<form method="post" class="card card--narrow">' . csrf_field() . '<input type="hidden" name="action" value="test">';
echo '<h2>Проверка</h2><p class="muted">Отправит тестовую заявку тем же путём, что и форма на сайте. В списке заявок она будет подписана как проверка.</p>';
echo '<button class="btn btn--ghost" type="submit">Отправить тестовую заявку</button></form>';

layout_foot();
