<?php
declare(strict_types=1);

$releaseRoot = '/site/current';
$requiredDirectories = [
    $releaseRoot . '/config',
    $releaseRoot . '/data',
    $releaseRoot . '/runtime',
    $releaseRoot . '/static/upload',
];

if (!is_file($releaseRoot . '/index.php') || !is_readable($releaseRoot . '/index.php')) {
    http_response_code(503);
    exit;
}

foreach ($requiredDirectories as $directory) {
    if (!is_dir($directory) || !is_writable($directory)) {
        http_response_code(503);
        exit;
    }
}

$databasePath = $releaseRoot . '/data/cloudcrane.db';
if (!is_file($databasePath) || !is_readable($databasePath)) {
    http_response_code(503);
    exit;
}

try {
    $database = new SQLite3($databasePath, SQLITE3_OPEN_READONLY);
    $result = $database->querySingle('SELECT 1');
    $database->close();
} catch (Throwable) {
    http_response_code(503);
    exit;
}

if ($result !== 1) {
    http_response_code(503);
    exit;
}

http_response_code(204);
