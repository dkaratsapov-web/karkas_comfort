<?php
/*  Клиенты.
 *
 *  Один человек оставляет заявки по нескольку раз: с разных страниц
 *  и в разные месяцы. В списке заявок это выглядит как разные строки,
 *  а в разговоре важно видеть всю историю сразу. Здесь обращения
 *  склеены по номеру телефона.
 */

declare(strict_types=1);
require __DIR__ . '/_boot.php';
require __DIR__ . '/crm.php';

session_boot();
csrf_check();
$user = require_login();

/* Клиент — это не отдельная запись, а все его обращения, склеенные
   по телефону. Поэтому правка имени и удаление идут по всем его
   сделкам сразу: иначе в списке остался бы наполовину
   переименованный человек. */
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    $ids  = array_slice(array_filter(explode(',', post('ids', 4000))), 0, 200);
    $by   = (string) $user['login'];
    $what = post('action', 20);

    if ($ids && $what === 'rename') {
        $name  = post('name', 120);
        $phone = post('phone', 40);
        foreach ($ids as $one) {
            crm_update(trim($one), array_filter([
                'name'  => $name,
                'phone' => $phone,
            ], static fn($v) => $v !== ''), $by, 'правка клиента');
        }
        flash('Клиент изменён во всех его обращениях: ' . count($ids) . '.');
    }

    if ($ids && $what === 'del') {
        foreach ($ids as $one) crm_delete(trim($one), $by);
        flash('Клиент удалён вместе с обращениями: ' . count($ids) . '. Вернуть можно в «Сделках» → «Удалённые».');
    }
    redirect('/admin/people.php' . ($_SERVER['QUERY_STRING'] ? '?' . $_SERVER['QUERY_STRING'] : ''));
}

$deals  = crm_deals();
$people = crm_people($deals);

$q = mb_strtolower(trim((string) ($_GET['q'] ?? '')));
if ($q !== '') {
    $people = array_filter($people, static function (array $p) use ($q) {
        return str_contains(mb_strtolower($p['name'] . ' ' . $p['phone']), $q);
    });
}

layout_head('Клиенты', $user, 'people.php');

echo '<div class="head"><h1>Клиенты <span class="count">' . count($people) . '</span></h1>';
echo '<form class="search" method="get"><input name="q" value="' . h((string) ($_GET['q'] ?? '')) . '" placeholder="Имя или телефон" aria-label="Поиск по клиентам">';
echo '<button class="btn" type="submit">Найти</button></form></div>';

if (!$people) {
    echo '<div class="card"><p class="muted">Пока никого нет. Клиенты появляются здесь, как только приходит первая заявка.</p></div>';
    layout_foot();
    exit;
}

foreach ($people as $p) {
    $last = end($p['deals']);
    echo '<article class="deal">';
    echo '<div class="deal__top">';
    echo '<span class="deal__name">' . h($p['name'] ?: 'Без имени') . '</span>';
    if ($p['count'] > 1) echo '<span class="deal__stage">обращений: ' . $p['count'] . '</span>';
    echo '<time class="deal__time">последнее ' . h(date('d.m.Y', strtotime($p['last']))) . '</time>';
    echo '</div>';

    echo '<div class="deal__facts">';
    echo '<a class="deal__phone" href="tel:' . h(preg_replace('/\D+/', '', $p['phone'])) . '">' . h($p['phone']) . '</a>';
    if ($p['amount'] > 0) echo '<span>Сумма сделок: ' . h(crm_money($p['amount'])) . '</span>';
    echo '<span>Первое обращение: ' . h(date('d.m.Y', strtotime($p['first']))) . '</span>';
    echo '</div>';

    $ids = implode(',', array_map(static fn($deal) => (string) $deal['id'], $p['deals']));
    echo '<details class="deal__edit"><summary>Изменить или удалить</summary>';
    echo '<form class="deal__form" method="post">' . csrf_field();
    echo '<input type="hidden" name="ids" value="' . h($ids) . '">';
    echo '<input name="name" value="' . h($p['name']) . '" placeholder="имя" aria-label="Имя клиента">';
    echo '<input name="phone" value="' . h($p['phone']) . '" placeholder="телефон" aria-label="Телефон клиента">';
    echo '<button class="btn" type="submit" name="action" value="rename">Сохранить</button>';
    echo '<button class="btn btn--ghost btn--danger" type="submit" name="action" value="del">'
        . 'Удалить клиента' . ($p['count'] > 1 ? ' и все ' . $p['count'] . ' обращения' : '') . '</button>';
    echo '</form>';
    echo '<p class="muted">Правка меняет все обращения этого человека. Удаление убирает их из работы,'
        . ' сами заявки остаются и возвращаются в «Сделках» → «Удалённые».</p>';
    echo '</details>';

    echo '<ul class="list list--tight">';
    foreach (array_reverse($p['deals']) as $deal) {
        echo '<li><a href="/admin/deal.php?id=' . h(rawurlencode((string) $deal['id'])) . '">'
            . h(date('d.m.Y', strtotime((string) $deal['at']))) . ' · ' . h(crm_stage_name($deal['stage']))
            . (!empty($deal['project']) ? ' · ' . h($deal['project']) : '')
            . ' · ' . h($deal['source'])
            . '</a></li>';
    }
    echo '</ul></article>';
}

layout_foot();
