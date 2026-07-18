# Publishing to npm

The nine public packages publish compiled ESM and declarations from `dist`. Their `package.json`
files are the publication contract: internal dependencies use `workspace:^`, and `pnpm pack`
rewrites those references to the release's compatible npm versions.

The Vite package also includes `src/virtual.d.ts` for its types-only `./virtual` entrypoint. The
preview package includes `bin/vignette.js`, which loads the compiled CLI from `dist`.

## Trusted publishing

Each package in the `@strangecyan` npm scope must trust this GitHub Actions publisher:

- Organization or user: `changesbyjames`
- Repository: `vignette`
- Workflow filename: `release.yml`
- Allowed action: `npm publish`

Configure the trusted publisher for:

- `@strangecyan/vignette-core`
- `@strangecyan/vignette`
- `@strangecyan/vignette-target-dom`
- `@strangecyan/vignette-target-obs`
- `@strangecyan/vignette-frame`
- `@strangecyan/vignette-vite`
- `@strangecyan/vignette-moq`
- `@strangecyan/vignette-testkit`
- `@strangecyan/vignette-preview`

The release workflow uses a GitHub-hosted runner, npm CLI 11 or newer, and `id-token: write`. It has
no npm token. Trusted publishing automatically attaches provenance to each public package. Once OIDC
publishing is verified, set each package's npm publishing access to require two-factor
authentication and disallow tokens.

## Release

1. Set the same new semantic version in the root and all nine public `package.json` files.
2. Run `pnpm install` to update the lockfile after package metadata changes.
3. Run `pnpm ready` to build, typecheck, test, lint, check formatting, inspect every npm package,
   and run the browser integration suite.
4. Push the release commit and publish a non-prerelease GitHub Release tagged `v<version>`.

The release workflow reruns the complete readiness suite and rejects a tag that does not match every
package version. It packs and publishes packages in dependency order: core, DOM target, OBS target,
React renderer, frames, Vite integration, MoQ extension, testkit, then preview. `pnpm pack` produces
the final npm manifest with rewritten workspace dependencies; npm CLI publishes each tarball through
OIDC. Prereleases are intentionally not published.
