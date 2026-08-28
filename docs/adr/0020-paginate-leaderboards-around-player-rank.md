# ADR-0020: Paginate leaderboards around an authenticated player's rank

## Status

Accepted

## Context

Game leaderboards can contain many players, and a player needs to find their own standing without manually paging from the top.

## Decision

Provide paginated public leaderboards. When an authenticated player opens a game's leaderboard, start the view on the page containing that player's rank; unauthenticated visitors start at the first page.

## Consequences

- The API must support rank-aware pagination in addition to ordinary page navigation.
- UI page boundaries must account for competition ranks and ties.
