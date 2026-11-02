import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { fromSse, type StreamMessage } from "vignette";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const workspaceRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const exampleRoot = fileURLToPath(new URL("../../", import.meta.url));

describe("production kitchen-sink server", () => {
  it("builds, publishes serve in setup, streams an update and serves the bundle", async () => {
    // Set VIGNETTE_SKIP_BUILD=1 to reuse an existing build when iterating locally.
    if (process.env.VIGNETTE_SKIP_BUILD !== "1") {
      await execFileAsync("pnpm", ["build"], {
        cwd: workspaceRoot,
        env: process.env,
        maxBuffer: 10 * 1024 * 1024,
      });
    }

    const port = await reservePort();
    const origin = `http://127.0.0.1:${String(port)}`;
    const child = spawn(process.execPath, ["dist/server/entry.js"], {
      cwd: exampleRoot,
      env: { ...process.env, PORT: String(port), OBS_URL: undefined },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const collect = (chunk: Buffer) => {
      output += chunk.toString();
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);

    try {
      await waitForServer(origin, child, () => output);
      const [setup, update] = await readUntilUpdate(`${origin}/stream`);

      expect(setup).toMatchObject({
        kind: "setup",
        id: "kitchen-sink",
        kinds: expect.arrayContaining(["color", "frame", "image", "moq"]),
        serve: {
          stream: `${origin}/stream`,
          assets: `${origin}/vignette/assets/`,
          frames: `${origin}/vignette/frames.html`,
        },
      });
      expect(update?.kind).toBe("update");
      if (update?.kind !== "update") return;
      const frames = update.snapshot.sources.filter((source) => source.kind === "frame");
      expect(frames.map((source) => source.props)).toContainEqual({
        frame: "Clock",
        params: { title: "Vignette kitchen sink" },
      });

      const page = await fetch(`${origin}/vignette/frames.html`);
      expect(page.status).toBe(200);
      expect(await page.text()).toContain("frames.js");
      expect((await fetch(`${origin}/vignette/frames.js`)).status).toBe(200);
      expect((await fetch(`${origin}/vignette/assets/logo.png`)).status).toBe(200);
      expect((await fetch(origin)).status).toBe(200);
    } finally {
      await stopChild(child);
    }
  }, 180_000);
});

/** Reads the replayed setup and first update, then disconnects. */
async function readUntilUpdate(url: string): Promise<readonly StreamMessage[]> {
  const controller = new AbortController();
  const messages: StreamMessage[] = [];
  for await (const message of fromSse(url, { signal: controller.signal })) {
    messages.push(message);
    if (message.kind === "update") controller.abort();
  }
  return messages;
}

async function reservePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port =
    /* SAFETY: This server was bound to an ephemeral TCP port, so its address is an AddressInfo rather than a pipe name. */ (
      server.address() as AddressInfo
    ).port;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) resolve();
      else reject(error);
    });
  });
  return port;
}

/** Polls the server while the child is alive; reports its output if it never starts. */
async function waitForServer(
  origin: string,
  child: ChildProcess,
  readOutput: () => string,
): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Production server exited with ${String(child.exitCode)}.\n${readOutput()}`);
    }
    try {
      const response = await fetch(origin);
      if (response.ok) return;
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Production server did not start.\n${readOutput()}`);
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolve) => {
      child.once("exit", () => {
        resolve();
      });
    }),
    new Promise<void>((resolve) =>
      setTimeout(() => {
        child.kill("SIGKILL");
        resolve();
      }, 5000),
    ),
  ]);
}
