# ADR-0008: Scope score history by user role

## Status

Accepted

## Context

The application must retain score history while protecting player data and enabling administration.

## Decision

Let players read only their own score submissions and statuses. Let administrators read all score submissions and their moderation history.

## Consequences

- Server authorization must scope player history queries to the authenticated user.
- The admin interface requires searchable or browsable cross-user history.
