/** Runs once when a server starts: starts the media pipeline worker (Node runtime only, never during a build). */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  if (process.env.MEDIA_WORKER === 'off' || process.env.NEXT_PHASE === 'phase-production-build') return
  if (!process.env.DATABASE_URL) return
  const { startWorker } = await import('./lib/media/worker')
  startWorker()
}
