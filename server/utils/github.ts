import { createHash, randomBytes } from 'node:crypto'
import type { H3Event } from 'h3'
import { normalizeEmail } from './auth'
import { database } from './database'

type GithubApiUser = { id?: number | string; login?: string }
type GithubEmail = { email?: string; primary?: boolean; verified?: boolean }

export type GithubIdentity = { githubId: string; login: string; profileUrl: string; email: string }
export type GithubOAuthState = { purpose: 'sign-in' | 'link'; userId?: string }

const oauthNonceCookie = 'leaderboard_github_oauth_nonce'
const oauthStateLifetimeSeconds = 60 * 10

function hashState(state: string) {
  return createHash('sha256').update(state).digest('base64url')
}

function configuredGithub(event: H3Event) {
  const config = useRuntimeConfig(event)
  if (!config.githubClientId || !config.githubClientSecret) {
    throw createError({ statusCode: 503, statusMessage: 'GitHub sign-in is not configured.' })
  }
  return config
}

function githubRedirectUrl(event: H3Event) {
  const config = useRuntimeConfig(event)
  return config.githubRedirectUrl || `${getRequestURL(event).origin}/api/auth/github/callback`
}

export async function createGithubAuthorizationUrl(event: H3Event, purpose: 'sign-in' | 'link', userId?: string) {
  const config = configuredGithub(event)
  const state = randomBytes(32).toString('base64url')
  const browserNonce = randomBytes(32).toString('base64url')
  await database().query(
    `INSERT INTO oauth_states (state_hash, browser_nonce_hash, purpose, user_id, expires_at)
     VALUES ($1, $2, $3, $4, now() + interval '10 minutes')`,
    [hashState(state), hashState(browserNonce), purpose, userId ?? null],
  )
  setCookie(event, oauthNonceCookie, browserNonce, {
    httpOnly: true,
    sameSite: 'lax',
    secure: getRequestProtocol(event, { xForwardedProto: true }) === 'https',
    path: '/api/auth/github/callback',
    maxAge: oauthStateLifetimeSeconds,
  })
  const url = new URL('/login/oauth/authorize', config.githubOauthBaseUrl)
  url.searchParams.set('client_id', config.githubClientId)
  url.searchParams.set('redirect_uri', githubRedirectUrl(event))
  url.searchParams.set('scope', 'read:user user:email')
  url.searchParams.set('state', state)
  return url.toString()
}

export function githubOAuthNonce(event: H3Event) {
  return getCookie(event, oauthNonceCookie)
}

export function clearGithubOAuthNonce(event: H3Event) {
  deleteCookie(event, oauthNonceCookie, {
    httpOnly: true,
    sameSite: 'lax',
    secure: getRequestProtocol(event, { xForwardedProto: true }) === 'https',
    path: '/api/auth/github/callback',
  })
}

export async function consumeGithubOAuthState(state: string | undefined, browserNonce: string | undefined): Promise<GithubOAuthState | undefined> {
  if (!state || state.length > 256 || !browserNonce || browserNonce.length > 256) return undefined
  const result = await database().query<{ purpose: 'sign-in' | 'link'; user_id: string | null }>(
    `DELETE FROM oauth_states
     WHERE state_hash = $1 AND browser_nonce_hash = $2 AND expires_at > now()
     RETURNING purpose, user_id`,
    [hashState(state), hashState(browserNonce)],
  )
  const row = result.rows[0]
  if (!row) return undefined
  return { purpose: row.purpose, ...(row.user_id ? { userId: row.user_id } : {}) }
}

export async function githubIdentityForCode(event: H3Event, code: string | undefined): Promise<GithubIdentity> {
  if (!code || code.length > 512) throw createError({ statusCode: 400, statusMessage: 'GitHub did not return an authorization code.' })
  const config = configuredGithub(event)
  const tokenResponse = await fetch(new URL('/login/oauth/access_token', config.githubOauthBaseUrl), {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.githubClientId,
      client_secret: config.githubClientSecret,
      code,
      redirect_uri: githubRedirectUrl(event),
    }),
  })
  const token = await tokenResponse.json().catch(() => undefined) as { access_token?: string } | undefined
  if (!tokenResponse.ok || !token?.access_token) throw createError({ statusCode: 502, statusMessage: 'GitHub sign-in could not be completed.' })

  const headers = { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token.access_token}` }
  const userResponse = await fetch(new URL('/user', config.githubApiBaseUrl), { headers })
  const user = await userResponse.json().catch(() => undefined) as GithubApiUser | undefined
  const githubId = user?.id === undefined ? undefined : String(user.id)
  const login = typeof user?.login === 'string' && /^[A-Za-z0-9-]{1,39}$/.test(user.login) ? user.login : undefined
  if (!userResponse.ok || !githubId || !login) throw createError({ statusCode: 502, statusMessage: 'GitHub returned an invalid profile.' })
  const emailsResponse = await fetch(new URL('/user/emails', config.githubApiBaseUrl), { headers })
  const emails = await emailsResponse.json().catch(() => []) as GithubEmail[]
  const email = emailsResponse.ok
    ? normalizeEmail(emails.find((candidate) => candidate.primary && candidate.verified)?.email)
    : undefined
  if (!email) throw createError({ statusCode: 422, statusMessage: 'GitHub must provide a verified primary email address.' })
  return { githubId, login, email, profileUrl: `https://github.com/${login}` }
}

export function initialGameUsername(login: string, githubId: string, attempt = 0) {
  const suffix = `-${githubId.slice(-6)}${attempt > 0 ? `-${attempt + 1}` : ''}`
  const stem = login.length >= 3 ? login : `${login}${githubId}`
  return `${stem.slice(0, 32 - suffix.length)}${suffix}`
}
