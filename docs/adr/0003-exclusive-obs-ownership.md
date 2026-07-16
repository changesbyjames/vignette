# ADR 0003: OBS resources use exclusive managed ownership

- **Status**: Accepted

## Context

OBS can contain unrelated user resources and allows manual edits while a client is connected.
Scene-item IDs must be recovered after restart or collection changes.

## Decision

The target manages only deterministic names under one project namespace. It is authoritative for
those resources and overwrites manual changes on convergence. Unmanaged resources are never
reordered or deleted. Inputs are created disabled in a project registry scene before real placements
are configured and enabled.

## Consequences

Recovery can rebuild scene and source identity from deterministic names. Manual changes to managed
content are temporary. Ambiguous identity blocks destructive operations. V1 disallows repeated
placement of one source in one scene.

## Rejected alternatives

- Cooperative merge with manual edits: conflict semantics are underspecified.
- Own the entire OBS collection: it risks unrelated user content.
- Use labels as identity: renaming would recreate resources.
- Treat React keys as identity: keys are scoped reconciliation hints.
