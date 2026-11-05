<?php
/*  Содержимое сайта: проекты, объекты, видео, цены и тексты страниц.
 *
 *  Страница не правит сайт на сервере напрямую. Она читает исходники
 *  из репозитория и сохраняет правку туда же коммитом, а дальше идёт
 *  обычная цепочка: сборка прогоняет проверки и выкладывает сайт.
 *  Поэтому у каждой правки есть автор и время, любую можно откатить,
 *  а сайт никогда не расходится с исходниками.
 *
 *  Если правка ломает сборку, она просто не доезжает до сайта:
 *  выкладывается только то, что собралось и прошло проверки.
 */

declare(strict_types=1);
require __DIR__ . '/_boot.php';
require __DIR__ . '/github.php';

session_boot();
csrf_check();
$me = require_login();

const FILES = [
    'projects' => ['path' => 'src/data/projects.json', 'title' => 'Проекты каталога'],
    'cases'    => ['path' => 'src/data/cases.json',    'title' => 'Построенные объекты'],
    'videos'   => ['path' => 'src/data/videos.json',   'title' => 'Видео'],
    'pricing'  => ['path' => 'src/data/pricing.json',  'title' => 'Цены и сроки'],
    'texts'    => ['path' => '',                       'title' => 'Тексты страниц'],
];

/* Страницы, которые чаще всего и правят. Полный список файлов давать
   незачем: в сборке есть служебные, их правка только ломает сайт. */
const TEXT_FILES = [
    'src/pages/index.html'       => 'Главная',
    'src/pages/o-kompanii.html'  => 'О компании',
    'src/pages/kontakty.html'    => 'Контакты',
    'src/pages/proekty.html'     => 'Каталог проектов',
    'src/pages/obekty.html'      => 'Наши объекты',
    'src/pages/video.html'       => 'Видео',
    'src/pages/politika.html'    => 'Политика конфиденциальности',
    'src/partials/cta.html'      => 'Блок заявки (на всех страницах)',
    'src/partials/header.html'   => 'Шапка сайта',
    'src/partials/footer.html'   => 'Подвал сайта',
];

$tab = (string) ($_GET['file'] ?? 'projects');
if (!isset(FILES[$tab])) $tab = 'projects';

$num  = static function ($value) {
    $value = str_replace([' ', ' ', ','], ['', '', '.'], (string) $value);
    return $value !== '' && is_numeric($value) ? 0 + $value : null;
};
$text = static fn($value, int $max = 2000) => mb_substr(trim(str_replace(["\r", "\0"], '', (string) $value)), 0, $max);
$slug = static function (string $value): string {
    $map = ['а'=>'a','б'=>'b','в'=>'v','г'=>'g','д'=>'d','е'=>'e','ё'=>'e','ж'=>'zh','з'=>'z','и'=>'i','й'=>'y',
            'к'=>'k','л'=>'l','м'=>'m','н'=>'n','о'=>'o','п'=>'p','р'=>'r','с'=>'s','т'=>'t','у'=>'u','ф'=>'f',
            'х'=>'h','ц'=>'c','ч'=>'ch','ш'=>'sh','щ'=>'sch','ъ'=>'','ы'=>'y','ь'=>'','э'=>'e','ю'=>'yu','я'=>'ya'];
    $value = strtr(mb_strtolower(trim($value)), $map);
    $value = preg_replace('/[^a-z0-9]+/', '-', $value) ?? '';
    return trim($value, '-');
};

/* ---------- доступ к репозиторию ---------- */
if (post('action', 20) === 'token') {
    require_owner();
    $values = [
        'github_repo'   => post('github_repo', 120) ?: 'dkaratsapov-web/karkas_comfort',
        'github_branch' => post('github_branch', 120) ?: 'claude/karkas-comfort-redesign-0zy3xi',
    ];
    /* пустое поле токена означает «оставить прежний», иначе случайное
       сохранение формы стирало бы доступ */
    $token = post('github_token', 200);
    if ($token !== '') $values['github_token'] = $token;
    settings_save($values);
    flash('Доступ к репозиторию сохранён.');
    redirect('/admin/content.php?file=' . $tab);
}

$act = post('action', 20);

/* ---------- тексты страниц ---------- */
if ($act === 'text' && gh_ready()) {
    $path = (string) ($_POST['path'] ?? '');
    if (!isset(TEXT_FILES[$path])) {
        flash('Такой страницы нет в списке.', 'err');
        redirect('/admin/content.php?file=texts');
    }
    $body = str_replace("\r\n", "\n", (string) ($_POST['body'] ?? ''));
    $read = gh_get_text($path);
    if (!$read['ok']) {
        flash($read['error'], 'err');
        redirect('/admin/content.php?file=texts&page=' . rawurlencode($path));
    }
    /* Простая защита от обрыва разметки: число открывающих и
       закрывающих угловых скобок должно совпадать. Полную проверку
       делает сборка — сайт не обновится, если страница сломана. */
    if (substr_count($body, '<') !== substr_count($body, '>')) {
        flash('В разметке не сходятся угловые скобки — правка не сохранена.', 'err');
        redirect('/admin/content.php?file=texts&page=' . rawurlencode($path));
    }
    $done = gh_put_text($path, $body, $read['sha'],
        'Правка из админки: ' . TEXT_FILES[$path] . ' (' . ($me['name'] ?: $me['login']) . ')');
    flash($done['ok'] ? 'Сохранено. Сайт пересоберётся сам, правка появится через минуту-две.' : $done['error'],
          $done['ok'] ? 'ok' : 'err');
    redirect('/admin/content.php?file=texts&page=' . rawurlencode($path));
}

/* ---------- добавление и удаление записей ---------- */
if (in_array($act, ['add', 'del'], true) && gh_ready() && $tab !== 'texts' && $tab !== 'pricing') {
    $file = FILES[$tab];
    $read = gh_get_json($file['path']);
    if (!$read['ok']) {
        flash($read['error'], 'err');
        redirect('/admin/content.php?file=' . $tab);
    }
    $data = $read['data'];
    $what = '';

    if ($act === 'del') {
        $i = (int) post('index', 6);
        if (isset($data[$i])) {
            $gone = $data[$i]['name'] ?? $data[$i]['title'] ?? ('запись ' . ($i + 1));
            array_splice($data, $i, 1);
            $what = 'удалено: ' . $gone;
        }
    } else {
        $name = $text(post('name', 120), 120);
        if ($name === '') {
            flash('Укажите название.', 'err');
            redirect('/admin/content.php?file=' . $tab);
        }
        $code = $slug(post('slug', 80) ?: $name);
        if ($code === '') $code = 'novyy-' . date('ymd-His');

        if ($tab === 'projects') {
            $area = (int) ($num(post('area', 10)) ?? 0);
            $data[] = [
                'code' => $code, 'slug' => $code, 'name' => $name,
                'size' => $text(post('size', 20), 20), 'floors' => (float) ($num(post('floors', 5)) ?? 1),
                'area' => $area ?: 100, 'bedrooms' => (int) ($num(post('bedrooms', 3)) ?? 0),
                'terrace' => 0, 'tags' => [], 'note' => $text(post('note', 600), 600),
                'price' => ($p = $num(post('price', 12))) ? (int) $p : null,
                'viz' => [], 'plan' => [], 'drawings' => [], 'rooms' => [], 'roomsTotal' => 0,
                'tep' => [], 'points' => [],
            ];
            $what = 'добавлен проект: ' . $name;
        } elseif ($tab === 'cases') {
            $data[] = [
                'slug' => $code, 'title' => $name,
                'place' => $text(post('place', 120), 120),
                'lead'  => $text(post('note', 600), 600),
                'photos' => [], 'seen' => '', 'groups' => (object) [], 'cover' => '',
            ];
            $what = 'добавлен объект: ' . $name;
        } elseif ($tab === 'videos') {
            $data[] = [
                'title' => $name,
                'note'  => $text(post('note', 400), 400),
                'length' => $text(post('length', 10), 10),
                'poster' => $text(post('poster', 200), 200),
                'src'    => $text(post('src', 200), 200),
                'portrait' => post('portrait', 3) === '1',
            ];
            $what = 'добавлено видео: ' . $name;
        }
    }

    if ($what === '') {
        flash('Нечего сохранять.', 'err');
        redirect('/admin/content.php?file=' . $tab);
    }
    $done = gh_put_json($file['path'], $data, $read['sha'],
        'Правка из админки: ' . $file['title'] . ' — ' . $what . ' (' . ($me['name'] ?: $me['login']) . ')');
    flash($done['ok'] ? 'Сохранено (' . $what . '). Сайт пересоберётся сам.' : $done['error'],
          $done['ok'] ? 'ok' : 'err');
    redirect('/admin/content.php?file=' . $tab);
}

/* ---------- правка существующих записей ---------- */
if ($act === 'save' && gh_ready() && $tab !== 'texts') {
    $file = FILES[$tab];
    $read = gh_get_json($file['path']);
    if (!$read['ok']) {
        flash($read['error'], 'err');
        redirect('/admin/content.php?file=' . $tab);
    }
    $data   = $read['data'];
    $fields = is_array($_POST['f'] ?? null) ? $_POST['f'] : [];

    if ($tab === 'pricing') {
        foreach (['standart', 'komfort', 'pod_kluch'] as $key) {
            $value = $num($fields['rate'][$key] ?? '');
            if ($value !== null && $value > 0) $data['ratePerM2'][$key] = (int) $value;
        }
        foreach (($data['terms'] ?? []) as $i => $term) {
            $value = $text($fields['term'][$i] ?? '', 60);
            if ($value !== '') $data['terms'][$i]['text'] = $value;
        }
    } elseif ($tab === 'projects') {
        foreach ($data as $i => $row) {
            if (!isset($fields['p'][$i])) continue;
            $in = $fields['p'][$i];
            $data[$i]['name'] = $text($in['name'] ?? $row['name'] ?? '', 80);
            $data[$i]['note'] = $text($in['note'] ?? $row['note'] ?? '', 600);
            $data[$i]['size'] = $text($in['size'] ?? $row['size'] ?? '', 20);
            if (($v = $num($in['area'] ?? '')) && $v > 0)     $data[$i]['area'] = $v;
            if (($v = $num($in['floors'] ?? '')) && $v > 0)   $data[$i]['floors'] = $v;
            if (($v = $num($in['bedrooms'] ?? '')) !== null)  $data[$i]['bedrooms'] = (int) $v;
            $price = $num($in['price'] ?? '');
            $data[$i]['price'] = ($price !== null && $price > 0) ? (int) $price : null;
        }
    } elseif ($tab === 'cases') {
        foreach ($data as $i => $row) {
            if (!isset($fields['c'][$i])) continue;
            $in = $fields['c'][$i];
            $data[$i]['title'] = $text($in['title'] ?? $row['title'] ?? '', 80);
            $data[$i]['place'] = $text($in['place'] ?? $row['place'] ?? '', 120);
            $data[$i]['lead']  = $text($in['lead'] ?? $row['lead'] ?? '', 400);
            $cover = $text($in['cover'] ?? '', 200);
            if ($cover !== '') $data[$i]['cover'] = $cover;
        }
    } elseif ($tab === 'videos') {
        foreach ($data as $i => $row) {
            if (!isset($fields['v'][$i])) continue;
            $in = $fields['v'][$i];
            $data[$i]['title']  = $text($in['title'] ?? $row['title'] ?? '', 120);
            $data[$i]['note']   = $text($in['note'] ?? $row['note'] ?? '', 400);
            $data[$i]['length'] = $text($in['length'] ?? $row['length'] ?? '', 10);
            foreach (['src', 'poster'] as $key) {
                $value = $text($in[$key] ?? '', 200);
                if ($value !== '') $data[$i][$key] = $value;
            }
            $data[$i]['portrait'] = !empty($in['portrait']);
        }
    }

    $done = gh_put_json($file['path'], $data, $read['sha'],
        'Правка из админки: ' . $file['title'] . ' (' . ($me['name'] ?: $me['login']) . ')');
    flash($done['ok'] ? 'Сохранено. Сайт пересоберётся сам, правка появится через минуту-две.' : $done['error'],
          $done['ok'] ? 'ok' : 'err');
    redirect('/admin/content.php?file=' . $tab);
}

require __DIR__ . '/content-view.php';
