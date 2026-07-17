# Publishing to JSR

The eight public packages use TypeScript source exports from their package-level `deno.json` files.
Those files are the complete publication contract: internal dependencies use `jsr:` mappings and
third-party dependencies use `npm:` mappings. The local `package.json` files exist only for pnpm,
TypeScript builds, and workspace examples; they are not included in JSR packages.

The root `deno.json` declares the monorepo to Deno, so JSR resolves local workspace imports during
validation and rewrites them to registry references when each package is published. JSR generates
its npm compatibility artifacts from that JSR metadata rather than from the local pnpm manifests.

## One-time JSR setup

Create these packages in the `@cbj` scope and link each package to this GitHub repository in its JSR
settings:

- `@cbj/vignette-core`
- `@cbj/vignette`
- `@cbj/vignette-target-dom`
- `@cbj/vignette-target-obs`
- `@cbj/vignette-frame`
- `@cbj/vignette-vite`
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

All eight packages pass JSR's default fast-type checks. JSR prohibits ambient global module
declarations, so its `@cbj/vignette-vite` artifact omits the local `./virtual` convenience
entrypoint; JSR consumers declare the two generated module IDs in their application. Extension
packages carry source types through generic contracts rather than modifying global or cross-package
declarations.
