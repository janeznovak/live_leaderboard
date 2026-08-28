# ADR-0016: Allow game username changes

## Status

Accepted

## Context

Players use a public, globally unique game username, but may want to update it over time.

## Decision

Allow a player to change their game username when the new username is globally available.

## Consequences

- The update endpoint must check and enforce uniqueness.
- Historical score records reference the stable user account, not a copied username.
