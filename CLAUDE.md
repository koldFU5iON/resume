@AGENTS.md

## Git workflow

Before creating any new branch, always fetch first and cut from `origin/main`:

```bash
git fetch origin
git switch -c feat/<name> origin/main
```

Never branch from local `main` — it may be stale. This applies whether starting a new feature, a bugfix, or any other work that needs its own branch.
