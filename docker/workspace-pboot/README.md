# CloudCrane Workspace Image

This image is the V1 Runtime Foundation image for a Website Workspace. It contains the Workspace Daemon, Node.js 22, PHP CLI, Git, SQLite CLI, ripgrep, and a non-root `workspace` user with `/workspace` as its working directory.

The image does not contain a user website or PbootCMS site data. Host persistence is mounted at `/workspace`; the current Host egress policy is **NOT YET ENFORCED** and must be addressed before production rollout.
