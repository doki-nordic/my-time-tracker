<?php
ini_set('display_errors', '0');

require __DIR__ . '/uid.php';

$request_uid = $_GET['uid'] ?? '';

if ($request_uid !== $uid) {
    http_response_code(403);
    echo 'Forbidden';
    exit;
}

$chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
$token = '';
for ($i = 0; $i < 16; $i++) {
    $token .= $chars[random_int(0, strlen($chars) - 1)];
}

$token_file = __DIR__ . '/token.php';
$token_content = "<?php \$token = '$token';\n";

error_log("[login.php] Writing token to $token_file: $token");

$bytes_written = file_put_contents($token_file, $token_content);
if ($bytes_written === false) {
    error_log("[login.php] FAILED to write token file! Check permissions on $token_file");
    http_response_code(500);
    echo 'Error: Could not write token file';
    exit;
}

error_log("[login.php] Token written successfully. Wrote $bytes_written bytes.");

header('Content-Type: text/plain');
echo $token;
