/**
 * One dedicated working folder per conversation, named by its creation time.
 *
 * When a Session opens (agent/created), this plugin creates a sub-folder under
 * the workspace root named `YYYY-MM-DD_HH-MM-SS` from the Session's stable
 * `header.createdAt`, then points that Session's durable working directory at
 * it through the built-in `workingDirectory` service. Files written by one
 * conversation therefore land in its own folder instead of a shared one.
 */
import { mkdir } from 'node:fs/promises'
import path from 'node:path'

const pad = (n) => String(n).padStart(2, '0')

/**
 * Derive a stable, human-readable folder name from the Session creation time.
 * Using header.createdAt (immutable) instead of Date.now() keeps the name
 * identical across every open/resume of the same Session.
 */
function folderNameFrom(session) {
  const stamp = session?.header?.createdAt
  const date = Number.isFinite(stamp) && stamp > 0 ? new Date(stamp) : new Date()
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
}

function sessionIdOf(agent) {
  const session = agent?.session
  return session?.id ?? session?.sessionId ?? agent?.id ?? agent?.sessionId ?? undefined
}

export const inject = ['workingDirectory']

export function apply(ctx) {
  const workingDirectory = ctx.workingDirectory
  if (workingDirectory === undefined) return

  ctx.on('agent/created', async ({ agent, signal }) => {
    try {
      const session = agent.session
      const id = sessionIdOf(agent)
      if (session === undefined) return

      // The Session header keeps the original project directory; the effective
      // directory is only a projection, so every Session in the same workspace
      // resolves to the same root and folders never nest.
      const root = session.header?.cwd || workingDirectory.defaultDirectory || process.cwd()
      const name = folderNameFrom(session)
      const target = path.join(root, name)

      await mkdir(target, { recursive: true })
      signal?.throwIfAborted()
      await workingDirectory.set(agent, target)

      ctx.logger.info(`per-session-workdir: session ${id ?? '?'} -> ${target}`)
    } catch (error) {
      // A failure must never block the conversation: it simply keeps the
      // original working directory for that Session.
      ctx.logger.warn(`per-session-workdir: could not set folder for session: ${String(error)}`)
    }
  })
}
