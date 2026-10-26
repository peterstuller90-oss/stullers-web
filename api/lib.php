<?php
/*
 * Štullers – spoločné funkcie pre web, administráciu a hru.
 * Všetky dáta sú v priečinku data/ (vedľa index.php). Priečinok je zamknutý pre prehliadač
 * (.htaccess) a citlivé súbory majú príponu .php a začínajú príkazom exit.
 */
if (!defined('STULLERS')) { define('STULLERS', 1); }
date_default_timezone_set('Europe/Bratislava');

define('ST_ROOT', dirname(__DIR__));
define('ST_DATA', ST_ROOT . '/data');
define('ST_UPLOADS', ST_ROOT . '/media/uploads');
define('ST_GUARD', '<' . "?php exit; ?" . ">\n");

function st_ensure_dirs() {
    foreach (array(ST_DATA, ST_DATA . '/history', ST_UPLOADS) as $d) {
        if (!is_dir($d)) { @mkdir($d, 0755, true); }
    }
    $deny = "Require all denied\n<IfModule !mod_authz_core.c>\nDeny from all\n</IfModule>\n";
    if (!is_file(ST_DATA . '/.htaccess')) { @file_put_contents(ST_DATA . '/.htaccess', $deny); }
    if (!is_file(ST_DATA . '/index.html')) { @file_put_contents(ST_DATA . '/index.html', ''); }
}

/* ---------- súbory ---------- */

// zápis naraz: najprv dočasný súbor, potom premenovanie – pri výpadku sa pôvodný súbor nepoškodí
function st_write_atomic($file, $content) {
    $tmp = $file . '.tmp-' . bin2hex(random_bytes(4));
    if (@file_put_contents($tmp, $content, LOCK_EX) === false) { return false; }
    if (!@rename($tmp, $file)) { @unlink($tmp); return false; }
    return true;
}

// JSON v súbore .php chránenom príkazom exit
function st_read_data($name, $default = null) {
    $f = ST_DATA . '/' . $name . '.data.php';
    if (!is_file($f)) { return $default; }
    $raw = (string)@file_get_contents($f);
    if (strpos($raw, ST_GUARD) === 0) { $raw = substr($raw, strlen(ST_GUARD)); }
    $j = json_decode($raw, true);
    return is_array($j) ? $j : $default;
}
function st_write_data($name, $arr) {
    $json = json_encode($arr, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);
    if ($json === false) { return false; }
    return st_write_atomic(ST_DATA . '/' . $name . '.data.php', ST_GUARD . $json);
}

// riadkové záznamy (rebríček, workshopy)
function st_read_lines($name) {
    $f = ST_DATA . '/' . $name . '.data.php';
    $list = array();
    if (!is_file($f)) { return $list; }
    $fh = @fopen($f, 'r');
    if (!$fh) { return $list; }
    flock($fh, LOCK_SH);
    while (($ln = fgets($fh)) !== false) {
        $r = json_decode(trim($ln), true);
        if (is_array($r)) { $list[] = $r; }
    }
    flock($fh, LOCK_UN);
    fclose($fh);
    return $list;
}
function st_append_line($name, $rec) {
    $f = ST_DATA . '/' . $name . '.data.php';
    $line = json_encode($rec, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n";
    if (!is_file($f)) { $line = ST_GUARD . $line; }
    return @file_put_contents($f, $line, FILE_APPEND | LOCK_EX) !== false;
}

/* ---------- obsah webu ---------- */

function st_defaults() {
    $site = json_decode((string)@file_get_contents(ST_ROOT . '/defaults/site.json'), true);
    if (!is_array($site)) { $site = array(); }
    // obchod: zoznam produktov (pôvodne jeden produkt)
    if (isset($site['shop']) && !isset($site['shop']['products'])) {
        $p = $site['shop'];
        $p['id'] = 'rabbit-print';
        $site['shop'] = array('products' => array($p));
    }
    foreach (array('walls', 'workshops', 'illustrations', 'graphicDesign') as $k) {
        if (!isset($site[$k]) || !is_array($site[$k])) { $site[$k] = array(); }
    }
    return array(
        'v' => 1,
        'site' => $site,
        'texts' => array('sk' => new stdClass(), 'en' => new stdClass()),
        'pages' => array('heroImage' => 'media/garaz-festival.jpg'),
        'globals' => array(
            'emailOrders' => 'objednavky@stullers.sk',
            'emailWorkshops' => 'workshop@stullerscreative.com',
            'emailGame' => 'peterstulo@yahoo.com',
            'instagram' => 'https://www.instagram.com/stullers_creative/',
            'footerEmail' => '',
            'footerPhone' => '',
            'footerLinks' => false,
        ),
        'seo' => array(
            'sk' => array('title' => 'Štullers', 'desc' => ''),
            'en' => array('title' => 'Štullers', 'desc' => ''),
            'image' => '',
        ),
        'trash' => array(),
    );
}

function st_published() {
    $c = st_read_data('published');
    return is_array($c) ? $c : st_defaults();
}
function st_draft() {
    $c = st_read_data('draft');
    return is_array($c) ? $c : st_published();
}

// čo dostane verejný web: bez skrytých položiek, koša a interných údajov
function st_public_payload($c) {
    $site = isset($c['site']) && is_array($c['site']) ? $c['site'] : array();
    foreach (array('walls', 'workshops', 'illustrations', 'graphicDesign') as $k) {
        $items = isset($site[$k]) && is_array($site[$k]) ? $site[$k] : array();
        // skryté projekty a projekty bez fotky sa na web nedostanú
        $site[$k] = array_values(array_filter($items, function ($it) { return is_array($it) && empty($it['hidden']) && !empty($it['image']); }));
    }
    if (isset($site['shop']['products']) && is_array($site['shop']['products'])) {
        $ps = array();
        foreach ($site['shop']['products'] as $p) {
            if (!is_array($p) || !empty($p['hidden']) || empty($p['image'])) { continue; }
            // mockup z iného (staršieho) obrázka sa nezobrazí
            if (isset($p['mockup']['source']) && $p['mockup']['source'] !== $p['image']) { unset($p['mockup']); }
            // na web ide len potvrdený mockup
            if (isset($p['mockup']) && (!is_array($p['mockup']) || empty($p['mockup']['confirmed']))) { unset($p['mockup']); }
            unset($p['mockupChoice']);
            $ps[] = $p;
        }
        $site['shop']['products'] = $ps;
    }
    $g = isset($c['globals']) && is_array($c['globals']) ? $c['globals'] : array();
    $settings = st_read_data('settings', array());
    return array(
        'site' => $site,
        'texts' => isset($c['texts']) ? $c['texts'] : new stdClass(),
        'pages' => isset($c['pages']) ? $c['pages'] : new stdClass(),
        'globals' => array(
            'emailOrders' => isset($g['emailOrders']) ? (string)$g['emailOrders'] : '',
            'emailWorkshops' => isset($g['emailWorkshops']) ? (string)$g['emailWorkshops'] : '',
            'emailGame' => isset($g['emailGame']) ? (string)$g['emailGame'] : '',
            'instagram' => isset($g['instagram']) ? (string)$g['instagram'] : '',
            'footerEmail' => isset($g['footerEmail']) ? (string)$g['footerEmail'] : '',
            'footerPhone' => isset($g['footerPhone']) ? (string)$g['footerPhone'] : '',
            'footerLinks' => !empty($g['footerLinks']),
        ),
        'menuLocked' => !empty($settings['menuLocked']),
    );
}

/* ---------- pomocné ---------- */

function st_client_ip() { return isset($_SERVER['REMOTE_ADDR']) ? (string)$_SERVER['REMOTE_ADDR'] : 'x'; }

function st_is_https() {
    if (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') { return true; }
    if (isset($_SERVER['HTTP_X_FORWARDED_PROTO']) && strtolower($_SERVER['HTTP_X_FORWARDED_PROTO']) === 'https') { return true; }
    return isset($_SERVER['SERVER_PORT']) && (int)$_SERVER['SERVER_PORT'] === 443;
}

function st_clean_text($v, $max) {
    $s = is_scalar($v) ? (string)$v : '';
    if ($s !== '' && !preg_match('//u', $s)) { $s = ''; }
    $s = strip_tags($s);
    $s = preg_replace('/[\x00-\x1F\x7F]+/u', ' ', $s);
    $s = trim($s === null ? '' : $s);
    return function_exists('mb_substr') ? mb_substr($s, 0, $max, 'UTF-8') : substr($s, 0, $max);
}
function st_clean_int($v, $max) {
    $n = is_numeric($v) ? (int)$v : 0;
    return max(0, min($max, $n));
}

// jednoduché obmedzenie počtu pokusov: $limit pokusov za $window sekúnd
function st_rate_hit($bucket, $limit, $window) {
    $f = ST_DATA . '/rate-' . $bucket . '-' . md5(st_client_ip()) . '.txt';
    $now = time();
    $list = array();
    if (is_file($f)) {
        foreach (explode(',', (string)@file_get_contents($f)) as $t) { if ((int)$t > $now - $window) { $list[] = (int)$t; } }
    }
    if (count($list) >= $limit) { return false; }
    $list[] = $now;
    @file_put_contents($f, implode(',', $list), LOCK_EX);
    return true;
}
