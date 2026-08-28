# ADR-0004: Notify admins through the in-app review queue

## Status

Accepted

## Context

Administrators must be aware when players submit scores that require approval.

## Decision

Provide an admin review queue with a live pending-count badge. Do not send email notifications in the initial scope.

## Consequences

- The application needs a way to refresh the pending count promptly for active admin sessions.
- Notification delivery, preferences, and email infrastructure are out of scope.
