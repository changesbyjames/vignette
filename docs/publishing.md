# Publishing to npm

One package is published: `@strangecyan/vignette`, from `packages/vignette`, as compiled ESM and
declarations from `dist` plus the vendored Yoga wasm. Its `package.json` is the publication
contract. `@vignette/moq` and the examples are not published by the release workflow.

## Trusted publishing

`@strangecyan/vignette` on npm must trust this GitHub Actions publisher:

- Organization or user: `changesbyjames`
- Repository: `vignette`
- Workflow filename: `release.yml`
- Allowed action: `npm publish`

The release workflow uses a GitHub-hosted runner, npm CLI 11 or newer, and `id-token: write`. It has
no npm token; trusted publishing attaches provenance. Once OIDC publishing is verified, require
two-factor authentication for publishing and disallow tokens.

## Release

1. Set the same new semantic version in the root and `packages/vignette/package.json`.
2. Run `pnpm install` if package metadata changed.
3. Run `pnpm ready` to build, typecheck, test, lint, check formatting, inspect the npm package and
   run the browser suite.
4. Push the release commit and publish a non-prerelease GitHub Release tagged `v<version>`.

The workflow reruns `pnpm ready`, rejects a tag that does not match the package version
(`scripts/check-npm-package.mjs`), packs `packages/vignette` with `pnpm pack` and publishes the
tarball with npm through OIDC (`scripts/publish-npm-package.mjs`). Prereleases are not published.
