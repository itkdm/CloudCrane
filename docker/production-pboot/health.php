<?php
declare(strict_types=1);

$releaseRoot = '/site/current';
$requiredWritableDirectories = [
    'data' => $releaseRoot . '/data',
    'runtime' => $releaseRoot . '/runtime',
    'upload' => $releaseRoot . '/static/upload',
];

function healthProbeUnavailable(string $reason): never
{
    error_log('CloudCrane production health probe unavailable: ' . $reason);
    http_response_code(503);
    exit;
}

if (!is_file($releaseRoot . '/index.php') || !is_readable($releaseRoot . '/index.php')) {
    healthProbeUnavailable('release_entry');
}

foreach ($requiredWritableDirectories as $name => $directory) {
    if (!is_dir($directory) || !is_writable($directory)) {
        healthProbeUnavailable('shared_directory_' . $name);
    }
}

foreach (['config.php', 'database.php'] as $configFile) {
    $path = $releaseRoot . '/config/' . $configFile;
    if (!is_file($path) || !is_readable($path)) {
        healthProbeUnavailable('config_file');
    }
}

$databasePath = $releaseRoot . '/data/cloudcrane.db';
if (!is_file($databasePath) || !is_readable($databasePath)) {
    healthProbeUnavailable('database_file');
}

try {
    $database = new SQLite3($databasePath, SQLITE3_OPEN_READONLY);
    $result = $database->querySingle('SELECT 1');
    $database->close();
} catch (Throwable) {
    healthProbeUnavailable('database_query');
}

if ($result !== 1) {
    healthProbeUnavailable('database_result');
}

http_response_code(204);
