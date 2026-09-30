# Offline backup and restore

A consistent backup needs both SQLite and originals from the same point in time.
Stop the app before running these tools. `SELFCLOUD_OFFLINE=true` confirms you
have done this; it does not stop the app for you. Use a separate physical disk
for backups when possible. Backups contain private photos and metadata.

## Docker backup

```sh
docker compose stop selfcloud
docker compose run --rm --no-deps -e SELFCLOUD_OFFLINE=true selfcloud node scripts/backup.js /backups/first-backup
docker compose up -d
```

Use a new destination each time. Keep `.env` and your Compose configuration
separately alongside the backup; the script does not copy secrets. The backup
contains a compact SQLite snapshot, originals, and a SHA-256 integrity manifest.
Previews are regenerated after restore.

## Restore

Stop the server. Restore into an **empty data directory or a new volume**; the
tool refuses to overwrite existing data. Preserve the previous volume first.
One approach is to change the data mount to a new, empty directory owned by UID
1000, then run:

```sh
docker compose run --rm --no-deps -e SELFCLOUD_OFFLINE=true selfcloud node scripts/restore.js /backups/first-backup
docker compose up -d
```

Restore verifies the manifest, original coverage, and SQLite integrity before
copying. It invalidates sessions and schedules photo preview regeneration.

## Node development installation

With the server stopped:

```sh
SELFCLOUD_OFFLINE=true npm run backup -- ./backups/example
DATA_DIR=./restored-data SELFCLOUD_OFFLINE=true npm run restore -- ./backups/example
```

The chosen backup destination must be outside `DATA_DIR`. Test restoration to a
separate empty directory periodically instead of assuming a backup is usable.
