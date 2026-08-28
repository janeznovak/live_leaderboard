# ADR-0012: Make GitHub profile links optional

## Status

Accepted

## Context

Leaderboards use game usernames, and GitHub OAuth users can have a profile link. Email-and-password users may not have a GitHub profile.

## Decision

Display the game username for every player. Link it to GitHub only when the player has a linked profile; otherwise provide hover copy that the player has no GitHub profile.

## Consequences

- A GitHub profile is not required to register or rank.
- The leaderboard needs distinct linked and unlinked username presentation states.
