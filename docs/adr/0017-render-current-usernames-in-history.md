# ADR-0017: Render current usernames in historical views

## Status

Accepted

## Context

Game usernames are mutable but score ownership is tied to a stable user account.

## Decision

Render the account's current game username in leaderboards and score-history views, including for old submissions. Do not snapshot usernames per score.

## Consequences

- Renaming updates the displayed name for every historical record.
- Score rows need only retain their stable user reference.
