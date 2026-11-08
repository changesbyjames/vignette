import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";

import type { StreamMessage } from "../stream/messages.js";
import { fromSse } from "../stream/sse.js";
import { runBuild } from "./build.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const directories: string[] = [];

afterAll(async () => {
  await Promise.all(directories.map((dir) => rm(dir, { recursive: true, force: true })));
});

/** A show with one frame and one asset, in a temp project resolving `@strangecyan/vignette` like an install. */
async function createProject(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "vignette-build-"));
  directories.push(dir);
  for (const scope of ["@strangecyan", "@tanstack"])
    await mkdir(join(dir, "node_modules", scope), { recursive: true });
  await symlink(packageRoot, join(dir, "node_modules", "@strangecyan", "vignette"), "dir");
  for (const name of ["react", "react-dom", "@tanstack/react-query"])
    await symlink(join(packageRoot, "node_modules", name), join(dir, "node_modules", name), "dir");
  await mkdir(join(dir, "assets"));
  await writeFile(join(dir, "assets", "logo.png"), "logo");
  await writeFile(
    join(dir, "score.frame.tsx"),
    `import { frame } from "@strangecyan/vignette/frame";
export const Score = frame({ name: "Score", view: () => <div>score</div> });
`,
  );
  await writeFile(
    join(dir, "show.tsx"),
    `import { Frame, Image, Layer, Scene, Show } from "@strangecyan/vignette";
import { Score } from "./score.frame.js";

export default (
  <Show id="built" canvas={{ width: 1280, height: 720 }}>
    <Scene id="main">
      <Layer style={{ flex: 1 }}><Image src="logo.png" /></Layer>
      <Layer style={{ position: "absolute", width: 400, height: 120 }}><Frame of={Score} /></Layer>
    </Scene>
  </Show>
);
`,
  );
  return dir;
}

const AddressSchema = z.object({ port: z.number() });
type Address = z.output<typeof AddressSchema>;

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port }: Address = AddressSchema.parse(server.address());
  await new Promise((resolve) => server.close(resolve));
  return port;
}

/** Runs `node server.js` until it prints its listening line. */
async function startServer(file: string, port: number): Promise<ChildProcess> {
  const child = spawn(process.execPath, [file], {
    env: { ...process.env, PORT: String(port), HOST: "127.0.0.1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  await new Promise<void>((resolve, reject) => {
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes("stream at")) resolve();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.once("exit", (code) => {
      reject(new Error(`server.js exited with ${String(code)}:\n${output}`));
    });
  });
  return child;
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

describe("runBuild", () => {
  // Builds `@strangecyan/vignette` from `dist`, so `pnpm build` must have run.
  it("writes a server that streams the show and serves the bundle", async () => {
    // Build, check the files, then run server.js and read its stream and files over HTTP.
    const dir = await createProject();
    const out = join(dir, "dist");

    await runBuild({ show: join(dir, "show.tsx"), out });

    for (const file of ["public/frames.html", "public/preview.js", "show.js"])
      expect(await exists(join(out, file)), file).toBe(true);
    const manifest: unknown = JSON.parse(await readFile(join(out, "public/assets.json"), "utf8"));
    expect(manifest).toMatchObject({ entries: [{ name: "logo.png" }] });
    const { build } = z
      .object({ build: z.string() })
      .parse(JSON.parse(await readFile(join(out, "public/frames.json"), "utf8")));
    const script = /frames\.[0-9a-f]+\.js/u.exec(
      await readFile(join(out, "public/frames.html"), "utf8"),
    )?.[0];
    expect(script).toBeDefined();

    const port = await freePort();
    const origin = `http://127.0.0.1:${String(port)}`;
    const server = await startServer(join(out, "server.js"), port);
    const abort = new AbortController();
    try {
      const messages: StreamMessage[] = [];
      for await (const message of fromSse(`${origin}/stream`, { signal: abort.signal })) {
        messages.push(message);
        if (message.kind === "update") break;
      }
      expect(messages[0]).toMatchObject({
        kind: "setup",
        id: "built",
        serve: { frames: `${origin}/vignette/frames.html` },
      });
      expect(messages[1]?.kind).toBe("update");
      // The frame source carries the bundle's build.
      const sources = messages[1]?.kind === "update" ? messages[1].snapshot.sources : [];
      expect(sources.find((source) => source.kind === "frame")?.props).toMatchObject({ build });

      const page = await fetch(`${origin}/vignette/frames.html`);
      expect(page.status).toBe(200);
      expect(page.headers.get("cache-control")).toBe("no-cache");
      const bundle = await fetch(`${origin}/vignette/${String(script)}`);
      expect(bundle.headers.get("cache-control")).toContain("immutable");
      expect(await bundle.text()).toContain(build);
      expect(await (await fetch(`${origin}/vignette/assets/logo.png`)).text()).toBe("logo");
      expect(await (await fetch(`${origin}/`)).text()).toContain("/vignette/preview.js");
      expect((await fetch(`${origin}/vignette/..%2fshow.js`)).status).toBe(404);
    } finally {
      abort.abort();
      server.kill();
    }
  }, 120_000);
});
