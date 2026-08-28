# Leaderboard Domain Context

## Glossary

- **User**: An authenticated player who can submit scores only for themself.
- **Game username**: The player's public leaderboard name. When the player has a linked GitHub profile, this name links to it; otherwise the UI explains on hover that no GitHub profile is available.
- **Admin**: A manually seeded user with permission to review submitted scores.
- **Game**: A distinct activity with its own independent leaderboard.
- **Score submission**: A player's claimed score for one game. It begins in the `pending` state.
- **Approved score**: A score submission accepted by an admin, preserving the submitted value. Only approved scores are eligible to affect a leaderboard.
- **Declined score**: A score submission rejected by an admin. It never affects a leaderboard.
- **Review queue**: The admin-facing list of pending score submissions. Its live badge shows the count of items awaiting review.
- **Score history**: The recorded submissions and their moderation statuses. Players may view only their own; admins may view all users' histories.
- **Best score**: A user's highest approved score for a particular game. This is the value used to rank that user on that game's leaderboard.
- **Leaderboard**: The ordered rankings for one game, derived from each user's best score for that game.
- **Competition rank**: The displayed rank rule for tied best scores: equal scores share a position and subsequent positions skip by the number tied (for example, `1, 1, 3`).
- **Period report**: A ranking for one game and time range, based on each user's highest approved score submitted within that range.

## Core rules

- Leaderboards are per game; there is no cross-game global ranking in the initial scope.
- Period reports are also per game; no cross-game aggregate report exists.
- Period reports allow only these ranges: today, this week, this month, this year, and all time.
- UTC defines the boundaries for every preset reporting period.
- An authenticated user may submit scores only as themself.
- Administrators are seeded manually, not created through an admin-registration flow.
- Games are seeded manually; game management is outside the initial admin interface.
- Score moderation is required before any ranking change.
- Scores are non-negative whole numbers; decimal scores are invalid.
- A player may have at most one pending score submission for a given game.
- A player may submit a score for the same game at most once every five minutes.
- Approved scores lower than a player's existing best remain in score history but do not change that player's leaderboard score or rank.
- Period reports include only approved scores and use the score submission timestamp to determine whether a score is in range.
- Admins receive pending-submission awareness through the in-app review queue and live badge, not email.
- The review queue is ordered oldest pending submission first.
- Public leaderboard viewers receive live updates through SSE; the admin review-queue SSE stream is restricted to authenticated admins.
- PostgreSQL is the durable system of record for users, games, score submissions, and moderation history.
- Redis sorted sets are a derived, real-time index for per-game leaderboard queries.
- If Redis is unavailable during approval, preserve the PostgreSQL approval and retry synchronizing the affected leaderboard; temporary stale rankings are acceptable.
- Ties use competition ranking, not an arbitrary unique ordering.
- Leaderboards are publicly paginated. An authenticated player's initial view is positioned around their own rank for that game.
- Players can access only their own score history; admins can access all score and moderation history.
- Game leaderboards and period reports are publicly readable; submitting scores, viewing personal history, and admin functions require authentication.
- Users can authenticate with either an email-and-password account or GitHub OAuth.
- Local authentication includes registration and login only in the initial release; email verification and password reset are out of scope.
- GitHub profile links are optional: players without one remain visible under their game username with an explanatory hover state.
- Game usernames are globally unique across the system.
- Players may change their game username only to another globally unused value; scores and history remain attached to the user account.
- Score history and leaderboards always render a player's current game username, including for past submissions.
- Email-and-password users can connect GitHub later through profile settings.
- Declining a score records its status but requires no reason or comment.
