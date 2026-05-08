<?php
ini_set('display_errors', '0');
require __DIR__ . '/auth.php';

header('Content-Type: application/json');

$input = json_decode(file_get_contents('php://input'), true);
if ($input === null) {
    $input = [];
}
authenticate($input);

$db = open_db();

$write = $input['write'] ?? [];
$read = $input['read'] ?? [];

// Write first
if (!empty($write)) {
    $db->exec('BEGIN TRANSACTION');

    foreach ($write as $key => $value) {
        $stmt = $db->prepare(
            'INSERT INTO conf (key, value) VALUES (:key, :value) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
        );
        $stmt->bindValue(':key', $key, SQLITE3_TEXT);
        if ($value === null) {
            $stmt->bindValue(':value', null, SQLITE3_NULL);
        } elseif (is_int($value)) {
            $stmt->bindValue(':value', $value, SQLITE3_INTEGER);
        } elseif (is_float($value)) {
            $stmt->bindValue(':value', $value, SQLITE3_FLOAT);
        } else {
            $stmt->bindValue(':value', (string)$value, SQLITE3_TEXT);
        }
        $stmt->execute();
    }

    $db->exec('COMMIT');
}

// Read
$conf = new stdClass();
if (!empty($read)) {
    foreach ($read as $key) {
        $stmt = $db->prepare('SELECT value FROM conf WHERE key = :key');
        $stmt->bindValue(':key', $key, SQLITE3_TEXT);
        $result = $stmt->execute();
        $row = $result->fetchArray(SQLITE3_ASSOC);
        if ($row !== false) {
            $conf->$key = $row['value'];
        } else {
            $conf->$key = null;
        }
    }
}

echo json_encode(['conf' => $conf]);
