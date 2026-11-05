<?php
/*  Отправка письма через SMTP.
 *
 *  Функция mail() требует почтовой службы на сервере, которой на VPS
 *  нет, а если её поставить — письма с нового адреса уходят в спам:
 *  у него нет ни репутации, ни подписи. Поэтому письма отправляются
 *  через почтовый ящик компании, как из обычной почтовой программы.
 *
 *  Без внешних библиотек: только сокет, как и весь остальной сайт.
 */

declare(strict_types=1);

/**
 * @return array{ok: bool, error: string, log: string[]}
 */
function smtp_send(array $cfg, string $to, string $subject, string $body): array
{
    $host = (string) ($cfg['smtp_host'] ?? '');
    $port = (int)    ($cfg['smtp_port'] ?? 465);
    $user = (string) ($cfg['smtp_user'] ?? '');
    $pass = (string) ($cfg['smtp_pass'] ?? '');
    $from = (string) ($cfg['from'] ?? $user);
    $name = (string) ($cfg['from_name'] ?? 'Сайт');
    $log  = [];

    if ($host === '' || $user === '' || $pass === '') {
        return ['ok' => false, 'error' => 'SMTP не настроен', 'log' => $log];
    }

    /* 465 — шифрование сразу, 587 — обычное соединение и STARTTLS */
    $secure  = $port === 465;
    $address = ($secure ? 'ssl://' : 'tcp://') . $host . ':' . $port;
    $ctx     = stream_context_create(['ssl' => ['verify_peer' => true, 'verify_peer_name' => true]]);
    $fh      = @stream_socket_client($address, $errNo, $errText, 15, STREAM_CLIENT_CONNECT, $ctx);
    if (!$fh) {
        return ['ok' => false, 'error' => "нет связи с $host:$port — $errText", 'log' => $log];
    }
    stream_set_timeout($fh, 15);

    $read = static function () use ($fh, &$log): string {
        $out = '';
        while (($line = fgets($fh, 1024)) !== false) {
            $out .= $line;
            if (strlen($line) < 4 || $line[3] !== '-') break;   // последняя строка ответа
        }
        $log[] = '< ' . trim($out);
        return $out;
    };
    $say = static function (string $cmd, bool $hide = false) use ($fh, &$log, $read): string {
        $log[] = '> ' . ($hide ? '(скрыто)' : trim($cmd));
        fwrite($fh, $cmd . "\r\n");
        return $read();
    };
    $code = static fn(string $answer): int => (int) substr(trim($answer), 0, 3);

    $greeting = $read();
    if ($code($greeting) !== 220) {
        fclose($fh);
        return ['ok' => false, 'error' => 'сервер почты не поздоровался: ' . trim($greeting), 'log' => $log];
    }

    /* EHLO и Message-ID требуют имя домена без порта: с «host:8080»
       настоящий почтовый сервер письмо отбивает. */
    $me = (string) preg_replace('/:\d+$/', '', (string) ($_SERVER['HTTP_HOST'] ?? ''));
    if ($me === '' || !preg_match('/^[a-z0-9.\-]+$/i', $me)) {
        $me = 'localhost';
    }
    $say('EHLO ' . $me);

    if (!$secure) {
        if ($code($say('STARTTLS')) !== 220) {
            fclose($fh);
            return ['ok' => false, 'error' => 'сервер почты не включил шифрование', 'log' => $log];
        }
        if (!stream_socket_enable_crypto($fh, true, STREAM_CRYPTO_METHOD_TLS_CLIENT)) {
            fclose($fh);
            return ['ok' => false, 'error' => 'не удалось установить шифрование', 'log' => $log];
        }
        $say('EHLO ' . $me);
    }

    $say('AUTH LOGIN');
    $say(base64_encode($user), true);
    $authAnswer = $say(base64_encode($pass), true);
    if ($code($authAnswer) !== 235) {
        fclose($fh);
        return [
            'ok'    => false,
            'error' => 'почта не приняла логин или пароль: ' . trim($authAnswer)
                . '. Для Яндекса нужен пароль приложения, обычный от входа не подойдёт.',
            'log'   => $log,
        ];
    }

    if ($code($say('MAIL FROM:<' . $from . '>')) !== 250) {
        fclose($fh);
        return ['ok' => false, 'error' => 'почта не приняла адрес отправителя ' . $from
            . ': он должен совпадать с ящиком, через который идёт отправка', 'log' => $log];
    }

    $recipients = array_values(array_filter(array_map('trim', explode(',', $to))));
    $accepted   = 0;
    foreach ($recipients as $rcpt) {
        if (!filter_var($rcpt, FILTER_VALIDATE_EMAIL)) continue;
        if ($code($say('RCPT TO:<' . $rcpt . '>')) < 300) $accepted++;
    }
    if ($accepted === 0) {
        fclose($fh);
        return ['ok' => false, 'error' => 'ни один адрес получателя не принят', 'log' => $log];
    }

    if ($code($say('DATA')) !== 354) {
        fclose($fh);
        return ['ok' => false, 'error' => 'почта не приняла команду отправки', 'log' => $log];
    }

    $headers = [
        'From: =?UTF-8?B?' . base64_encode($name) . '?= <' . $from . '>',
        'To: ' . implode(', ', $recipients),
        'Subject: =?UTF-8?B?' . base64_encode($subject) . '?=',
        'Date: ' . date('r'),
        'Message-ID: <' . bin2hex(random_bytes(12)) . '@' . $me . '>',
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: base64',
    ];
    /* Точка в начале строки завершает письмо — удваиваем её.
       base64 этого избегает, но заголовки собираем аккуратно. */
    $message = implode("\r\n", $headers) . "\r\n\r\n" . chunk_split(base64_encode($body), 76, "\r\n");
    fwrite($fh, $message . "\r\n.\r\n");
    $log[] = '> (письмо, ' . strlen($body) . ' байт)';
    $sent = $read();

    $say('QUIT');
    fclose($fh);

    return $code($sent) === 250
        ? ['ok' => true, 'error' => '', 'log' => $log]
        : ['ok' => false, 'error' => 'письмо не принято: ' . trim($sent), 'log' => $log];
}
