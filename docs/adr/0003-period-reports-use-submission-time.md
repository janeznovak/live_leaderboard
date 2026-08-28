# ADR-0003: Period reports use score submission time

## Status

Accepted

## Context

Top-player reports must support a specified period while score approval may occur after submission.

## Decision

For a report's date range, consider approved score submissions whose submission timestamp is within that range. Rank each player by their highest qualifying score per game.

## Consequences

- Pending and declined submissions do not appear in reports.
- An approved score may appear in a historical report even if its approval happened after that report period ended.
