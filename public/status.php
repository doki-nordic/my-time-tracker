<?php
ini_set('display_errors', '0');

$file_path = __DIR__ . '/status.json';
$is_post = $_SERVER['REQUEST_METHOD'] === 'POST';

header('Content-Type: application/json');

// POST requests require token OR uid authentication
if ($is_post) {
    $input = json_decode(file_get_contents('php://input'), true);
    if ($input === null) {
        $input = [];
    }

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

    $received_tasks = $input['tasks'] ?? [];
} else {
    $received_tasks = [];
}

// Read existing status
$tasks = [];

if (file_exists($file_path)) {
    $fp = fopen($file_path, 'c+');
    if ($fp === false) {
        http_response_code(500);
        echo json_encode(['error' => 'Server error']);
        exit;
    }

    flock($fp, LOCK_EX);

    $content = stream_get_contents($fp);
    $status = ($content !== '' && $content !== false) ? json_decode($content, true) : [];
    if (!is_array($status)) {
        $status = [];
    }

    $tasks = $status['tasks'] ?? [];

    // Merge received tasks
    if (!empty($received_tasks)) {
        foreach ($received_tasks as $id => $received_task) {
            if (isset($received_task['deleted']) && $received_task['deleted'] === true) {
                unset($tasks[$id]);
                continue;
            }

            if (isset($tasks[$id])) {
                $tasks[$id] = array_merge($tasks[$id], $received_task);
            } else {
                $received_task['id'] = $id;
                $tasks[$id] = $received_task;
            }

            unset($tasks[$id]['deleted']);
        }

        $status['tasks'] = $tasks;
        fseek($fp, 0);
        ftruncate($fp, 0);
        fwrite($fp, json_encode($status, JSON_PRETTY_PRINT));
    }

    flock($fp, LOCK_UN);
    fclose($fp);
} elseif (!empty($received_tasks)) {
    // File doesn't exist yet — create it
    $status = ['tasks' => []];
    $tasks = [];

    foreach ($received_tasks as $id => $received_task) {
        if (isset($received_task['deleted']) && $received_task['deleted'] === true) {
            continue;
        }
        $received_task['id'] = $id;
        unset($received_task['deleted']);
        $tasks[$id] = $received_task;
    }

    $status['tasks'] = $tasks;
    if (file_put_contents($file_path, json_encode($status, JSON_PRETTY_PRINT), LOCK_EX) === false) {
        http_response_code(500);
        echo json_encode(['error' => 'Server error: cannot create status file']);
        exit;
    }
}

// Filter active tasks if requested
if (isset($_GET['active'])) {
    $tasks = array_filter($tasks, function ($task) {
        return !empty($task['active']);
    });
}

echo json_encode(['tasks' => (object)$tasks]);
