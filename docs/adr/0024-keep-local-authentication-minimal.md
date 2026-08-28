# ADR-0024: Keep local authentication minimal

## Status

Accepted

## Context

The initial project needs functional email-and-password registration and login without expanding into account-recovery infrastructure.

## Decision

Implement local registration and login only. Do not implement email verification or password-reset emails in the first release.

## Consequences

- Email delivery infrastructure is not required.
- Recovery and verification flows remain explicit future work.
