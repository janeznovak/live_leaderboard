# ADR-0023: Use UTC for report-period boundaries

## Status

Accepted

## Context

Preset reports require consistent definitions of calendar periods for all users.

## Decision

Calculate today, this week, this month, and this year using UTC boundaries.

## Consequences

- The API must normalize timestamp comparisons to UTC.
- The UI should label report periods as UTC where clarification is useful.
