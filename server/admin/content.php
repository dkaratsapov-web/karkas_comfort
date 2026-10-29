<?php
/*  Содержимое сайта: цены, проекты, объекты и видео.
 *
 *  Страница не правит сайт на сервере напрямую. Она читает данные из
 *  репозитория, сохраняет правку туда же коммитом, а дальше работает
 *  обычная цепочка: сборка проверяет сайт и выкладывает его. Поэтому
 *  правка появляется на сайте через минуту-две, у каждой есть автор
 *  и её всегда можно откатить.
 */

declare(strict_types=1);
require __DIR__ . '/_boot.php';
require __DIR__ . '/github.php';

session_boot();
csrf_check();
$me = require_login();

const FILES = [
    'pricing'  => ['path' => 'src/data/pricing.json',  'title' => 'Цены'],
    'projects' => ['path' => 'src/data/projects.json', 'title' => 'Проекты каталога'],
    'cases'    => ['path' => 'src/data/cases.json',    'title' => 'Построенные объекты'],
    'videos'   => ['path' => 'src/data/videos.json',   'title' => 'Видео'],
];

$tab = (string) ($_GET['file'] ?? '');
if (!isset(FILES[$tab])) $tab = 'pricing';

/* ---------- токен доступа к репозиторию ---------- */
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

/* ---------- сохранение правки ---------- */
if (post('action', 20) === 'save' && gh_ready()) {
    $file = FILES[$tab];
    $read = gh_get_json($file['path']);
    if (!$read['ok']) {
        flash($read['error'], 'err');
        redirect('/admin/content.php?file=' . $tab);
    }
    $data   = $read['data'];
    $fields = $_POST['f'] ?? [];
    $fields = is_array($fields) ? $fields : [];

    $num = static function ($value) {
        $value = str_replace([' ', ' ', ','], ['', '', '.'], (string) $value);
        if ($value === '') return null;
        return is_numeric($value) ? (0 + $value) : null;
    };
    $text = static fn($value, int $max = 2000) => mb_substr(trim(str_replace(["\r", "\0"], '', (string) $value)), 0, $max);

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
            $data[$i]['name']  = $text($in['name'] ?? $row['name'] ?? '', 80);
            $data[$i]['note']  = $text($in['note'] ?? $row['note'] ?? '', 600);
            $area  = $num($in['area'] ?? '');
            if ($area !== null && $area > 0) $data[$i]['area'] = $area;
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
        }
    } elseif ($tab === 'videos') {
        foreach ($data as $i => $row) {
            if (!isset($fields['v'][$i])) continue;
            $in = $fields['v'][$i];
            $data[$i]['title']  = $text($in['title'] ?? $row['title'] ?? '', 120);
            $data[$i]['note']   = $text($in['note'] ?? $row['note'] ?? '', 400);
            $data[$i]['length'] = $text($in['length'] ?? $row['length'] ?? '', 10);
        }
    }

    $done = gh_put_json(
        $file['path'],
        $data,
        $read['sha'],
        'Правка из админки: ' . $file['title'] . ' (' . ($me['name'] ?: $me['login']) . ')'
    );
    flash($done['ok']
        ? 'Сохранено. Сайт пересоберётся сам, правка появится через минуту-две.'
        : $done['error'], $done['ok'] ? 'ok' : 'err');
    redirect('/admin/content.php?file=' . $tab);
}

/* ---------- страница ---------- */
layout_head('Содержимое сайта', $me, 'content.php');
flash_show();

echo '<h1>Содержимое сайта</h1>';

if (!gh_ready()) {
    echo '<div class="card"><p>Чтобы править содержимое отсюда, нужен доступ к репозиторию: админка сохраняет правку коммитом, а дальше сайт собирается и выкладывается сам.</p>';
    if (($me['role'] ?? '') === 'owner') {
        $s = gh_settings();
        echo '<p class="muted">Токен создаётся в GitHub: Settings → Developer settings → Personal access tokens → Fine-grained tokens. Доступ нужен только к этому репозиторию и только на Contents: Read and write.</p>';
        echo '<form method="post" class="form">' . csrf_field() . '<input type="hidden" name="action" value="token">';
        echo '<label>Токен<input name="github_token" autocomplete="off" placeholder="github_pat_..."></label>';
        echo '<label>Репозиторий<input name="github_repo" value="' . h($s['repo']) . '"></label>';
        echo '<label>Ветка<input name="github_branch" value="' . h($s['branch']) . '"></label>';
        echo '<button class="btn" type="submit">Сохранить доступ</button></form>';
    } else {
        echo '<p class="muted">Доступ настраивает владелец.</p>';
    }
    echo '</div>';
    layout_foot();
    exit;
}

/* состояние последней сборки */
$run = gh_last_run();
if ($run['ok']) {
    $label = $run['status'] !== 'completed'
        ? 'сборка идёт'
        : ($run['result'] === 'success' ? 'сайт собран' : 'сборка не прошла');
    $dot = $run['status'] !== 'completed' ? '' : ($run['result'] === 'success' ? ' dot--ok' : ' dot--off');
    echo '<p class="state"><span class="dot' . $dot . '"></span>' . h($label)
        . ' · ' . h(date('d.m.Y H:i', strtotime($run['at'])))
        . ' · ' . h(mb_substr($run['title'], 0, 70))
        . ' · <a href="' . h($run['url']) . '" target="_blank" rel="noopener">журнал</a></p>';
}

echo '<div class="chips">';
foreach (FILES as $key => $file) {
    echo '<a class="chip' . ($key === $tab ? ' is-on' : '') . '" href="/admin/content.php?file=' . h($key) . '">' . h($file['title']) . '</a>';
}
echo '</div>';

$read = gh_get_json(FILES[$tab]['path']);
if (!$read['ok']) {
    echo '<div class="card"><p class="flash flash--err">' . h($read['error']) . '</p></div>';
    layout_foot();
    exit;
}
$data = $read['data'];

echo '<form method="post" class="form"><input type="hidden" name="action" value="save">' . csrf_field();

if ($tab === 'pricing') {
    $rate = $data['ratePerM2'] ?? [];
    echo '<div class="card"><h2>Ставка за квадратный метр</h2>';
    echo '<p class="muted">Из этих трёх чисел считается весь сайт: цены в каталоге, карточки проектов, квиз и калькулятор.</p><div class="grid2">';
    foreach (['standart' => 'Тёплый контур', 'komfort' => 'White box', 'pod_kluch' => 'Под ключ'] as $key => $label) {
        echo '<label>' . h($label) . ', ₽/м²<input name="f[rate][' . h($key) . ']" value="' . h((string) ($rate[$key] ?? '')) . '" inputmode="numeric"></label>';
    }
    echo '</div></div>';

    echo '<div class="card"><h2>Сроки строительства</h2><div class="grid2">';
    foreach (($data['terms'] ?? []) as $i => $term) {
        $upto = (int) ($term['maxArea'] ?? 0);
        $label = $upto >= 9999 ? 'Больше 150 м²' : 'До ' . $upto . ' м²';
        echo '<label>' . h($label) . '<input name="f[term][' . (int) $i . ']" value="' . h((string) ($term['text'] ?? '')) . '"></label>';
    }
    echo '</div></div>';
} elseif ($tab === 'projects') {
    echo '<div class="rows">';
    foreach ($data as $i => $row) {
        echo '<details class="row-card"><summary>' . h($row['name'] ?? $row['code'] ?? 'Проект')
            . ' <span>' . h((string) ($row['code'] ?? '')) . ' · ' . h((string) ($row['area'] ?? '')) . ' м²</span></summary>';
        echo '<div class="form"><div class="grid2">';
        echo '<label>Название<input name="f[p][' . (int) $i . '][name]" value="' . h((string) ($row['name'] ?? '')) . '"></label>';
        echo '<label>Площадь, м²<input name="f[p][' . (int) $i . '][area]" value="' . h((string) ($row['area'] ?? '')) . '" inputmode="decimal"></label>';
        echo '</div>';
        echo '<label>Цена под ключ, ₽<input name="f[p][' . (int) $i . '][price]" value="' . h((string) ($row['price'] ?? '')) . '" inputmode="numeric"><small>Пусто — на сайте показывается расчётная цена «от» по ставке за м².</small></label>';
        echo '<label>Описание<textarea name="f[p][' . (int) $i . '][note]">' . h((string) ($row['note'] ?? '')) . '</textarea></label>';
        echo '</div></details>';
    }
    echo '</div>';
} elseif ($tab === 'cases') {
    echo '<div class="rows">';
    foreach ($data as $i => $row) {
        $shots = count($row['photos'] ?? []);
        echo '<details class="row-card"><summary>' . h($row['title'] ?? 'Объект')
            . ' <span>' . h((string) ($row['place'] ?? '')) . ' · ' . $shots . ' фото</span></summary>';
        echo '<div class="form"><div class="grid2">';
        echo '<label>Название<input name="f[c][' . (int) $i . '][title]" value="' . h((string) ($row['title'] ?? '')) . '"></label>';
        echo '<label>Адрес<input name="f[c][' . (int) $i . '][place]" value="' . h((string) ($row['place'] ?? '')) . '"></label>';
        echo '</div>';
        echo '<label>Описание<textarea name="f[c][' . (int) $i . '][lead]">' . h((string) ($row['lead'] ?? '')) . '</textarea></label>';
        echo '<p class="muted">Фотографии пока добавляю я: пришлите архив, и кадры встанут в нужную группу.</p>';
        echo '</div></details>';
    }
    echo '</div>';
} elseif ($tab === 'videos') {
    echo '<div class="rows">';
    foreach ($data as $i => $row) {
        echo '<details class="row-card"><summary>' . h($row['title'] ?? 'Ролик')
            . ' <span>' . h((string) ($row['length'] ?? '')) . '</span></summary>';
        echo '<div class="form"><div class="grid2">';
        echo '<label>Название<input name="f[v][' . (int) $i . '][title]" value="' . h((string) ($row['title'] ?? '')) . '"></label>';
        echo '<label>Хронометраж<input name="f[v][' . (int) $i . '][length]" value="' . h((string) ($row['length'] ?? '')) . '" placeholder="1:29"></label>';
        echo '</div>';
        echo '<label>Описание<textarea name="f[v][' . (int) $i . '][note]">' . h((string) ($row['note'] ?? '')) . '</textarea></label>';
        echo '</div></details>';
    }
    echo '</div>';
}

echo '<div class="card"><button class="btn" type="submit">Сохранить и опубликовать</button>';
echo '<p class="muted" style="margin:10px 0 0">Правка уходит в репозиторий, сайт пересобирается и выкладывается сам. Это занимает одну-две минуты.</p></div>';
echo '</form>';

if (($me['role'] ?? '') === 'owner') {
    $s = gh_settings();
    echo '<details class="row-card"><summary>Доступ к репозиторию <span>' . h($s['repo']) . ' · ' . h($s['branch']) . '</span></summary>';
    echo '<form method="post" class="form">' . csrf_field() . '<input type="hidden" name="action" value="token">';
    echo '<label>Токен<input name="github_token" autocomplete="off" placeholder="оставьте пустым, чтобы не менять"></label>';
    echo '<label>Репозиторий<input name="github_repo" value="' . h($s['repo']) . '"></label>';
    echo '<label>Ветка<input name="github_branch" value="' . h($s['branch']) . '"></label>';
    echo '<button class="btn btn--ghost" type="submit">Сохранить доступ</button></form></details>';
}

layout_foot();
