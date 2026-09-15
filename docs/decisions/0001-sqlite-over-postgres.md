# 0001 — SQLite over Postgres

- **Date**: 2026-09-14
- **Status**: accepted

## Context

The app records matches and points for one bachelor-party weekend: on the order
of 15 players, a few hundred matches, and at most a dozen phones hitting it at
once. It runs on a single GCP VM that is created and destroyed from a GitHub
Actions workflow, next to an agent pipeline that also needs CPU and RAM on the
same machine.

## Decision

SQLite in WAL mode, one file on a mounted volume, accessed through Drizzle.

## Why

- **One less container to keep alive.** Postgres on the same 4 GB VM competes
  for memory with `next build`, which the deploy script runs on the machine.
- **Backups are a file copy.** `sqlite3 .backup` is safe on a live database and
  runs before every migration, in the deploy script, without credentials or a
  dump format.
- **WAL is enough concurrency.** The only concurrent writer is the sweeper,
  once a minute; readers never block it and `busy_timeout` absorbs the overlap.
- **Restoring is obvious under pressure.** At 2 a.m., "copy the file back" beats
  "remember the `pg_restore` flags".

## Consequences

- The database lives on the VM's boot disk, so destroying the infrastructure
  destroys the data. `destroy-infra.yml` says so and asks for a typed
  confirmation; `docs/deployment.md` documents the manual backup.
- Horizontal scaling is off the table. For this product that is not a
  constraint, it is the point.
- Migrations must stay additive: no dropping a column that holds history.
- Moving to Postgres later means changing `src/db/index.ts`, the Drizzle
  dialect, and the migration files. Everything above `src/db` is dialect-free
  because it only ever talks to Drizzle.
