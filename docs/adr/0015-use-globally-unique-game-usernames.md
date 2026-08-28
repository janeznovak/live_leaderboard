# ADR-0015: Use globally unique game usernames

## Status

Accepted

## Context

Public leaderboards need a stable, unambiguous identifier for each player.

## Decision

Require game usernames to be globally unique.

## Consequences

- Registration must check username availability.
- A unique database constraint must enforce the rule.
