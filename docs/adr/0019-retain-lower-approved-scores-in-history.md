# ADR-0019: Retain approved lower scores without changing ranks

## Status

Accepted

## Context

Every approved score is useful for player history, but rankings are defined by each player's highest approved score per game.

## Decision

Persist and show every approved score in history. Update a game's Redis leaderboard index only when an approved score exceeds the player's current best for that game.

## Consequences

- History can contain approved scores that are not leaderboard-best scores.
- The approval workflow must compare a score to the user's existing best before updating the derived index.
