/**
 * Imports schema/schema.sql into the configured SQLite database.
 *
 * Usage: npm run db:init
 *
 * Connection settings come from .env (loaded by the npm script):
 *   PAPER_DB_PATH  — database file, relative to the project root or absolute
 *                    (default: data/paper.db)
 *
 * All DDL is idempotent, so running this against an existing database adds
 * only missing tables/indexes and never deletes data.
 */

import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const schemaPath = resolve(root, 'schema/schema.sql')
const configured = process.env.PAPER_DB_PATH?.trim()
const dbPath = configured ? resolve(root, configured) : resolve(root, 'data/paper.db')

console.log(`Schema file: ${schemaPath}`)
console.log(`Database:    ${dbPath} (SQLite)`)

const schema = readFileSync(schemaPath, 'utf8')
const checksum = createHash('sha256').update(schema).digest('hex').slice(0, 12)

mkdirSync(dirname(dbPath), { recursive: true })
const db = new DatabaseSync(dbPath)
db.exec(schema)

const integrity = db.prepare('PRAGMA integrity_check').get()
const tables = db
  .prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  )
  .all()
  .map((row) => row.name)

console.log(`Schema applied (sha256: ${checksum}…, ${schema.length} bytes)`)
console.log(`Integrity check: ${integrity.integrity_check}`)
console.log(`Tables (${tables.length}): ${tables.join(', ')}`)

for (const table of tables) {
  const count = db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get().n
  console.log(`  ${table}: ${count} rows`)
}

db.close()
console.log(`Done. Database file ${existsSync(dbPath) ? 'ready' : 'missing'}.`)
