# Database schema

CryptoPilot AI ships two equivalent schemas:

| File | Database |
|---|---|
| `schema/schema.sql` | SQLite (the app's default, embedded via `node:sqlite`) |
| `schema/schema.mysql.sql` | MySQL / MariaDB (hosting database) |

Both are idempotent (`CREATE TABLE IF NOT EXISTS`): importing them adds only
missing tables and indexes, and never drops or overwrites existing data.

## MySQL / MariaDB

### From phpMyAdmin

1. Open phpMyAdmin and select the target database (e.g. `rsmc_rsmc71_01`).
2. Go to **Import** → **Choose File** → select `schema/schema.mysql.sql`.
3. Format: **SQL**, charset **utf-8**, then **Go**.

### From the command line

```bash
npm run db:init:mysql
```

This uses `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` and the
optional `DB_SSL=1` from `.env`. Credentials are never printed.

> Shared hosting usually blocks MySQL port 3306 from outside. Either import
> through phpMyAdmin, or allow your IP in cPanel → **Remote MySQL** first.

## SQLite

```bash
npm run db:init
```

Uses `PAPER_DB_PATH` (default `data/paper.db`).
