import pg from 'pg'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required')
const client = new pg.Client({ connectionString: databaseUrl })
await client.connect()
await client.query(`
  CREATE EXTENSION IF NOT EXISTS "pgcrypto";
  CREATE TABLE IF NOT EXISTS users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email text UNIQUE NOT NULL,
    game_username text UNIQUE NOT NULL,
    password_hash text,
    role text NOT NULL DEFAULT 'player' CHECK (role IN ('player', 'admin')),
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS games (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text UNIQUE NOT NULL,
    slug text UNIQUE NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS score_submissions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    game_id uuid NOT NULL REFERENCES games(id),
    user_id uuid NOT NULL REFERENCES users(id),
    score bigint NOT NULL CHECK (score >= 0),
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined')),
    submitted_at timestamptz NOT NULL DEFAULT now(),
    moderated_at timestamptz,
    moderated_by uuid REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS user_sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash text UNIQUE NOT NULL,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS github_identities (
    github_id text PRIMARY KEY,
    user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    github_login text NOT NULL,
    profile_url text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS oauth_states (
    state_hash text PRIMARY KEY,
    browser_nonce_hash text NOT NULL,
    purpose text NOT NULL CHECK (purpose IN ('sign-in', 'link')),
    user_id uuid REFERENCES users(id) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((purpose = 'link') = (user_id IS NOT NULL))
  );
`)
await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash text')
await client.query('ALTER TABLE score_submissions ALTER COLUMN score TYPE bigint')
await client.query('CREATE UNIQUE INDEX IF NOT EXISTS users_game_username_lower_unique ON users (lower(game_username))')
await client.query('CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_unique ON users (lower(email))')
await client.query('CREATE INDEX IF NOT EXISTS user_sessions_token_hash_index ON user_sessions (token_hash)')
await client.query('CREATE INDEX IF NOT EXISTS oauth_states_expires_at_index ON oauth_states (expires_at)')
await client.query('ALTER TABLE oauth_states ADD COLUMN IF NOT EXISTS browser_nonce_hash text')
await client.query('DELETE FROM oauth_states WHERE browser_nonce_hash IS NULL')
await client.query('ALTER TABLE oauth_states ALTER COLUMN browser_nonce_hash SET NOT NULL')
await client.query("CREATE UNIQUE INDEX IF NOT EXISTS score_submissions_one_pending_per_user_game ON score_submissions (game_id, user_id) WHERE status = 'pending'")
await client.query('CREATE INDEX IF NOT EXISTS score_submissions_user_submitted_at_index ON score_submissions (user_id, submitted_at DESC)')
await client.query('CREATE INDEX IF NOT EXISTS score_submissions_game_user_submitted_at_index ON score_submissions (game_id, user_id, submitted_at DESC)')
await client.query("CREATE INDEX IF NOT EXISTS score_submissions_approved_game_submitted_at_index ON score_submissions (game_id, submitted_at, user_id) INCLUDE (score, moderated_at) WHERE status = 'approved'")
await client.query("CREATE INDEX IF NOT EXISTS score_submissions_pending_review_queue_index ON score_submissions (submitted_at ASC, id ASC) WHERE status = 'pending'")
await client.query('CREATE INDEX IF NOT EXISTS score_submissions_moderated_by_index ON score_submissions (moderated_by, moderated_at DESC)')
await client.end()
