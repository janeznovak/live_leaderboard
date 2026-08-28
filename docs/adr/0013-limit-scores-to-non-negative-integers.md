# ADR-0013: Accept only non-negative whole-number scores

## Status

Accepted

## Context

Leaderboard ranking and score submission need a consistent numeric representation.

## Decision

Accept only non-negative integer scores.

## Consequences

- Validate scores on the server before persisting a submission.
- Database and Redis representations do not need decimal-score handling.
