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

sqlite3 "$source/data/pbootcms.db" "UPDATE ay_config SET value='source-only' WHERE name='sn';"
sqlite3 /workspace/data/pbootcms.db "UPDATE ay_config SET value='destination-secret' WHERE name='sn';"
sqlite3 /workspace/data/pbootcms.db "UPDATE ay_user SET username='destination-admin-marker' WHERE id=(SELECT id FROM ay_user LIMIT 1);"

touch /workspace/k714-dirty-fixture
if cloudcrane-normalize-k714 "$source" >/tmp/cloudcrane-k714-dirty.out 2>/tmp/cloudcrane-k714-dirty.err; then
  exit 10
fi
grep -qxF 'ERROR DIRTY_DESTINATION: destination Git status is not clean' /tmp/cloudcrane-k714-dirty.err
rm -f /workspace/k714-dirty-fixture

mkdir -p /workspace/runtime/config /workspace/runtime/cache /workspace/runtime/complile
touch /workspace/runtime/config/k714-marker /workspace/runtime/cache/k714-marker /workspace/runtime/complile/k714-marker
cloudcrane-normalize-k714 "$source" >/tmp/cloudcrane-k714-pass.out
grep -q '"status":"NORMALIZED"' /tmp/cloudcrane-k714-pass.out
test -f /workspace/template/dafeult/index.html
test -f /workspace/skin/css/site.css
test -f /workspace/static/css/site.css
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
