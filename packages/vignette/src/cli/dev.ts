import { dirname, resolve } from "node:path";

import type { Plugin } from "vite";

import { loadVite } from "../bundle/load-vite.js";
import type { Composer } from "../compose/compose.js";
import { obsTarget } from "../obs/target.js";
import type { Target } from "../target/kernel.js";
import { previewHtml } from "../vite/pages.js";
import { vignette } from "../vite/plugin.js";
import { loadPlugins } from "./load-plugins.js";
import { describeStatus } from "./obs.js";

/** Options of {@link runDev}. */
export interface RunDevOptions {
  /** The show module; its directory is the dev server's root. */
  readonly show: string;
  /** Default 4173; the next free port is used when it is taken. */
  readonly port?: number;
  readonly host?: string;
  /** Also drive OBS from the dev composer. */
  readonly obs?: RunDevObsOptions;
}

/** OBS options of {@link runDev}. */
export interface RunDevObsOptions {
  /** obs-websocket URL; default `ws://127.0.0.1:4455`. */
  readonly url?: string;
  readonly password?: string;
  /** Modules exporting OBS source plugins, resolved from the working directory. */
  readonly sources?: string[];
}

/** A running `vignette dev`. */
export interface DevServer {
  /** `http://host:port`, where the preview (`/`) and the stream (`/stream`) are served. */
  readonly origin: string;
  close(): Promise<void>;
}

/**
 * `vignette dev`: a Vite dev server rooted at the show's directory with the `vignette()` plugin,
 * serving the preview page at `/`. With `obs`, an OBS target follows the dev composer, and
 * follows its replacement whenever the show's identity or assets change.
 */
export async function runDev(options: RunDevOptions): Promise<DevServer> {
  const show = resolve(options.show);
  const plugin = vignette({ show });
  const { createServer } = await loadVite();
  const server = await createServer({
    root: dirname(show),
    configFile: false,
    envDir: false,
    publicDir: false,
    appType: "custom",
    clearScreen: false,
    server: { port: options.port ?? 4173, host: options.host },
    plugins: [plugin, previewPage()],
  });
  let obs: Target | undefined = undefined;
  let unfollow: () => void = () => undefined;
  try {
    if (options.obs !== undefined) {
      const sources = await loadPlugins(options.obs.sources ?? [], process.cwd());
      const target = obsTarget({
        url: options.obs.url,
        password: options.obs.password,
        sources: [...sources],
      });
      obs = target;
      logStatus(target, (line) => {
        server.config.logger.info(line, { timestamp: true });
      });
      let stop: () => void = () => undefined;
      const off = plugin.api.onComposer((composer: Composer) => {
        stop();
        stop = target.follow(composer.stream());
      });
      unfollow = () => {
        off();
        stop();
      };
    }
    await server.listen();
  } catch (error) {
    unfollow();
    await obs?.dispose();
    await server.close();
    throw error;
  }
  const local =
    server.resolvedUrls?.local[0] ?? `http://localhost:${String(options.port ?? 4173)}/`;
  return {
    origin: local.replace(/\/$/u, ""),
    async close() {
      unfollow();
      await obs?.dispose();
      await server.close();
    },
  };
}

/** Serves the preview page at `/`; its module is the plugin's `/vignette/preview.js`. */
function previewPage(): Plugin {
  return {
    name: "vignette:preview-page",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        // Only GET of `/` or `/index.html`; everything else falls through to Vite.
        const url = request.url ?? "/";
        const path = url.split("?", 1)[0];
        if (request.method !== "GET" || (path !== "/" && path !== "/index.html")) {
          next();
          return;
        }
        server.transformIndexHtml(url, previewHtml()).then((html) => {
          response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          response.end(html);
        }, next);
      });
    },
  };
}

/** Logs each change of the OBS target's phase or connection, as `vignette obs` prints them. */
function logStatus(target: Target, log: (line: string) => void): void {
  let last = "";
  target.subscribe(() => {
    const line = describeStatus(target.status);
    if (line === last) return;
    last = line;
    log(`[vignette] ${line}`);
  });
}
