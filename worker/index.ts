/// <reference types="@cloudflare/workers-types" />

interface Env {
  DB: D1Database
  ASSETS: Fetcher
}

interface ScoreRow {
  id: number
  name: string
  score: number
  duration: number
  mode: string
  date: string
}

interface PostBody {
  name?: unknown
  score?: unknown
  duration?: unknown
  mode?: unknown
}

const MODE_RE = /^[a-z0-9-]{1,32}$/
const MAX_NAME_LEN = 30
const MAX_SCORE = 100000
const MAX_DURATION = 86400

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

async function handleGet(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const mode = url.searchParams.get('mode') ?? ''
  if (!MODE_RE.test(mode)) {
    return json({ error: 'invalid mode' }, 400)
  }
  const { results } = await env.DB.prepare(
    `SELECT id, name, score, duration, mode, created_at AS date
     FROM highscores
     WHERE mode = ?
     ORDER BY score DESC, duration ASC
     LIMIT 10`,
  )
    .bind(mode)
    .all<ScoreRow>()
  return json({ scores: results ?? [] })
}

async function handlePost(request: Request, env: Env): Promise<Response> {
  let body: PostBody
  try {
    body = (await request.json()) as PostBody
  } catch {
    return json({ error: 'invalid json' }, 400)
  }

  const rawName = typeof body.name === 'string' ? body.name.trim() : ''
  const name = rawName.slice(0, MAX_NAME_LEN) || 'anoniem'

  const score = Math.floor(Number(body.score))
  const duration = Math.floor(Number(body.duration))
  const mode = typeof body.mode === 'string' ? body.mode : ''

  if (!Number.isFinite(score) || score < 0 || score > MAX_SCORE) {
    return json({ error: 'invalid score' }, 400)
  }
  if (!Number.isFinite(duration) || duration < 0 || duration > MAX_DURATION) {
    return json({ error: 'invalid duration' }, 400)
  }
  if (!MODE_RE.test(mode)) {
    return json({ error: 'invalid mode' }, 400)
  }

  const inserted = await env.DB.prepare(
    `INSERT INTO highscores (name, score, duration, mode)
     VALUES (?, ?, ?, ?)
     RETURNING id, name, score, duration, mode, created_at AS date`,
  )
    .bind(name, score, duration, mode)
    .first<ScoreRow>()

  return json({ entry: inserted }, 201)
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/api/highscores') {
      if (request.method === 'GET') return handleGet(request, env)
      if (request.method === 'POST') return handlePost(request, env)
      return json({ error: 'method not allowed' }, 405)
    }
    return env.ASSETS.fetch(request)
  },
} satisfies ExportedHandler<Env>
