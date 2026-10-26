<?php
/*
 * Štullers – verejná časť hry a workshopov:
 *   - stav menu (číta každý návštevník),
 *   - zápis výsledku hráča do rebríčka,
 *   - zadanie workshopu z formulára (pošle sa e-mailom a uloží sa záloha).
 * Rebríček, vypínanie menu a zadania workshopov spravuješ v administrácii (admin/).
 * Heslo sa tu už nenastavuje.
 */
require __DIR__ . '/lib.php';
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
st_ensure_dirs();
$DIR = ST_DATA;
$SCORES_FILE = ST_DATA . '/scores.data.php';

function out($code, $arr) {
    http_response_code($code);
    $arr['stullers'] = true;
    echo json_encode($arr, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function clean_text($v, $max) {
    $s = is_scalar($v) ? (string)$v : '';
    if ($s !== '' && !preg_match('//u', $s)) { $s = ''; }            // len platné UTF-8
    $s = strip_tags($s);
    $s = preg_replace('/[\x00-\x1F\x7F]+/u', ' ', $s);
    $s = trim($s === null ? '' : $s);
    return function_exists('mb_substr') ? mb_substr($s, 0, $max, 'UTF-8') : substr($s, 0, $max);
}

function clean_int($v, $max) {
    $n = is_numeric($v) ? (int)$v : 0;
    return max(0, min($max, $n));
}

function read_body() {
    $raw = file_get_contents('php://input');
    if ($raw === false || strlen($raw) > 8192) { out(413, array('ok' => false, 'error' => 'too_large')); }
    $j = json_decode($raw, true);
    return is_array($j) ? $j : array();
}

$action = isset($_GET['action']) ? (string)$_GET['action'] : '';
$method = isset($_SERVER['REQUEST_METHOD']) ? $_SERVER['REQUEST_METHOD'] : 'GET';

// --- stav menu (vypnuté / zapnuté) – číta každý návštevník
if ($action === 'menu' && $method === 'GET') {
    $s = st_read_data('settings', array());
    out(200, array('ok' => true, 'locked' => !empty($s['menuLocked'])));
}

// --- zápis výsledku hráča – po hre, ktokoľvek
if ($action === 'score' && $method === 'POST') {
    $b = read_body();
    $name = clean_text(isset($b['name']) ? $b['name'] : '', 60);
    $email = clean_text(isset($b['email']) ? $b['email'] : '', 120);
    $ig = clean_text(isset($b['ig']) ? $b['ig'] : '', 40);
    if ($name === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        out(422, array('ok' => false, 'error' => 'invalid'));
    }
    // ochrana pred zahltením: z jednej adresy najviac 1 zápis za 10 sekúnd
    $ip = isset($_SERVER['REMOTE_ADDR']) ? $_SERVER['REMOTE_ADDR'] : 'x';
    $rateFile = $DIR . '/rate-' . md5($ip) . '.txt';
    $last = is_file($rateFile) ? (int)@file_get_contents($rateFile) : 0;
    if (time() - $last < 10) { out(429, array('ok' => false, 'error' => 'rate_limited')); }
    @file_put_contents($rateFile, (string)time(), LOCK_EX);

    $rec = array(
        'name' => $name,
        'email' => $email,
        'ig' => $ig,
        'score' => clean_int(isset($b['score']) ? $b['score'] : 0, 10000000),
        'collected' => clean_int(isset($b['collected']) ? $b['collected'] : 0, 100000),
        'rounds' => clean_int(isset($b['rounds']) ? $b['rounds'] : 0, 1000),
        'combo' => clean_int(isset($b['combo']) ? $b['combo'] : 0, 100000),
        'lang' => (isset($b['lang']) && $b['lang'] === 'en') ? 'en' : 'sk',
        'at' => date('c'),
    );
    $line = json_encode($rec, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n";
    if (!is_file($SCORES_FILE)) { $line = '<' . "?php exit; ?" . ">\n" . $line; }
    if (@file_put_contents($SCORES_FILE, $line, FILE_APPEND | LOCK_EX) === false) {
        out(500, array('ok' => false, 'error' => 'write_failed'));
    }
    out(200, array('ok' => true));
}

// --- ZADANIE WORKSHOPU zo sekcie Workshopy – pošle sa e-mailom (a uloží sa záloha)
if ($action === 'workshop' && $method === 'POST') {
    $pub = st_published();
    $WORKSHOP_TO = isset($pub['globals']['emailWorkshops']) ? trim((string)$pub['globals']['emailWorkshops']) : '';
    if (!filter_var($WORKSHOP_TO, FILTER_VALIDATE_EMAIL)) { $WORKSHOP_TO = 'workshop@stullerscreative.com'; }
    $b = read_body();
    if (!empty($b['website'])) { out(200, array('ok' => true)); }   // skryté pole – vyplnia ho len spamboti

    $list = function ($v, $max) {
        $o = array();
        if (is_array($v)) { foreach (array_slice($v, 0, 12) as $x) { $c = clean_text($x, $max); if ($c !== '') { $o[] = $c; } } }
        return $o;
    };
    $f = array(
        'name' => clean_text(isset($b['name']) ? $b['name'] : '', 80),
        'email' => clean_text(isset($b['email']) ? $b['email'] : '', 120),
        'phone' => clean_text(isset($b['phone']) ? $b['phone'] : '', 40),
        'clientType' => clean_text(isset($b['clientType']) ? $b['clientType'] : '', 60),
        'clientName' => clean_text(isset($b['clientName']) ? $b['clientName'] : '', 120),
        'topics' => $list(isset($b['topics']) ? $b['topics'] : array(), 80),
        'topicText' => clean_text(isset($b['topicText']) ? $b['topicText'] : '', 400),
        'date' => clean_text(isset($b['date']) ? $b['date'] : '', 10),
        'time' => clean_text(isset($b['time']) ? $b['time'] : '', 5),
        'flexible' => !empty($b['flexible']),
        'city' => clean_text(isset($b['city']) ? $b['city'] : '', 80),
        'place' => clean_text(isset($b['place']) ? $b['place'] : '', 200),
        'ages' => $list(isset($b['ages']) ? $b['ages'] : array(), 40),
        'duration' => clean_text(isset($b['duration']) ? $b['duration'] : '', 60),
        'participants' => clean_text(isset($b['participants']) ? $b['participants'] : '', 10),
        'note' => clean_text(isset($b['note']) ? $b['note'] : '', 2000),
        'consult' => clean_text(isset($b['consult']) ? $b['consult'] : '', 40),
        'lang' => (isset($b['lang']) && $b['lang'] === 'en') ? 'en' : 'sk',
    );
    // poznámka smie mať viac riadkov – clean_text ich zlúčil, preto ju vezmeme znova s novými riadkami
    if (isset($b['note']) && is_string($b['note']) && preg_match('//u', $b['note'])) {
        $n = strip_tags(str_replace(array("\r\n", "\r"), "\n", $b['note']));
        $n = preg_replace('/[\x00-\x09\x0B-\x1F\x7F]+/u', ' ', $n);
        $f['note'] = trim(function_exists('mb_substr') ? mb_substr($n, 0, 2000, 'UTF-8') : substr($n, 0, 2000));
    }
    $ok = $f['name'] !== '' && filter_var($f['email'], FILTER_VALIDATE_EMAIL) && $f['clientType'] !== ''
        && (count($f['topics']) || $f['topicText'] !== '') && preg_match('/^\d{4}-\d{2}-\d{2}$/', $f['date'])
        && preg_match('/^\d{2}:\d{2}$/', $f['time']) && $f['city'] !== '' && count($f['ages'])
        && $f['duration'] !== '' && $f['consult'] !== '';
    if (!$ok) { out(422, array('ok' => false, 'error' => 'invalid')); }

    // z jednej adresy najviac 1 zadanie za 30 sekúnd
    $ip = isset($_SERVER['REMOTE_ADDR']) ? $_SERVER['REMOTE_ADDR'] : 'x';
    $rateFile = $DIR . '/wrate-' . md5($ip) . '.txt';
    $last = is_file($rateFile) ? (int)@file_get_contents($rateFile) : 0;
    if (time() - $last < 30) { out(429, array('ok' => false, 'error' => 'rate_limited')); }
    @file_put_contents($rateFile, (string)time(), LOCK_EX);

    $d = explode('-', $f['date']);
    $dateTxt = (int)$d[2] . '. ' . (int)$d[1] . '. ' . $d[0];
    $L = array();
    $L[] = 'NOVÉ ZADANIE WORKSHOPU (z webu)';
    $L[] = '';
    $L[] = 'KTO: ' . $f['name'];
    $L[] = 'E-mail: ' . $f['email'];
    $L[] = 'Telefón: ' . ($f['phone'] !== '' ? $f['phone'] : '—');
    $L[] = '';
    $L[] = 'PRE KOHO: ' . $f['clientType'] . ($f['clientName'] !== '' ? ' – ' . $f['clientName'] : '');
    $L[] = 'TÉMA: ' . (count($f['topics']) ? implode(', ', $f['topics']) : '—');
    if ($f['topicText'] !== '') { $L[] = 'Téma vlastnými slovami: ' . $f['topicText']; }
    $L[] = 'KEDY: ' . $dateTxt . ' o ' . $f['time'] . ($f['flexible'] ? ' (termín je flexibilný)' : '');
    $L[] = 'KDE: ' . $f['city'] . ($f['place'] !== '' ? ' – ' . $f['place'] : '');
    $L[] = 'VEKOVÁ KATEGÓRIA: ' . implode(', ', $f['ages']);
    $L[] = 'DĹŽKA: ' . $f['duration'];
    if ($f['participants'] !== '') { $L[] = 'Počet účastníkov: ' . $f['participants']; }
    $L[] = 'KONZULTÁCIA: ' . $f['consult'];
    $L[] = '';
    $L[] = 'NIEČO ŠPECIÁLNE / POZNÁMKA:';
    $L[] = $f['note'] !== '' ? $f['note'] : '—';
    $L[] = '';
    $L[] = 'Jazyk webu: ' . strtoupper($f['lang']) . ' · odoslané ' . date('j. n. Y H:i');
    $L[] = 'Na tento e-mail stačí odpovedať – odpoveď pôjde priamo zákazníkovi.';
    $body = implode("\n", $L) . "\n";

    // záloha (keby e-mail nedorazil) – súbor sa cez prehliadač nedá prečítať
    $WFILE = $DIR . '/workshops.data.php';
    $line = json_encode(array_merge($f, array('at' => date('c'))), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n";
    if (!is_file($WFILE)) { $line = '<' . "?php exit; ?" . ">\n" . $line; }
    @file_put_contents($WFILE, $line, FILE_APPEND | LOCK_EX);

    $enc = function ($s) { return '=?UTF-8?B?' . base64_encode($s) . '?='; };
    $subject = $enc('Zadanie workshopu – ' . $f['name'] . ' – ' . $dateTxt);
    $headers = 'From: ' . $enc('Štullers web') . ' <' . $WORKSHOP_TO . ">\r\n"
             . 'Reply-To: ' . $f['email'] . "\r\n"
             . "MIME-Version: 1.0\r\n"
             . "Content-Type: text/plain; charset=UTF-8\r\n"
             . "Content-Transfer-Encoding: 8bit\r\n";
    $sent = @mail($WORKSHOP_TO, $subject, $body, $headers, '-f' . $WORKSHOP_TO);
    if (!$sent) { out(500, array('ok' => false, 'error' => 'mail_failed', 'saved' => true)); }
    out(200, array('ok' => true));
}

out(400, array('ok' => false, 'error' => 'unknown_action'));
