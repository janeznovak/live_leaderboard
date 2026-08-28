# ADR-0014: Allow one pending score per player and game

## Status

Accepted

## Context

Unbounded pending submissions from one player could overwhelm the admin review queue and make moderation ambiguous.

## Decision

Allow each player only one pending score submission for each game. They may submit again after that submission is approved or declined.

## Consequences

- The server must reject a new submission when a pending submission exists for the same player and game.
- Database constraints or transactional checks must protect this rule under concurrent requests.
