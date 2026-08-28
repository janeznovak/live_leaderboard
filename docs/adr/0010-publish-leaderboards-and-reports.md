# ADR-0010: Make rankings and reports public

## Status

Accepted

## Context

The leaderboard is a shared view of competition, while score submissions and history contain account-specific actions.

## Decision

Allow unauthenticated visitors to read game leaderboards and period reports. Require authentication for all player and administrator actions.

## Consequences

- Public read endpoints must expose only the fields needed for rankings.
- Authorization remains mandatory for score submission, personal history, and moderation endpoints.
