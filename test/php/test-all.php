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
@unlink("$webroot/status.json");
file_put_contents("$webroot/token.php", "<?php \$token = '';\n");

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
        'task1' => ['name' => 'First task', 'active' => true, 'plannedTime' => 3600],
        'task2' => ['name' => 'Second task', 'active' => false, 'plannedTime' => 7200],
    ],
]);
assert_eq('status: POST add returns 200', 200, $r['code']);
$data = json_decode($r['body'], true);
assert_eq('status: response has task1', true, isset($data['tasks']['task1']));
assert_eq('status: response has task2', true, isset($data['tasks']['task2']));
assert_eq('status: task1 name correct', 'First task', $data['tasks']['task1']['name']);

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

// 4.7 Partial update (merge)
$r = http_post_json("$base/status.php", [
    'token' => $token,
    'tasks' => ['task1' => ['timeSpent' => 120]],
]);
$data = json_decode($r['body'], true);
assert_eq('status: merge keeps name', 'First task', $data['tasks']['task1']['name']);
assert_eq('status: merge updates timeSpent', 120, $data['tasks']['task1']['timeSpent']);

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

// 4.10 Special day task
$today = date('Y-m-d');
$r = http_post_json("$base/status.php", [
    'token' => $token,
    'tasks' => ["-day-$today" => ['name' => "Day $today", 'timeSpent' => 3600, 'active' => true]],
]);
$data = json_decode($r['body'], true);
assert_eq('status: special day task added', true, isset($data['tasks']["-day-$today"]));

// 4.11 Empty tasks POST = read-only
$r = http_post_json("$base/status.php", ['token' => $token, 'tasks' => new stdClass()]);
$data = json_decode($r['body'], true);
assert_eq('status: empty POST returns existing task1', true, isset($data['tasks']['task1']));

echo "\n";

// ============================================================
echo "=== Results ===\n";
// ============================================================

$total = $pass + $fail;
echo "$pass/$total passed, $fail failed\n";
exit($fail > 0 ? 1 : 0);
