import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createServer, type ViteDevServer } from "vite";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";

import type { StreamMessage } from "../stream/messages.js";
import { fromSse } from "../stream/sse.js";
import { vignette } from "./plugin.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const directories: string[] = [];

afterAll(async () => {
  await Promise.all(directories.map((dir) => rm(dir, { recursive: true, force: true })));
});

/** A show whose color comes from a hook, so it only renders with the composer's React. */
function showSource(color: string, id = "dev"): string {
  return `import { useState } from "react";
import { Color, Layer, Scene, Show } from "vignette";

export default function Demo() {
  const [color] = useState(${JSON.stringify(color)});
  return (
    <Show id=${JSON.stringify(id)} canvas={{ width: 1280, height: 720 }}>
      <Scene id="main">
        <Layer style={{ flex: 1 }}>
          <Color color={color} />
        </Layer>
      </Scene>
    </Show>
  );
}
`;
}

/** A show project in a temp folder that resolves `vignette` and React like an installed one. */
async function createProject(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "vignette-dev-"));
  directories.push(dir);
  await mkdir(join(dir, "node_modules", "@tanstack"), { recursive: true });
  await symlink(packageRoot, join(dir, "node_modules", "vignette"), "dir");
  for (const name of ["react", "react-dom", "@tanstack/react-query"])
    await symlink(join(packageRoot, "node_modules", name), join(dir, "node_modules", name), "dir");
  await mkdir(join(dir, "assets"));
  await writeFile(join(dir, "assets", "logo.png"), "logo");
  await writeFile(join(dir, "show.tsx"), showSource("#112233"));
  await writeFile(
    join(dir, "x.frame.tsx"),
    `import { frame } from "vignette/frame";
export const X = frame({ name: "X", view: () => <div>x</div> });
`,
  );
  return dir;
}

const AddressSchema = z.object({ port: z.number() });
type Address = z.output<typeof AddressSchema>;

const ColorPropsSchema = z.object({ color: z.string() });
type ColorProps = z.output<typeof ColorPropsSchema>;

/** A started dev server and the origin it listens on. */
interface StartedServer {
  readonly server: ViteDevServer;
  readonly origin: string;
}

async function startServer(root: string): Promise<StartedServer> {
  const server = await createServer({
    root,
    configFile: false,
    envDir: false,
    logLevel: "silent",
    server: { port: 0, host: "127.0.0.1" },
    plugins: [vignette({ show: "show.tsx" })],
  });
  await server.listen();
  const { port }: Address = AddressSchema.parse(server.httpServer?.address());
  return { server, origin: `http://127.0.0.1:${String(port)}` };
}

/** Reads messages until one satisfies `done`. */
async function next(
  iterator: AsyncIterator<StreamMessage>,
  done: (message: StreamMessage) => boolean,
): Promise<StreamMessage> {
  for (;;) {
    const result = await iterator.next();
    if (result.done === true) throw new Error("The stream ended.");
    if (done(result.value)) return result.value;
  }
}

function colorOf(message: StreamMessage): string | undefined {
  if (message.kind !== "update") return undefined;
  const props: ColorProps = ColorPropsSchema.parse(message.snapshot.sources[0]?.props);
  return props.color;
}

describe("dev composer", () => {
  // Resolves `vignette` from `dist`, so `pnpm build` must have run.
  it("streams the show with serve URLs on the dev origin and recomposes on edits", async () => {
    const dir = await createProject();
    const { server, origin } = await startServer(dir);
    const abort = new AbortController();
    try {
      const iterator = fromSse(`${origin}/stream`, { signal: abort.signal })[
        Symbol.asyncIterator
      ]();
      const setup = await next(iterator, (message) => message.kind === "setup");
      expect(setup).toMatchObject({
        id: "dev",
        serve: {
          stream: `${origin}/stream`,
          assets: `${origin}/vignette/assets/`,
          frames: `${origin}/vignette/frames.html`,
        },
      });
      expect(setup.kind === "setup" ? setup.assets.entries.map((e) => e.name) : []).toEqual([
        "logo.png",
      ]);
      const first = await next(iterator, (message) => message.kind === "update");
      expect(colorOf(first)).toBe("#112233");

      await writeFile(join(dir, "show.tsx"), showSource("#445566"));
      const edited = await next(iterator, (message) => colorOf(message) === "#445566");
      // The same composer re-rendered: revisions continue on the open connection.
      const revision = (message: StreamMessage) =>
        message.kind === "update" ? message.snapshot.revision : -1;
      expect(revision(edited)).toBeGreaterThan(revision(first));

      const page = await fetch(`${origin}/vignette/frames.html`);
      expect(page.status).toBe(200);
      expect(await page.text()).toContain("./frames.js");
      const script = await fetch(`${origin}/vignette/frames.js`);
      expect(script.status).toBe(200);
      expect(await script.text()).toContain("x.frame.tsx");
      const asset = await fetch(`${origin}/vignette/assets/logo.png`);
      expect(await asset.text()).toBe("logo");
      const escape = await fetch(`${origin}/vignette/assets/..%2fshow.tsx`);
      expect(await escape.text()).not.toContain("Demo");
    } finally {
      abort.abort();
      await server.close();
    }
  }, 60_000);

  it("replaces the composer when the show's id changes, so clients get a new setup", async () => {
    const dir = await createProject();
    const { server, origin } = await startServer(dir);
    const abort = new AbortController();
    try {
      const iterator = fromSse(`${origin}/stream`, {
        signal: abort.signal,
        retry: { initialDelayMs: 10, maximumDelayMs: 50 },
      })[Symbol.asyncIterator]();
      await next(iterator, (message) => message.kind === "update");

      await writeFile(join(dir, "show.tsx"), showSource("#112233", "renamed"));
      const setup = await next(iterator, (message) => message.kind === "setup");
      expect(setup).toMatchObject({ id: "renamed" });
      const update = await next(iterator, (message) => message.kind === "update");
      expect(update.kind === "update" ? update.snapshot.id : undefined).toBe("renamed");
    } finally {
      abort.abort();
      await server.close();
    }
  }, 60_000);
});
