# Publishing to npm

Two packages are published, at the same version:

- `@strangecyan/vignette`, from `packages/vignette`: compiled ESM and declarations from `dist`, plus
  the vendored Yoga wasm.
- `@strangecyan/vignette-moq`, from `packages/moq`: compiled ESM and declarations from `dist`. Its
  peer range asks for the `@strangecyan/vignette` of the same release.

Each `package.json` is that package's publication contract. The examples are not published.

## Trusted publishing

Both packages on npm must trust this GitHub Actions publisher:

- Organization or user: `changesbyjames`
- Repository: `vignette`
- Workflow filename: `release.yml`
- Allowed action: `npm publish`

The release workflow uses a GitHub-hosted runner, npm CLI 11 or newer, and `id-token: write`. It has
no npm token; trusted publishing attaches provenance. Once OIDC publishing is verified, require
two-factor authentication for publishing and disallow tokens.

## Release

1. Set the same new semantic version in the root, `packages/vignette/package.json` and
   `packages/moq/package.json`, and moq's `@strangecyan/vignette` peer range to `^<version>`.
2. Run `pnpm install` if package metadata changed.
3. Run `pnpm ready` to build, typecheck, test, lint, check formatting, inspect the npm package and
   run the browser suite.
4. Push the release commit and publish a non-prerelease GitHub Release tagged `v<version>`.

The workflow reruns `pnpm ready`, rejects a tag that does not match the package versions
(`scripts/check-npm-package.mjs`), packs `packages/vignette` and then `packages/moq` with
`pnpm pack` and publishes each tarball with npm through OIDC (`scripts/publish-npm-package.mjs`).
Prereleases are not published.
