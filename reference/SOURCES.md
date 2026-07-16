# Reference Sources

Retrieved on **2026-07-15**. Runtime versions below are the versions selected by
the implementation plans, not a promise that every upstream repository HEAD is
the corresponding published package.

## Runtime and protocol references

| Area | Selected runtime version | Vendored upstream revision | Source | License pointer |
|---|---:|---|---|---|
| React | 19.2.7 | React tag `v19.2.0`, commit `ae74234eae6ebd62f19190731278e20bc1c37d51` for the host-config source | <https://github.com/facebook/react/tree/v19.2.0/packages/react-reconciler> and npm `react-reconciler@0.33.0` | `react-reconciler/LICENSE` |
| React DOM docs | React 19 API | `hydrateRoot` at `730d045c7158a0e4e1d07efbadda256c76102174`; `renderToString` at `4673a050e126289c0ee20f147313326b8fec5e8d` | <https://react.dev/reference/react-dom/client/hydrateRoot> and <https://react.dev/reference/react-dom/server/renderToString> | `react-dom/LICENSE-DOCS.md` |
| React external-store docs | React 19 API | `useSyncExternalStore` at `e377252563aaec455d98f0c325ec989bef09065e` | <https://react.dev/reference/react/useSyncExternalStore> | `react-dom/LICENSE-DOCS.md` |
| react-reconciler | 0.33.0 | npm package shasum `9dd20208d45baa5b0b4701781f858236657f15e1` | <https://www.npmjs.com/package/react-reconciler/v/0.33.0> | `react-reconciler/LICENSE` |
| Yoga | 3.2.1 | `6d3a8e0292d8b3c21fe5a14ec76721940f74f569` | <https://github.com/facebook/yoga> | `yoga/LICENSE` |
| obs-websocket protocol | server 5.7.4 documentation | `1ef34bf48110c2a18184e50e41cd0b1a855e2147` | <https://github.com/obsproject/obs-websocket/tree/master/docs/generated> | `obs-websocket/LICENSE` |
| obs-websocket-js | 5.0.8 | `0a95c4253ef050ef90b7e02e75638da49d177e6d` | <https://github.com/obs-websocket-community-projects/obs-websocket-js> | `obs-websocket-js/LICENSE.md` |
| @moq/watch | 0.3.0 | published npm package installed 2026-07-16 | <https://www.npmjs.com/package/@moq/watch/v/0.3.0> and <https://github.com/moq-dev/moq> | package declares `(MIT OR Apache-2.0)` |
| custom obs-moqsource | local revision | `5f0e1ce35d474308c4696abd80149a47f919a237` | `/Users/jameswilliams/Developer/experiments/obs-moqsource` | source repository `LICENSE` |

The OBS protocol is vendored from the current server documentation rather than
from an old client-library release. Implementations must still use `GetVersion`
and its `availableRequests` response to negotiate actual server capabilities.

## Tooling references

| Tool | Selected version | Vendored upstream revision | Source | License pointer |
|---|---:|---|---|---|
| TypeScript | 6.0.3 | `c8170c35bda4811c9516cbb69c39241ae4beb6d9` | <https://github.com/microsoft/TypeScript-Website> | `typescript/LICENSE-CODE` |
| Vitest | 4.1.10 | `3e3e85285fb1256ff49dd5f4ef1ca4ebffe60a17` | <https://github.com/vitest-dev/vitest/tree/main/docs/guide> | `vitest/LICENSE` |
| Playwright | 1.61.1 | `b2743b2247edbe2324c7d0893dcd4b4f347e766e` | <https://github.com/microsoft/playwright/tree/main/docs/src> | `playwright/LICENSE` |
| pnpm | 11.13.0 | `8a01423859b423bba444cb241bf91aa7d9d499f2` | <https://github.com/pnpm/pnpm.io/tree/main/docs> | `pnpm/LICENSE` |
| Vite | 8.1.4 | selected guides at `b59a73f76f5557492d83d097bb33b3dd02f27d51`; plugin API from tag `v8.1.4` commit `a477454442eff649b430f9e3c6caf2500fcb7183` | <https://github.com/vitejs/vite/tree/v8.1.4/docs/guide> | `vite/LICENSE` |
| Zod | 4.4.3 | npm package shasum `b680f172885d18bbebf21a834ea25e55a1bbf356` | <https://www.npmjs.com/package/zod/v/4.4.3> | `zod/LICENSE` |
| pixelmatch | 7.2.0 | `c6fee35afac3c52576b2cb424bd1061ab6a4bd06` | <https://github.com/mapbox/pixelmatch> | `pixelmatch/LICENSE` |
| pngjs | 7.0.0 | `c565210c602527eb459f857eeb78183997482d5b` | <https://github.com/pngjs/pngjs> | `pngjs/LICENSE` |

## Scope decisions

- General React application documentation is not duplicated; only the custom
  renderer contract and the two React DOM SSR/hydration APIs used by frames are vendored.
- The complete Yoga documentation subtree is included because layout semantics
  are part of this project's cross-target compatibility contract.
- The full generated OBS protocol is included because requests and fields are
  cross-referenced throughout the planner and recovery work.
- Tooling documentation is intentionally selected rather than complete; only
  workspace, type-system, test, snapshot, and browser-test material needed by
  these plans is included.
- OBS Studio plugin-development documentation is deferred. A native plugin is
  explicitly outside the first implementation sequence.
