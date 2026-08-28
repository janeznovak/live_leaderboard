# ADR-0011: Support local and OAuth authentication

## Status

Accepted

## Context

Players need to register and log in, with support for both conventional credentials and third-party sign-in.

## Decision

Support email-and-password authentication alongside GitHub OAuth.

## Consequences

- The user identity model must support multiple credentials linked to one user.
- Account-linking and GitHub OAuth configuration are implementation concerns.
