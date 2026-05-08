<?php
// Shared authentication and database initialization.

function open_db(): SQLite3 {
    $db_path = __DIR__ . '/status.sqlite';
    $template_sql_path = __DIR__ . '/status-template.sql';

    $is_new = !file_exists($db_path) || filesize($db_path) === 0;

    $db = new SQLite3($db_path);
    $db->busyTimeout(5000);
    $db->exec('PRAGMA journal_mode=WAL');

    if ($is_new) {
        $sql = file_get_contents($template_sql_path);
        $db->exec($sql);
    }

    return $db;
}

function authenticate(array $input): void {
    require __DIR__ . '/uid.php';
    require __DIR__ . '/token.php';

    $request_token = $input['token'] ?? '';
    $request_uid = $input['uid'] ?? '';

    $token_ok = ($request_token !== '' && $request_token === $token);
    $uid_ok = ($request_uid !== '' && $request_uid === $uid);

    if (!$token_ok && !$uid_ok) {
        http_response_code(403);
        echo json_encode(['error' => 'Forbidden']);
        exit;
    }
}
