# Real-Time Leaderboard

A full-stack leaderboard application where players submit scores and administrators approve or decline them before they affect the rankings.

The application provides:

- separate leaderboards for each game;
- local email/password and GitHub OAuth authentication;
- player profiles and globally unique game usernames;
- score submission history and moderation;
- competition ranking for ties (`1, 1, 3`);
- live leaderboard and admin queue updates using Server-Sent Events (SSE);
- PostgreSQL as the durable source of truth; and
- Redis sorted sets as the real-time leaderboard index.

## Technology

- Nuxt 3 and Vue 3 for the web application and server API
- PostgreSQL 17 for users, sessions, games, and score history
- Redis 7 for fast leaderboard reads
- Playwright for end-to-end tests
- Docker Compose for an isolated development/E2E stack

The frontend uses Nuxt's `useFetch` and `$fetch` utilities. It does not currently use Axios or TanStack Query.

## Quick start with Docker

The easiest way to run the application is with Docker and Docker Compose.

Requirements:

- Docker with the Compose plugin

Build and start the application and its dependencies:

```bash
docker compose -f docker-compose.e2e.yml up --build app
```

Open <http://localhost:3000>.

The Compose environment includes the GitHub OAuth stub used by the automated test suite and the following seeded administrator account:

```text
Email: admin@example.test
Password: e2e-admin-password
```

These credentials and the OAuth stub are only for local development and automated tests. Do not use this Compose configuration as a public production deployment.

Stop the stack with `Ctrl+C`. To also remove its containers, network, and stored test data, run:

```bash
docker compose -f docker-compose.e2e.yml down --volumes --remove-orphans
```

To use another host port:

```bash
APP_PORT=3020 docker compose -f docker-compose.e2e.yml up --build app
```

The application will then be available at <http://localhost:3020>.

## Native development

Requirements:

- Node.js 25, matching the Docker image
- PostgreSQL
- Redis

Install dependencies:

```bash
npm ci
```

Configure the application in a local `.env` file. The file is ignored by Git.

```dotenv
DATABASE_URL=postgres://leaderboard:replace-me@127.0.0.1:5432/leaderboard
REDIS_URL=redis://127.0.0.1:6379
SEED_ADMIN_PASSWORD=replace-with-a-strong-local-password

NUXT_DATABASE_URL=postgres://leaderboard:replace-me@127.0.0.1:5432/leaderboard
NUXT_REDIS_URL=redis://127.0.0.1:6379
```

`DATABASE_URL` and `REDIS_URL` are used by the database scripts. Their `NUXT_` equivalents configure the running Nuxt server.

Nuxt reads `.env` when it starts. Before running the standalone migration and seed scripts, load the same values into your current shell:

```bash
set -a
. ./.env
set +a
```

Create the schema and seed the initial games, sample scores, and administrator:

```bash
npm run db:migrate
npm run db:seed
```

Start the development server:

```bash
npm run dev
```

Open <http://localhost:3000>.

### Optional GitHub OAuth

Local accounts work without GitHub configuration. To enable GitHub sign-in and account linking, add a GitHub OAuth application's values to `.env`:

```dotenv
NUXT_GITHUB_CLIENT_ID=your-client-id
NUXT_GITHUB_CLIENT_SECRET=your-client-secret
NUXT_GITHUB_REDIRECT_URL=http://localhost:3000/api/auth/github/callback
```

Configure the same callback URL in the GitHub OAuth application. Never commit the client secret.

## Available commands

```bash
npm run dev          # Start the Nuxt development server
npm run build        # Create a production build
npm run start        # Start an existing production build
npm run typecheck    # Run Nuxt/TypeScript checks
npm run db:migrate   # Apply the PostgreSQL schema
npm run db:seed      # Seed games, sample scores, and an administrator
npm run test:e2e     # Run Playwright tests against a configured application
```

Run the complete isolated end-to-end environment with:

```bash
docker compose -f docker-compose.e2e.yml up --build --abort-on-container-exit --exit-code-from e2e
```

Clean it up afterward:

```bash
docker compose -f docker-compose.e2e.yml down --volumes --remove-orphans
```

## Production notes

Build and run the application with:

```bash
npm run build
npm run start
```

For a real deployment:

- supply production PostgreSQL and Redis URLs through secrets or environment variables;
- provision the administrator securely instead of deploying the development seed data;
- configure a real GitHub OAuth application if OAuth is enabled;
- terminate HTTPS at a trusted reverse proxy or platform load balancer;
- do not expose PostgreSQL or Redis publicly; and
- run the provided container as its non-root `node` user.

The production image listens on container port `3000`. A reverse proxy can expose it on ports `80` and `443` without granting the Node process root privileges.

## Domain documentation

The core business rules are documented in [CONTEXT.md](CONTEXT.md), with architectural decisions under [docs/adr](docs/adr).
