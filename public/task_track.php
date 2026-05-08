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
$db->exec('BEGIN TRANSACTION');

// Build task query
$active_filter = isset($_GET['active']);
$task_filter = $_GET['task'] ?? null;

if ($task_filter !== null) {
    $stmt = $db->prepare('SELECT id, name, active, [order] FROM tasks WHERE id = :id');
    $stmt->bindValue(':id', $task_filter, SQLITE3_TEXT);
} elseif ($active_filter) {
    $stmt = $db->prepare('SELECT id, name, active, [order] FROM tasks WHERE active = 1');
} else {
    $stmt = $db->prepare('SELECT id, name, active, [order] FROM tasks');
}

$result = $stmt->execute();
$tasks = new stdClass();
$task_ids = [];
while ($row = $result->fetchArray(SQLITE3_ASSOC)) {
    $t = new stdClass();
    $t->id = $row['id'];
    $t->name = $row['name'];
    $t->active = (bool)$row['active'];
    $t->order = (int)$row['order'];
    $tasks->{$row['id']} = $t;
    $task_ids[] = $row['id'];
}

// Fetch track rows for matched tasks
$track = [];
if (!empty($task_ids)) {
    $placeholders = implode(',', array_fill(0, count($task_ids), '?'));
    $stmt = $db->prepare("SELECT id, day, start_time, end_time, task, manual FROM track WHERE task IN ($placeholders)");
    foreach ($task_ids as $i => $id) {
        $stmt->bindValue($i + 1, $id, SQLITE3_TEXT);
    }
    $result = $stmt->execute();
    while ($row = $result->fetchArray(SQLITE3_ASSOC)) {
        $track[] = [
            'id' => (int)$row['id'],
            'day' => (int)$row['day'],
            'start_time' => (int)$row['start_time'],
            'end_time' => (int)$row['end_time'],
            'task' => $row['task'],
            'manual' => (int)$row['manual'],
        ];
    }
}

$db->exec('ROLLBACK');
echo json_encode(['tasks' => $tasks, 'track' => $track]);
