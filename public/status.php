<?php
ini_set('display_errors', '0');
require __DIR__ . '/auth.php';

header('Content-Type: application/json');

$is_post = $_SERVER['REQUEST_METHOD'] === 'POST';

if ($is_post) {
    $input = json_decode(file_get_contents('php://input'), true);
    if ($input === null) {
        $input = [];
    }
    authenticate($input);
    $received_tasks = $input['tasks'] ?? [];
} else {
    $received_tasks = [];
}

$db_path = __DIR__ . '/status.sqlite';
if (!$is_post && !file_exists($db_path)) {
    echo json_encode(['tasks' => new stdClass()]);
    exit;
}

$db = open_db();

// Write tasks
if (!empty($received_tasks)) {
    $db->exec('BEGIN TRANSACTION');

    foreach ($received_tasks as $id => $task) {
        if (isset($task['deleted']) && $task['deleted'] === true) {
            $stmt = $db->prepare('DELETE FROM tasks WHERE id = :id');
            $stmt->bindValue(':id', $id, SQLITE3_TEXT);
            $stmt->execute();
            continue;
        }

        // Check if task exists
        $check = $db->prepare('SELECT id FROM tasks WHERE id = :id');
        $check->bindValue(':id', $id, SQLITE3_TEXT);
        $exists = $check->execute()->fetchArray(SQLITE3_ASSOC) !== false;

        if ($exists) {
            // Update only provided columns
            $updates = [];
            $params = [];
            if (array_key_exists('name', $task)) {
                $updates[] = 'name = :name';
                $params[':name'] = [SQLITE3_TEXT, $task['name']];
            }
            if (array_key_exists('active', $task)) {
                $updates[] = 'active = :active';
                $params[':active'] = [SQLITE3_INTEGER, $task['active'] ? 1 : 0];
            }
            if (array_key_exists('order', $task)) {
                $updates[] = '[order] = :order';
                $params[':order'] = [SQLITE3_INTEGER, (int)$task['order']];
            }
            if (!empty($updates)) {
                $sql = 'UPDATE tasks SET ' . implode(', ', $updates) . ' WHERE id = :id';
                $stmt = $db->prepare($sql);
                $stmt->bindValue(':id', $id, SQLITE3_TEXT);
                foreach ($params as $param => [$type, $value]) {
                    $stmt->bindValue($param, $value, $type);
                }
                $stmt->execute();
            }
        } else {
            // Insert new row
            $stmt = $db->prepare('INSERT INTO tasks (id, name, active, [order]) VALUES (:id, :name, :active, :order)');
            $stmt->bindValue(':id', $id, SQLITE3_TEXT);
            $stmt->bindValue(':name', $task['name'], SQLITE3_TEXT);
            $stmt->bindValue(':active', $task['active'] ? 1 : 0, SQLITE3_INTEGER);
            $stmt->bindValue(':order', (int)($task['order'] ?? 0), SQLITE3_INTEGER);
            $stmt->execute();
        }
    }

    $db->exec('COMMIT');
}

// Read tasks
$sql = 'SELECT id, name, active, [order] FROM tasks';
if (isset($_GET['active'])) {
    $sql .= ' WHERE active = 1';
}
$result = $db->query($sql);

$tasks = new stdClass();
while ($row = $result->fetchArray(SQLITE3_ASSOC)) {
    $t = new stdClass();
    $t->id = $row['id'];
    $t->name = $row['name'];
    $t->active = (bool)$row['active'];
    $t->order = (int)$row['order'];
    $tasks->{$row['id']} = $t;
}

echo json_encode(['tasks' => $tasks]);
