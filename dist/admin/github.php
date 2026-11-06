<?php
/*  Связь с репозиторием.
 *
 *  Правки из админки не пишутся на сервер напрямую: они уезжают
 *  в репозиторий обычным коммитом, после чего срабатывает сборка и
 *  выгрузка — тот же путь, которым идут правки разработчика. Поэтому
 *  у каждой правки есть автор, время и возможность отката, а сайт
 *  никогда не расходится с исходниками.
 *
 *  Нужен токен GitHub с правом записи в репозиторий (fine-grained:
 *  Contents → Read and write). Хранится в api/settings.json на сервере.
 */

declare(strict_types=1);

function gh_settings(): array
{
    $all = settings_all();
    return [
        'token'  => (string) ($all['github_token'] ?? ''),
        'repo'   => (string) ($all['github_repo'] ?? 'dkaratsapov-web/karkas_comfort'),
        'branch' => (string) ($all['github_branch'] ?? 'claude/karkas-comfort-redesign-0zy3xi'),
    ];
}

function gh_ready(): bool
{
    $s = gh_settings();
    return $s['token'] !== '' && $s['repo'] !== '';
}

/* Один запрос к API. Возвращает [код ответа, разобранное тело]. */
function gh_request(string $method, string $path, ?array $body = null): array
{
    $s  = gh_settings();
    $ch = curl_init('https://api.github.com' . $path);
    $headers = [
        'Accept: application/vnd.github+json',
        'X-GitHub-Api-Version: 2022-11-28',
        'User-Agent: karkas-comfort-admin',
    ];
    if ($s['token'] !== '') $headers[] = 'Authorization: Bearer ' . $s['token'];
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST  => $method,
        CURLOPT_HTTPHEADER     => $headers,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 25,
    ]);
    if ($body !== null) {
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
        $headers[] = 'Content-Type: application/json';
        curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
    }
    $answer = (string) curl_exec($ch);
    $code   = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $error  = curl_error($ch);
    curl_close($ch);
    if ($code === 0) return [0, ['message' => 'Нет связи с GitHub: ' . $error]];
    $data = json_decode($answer, true);
    return [$code, is_array($data) ? $data : []];
}

/* Почему GitHub ответил «не найдено». У токена без доступа к нужному
   репозиторию ответ тот же 404, что и у опечатки в пути, поэтому
   голое «Not Found» в админке ничего не объясняет: проверяем по
   шагам — виден ли токену репозиторий, есть ли ветка, есть ли файл. */
function gh_why(string $path, int $code, array $data): string
{
    $s   = gh_settings();
    $msg = (string) ($data['message'] ?? '');

    if ($code === 401) {
        return 'GitHub не принял токен: он просрочен или отозван. Создайте новый и впишите заново.';
    }
    if ($code === 403) {
        return 'GitHub отказал в доступе: у токена нет права Contents: Read and write на этот репозиторий.';
    }
    if ($code !== 404) {
        return 'GitHub ответил ' . $code . ($msg !== '' ? ': ' . $msg : '');
    }

    [$repoCode] = gh_request('GET', '/repos/' . $s['repo']);
    if ($repoCode === 404) {
        return 'Токен не видит репозиторий ' . $s['repo'] . '. У приватного репозитория GitHub отвечает «не найдено»'
            . ' и когда доступа нет, поэтому проверьте в настройках токена: Repository access → Only select repositories → '
            . $s['repo'] . ', и Permissions → Repository permissions → Contents: Read and write.';
    }
    if ($repoCode !== 200) {
        return 'Репозиторий ' . $s['repo'] . ' отвечает ' . $repoCode . ' — проверьте имя репозитория в поле выше.';
    }

    [$branchCode] = gh_request('GET', '/repos/' . $s['repo'] . '/branches/' . rawurlencode($s['branch']));
    if ($branchCode === 404) {
        return 'В репозитории нет ветки «' . $s['branch'] . '» — проверьте её имя в поле выше.';
    }

    return 'В ветке «' . $s['branch'] . '» нет файла ' . $path . '. Он появится после ближайшей выкладки сайта.';
}

/* Файл данных из репозитория: содержимое плюс sha — без него GitHub
   не примет запись, и это же защищает от затирания чужой правки. */
function gh_get_json(string $path): array
{
    $s = gh_settings();
    [$code, $data] = gh_request('GET', '/repos/' . $s['repo'] . '/contents/' . rawurlencode_path($path) . '?ref=' . rawurlencode($s['branch']));
    if ($code !== 200 || empty($data['content'])) {
        return ['ok' => false, 'error' => gh_why($path, $code, $data)];
    }
    $raw = base64_decode(str_replace("\n", '', (string) $data['content']));
    $json = json_decode($raw, true);
    if (!is_array($json)) return ['ok' => false, 'error' => 'Файл ' . $path . ' не разобрался как JSON'];
    return ['ok' => true, 'data' => $json, 'sha' => (string) $data['sha']];
}

function gh_put_json(string $path, array $data, string $sha, string $message): array
{
    $s    = gh_settings();
    $body = json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n";
    [$code, $answer] = gh_request('PUT', '/repos/' . $s['repo'] . '/contents/' . rawurlencode_path($path), [
        'message' => $message,
        'content' => base64_encode($body),
        'sha'     => $sha,
        'branch'  => $s['branch'],
    ]);
    if ($code === 409 || $code === 422) {
        return ['ok' => false, 'error' => 'Файл изменился, пока вы правили. Обновите страницу и повторите.'];
    }
    if ($code !== 200 && $code !== 201) {
        return ['ok' => false, 'error' => gh_why($path, $code, $answer)];
    }
    return ['ok' => true];
}

/* Обычный файл: страницы сайта тоже правятся отсюда, а они не JSON. */
function gh_get_text(string $path): array
{
    $s = gh_settings();
    [$code, $data] = gh_request('GET', '/repos/' . $s['repo'] . '/contents/' . rawurlencode_path($path) . '?ref=' . rawurlencode($s['branch']));
    if ($code !== 200 || empty($data['content'])) {
        return ['ok' => false, 'error' => gh_why($path, $code, $data)];
    }
    return [
        'ok'   => true,
        'text' => base64_decode(str_replace("\n", '', (string) $data['content'])),
        'sha'  => (string) $data['sha'],
    ];
}

function gh_put_text(string $path, string $text, string $sha, string $message): array
{
    $s = gh_settings();
    [$code, $answer] = gh_request('PUT', '/repos/' . $s['repo'] . '/contents/' . rawurlencode_path($path), [
        'message' => $message,
        'content' => base64_encode($text),
        'sha'     => $sha,
        'branch'  => $s['branch'],
    ]);
    if ($code === 409 || $code === 422) {
        return ['ok' => false, 'error' => 'Файл изменился, пока вы правили. Обновите страницу и повторите.'];
    }
    if ($code !== 200 && $code !== 201) {
        return ['ok' => false, 'error' => gh_why($path, $code, $answer)];
    }
    return ['ok' => true];
}

/* Что лежит в каталоге: нужен, чтобы в админке выбирать готовый файл
   из репозитория, а не вписывать путь руками и ошибаться. */
function gh_list_dir(string $path, string $ext = ''): array
{
    $s = gh_settings();
    [$code, $data] = gh_request('GET', '/repos/' . $s['repo'] . '/contents/' . rawurlencode_path($path) . '?ref=' . rawurlencode($s['branch']));
    if ($code !== 200 || !is_array($data)) return [];
    $out = [];
    foreach ($data as $row) {
        if (($row['type'] ?? '') !== 'file') continue;
        $name = (string) ($row['name'] ?? '');
        if ($ext !== '' && !str_ends_with(mb_strtolower($name), $ext)) continue;
        $out[] = $name;
    }
    sort($out);
    return $out;
}

/* Косые в пути оставляем как есть, остальное экранируем. */
function rawurlencode_path(string $path): string
{
    return implode('/', array_map('rawurlencode', explode('/', $path)));
}

/* Что сейчас со сборкой: по ней видно, доехала правка до сайта или нет. */
function gh_last_run(): array
{
    $s = gh_settings();
    [$code, $data] = gh_request('GET', '/repos/' . $s['repo'] . '/actions/runs?per_page=5&branch=' . rawurlencode($s['branch']));
    if ($code !== 200 || empty($data['workflow_runs'])) return ['ok' => false];
    foreach ($data['workflow_runs'] as $run) {
        if (($run['name'] ?? '') !== 'Preview site') continue;
        return [
            'ok'      => true,
            'status'  => (string) $run['status'],
            'result'  => (string) ($run['conclusion'] ?? ''),
            'at'      => (string) $run['created_at'],
            'title'   => (string) ($run['display_title'] ?? ''),
            'url'     => (string) $run['html_url'],
        ];
    }
    return ['ok' => false];
}
