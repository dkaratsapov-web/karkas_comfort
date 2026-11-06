<?php
/*  Работа с ботом MAX: отправка, правка, ответы на нажатия.
 *
 *  Одним кодом пользуются и приём заявок (lead.php), и бот
 *  (max-bot.php), и админка. Токен лежит в settings.json на сервере
 *  и в репозиторий не попадает.
 *
 *  Сертификат MAX выпущен Минцифры, которого нет в системном списке:
 *  корневой лежит рядом файлом max-ca.pem и применяется только здесь.
 */

declare(strict_types=1);

const MAX_API = 'https://platform-api2.max.ru';

/* ---------- запрос к MAX ---------- */

function max_call(string $token, string $method, string $path, array $query = [], ?array $body = null): array
{
    if ($token === '' || !function_exists('curl_init')) {
        return ['ok' => false, 'code' => 0, 'error' => 'нет токена или curl', 'data' => []];
    }

    $url = MAX_API . $path . ($query ? '?' . http_build_query($query) : '');
    $ch  = curl_init($url);
    $opt = [
        CURLOPT_CUSTOMREQUEST  => $method,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 15,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_HTTPHEADER     => [
            'Authorization: ' . $token,
            'Content-Type: application/json; charset=utf-8',
        ],
    ];
    if ($body !== null) {
        $opt[CURLOPT_POSTFIELDS] = json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }
    $ca = __DIR__ . '/max-ca.pem';
    if (is_file($ca)) $opt[CURLOPT_CAINFO] = $ca;

    curl_setopt_array($ch, $opt);
    $answer = (string) curl_exec($ch);
    $code   = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $err    = curl_error($ch);
    curl_close($ch);

    $data = json_decode($answer, true);
    if (!is_array($data)) $data = [];

    if ($code >= 200 && $code < 300) {
        return ['ok' => true, 'code' => $code, 'error' => '', 'data' => $data];
    }
    /* MAX возвращает понятный текст ошибки — показываем его как есть:
       «токен не тот» полезнее, чем «код 401». */
    $text = (string) ($data['message'] ?? $data['error'] ?? mb_substr(strip_tags($answer), 0, 300));
    if ($code === 0) $text = $err !== '' ? $err : 'нет связи с MAX';
    if ($code === 401) $text = 'MAX не принял токен бота';
    if ($code === 404 && str_contains($path, '/messages')) $text = 'MAX не нашёл получателя: проверьте идентификатор чата';
    return ['ok' => false, 'code' => $code, 'error' => $text, 'data' => $data];
}

/* ---------- отправка ---------- */

/** Отправляет сообщение в чат или личный диалог. */
function max_send(string $token, array $to, string $text, array $buttons = []): array
{
    $query = [];
    if (!empty($to['chat_id'])) $query['chat_id'] = (string) $to['chat_id'];
    elseif (!empty($to['user_id'])) $query['user_id'] = (string) $to['user_id'];
    else return ['ok' => false, 'code' => 0, 'error' => 'не задан получатель', 'data' => []];

    $body = ['text' => mb_substr($text, 0, 4000), 'notify' => true];
    if ($buttons) $body['attachments'] = [max_keyboard($buttons)];

    return max_call($token, 'POST', '/messages', $query, $body);
}

/** Переписывает уже отправленное сообщение: так карточка заявки
 *  показывает текущий статус, а не копится лентой ответов. */
function max_edit(string $token, string $messageId, string $text, array $buttons = []): array
{
    $body = ['text' => mb_substr($text, 0, 4000)];
    $body['attachments'] = $buttons ? [max_keyboard($buttons)] : [];
    return max_call($token, 'PUT', '/messages', ['message_id' => $messageId], $body);
}

/** Ответ на нажатие кнопки. В ответе можно переписать само сообщение —
 *  так карточка заявки показывает новый статус вместо ленты ответов.
 *  Поля для всплывающего уведомления в API нет, поэтому итог нажатия
 *  пишем прямо в текст карточки. */
function max_answer(string $token, string $callbackId, ?string $newText = null, array $buttons = []): array
{
    $body = [];
    if ($newText !== null) {
        $body['message'] = [
            'text'        => mb_substr($newText, 0, 4000),
            'attachments' => $buttons ? [max_keyboard($buttons)] : [],
        ];
    }
    return max_call($token, 'POST', '/answers', ['callback_id' => $callbackId], $body);
}

/** Клавиатура под сообщением.
 *  Кнопки задаём рядами: [[['Текст','payload'], …], …]
 *  Ссылка — ['Текст', null, 'https://…'] */
function max_keyboard(array $rows): array
{
    $out = [];
    foreach ($rows as $row) {
        $line = [];
        foreach (array_slice($row, 0, 7) as $btn) {
            [$text, $payload, $url] = array_pad((array) $btn, 3, null);
            $line[] = $url
                ? ['type' => 'link', 'text' => (string) $text, 'url' => (string) $url]
                : ['type' => 'callback', 'text' => (string) $text, 'payload' => mb_substr((string) $payload, 0, 1000)];
        }
        if ($line) $out[] = $line;
    }
    return ['type' => 'inline_keyboard', 'payload' => ['buttons' => $out]];
}

/* ---------- события ---------- */

/** Подписка на события: MAX будет слать их на наш адрес. */
function max_subscribe(string $token, string $url, string $secret, array $types = []): array
{
    $body = ['url' => $url];
    if ($secret !== '') $body['secret'] = $secret;
    if ($types)         $body['update_types'] = $types;
    return max_call($token, 'POST', '/subscriptions', [], $body);
}

function max_subscriptions(string $token): array
{
    return max_call($token, 'GET', '/subscriptions');
}

function max_unsubscribe(string $token, string $url): array
{
    return max_call($token, 'DELETE', '/subscriptions', ['url' => $url]);
}

/** Последние события по опросу — запасной путь, когда вебхук
 *  недоступен: по ним находится идентификатор чата. */
function max_updates(string $token, int $limit = 50): array
{
    return max_call($token, 'GET', '/updates', ['limit' => $limit, 'timeout' => 0]);
}

/** Сведения о самом боте: имя и идентификатор. Заодно проверяет токен. */
/* ---------- чаты ----------
   Общего списка чатов у MAX с июня 2026 нет: остался только запрос
   одного чата по идентификатору. Идентификаторы бот запоминает сам
   из событий, а названия события не приносят — поэтому названия
   дочитываем здесь, иначе в админке видны одни номера. */

/** Один чат или канал по идентификатору. */
function max_chat(string $token, string $chatId): array
{
    return max_call($token, 'GET', '/chats/' . rawurlencode($chatId));
}

/** Запись для max-chats.json из ответа MAX, поверх прежней. */
function max_chat_row(array $data, array $old = []): array
{
    $title = trim((string) ($data['title'] ?? ''));
    if ($title === '' && !empty($data['dialog_with_user']) && is_array($data['dialog_with_user'])) {
        $u = $data['dialog_with_user'];
        $title = trim((string) ($u['name'] ?? trim((string) ($u['first_name'] ?? '') . ' ' . (string) ($u['last_name'] ?? ''))));
    }
    $kind = (string) ($data['type'] ?? '');
    return array_merge($old, [
        'chat_id' => (string) ($data['chat_id'] ?? ($old['chat_id'] ?? '')),
        'title'   => $title !== '' ? $title : (string) ($old['title'] ?? ''),
        'kind'    => $kind !== '' ? $kind : (string) ($old['kind'] ?? 'chat'),
        'status'  => (string) ($data['status'] ?? ($old['status'] ?? '')),
        'people'  => (int) ($data['participants_count'] ?? ($old['people'] ?? 0)),
        'seen'    => date('c'),
    ]);
}

/** Как чат называется в списках: название, вид и номер. Номер
 *  оставляем — по нему чат можно сверить в самом MAX. */
function max_chat_label(array $chat): string
{
    $kinds = ['chat' => 'чат', 'channel' => 'канал', 'dialog' => 'личный диалог'];
    $title = trim((string) ($chat['title'] ?? ''));
    $kind  = $kinds[(string) ($chat['kind'] ?? '')] ?? 'чат';
    return ($title !== '' ? $title . ' · ' . $kind : 'без названия · ' . $kind)
        . ' · ' . (string) ($chat['chat_id'] ?? '');
}

/** Дочитывает названия известных чатов. Чат, из которого бота убрали,
 *  из списка пропадает: предлагать его получателем заявок незачем. */
function max_chats_refresh(string $token, array $chats): array
{
    foreach (array_keys($chats) as $id) {
        $old = is_array($chats[$id]) ? $chats[$id] : [];
        $r   = max_chat($token, (string) $id);
        if (!$r['ok']) continue;          /* диалог или недоступен — оставляем как есть */
        $row = max_chat_row($r['data'], $old);
        if (in_array($row['status'], ['removed', 'left', 'closed'], true)) {
            unset($chats[$id]);
            continue;
        }
        $chats[$id] = $row;
    }
    return $chats;
}

function max_me(string $token): array
{
    return max_call($token, 'GET', '/me');
}
