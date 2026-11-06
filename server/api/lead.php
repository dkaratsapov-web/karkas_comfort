<?php
/*  Приём заявок с форм сайта.
    Ожидает POST c JSON: { name, phone, message, project, consent, page }
    Отвечает JSON: { ok: true } либо { ok: false, error: "…" }          */

declare(strict_types=1);

ini_set('log_errors', '1');
ini_set('display_errors', '0');
ini_set('error_log', __DIR__ . '/admin-error.log');

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');

require_once __DIR__ . '/max.php';
require_once __DIR__ . '/max-card.php';

$config = require __DIR__ . '/config.php';

/* Настройки из админки перекрывают значения, заданные при установке:
   почта, Telegram и CRM меняются на сайте, а не правкой файла по SSH. */
$overrides = is_file(__DIR__ . '/settings.json')
    ? json_decode((string) file_get_contents(__DIR__ . '/settings.json'), true)
    : null;
if (is_array($overrides)) {
    foreach ($overrides as $key => $value) {
        if (is_string($value) && trim($value) === '' && !array_key_exists($key, $config)) continue;
        if (in_array($key, ['github_token', 'github_repo', 'github_branch'], true)) continue;
        $config[$key] = $value;
    }
}

function fail(string $message, int $code = 400)
{
    http_response_code($code);
    echo json_encode(['ok' => false, 'error' => $message], JSON_UNESCAPED_UNICODE);
    exit;
}

/* ---------- кто и откуда пришёл ----------
   В заявке мало телефона: менеджеру важно, с какой рекламы человек,
   из какого города и с чего смотрел — от этого зависит и разговор,
   и куда вкладывать рекламные деньги. */

/** Телефон или компьютер и какой браузер — коротко, без версий. */
function device_from_ua(string $ua): string
{
    if ($ua === '') return '';
    $kind = preg_match('~iPad|Tablet~i', $ua) ? 'планшет'
        : (preg_match('~Mobile|Android|iPhone|iPod~i', $ua) ? 'телефон' : 'компьютер');
    $browser = '';
    foreach ([
        'YaBrowser' => 'Яндекс Браузер', 'Edg' => 'Edge', 'OPR' => 'Opera',
        'Firefox' => 'Firefox', 'Chrome' => 'Chrome', 'Safari' => 'Safari',
    ] as $needle => $name) {
        if (stripos($ua, $needle) !== false) { $browser = $name; break; }
    }
    return $browser !== '' ? $kind . ', ' . $browser : $kind;
}

/** Город по адресу посетителя. Ответ кешируется на сутки: один и тот
 *  же человек часто оставляет несколько заявок, а сторонний сервис
 *  может отвечать медленно или не ответить вовсе — тогда просто
 *  останемся без города, заявка от этого не пострадает. */
function place_by_ip(string $ip): string
{
    if ($ip === '' || !filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) {
        return '';
    }
    if (!function_exists('curl_init')) return '';

    $file  = __DIR__ . '/ip-places.json';
    $cache = is_file($file) ? (json_decode((string) file_get_contents($file), true) ?: []) : [];
    $row   = $cache[$ip] ?? null;
    if (is_array($row) && (time() - (int) ($row['at'] ?? 0)) < 86400) {
        return (string) ($row['place'] ?? '');
    }

    $ch = curl_init('https://ipwho.is/' . rawurlencode($ip) . '?fields=success,city,region,country');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 3,
        CURLOPT_CONNECTTIMEOUT => 2,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
    ]);
    $answer = (string) curl_exec($ch);
    curl_close($ch);

    $data  = json_decode($answer, true);
    $place = '';
    if (is_array($data) && !empty($data['success'])) {
        $parts = array_filter([
            (string) ($data['city'] ?? ''),
            (string) ($data['region'] ?? ''),
            (string) ($data['country'] ?? ''),
        ], static fn($v) => trim($v) !== '');
        /* Страну не повторяем, когда это Россия: и так понятно */
        if (($data['country'] ?? '') === 'Russia') array_pop($parts);
        $place = implode(', ', array_slice($parts, 0, 2));
    }

    $cache[$ip] = ['place' => $place, 'at' => time()];
    if (count($cache) > 500) $cache = array_slice($cache, -500, null, true);
    @file_put_contents($file, json_encode($cache, JSON_UNESCAPED_UNICODE), LOCK_EX);
    return $place;
}

/** Источник человеческими словами: откуда пришёл клиент. */
function source_label(array $utm, string $referrer): string
{
    $named = [
        'yandex-direct' => 'Яндекс Директ', 'yandex' => 'Яндекс',
        'google-ads' => 'Google Ads', 'google' => 'Google',
        'vk' => 'ВКонтакте', 'telegram' => 'Telegram', 'max' => 'MAX',
        'avito' => 'Авито', 'instagram' => 'Instagram',
    ];
    $src = (string) ($utm['utm_source'] ?? '');
    if ($src !== '') {
        $label = $named[mb_strtolower($src)] ?? $src;
        $extra = array_filter([
            (string) ($utm['utm_campaign'] ?? ''),
            (string) ($utm['utm_content'] ?? ''),
        ], static fn($v) => $v !== '');
        return $extra ? $label . ' · ' . implode(' · ', $extra) : $label;
    }
    if ($referrer !== '') {
        $host = parse_url($referrer, PHP_URL_HOST);
        if (is_string($host) && $host !== '') {
            $host = preg_replace('~^www\.~', '', $host);
            foreach ($named as $key => $label) {
                if (str_contains($host, $key)) return 'переход с ' . $label;
            }
            return 'переход с ' . $host;
        }
    }
    return 'прямой заход';
}

/* --- принимаем только POST --- */
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    fail('Метод не поддерживается', 405);
}

/* --- данные: JSON или обычная форма --- */
$raw  = file_get_contents('php://input') ?: '';
$data = json_decode($raw, true);
if (!is_array($data)) {
    $data = $_POST;
}

$clean = static function ($value, int $max = 500): string {
    $value = is_scalar($value) ? (string) $value : '';
    $value = str_replace(["\r", "\n", "\0"], ' ', strip_tags($value));
    return mb_substr(trim($value), 0, $max);
};

/* --- ловушка для ботов: поле скрыто от людей и должно быть пустым --- */
if ($clean($data['website'] ?? '') !== '') {
    /* Каналы перечисляем без текста ошибки: подробности нужны владельцу
   в админке, а не случайному посетителю. Текст лежит в leads.jsonl. */
echo json_encode([
    'ok'   => true,
    'sent' => ['mail' => $sent, 'telegram' => $telegram, 'max' => $max, 'crm' => $crm],
], JSON_UNESCAPED_UNICODE);   // боту показываем успех
    exit;
}

$name    = $clean($data['name'] ?? '', 80);
$phone   = $clean($data['phone'] ?? '', 30);
$message = $clean($data['message'] ?? '', 2000);
$project = $clean($data['project'] ?? '', 120);
$page    = $clean($data['page'] ?? '', 200);
$digits  = preg_replace('/\D+/', '', $phone) ?? '';

if (mb_strlen($name) < 2)   fail('Укажите имя');
if (strlen($digits) < 11)   fail('Укажите телефон полностью');
if (empty($data['consent'])) fail('Нужно согласие на обработку персональных данных');

/* --- ограничение частоты по IP --- */
$ip    = $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
$stamp = sys_get_temp_dir() . '/kk_lead_' . md5($ip);
$hits  = is_file($stamp) && (time() - (int) filemtime($stamp) < 3600)
    ? (int) file_get_contents($stamp)
    : 0;
if ($hits >= (int) $config['rate_limit']) {
    fail('Слишком много заявок подряд. Позвоните нам: 8 (920) 171-69-69', 429);
}
file_put_contents($stamp, (string) ($hits + 1));

/* --- откуда пришёл посетитель --- */
$utm = [];
foreach (['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as $k) {
    $v = $clean($data[$k] ?? '', 120);
    if ($v !== '') $utm[$k] = $v;
}
$referrer = $clean($data['referrer'] ?? '', 200);
$landing  = $clean($data['landing'] ?? '', 200);
$device   = device_from_ua((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''));
$place    = place_by_ip($ip);
$source   = source_label($utm, $referrer);

/* --- письмо --- */
$when = date('d.m.Y H:i');
$lines = [
    "Новая заявка с сайта",
    "",
    "Имя:      {$name}",
    "Телефон:  {$phone}",
];
if ($project !== '') $lines[] = "Проект:   {$project}";
if ($message !== '') $lines[] = "Сообщение: {$message}";
$lines[] = "Страница: {$page}";
$lines[] = "Источник: {$source}";
if ($place !== '')    $lines[] = "Откуда:   {$place}";
if ($device !== '')   $lines[] = "Устройство: {$device}";
if ($landing !== '')  $lines[] = "Вошёл на: {$landing}";
if ($referrer !== '') $lines[] = "Ссылался: {$referrer}";
$lines[] = "Время:    {$when}";
$lines[] = "IP:       {$ip}";
$body = implode("\n", $lines);

$from     = $clean($config['from'], 100);
$fromName = $clean($config['from_name'], 60);
$subjRaw  = $clean($config['subject'], 120);
$name_h   = '=?UTF-8?B?' . base64_encode($fromName) . '?=';
$subject  = '=?UTF-8?B?' . base64_encode($subjRaw) . '?=';
$headers = implode("\r\n", [
    "From: {$name_h} <{$from}>",
    "Reply-To: {$from}",
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    'X-Mailer: karkascomfort-site',
]);

/* Два пути отправки. Если в настройках указан почтовый сервер — письмо
   идёт через ящик компании, как из обычной почтовой программы: на VPS нет
   почтовой службы, а письма с нового адреса без подписи попадают в спам.
   Если сервер не указан — остаётся mail(), он работает на обычном хостинге. */
$sent      = false;
$mailError = '';

if (trim((string) ($config['smtp_host'] ?? '')) !== '') {
    require_once __DIR__ . '/smtp.php';
    $out = smtp_send([
        'smtp_host' => $config['smtp_host'],
        'smtp_port' => $config['smtp_port'] ?? 465,
        'smtp_user' => $config['smtp_user'] ?? '',
        'smtp_pass' => $config['smtp_pass'] ?? '',
        'from'      => $from !== '' ? $from : (string) ($config['smtp_user'] ?? ''),
        'from_name' => $fromName,
    ], (string) $config['to'], $subjRaw, $body);
    $sent      = $out['ok'];
    $mailError = $out['error'];
} else {
    foreach (array_map('trim', explode(',', (string) $config['to'])) as $to) {
        if ($to !== '' && filter_var($to, FILTER_VALIDATE_EMAIL)) {
            $sent = mail($to, $subject, $body, $headers, '-f' . $from) || $sent;
        }
    }
    if (!$sent) {
        $mailError = 'mail() не отправил письмо: на сервере нет почтовой службы.'
            . ' Укажите в настройках почтовый сервер (SMTP).';
    }
}
if (!$sent && $mailError !== '') {
    error_log('почта: ' . $mailError);
}

/* --- отправка во внешний сервис: Telegram и CRM --- */
function post_to(string $url, $payload, bool $asJson): bool
{
    if ($url === '' || !function_exists('curl_init')) {
        return false;
    }
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 5,
        CURLOPT_CONNECTTIMEOUT => 3,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_HTTPHEADER     => $asJson ? ['Content-Type: application/json; charset=utf-8'] : [],
        CURLOPT_POSTFIELDS     => $asJson
            ? json_encode($payload, JSON_UNESCAPED_UNICODE)
            : http_build_query($payload),
    ]);
    $ok = curl_exec($ch) !== false && curl_getinfo($ch, CURLINFO_RESPONSE_CODE) < 400;
    curl_close($ch);
    return $ok;
}

/* --- отправка с заголовками: нужна для MAX, где токен идёт
       в заголовке Authorization, а тело — JSON --- */
function post_json(string $url, array $payload, array $headers = []): array
{
    if ($url === '' || !function_exists('curl_init')) {
        return ['ok' => false, 'error' => 'curl недоступен'];
    }
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 8,
        CURLOPT_CONNECTTIMEOUT => 4,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_HTTPHEADER     => array_merge(['Content-Type: application/json; charset=utf-8'], $headers),
        CURLOPT_POSTFIELDS     => json_encode($payload, JSON_UNESCAPED_UNICODE),
    ]);
    /* Серверы MAX подписаны центром Минцифры, которого нет в системном
       списке. Его сертификат лежит отдельным файлом и применяется только
       к max.ru: в общее доверие он не добавлен намеренно. */
    $maxCa = __DIR__ . '/max-ca.pem';
    if (str_contains($url, '.max.ru') && is_file($maxCa)) {
        curl_setopt($ch, CURLOPT_CAINFO, $maxCa);
    }
    $answer = (string) curl_exec($ch);
    $code   = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $error  = curl_error($ch);
    curl_close($ch);
    if ($code >= 200 && $code < 300) return ['ok' => true];
    return ['ok' => false, 'error' => $code ? "ответ $code: " . mb_substr($answer, 0, 200) : $error];
}

/* --- дубль в Telegram, если настроен --- */
$telegram = false;
if (!empty($config['telegram_token']) && !empty($config['telegram_chat_id'])) {
    $telegram = post_to(
        'https://api.telegram.org/bot' . $config['telegram_token'] . '/sendMessage',
        ['chat_id' => $config['telegram_chat_id'], 'text' => $body, 'disable_web_page_preview' => true],
        false
    );
}

/* --- дубль в MAX, если настроен бот ---
   Адресат задаётся либо чатом (chat_id), либо личным диалогом (user_id).
   Токен бота идёт заголовком: передача его в адресе больше не поддерживается.
   Сертификат platform-api2.max.ru выпущен Минцифры, поэтому на сервере
   должен стоять их корневой сертификат — иначе запрос не пройдёт проверку. */
$lead_id = date('Ymd-His') . '-' . substr(md5($digits . $when . random_bytes(4)), 0, 6);

$max = false;
$max_error = '';
if (empty($config['max_token'])) {
    $max_error = 'токен бота MAX не задан';
} elseif (empty($config['max_chat_id']) && empty($config['max_user_id'])) {
    $max_error = 'получатель не выбран: в настройках заявок нет ни чата, ни пользователя';
}
if (!empty($config['max_token']) && (!empty($config['max_chat_id']) || !empty($config['max_user_id']))) {
    $lead_for_card = [
        'id'      => $lead_id,
        'at'      => date('c'),
        'name'    => $name,
        'phone'   => $phone,
        'message' => $message,
        'project' => $project,
        'page'    => $page,
        'source'  => $source,
        'place'   => $place,
        'device'  => $device,
        'test'    => !empty($data['test']),
    ];
    $answer = max_send(
        (string) $config['max_token'],
        ['chat_id' => $config['max_chat_id'] ?? '', 'user_id' => $config['max_user_id'] ?? ''],
        max_lead_card($lead_for_card, 'new'),
        max_lead_buttons($lead_for_card, 'new', (string) ($config['domain'] ?? 'xn--80aa2abbmnbmggrx.xn--p1ai'))
    );
    $max = $answer['ok'];
    $max_error = $answer['ok'] ? '' : (string) ($answer['error'] ?? '');

    /* Идентификатор отправленного сообщения нужен, чтобы потом
       переписать карточку: статус меняется в ней самой, а не
       новой строкой в чате. */
    $mid = (string) ($answer['data']['message']['body']['mid'] ?? '');
    if ($mid !== '') {
        $stateFile = __DIR__ . '/leads-state.json';
        $state = is_file($stateFile)
            ? (json_decode((string) file_get_contents($stateFile), true) ?: [])
            : [];
        $state[$lead_id] = array_merge($state[$lead_id] ?? [], ['max_mid' => $mid]);
        $tmp = $stateFile . '.tmp';
        if (file_put_contents($tmp, json_encode($state, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), LOCK_EX) !== false) {
            @chmod($tmp, 0660);
            rename($tmp, $stateFile);
        }
    }
}

/* --- заявка в CRM, если настроен вебхук --- */
$crm = false;
if (!empty($config['crm_webhook'])) {
    $source = [
        'name'    => $name,
        'phone'   => $phone,
        'message' => $message,
        'project' => $project,
        'page'    => $page,
        'time'    => $when,
        'ip'      => $ip,
    ];
    $payload = [];
    foreach (($config['crm_fields'] ?? []) as $crmField => $leadField) {
        $payload[$crmField] = $source[$leadField] ?? '';
    }
    if (!$payload) {
        $payload = $source;
    }
    $crm = post_to($config['crm_webhook'], $payload, ($config['crm_format'] ?? 'json') === 'json');
}

if (!$max && $max_error !== '') {
    error_log('MAX: ' . $max_error);
}

/* Значение для CSV: Excel и LibreOffice исполняют ячейку, начинающуюся
   с =, +, -, @ или табуляции, как формулу. Заявку присылает кто угодно,
   поэтому такие значения обезвреживаем апострофом. */
function csv_safe(string $value): string
{
    return preg_match('/^[=+\-@\t\r]/', $value) === 1 ? "'" . $value : $value;
}

/* --- заявка в хранилище админки ---
   leads.jsonl: одна заявка — одна строка. Админка показывает их списком,
   ведёт статусы и заметки. Идентификатор нужен, чтобы статус держался
   за конкретной заявкой. */
$record  = [
    'id'      => $lead_id,
    'at'      => date('c'),
    'name'    => $name,
    'phone'   => $phone,
    'message' => $message,
    'project' => $project,
    'page'    => $page,
    'ip'      => $ip,
    'source'  => $source,
    'place'   => $place,
    'device'  => $device,
    'referrer' => $referrer,
    'landing' => $landing,
    'utm'     => $utm,
    'test'    => !empty($data['test']),
    'sent'    => ['mail' => $sent, 'telegram' => $telegram, 'max' => $max, 'crm' => $crm],
    'mail_error' => $sent ? '' : mb_substr($mailError, 0, 300),
    'max_error'  => $max ? '' : mb_substr($max_error, 0, 300),
];
$stored = false;
$jsonl  = @fopen(__DIR__ . '/leads.jsonl', 'a');
if ($jsonl) {
    $line   = json_encode($record, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n";
    $stored = fwrite($jsonl, $line) !== false;
    fclose($jsonl);
}
if (!$stored) {
    error_log('заявка не записана в leads.jsonl: нет прав на запись в api/');
}

/* --- запись в файл: страховка на случай проблем с почтой --- */
if (!empty($config['log_file'])) {
    $fh = @fopen($config['log_file'], 'a');
    if ($fh) {
        if (ftell($fh) === 0) {
            fwrite($fh, "\xEF\xBB\xBF");                       // BOM, чтобы Excel открыл кириллицу
            fputcsv($fh, ['Дата', 'Имя', 'Телефон', 'Проект', 'Сообщение', 'Страница', 'IP', 'Почта', 'Telegram', 'MAX', 'CRM'], ';');
        }
        fputcsv($fh, array_map('csv_safe', [$when, $name, $phone, $project, $message, $page, $ip,
            $sent ? 'да' : 'нет', $telegram ? 'да' : 'нет', $max ? 'да' : 'нет', $crm ? 'да' : 'нет']), ';');
        fclose($fh);
    }
}

/* Заявка в хранилище админки — это и есть доставка: владелец видит её
   в разделе «Сделки», даже когда почта и мессенджер молчат. Поэтому
   отказ посетителю показываем только если не сохранилось вообще нигде.
   Причина отказа почты при этом записана в заявку и в журнал — она
   нужна владельцу, а не человеку, который заполнил форму. */
if (!$stored && !$sent && !$telegram && !$max && !$crm) {
    fail('Заявка не сохранилась. Позвоните, пожалуйста: 8 (920) 171-69-69', 502);
}

/* Каналы перечисляем без текста ошибки: подробности нужны владельцу
   в админке, а не случайному посетителю. Текст лежит в leads.jsonl. */
echo json_encode([
    'ok'   => true,
    'sent' => ['mail' => $sent, 'telegram' => $telegram, 'max' => $max, 'crm' => $crm],
], JSON_UNESCAPED_UNICODE);
