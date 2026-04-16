<?php
ini_set('display_errors', '0');

require __DIR__ . '/token.php';

$request_token = $_POST['token'] ?? '';

if ($request_token === '' || $request_token !== $token) {
    http_response_code(403);
    echo 'Forbidden';
    exit;
}

header('Content-Type: text/plain');

$file_path = __DIR__ . '/message.txt';
$waited = 0;

while ($waited < 20) {
    if (!file_exists($file_path)) {
        sleep(1);
        $waited++;
        continue;
    }

    $fp = fopen($file_path, 'c+');
    if ($fp === false) {
        sleep(1);
        $waited++;
        continue;
    }

    flock($fp, LOCK_EX);
    $content = stream_get_contents($fp);
    ftruncate($fp, 0);
    flock($fp, LOCK_UN);
    fclose($fp);

    if ($content !== '' && $content !== false) {
        echo $content;
        exit;
    }

    sleep(1);
    $waited++;
}

// Timed out with no messages
echo '';
