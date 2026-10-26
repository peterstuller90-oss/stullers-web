<?php
/*
 * Štullers – verejný web. Vezme šablónu web.html a vloží do nej zverejnený obsah z administrácie
 * (texty, karty, produkty, pätička, SEO). Dizajn, hra a animácie sú v šablóne a nemenia sa.
 * index.php?preview=1 ukáže prihlásenému autorovi rozpracovaný koncept.
 */
require __DIR__ . '/api/lib.php';

$tpl = @file_get_contents(__DIR__ . '/web.html');
if ($tpl === false) { http_response_code(500); echo 'Chýba súbor web.html'; exit; }

$preview = false;
$content = st_published();
if (isset($_GET['preview'])) {
    session_name('stullers_admin');
    session_set_cookie_params(array('lifetime' => 0, 'path' => rtrim(dirname($_SERVER['SCRIPT_NAME']), '/\\') . '/',
        'secure' => st_is_https(), 'httponly' => true, 'samesite' => 'Strict'));
    session_start();
    if (!empty($_SESSION['uid'])) { $content = st_draft(); $preview = true; }
    session_write_close();
}

$payload = st_public_payload($content);
if ($preview) { $payload['preview'] = true; }
$json = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT);

// SEO a obrázok pre zdieľanie
$seo = isset($content['seo']) && is_array($content['seo']) ? $content['seo'] : array();
$sk = isset($seo['sk']) && is_array($seo['sk']) ? $seo['sk'] : array();
$h = function ($s) { return htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8'); };
$title = isset($sk['title']) && $sk['title'] !== '' ? $sk['title'] : 'Štullers';
$desc = isset($sk['desc']) ? $sk['desc'] : '';
$scheme = st_is_https() ? 'https' : 'http';
$host = isset($_SERVER['HTTP_HOST']) && preg_match('/^[a-z0-9.:-]+$/i', $_SERVER['HTTP_HOST']) ? $_SERVER['HTTP_HOST'] : '';
$base = $scheme . '://' . $host . rtrim(dirname($_SERVER['SCRIPT_NAME']), '/\\') . '/';
$head = "<script>window.__STULLERS__ = " . $json . ";</script>\n";
if ($desc !== '') {
    $head .= '<meta name="description" content="' . $h($desc) . "\">\n";
    $head .= '<meta property="og:description" content="' . $h($desc) . "\">\n";
}
$head .= '<meta property="og:title" content="' . $h($title) . "\">\n";
$head .= '<meta property="og:type" content="website">' . "\n";
if ($host !== '') { $head .= '<meta property="og:url" content="' . $h($base) . "\">\n"; }
if (!empty($seo['image']) && $host !== '' && preg_match('#^media/[A-Za-z0-9/._-]+$#', $seo['image'])) {
    $head .= '<meta property="og:image" content="' . $h($base . $seo['image']) . "\">\n";
}
if ($preview) { $head .= "<meta name=\"robots\" content=\"noindex\">\n"; }

$tpl = str_replace('<!--STULLERS_HEAD-->', $head, $tpl);
$tpl = preg_replace('#<title>.*?</title>#s', '<title>' . $h($title) . '</title>', $tpl, 1);

header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-cache');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: strict-origin-when-cross-origin');
echo $tpl;
