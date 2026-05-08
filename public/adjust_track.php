<?php
ini_set('display_errors', '0');
require __DIR__ . '/auth.php';

header('Content-Type: application/json');

$input = json_decode(file_get_contents('php://input'), true);
if ($input === null) {
    $input = [];
}
authenticate($input);

$day = $input['day'] ?? null;
$task = $input['task'] ?? null;
$seconds = $input['seconds'] ?? null;

if ($day === null || $task === null || $seconds === null) {
    http_response_code(400);
    echo json_encode(['error' => 'Missing required fields: day, task, seconds']);
    exit;
}

$day = (int)$day;
$seconds = (int)$seconds;
$max = 4 * 3600 - 60; // 3:59 = 14340 seconds

if (abs($seconds) > $max || $seconds === 0) {
    http_response_code(400);
    echo json_encode(['error' => 'Seconds out of range']);
    exit;
}

if ($seconds > 0) {
    $start_time = 0;
    $end_time = $seconds;
} else {
    $start_time = 14400;
    $end_time = 14400 - abs($seconds); // $seconds is negative, so this is 14400 - |$seconds|
}

$db = open_db();

$stmt = $db->prepare(
    'INSERT INTO track (day, start_time, end_time, task, manual) VALUES (:day, :start, :end, :task, 1)'
);
$stmt->bindValue(':day', $day, SQLITE3_INTEGER);
$stmt->bindValue(':start', $start_time, SQLITE3_INTEGER);
$stmt->bindValue(':end', $end_time, SQLITE3_INTEGER);
$stmt->bindValue(':task', $task, SQLITE3_TEXT);
$stmt->execute();

echo json_encode(['ok' => true, 'id' => $db->lastInsertRowID()]);
