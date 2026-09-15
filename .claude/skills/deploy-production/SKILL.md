---
name: deploy-production
description: Deploy the current main branch to the production VM and verify it, or roll back to the previous image. Use after a spec has been implemented and the gate is green, or when production is broken.
---

# Deploy to production

Production is a single GCP VM running `docker compose`: the Next.js app behind
Caddy (automatic TLS). The SQLite database lives on a host volume and is
**never** inside the image.

## Preconditions — check all four, in order

```bash
git status --porcelain          # must be empty
git rev-parse --abbrev-ref HEAD # must be main
npm run typecheck && npm test && npm run build
```

Never deploy a dirty tree, a branch that is not `main`, or a red gate. If any
check fails, stop and report — a broken production is worse than a late one.

## Deploy

```bash
scripts/agent/deploy.sh
```

It does, and will abort on the first failure:

1. `git pull --ff-only` on the VM checkout
2. back up the SQLite file to `data/backups/<timestamp>.db`
3. `docker compose build app`
4. `npm run db:migrate` inside the new image
5. `docker compose up -d`
6. poll `https://$SITE_DOMAIN/api/health` until it reports `ok` (60s budget)

Run it from the repo root on the VM. From your laptop, prefix with
`tailscale ssh hermes@evg-site-agent`.

## Verify — do not skip this

```bash
curl -fsS https://$SITE_DOMAIN/api/health | jq .
```

Expect `{"status":"ok","migrations":"current","commit":"<sha>"}`. The commit
must be the one you just deployed; if it is the previous sha, the container did
not restart.

Then check the logs for the 30 seconds after start:

```bash
docker compose logs --since 30s app
```

## Roll back

```bash
scripts/agent/deploy.sh --rollback
```

Redeploys the previous commit and restores nothing by default — **the database
is not rolled back**, because a rollback of data would destroy results players
entered in the meantime. If a migration corrupted data, stop and escalate to
the human with the backup path; do not improvise a data repair.

## Report

```
DEPLOY: ok | failed | rolled-back
COMMIT: <sha>
HEALTH: ok | <error>
MIGRATIONS: <n applied>
NOTES: <anything the human should know>
```

## Never

- Deploy from a branch other than `main`.
- Run `docker compose down -v` — that deletes the database volume.
- Edit files directly on the VM. The VM is a deploy target, not a workspace;
  any fix goes through spec → code → deploy.
- Claim a deploy succeeded without reading the health check output.
