# ADR-0009: Do not require a decline reason

## Status

Accepted

## Context

Administrators need a quick moderation flow for score submissions.

## Decision

Record a declined status without requiring or exposing an admin reason or comment.

## Consequences

- The moderation interface has a simple approve/decline action pair.
- The system retains the decision status and timestamps but no explanation for a declined score.
