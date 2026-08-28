# ADR-0026: Review pending scores oldest first

## Status

Accepted

## Context

Admins need a predictable ordering for a shared score-moderation queue.

## Decision

Order pending score submissions by ascending submission time.

## Consequences

- The oldest waiting player is presented first.
- Ties need a stable secondary order, such as the submission ID.
