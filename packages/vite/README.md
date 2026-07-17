# `@cbj/vignette-vite`

Vite 8 integration for statically discovered Vignette frames and content-versioned composition
assets.

```ts
import { vignette } from "@cbj/vignette-vite";
import { defineConfig } from "vite";

export default defineConfig({ plugins: [vignette({ assets: "public/**/*" })] });
```

Add `@cbj/vignette-vite/virtual` to `compilerOptions.types`, then import `frames` from
`virtual:vignette/frames` and `assets` from `virtual:vignette/assets`. Frame client entries use
deterministic URLs and must be served with `Cache-Control: no-store`.
