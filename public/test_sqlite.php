<?php
ini_set('display_errors', '1');
error_reporting(E_ALL);
//header('Content-Type: text/plain');

phpinfo();
echo '<pre>';

echo "=== SQLite Diagnostic Script ===\n\n";

// Step 1: Check SQLite3 extension
echo "1. SQLite3 extension loaded: ";
echo extension_loaded('sqlite3') ? "YES" : "NO";
echo "\n";

// Step 2: Check writable directory
$dir = __DIR__;
echo "2. Directory: $dir\n";
echo "   Writable: " . (is_writable($dir) ? "YES" : "NO") . "\n";

// Step 3: Try opening database
$test_db_path = __DIR__ . '/test_diag.sqlite';
$db_exists = file_exists($test_db_path);
echo "3. Database at: $test_db_path\n";
echo "   Already exists: " . ($db_exists ? "YES" : "NO") . "\n";
try {
    $db = new SQLite3($test_db_path);
    echo "   OK: Database opened\n";
} catch (Exception $e) {
    echo "   FAIL: " . $e->getMessage() . "\n";
    exit;
}

// Step 4: Create tables (skip if DB already existed)
if ($db_exists) {
    echo "4. Skipping table creation (DB already exists)\n";
} else {
    echo "4. Creating tables from status-template.sql...\n";
    try {
        $sql = file_get_contents(__DIR__ . '/status-template.sql');
        $db->exec($sql);
        echo "   OK: Template executed\n";
    } catch (Exception $e) {
        echo "   FAIL: " . $e->getMessage() . "\n";
    }
    echo "   Creating test_items table...\n";
    try {
        $db->exec('CREATE TABLE test_items (id TEXT PRIMARY KEY, value TEXT)');
        echo "   OK: test_items created\n";
    } catch (Exception $e) {
        echo "   FAIL: " . $e->getMessage() . "\n";
    }
}

// Step 5: BEGIN TRANSACTION
echo "5. BEGIN TRANSACTION...\n";
try {
    $result = $db->exec('BEGIN TRANSACTION');
    echo "   Result: " . var_export($result, true) . "\n";
} catch (Exception $e) {
    echo "   FAIL: " . $e->getMessage() . "\n";
}

// Step 6: Insert data
echo "6. Inserting data...\n";
try {
    $stmt = $db->prepare('INSERT OR REPLACE INTO test_items (id, value) VALUES (:id, :value)');
    $stmt->bindValue(':id', 'item1', SQLITE3_TEXT);
    $stmt->bindValue(':value', 'hello', SQLITE3_TEXT);
    $stmt->execute();
    echo "   OK: Inserted row\n";
} catch (Exception $e) {
    echo "   FAIL: " . $e->getMessage() . "\n";
}

// Step 7: COMMIT
echo "7. COMMIT...\n";
try {
    $result = $db->exec('COMMIT');
    echo "   Result: " . var_export($result, true) . "\n";
} catch (Exception $e) {
    echo "   FAIL: " . $e->getMessage() . "\n";
}

// Step 8: Read back
echo "8. Reading data...\n";
try {
    $result = $db->query('SELECT * FROM test_items');
    while ($row = $result->fetchArray(SQLITE3_ASSOC)) {
        echo "   Row: " . json_encode($row) . "\n";
    }
} catch (Exception $e) {
    echo "   FAIL: " . $e->getMessage() . "\n";
}

// Step 9: Check the real database
$real_db_path = __DIR__ . '/status.sqlite';
echo "9. Real database ($real_db_path):\n";
echo "   Exists: " . (file_exists($real_db_path) ? "YES" : "NO") . "\n";
if (file_exists($real_db_path)) {
    echo "   Readable: " . (is_readable($real_db_path) ? "YES" : "NO") . "\n";
    echo "   Writable: " . (is_writable($real_db_path) ? "YES" : "NO") . "\n";
    echo "   Size: " . filesize($real_db_path) . " bytes\n";
    try {
        $real_db = new SQLite3($real_db_path);
        echo "   Open: OK\n";
        $r = $real_db->exec('BEGIN TRANSACTION');
        echo "   BEGIN TRANSACTION: " . var_export($r, true) . "\n";
        $real_db->exec('COMMIT');
        echo "   COMMIT: OK\n";
    } catch (Exception $e) {
        echo "   FAIL: " . $e->getMessage() . "\n";
    }
}

// Done — database is kept for inspection
echo "\n10. Database kept at: $test_db_path\n";
$db->close();

echo "\n=== Done ===\n";
