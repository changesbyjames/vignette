# Publishing to JSR

The eight public packages use TypeScript source exports from their package-level `deno.json` files.
The root `deno.json` declares the monorepo to Deno, so JSR resolves local workspace imports during
validation and rewrites them to registry references when each package is published.

## One-time JSR setup

Create these packages in the `@cbj` scope and link each package to this GitHub repository in its JSR
settings:

- `@cbj/vignette-core`
- `@cbj/vignette`
- `@cbj/vignette-target-dom`
- `@cbj/vignette-target-obs`
- `@cbj/vignette-frame`
- `@cbj/vignette-server`
- `@cbj/vignette-moq`
- `@cbj/vignette-testkit`

JSR's GitHub Actions security defaults may also require the workflow initiator to be a member of the
`@cbj` scope. No repository secret is needed: `.github/workflows/release.yml` requests GitHub's OIDC
ID token and JSR verifies the linked repository, producing provenance records for every package.

## Release

1. Set the same new semantic version in the root `package.json` and each changed package's
   `package.json` and `deno.json`.
2. Run `pnpm install` to update the lockfile after package metadata changes.
3. Run `pnpm ready` to build, typecheck, test, lint, check formatting, validate every JSR package,
   and run the browser integration suite.
4. Push the release commit and publish a non-prerelease GitHub Release tagged `v<version>`.

The release workflow reruns the complete readiness suite, rejects tags that do not exactly match all
package versions, and publishes in dependency order. JSR skips package versions that already exist,
so a corrected rerun can continue after a partial release. Prereleases are intentionally not
published.

`@cbj/vignette-moq` deliberately uses TypeScript module augmentation to add `source:moq` to core's
closed source map. Its publish step therefore opts into JSR slow types. The other seven packages
must pass JSR's default fast-type checks.
