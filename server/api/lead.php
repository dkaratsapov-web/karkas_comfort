<?php
/*  Приём заявок с форм сайта.
    Ожидает POST c JSON: { name, phone, message, project, consent, page }
    Отвечает JSON: { ok: true } либо { ok: false, error: "…" }          */

declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');

$config = require __DIR__ . '/config.php';

function fail(string $message, int $code = 400)
{
    http_response_code($code);
    echo json_encode(['ok' => false, 'error' => $message], JSON_UNESCAPED_UNICODE);
    exit;
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
    echo json_encode(['ok' => true], JSON_UNESCAPED_UNICODE);   // боту показываем успех
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
$lines[] = "Время:    {$when}";
$lines[] = "IP:       {$ip}";
$body = implode("\n", $lines);

$from    = $clean($config['from'], 100);
$name_h  = '=?UTF-8?B?' . base64_encode($clean($config['from_name'], 60)) . '?=';
$subject = '=?UTF-8?B?' . base64_encode($clean($config['subject'], 120)) . '?=';
$headers = implode("\r\n", [
    "From: {$name_h} <{$from}>",
    "Reply-To: {$from}",
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    'X-Mailer: karkascomfort-site',
]);

$sent = false;
foreach (array_map('trim', explode(',', (string) $config['to'])) as $to) {
    if ($to !== '' && filter_var($to, FILTER_VALIDATE_EMAIL)) {
        $sent = mail($to, $subject, $body, $headers, '-f' . $from) || $sent;
    }
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

/* --- дубль в Telegram, если настроен --- */
$telegram = false;
if (!empty($config['telegram_token']) && !empty($config['telegram_chat_id'])) {
    $telegram = post_to(
        'https://api.telegram.org/bot' . $config['telegram_token'] . '/sendMessage',
        ['chat_id' => $config['telegram_chat_id'], 'text' => $body, 'disable_web_page_preview' => true],
        false
    );
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

/* Значение для CSV: Excel и LibreOffice исполняют ячейку, начинающуюся
   с =, +, -, @ или табуляции, как формулу. Заявку присылает кто угодно,
   поэтому такие значения обезвреживаем апострофом. */
function csv_safe(string $value): string
{
    return preg_match('/^[=+\-@\t\r]/', $value) === 1 ? "'" . $value : $value;
}

/* --- запись в файл: страховка на случай проблем с почтой --- */
if (!empty($config['log_file'])) {
    $fh = @fopen($config['log_file'], 'a');
    if ($fh) {
        if (ftell($fh) === 0) {
            fwrite($fh, "\xEF\xBB\xBF");                       // BOM, чтобы Excel открыл кириллицу
            fputcsv($fh, ['Дата', 'Имя', 'Телефон', 'Проект', 'Сообщение', 'Страница', 'IP', 'Почта', 'Telegram', 'CRM'], ';');
        }
        fputcsv($fh, array_map('csv_safe', [$when, $name, $phone, $project, $message, $page, $ip,
            $sent ? 'да' : 'нет', $telegram ? 'да' : 'нет', $crm ? 'да' : 'нет']), ';');
        fclose($fh);
    }
}

if (!$sent && !$telegram && !$crm) {
    /* ни один канал не принял заявку: она записана в CSV, но человеку об этом знать нужно */
    fail('Заявка сохранена, но письмо менеджеру не ушло. Позвоните, пожалуйста: 8 (920) 171-69-69', 502);
}

echo json_encode(['ok' => true], JSON_UNESCAPED_UNICODE);
