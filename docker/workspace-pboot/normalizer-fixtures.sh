#!/bin/sh
set -eu

source="$(mktemp -d /tmp/cloudcrane-k714-fixture.XXXXXX)"
cleanup() { rm -rf "$source"; }
trap cleanup EXIT
mkdir -p "$source/data" "$source/apps/common" "$source/template/dafeult" "$source/skin/css" "$source/static/css" "$source/static/misc"
cp /workspace/data/pbootcms.db "$source/data/pbootcms.db"
printf '%s\n' "<?php return ['app_version' => '3.2.12'];" > "$source/apps/common/version.php"
printf '%s\n' '<h1>K714 fixture</h1>' > "$source/template/dafeult/index.html"
printf '%s\n' 'body{}' > "$source/skin/css/site.css"
printf '%s\n' 'body{}' > "$source/static/css/site.css"
printf '%s\n' '<?php echo "must not copy";' > "$source/static/css/unsafe.php"
printf '%s\n' 'not allowed' > "$source/static/misc/ignored.txt"
mkdir -p "$source/static/assets"
printf '%s\n' 'K714 new asset' > "$source/static/assets/k714.css"

sqlite3 "$source/data/pbootcms.db" "UPDATE ay_config SET value='source-only' WHERE name='sn';"
sqlite3 "$source/data/pbootcms.db" "UPDATE ay_site SET title='K714 rollback marker';"
sqlite3 /workspace/data/pbootcms.db "UPDATE ay_config SET value='destination-secret' WHERE name='sn';"
sqlite3 /workspace/data/pbootcms.db "UPDATE ay_user SET username='destination-admin-marker' WHERE id=(SELECT id FROM ay_user LIMIT 1);"

touch /workspace/k714-dirty-fixture
if cloudcrane-normalize-k714 "$source" >/tmp/cloudcrane-k714-dirty.out 2>/tmp/cloudcrane-k714-dirty.err; then
  exit 10
fi
grep -qxF 'ERROR DIRTY_DESTINATION: destination Git status is not clean' /tmp/cloudcrane-k714-dirty.err
rm -f /workspace/k714-dirty-fixture

tracked_static="$(git -C /workspace ls-files 'static/*' | head -n 1)"
test -n "$tracked_static"
tracked_static_sha="$(sha256sum "/workspace/$tracked_static" | cut -d ' ' -f 1)"
mkdir -p "$source/$(dirname "$tracked_static")"
cp "/workspace/$tracked_static" "$source/$tracked_static"
if cloudcrane-normalize-k714 "$source" >/tmp/cloudcrane-k714-static.out 2>/tmp/cloudcrane-k714-static.err; then
  exit 11
fi
grep -qxF 'ERROR MANAGED_RUNTIME_CONFLICT: source static asset would overwrite managed runtime file' /tmp/cloudcrane-k714-static.err
test "$(sha256sum "/workspace/$tracked_static" | cut -d ' ' -f 1)" = "$tracked_static_sha"
rm -rf "$source/$(dirname "$tracked_static")"
mkdir -p "$source/static/assets"
printf '%s\n' 'body{}' > "$source/static/css/site.css"
printf '%s\n' 'not allowed' > "$source/static/misc/ignored.txt"
printf '%s\n' 'K714 new asset' > "$source/static/assets/k714.css"

before_db_sha="$(sha256sum /workspace/data/pbootcms.db | cut -d ' ' -f 1)"
before_skin_sha="$(sha256sum /workspace/skin/css/site.css | cut -d ' ' -f 1)"
before_sn="$(sqlite3 /workspace/data/pbootcms.db "SELECT value FROM ay_config WHERE name='sn';")"
before_admin="$(sqlite3 /workspace/data/pbootcms.db "SELECT username FROM ay_user LIMIT 1;")"
before_site_title="$(sqlite3 /workspace/data/pbootcms.db "SELECT title FROM ay_site LIMIT 1;")"
printf '%s\n' '<h1>rollback marker</h1>' > "$source/template/dafeult/rollback.html"
printf '%s\n' 'K714 replacement' > "$source/skin/css/site.css"
if CLOUDCRANE_K714_TEST_FAIL_AFTER_PROMOTE=1 cloudcrane-normalize-k714 "$source" >/tmp/cloudcrane-k714-rollback.out 2>/tmp/cloudcrane-k714-rollback.err; then
  exit 12
fi
grep -qxF 'ERROR TEST_POST_PROMOTE_FAILURE: injected post-promote failure' /tmp/cloudcrane-k714-rollback.err
test "$(sha256sum /workspace/data/pbootcms.db | cut -d ' ' -f 1)" = "$before_db_sha"
test "$(sha256sum /workspace/skin/css/site.css | cut -d ' ' -f 1)" = "$before_skin_sha"
test "$(sqlite3 /workspace/data/pbootcms.db "SELECT value FROM ay_config WHERE name='sn';")" = "$before_sn"
test "$(sqlite3 /workspace/data/pbootcms.db "SELECT username FROM ay_user LIMIT 1;")" = "$before_admin"
test "$(sqlite3 /workspace/data/pbootcms.db "SELECT title FROM ay_site LIMIT 1;")" = "$before_site_title"
test ! -e /workspace/template/dafeult/rollback.html

multi_source="$(mktemp -d /tmp/cloudcrane-k714-multi.XXXXXX)"
cp -a "$source/." "$multi_source/"
php -r '$p=$argv[1]; $db=new PDO("sqlite:".$p); $cols=[]; foreach ($db->query("PRAGMA table_info(ay_site)") as $c) if ((int)$c["pk"] === 0) $cols[]=$c["name"]; $row=$db->query("SELECT ".implode(",", array_map(fn($c)=>"\"".str_replace("\"","\"\"",$c)."\"", $cols))." FROM ay_site LIMIT 1")->fetch(PDO::FETCH_ASSOC); $names=implode(",", array_map(fn($c)=>"\"".str_replace("\"","\"\"",$c)."\"", $cols)); $db->prepare("INSERT INTO ay_site ({$names}) VALUES (".implode(",", array_fill(0, count($cols), "?")).")")->execute(array_values($row));' "$multi_source/data/pbootcms.db"
if cloudcrane-normalize-k714 "$multi_source" >/tmp/cloudcrane-k714-site.out 2>/tmp/cloudcrane-k714-site.err; then
  exit 13
fi
grep -qxF 'ERROR UNSUPPORTED_K714_SITE_LAYOUT: source ay_site must contain exactly one row' /tmp/cloudcrane-k714-site.err
rm -rf "$multi_source"

mkdir -p /workspace/runtime/config /workspace/runtime/cache /workspace/runtime/complile
touch /workspace/runtime/config/k714-marker /workspace/runtime/cache/k714-marker /workspace/runtime/complile/k714-marker
cloudcrane-normalize-k714 "$source" >/tmp/cloudcrane-k714-pass.out
grep -q '"status":"NORMALIZED"' /tmp/cloudcrane-k714-pass.out
test -f /workspace/template/dafeult/index.html
test -f /workspace/skin/css/site.css
test -f /workspace/static/css/site.css
test -f /workspace/static/assets/k714.css
test ! -e /workspace/static/css/unsafe.php
test ! -e /workspace/static/misc/ignored.txt
test ! -e /workspace/runtime/config/k714-marker
test ! -e /workspace/runtime/cache/k714-marker
test ! -e /workspace/runtime/complile/k714-marker
test "$(sqlite3 /workspace/data/pbootcms.db "SELECT value FROM ay_config WHERE name='sn';")" = 'destination-secret'
test "$(sqlite3 /workspace/data/pbootcms.db "SELECT username FROM ay_user LIMIT 1;")" = 'destination-admin-marker'
test -f /workspace/.cloudcrane/template-import.json
! grep -q 'source-only\|destination-secret\|destination-admin-marker\|/tmp\|/workspace' /workspace/.cloudcrane/template-import.json
printf '%s\n' K714_FIXTURES_PASS
