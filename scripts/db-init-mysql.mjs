/**
 * Imports schema/schema.mysql.sql into the configured MySQL/MariaDB database.
 *
 * Usage: npm run db:init:mysql
 *
 * Connection settings come from .env (loaded by the npm script):
 *   DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD
 *   DB_SSL=1  — enable TLS (some shared hosts require it)
 *
 * All DDL is idempotent, so running this against an existing database adds
 * only missing tables/indexes and never deletes data. Credentials are never
 * printed.
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import mysql from 'mysql2/promise'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const schemaPath = resolve(root, 'schema/schema.mysql.sql')

const host = process.env.DB_HOST?.trim()
const port = Number(process.env.DB_PORT?.trim() || 3306)
const database = process.env.DB_NAME?.trim()
const user = process.env.DB_USER?.trim()
const password = process.env.DB_PASSWORD ?? ''
const ssl = process.env.DB_SSL === '1'

const missing = [
  !host && 'DB_HOST',
  !database && 'DB_NAME',
  !user && 'DB_USER',
].filter(Boolean)

if (missing.length > 0) {
  console.error(`Missing environment variables: ${missing.join(', ')}`)
  console.error('Add them to .env (never hardcode credentials in source).')
  process.exit(1)
}

console.log(`Schema file: ${schemaPath}`)
console.log(`Target:      MySQL ${host}:${port}/${database} as ${user} (TLS: ${ssl ? 'on' : 'off'})`)

const schema = readFileSync(schemaPath, 'utf8')

let connection
try {
  connection = await mysql.createConnection({
    host,
    port,
    database,
    user,
    password,
    ssl: ssl ? { rejectUnauthorized: true } : undefined,
    connectTimeout: 12_000,
    multipleStatements: true,
    charset: 'utf8mb4',
  })
} catch (error) {
  console.error(`Connection FAILED: ${error.code ?? error.name}: ${error.message}`)
  console.error('Check DB_HOST/DB_PORT and that this machine is allowed to connect to the database.')
  process.exit(1)
}

try {
  const [versionRows] = await connection.query('SELECT VERSION() AS version, DATABASE() AS db')
  const versionRow = versionRows[0]
  console.log(`Connected: server ${versionRow.version}, database ${versionRow.db}`)

  await connection.query(schema)
  console.log(`Schema applied (${schema.length} bytes): ${schemaPath}`)

  const [tables] = await connection.query(
    `SELECT TABLE_NAME AS name FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME`,
    [database],
  )

  console.log(`Tables (${tables.length}): ${tables.map((row) => row.name).join(', ')}`)
  for (const table of tables) {
    const [countRows] = await connection.query(
      `SELECT COUNT(*) AS n FROM \`${String(table.name).replaceAll('`', '``')}\``,
    )
    console.log(`  ${table.name}: ${Number(countRows[0].n)} rows`)
  }

  const [checks] = await connection.query('SELECT 1 AS ok')
  console.log(`Connection test: ${checks[0]?.ok === 1 ? 'ok' : 'unexpected result'}`)
} catch (error) {
  console.error(`Schema import FAILED: ${error.code ?? error.name}: ${error.message}`)
  process.exitCode = 1
} finally {
  await connection.end()
}
