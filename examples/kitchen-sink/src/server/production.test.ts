import { z } from "zod";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import type { RuntimeMessage } from "@strangecyan/vignette-core";
import { sseRuntimeSource } from "@strangecyan/vignette-target-obs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const workspaceRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const exampleRoot = fileURLToPath(new URL("../../", import.meta.url));

describe("production kitchen-sink server", () => {
  it("builds and serves runtime SSE, frame SSR, and manifest-resolved hydration modules", async () => {
    // Set VIGNETTE_SKIP_BUILD=1 to reuse an existing dist/ when iterating locally.
    if (process.env.VIGNETTE_SKIP_BUILD !== "1") {
      await execFileAsync("pnpm", ["build"], {
        cwd: workspaceRoot,
        env: process.env,
        maxBuffer: 10 * 1024 * 1024,
      });
    }

    const port = await reservePort();
    const origin = `http://127.0.0.1:${String(port)}`;
    const child = spawn(process.execPath, ["dist/server/host.js"], {
      cwd: exampleRoot,
      env: {
        ...process.env,
        PORT: String(port),
        VIGNETTE_ORIGIN: origin,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });

    try {
      // Wait for the launched server, inspect its runtime replay and frame routes, and always stop the child process.

      await waitForServer(origin, child, () => output);
      const messages = await readRuntimeReplay(`${origin}/runtime`);
      expect(messages.map((message) => message.kind)).toEqual(["setup", "update"]);

      const update = messages.find((message) => message.kind === "update");
      const frameUrl = findFrameUrl(update?.snapshot);
      expect(frameUrl).toBeDefined();
      const frameResponse = await fetch(frameUrl ?? "");
      expect(frameResponse.status).toBe(200);
      const frameHtml = await frameResponse.text();
      expect(frameHtml).toContain("<!doctype html>");

      const routeKey = new URL(frameUrl ?? "").pathname.split("/").at(-1);
      const hydrationPath = /src="([^"]+\/hydrate\.js)"/u.exec(frameHtml)?.[1];
      expect(routeKey).toBeDefined();
      expect(hydrationPath).toBeDefined();
      const hydrationResponse = await fetch(new URL(hydrationPath ?? "", origin));
      expect(hydrationResponse.status).toBe(200);
      const hydrationModule = await hydrationResponse.text();
      const imports = [...hydrationModule.matchAll(/from ("[^"]+")/gu)].map((match) =>
        z.string().parse(JSON.parse(match[1] ?? "")),
      );
      expect(imports).toHaveLength(2);
      for (const moduleUrl of imports) {
        const moduleResponse = await fetch(new URL(moduleUrl, origin));
        expect(moduleResponse.status).toBe(200);
        if (moduleUrl !== imports[1]) {
          expect(await moduleResponse.text()).toContain(routeKey);
        }
      }
    } finally {
      await stopChild(child);
    }
  }, 120_000);
});

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

/** Poll readiness while the child remains alive, then report collected output if startup never succeeds. */
async function waitForServer(
  origin: string,
  child: ChildProcess,
  readOutput: () => string,
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
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

async function readRuntimeReplay(url: string): Promise<readonly RuntimeMessage[]> {
  const controller = new AbortController();
  const messages: RuntimeMessage[] = [];
  for await (const message of sseRuntimeSource(url)(controller.signal)) {
    messages.push(message);
    if (message.kind === "update") controller.abort();
  }
  return messages;
}

const ReplayJsonSchema = z.json();
export type ReplayJson = z.output<typeof ReplayJsonSchema>;

function findFrameUrl(input: Parameters<typeof ReplayJsonSchema.parse>[0]): string | undefined {
  return findJsonFrameUrl(ReplayJsonSchema.parse(input));
}

/** Search each JSON branch until the first frame URL is found, preserving the wire traversal order. */
function findJsonFrameUrl(value: ReplayJson): string | undefined {
  const string = z.string().safeParse(value);
  if (string.success) return string.data.includes("/__vignette/frame/") ? string.data : undefined;
  if (!(value instanceof Object)) return undefined;
  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    const result = findJsonFrameUrl(child);
    if (result !== undefined) return result;
  }
  return undefined;
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
