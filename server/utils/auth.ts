import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import type { H3Event } from 'h3'
import { database } from './database'

const scrypt = promisify(scryptCallback)
const sessionCookie = 'leaderboard_session'
const sessionLifetimeSeconds = 60 * 60 * 24 * 30

export type AuthenticatedUser = {
  id: string
  email: string
  gameUsername: string
  role: 'player' | 'admin'
  githubLogin?: string
  githubProfileUrl?: string
}

export function normalizeEmail(value: unknown) {
  if (typeof value !== 'string') return undefined
  const email = value.trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254 ? email : undefined
}

export function normalizeGameUsername(value: unknown) {
  if (typeof value !== 'string') return undefined
  const username = value.trim()
  return /^[A-Za-z0-9_-]{3,32}$/.test(username) ? username : undefined
}

export function validatePassword(value: unknown) {
  return typeof value === 'string' && value.length >= 8 && value.length <= 256 ? value : undefined
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('base64url')
  const derivedKey = await scrypt(password, salt, 64) as Buffer
  return `scrypt$${salt}$${derivedKey.toString('base64url')}`
}

export async function verifyPassword(password: string, storedHash: string) {
  const [algorithm, salt, encodedHash] = storedHash.split('$')
  if (algorithm !== 'scrypt' || !salt || !encodedHash) return false
  const expected = Buffer.from(encodedHash, 'base64url')
  const actual = await scrypt(password, salt, expected.length) as Buffer
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

function hashSessionToken(token: string) {
  return createHash('sha256').update(token).digest('base64url')
}

function cookieIsSecure(event: H3Event) {
  return getRequestProtocol(event, { xForwardedProto: true }) === 'https'
}

export async function createSession(event: H3Event, userId: string) {
  const token = randomBytes(32).toString('base64url')
  await database().query(
    `INSERT INTO user_sessions (user_id, token_hash, expires_at)
     VALUES ($1, $2, now() + ($3 * interval '1 second'))`,
    [userId, hashSessionToken(token), sessionLifetimeSeconds],
  )
  setCookie(event, sessionCookie, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: cookieIsSecure(event),
    path: '/',
    maxAge: sessionLifetimeSeconds,
  })
}

export async function currentUser(event: H3Event): Promise<AuthenticatedUser | undefined> {
  const token = getCookie(event, sessionCookie)
  if (!token) return undefined
  const result = await database().query<{
    id: string
    email: string
    game_username: string
    role: 'player' | 'admin'
    github_login: string | null
    github_profile_url: string | null
  }>(
    `SELECT users.id, users.email, users.game_username, users.role,
            github_identities.github_login, github_identities.profile_url AS github_profile_url
     FROM user_sessions
     JOIN users ON users.id = user_sessions.user_id
     LEFT JOIN github_identities ON github_identities.user_id = users.id
     WHERE user_sessions.token_hash = $1 AND user_sessions.expires_at > now()`,
    [hashSessionToken(token)],
  )
  const user = result.rows[0]
  if (!user) return undefined
  return {
    id: user.id,
    email: user.email,
    gameUsername: user.game_username,
    role: user.role,
    ...(user.github_login && user.github_profile_url
      ? { githubLogin: user.github_login, githubProfileUrl: user.github_profile_url }
      : {}),
  }
}

export async function requireUser(event: H3Event) {
  const user = await currentUser(event)
  if (!user) throw createError({ statusCode: 401, statusMessage: 'Authentication required' })
  return user
}

export async function requireAdmin(event: H3Event) {
  const user = await requireUser(event)
  if (user.role !== 'admin') throw createError({ statusCode: 403, statusMessage: 'Administrator access required' })
  return user
}

export async function destroySession(event: H3Event) {
  const token = getCookie(event, sessionCookie)
  if (token) await database().query('DELETE FROM user_sessions WHERE token_hash = $1', [hashSessionToken(token)])
  deleteCookie(event, sessionCookie, { httpOnly: true, sameSite: 'lax', secure: cookieIsSecure(event), path: '/' })
}
