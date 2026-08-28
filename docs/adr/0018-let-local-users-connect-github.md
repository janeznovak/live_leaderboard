# ADR-0018: Let local-account users connect GitHub

## Status

Accepted

## Context

Email-and-password users may want the GitHub profile link shown for their leaderboard username after registration.

## Decision

Provide profile settings that let an authenticated local-account user connect GitHub OAuth to their existing account.

## Consequences

- The identity model must support linking a GitHub credential to an existing user.
- A linked GitHub account must not be attached to more than one user.
