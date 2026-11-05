<?php
/*  Сделки: всё, что пришло с сайта, и что с этим делают дальше.
 *
 *  Главный экран кабинета. Наверху — что требует внимания сегодня,
 *  ниже воронка по этапам и список сделок. Подробности и история —
 *  в карточке сделки (deal.php).
 */

declare(strict_types=1);
require __DIR__ . '/_boot.php';
require __DIR__ . '/crm.php';

session_boot();
csrf_check();

/* ---------- вход ---------- */
$users = users_load();
if (!$users) {
    /* Учётных записей нет вовсе: заводим первую по коду установки,
       который лежит файлом на сервере. */
    require __DIR__ . '/setup.php';
    exit;
}

$user = current_user();
if (!$user) {
    require __DIR__ . '/login.php';
    exit;
}

/* ---------- быстрые действия из списка ---------- */
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST' && post('action') === 'stage') {
    $id    = post('id', 80);
    $stage = crm_stage(post('stage', 20));
    if ($id !== '') {
        crm_update($id, ['status' => $stage], (string) $user['login'], 'этап: ' . crm_stage_name($stage));
        flash('Этап обновлён: ' . crm_stage_name($stage));
    }
    redirect('/admin/' . ($_SERVER['QUERY_STRING'] ? '?' . $_SERVER['QUERY_STRING'] : ''));
}

$deals = crm_deals();

/* ---------- выгрузка ---------- */
if (($_GET['export'] ?? '') === 'csv') {
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="sdelki-' . date('Y-m-d') . '.csv"');
    $out = fopen('php://output', 'w');
    fwrite($out, "\xEF\xBB\xBF");
    fputcsv($out, ['Дата', 'Имя', 'Телефон', 'Проект', 'Источник', 'Этап', 'Ответственный', 'Сумма', 'Следующий шаг', 'Когда', 'Сообщение'], ';');
    foreach ($deals as $d) {
        fputcsv($out, [
            $d['at'] ?? '', $d['name'] ?? '', $d['phone'] ?? '', $d['project'] ?? '',
            $d['source'], crm_stage_name($d['stage']), $d['owner'], $d['amount'] ?: '',
            $d['next_what'], $d['next_at'], $d['message'] ?? '',
        ], ';');
    }
    exit;
}

/* ---------- отбор ---------- */
$q     = mb_strtolower(trim((string) ($_GET['q'] ?? '')));
$stage = (string) ($_GET['stage'] ?? '');
$mine  = ($_GET['mine'] ?? '') === '1';
$view  = ($_GET['view'] ?? 'list') === 'board' ? 'board' : 'list';

$counts = ['all' => 0];
foreach (array_keys(CRM_STAGES) as $code) $counts[$code] = 0;
foreach ($deals as $d) { $counts['all']++; $counts[$d['stage']]++; }

$shown = array_filter($deals, static function (array $d) use ($q, $stage, $mine, $user) {
    if ($stage !== '' && $d['stage'] !== $stage) return false;
    if ($mine && $d['owner'] !== (string) $user['login']) return false;
    if ($q === '') return true;
    $hay = mb_strtolower(implode(' ', [
        $d['name'] ?? '', $d['phone'] ?? '', $d['project'] ?? '', $d['message'] ?? '',
        $d['next_what'], $d['owner'], $d['source'],
    ]));
    return str_contains($hay, $q);
});

$sum = crm_summary($deals);

/* ---------- вывод ---------- */
layout_head('Сделки', $user, 'index.php');
flash_show();

$link = static function (array $params): string {
    $now = array_filter(array_merge($_GET, $params), static fn($v) => $v !== '' && $v !== null);
    return '/admin/' . ($now ? '?' . http_build_query($now) : '');
};

echo '<div class="head"><h1>Сделки</h1>';
echo '<form class="search" method="get">';
if ($stage !== '') echo '<input type="hidden" name="stage" value="' . h($stage) . '">';
if ($mine)         echo '<input type="hidden" name="mine" value="1">';
echo '<input name="q" value="' . h((string) ($_GET['q'] ?? '')) . '" placeholder="Имя, телефон, проект" aria-label="Поиск по сделкам">';
echo '<button class="btn" type="submit">Найти</button>';
echo '<a class="btn btn--ghost" href="' . h($link(['export' => 'csv'])) . '">Выгрузить CSV</a>';
echo '</form></div>';

/* Сводка: сначала то, из-за чего теряются деньги — просроченные
   и сегодняшние шаги, потом объём работы. */
echo '<div class="tiles">';
$tiles = [
    ['Просрочено',  $sum['overdue'], $sum['overdue'] > 0 ? 'bad' : '',  'Шаг назначен на прошедшую дату'],
    ['На сегодня',  $sum['today'],   $sum['today'] > 0 ? 'warn' : '',   'Что сделать сегодня'],
    ['В работе',    $sum['open'],    '',                                'Сделки, которые не закрыты'],
    ['Сумма в работе', crm_money($sum['money']), '',                    'Сколько денег в открытых сделках'],
    ['Выиграно',    $sum['won'],     'good',                            'Объекты сданы'],
];
foreach ($tiles as [$label, $value, $kind, $hint]) {
    echo '<div class="tile' . ($kind ? ' tile--' . $kind : '') . '" title="' . h($hint) . '">'
        . '<div class="tile__value">' . h((string) $value) . '</div>'
        . '<div class="tile__label">' . h($label) . '</div></div>';
}
echo '</div>';

/* Воронка: этапы по порядку работы, с количеством в каждом. */
echo '<div class="chips">';
echo '<a class="chip' . ($stage === '' ? ' is-on' : '') . '" href="' . h($link(['stage' => null])) . '">Все <b>' . $counts['all'] . '</b></a>';
foreach (CRM_STAGES as $code => [$label, $hint]) {
    $on = $stage === $code ? ' is-on' : '';
    echo '<a class="chip chip--' . h($code) . $on . '" href="' . h($link(['stage' => $code])) . '" title="' . h($hint) . '">'
        . h($label) . ' <b>' . $counts[$code] . '</b></a>';
}
echo '<a class="chip' . ($mine ? ' is-on' : '') . '" href="' . h($link(['mine' => $mine ? null : '1'])) . '">Мои</a>';
echo '</div>';

if (!$shown) {
    echo '<div class="card"><p class="muted">Здесь пусто. Как только с сайта придёт заявка, она появится в этом списке.</p></div>';
    layout_foot();
    exit;
}

foreach ($shown as $id => $d) {
    $closed  = in_array($d['stage'], CRM_CLOSED, true);
    $overdue = !$closed && crm_overdue($d['next_at']);
    echo '<article class="deal deal--' . h($d['stage']) . ($overdue ? ' is-overdue' : '') . '">';

    echo '<div class="deal__top">';
    echo '<a class="deal__name" href="/admin/deal.php?id=' . h(rawurlencode($id)) . '">' . h($d['name'] ?: 'Без имени') . '</a>';
    echo '<span class="deal__stage">' . h(crm_stage_name($d['stage'])) . '</span>';
    echo '<time class="deal__time">' . h(date('d.m.Y H:i', strtotime((string) ($d['at'] ?? 'now')))) . '</time>';
    echo '</div>';

    echo '<div class="deal__facts">';
    if (!empty($d['phone'])) echo '<a class="deal__phone" href="tel:' . h(preg_replace('/\D+/', '', $d['phone'])) . '">' . h($d['phone']) . '</a>';
    if (!empty($d['project'])) echo '<span>Проект: ' . h($d['project']) . '</span>';
    echo '<span>Источник: ' . h($d['source']) . '</span>';
    if ($d['amount'] > 0) echo '<span>Сумма: ' . h(crm_money($d['amount'])) . '</span>';
    if ($d['owner'] !== '') echo '<span>Ведёт: ' . h($d['owner']) . '</span>';
    echo '</div>';

    if (!empty($d['message'])) echo '<p class="deal__message">' . h($d['message']) . '</p>';

    if ($d['next_at'] !== '' && !$closed) {
        echo '<p class="deal__next' . ($overdue ? ' is-overdue' : '') . '">'
            . ($overdue ? 'Просрочено: ' : 'Следующий шаг: ')
            . h(date('d.m.Y', strtotime($d['next_at'])))
            . ($d['next_what'] !== '' ? ' — ' . h($d['next_what']) : '') . '</p>';
    }

    /* Этап меняется прямо из списка: это самое частое действие,
       ради него незачем открывать карточку. */
    echo '<form class="deal__form" method="post">' . csrf_field();
    echo '<input type="hidden" name="action" value="stage"><input type="hidden" name="id" value="' . h($id) . '">';
    echo '<select name="stage" aria-label="Этап сделки">';
    foreach (CRM_STAGES as $code => [$label]) {
        echo '<option value="' . h($code) . '"' . ($code === $d['stage'] ? ' selected' : '') . '>' . h($label) . '</option>';
    }
    echo '</select><button class="btn" type="submit">Сохранить</button>';
    echo '<a class="btn btn--ghost" href="/admin/deal.php?id=' . h(rawurlencode($id)) . '">Открыть</a>';
    echo '</form>';

    echo '</article>';
}

layout_foot();
