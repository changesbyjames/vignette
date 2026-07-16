# ADR 0001: React reconciles into memory

- **Status**: Accepted

## Context

React host methods are synchronous and some run during render work that can be abandoned. OBS
mutations are asynchronous, partially successful remote requests with no transactional rollback.

## Decision

The custom mutation renderer operates only on local host nodes. After a completed commit, the root
schedules validation and compilation, then publishes an immutable revision to targets. No host
method calls or awaits a target.

## Consequences

React can continue rendering while OBS is disconnected or converging. Commit and target settlement
are separate public concepts. The local graph and compiler must be reliable because they are the
source of desired truth.

## Rejected alternatives

- Await OBS calls inside `commitUpdate`: React does not coordinate with that promise.
- One React root per target: effects and state could diverge between preview and OBS.
- Persist remote handles in React fibers: internal handles are opaque and unstable.
