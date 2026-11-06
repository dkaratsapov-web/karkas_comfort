<?php
/*  Карточка сделки.
 *
 *  Здесь собрано всё по одному клиенту: что он просил, на каком этапе
 *  разговор, что за объект, сколько денег, кто ведёт, что сделать
 *  дальше и что уже было. Заявка с сайта остаётся неизменной —
 *  правки живут рядом, поэтому исходное обращение всегда видно.
 */

declare(strict_types=1);
require __DIR__ . '/_boot.php';
require __DIR__ . '/crm.php';

session_boot();
csrf_check();
$user = require_login();

$id    = (string) ($_GET['id'] ?? post('id', 80));
$deals = crm_deals();
$wasDeleted = false;
if ($id !== '' && !isset($deals[$id])) {
    $binned = crm_deals(true);
    if (isset($binned[$id])) { $deals[$id] = $binned[$id]; $wasDeleted = true; }
}
if ($id === '' || !isset($deals[$id])) {
    layout_head('Сделка не найдена', $user, 'index.php');
    echo '<div class="card"><h1>Сделка не найдена</h1><p class="muted">Возможно, её удалили. <a href="/admin/">Вернуться к списку</a>.</p></div>';
    layout_foot();
    exit;
}

/* ---------- сохранение ---------- */
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    $was  = $deals[$id];
    $by   = (string) $user['login'];
    $what = [];

    if (post('action') === 'del') {
        crm_delete($id, $by);
        flash('Сделка удалена. Её можно вернуть на этой же странице.');
        redirect('/admin/deal.php?id=' . rawurlencode($id));
    }

    if (post('action') === 'restore') {
        crm_restore($id, $by);
        flash('Сделка возвращена в работу.');
        redirect('/admin/deal.php?id=' . rawurlencode($id));
    }

    /* Контакт правится отдельно от сделки: в заявке бывает опечатка
       в имени или телефоне, а исходную запись трогать нельзя —
       правка ложится рядом, поверх неё. */
    if (post('action') === 'contact') {
        $patch = [
            'name'    => post('c_name', 120),
            'phone'   => post('c_phone', 40),
            'message' => post('c_message', 2000),
        ];
        $changed = [];
        foreach ($patch as $field => $value) {
            if ((string) $value !== (string) ($was[$field] ?? '')) $changed[] = $field;
        }
        crm_update($id, $patch, $by, $changed ? 'правка контакта: ' . implode(', ', $changed) : '');
        flash($changed ? 'Контакт изменён.' : 'Изменений нет.');
        redirect('/admin/deal.php?id=' . rawurlencode($id));
    }

    if (post('action') === 'note') {
        $text = post('note', 2000);
        if ($text !== '') {
            crm_note($id, $text, $by);
            flash('Заметка добавлена.');
        }
        redirect('/admin/deal.php?id=' . rawurlencode($id));
    }

    $stage = crm_stage(post('stage', 20));
    $patch = [
        'status'    => $stage,
        'owner'     => post('owner', 40),
        'amount'    => max(0, (int) preg_replace('/\D+/', '', post('amount', 20))),
        'next_at'   => preg_match('/^\d{4}-\d{2}-\d{2}$/', post('next_at', 10)) ? post('next_at', 10) : '',
        'next_what' => post('next_what', 200),
        'object'    => [
            'project'    => post('o_project', 120),
            'area'       => post('o_area', 20),
            'floors'     => post('o_floors', 20),
            'foundation' => post('o_foundation', 60),
            'plot'       => post('o_plot', 200),
            'start'      => post('o_start', 60),
        ],
    ];

    if ($stage !== $was['stage'])                 $what[] = 'этап: ' . crm_stage_name($stage);
    if ($patch['owner'] !== $was['owner'])        $what[] = 'ведёт: ' . ($patch['owner'] ?: 'никто');
    if ($patch['amount'] !== (int) $was['amount']) $what[] = 'сумма: ' . crm_money($patch['amount']);
    if ($patch['next_at'] !== $was['next_at'] || $patch['next_what'] !== $was['next_what']) {
        $what[] = 'следующий шаг: ' . ($patch['next_at'] ?: 'не назначен')
            . ($patch['next_what'] !== '' ? ' — ' . $patch['next_what'] : '');
    }
    if ($patch['object'] !== $was['object'])      $what[] = 'данные объекта';

    crm_update($id, $patch, $by, implode(', ', $what));
    flash($what ? 'Сохранено: ' . implode(', ', $what) : 'Изменений нет.');
    redirect('/admin/deal.php?id=' . rawurlencode($id));
}

$d   = $deals[$id];
$obj = $d['object'] + ['project' => '', 'area' => '', 'floors' => '', 'foundation' => '', 'plot' => '', 'start' => ''];

/* Прошлые обращения того же человека: разговор начинается не с нуля. */
$people = crm_people($deals);
$digits = preg_replace('/\D+/', '', (string) ($d['phone'] ?? '')) ?? '';
$person = strlen($digits) >= 10 ? ($people[substr($digits, -10)] ?? null) : null;

layout_head($d['name'] ?: 'Сделка', $user, 'index.php');
flash_show();

echo '<p class="crumbs"><a href="/admin/">← Все сделки</a></p>';
echo '<div class="head"><h1>' . h($d['name'] ?: 'Без имени') . '</h1>';
echo '<span class="deal__stage deal__stage--big">' . h(crm_stage_name($d['stage'])) . '</span></div>';

echo '<div class="cols">';

/* ---- слева: что правим ---- */
echo '<form method="post" class="card form">' . csrf_field();
echo '<input type="hidden" name="id" value="' . h($id) . '">';

echo '<h2>Сделка</h2>';
echo '<label>Этап<select name="stage">';
foreach (CRM_STAGES as $code => [$label, $hint]) {
    echo '<option value="' . h($code) . '"' . ($code === $d['stage'] ? ' selected' : '') . '>' . h($label . ' — ' . mb_strtolower($hint)) . '</option>';
}
echo '</select></label>';

echo '<label>Кто ведёт<select name="owner"><option value="">не назначен</option>';
foreach (users_load() as $u) {
    $login = (string) $u['login'];
    echo '<option value="' . h($login) . '"' . ($login === $d['owner'] ? ' selected' : '') . '>'
        . h(($u['name'] ?? '') !== '' ? $u['name'] . ' (' . $login . ')' : $login) . '</option>';
}
echo '</select></label>';

echo '<label>Сумма сделки, ₽<input name="amount" inputmode="numeric" value="' . h($d['amount'] ?: '') . '" placeholder="например, 3 450 000"><small>Ориентир по смете: нужен, чтобы видеть, сколько денег в работе.</small></label>';

echo '<h2>Следующий шаг</h2>';
echo '<p class="muted">Сделка без следующего шага теряется. Поставьте дату — она попадёт в «Задачи».</p>';
echo '<label>Когда<input type="date" name="next_at" value="' . h($d['next_at']) . '"></label>';
echo '<label>Что сделать<input name="next_what" value="' . h($d['next_what']) . '" placeholder="позвонить, выехать на участок, отправить смету"></label>';

echo '<h2>Объект</h2>';
echo '<label>Проект<input name="o_project" value="' . h($obj['project'] ?: (string) ($d['project'] ?? '')) . '" placeholder="Бурашево, 120 м²"></label>';
echo '<div class="row2">';
echo '<label>Площадь, м²<input name="o_area" inputmode="numeric" value="' . h($obj['area']) . '"></label>';
echo '<label>Этажность<input name="o_floors" value="' . h($obj['floors']) . '" placeholder="1, 1,5 или 2"></label>';
echo '</div>';
echo '<label>Фундамент<input name="o_foundation" value="' . h($obj['foundation']) . '" placeholder="свайный, лента, плита"></label>';
echo '<label>Участок<input name="o_plot" value="' . h($obj['plot']) . '" placeholder="деревня, СНТ, подъезд, электричество"></label>';
echo '<label>Когда начинать<input name="o_start" value="' . h($obj['start']) . '" placeholder="весна 2027, как сойдёт снег"></label>';

echo '<button class="btn" type="submit">Сохранить</button>';
echo '</form>';

/* Правка контакта и удаление — отдельной карточкой: это редкие
   действия, им не место среди полей, которые меняют каждый день. */
echo '<div class="card"><h2>Контакт</h2>';
echo '<form class="form" method="post">' . csrf_field() . '<input type="hidden" name="action" value="contact">';
echo '<label>Имя<input name="c_name" value="' . h((string) ($d['name'] ?? '')) . '"></label>';
echo '<label>Телефон<input name="c_phone" value="' . h((string) ($d['phone'] ?? '')) . '"></label>';
echo '<label>Сообщение<textarea name="c_message" rows="3">' . h((string) ($d['message'] ?? '')) . '</textarea></label>';
echo '<small class="muted">Исходная заявка остаётся как есть: правка хранится рядом и видна в истории.</small>';
echo '<button class="btn" type="submit">Сохранить контакт</button>';
echo '</form></div>';

echo '<div class="card"><h2>' . ($wasDeleted ? 'Сделка удалена' : 'Удаление') . '</h2>';
echo '<form method="post">' . csrf_field();
if ($wasDeleted) {
    echo '<p class="muted">Она не видна в работе, но ничего не потеряно.</p>';
    echo '<button class="btn" type="submit" name="action" value="restore">Вернуть в работу</button>';
} else {
    echo '<p class="muted">Сделка уйдёт из списков, запись о заявке останется — вернуть можно в любой момент.</p>';
    echo '<button class="btn btn--ghost btn--danger" type="submit" name="action" value="del">Удалить сделку</button>';
}
echo '</form></div>';

/* ---- справа: что известно ---- */
echo '<div class="side-col">';

echo '<div class="card"><h2>Контакты</h2>';
if (!empty($d['phone'])) {
    echo '<p class="big"><a href="tel:' . h(preg_replace('/\D+/', '', $d['phone'])) . '">' . h($d['phone']) . '</a></p>';
}
echo '<p class="muted">Пришла: ' . h(date('d.m.Y H:i', strtotime((string) ($d['at'] ?? 'now')))) . '<br>';
echo 'Источник: ' . h($d['source']);
if (!empty($d['place']))  echo '<br>Откуда: ' . h((string) $d['place']);
if (!empty($d['page']))   echo '<br>Страница: ' . h($d['page']);
if (!empty($d['landing']) && $d['landing'] !== ($d['page'] ?? ''))
    echo '<br>Вошёл на: ' . h((string) $d['landing']);
if (!empty($d['device'])) echo '<br>Устройство: ' . h((string) $d['device']);
if (!empty($d['referrer'])) echo '<br>Ссылался: ' . h((string) $d['referrer']);
echo '</p>';

/* Метки рекламы показываем как есть: по ним сверяют отчёт рекламного
   кабинета с тем, что реально дошло до заявок. */
if (!empty($d['utm']) && is_array($d['utm'])) {
    echo '<p class="muted">';
    $parts = [];
    foreach ($d['utm'] as $key => $value) {
        $parts[] = h(str_replace('utm_', '', (string) $key)) . ': ' . h((string) $value);
    }
    echo implode('<br>', $parts) . '</p>';
}
if (!empty($d['message'])) echo '<p class="quote">' . h($d['message']) . '</p>';
echo '</div>';

if ($person && $person['count'] > 1) {
    echo '<div class="card"><h2>Этот клиент обращался ещё</h2><ul class="list">';
    foreach ($person['deals'] as $other) {
        if (($other['id'] ?? '') === $id) continue;
        echo '<li><a href="/admin/deal.php?id=' . h(rawurlencode((string) $other['id'])) . '">'
            . h(date('d.m.Y', strtotime((string) $other['at']))) . ' — ' . h(crm_stage_name($other['stage']))
            . (!empty($other['project']) ? ', ' . h($other['project']) : '') . '</a></li>';
    }
    echo '</ul></div>';
}

echo '<form method="post" class="card form">' . csrf_field();
echo '<input type="hidden" name="action" value="note"><input type="hidden" name="id" value="' . h($id) . '">';
echo '<h2>Заметка</h2>';
echo '<label class="sr-only" for="note">Заметка</label>';
echo '<textarea id="note" name="note" rows="3" placeholder="О чём договорились, что обещали, когда перезвонить"></textarea>';
echo '<button class="btn btn--ghost" type="submit">Добавить</button></form>';

if ($d['notes']) {
    echo '<div class="card"><h2>Заметки</h2>';
    foreach (array_reverse($d['notes']) as $note) {
        echo '<div class="note"><div class="note__meta">' . h(date('d.m.Y H:i', strtotime((string) $note['at'])))
            . ' · ' . h((string) $note['by']) . '</div><div>' . h((string) $note['text']) . '</div></div>';
    }
    echo '</div>';
}

if ($d['history']) {
    echo '<details class="card"><summary>История изменений</summary><ul class="list">';
    foreach (array_reverse($d['history']) as $row) {
        echo '<li><span class="muted">' . h(date('d.m.Y H:i', strtotime((string) $row['at']))) . ' · '
            . h((string) $row['by']) . '</span> — ' . h((string) $row['what']) . '</li>';
    }
    echo '</ul></details>';
}

echo '</div></div>';
layout_foot();
