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

$entries = $input['entries'] ?? [];
$days = [];
$maxRetries = 10;
$processedCount = 0;

// Process each entry individually: start an IMMEDIATE transaction per-entry,
// update/insert, commit, then verify the persisted row outside the transaction.
foreach ($entries as $entry) {
    $day = (int)$entry['day'];
    $time = (int)$entry['time'];
    $task = $entry['task'];

    $success = false;
    $expected = null;

    for ($attempt = 1; $attempt <= $maxRetries; $attempt++) {
        // BEGIN IMMEDIATE acquires a write lock upfront; retry on BUSY
        if ($db->exec('BEGIN IMMEDIATE TRANSACTION') === false) {
            $err = $db->lastErrorCode();
            if ($err === SQLITE3_BUSY) {
                if ($attempt === $maxRetries) {
                    http_response_code(500);
                    echo json_encode(['error' => 'Database busy after ' . $maxRetries . ' retries', 'processed' => $processedCount]);
                    exit;
                }
                usleep(100000); // 0.1 sec
                continue;
            }
            http_response_code(500);
            echo json_encode(['error' => 'Failed to begin transaction: ' . $db->lastErrorMsg(), 'processed' => $processedCount]);
            exit;
        }

        // Search for the row with the highest end_time for this day
        $stmt = $db->prepare(
            'SELECT id, start_time, end_time, task FROM track
             WHERE day = :day AND manual = 0
             ORDER BY end_time DESC, id DESC LIMIT 1'
        );
        $stmt->bindValue(':day', $day, SQLITE3_INTEGER);
        $result = $stmt->execute();
        $row = $result->fetchArray(SQLITE3_ASSOC);

        if ($row !== false && $row['task'] === $task && $row['end_time'] > $time - 120) {
            // Update end_time
            $update = $db->prepare('UPDATE track SET end_time = :time WHERE id = :id');
            $update->bindValue(':time', $time, SQLITE3_INTEGER);
            $update->bindValue(':id', $row['id'], SQLITE3_INTEGER);
            $ok = $update->execute();
            if ($ok === false) {
                $db->exec('ROLLBACK');
                http_response_code(500);
                echo json_encode(['error' => 'Failed to update track row: ' . $db->lastErrorMsg(), 'processed' => $processedCount]);
                exit;
            }
            $expected = ['id' => (int)$row['id'], 'day' => $day, 'start_time' => (int)$row['start_time'], 'end_time' => $time, 'task' => $task];
        } else {
            // Insert new row
            $insert = $db->prepare(
                'INSERT INTO track (day, start_time, end_time, task, manual) VALUES (:day, :time, :time, :task, 0)'
            );
            $insert->bindValue(':day', $day, SQLITE3_INTEGER);
            $insert->bindValue(':time', $time, SQLITE3_INTEGER);
            $insert->bindValue(':task', $task, SQLITE3_TEXT);
            $ok = $insert->execute();
            if ($ok === false) {
                $db->exec('ROLLBACK');
                http_response_code(500);
                echo json_encode(['error' => 'Failed to insert track row: ' . $db->lastErrorMsg(), 'processed' => $processedCount]);
                exit;
            }
            $expected = ['id' => (int)$db->lastInsertRowID(), 'day' => $day, 'start_time' => $time, 'end_time' => $time, 'task' => $task];
        }

        // Commit transaction
        if ($db->exec('COMMIT') === false) {
            $commitErr = $db->lastErrorCode();
            $db->exec('ROLLBACK');
            if ($commitErr === SQLITE3_BUSY) {
                if ($attempt === $maxRetries) {
                    http_response_code(500);
                    echo json_encode(['error' => 'Database busy during commit after ' . $maxRetries . ' retries', 'processed' => $processedCount]);
                    exit;
                }
                usleep(100000);
                continue;
            }
            http_response_code(500);
            echo json_encode(['error' => 'Failed to commit transaction: ' . $db->lastErrorMsg(), 'processed' => $processedCount]);
            exit;
        }

        // Verify the row was persisted (outside transaction)
        $stmt = $db->prepare('SELECT day, start_time, end_time, task FROM track WHERE id = :id');
        $stmt->bindValue(':id', $expected['id'], SQLITE3_INTEGER);
        $result = $stmt->execute();
        $verRow = $result->fetchArray(SQLITE3_ASSOC);
        if ($verRow !== false
            && (int)$verRow['day'] === $expected['day']
            && (int)$verRow['start_time'] === $expected['start_time']
            && (int)$verRow['end_time'] === $expected['end_time']
            && $verRow['task'] === $expected['task']
        ) {
            $days[$day] = true;
            $success = true;
            $processedCount++;
            break;
        }

        if ($attempt === $maxRetries) {
            http_response_code(500);
            echo json_encode(['error' => 'Failed to persist track entry for day ' . $day . ' after ' . $maxRetries . ' retries', 'processed' => $processedCount]);
            exit;
        }

        // Wait random 0-2 seconds before retrying this entry
        usleep(random_int(0, 2000000));
    }

    // continue to next entry
}

// Return all track rows for the requested days
$track = [];
foreach (array_keys($days) as $day) {
    $stmt = $db->prepare('SELECT id, day, start_time, end_time, task, manual FROM track WHERE day = :day');
    $stmt->bindValue(':day', $day, SQLITE3_INTEGER);
    $result = $stmt->execute();
    while ($row = $result->fetchArray(SQLITE3_ASSOC)) {
        $row['id'] = (int)$row['id'];
        $row['day'] = (int)$row['day'];
        $row['start_time'] = (int)$row['start_time'];
        $row['end_time'] = (int)$row['end_time'];
        $row['manual'] = (int)$row['manual'];
        $track[] = $row;
    }
}

echo json_encode(['track' => $track]);
