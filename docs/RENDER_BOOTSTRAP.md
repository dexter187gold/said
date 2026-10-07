# Render free tier — SQLite bootstrap restore

Render free disks are **ephemeral**. Sleep/redeploy can wipe `said.db`.

## How SAID handles it

1. On startup, if live DB is missing or tiny, copy `server/data/said.bootstrap.db` → live DB.
2. That bootstrap file must be **in the GitHub repo** (baked into the Docker image on deploy).
3. Live DB on the server is still ephemeral until you refresh the bootstrap in git.

## Workflow (Termux + GitHub)

1. Use the app on Render until you have data worth keeping.
2. As **admin**, Settings → **Download backup** (or `GET /api/v1/auth/backup`).
3. On Termux:
```bash
cd ~/projects/said
mkdir -p server/data
cp /path/to/said-backup-YYYY-MM-DD.db server/data/said.bootstrap.db
git add server/data/said.bootstrap.db
git commit -m "chore: refresh SQLite bootstrap snapshot"
git push origin main
```
4. Wait for Render to redeploy. Next cold start restores from bootstrap.

Optional: `POST /api/v1/auth/bootstrap-snapshot` writes bootstrap on **server disk only** (still lost on free wipe unless you download + commit).

## Security

Bootstrap contains password hashes, clients, invoices. Prefer a **private** repo. Do not put real customer data in a public repo.

## Better long-term

Render persistent disk, or managed Postgres/Turso.
