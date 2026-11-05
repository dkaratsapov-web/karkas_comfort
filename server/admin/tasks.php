<?php
/*  Задачи: что сделать и когда.
 *
 *  Отдельного списка задач нет намеренно — задача это следующий шаг
 *  по сделке. Так нельзя «закрыть задачу» и забыть сделку, и наоборот:
 *  сделка без шага сразу видна в конце страницы.
 */

declare(strict_types=1);
require __DIR__ . '/_boot.php';
require __DIR__ . '/crm.php';

session_boot();
csrf_check();
$user = require_login();

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    $id = post('id', 80);
    if ($id !== '' && post('action') === 'done') {
        /* Шаг сделан: снимаем дату, чтобы задача ушла из списка,
           а сама сделка осталась на своём этапе. */
        crm_update($id, ['next_at' => '', 'next_what' => ''], (string) $user['login'], 'шаг выполнен');
        flash('Шаг отмечен выполненным. Поставьте следующий, чтобы сделка не потерялась.');
    }
    if ($id !== '' && post('action') === 'move') {
        $days = max(1, min(60, (int) post('days', 3)));
        $when = date('Y-m-d', strtotime('+' . $days . ' days'));
        crm_update($id, ['next_at' => $when], (string) $user['login'], 'перенос на ' . $when);
        flash('Перенесено на ' . date('d.m.Y', strtotime($when)));
    }
    redirect('/admin/tasks.php' . ($_SERVER['QUERY_STRING'] ? '?' . $_SERVER['QUERY_STRING'] : ''));
}

$deals = crm_deals();
$mine  = ($_GET['mine'] ?? '') === '1';
$tasks = crm_tasks($deals);
if ($mine) $tasks = array_filter($tasks, static fn($d) => $d['owner'] === (string) $user['login']);

/* Сделки в работе, по которым шаг не назначен: самая частая причина
   потерянных денег — про заявку просто забыли. */
$noPlan = array_filter($deals, static fn($d) => $d['next_at'] === '' && !in_array($d['stage'], CRM_CLOSED, true));

layout_head('Задачи', $user, 'tasks.php');
flash_show();

echo '<div class="head"><h1>Задачи</h1>';
echo '<p class="muted">' . ($mine ? '<a href="/admin/tasks.php">Показать все</a>' : '<a href="/admin/tasks.php?mine=1">Только мои</a>') . '</p></div>';

$groups = ['Просрочено' => [], 'Сегодня' => [], 'Завтра' => [], 'Дальше' => []];
foreach ($tasks as $id => $d) {
    $when = $d['next_at'];
    if (crm_overdue($when))                              $groups['Просрочено'][$id] = $d;
    elseif ($when === date('Y-m-d'))                     $groups['Сегодня'][$id]    = $d;
    elseif ($when === date('Y-m-d', strtotime('+1 day'))) $groups['Завтра'][$id]     = $d;
    else                                                  $groups['Дальше'][$id]     = $d;
}

$card = static function (string $id, array $d): void {
    echo '<article class="deal' . (crm_overdue($d['next_at']) ? ' is-overdue' : '') . '">';
    echo '<div class="deal__top">';
    echo '<a class="deal__name" href="/admin/deal.php?id=' . h(rawurlencode($id)) . '">' . h($d['name'] ?: 'Без имени') . '</a>';
    echo '<span class="deal__stage">' . h(crm_stage_name($d['stage'])) . '</span>';
    echo '<time class="deal__time">' . h(date('d.m.Y', strtotime($d['next_at']))) . '</time>';
    echo '</div>';
    echo '<p class="deal__next">' . h($d['next_what'] !== '' ? $d['next_what'] : 'Шаг без описания') . '</p>';
    echo '<div class="deal__facts">';
    if (!empty($d['phone'])) echo '<a class="deal__phone" href="tel:' . h(preg_replace('/\D+/', '', $d['phone'])) . '">' . h($d['phone']) . '</a>';
    if ($d['owner'] !== '')  echo '<span>Ведёт: ' . h($d['owner']) . '</span>';
    echo '</div>';
    echo '<form class="deal__form" method="post">' . csrf_field();
    echo '<input type="hidden" name="id" value="' . h($id) . '">';
    echo '<button class="btn" type="submit" name="action" value="done">Сделано</button>';
    echo '<button class="btn btn--ghost" type="submit" name="action" value="move">Перенести на 3 дня</button>';
    echo '<input type="hidden" name="days" value="3">';
    echo '<a class="btn btn--ghost" href="/admin/deal.php?id=' . h(rawurlencode($id)) . '">Открыть</a>';
    echo '</form></article>';
};

$any = false;
foreach ($groups as $title => $rows) {
    if (!$rows) continue;
    $any = true;
    echo '<h2 class="group' . ($title === 'Просрочено' ? ' group--bad' : '') . '">' . h($title) . ' <span class="count">' . count($rows) . '</span></h2>';
    foreach ($rows as $id => $d) $card($id, $d);
}
if (!$any) {
    echo '<div class="card"><p class="muted">Назначенных шагов нет. Откройте сделку и поставьте дату следующего действия — она появится здесь.</p></div>';
}

if ($noPlan) {
    echo '<h2 class="group group--warn">Без следующего шага <span class="count">' . count($noPlan) . '</span></h2>';
    echo '<p class="muted lead-text">Эти сделки в работе, но что делать дальше — не записано. Чаще всего теряются именно они.</p>';
    foreach ($noPlan as $id => $d) {
        echo '<article class="deal"><div class="deal__top">';
        echo '<a class="deal__name" href="/admin/deal.php?id=' . h(rawurlencode($id)) . '">' . h($d['name'] ?: 'Без имени') . '</a>';
        echo '<span class="deal__stage">' . h(crm_stage_name($d['stage'])) . '</span>';
        echo '<time class="deal__time">' . h(date('d.m.Y', strtotime((string) ($d['at'] ?? 'now')))) . '</time>';
        echo '</div><div class="deal__facts">';
        if (!empty($d['phone'])) echo '<a class="deal__phone" href="tel:' . h(preg_replace('/\D+/', '', $d['phone'])) . '">' . h($d['phone']) . '</a>';
        echo '<a href="/admin/deal.php?id=' . h(rawurlencode($id)) . '">Назначить шаг</a>';
        echo '</div></article>';
    }
}

layout_foot();
