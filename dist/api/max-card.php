<?php
/*  Карточка заявки в MAX: текст и кнопки.
 *
 *  Общая для сайта и бота: заявку рисует lead.php, а перерисовывает
 *  после нажатия max-bot.php. Если бы каждый делал это по-своему,
 *  после первого же нажатия карточка меняла бы вид.
 */

declare(strict_types=1);

/* Те же статусы, что в админке: бот и админка правят одно и то же. */
const MAX_STATUSES = [
    'new'  => 'Новая',
    'work' => 'В работе',
    'meet' => 'Встреча',
    'deal' => 'Договор',
    'lost' => 'Отказ',
];

/** Текст карточки. Статус пишем в текст: всплывающих уведомлений
 *  в MAX нет, иначе нажавший не увидел бы, что действие сработало. */
function max_lead_card(array $lead, string $status = 'new', string $who = ''): string
{
    $lines = [empty($lead['test']) ? 'Заявка с сайта' : 'Проверка связи (тестовая заявка)', ''];
    $lines[] = 'Имя: ' . ($lead['name'] ?? '—');
    $lines[] = 'Телефон: ' . ($lead['phone'] ?? '—');
    if (!empty($lead['project'])) $lines[] = 'Проект: ' . $lead['project'];
    if (!empty($lead['message'])) $lines[] = 'Сообщение: ' . $lead['message'];
    if (!empty($lead['page']))    $lines[] = 'Страница: ' . $lead['page'];
    $lines[] = 'Время: ' . (!empty($lead['at'])
        ? date('d.m.Y H:i', strtotime((string) $lead['at']))
        : date('d.m.Y H:i'));
    $lines[] = '';
    $lines[] = 'Статус: ' . (MAX_STATUSES[$status] ?? $status) . ($who !== '' ? ' — ' . $who : '');
    return implode("\n", $lines);
}

/** Кнопки под карточкой. Текущий статус не повторяем: нажимать
 *  «В работе» на заявке, которая уже в работе, незачем. */
function max_lead_buttons(array $lead, string $status, string $domain = ''): array
{
    $id    = (string) ($lead['id'] ?? '');
    $rows  = [];
    $moves = [];
    foreach (['work' => 'В работу', 'meet' => 'Встреча', 'deal' => 'Договор', 'lost' => 'Отказ'] as $code => $label) {
        if ($code !== $status) $moves[] = [$label, 'st:' . $code . ':' . $id];
    }
    foreach (array_chunk($moves, 2) as $pair) $rows[] = $pair;   // по две в ряд: подписи влезают целиком

    $digits = preg_replace('/\D+/', '', (string) ($lead['phone'] ?? '')) ?? '';
    $last   = [];
    if (strlen($digits) >= 11) $last[] = ['Позвонить', null, 'tel:+' . $digits];
    if ($domain !== '')        $last[] = ['Открыть в админке', null, 'https://' . $domain . '/admin/?lead=' . rawurlencode($id)];
    if ($last) $rows[] = $last;   // ссылок в ряду допускается до трёх

    return $rows;
}
