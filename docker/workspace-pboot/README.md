# CloudCrane Workspace Image

This image is the V1 Runtime Foundation image for a Website Workspace. It contains the Workspace Daemon, Node.js 22, PHP CLI, Git, SQLite CLI, ripgrep, and a non-root `workspace` user with `/workspace` as its working directory.

The image contains the vetted PbootCMS V3.2.24 base at commit `29ff72ee5afc9c6553b949f04d3fc99443879f40` and the trusted `cloudcrane-init-pboot` bootstrap command. A new Workspace copies this local base into `/workspace`; it does not download PbootCMS at runtime. Host persistence is mounted at `/workspace`; the current Host egress policy is **NOT YET ENFORCED** and must be addressed before production rollout.
