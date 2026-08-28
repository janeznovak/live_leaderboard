# ADR-0027: Retry Redis synchronization after approval

## Status

Accepted

## Context

PostgreSQL is authoritative for approval decisions, while Redis is a derived leaderboard index that can be temporarily unavailable.

## Decision

Commit an admin's approval in PostgreSQL even when Redis cannot be updated immediately. Reliably retry synchronizing the affected game's Redis sorted set from the durable record.

## Consequences

- An approved score can briefly be absent from the live leaderboard.
- Redis synchronization needs a durable retry mechanism and an idempotent update operation.
- A full Redis rebuild from approved PostgreSQL scores remains a recovery option.
