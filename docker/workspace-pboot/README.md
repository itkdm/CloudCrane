# CloudCrane Workspace Image

This image is the V1 Runtime Foundation image for a Website Workspace. It contains the Workspace Daemon, Node.js 22, PHP CLI, Git, SQLite CLI, ripgrep, and a non-root `workspace` user with `/workspace` as its working directory.

The image contains the vetted PbootCMS V3.2.26 base at commit `8c7ad1da5e1d1ba217fde56912f001e14cb9b0ea` and the trusted `cloudcrane-init-pboot` bootstrap command. A new Workspace copies this local base into `/workspace`; it does not download PbootCMS at runtime. Host persistence is mounted at `/workspace`.

**Production egress status checked 2026-10-04:** Workspace containers retain public HTTPS egress. The production host installs explicit `DOCKER-USER` denies for Alibaba Metadata (`100.100.100.200/32`) and IPv4 link-local (`169.254.0.0/16`), replayed by a systemd unit and Docker service drop-in. The verifier checks Alibaba Metadata GET/token PUT and `169.254.169.254` GET are rejected by host firewall counters while direct public HTTPS remains reachable. Docker daemon restart recovery was verified with Workspace, Production, and PostgreSQL containers still running; Web and Agent health checks and post-restart Workspace probes passed. Full host reboot recovery was also verified twice: metadata rules restore automatically, and after `5ef0bcc` the Workspace container restarts automatically with `unless-stopped`. The tmux-managed platform processes still require `scripts/server-acceptance-start.sh` after host boot. The inspected production Workspace Docker network has IPv6 disabled; provider identity/control-plane token-required mode remain unverified. If Workspace IPv6 is enabled later, its metadata routes need equivalent firewall rules and live tests. The Workspace data root uses ext4 project quotas; per-Workspace hard block and inode limits are applied by Runner, and quota setup fails closed. See [production deployment verification](../../docs/operations/cloudcrane-production-deploy.md) for deployment details and limitations. A domain allowlist remains a separate future hardening task.

The image also contains the K714-only `cloudcrane-normalize-k714` helper. It accepts a previously safe-extracted source directory and normalizes only the K714 theme/assets and business data into the already bootstrapped `/workspace`; it never extracts archives, replaces the managed runtime, imports authorization/admin state, or commits Git changes. The helper is intended to run through the existing Workspace `process.exec` path:

```text
cloudcrane-normalize-k714 /private/path/to/k714-source
```

The image build also includes the tracked `pboot-template-migration` and `pbootcms-upgrade` runtime skills from `docker/workspace-pboot/skills/`. During workspace initialization, `cloudcrane-init-pboot` copies them into `/workspace/.agents/skills/`. The repository root `.agents/` directory is local agent configuration and is intentionally ignored by Git; image builds must not depend on it.
