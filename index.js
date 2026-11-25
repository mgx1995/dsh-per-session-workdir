/**
 * One dedicated working folder per conversation, named by its creation time,
 * plus periodic cleanup of empty folders left behind by closed sessions.
 *
 * On agent/created a sub-folder named `YYYY-MM-DD_HH-MM-SS` (from the stable
 * session header.createdAt) is created under the workspace root and the
 * Session's durable working directory is switched to it. A background timer
 * removes empty, unoccupied folders so they do not pile up.
 */
import { mkdir, readdir, rmdir, stat } from 'node:fs/promises'
import path from 'node:path'

const pad = (n) => String(n).padStart(2, '0')

/** Only folders this plugin can have created are eligible for cleanup. */
const FOLDER_RE = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/

/** How often the cleanup sweeps (ms). */
const CLEAN_INTERVAL_MS = 30 * 60 * 1000
/** A folder must be untouched for this long before it may be removed (ms). */
const MIN_AGE_MS = 5 * 60 * 1000

function folderNameFrom(session) {
  const stamp = session?.header?.createdAt
  const date = Number.isFinite(stamp) && stamp > 0 ? new Date(stamp) : new Date()
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
}

function sessionIdOf(agent) {
  const session = agent?.session
  return session?.id ?? session?.sessionId ?? agent?.id ?? agent?.sessionId ?? undefined
}

/** Derive the folder path for an agent, or undefined when it has no session. */
function folderOf(agent, workingDirectory) {
  const session = agent?.session
  if (session === undefined) return undefined
  const root = session.header?.cwd || workingDirectory.defaultDirectory || process.cwd()
  return path.join(root, folderNameFrom(session))
}

/**
 * Remove empty session folders under `roots` that are not in `activeDirs` and
 * have not been modified in the last `minAgeMs`. Exported for direct testing.
 */
export async function cleanEmptyFolders({ roots, activeDirs = new Set(), minAgeMs = MIN_AGE_MS, logger } = {}) {
  const removed = []
  const now = Date.now()
  for (const root of roots ?? []) {
    let entries
    try {
      entries = await readdir(root, { withFileTypes: true })
    } catch (error) {
      logger?.warn?.(`session-folders: cleanup cannot read ${root}: ${String(error)}`)
      continue
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || !FOLDER_RE.test(entry.name)) continue
      const full = path.join(root, entry.name)
      if (activeDirs.has(full)) continue
      try {
        const info = await stat(full)
        if (now - info.mtimeMs < minAgeMs) continue
        const children = await readdir(full)
        if (children.length !== 0) continue
        await rmdir(full)
        removed.push(full)
        logger?.info?.(`session-folders: removed empty folder ${full}`)
      } catch (error) {
        logger?.warn?.(`session-folders: cleanup skipped ${full}: ${String(error)}`)
      }
    }
  }
  return removed
}

export const inject = ['workingDirectory', 'timer']

export function apply(ctx) {
  const workingDirectory = ctx.workingDirectory
  const timer = ctx.timer
  if (workingDirectory === undefined) return

  /** Folders currently owned by a live Session — never removed by cleanup. */
  const activeDirs = new Set()
  /** Workspace roots observed from sessions, used as cleanup scan targets. */
  const roots = new Set()
  const log = {
    info: (m) => ctx.logger?.info?.(m),
    warn: (m) => ctx.logger?.warn?.(m),
  }

  ctx.on('agent/created', async ({ agent, signal }) => {
    try {
      const id = sessionIdOf(agent)
      if (agent.session === undefined) return

      const target = folderOf(agent, workingDirectory)
      if (target === undefined) return
      const root = path.dirname(target)

      await mkdir(target, { recursive: true })
      signal?.throwIfAborted()
      await workingDirectory.set(agent, target)
      activeDirs.add(target)
      roots.add(root)

      log.info(`session-folders: session ${id ?? '?'} -> ${target}`)
    } catch (error) {
      // A failure must never block the conversation: it simply keeps the
      // original working directory for that Session.
      log.warn(`session-folders: could not set folder for session: ${String(error)}`)
    }
  })

  ctx.on('agent/disposed', ({ agent }) => {
    const target = folderOf(agent, workingDirectory)
    if (target !== undefined) activeDirs.delete(target)
  })

  // Both timer helpers return a disposer function bound to this fiber; register
  // them inside an effect so plugin unload tears them down.
  ctx.effect(() => {
    const sweep = () => cleanEmptyFolders({ roots, activeDirs, logger: log })
    const stopInitial = timer?.timeout?.(sweep, 60 * 1000)
    const stopPeriodic = timer?.interval?.(sweep, CLEAN_INTERVAL_MS)
    return () => {
      stopInitial?.()
      stopPeriodic?.()
    }
  })
}
