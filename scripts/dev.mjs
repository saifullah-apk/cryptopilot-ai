/**
 * Dev runner: API server (with Gemini key from .env) + Vite together.
 * No extra dependencies — plain child processes.
 */

import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/* Minimal .env loader so dev and production agree on env vars. */
const envFile = join(root, '.env')
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
    if (!match) continue
    const [, key, rawValue] = match
    if (process.env[key] !== undefined) continue
    process.env[key] = rawValue.replace(/^["']|["']$/g, '')
  }
}

const children = []
let shuttingDown = false

function shutdown(code) {
  if (shuttingDown) return
  shuttingDown = true
  for (const child of children) {
    if (!child.killed) child.kill()
  }
  process.exit(code)
}

function run(label, command, args) {
  const child = spawn(command, args, {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
  })
  children.push(child)

  child.on('error', (error) => {
    console.error(`[${label}] failed to start: ${error.message}`)
    shutdown(1)
  })

  child.on('exit', (code, signal) => {
    if (shuttingDown) return
    if (signal) console.error(`[${label}] stopped (${signal})`)
    else console.error(`[${label}] exited with code ${code ?? 1}`)
    shutdown(code ?? 1)
  })
}

run('api', process.execPath, [join(root, 'server', 'index.ts')])
run('vite', process.execPath, [join(root, 'node_modules', 'vite', 'bin', 'vite.js')])

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => shutdown(0))
}
