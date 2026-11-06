<?php
/*  Вид раздела «Содержимое сайта».
 *
 *  Вынесено из content.php: разбор форм и вывод страницы — разные
 *  задачи, и вместе они читались плохо.
 */

declare(strict_types=1);

layout_head('Содержимое сайта', $me, 'content.php');
flash_show();

echo '<h1>Содержимое сайта</h1>';

if (!gh_ready()) {
    echo '<div class="card"><p>Чтобы править содержимое отсюда, нужен доступ к репозиторию: админка сохраняет правку коммитом, а дальше сайт собирается и выкладывается сам.</p>';
    if (($me['role'] ?? '') === 'owner') {
        $s = gh_settings();
        echo '<p class="muted">Токен создаётся в GitHub: Settings → Developer settings → Personal access tokens.</p>';
        echo '<p class="muted"><b>Если репозиторий ваш</b> — Fine-grained tokens: Repository access → Only select repositories → '
            . h($s['repo']) . ', Permissions → Contents: Read and write.<br>'
            . '<b>Если репозиторий чужой, а вы в нём соавтор</b> — нужен Tokens (classic) с галочкой <b>repo</b>: '
            . 'токены Fine-grained работают только с репозиториями своего аккаунта, на чужой GitHub отвечает «не найдено».</p>';
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

/* Что со сборкой: по ней видно, доехала правка до сайта или нет. */
$run = gh_last_run();
if (!empty($run['ok'])) {
    $state = [
        'success'     => ['ok',   'Сайт собран и выложен'],
        'in_progress' => ['warn', 'Сайт пересобирается'],
        'queued'      => ['warn', 'Сборка в очереди'],
        'failure'     => ['err',  'Последняя сборка не прошла — сайт остался прежним'],
    ][$run['status']] ?? ['warn', 'Состояние сборки: ' . $run['status']];
    echo '<p class="flash flash--' . h($state[0]) . '">' . h($state[1])
        . ' · <a href="' . h($run['url']) . '" target="_blank" rel="noopener">журнал</a></p>';
}

/* ---------- вкладки ---------- */
echo '<div class="chips">';
foreach (FILES as $key => $info) {
    $on = $key === $tab ? ' is-on' : '';
    echo '<a class="chip' . $on . '" href="/admin/content.php?file=' . h($key) . '">' . h($info['title']) . '</a>';
}
echo '</div>';

/* ---------- тексты страниц ---------- */
if ($tab === 'texts') {
    $page = (string) ($_GET['page'] ?? '');
    if (!isset(TEXT_FILES[$page])) $page = array_key_first(TEXT_FILES);

    echo '<div class="chips">';
    foreach (TEXT_FILES as $path => $label) {
        $on = $path === $page ? ' is-on' : '';
        echo '<a class="chip' . $on . '" href="/admin/content.php?file=texts&page=' . h(rawurlencode($path)) . '">' . h($label) . '</a>';
    }
    echo '</div>';

    $read = gh_get_text($page);
    if (!$read['ok']) {
        echo '<div class="card"><p class="flash flash--err">' . h($read['error']) . '</p></div>';
        layout_foot();
        exit;
    }

    echo '<div class="card">';
    echo '<h2>' . h(TEXT_FILES[$page]) . '</h2>';
    echo '<p class="muted lead-text">Это исходник страницы. Текст правится прямо здесь, между угловыми скобками — то разметка, её лучше не трогать: <code>&lt;h2&gt;Заголовок&lt;/h2&gt;</code> — правьте «Заголовок». Если разметка всё же сломается, сайт не обновится: выкладывается только то, что собралось.</p>';
    echo '<form method="post" class="form">' . csrf_field();
    echo '<input type="hidden" name="action" value="text">';
    echo '<input type="hidden" name="path" value="' . h($page) . '">';
    echo '<label class="sr-only" for="body">Исходник страницы</label>';
    echo '<textarea id="body" name="body" class="code-area" rows="28" spellcheck="false">' . h($read['text']) . '</textarea>';
    echo '<button class="btn" type="submit">Сохранить страницу</button>';
    echo '</form></div>';
    layout_foot();
    exit;
}

/* ---------- данные ---------- */
$file = FILES[$tab];
$read = gh_get_json($file['path']);
if (!$read['ok']) {
    echo '<div class="card"><p class="flash flash--err">' . h($read['error']) . '</p></div>';
    layout_foot();
    exit;
}
$data = $read['data'];

/* Готовые файлы в репозитории: выбирать из списка надёжнее, чем
   вписывать путь руками. */
$videoFiles  = $tab === 'videos' ? gh_list_dir('assets/video', '.mp4') : [];
$posterFiles = $tab === 'videos' ? gh_list_dir('assets/img/video') : [];

$pick = static function (string $name, array $files, string $current, string $dir): void {
    echo '<label>' . ($dir === 'assets/video' ? 'Файл видео' : 'Обложка');
    if ($files) {
        echo '<select name="' . h($name) . '"><option value="">— оставить как есть —</option>';
        foreach ($files as $f) {
            $path = '/' . $dir . '/' . $f;
            $sel  = $path === $current ? ' selected' : '';
            echo '<option value="' . h($path) . '"' . $sel . '>' . h($f) . '</option>';
        }
        echo '</select>';
    } else {
        echo '<input name="' . h($name) . '" value="' . h($current) . '" placeholder="/' . h($dir) . '/файл">';
    }
    echo '<small>Сейчас: ' . h($current ?: 'не задано') . '</small></label>';
};

echo '<form method="post">' . csrf_field() . '<input type="hidden" name="action" value="save">';

if ($tab === 'pricing') {
    echo '<div class="card"><h2>Ставки за м²</h2><div class="form">';
    foreach (['standart' => 'Стандарт', 'komfort' => 'Комфорт', 'pod_kluch' => 'Под ключ'] as $key => $label) {
        echo '<label>' . h($label) . ', ₽ за м²<input name="f[rate][' . h($key) . ']" inputmode="numeric" value="'
            . h((string) ($data['ratePerM2'][$key] ?? '')) . '"></label>';
    }
    echo '</div></div>';
    if (!empty($data['terms'])) {
        echo '<div class="card"><h2>Сроки</h2><div class="form">';
        foreach ($data['terms'] as $i => $term) {
            echo '<label>' . h((string) ($term['label'] ?? ('Срок ' . ($i + 1))))
                . '<input name="f[term][' . (int) $i . ']" value="' . h((string) ($term['text'] ?? '')) . '"></label>';
        }
        echo '</div></div>';
    }
}

if ($tab === 'projects') {
    foreach ($data as $i => $row) {
        echo '<div class="card"><div class="head"><h2>' . h((string) ($row['name'] ?? 'Проект')) . '</h2>';
        echo '<span class="muted">' . h((string) ($row['slug'] ?? '')) . '</span></div><div class="form">';
        echo '<label>Название<input name="f[p][' . (int) $i . '][name]" value="' . h((string) ($row['name'] ?? '')) . '"></label>';
        echo '<div class="row2">';
        echo '<label>Площадь, м²<input name="f[p][' . (int) $i . '][area]" inputmode="numeric" value="' . h((string) ($row['area'] ?? '')) . '"></label>';
        echo '<label>Габариты<input name="f[p][' . (int) $i . '][size]" value="' . h((string) ($row['size'] ?? '')) . '" placeholder="8×10"></label>';
        echo '</div><div class="row2">';
        echo '<label>Этажей<input name="f[p][' . (int) $i . '][floors]" value="' . h((string) ($row['floors'] ?? '')) . '" placeholder="1, 1.5, 2"></label>';
        echo '<label>Спален<input name="f[p][' . (int) $i . '][bedrooms]" inputmode="numeric" value="' . h((string) ($row['bedrooms'] ?? '')) . '"></label>';
        echo '</div>';
        echo '<label>Цена, ₽<input name="f[p][' . (int) $i . '][price]" inputmode="numeric" value="' . h((string) ($row['price'] ?? '')) . '"><small>Пусто — цена считается по ставке за м².</small></label>';
        echo '<label>Описание<textarea name="f[p][' . (int) $i . '][note]" rows="3">' . h((string) ($row['note'] ?? '')) . '</textarea></label>';
        echo '</div></div>';
    }
}

if ($tab === 'cases') {
    foreach ($data as $i => $row) {
        $photos = count((array) ($row['photos'] ?? []));
        echo '<div class="card"><div class="head"><h2>' . h((string) ($row['title'] ?? 'Объект')) . '</h2>';
        echo '<span class="muted">фотографий: ' . $photos . '</span></div><div class="form">';
        echo '<label>Название<input name="f[c][' . (int) $i . '][title]" value="' . h((string) ($row['title'] ?? '')) . '"></label>';
        echo '<label>Где построен<input name="f[c][' . (int) $i . '][place]" value="' . h((string) ($row['place'] ?? '')) . '"></label>';
        echo '<label>Описание<textarea name="f[c][' . (int) $i . '][lead]" rows="3">' . h((string) ($row['lead'] ?? '')) . '</textarea></label>';
        echo '<label>Обложка<input name="f[c][' . (int) $i . '][cover]" value="' . h((string) ($row['cover'] ?? '')) . '" placeholder="имя файла из фотографий объекта"><small>Фотографии добавляю я: пришлите архив и скажите, к какому объекту.</small></label>';
        echo '</div></div>';
    }
}

if ($tab === 'videos') {
    foreach ($data as $i => $row) {
        echo '<div class="card"><div class="head"><h2>' . h((string) ($row['title'] ?? 'Видео')) . '</h2></div><div class="form">';
        echo '<label>Название<input name="f[v][' . (int) $i . '][title]" value="' . h((string) ($row['title'] ?? '')) . '"></label>';
        echo '<label>Подпись<textarea name="f[v][' . (int) $i . '][note]" rows="2">' . h((string) ($row['note'] ?? '')) . '</textarea></label>';
        echo '<div class="row2">';
        echo '<label>Длительность<input name="f[v][' . (int) $i . '][length]" value="' . h((string) ($row['length'] ?? '')) . '" placeholder="1:20"></label>';
        echo '<label class="check"><input type="checkbox" name="f[v][' . (int) $i . '][portrait]" value="1"' . (!empty($row['portrait']) ? ' checked' : '') . '> Вертикальное</label>';
        echo '</div>';
        $pick('f[v][' . $i . '][src]', $videoFiles, (string) ($row['src'] ?? ''), 'assets/video');
        $pick('f[v][' . $i . '][poster]', $posterFiles, (string) ($row['poster'] ?? ''), 'assets/img/video');
        echo '</div></div>';
    }
}

echo '<p><button class="btn" type="submit">Сохранить изменения</button></p></form>';

/* ---------- добавление и удаление ---------- */
if ($tab !== 'pricing') {
    $what = ['projects' => 'проект', 'cases' => 'объект', 'videos' => 'видео'][$tab];

    echo '<div class="card"><h2>Добавить ' . h($what) . '</h2>';
    echo '<form method="post" class="form">' . csrf_field() . '<input type="hidden" name="action" value="add">';
    echo '<label>Название<input name="name" required placeholder="' .
        h($tab === 'projects' ? 'Берёзовая, 120 м²' : ($tab === 'cases' ? 'Дом в Бурашево' : 'Как мы собираем каркас')) . '"></label>';

    if ($tab === 'projects') {
        echo '<div class="row2">';
        echo '<label>Площадь, м²<input name="area" inputmode="numeric" placeholder="120"></label>';
        echo '<label>Габариты<input name="size" placeholder="8×10"></label>';
        echo '</div><div class="row2">';
        echo '<label>Этажей<input name="floors" placeholder="1, 1.5, 2"></label>';
        echo '<label>Спален<input name="bedrooms" inputmode="numeric" placeholder="3"></label>';
        echo '</div>';
        echo '<label>Цена, ₽<input name="price" inputmode="numeric" placeholder="пусто — посчитается по ставке"></label>';
        echo '<label>Описание<textarea name="note" rows="3"></textarea></label>';
        echo '<p class="muted">Визуализации и планировки добавляю я: пришлите файлы, и проект появится на сайте полностью.</p>';
    } elseif ($tab === 'cases') {
        echo '<label>Где построен<input name="place" placeholder="Бурашево, Калининский район"></label>';
        echo '<label>Описание<textarea name="note" rows="3"></textarea></label>';
        echo '<p class="muted">Фотографии пришлите архивом — разложу по группам и поставлю обложку.</p>';
    } else {
        echo '<label>Подпись<textarea name="note" rows="2"></textarea></label>';
        echo '<label>Длительность<input name="length" placeholder="1:20"></label>';
        $pick('src', $videoFiles, '', 'assets/video');
        $pick('poster', $posterFiles, '', 'assets/img/video');
        echo '<label class="check"><input type="checkbox" name="portrait" value="1"> Вертикальное</label>';
    }
    echo '<button class="btn" type="submit">Добавить</button></form></div>';

    echo '<div class="card"><h2>Удалить</h2>';
    echo '<p class="muted lead-text">Запись пропадёт с сайта после ближайшей сборки. Отменить можно: правка сохраняется коммитом, история остаётся.</p>';
    foreach ($data as $i => $row) {
        $label = (string) ($row['name'] ?? $row['title'] ?? ('Запись ' . ($i + 1)));
        echo '<form method="post" class="del-row" onsubmit="return confirm(\'Удалить: ' . h(addslashes($label)) . '?\')">' . csrf_field();
        echo '<input type="hidden" name="action" value="del"><input type="hidden" name="index" value="' . (int) $i . '">';
        echo '<span>' . h($label) . '</span><button class="btn btn--ghost btn--small" type="submit">Удалить</button>';
        echo '</form>';
    }
    echo '</div>';
}

layout_foot();
