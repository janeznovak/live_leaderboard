# ADR-0021: Scope period reports to a single game

## Status

Accepted

## Context

Each game has an independent leaderboard, and raw scores from different games are not comparable.

## Decision

Generate every period report for exactly one game. Do not provide a cross-game aggregate report.

## Consequences

- Report requests must identify a game and date range.
- No score-normalization scheme is required.
