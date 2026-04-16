<?php
ini_set('display_errors', '0');

require __DIR__ . '/uid.php';

$request_uid = $_POST['uid'] ?? '';

if ($request_uid !== $uid) {
    http_response_code(403);
    echo 'Forbidden';
    exit;
}

$message = $_POST['message'] ?? '';
$separator = "\n--------\nSePaRator\n--------\n";

$fp = fopen(__DIR__ . '/message.txt', 'a');
if ($fp === false) {
    http_response_code(500);
    echo 'Error';
    exit;
}

flock($fp, LOCK_EX);
fwrite($fp, $message . $separator);
flock($fp, LOCK_UN);
fclose($fp);

header('Content-Type: text/plain');
echo 'OK';
