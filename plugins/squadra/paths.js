/**
 * Where a session's plugin listens for its hooks: a unix socket named after
 * the Claude Code process (the parent of both the plugin and its hooks).
 *
 * Unix socket paths are short: 104 bytes on macOS, 108 on Linux. The usual
 * place, ~/.claude/channels/squadra/run/, fits on most machines, but not with a
 * long home or CLAUDE_CONFIG_DIR (typical on macOS, where temporary folders
 * live under /var/folders/…). Then the socket goes to /tmp/squadra-<uid>-<tag>,
 * a private folder per user and per config dir, which must be ours: in a
 * shared /tmp anyone could create it first.
 */

import { createHash } from 'node:crypto'
import { mkdirSync, lstatSync } from 'node:fs'
import { join } from 'node:path'

const MAX_SOCKET_PATH = 100

export function socketDirFor(runDir) {
  if (Buffer.byteLength(join(runDir, '4194304.sock')) <= MAX_SOCKET_PATH) return runDir
  const uid = typeof process.getuid === 'function' ? process.getuid() : 'u'
  const tag = createHash('sha256').update(runDir).digest('hex').slice(0, 10)
  return join('/tmp', `squadra-${uid}-${tag}`)
}

export const socketPathFor = (runDir, pid) => join(socketDirFor(runDir), `${pid}.sock`)

// A folder only this user can use: owned by us, no access for group or others.
export function isPrivateDir(dir) {
  try {
    const st = lstatSync(dir)
    if (!st.isDirectory()) return false
    if (typeof process.getuid === 'function' && st.uid !== process.getuid()) return false
    return (st.mode & 0o077) === 0
  } catch {
    return false
  }
}

// Create the socket folder. The fallback in /tmp is refused unless it is private.
export function prepareSocketDir(runDir) {
  const dir = socketDirFor(runDir)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  return dir === runDir || isPrivateDir(dir) ? dir : null
}
