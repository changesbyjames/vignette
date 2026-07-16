# ADR 0002: Yoga is the canonical layout engine

- **Status**: Accepted

## Context

Browser flexbox, Yoga defaults, intrinsic media measurement, and OBS transforms do not produce
reliably identical geometry when each target lays itself out.

## Decision

Core exposes a narrow serializable style language. Yoga computes absolute broadcast-space rectangles
once. DOM renders those rectangles with absolute positioning and OBS translates them into scene-item
transforms. Content fitting and crop are also calculated in core.

## Consequences

The common layout API is intentionally smaller than CSS. Dimensions or aspect ratios are required
for media in the first release. Yoga configuration, rounding, and content-fit math become versioned
compatibility behavior.

## Rejected alternatives

- Native CSS layout in the preview: it creates a second layout authority.
- Mapping virtual boxes to OBS groups: groups are not a general flex layout model.
- Async intrinsic sizing in v1: target-specific metadata would cause reflow drift.
