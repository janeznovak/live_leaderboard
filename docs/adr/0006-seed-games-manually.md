# ADR-0006: Seed games manually

## Status

Accepted

## Context

The initial application requires game-specific leaderboards but does not require game administration.

## Decision

Seed games manually. The admin UI manages score moderation only.

## Consequences

- A deployment or seed workflow must create the initial game records.
- Creating, editing, and deleting games is out of scope for the initial UI.
