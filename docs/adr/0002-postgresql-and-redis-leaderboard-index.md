# ADR-0002: Store records in PostgreSQL and ranks in Redis

## Status

Accepted

## Context

The application requires durable user, score-history, and moderation records, plus low-latency leaderboard and rank queries.

## Decision

Store authoritative data in PostgreSQL. Maintain one Redis sorted set per game as a derived leaderboard index, containing each user's highest approved score for that game.

## Consequences

- Redis does not replace the audit trail or moderation workflow.
- Approval must update PostgreSQL and then synchronize the affected game's Redis index reliably.
- Rebuilding Redis from approved PostgreSQL scores remains possible after a cache loss.
