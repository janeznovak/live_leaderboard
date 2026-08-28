# ADR-0007: Use competition ranking for score ties

## Status

Accepted

## Context

Multiple players may have the same best approved score in a game's leaderboard.

## Decision

Give tied players the same displayed position and skip subsequent positions accordingly: `1, 1, 3`.

## Consequences

- The application must derive displayed ranks from score groups rather than rely only on Redis's arbitrary ordering among equal members.
- The ordering of players within a tied group may still be deterministic for presentation, but it does not change their displayed rank.
