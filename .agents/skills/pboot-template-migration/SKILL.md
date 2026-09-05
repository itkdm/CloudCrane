---
name: pboot-template-migration
description: Rebuild a read-only PbootCMS reference snapshot in the managed CloudCrane Workspace.
---

# Pboot Template Migration

You work with two deliberately separate trees:

- `TARGET`: `/workspace`, the writable CloudCrane Website Workspace running the managed PbootCMS runtime.
- `REFERENCE`: the path returned by the active `reference_upload` tool, for example `/workspace/.cloudcrane/references/ref_xxx`, mounted read-only. Do not assume a fixed reference id or a `template-source` directory.

The task is to understand the reference site and rebuild its visual structure, content presentation, assets, and required site data in TARGET. It is not a request to upgrade or wholesale-copy the old site.

## Inspect before changing TARGET

Start with `git status --porcelain` in TARGET. Inspect REFERENCE first using `read`, `ls`, `find`, `rg`, `cat`, and read-only SQLite inspection. Identify the Pboot version, active theme, template layout, CSS/JS/image dependencies, external services, database type, and the actual data used by the pages.

Understand the page before migrating data: header, navigation, hero/banner, products, news, company information, links, contact, footer, and which parts are static, Pboot-tag driven, database-backed, or JavaScript-driven.

Compare the managed PbootCMS runtime in TARGET with the reference and choose normal coding actions such as COPY, ADAPT, REWRITE, or SKIP. Do not create a migration plan DSL or require a fixed table/file list.

## Hard boundaries

REFERENCE is filesystem read-only. First read the active `reference_upload` tool result or the current context to identify its path. Never write, edit, delete, chmod, execute PHP or shell from it, start its old Pboot site, use its old admin, or use its authorization. Never try to escape the reference mount or access host files.

TARGET is the only writable site. CloudCrane-managed runtime remains authoritative: do not wholesale-copy or replace `core/`, `apps/`, `admin.php`, `index.php`, core `config/`, authorization logic, runtime/system state, or upgrade state. If a feature depends on changed old Core or apps and cannot be safely recreated in the managed version, stop and report `CORE_COMPATIBILITY_BLOCKER` with the relevant source path and reason.

Never migrate old authorization (`sn`, `sn_user`, `licensecode`), administrator accounts/passwords/roles, sessions, logs, security state, or system upgrade state. Preserve TARGET authorization and administrator data. Do not replace TARGET's SQLite database wholesale; inspect the reference database and write only the site data actually required by the rebuilt pages, using the current TARGET schema.

Do not assume fixed directories such as `template/`, `skin/`, or `static/upload/`. Follow real references and migrate only required safe assets. Never copy an entire old `static/`, `core/`, or `apps/` tree without analysis.

## Verify the result

After each meaningful change, use the existing Preview tools:

1. `preview_refresh`
2. `preview_observe`
3. Inspect DOM/text and console/network evidence.

Check the homepage at desktop width 1440 and mobile width 390. Fix broken CSS, JS, image paths, important console errors, and large groups of 404s before declaring success. If Preview is unavailable or authorization is missing, report that fact instead of bypassing it.

Before committing, run `git diff --check`, inspect `git diff`, and confirm only intended TARGET files changed. Use one focused commit for one migration. Never use force push or destructive Git reset/clean commands.
