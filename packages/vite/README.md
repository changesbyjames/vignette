# `@strangecyan/vignette-vite`

Vite 8 integration for statically discovered Vignette frames and content-versioned composition
assets.

```ts
import { vignette } from "@strangecyan/vignette-vite";
import { defineConfig } from "vite";

export default defineConfig({ plugins: [vignette({ assets: "public/**/*" })] });
```

Add `@strangecyan/vignette-vite/virtual` to `compilerOptions.types`, then import `frames` from
`virtual:vignette/frames` and `assets` from `virtual:vignette/assets`. Manifest asset URLs are
root-relative; pass the manifest to `createComposerRoot(composition, { assets })` unchanged and each
target resolves them against its own base URL. Frame client entries use deterministic URLs and must
be served with `Cache-Control: no-store`.
