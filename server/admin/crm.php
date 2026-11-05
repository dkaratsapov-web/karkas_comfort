<?php
/*  Ядро CRM: сделки, этапы, задачи, клиенты.
 *
 *  Сделка — это заявка, доведённая до результата. Заявки приходят
 *  с сайта в leads.jsonl и не меняются; всё, что с ними делают
 *  дальше, лежит рядом в leads-state.json: этап, ответственный,
 *  сумма, следующий шаг, заметки и история. Так ни одна правка
 *  в кабинете не может испортить исходную заявку.
 *
 *  Этапы взяты из работы строительной компании, а не из общей CRM:
 *  между «позвонили» и «договор» всегда есть выезд на участок
 *  и смета, и именно там сделки застревают.
 */

declare(strict_types=1);

const CRM_STAGES = [
    'new'      => ['Новая',        'Заявка пришла, ещё не звонили'],
    'contact'  => ['Созвон',       'Поговорили, выясняем задачу'],
    'meet'     => ['Выезд',        'Встреча на участке или в офисе'],
    'estimate' => ['Смета',        'Считаем проект и стоимость'],
    'contract' => ['Договор',      'Согласование и подписание'],
    'build'    => ['Стройка',      'Работы идут'],
    'done'     => ['Сдан',         'Объект передан заказчику'],
    'lost'     => ['Отказ',        'Сделка не состоялась'],
];

/* Этапы, после которых сделка больше не в работе. */
const CRM_CLOSED = ['done', 'lost'];

/* Старые статусы админки продолжают работать: их показываем
   на новых этапах, ничего не переписывая в файлах. */
const CRM_OLD = ['work' => 'contact', 'deal' => 'contract'];

function crm_stage(string $code): string
{
    $code = CRM_OLD[$code] ?? $code;
    return isset(CRM_STAGES[$code]) ? $code : 'new';
}

function crm_stage_name(string $code): string
{
    return CRM_STAGES[crm_stage($code)][0];
}

/* ---------- сделки ---------- */

/** Все сделки: заявка плюс то, что с ней сделали. */
function crm_deals(): array
{
    $state = leads_state();
    $out   = [];

    foreach (leads_load() as $id => $lead) {
        $extra = $state[$id] ?? [];
        $out[$id] = $lead + [
            'stage'     => crm_stage((string) ($extra['status'] ?? $lead['status'] ?? 'new')),
            'owner'     => (string) ($extra['owner'] ?? ''),
            'amount'    => (int)    ($extra['amount'] ?? 0),
            'next_at'   => (string) ($extra['next_at'] ?? ''),
            'next_what' => (string) ($extra['next_what'] ?? ''),
            'object'    => (array)  ($extra['object'] ?? []),
            'notes'     => (array)  ($extra['notes'] ?? []),
            'history'   => (array)  ($extra['history'] ?? []),
            'source'    => crm_source($lead),
        ];
        $out[$id]['stage'] = crm_stage($out[$id]['stage']);
    }
    return $out;
}

/** Откуда пришла заявка: страница говорит об этом точнее всего. */
function crm_source(array $lead): string
{
    $page = (string) ($lead['page'] ?? '');
    if ($page === '' || $page === '/')        return 'Главная';
    if (str_starts_with($page, '/proekty'))   return 'Каталог проектов';
    if (str_starts_with($page, '/obekty'))    return 'Наши объекты';
    if (str_starts_with($page, '/stati'))     return 'Статья';
    if (str_starts_with($page, '/kontakty'))  return 'Контакты';
    if (str_starts_with($page, '/admin'))     return 'Проверка';
    return $page;
}

/** Правка сделки с записью в историю: кто, когда и что изменил. */
function crm_update(string $id, array $patch, string $by, string $what = ''): void
{
    $all  = leads_state();
    $was  = $all[$id] ?? [];
    $hist = (array) ($was['history'] ?? []);

    if ($what !== '') {
        $hist[] = ['at' => date('c'), 'by' => $by, 'what' => $what];
        if (count($hist) > 100) $hist = array_slice($hist, -100);
    }

    $all[$id] = array_merge($was, $patch, [
        'history' => $hist,
        'updated' => date('c'),
        'by'      => $by,
    ]);
    json_write(STATE_FILE, $all);
}

function crm_note(string $id, string $text, string $by): void
{
    $all   = leads_state();
    $notes = (array) ($all[$id]['notes'] ?? []);
    $notes[] = ['at' => date('c'), 'by' => $by, 'text' => $text];
    crm_update($id, ['notes' => $notes], $by, 'заметка');
}

/* ---------- задачи ----------
   Отдельной сущности нет намеренно: задача — это следующий шаг
   по сделке. Так невозможно «сделать задачу» и забыть сделку. */

function crm_tasks(array $deals): array
{
    $out = [];
    foreach ($deals as $id => $deal) {
        if ($deal['next_at'] === '' || in_array($deal['stage'], CRM_CLOSED, true)) continue;
        $out[$id] = $deal;
    }
    uasort($out, static fn($a, $b) => strcmp($a['next_at'], $b['next_at']));
    return $out;
}

function crm_overdue(string $date): bool
{
    return $date !== '' && $date < date('Y-m-d');
}

/* ---------- клиенты ----------
   Один человек часто оставляет несколько заявок: с разных страниц
   и в разные месяцы. Склеиваем по номеру телефона, чтобы в разговоре
   была видна вся история, а не последняя строка. */

function crm_people(array $deals): array
{
    $people = [];
    foreach ($deals as $deal) {
        $digits = preg_replace('/\D+/', '', (string) ($deal['phone'] ?? '')) ?? '';
        if (strlen($digits) < 10) continue;
        $key = substr($digits, -10);

        if (!isset($people[$key])) {
            $people[$key] = [
                'key'    => $key,
                'name'   => (string) ($deal['name'] ?? ''),
                'phone'  => (string) ($deal['phone'] ?? ''),
                'first'  => (string) ($deal['at'] ?? ''),
                'last'   => (string) ($deal['at'] ?? ''),
                'count'  => 0,
                'amount' => 0,
                'stages' => [],
                'deals'  => [],
            ];
        }
        $p = &$people[$key];
        $p['count']++;
        $p['amount'] += (int) $deal['amount'];
        $p['stages'][] = $deal['stage'];
        $p['deals'][]  = $deal;
        if ((string) $deal['at'] < $p['first']) $p['first'] = (string) $deal['at'];
        if ((string) $deal['at'] > $p['last'])  $p['last']  = (string) $deal['at'];
        if (($deal['name'] ?? '') !== '') $p['name'] = (string) $deal['name'];
        unset($p);
    }
    uasort($people, static fn($a, $b) => strcmp($b['last'], $a['last']));
    return $people;
}

/* ---------- сводка ---------- */

function crm_summary(array $deals): array
{
    $sum = ['all' => 0, 'open' => 0, 'money' => 0, 'won' => 0, 'lost' => 0, 'today' => 0, 'overdue' => 0];
    foreach ($deals as $deal) {
        $sum['all']++;
        $closed = in_array($deal['stage'], CRM_CLOSED, true);
        if (!$closed) { $sum['open']++; $sum['money'] += (int) $deal['amount']; }
        if ($deal['stage'] === 'done') $sum['won']++;
        if ($deal['stage'] === 'lost') $sum['lost']++;
        if (!$closed && $deal['next_at'] !== '') {
            if ($deal['next_at'] === date('Y-m-d')) $sum['today']++;
            if (crm_overdue($deal['next_at']))      $sum['overdue']++;
        }
    }
    return $sum;
}

function crm_money(int $rubles): string
{
    return $rubles > 0 ? number_format($rubles, 0, ',', ' ') . ' ₽' : '—';
}
