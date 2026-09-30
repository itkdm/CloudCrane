# CloudCrane Workspace Image

This image is the V1 Runtime Foundation image for a Website Workspace. It contains the Workspace Daemon, Node.js 22, PHP CLI, Git, SQLite CLI, ripgrep, and a non-root `workspace` user with `/workspace` as its working directory.

The image contains the vetted PbootCMS V3.2.26 base at commit `8c7ad1da5e1d1ba217fde56912f001e14cb9b0ea` and the trusted `cloudcrane-init-pboot` bootstrap command. A new Workspace copies this local base into `/workspace`; it does not download PbootCMS at runtime. Host persistence is mounted at `/workspace`.

**Production egress status checked 2026-10-01:** Workspace containers use ordinary Docker bridge networks with public Internet egress; a request to `https://example.com` succeeded. The host has no custom `DOCKER-USER` egress rules and UFW is inactive. Tech-02 permits public Internet access as needed for V1 but requires ECS metadata to be blocked. TCP probes to `100.100.100.200:80` timed out from both host and Workspace, but no explicit deny rule was found, so this does not prove that metadata access is intentionally blocked. Add and verify an explicit metadata deny rule before treating the production host as meeting that security requirement. A domain allowlist remains a separate future hardening task.

The image also contains the K714-only `cloudcrane-normalize-k714` helper. It accepts a previously safe-extracted source directory and normalizes only the K714 theme/assets and business data into the already bootstrapped `/workspace`; it never extracts archives, replaces the managed runtime, imports authorization/admin state, or commits Git changes. The helper is intended to run through the existing Workspace `process.exec` path:

```text
cloudcrane-normalize-k714 /private/path/to/k714-source
```

The image build also includes the tracked `pboot-template-migration` and `pbootcms-upgrade` runtime skills from `docker/workspace-pboot/skills/`. During workspace initialization, `cloudcrane-init-pboot` copies them into `/workspace/.agents/skills/`. The repository root `.agents/` directory is local agent configuration and is intentionally ignored by Git; image builds must not depend on it.
