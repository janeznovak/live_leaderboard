import type { PoolClient } from 'pg'
import { createSession, currentUser } from '../../../utils/auth'
import { database } from '../../../utils/database'
import { clearGithubOAuthNonce, consumeGithubOAuthState, githubIdentityForCode, githubOAuthNonce, initialGameUsername, type GithubIdentity } from '../../../utils/github'

type LinkedUser = { id: string }

function callbackRedirect(purpose: 'sign-in' | 'link' | undefined, result: string) {
  return purpose === 'link' ? `/profile?github=${result}` : `/login?github=${result}`
}

async function linkGithubIdentity(client: PoolClient, userId: string, identity: GithubIdentity) {
  const existing = await client.query<LinkedUser>('SELECT user_id AS id FROM github_identities WHERE github_id = $1', [identity.githubId])
  if (existing.rows[0]) return existing.rows[0].id === userId ? 'already-connected' : 'identity-in-use'
  const linked = await client.query<LinkedUser>('SELECT user_id AS id FROM github_identities WHERE user_id = $1', [userId])
  if (linked.rows[0]) return 'already-connected'
  await client.query(
    `INSERT INTO github_identities (github_id, user_id, github_login, profile_url)
     VALUES ($1, $2, $3, $4)`,
    [identity.githubId, userId, identity.login, identity.profileUrl],
  )
  return 'connected'
}

async function githubSignIn(client: PoolClient, identity: GithubIdentity) {
  const existing = await client.query<LinkedUser>('SELECT user_id AS id FROM github_identities WHERE github_id = $1', [identity.githubId])
  if (existing.rows[0]) return existing.rows[0].id
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const created = await client.query<LinkedUser>(
      `INSERT INTO users (email, game_username)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [identity.email, initialGameUsername(identity.login, identity.githubId, attempt)],
    )
    const userId = created.rows[0]?.id
    if (userId) {
      await client.query(
        `INSERT INTO github_identities (github_id, user_id, github_login, profile_url)
         VALUES ($1, $2, $3, $4)`,
        [identity.githubId, userId, identity.login, identity.profileUrl],
      )
      return userId
    }
    const identityOwner = await client.query<LinkedUser>('SELECT user_id AS id FROM github_identities WHERE github_id = $1', [identity.githubId])
    if (identityOwner.rows[0]) return identityOwner.rows[0].id
    const emailOwner = await client.query<LinkedUser>('SELECT id FROM users WHERE lower(email) = lower($1)', [identity.email])
    if (emailOwner.rows[0]) {
      throw createError({ statusCode: 409, statusMessage: 'This email already has a local account. Connect GitHub from that profile instead.' })
    }
  }
  throw createError({ statusCode: 409, statusMessage: 'Unable to choose a unique game username for this GitHub account.' })
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const stateValue = typeof query.state === 'string' ? query.state : undefined
  const code = typeof query.code === 'string' ? query.code : undefined
  const nonce = githubOAuthNonce(event)
  clearGithubOAuthNonce(event)
  const state = await consumeGithubOAuthState(stateValue, nonce)
  if (!state) return sendRedirect(event, callbackRedirect(undefined, 'invalid-state'))
  try {
    if (state.purpose === 'link' && (await currentUser(event))?.id !== state.userId) {
      return sendRedirect(event, callbackRedirect('link', 'failed'))
    }
    const identity = await githubIdentityForCode(event, code)
    const client = await database().connect()
    try {
      await client.query('BEGIN')
      if (state.purpose === 'link') {
        const outcome = await linkGithubIdentity(client, state.userId!, identity)
        await client.query('COMMIT')
        return sendRedirect(event, callbackRedirect('link', outcome))
      }
      const userId = await githubSignIn(client, identity)
      await client.query('COMMIT')
      await createSession(event, userId)
      return sendRedirect(event, '/profile')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  } catch {
    return sendRedirect(event, callbackRedirect(state.purpose, 'failed'))
  }
})
