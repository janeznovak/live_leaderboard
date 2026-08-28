# ADR-0022: Offer only preset report periods

## Status

Accepted

## Context

Period reports need an understandable, bounded query interface for the first release.

## Decision

Offer reports for today, this week, this month, this year, and all time. Do not support arbitrary user-selected date ranges.

## Consequences

- The frontend presents a fixed period selector.
- The API derives each date boundary instead of accepting arbitrary start and end timestamps.
