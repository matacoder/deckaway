# Backups of everything, and a proven restore

1. **Destination.** Dokploy → Settings → S3 Destinations: the owner's endpoint, bucket, region, keys (from
   `~/.config/dokploy/<host>.env`, entered by the owner). "Test connection" must pass.
2. **Databases.** Every Dokploy database service (Postgres, MySQL, MariaDB, Mongo): a scheduled backup to that
   destination, daily or hourly as the profile says, keeping 14 copies. A database inside a compose app: a
   Dokploy schedule running its dump (`pg_dump -Fc`) into a volume that the volume backup carries.
3. **Volumes.** Uploads and app data: Dokploy volume backups to the same destination. Monitoring data too
   (Kuma, Beszel, Bugsink, Dotasker) — losing them loses history, not service.
4. **Dokploy itself.** Its own backup (Settings → Backups) to the destination, so the server can be rebuilt.
5. **Prove one restore.** Download the newest dump, restore it into a scratch container (never over
   production), count rows of a main table, compare with production. Write the date and the result in the
   report and in `.deckaway/support.md`. Repeat monthly.
6. **Alerts.** A failed backup notifies the client's errors topic.

The fresh-data command of deck-support reads the same backups: the newest dump into the duty tree's stand.
