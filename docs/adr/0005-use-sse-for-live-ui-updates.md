# ADR-0005: Use Server-Sent Events for live UI updates

## Status

Accepted

## Context

The player leaderboard and the administrator review queue must update promptly after server-side changes.

## Decision

Expose Server-Sent Events endpoints for one-way server-to-browser updates. The public leaderboard stream is available to all viewers; the review-queue stream requires an authenticated admin. Browser clients use normal HTTP requests for commands and SSE for update notifications.

## Consequences

- Clients refresh only the changed leaderboard or pending queue after an event.
- Public SSE endpoints must emit only public leaderboard data.
- WebSocket command handling is not required in the initial scope.
