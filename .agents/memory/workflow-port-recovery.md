---
name: Workflow port recovery
description: Recover artifact workflows when a restart fails because the configured port is already occupied.
---

When a managed artifact workflow reports `EADDRINUSE` after a restart, an earlier instance can still be alive and holding its port even though the workflow is marked failed.

**Why:** Retrying the restart without clearing the stale process creates another duplicate and leaves the workflow unavailable.

**How to apply:** Confirm the exact listener and its process group, stop only the identified artifact process, verify the port is free, then restart the managed workflow once.
