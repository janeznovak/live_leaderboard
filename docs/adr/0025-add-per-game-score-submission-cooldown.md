# ADR-0025: Add a five-minute score-submission cooldown

## Status

Accepted

## Context

One pending submission per game limits concurrent review work but does not limit rapid repeated submissions after a decision.

## Decision

Allow a player to submit a score for the same game no more than once every five minutes.

## Consequences

- The server must enforce the cooldown using authoritative timestamps.
- The UI should show when the next submission becomes available after a rate-limit response.
