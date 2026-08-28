# ADR-0001: Use Nuxt for the full stack

## Status

Accepted

## Context

The project needs a frontend with distinct player and admin interfaces as well as an authenticated backend API.

## Decision

Use Nuxt for the frontend and its server API. Implement authorization on the server using a shared user model with role-based access; administrator accounts are seeded manually.

## Consequences

- Player and admin interfaces can share one application and authentication model.
- Server endpoints must enforce that players submit scores only for their own accounts and that only admins moderate scores.
