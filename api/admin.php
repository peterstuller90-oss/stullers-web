<?php
/*
 * Štullers – serverová časť administrácie (admin/).
 * Prihlásenie s reláciou, ochrana pred podvrhnutými požiadavkami (CSRF), koncept, zverejnenie,
 * história verzií, nahrávanie médií, rebríček hráčov, vypínanie menu a zadania workshopov.
 */
require __DIR__ . '/lib.php';
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');
header('Referrer-Policy: same-origin');
st_ensure_dirs();

define('SESSION_IDLE', 8 * 3600);        // po 8 hodinách nečinnosti odhlási
define('HISTORY_KEEP', 60);              // počet uchovaných verzií
define('TRASH_DAYS', 30);
define('MAX_IMAGE', 25 * 1024 * 1024);
define('MAX_VIDEO', 200 * 1024 * 1024);

function out($code, $arr) {
    http_response_code($code);
    $arr['stullers'] = true;
    echo json_encode($arr, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}
function body_json($max = 4194304) {
    $raw = file_get_contents('php://input');
    if ($raw === false || strlen($raw) > $max) { out(413, array('ok' => false, 'error' => 'too_large')); }
    $j = json_decode($raw, true);
    return is_array($j) ? $j : array();
}

/* ---------- relácia ---------- */
session_name('stullers_admin');
session_set_cookie_params(array(
    'lifetime' => 0,
    'path' => rtrim(dirname(dirname($_SERVER['SCRIPT_NAME'])), '/\\') . '/',
    'secure' => st_is_https(),
    'httponly' => true,
    'samesite' => 'Strict',
));
session_start();
if (!empty($_SESSION['uid']) && (time() - (int)$_SESSION['last']) > SESSION_IDLE) {
    $_SESSION = array();
    session_regenerate_id(true);
}
if (empty($_SESSION['csrf'])) { $_SESSION['csrf'] = bin2hex(random_bytes(32)); }

function logged_in() { return !empty($_SESSION['uid']); }
function require_login() {
    if (!logged_in()) { out(401, array('ok' => false, 'error' => 'login_required')); }
    $_SESSION['last'] = time();
    if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
        $t = isset($_SERVER['HTTP_X_CSRF_TOKEN']) ? (string)$_SERVER['HTTP_X_CSRF_TOKEN'] : '';
        if ($t === '' || !hash_equals($_SESSION['csrf'], $t)) { out(403, array('ok' => false, 'error' => 'csrf')); }
    }
}
function auth_data() { return st_read_data('auth', null); }

// inštalačný kód: pri prvom spustení sa vytvorí súbor data/INSTALACNY-KOD.txt,
// ktorý vieš otvoriť len cez správcu súborov / FTP na Websupporte – nie cez prehliadač
function install_code() {
    $f = ST_DATA . '/INSTALACNY-KOD.txt';
    if (!is_file($f)) {
        $code = strtoupper(substr(bin2hex(random_bytes(8)), 0, 10));
        @file_put_contents($f, "Inštalačný kód pre administráciu Štullers:\n\n" . $code . "\n\nPo nastavení hesla sa tento súbor sám zmaže.\n");
        @chmod($f, 0600);
    }
    if (!preg_match('/\n\n([A-F0-9]{10})\n/', (string)@file_get_contents($f), $m)) { return ''; }
    return $m[1];
}

$action = isset($_GET['action']) ? (string)$_GET['action'] : '';
$method = $_SERVER['REQUEST_METHOD'];

/* ---------- stav, inštalácia, prihlásenie ---------- */

if ($action === 'state' && $method === 'GET') {
    $installed = is_array(auth_data());
    if (!$installed) { install_code(); }
    if (logged_in()) { $_SESSION['last'] = time(); }
    out(200, array('ok' => true, 'installed' => $installed, 'loggedIn' => logged_in(),
        'csrf' => $_SESSION['csrf'], 'https' => st_is_https()));
}

if ($action === 'install' && $method === 'POST') {
    if (is_array(auth_data())) { out(409, array('ok' => false, 'error' => 'already_installed')); }
    if (!st_rate_hit('install', 5, 900)) { out(429, array('ok' => false, 'error' => 'rate_limited')); }
    $b = body_json(8192);
    $code = strtoupper(trim((string)(isset($b['code']) ? $b['code'] : '')));
    $pw = (string)(isset($b['password']) ? $b['password'] : '');
    $expect = install_code();
    if ($expect === '' || !hash_equals($expect, $code)) { usleep(600000); out(403, array('ok' => false, 'error' => 'bad_code')); }
    if (strlen($pw) < 10) { out(422, array('ok' => false, 'error' => 'weak_password')); }
    if (!st_write_data('auth', array('hash' => password_hash($pw, PASSWORD_DEFAULT), 'at' => date('c')))) {
        out(500, array('ok' => false, 'error' => 'write_failed'));
    }
    @unlink(ST_DATA . '/INSTALACNY-KOD.txt');
    // prvé spustenie: zverejnený obsah = obsah dnešného webu
    if (!is_file(ST_DATA . '/published.data.php')) { st_write_data('published', st_defaults()); }
    session_regenerate_id(true);
    $_SESSION['uid'] = 'stullers';
    $_SESSION['last'] = time();
    $_SESSION['csrf'] = bin2hex(random_bytes(32));
    out(200, array('ok' => true, 'csrf' => $_SESSION['csrf']));
}

if ($action === 'login' && $method === 'POST') {
    $a = auth_data();
    if (!is_array($a)) { out(409, array('ok' => false, 'error' => 'not_installed')); }
    // najviac 5 neúspešných pokusov za 15 minút
    $lockFile = ST_DATA . '/rate-login-' . md5(st_client_ip()) . '.txt';
    $fails = array();
    if (is_file($lockFile)) { foreach (explode(',', (string)@file_get_contents($lockFile)) as $t) { if ((int)$t > time() - 900) { $fails[] = (int)$t; } } }
    if (count($fails) >= 5) { out(429, array('ok' => false, 'error' => 'rate_limited', 'retryAfter' => 900 - (time() - min($fails)))); }
    $b = body_json(8192);
    $pw = (string)(isset($b['password']) ? $b['password'] : '');
    if ($pw === '' || !password_verify($pw, $a['hash'])) {
        $fails[] = time();
        @file_put_contents($lockFile, implode(',', $fails), LOCK_EX);
        usleep(700000);
        out(403, array('ok' => false, 'error' => 'bad_password', 'left' => max(0, 5 - count($fails))));
    }
    @unlink($lockFile);
    if (password_needs_rehash($a['hash'], PASSWORD_DEFAULT)) { $a['hash'] = password_hash($pw, PASSWORD_DEFAULT); st_write_data('auth', $a); }
    session_regenerate_id(true);
    $_SESSION['uid'] = 'stullers';
    $_SESSION['last'] = time();
    $_SESSION['csrf'] = bin2hex(random_bytes(32));
    out(200, array('ok' => true, 'csrf' => $_SESSION['csrf']));
}

if ($action === 'logout' && $method === 'POST') {
    $_SESSION = array();
    session_destroy();
    out(200, array('ok' => true));
}

/* ---------- všetko nižšie len po prihlásení ---------- */
require_login();

if ($action === 'password' && $method === 'POST') {
    $b = body_json(8192);
    $a = auth_data();
    if (!password_verify((string)(isset($b['old']) ? $b['old'] : ''), $a['hash'])) { usleep(600000); out(403, array('ok' => false, 'error' => 'bad_password')); }
    $new = (string)(isset($b['new']) ? $b['new'] : '');
    if (strlen($new) < 10) { out(422, array('ok' => false, 'error' => 'weak_password')); }
    $a['hash'] = password_hash($new, PASSWORD_DEFAULT);
    $a['changed'] = date('c');
    st_write_data('auth', $a);
    out(200, array('ok' => true));
}

/* ---------- obsah: koncept, zverejnenie, história ---------- */

function purge_trash(&$c) {
    if (!isset($c['trash']) || !is_array($c['trash'])) { $c['trash'] = array(); return; }
    $limit = time() - TRASH_DAYS * 86400;
    $c['trash'] = array_values(array_filter($c['trash'], function ($t) use ($limit) {
        return is_array($t) && isset($t['deletedAt']) && strtotime($t['deletedAt']) > $limit;
    }));
}
function meta() {
    $m = st_read_data('meta', array());
    return array_merge(array('draftRev' => 0, 'draftSavedAt' => null, 'publishedAt' => null, 'dirty' => false), $m);
}

if ($action === 'content' && $method === 'GET') {
    $m = meta();
    out(200, array('ok' => true, 'content' => st_draft(), 'meta' => $m));
}

if ($action === 'defaults' && $method === 'GET') {
    $i18n = json_decode((string)@file_get_contents(ST_ROOT . '/defaults/i18n.json'), true);
    out(200, array('ok' => true, 'i18n' => is_array($i18n) ? $i18n : array()));
}

if ($action === 'save' && $method === 'POST') {
    $b = body_json();
    $c = isset($b['content']) ? $b['content'] : null;
    if (!is_array($c) || !isset($c['site']) || !is_array($c['site'])) { out(422, array('ok' => false, 'error' => 'invalid')); }
    $m = meta();
    $base = isset($b['rev']) ? (int)$b['rev'] : -1;
    if ($base !== (int)$m['draftRev'] && empty($b['force'])) {
        out(409, array('ok' => false, 'error' => 'conflict', 'meta' => $m));
    }
    purge_trash($c);
    $c['v'] = 1;
    if (!st_write_data('draft', $c)) { out(500, array('ok' => false, 'error' => 'write_failed')); }
    $m['draftRev'] = (int)$m['draftRev'] + 1;
    $m['draftSavedAt'] = date('c');
    $m['dirty'] = true;
    st_write_data('meta', $m);
    out(200, array('ok' => true, 'meta' => $m));
}

function save_history($c, $label) {
    $id = date('Ymd-His') . '-' . substr(bin2hex(random_bytes(3)), 0, 4);
    st_write_data('history/' . $id, array('label' => $label, 'at' => date('c'), 'content' => $c));
    $files = glob(ST_DATA . '/history/*.data.php');
    if (is_array($files) && count($files) > HISTORY_KEEP) {
        sort($files);
        foreach (array_slice($files, 0, count($files) - HISTORY_KEEP) as $f) { @unlink($f); }
    }
    return $id;
}

if ($action === 'publish' && $method === 'POST') {
    $b = body_json(8192);
    $m = meta();
    if (isset($b['rev']) && (int)$b['rev'] !== (int)$m['draftRev']) { out(409, array('ok' => false, 'error' => 'conflict', 'meta' => $m)); }
    $draft = st_draft();
    save_history(st_published(), 'Pred zverejnením');
    if (!st_write_data('published', $draft)) { out(500, array('ok' => false, 'error' => 'write_failed')); }
    $m['publishedAt'] = date('c');
    $m['dirty'] = false;
    st_write_data('meta', $m);
    out(200, array('ok' => true, 'meta' => $m));
}

if ($action === 'discard' && $method === 'POST') {
    $m = meta();
    @unlink(ST_DATA . '/draft.data.php');
    $m['draftRev'] = (int)$m['draftRev'] + 1;
    $m['dirty'] = false;
    st_write_data('meta', $m);
    out(200, array('ok' => true, 'content' => st_published(), 'meta' => $m));
}

if ($action === 'history' && $method === 'GET') {
    $list = array();
    foreach ((array)glob(ST_DATA . '/history/*.data.php') as $f) {
        $id = basename($f, '.data.php');
        $h = st_read_data('history/' . $id, array());
        $list[] = array('id' => $id, 'at' => isset($h['at']) ? $h['at'] : '', 'label' => isset($h['label']) ? $h['label'] : '');
    }
    usort($list, function ($a, $b) { return strcmp($b['id'], $a['id']); });
    out(200, array('ok' => true, 'history' => $list, 'meta' => meta()));
}

if ($action === 'restore' && $method === 'POST') {
    $b = body_json(8192);
    $id = isset($b['id']) ? (string)$b['id'] : '';
    if (!preg_match('/^\d{8}-\d{6}-[a-f0-9]{4}$/', $id)) { out(422, array('ok' => false, 'error' => 'invalid')); }
    $h = st_read_data('history/' . $id, null);
    if (!is_array($h) || !isset($h['content'])) { out(404, array('ok' => false, 'error' => 'not_found')); }
    save_history(st_published(), 'Pred obnovením verzie');
    st_write_data('published', $h['content']);
    st_write_data('draft', $h['content']);
    $m = meta();
    $m['draftRev'] = (int)$m['draftRev'] + 1;
    $m['publishedAt'] = date('c');
    $m['dirty'] = false;
    st_write_data('meta', $m);
    out(200, array('ok' => true, 'content' => $h['content'], 'meta' => $m));
}

/* ---------- médiá ---------- */

function used_paths() {
    $s = json_encode(st_draft()) . json_encode(st_published());
    return $s;
}
function media_list() {
    $out = array();
    $root = ST_ROOT . '/media';
    $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS));
    foreach ($it as $f) {
        if (!$f->isFile()) { continue; }
        $name = $f->getFilename();
        if ($name[0] === '.' || $name === 'index.html') { continue; }
        $rel = 'media/' . str_replace('\\', '/', substr($f->getPathname(), strlen($root) + 1));
        $out[] = array('path' => $rel, 'size' => $f->getSize(), 'at' => date('c', $f->getMTime()),
            'uploaded' => strpos($rel, 'media/uploads/') === 0);
    }
    return $out;
}

if ($action === 'media' && $method === 'GET') {
    $used = used_paths();
    $list = media_list();
    foreach ($list as &$m) { $m['used'] = strpos($used, str_replace('/', '\\/', $m['path'])) !== false || strpos($used, $m['path']) !== false; }
    unset($m);
    usort($list, function ($a, $b) { return strcmp($b['at'], $a['at']); });
    out(200, array('ok' => true, 'media' => $list));
}

if ($action === 'upload' && $method === 'POST') {
    if (!st_rate_hit('upload', 300, 3600)) { out(429, array('ok' => false, 'error' => 'rate_limited')); }
    if (empty($_FILES['file']) || !is_array($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
        $err = isset($_FILES['file']['error']) ? (int)$_FILES['file']['error'] : -1;
        out(400, array('ok' => false, 'error' => ($err === UPLOAD_ERR_INI_SIZE || $err === UPLOAD_ERR_FORM_SIZE) ? 'too_large' : 'upload_failed'));
    }
    $tmp = $_FILES['file']['tmp_name'];
    if (!is_uploaded_file($tmp)) { out(400, array('ok' => false, 'error' => 'upload_failed')); }
    $allowed = array(
        'image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp', 'image/gif' => 'gif',
        'video/mp4' => 'mp4', 'video/webm' => 'webm',
    );
    $mime = '';
    if (function_exists('finfo_open')) { $fi = finfo_open(FILEINFO_MIME_TYPE); $mime = (string)finfo_file($fi, $tmp); finfo_close($fi); }
    if (!isset($allowed[$mime])) { out(415, array('ok' => false, 'error' => 'bad_type')); }
    $ext = $allowed[$mime];
    $origExt = strtolower(pathinfo((string)$_FILES['file']['name'], PATHINFO_EXTENSION));
    $okExt = array('jpg' => array('jpg', 'jpeg'), 'png' => array('png'), 'webp' => array('webp'), 'gif' => array('gif'), 'mp4' => array('mp4', 'm4v'), 'webm' => array('webm'));
    if ($origExt !== '' && !in_array($origExt, $okExt[$ext], true)) { out(415, array('ok' => false, 'error' => 'bad_type')); }
    $size = filesize($tmp);
    $isVideo = strpos($mime, 'video/') === 0;
    if ($size > ($isVideo ? MAX_VIDEO : MAX_IMAGE)) { out(413, array('ok' => false, 'error' => 'too_large')); }
    if (!$isVideo && @getimagesize($tmp) === false) { out(415, array('ok' => false, 'error' => 'bad_type')); }
    // čitateľný názov z pôvodného súboru + náhodný kód (nedá sa uhádnuť ani prepísať)
    $base = strtolower(pathinfo((string)(isset($_POST['name']) && $_POST['name'] !== '' ? $_POST['name'] : $_FILES['file']['name']), PATHINFO_FILENAME));
    if (function_exists('iconv')) { $t = @iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $base); if ($t !== false) { $base = $t; } }
    $base = trim(preg_replace('/[^a-z0-9]+/', '-', $base), '-');
    if ($base === '') { $base = 'subor'; }
    $base = substr($base, 0, 50);
    $dir = ST_UPLOADS . '/' . date('Y/m');
    if (!is_dir($dir)) { @mkdir($dir, 0755, true); }
    $name = $base . '-' . bin2hex(random_bytes(4)) . '.' . $ext;
    if (!@move_uploaded_file($tmp, $dir . '/' . $name)) { out(500, array('ok' => false, 'error' => 'write_failed')); }
    @chmod($dir . '/' . $name, 0644);
    out(200, array('ok' => true, 'path' => 'media/uploads/' . date('Y/m') . '/' . $name, 'size' => $size, 'mime' => $mime));
}

if ($action === 'media_delete' && $method === 'POST') {
    $b = body_json(8192);
    $path = isset($b['path']) ? (string)$b['path'] : '';
    if (!preg_match('#^media/uploads/\d{4}/\d{2}/[a-z0-9-]+\.(jpg|png|webp|gif|mp4|webm)$#', $path)) { out(422, array('ok' => false, 'error' => 'invalid')); }
    $used = used_paths();
    if (strpos($used, str_replace('/', '\\/', $path)) !== false || strpos($used, $path) !== false) { out(409, array('ok' => false, 'error' => 'in_use')); }
    $f = ST_ROOT . '/' . $path;
    if (is_file($f)) { @unlink($f); }
    out(200, array('ok' => true));
}

/* ---------- rebríček, menu, workshopy ---------- */

if ($action === 'scores' && $method === 'GET') {
    $list = st_read_lines('scores');
    usort($list, function ($a, $b) {
        $d = (int)$b['score'] - (int)$a['score'];
        return $d !== 0 ? $d : strcmp((string)$a['at'], (string)$b['at']);
    });
    out(200, array('ok' => true, 'scores' => $list));
}

if ($action === 'menu' && $method === 'POST') {
    $b = body_json(8192);
    $s = st_read_data('settings', array());
    $s['menuLocked'] = !empty($b['locked']);
    $s['menuAt'] = date('c');
    if (!st_write_data('settings', $s)) { out(500, array('ok' => false, 'error' => 'write_failed')); }
    out(200, array('ok' => true, 'locked' => $s['menuLocked']));
}
if ($action === 'menu' && $method === 'GET') {
    $s = st_read_data('settings', array());
    out(200, array('ok' => true, 'locked' => !empty($s['menuLocked'])));
}

if ($action === 'workshops' && $method === 'GET') {
    $list = array_reverse(st_read_lines('workshops'));
    out(200, array('ok' => true, 'requests' => $list));
}

out(400, array('ok' => false, 'error' => 'unknown_action'));
