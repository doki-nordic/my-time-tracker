<?php
/**
 * Tests for all PHP endpoints.
 * Run with: php test-all.php <base-url> <webroot-dir>
 */

$base = $argv[1] ?? null;
$webroot = $argv[2] ?? null;
if (!$base || !$webroot) {
    fwrite(STDERR, "Usage: php test-all.php <base-url> <webroot-dir>\n");
    exit(1);
}

$testUid = 'test-uid-12345';
$pass = 0;
$fail = 0;

// --- Helpers ---

function pass(string $label): void {
    global $pass;
    $pass++;
    echo "  PASS: $label\n";
}

function fail(string $label, string $reason): void {
    global $fail;
    $fail++;
    echo "  FAIL: $label — $reason\n";
}

function assert_eq(string $label, mixed $expected, mixed $actual): void {
    if ($actual === $expected) {
        pass($label);
    } else {
        fail($label, "expected " . var_export($expected, true) . ", got " . var_export($actual, true));
    }
}

function assert_contains(string $label, string $needle, string $haystack): void {
    if (str_contains($haystack, $needle)) {
        pass($label);
    } else {
        fail($label, "expected to contain '$needle', got '$haystack'");
    }
}

function assert_not_contains(string $label, string $needle, string $haystack): void {
    if (!str_contains($haystack, $needle)) {
        pass($label);
    } else {
        fail($label, "expected NOT to contain '$needle'");
    }
}

function http_get(string $url): array {
    $ctx = stream_context_create(['http' => [
        'method' => 'GET',
        'ignore_errors' => true,
    ]]);
    $body = file_get_contents($url, false, $ctx);
    $headers = http_get_last_response_headers();
    $code = (int) explode(' ', $headers[0])[1];
    return ['code' => $code, 'body' => $body];
}

function http_post_form(string $url, string $data): array {
    $ctx = stream_context_create(['http' => [
        'method' => 'POST',
        'header' => 'Content-Type: application/x-www-form-urlencoded',
        'content' => $data,
        'ignore_errors' => true,
    ]]);
    $body = file_get_contents($url, false, $ctx);
    $headers = http_get_last_response_headers();
    $code = (int) explode(' ', $headers[0])[1];
    return ['code' => $code, 'body' => $body];
}

function http_post_json(string $url, array $data): array {
    $json = json_encode($data);
    $ctx = stream_context_create(['http' => [
        'method' => 'POST',
        'header' => "Content-Type: application/json\r\nContent-Length: " . strlen($json),
        'content' => $json,
        'ignore_errors' => true,
    ]]);
    $body = file_get_contents($url, false, $ctx);
    $headers = http_get_last_response_headers();
    $code = (int) explode(' ', $headers[0])[1];
    return ['code' => $code, 'body' => $body];
}

// --- Setup ---

echo "=== Setting up test environment ===\n";

file_put_contents("$webroot/uid.php", "<?php \$uid = '$testUid';\n");
@unlink("$webroot/token.php");
@unlink("$webroot/message.txt");
@unlink("$webroot/status.sqlite");
file_put_contents("$webroot/token.php", "<?php \$token = '';\n");

// Create template SQLite database
$templatePath = "$webroot/status-template.sqlite";
@unlink($templatePath);
$db = new SQLite3($templatePath);
$db->exec('CREATE TABLE conf (key TEXT PRIMARY KEY NOT NULL, value ANY) STRICT');
$db->exec('CREATE TABLE tasks (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, active INTEGER NOT NULL, [order] INTEGER NOT NULL) STRICT');
$db->exec('CREATE TABLE track (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, day INTEGER NOT NULL, start_time INTEGER NOT NULL, end_time INTEGER NOT NULL, task TEXT NOT NULL, manual INTEGER NOT NULL) STRICT');
$db->exec('CREATE INDEX tasks_active ON tasks (active)');
$db->exec('CREATE INDEX track_day ON track (day)');
$db->exec('CREATE INDEX track_task ON track (task)');
$db->close();
chmod($templatePath, 0666);

// Make files writable by Apache (www-data, uid 33)
chmod("$webroot/uid.php", 0666);
chmod("$webroot/token.php", 0666);
chmod($webroot, 0777);

// Wait for server to be ready
for ($i = 0; $i < 40; $i++) {
    $r = @file_get_contents("$base/", false, stream_context_create(['http' => ['timeout' => 1, 'ignore_errors' => true]]));
    if ($r !== false) break;
    usleep(250_000);
}

echo "Server ready at $base\n\n";

// ============================================================
echo "=== 1. login.php ===\n";
// ============================================================

// 1.1 Missing uid
$r = http_get("$base/login.php");
assert_eq('login: missing uid returns 403', 403, $r['code']);

// 1.2 Wrong uid
$r = http_get("$base/login.php?uid=wrong");
assert_eq('login: wrong uid returns 403', 403, $r['code']);

// 1.3 Correct uid
$r = http_get("$base/login.php?uid=$testUid");
assert_eq('login: returns 200', 200, $r['code']);
assert_eq('login: response is 16 chars', 16, strlen($r['body']));
$token = $r['body'];
echo "  (token: $token)\n";

// 1.4 Token file was written
$tokenFile = file_get_contents("$webroot/token.php");
assert_contains('login: token.php contains token', $token, $tokenFile);

// 1.5 Second login invalidates first
$r2 = http_get("$base/login.php?uid=$testUid");
$token2 = $r2['body'];
assert_eq('login: new token is 16 chars', 16, strlen($token2));
$tokenFile2 = file_get_contents("$webroot/token.php");
assert_contains('login: token.php updated to new token', $token2, $tokenFile2);
$token = $token2;

echo "\n";

// ============================================================
echo "=== 2. msg_send.php ===\n";
// ============================================================

// 2.1 Missing uid
$r = http_post_form("$base/msg_send.php", 'message=test');
assert_eq('msg_send: missing uid returns 403', 403, $r['code']);

// 2.2 Wrong uid
$r = http_post_form("$base/msg_send.php", 'uid=wrong&message=test');
assert_eq('msg_send: wrong uid returns 403', 403, $r['code']);

// 2.3 Send message
$r = http_post_form("$base/msg_send.php", "uid=$testUid&message=locked");
assert_eq('msg_send: returns 200', 200, $r['code']);
assert_eq('msg_send: body is OK', 'OK', $r['body']);

// 2.4 Verify file contents
$msg = file_get_contents("$webroot/message.txt");
assert_contains('msg_send: file contains locked', 'locked', $msg);
assert_contains('msg_send: file contains separator', 'SePaRator', $msg);

// 2.5 Send second message
http_post_form("$base/msg_send.php", "uid=$testUid&message=unlocked");
$msg2 = file_get_contents("$webroot/message.txt");
assert_contains('msg_send: file contains unlocked', 'unlocked', $msg2);

echo "\n";

// ============================================================
echo "=== 3. msg_read.php ===\n";
// ============================================================

// 3.1 Missing token
$r = http_post_form("$base/msg_read.php", '');
assert_eq('msg_read: missing token returns 403', 403, $r['code']);

// 3.2 Wrong token
$r = http_post_form("$base/msg_read.php", 'token=wrongtoken1234');
assert_eq('msg_read: wrong token returns 403', 403, $r['code']);

// 3.3 Read messages
$r = http_post_form("$base/msg_read.php", "token=$token");
assert_eq('msg_read: returns 200', 200, $r['code']);
assert_contains('msg_read: body contains locked', 'locked', $r['body']);
assert_contains('msg_read: body contains unlocked', 'unlocked', $r['body']);

// 3.4 File is empty after read
$remaining = @file_get_contents("$webroot/message.txt");
assert_eq('msg_read: message.txt empty after read', '', (string)$remaining);

echo "\n";

// ============================================================
echo "=== 4. status.php ===\n";
// ============================================================

// 4.1 GET empty status
$r = http_get("$base/status.php");
assert_eq('status: GET returns 200', 200, $r['code']);
$data = json_decode($r['body'], true);
assert_eq('status: GET has tasks key', true, isset($data['tasks']));

// 4.2 POST without token
$r = http_post_json("$base/status.php", ['tasks' => new stdClass()]);
assert_eq('status: POST without token returns 403', 403, $r['code']);

// 4.3 POST with wrong token
$r = http_post_json("$base/status.php", ['token' => 'wrong', 'tasks' => new stdClass()]);
assert_eq('status: POST wrong token returns 403', 403, $r['code']);

// 4.4 Add tasks
$r = http_post_json("$base/status.php", [
    'token' => $token,
    'tasks' => [
        'task1' => ['name' => 'First task', 'active' => true, 'order' => 10],
        'task2' => ['name' => 'Second task', 'active' => false, 'order' => 20],
    ],
]);
assert_eq('status: POST add returns 200', 200, $r['code']);
$data = json_decode($r['body'], true);
assert_eq('status: response has task1', true, isset($data['tasks']['task1']));
assert_eq('status: response has task2', true, isset($data['tasks']['task2']));
assert_eq('status: task1 name correct', 'First task', $data['tasks']['task1']['name']);
assert_eq('status: task1 active correct', true, $data['tasks']['task1']['active']);
assert_eq('status: task1 order correct', 10, $data['tasks']['task1']['order']);

// 4.5 GET persisted
$r = http_get("$base/status.php");
$data = json_decode($r['body'], true);
assert_eq('status: GET has task1', true, isset($data['tasks']['task1']));
assert_eq('status: GET has task2', true, isset($data['tasks']['task2']));

// 4.6 GET with active filter
$r = http_get("$base/status.php?active=1");
$data = json_decode($r['body'], true);
assert_eq('status: active filter includes task1', true, isset($data['tasks']['task1']));
assert_eq('status: active filter excludes task2', false, isset($data['tasks']['task2']));

// 4.7 Partial update (write only provided fields)
$r = http_post_json("$base/status.php", [
    'token' => $token,
    'tasks' => ['task1' => ['name' => 'Updated task']],
]);
$data = json_decode($r['body'], true);
assert_eq('status: write updates name', 'Updated task', $data['tasks']['task1']['name']);
assert_eq('status: write keeps active', true, $data['tasks']['task1']['active']);
assert_eq('status: write keeps order', 10, $data['tasks']['task1']['order']);

// 4.8 Delete task
$r = http_post_json("$base/status.php", [
    'token' => $token,
    'tasks' => ['task2' => ['deleted' => true]],
]);
$data = json_decode($r['body'], true);
assert_eq('status: delete removes task2', false, isset($data['tasks']['task2']));
assert_eq('status: delete keeps task1', true, isset($data['tasks']['task1']));

// 4.9 Deleted flag not persisted
$r = http_get("$base/status.php");
$data = json_decode($r['body'], true);
assert_eq('status: deleted flag not in stored task1', false, isset($data['tasks']['task1']['deleted']));

// 4.10 Empty tasks POST = read-only
$r = http_post_json("$base/status.php", ['token' => $token, 'tasks' => new stdClass()]);
$data = json_decode($r['body'], true);
assert_eq('status: empty POST returns existing task1', true, isset($data['tasks']['task1']));

// 4.11 Auth with uid
$r = http_post_json("$base/status.php", [
    'uid' => $testUid,
    'tasks' => ['task1' => ['name' => 'Uid update']],
]);
$data = json_decode($r['body'], true);
assert_eq('status: uid auth works', 'Uid update', $data['tasks']['task1']['name']);

echo "\n";

// ============================================================
echo "=== 5. track.php ===\n";
// ============================================================

// 5.1 POST without auth
$r = http_post_json("$base/track.php", ['entries' => []]);
assert_eq('track: missing auth returns 403', 403, $r['code']);

// 5.2 Insert new track entry
$r = http_post_json("$base/track.php", [
    'token' => $token,
    'entries' => [['day' => 20260507, 'time' => 36000, 'task' => 'task1']],
]);
assert_eq('track: insert returns 200', 200, $r['code']);
$data = json_decode($r['body'], true);
assert_eq('track: response has track key', true, isset($data['track']));
assert_eq('track: one row returned', 1, count($data['track']));
assert_eq('track: start_time correct', 36000, $data['track'][0]['start_time']);
assert_eq('track: end_time equals start_time', 36000, $data['track'][0]['end_time']);
assert_eq('track: task correct', 'task1', $data['track'][0]['task']);
assert_eq('track: manual is 0', 0, $data['track'][0]['manual']);
assert_eq('track: day correct', 20260507, $data['track'][0]['day']);

// 5.3 Extend existing entry (within 60s window)
$r = http_post_json("$base/track.php", [
    'token' => $token,
    'entries' => [['day' => 20260507, 'time' => 36030, 'task' => 'task1']],
]);
$data = json_decode($r['body'], true);
assert_eq('track: still one row after extend', 1, count($data['track']));
assert_eq('track: start_time unchanged', 36000, $data['track'][0]['start_time']);
assert_eq('track: end_time extended', 36030, $data['track'][0]['end_time']);

// 5.4 New entry after gap (>60s from last end_time)
// highest end_time row: task1 end=36030. Task matches but 36030 > 36040? No → insert
$r = http_post_json("$base/track.php", [
    'token' => $token,
    'entries' => [['day' => 20260507, 'time' => 36100, 'task' => 'task1']],
]);
$data = json_decode($r['body'], true);
assert_eq('track: two rows after gap', 2, count($data['track']));

// 5.5 Batch: task switch (two entries, same time)
// highest end_time row: task1 row2 end=36100. Task matches, 36100 > 36070 → extend
// highest end_time now: task1 row2 end=36130. Task mismatch (task1≠task3) → insert
$r = http_post_json("$base/track.php", [
    'token' => $token,
    'entries' => [
        ['day' => 20260507, 'time' => 36130, 'task' => 'task1'],
        ['day' => 20260507, 'time' => 36130, 'task' => 'task3'],
    ],
]);
$data = json_decode($r['body'], true);
$task1Rows = array_values(array_filter($data['track'], fn($r) => $r['task'] === 'task1'));
$task3Rows = array_values(array_filter($data['track'], fn($r) => $r['task'] === 'task3'));
assert_eq('track: batch — task1 has 2 rows', 2, count($task1Rows));
assert_eq('track: batch — task3 has 1 row', 1, count($task3Rows));
assert_eq('track: batch — total 3 rows', 3, count($data['track']));

// 5.6 Global lookup: recent entry for different task prevents extend
// Day 20260509, 4 entries processed sequentially:
//   task1@50000 → no rows → insert
//   task1@50030 → highest: task1@50000, match + within 60s → extend to 50030
//   task2@50050 → highest: task1@50030, mismatch → insert
//   task1@50060 → highest: task2@50050, mismatch → insert (NOT extend old task1 row)
$r = http_post_json("$base/track.php", [
    'token' => $token,
    'entries' => [
        ['day' => 20260509, 'time' => 50000, 'task' => 'task1'],
        ['day' => 20260509, 'time' => 50030, 'task' => 'task1'],
        ['day' => 20260509, 'time' => 50050, 'task' => 'task2'],
        ['day' => 20260509, 'time' => 50060, 'task' => 'task1'],
    ],
]);
$data = json_decode($r['body'], true);
assert_eq('track: global lookup — 3 rows', 3, count($data['track']));
$t1 = array_values(array_filter($data['track'], fn($r) => $r['task'] === 'task1'));
$t2 = array_values(array_filter($data['track'], fn($r) => $r['task'] === 'task2'));
assert_eq('track: global lookup — task1 has 2 rows', 2, count($t1));
assert_eq('track: global lookup — task2 has 1 row', 1, count($t2));
usort($t1, fn($a, $b) => $a['start_time'] - $b['start_time']);
assert_eq('track: global lookup — task1 row1 end_time', 50030, $t1[0]['end_time']);
assert_eq('track: global lookup — task1 row2 is separate', 50060, $t1[1]['start_time']);

// 5.9 Task switch across three requests
// Request 1: task1@64077 → insert
$r = http_post_json("$base/track.php", [
    'token' => $token,
    'entries' => [['day' => 20260510, 'time' => 64077, 'task' => 'task1']],
]);
$data = json_decode($r['body'], true);
assert_eq('track: switch3 — req1 returns 1 row', 1, count($data['track']));
assert_eq('track: switch3 — req1 task1 start', 64077, $data['track'][0]['start_time']);
assert_eq('track: switch3 — req1 task1 end', 64077, $data['track'][0]['end_time']);

// Request 2: task1@64093 extends, task2@64093 inserts
$r = http_post_json("$base/track.php", [
    'token' => $token,
    'entries' => [
        ['day' => 20260510, 'time' => 64093, 'task' => 'task1'],
        ['day' => 20260510, 'time' => 64093, 'task' => 'task2'],
    ],
]);
$data = json_decode($r['body'], true);
assert_eq('track: switch3 — req2 returns 2 rows', 2, count($data['track']));
$t1 = array_values(array_filter($data['track'], fn($r) => $r['task'] === 'task1'));
$t2 = array_values(array_filter($data['track'], fn($r) => $r['task'] === 'task2'));
assert_eq('track: switch3 — req2 task1 start', 64077, $t1[0]['start_time']);
assert_eq('track: switch3 — req2 task1 end', 64093, $t1[0]['end_time']);
assert_eq('track: switch3 — req2 task2 start', 64093, $t2[0]['start_time']);
assert_eq('track: switch3 — req2 task2 end', 64093, $t2[0]['end_time']);

// Request 3: task2@64107 extends task2 (highest end_time row, same task, within 60s)
$r = http_post_json("$base/track.php", [
    'token' => $token,
    'entries' => [['day' => 20260510, 'time' => 64107, 'task' => 'task2']],
]);
$data = json_decode($r['body'], true);
assert_eq('track: switch3 — req3 returns 2 rows', 2, count($data['track']));
$t1 = array_values(array_filter($data['track'], fn($r) => $r['task'] === 'task1'));
$t2 = array_values(array_filter($data['track'], fn($r) => $r['task'] === 'task2'));
assert_eq('track: switch3 — req3 task1 unchanged start', 64077, $t1[0]['start_time']);
assert_eq('track: switch3 — req3 task1 unchanged end', 64093, $t1[0]['end_time']);
assert_eq('track: switch3 — req3 task2 start unchanged', 64093, $t2[0]['start_time']);
assert_eq('track: switch3 — req3 task2 end extended', 64107, $t2[0]['end_time']);

// 5.7 Different day returns only that day's rows
$r = http_post_json("$base/track.php", [
    'token' => $token,
    'entries' => [['day' => 20260508, 'time' => 36000, 'task' => 'task1']],
]);
$data = json_decode($r['body'], true);
assert_eq('track: different day — 1 row returned', 1, count($data['track']));
assert_eq('track: different day — correct day', 20260508, $data['track'][0]['day']);

// 5.8 Auth with uid
$r = http_post_json("$base/track.php", [
    'uid' => $testUid,
    'entries' => [['day' => 20260508, 'time' => 36030, 'task' => 'task1']],
]);
assert_eq('track: uid auth returns 200', 200, $r['code']);

echo "\n";

// ============================================================
echo "=== 6. conf.php ===\n";
// ============================================================

// 6.1 POST without auth
$r = http_post_json("$base/conf.php", ['read' => ['foo']]);
assert_eq('conf: missing auth returns 403', 403, $r['code']);

// 6.2 Write values
$r = http_post_json("$base/conf.php", [
    'token' => $token,
    'write' => ['theme' => 'dark', 'fontSize' => 14],
]);
assert_eq('conf: write returns 200', 200, $r['code']);
$data = json_decode($r['body'], true);
assert_eq('conf: write-only returns conf key', true, isset($data['conf']));

// 6.3 Read values back
$r = http_post_json("$base/conf.php", [
    'token' => $token,
    'read' => ['theme', 'fontSize'],
]);
$data = json_decode($r['body'], true);
assert_eq('conf: read theme', 'dark', $data['conf']['theme']);
assert_eq('conf: read fontSize', 14, $data['conf']['fontSize']);

// 6.4 Write then read in same request
$r = http_post_json("$base/conf.php", [
    'token' => $token,
    'write' => ['lang' => 'en'],
    'read' => ['lang'],
]);
$data = json_decode($r['body'], true);
assert_eq('conf: write-then-read returns new value', 'en', $data['conf']['lang']);

// 6.5 Overwrite existing value
$r = http_post_json("$base/conf.php", [
    'token' => $token,
    'write' => ['theme' => 'light'],
    'read' => ['theme'],
]);
$data = json_decode($r['body'], true);
assert_eq('conf: overwrite value', 'light', $data['conf']['theme']);

// 6.6 Null clears a value
$r = http_post_json("$base/conf.php", [
    'token' => $token,
    'write' => ['theme' => null],
    'read' => ['theme'],
]);
$data = json_decode($r['body'], true);
assert_eq('conf: null clears value', null, $data['conf']['theme']);

// 6.7 Missing keys return null
$r = http_post_json("$base/conf.php", [
    'token' => $token,
    'read' => ['nonexistent'],
]);
$data = json_decode($r['body'], true);
assert_eq('conf: missing key returns null', null, $data['conf']['nonexistent']);

// 6.8 Auth with uid
$r = http_post_json("$base/conf.php", [
    'uid' => $testUid,
    'read' => ['lang'],
]);
$data = json_decode($r['body'], true);
assert_eq('conf: uid auth works', 'en', $data['conf']['lang']);

echo "\n";

// ============================================================
echo "=== Results ===\n";
// ============================================================

$total = $pass + $fail;
echo "$pass/$total passed, $fail failed\n";
exit($fail > 0 ? 1 : 0);
