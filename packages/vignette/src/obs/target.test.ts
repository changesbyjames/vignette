import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";

import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { AudioChannelSchema } from "../core/audio.js";
import type { AssetEntry } from "../core/assets.js";
import type { Item, Snapshot, Source } from "../core/snapshot.js";
import type { SetupMessage, StreamMessage } from "../stream/messages.js";
import type { Target } from "../target/kernel.js";
import type { TargetStatus } from "../target/status.js";
import { ObsRequestError } from "./errors.js";
import { obsTarget, type ObsTargetOptions } from "./target.js";
import { FakeObs, ManualClock } from "./testing.js";

const logoBytes = new TextEncoder().encode("not really a png");
const logo: AssetEntry = {
  name: "logo.png",
  hash: `sha256-${createHash("sha256").update(logoBytes).digest("base64")}`,
};

function setup(id = "show"): SetupMessage {
  return {
    kind: "setup",
    id,
    canvas: { width: 1920, height: 1080 },
    assets: { version: "v1", entries: [logo] },
    serve: {},
  };
}

function item(id: string, sourceId: string, x: number): Item {
  const frame = { x, y: 0, width: 640, height: 360 };
  return {
    id,
    sourceId,
    frame,
    placement: {
      destination: frame,
      sourceCrop: { top: 0, right: 0, bottom: 0, left: 0 },
      alignment: { horizontal: "center", vertical: "center" },
    },
    visible: true,
    opacity: 1,
    rotation: 0,
  };
}

const bg: Source = {
  id: "bg",
  kind: "color",
  props: { color: "#102030" },
  size: { width: 1920, height: 1080 },
};
const chat: Source = {
  id: "chat",
  kind: "browser",
  props: { url: "https://example.com/chat", shutdownWhenHidden: false },
  size: { width: 1280, height: 720 },
};
const image: Source = {
  id: "main.logo",
  kind: "image",
  props: { src: "logo.png" },
  size: { width: 640, height: 360 },
};

/** `main` places bg, chat and the logo; `brb` places the shared chat source. */
function snapshot(revision: number, overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    revision,
    id: "show",
    canvas: { width: 1920, height: 1080 },
    sources: [bg, chat, image],
    scenes: [
      {
        id: "main",
        items: [
          item("main.0", "bg", 0),
          item("main.1", "chat", 0),
          item("main.logo", "main.logo", 640),
        ],
      },
      { id: "brb", items: [item("brb.0", "chat", 100)] },
    ],
    ...overrides,
  };
}

function update(revision: number, overrides: Partial<Snapshot> = {}): StreamMessage {
  return { kind: "update", snapshot: snapshot(revision, overrides) };
}

interface Harness {
  readonly obs: FakeObs;
  readonly clock: ManualClock;
  readonly target: Target;
  readonly phases: TargetStatus["phase"][];
  readonly connections: string[];
}

function harness(options: Partial<ObsTargetOptions> = {}): Harness {
  const obs = new FakeObs();
  const clock = new ManualClock();
  const target = obsTarget({
    url: "ws://fake",
    transport: obs,
    clock,
    assets: { fetch: () => Promise.resolve(logoBytes) },
    dir: mkdtempSync(join(tmpdir(), "vignette-obs-test-")),
    ...options,
  });
  const phases: TargetStatus["phase"][] = [];
  const connections: string[] = [];
  target.subscribe(() => {
    const { phase, connection } = target.status;
    if (phases.at(-1) !== phase) phases.push(phase);
    if (connection !== undefined && connections.at(-1) !== connection.phase)
      connections.push(connection.phase);
  });
  return { obs, clock, target, phases, connections };
}

/** Waits, a macrotask at a time, until the status satisfies `predicate`. */
async function until(target: Target, predicate: (status: TargetStatus) => boolean): Promise<void> {
  for (let turn = 0; turn < 500; turn += 1) {
    if (predicate(target.status)) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`Timed out in status ${JSON.stringify(target.status)}.`);
}

/** Settled at `revision` with every source's handle live. */
function converged(revision: number): (status: TargetStatus) => boolean {
  return (status) =>
    status.phase === "settled" &&
    status.revision.settled === revision &&
    Object.values(status.sources).every((source) => source === "live");
}

function names(obs: FakeObs): readonly string[] {
  return [
    ...obs.scenes.map((scene) => scene.sceneName),
    ...obs.inputs.map((input) => input.inputName),
  ];
}

function itemsOf(obs: FakeObs, sceneName: string): readonly string[] {
  return (
    obs.scenes
      .find((scene) => scene.sceneName === sceneName)
      ?.items.map((entry) => entry.sourceName) ?? []
  );
}

/** A show with one `<Text>` label of `size`. */
function label(
  revision: number,
  size: Source["size"],
  fontSize: number,
  text = "Camera 1",
): StreamMessage {
  const title: Source = {
    id: "title",
    kind: "text",
    props: { text, style: { fontSize, color: "#ffffff" } },
    size,
  };
  return update(revision, {
    sources: [title],
    scenes: [{ id: "main", items: [item("main.0", "title", 0)] }],
  });
}

/** The text page's input, as OBS has it. */
function pageInput(obs: FakeObs): FakeObs["inputs"][number] | undefined {
  return obs.inputs.find((entry) => entry.inputName === "vignette/show/title");
}

/** The text page's file, as OBS would load it. */
function pageFile(obs: FakeObs): string {
  return z.string().parse(pageInput(obs)?.inputSettings.local_file);
}

/** What tells a text page to re-read its file: the name of the page it is for. */
const RereadSchema = z.object({ page: z.string() });
type Reread = z.output<typeof RereadSchema>;

/** What the `emit_event` requests among OBS's requests carried, in order. */
function rereadsOf(obs: FakeObs): readonly Reread[] {
  return obs
    .calls("CallVendorRequest")
    .map(
      (request) =>
        z.object({ event_data: RereadSchema }).parse(request.requestData?.requestData).event_data,
    );
}

/** A page element the text page's script touches. */
interface PageElement {
  textContent: string;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
}

/** An event a text page's script listens for; only `vignette-text` has a detail. */
interface PageEvent {
  readonly detail?: Reread;
}

type PageListener = (event: PageEvent) => void;

/** The elements with an `id` in `html`, with their raw text content and `style` attribute. */
function pageElements(html: string): Map<string, PageElement> {
  const elements = new Map<string, PageElement>();
  for (const match of html.matchAll(/<(\w+)([^>]*)>([^<]*)/gu)) {
    // Each opening tag, its attributes, and the text up to the next tag: enough for the page's
    // own elements, none of which holds another element before its text. Tags without an `id`
    // are skipped.
    const attributes = match[2] ?? "";
    const id = /\bid="([^"]*)"/u.exec(attributes)?.[1];
    if (id === undefined) continue;
    const values = new Map([["style", /\bstyle="([^"]*)"/u.exec(attributes)?.[1] ?? ""]]);
    elements.set(id, {
      textContent: match[3] ?? "",
      getAttribute: (name) => values.get(name) ?? null,
      setAttribute: (name, value) => void values.set(name, value),
    });
  }
  return elements;
}

/** A text page as obs-browser shows it. */
interface OpenPage {
  /** The text's CSS as the page shows it now. */
  style(): string | null | undefined;
  /** The text as the page shows it now. */
  text(): string | undefined;
  /** Delivers an `emit_event`; resolves once the page has handled it. */
  emit(detail: Reread): Promise<void>;
  /** Fires the window's `resize`; resolves once the page has handled it. */
  resize(): Promise<void>;
}

/**
 * Runs the script of the text page `html`, as loaded from `file`, against the elements it
 * touches. Its `fetch` of itself reads the file as it is at that moment.
 */
async function openPage(file: string, html = readFileSync(file, "utf8")): Promise<OpenPage> {
  const elements = pageElements(html);
  const listeners = new Map<string, PageListener[]>();
  const script = z.string().parse(/<script>([\s\S]*?)<\/script>/u.exec(html)?.[1]);
  const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
  const dispatch = (type: string, detail?: Reread) => {
    for (const listener of listeners.get(type) ?? []) listener({ detail });
    return settle();
  };
  runInNewContext(script, {
    document: { getElementById: (id: string) => elements.get(id) ?? null },
    window: {
      addEventListener(type: string, listener: PageListener) {
        listeners.set(type, [...(listeners.get(type) ?? []), listener]);
      },
    },
    location: { href: file },
    fetch: () => Promise.resolve({ text: () => Promise.resolve(readFileSync(file, "utf8")) }),
    DOMParser: class {
      parseFromString(source: string) {
        const parsed = pageElements(source);
        return { getElementById: (id: string) => parsed.get(id) ?? null };
      }
    },
  });
  await settle();
  return {
    style: () => elements.get("text")?.getAttribute("style"),
    text: () => elements.get("text")?.textContent,
    emit: (detail) => dispatch("vignette-text", detail),
    resize: () => dispatch("resize"),
  };
}

describe("obsTarget", () => {
  it("converges a two-scene snapshot with a shared source, after reconnecting", async () => {
    const { obs, clock, target, phases, connections } = harness();
    obs.fail("connect", new Error("OBS is not running yet"));
    target.apply(setup());
    target.apply(update(1));

    await until(target, (status) => status.connection?.phase === "retry-wait");
    expect(target.status.phase).toBe("synchronising");
    expect(target.status.connection?.error?.message).toBe("OBS is not running yet");
    clock.advance(250);
    await until(target, converged(1));

    expect(phases).toEqual(["downloading-assets", "synchronising", "settled"]);
    expect(connections).toEqual(["connecting", "retry-wait", "connecting", "open"]);
    expect(names(obs)).toEqual([
      "vignette/show",
      "vignette/show/main",
      "vignette/show/brb",
      "vignette/show/bg",
      "vignette/show/chat",
      "vignette/show/main.logo",
    ]);
    expect(itemsOf(obs, "vignette/show/main")).toEqual([
      "vignette/show/bg",
      "vignette/show/chat",
      "vignette/show/main.logo",
    ]);
    expect(itemsOf(obs, "vignette/show/brb")).toEqual(["vignette/show/chat"]);
    // One shared input, placed in both scenes.
    expect(obs.inputs.filter((input) => input.inputKind === "browser_source")).toHaveLength(1);
    const file = z
      .string()
      .parse(obs.inputs.find((input) => input.inputKind === "image_source")?.inputSettings.file);
    expect(readFileSync(file, "utf8")).toBe("not really a png");

    // The image input OBS saved still finds its file after the target stops.
    await target.dispose();
    expect(readFileSync(file, "utf8")).toBe("not really a png");
  });

  it("settles a revision once OBS converges, and fails it when OBS invalidates the session", async () => {
    const { obs, clock, target } = harness();
    target.apply(setup());
    target.apply(update(1));
    await until(target, converged(1));
    await expect(target.settled(1)).resolves.toBeUndefined();
    expect(target.status.connection).toEqual({ phase: "open" });

    // Revision 2 executes, but OBS is busy when it is re-read, so it waits for a retry; then
    // OBS invalidates the session.
    obs.fail("GetVersion", new ObsRequestError("GetVersion", 207, "Not ready."));
    target.apply(update(2, { activeScene: "brb" }));
    const second = target.settled(2);
    await until(target, () => clock.pending === 1);
    const invalidated = Object.assign(new Error("Session invalidated."), { code: 4011 });
    obs.emit("ConnectionClosed", invalidated);

    await expect(second).rejects.toBe(invalidated);
    expect(target.status.phase).toBe("error");
    expect(target.status.connection).toEqual({ phase: "closed", error: invalidated });
    await target.dispose();
  });

  it("names the close code when OBS drops the connection without a reason", async () => {
    const { obs, target } = harness();
    target.apply(setup());
    target.apply(update(1));
    await until(target, converged(1));

    // What obs-websocket-js reports when OBS exits abruptly.
    obs.emit("ConnectionClosed", Object.assign(new Error(""), { code: 1006 }));
    await until(target, (status) => status.connection?.phase === "retry-wait");
    expect(target.status.connection?.error?.message).toBe("The OBS connection closed (code 1006).");
    await target.dispose();
  });

  it("lets OBS fit a cover itself, and says once when this OBS cannot", async () => {
    const cover = (id: string): Item => {
      const placed = item(id, "chat", 0);
      return { ...placed, placement: { ...placed.placement, fit: "cover" } };
    };
    const covered: Partial<Snapshot> = {
      sources: [chat],
      scenes: [{ id: "main", items: [cover("main.1")] }],
    };
    const transformOf = (obs: FakeObs) =>
      obs.scenes.find((scene) => scene.sceneName === "vignette/show/main")?.items[0]
        ?.sceneItemTransform;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const current = harness();
      current.target.apply(setup());
      current.target.apply(update(1, covered));
      await until(current.target, converged(1));
      expect(transformOf(current.obs)).toMatchObject({
        boundsType: "OBS_BOUNDS_SCALE_OUTER",
        cropToBounds: true,
      });
      expect(warn).not.toHaveBeenCalled();
      await current.target.dispose();

      const old = harness();
      old.obs.obsWebSocketVersion = "5.4.2";
      old.target.apply(setup());
      old.target.apply(update(1, covered));
      await until(old.target, converged(1));
      old.target.apply(update(2, covered));
      await until(old.target, converged(2));
      expect(transformOf(old.obs)).toMatchObject({ boundsType: "OBS_BOUNDS_STRETCH" });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[0]).toContain("cannot crop a scene item to its bounds");
      await old.target.dispose();
    } finally {
      warn.mockRestore();
    }
  });

  it("prunes scenes, items and inputs the snapshot no longer has", async () => {
    const { obs, target } = harness();
    target.apply(setup());
    target.apply(update(1));
    await until(target, converged(1));
    const operatorScene = obs.addScene("Operator scene");

    target.apply(
      update(2, { sources: [chat], scenes: [{ id: "main", items: [item("main.1", "chat", 0)] }] }),
    );
    await until(target, converged(2));

    expect(names(obs)).toEqual([
      "vignette/show",
      "vignette/show/main",
      "Operator scene",
      "vignette/show/chat",
    ]);
    expect(itemsOf(obs, "vignette/show/main")).toEqual(["vignette/show/chat"]);
    expect(obs.scenes).toContain(operatorScene);
    await target.dispose();
  });

  it("counts an input OBS frees while the target reads it as absent, without reconnecting", async () => {
    const { obs, target, connections } = harness();
    target.apply(setup());
    target.apply(update(1));
    await until(target, converged(1));

    // OBS frees an input a moment after its last scene item goes, so a GetInputList can still list
    // an input whose settings can no longer be read. List `bg` once more after it is gone.
    const bg = obs.inputs.find((input) => input.inputName === "vignette/show/bg");
    const call = obs.call.bind(obs);
    let vanished = false;
    obs.call = async (requestType, requestData) => {
      // Every request passes through; the first GetInputList after `bg` is freed still lists it.
      const response = await call(requestType, requestData);
      const gone = bg !== undefined && !obs.inputs.includes(bg);
      if (requestType !== "GetInputList" || vanished || !gone) return response;
      vanished = true;
      const listed = { inputName: bg.inputName, inputUuid: bg.inputUuid, inputKind: bg.inputKind };
      return {
        ...response,
        inputs: [...(Array.isArray(response.inputs) ? response.inputs : []), listed],
      };
    };
    target.apply(
      update(2, { sources: [chat], scenes: [{ id: "main", items: [item("main.1", "chat", 0)] }] }),
    );
    await until(target, converged(2));

    expect(vanished).toBe(true);
    expect(connections).toEqual(["connecting", "open"]);
    expect(itemsOf(obs, "vignette/show/main")).toEqual(["vignette/show/chat"]);
    await target.dispose();
  });

  it("sets the program scene when activeScene changes, and not again when the operator switches", async () => {
    const { obs, target } = harness();
    target.apply(setup());
    target.apply(update(1, { activeScene: "main" }));
    await until(target, converged(1));
    expect(obs.programSceneName).toBe("vignette/show/main");

    // The operator takes a different scene to air; OBS reports the change and the target re-reads.
    obs.programSceneName = "Operator scene";
    const reads = obs.calls("GetSceneList").length;
    obs.emit("SceneItemEnableStateChanged", {});
    await until(target, () => obs.calls("GetSceneList").length > reads);
    target.apply(update(2, { activeScene: "main" }));
    await until(target, converged(2));
    expect(obs.programSceneName).toBe("Operator scene");

    target.apply(update(3, { activeScene: "brb" }));
    await until(target, converged(3));
    expect(obs.programSceneName).toBe("vignette/show/brb");
    expect(obs.calls("SetCurrentProgramScene")).toHaveLength(2);
    await target.dispose();
  });

  it("reports a missing source plugin before any call to OBS", async () => {
    const { obs, target } = harness({ builtins: false });
    target.apply(setup());
    target.apply(update(1));

    await until(target, (status) => status.phase === "error");
    expect(target.status.error?.message).toContain('missing source plugin for kind "browser"');
    await expect(target.settled(1)).rejects.toThrow("missing source plugin");
    expect(obs.connections).toBe(0);
    expect(obs.requests).toEqual([]);
    await target.dispose();
  });

  it("fails only the sources whose input kind OBS lacks, and converges the rest", async () => {
    const { obs, target } = harness();
    obs.inputKinds = obs.inputKinds.filter((kind) => kind !== "browser_source");
    target.apply(setup());
    target.apply(update(1, { activeScene: "brb" }));

    await until(target, (status) => status.phase === "settled" && status.revision.settled === 1);
    expect(target.status.sources).toMatchObject({ bg: "live", chat: "error", "main.logo": "live" });
    expect(target.status.sourceErrors.chat?.message).toBe(
      "OBS has no input kind 'browser_source' for source 'chat'.",
    );
    expect(itemsOf(obs, "vignette/show/main")).toEqual([
      "vignette/show/bg",
      "vignette/show/main.logo",
    ]);
    expect(obs.programSceneName).toBe("vignette/show/brb");
    await target.dispose();
  });

  it("reloads frame pages once converged after the first sync and after each setup", async () => {
    const { obs, target } = harness({
      frames: (frame, id) => `https://show.example/f?${frame}&${id}`,
    });
    const clock: Source = {
      id: "clock",
      kind: "frame",
      props: { frame: "Clock", params: {} },
      size: { width: 640, height: 360 },
    };
    const withClock = (revision: number): StreamMessage =>
      update(revision, {
        sources: [bg, clock],
        scenes: [{ id: "main", items: [item("main.0", "bg", 0), item("main.1", "clock", 0)] }],
      });
    const reloads = () =>
      obs.calls("PressInputPropertiesButton").map((call) => call.requestData?.inputName);

    target.apply(setup("show"));
    target.apply(withClock(1));
    await until(target, converged(1));
    await until(target, () => reloads().length === 1);
    expect(reloads()).toEqual(["vignette/show/clock"]);

    target.apply(withClock(2));
    await until(target, converged(2));
    // A reconnecting stream replays its setup: the server may have been down meanwhile.
    target.apply(setup("show"));
    target.apply(withClock(3));
    await until(target, converged(3));
    await until(target, () => reloads().length === 2);
    await target.dispose();
  });

  it("points a frame's browser source at a new URL when its bundle build changes", async () => {
    const { obs, target } = harness();
    const clock = (build: string): Source => ({
      id: "clock",
      kind: "frame",
      props: { frame: "Clock", params: {}, build },
      size: { width: 640, height: 360 },
    });
    const withClock = (revision: number, build: string): StreamMessage =>
      update(revision, {
        sources: [bg, clock(build)],
        scenes: [{ id: "main", items: [item("main.0", "bg", 0), item("main.1", "clock", 0)] }],
      });
    const url = () => {
      const input = obs.inputs.find((entry) => entry.inputName === "vignette/show/clock");
      return new URL(z.string().parse(input?.inputSettings.url));
    };

    target.apply({
      ...setup(),
      serve: {
        stream: "https://show.example/stream",
        frames: "https://show.example/vignette/frames.html",
      },
    });
    target.apply(withClock(1, "sha256-one"));
    await until(target, converged(1));
    expect(url().searchParams.get("v")).toBe("sha256-one");
    expect(url().searchParams.get("frame")).toBe("Clock");

    target.apply(withClock(2, "sha256-two"));
    await until(target, converged(2));
    expect(url().searchParams.get("v")).toBe("sha256-two");
    // The same input, only its settings converged: nothing else is removed or recreated.
    expect(obs.calls("CreateInput")).toHaveLength(2);
    expect(obs.calls("RemoveInput")).toEqual([]);
    await target.dispose();
  });

  it("renders text as a lasting local page that re-reads its file, or is reloaded", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vignette-obs-test-"));
    const { obs, target } = harness({ dir });
    const title = (revision: number, text: string): StreamMessage =>
      update(revision, {
        sources: [
          {
            id: "title",
            kind: "text",
            props: { text, style: { fontSize: 64, color: "#ffffff", textWrap: "balance" } },
            size: { width: 640, height: 360 },
          },
        ],
        scenes: [{ id: "main", items: [item("main.0", "title", 0)] }],
      });
    const page = () => {
      const input = obs.inputs.find((entry) => entry.inputName === "vignette/show/title");
      expect(input?.inputKind).toBe("browser_source");
      expect(input?.inputSettings).toMatchObject({ is_local_file: true, width: 640, height: 360 });
      return z.string().parse(input?.inputSettings.local_file);
    };

    const reloads = () => obs.calls("PressInputPropertiesButton").length;

    target.apply(setup("show"));
    target.apply(title(1, "Fish & <chips>"));
    await until(target, converged(1));
    const first = page();
    expect(first.startsWith(join(dir, "sources"))).toBe(true);
    const html = readFileSync(first, "utf8");
    expect(html).toContain("Fish &amp; &lt;chips&gt;");
    expect(html).toContain("text-wrap: balance;");

    // A change rewrites the file and tells the open page to re-read it; the event has no state.
    const open = await openPage(first);
    target.apply(title(2, "Up next"));
    await until(target, converged(2));
    expect(page()).toBe(first);
    expect(readFileSync(first, "utf8")).toContain("Up next");
    const [told] = obs.calls("CallVendorRequest");
    expect(told?.requestData).toMatchObject({
      inputName: "vignette/show/title",
      vendorName: "obs-browser",
      requestType: "emit_event",
      requestData: { event_name: "vignette-text" },
    });
    expect(open.text()).toBe("Fish &amp; &lt;chips&gt;");
    await open.emit(RereadSchema.parse(rereadsOf(obs)[0]));
    expect(open.text()).toBe("Up next");

    // Without obs-browser's events, OBS reloads the same page, which has the change.
    await until(target, () => reloads() === 1);
    obs.fail("CallVendorRequest", new Error("No vendor."));
    target.apply(title(3, "Live"));
    await until(target, converged(3));
    expect(page()).toBe(first);
    expect(readFileSync(first, "utf8")).toContain("Live");
    expect(reloads()).toBe(2);

    // OBS saved the path in its scene collection, so the page outlives the target, and the
    // next run of the same show writes the same file.
    await target.dispose();
    expect(readFileSync(first, "utf8")).toContain("Live");
    const next = harness({ dir });
    next.target.apply(setup("show"));
    next.target.apply(title(1, "Again"));
    await until(next.target, converged(1));
    const input = next.obs.inputs.find((entry) => entry.inputName === "vignette/show/title");
    expect(input?.inputSettings.local_file).toBe(first);
    expect(readFileSync(first, "utf8")).toContain("Again");
    await next.target.dispose();
  });

  it("shows a text's new style after a resize without sending the page an event", async () => {
    const { obs, target } = harness();
    target.apply(setup("show"));
    target.apply(label(1, { width: 1216, height: 96 }, 52));
    await until(target, converged(1));
    const open = await openPage(pageFile(obs));
    expect(open.style()).toContain("font-size: 52px;");

    // The label moves to a smaller slot: a new size and a new style in one revision.
    target.apply(label(2, { width: 608, height: 48 }, 26));
    await until(target, converged(2));
    expect(pageInput(obs)?.inputSettings).toMatchObject({ width: 608, height: 48 });
    // Nothing touched the page before OBS resized it; the resize is what makes it re-read.
    expect(rereadsOf(obs)).toEqual([]);
    expect(open.style()).toContain("font-size: 52px;");
    await open.resize();
    expect(open.style()).toContain("font-size: 26px;");
    await target.dispose();
  });

  it("recovers a text page that missed its event, and ignores another page's", async () => {
    const { obs, target } = harness();
    const size = { width: 640, height: 360 };
    target.apply(setup("show"));
    target.apply(label(1, size, 48, "Camera 1"));
    await until(target, converged(1));
    const file = pageFile(obs);
    const open = await openPage(file);
    // OBS read this page's file before the change below, and runs its script only after it.
    const loading = readFileSync(file, "utf8");

    target.apply(label(2, size, 48, "Camera 2"));
    await until(target, converged(2));
    const events = rereadsOf(obs);
    expect(events).toHaveLength(1);

    // An event for some other text page leaves this one alone.
    await open.emit({ page: "another-page" });
    expect(open.text()).toBe("Camera 1");
    // The event never arrives: the page is stale only until its next resize.
    await open.resize();
    expect(open.text()).toBe("Camera 2");
    // The page that was loading heard no event either; it re-reads once it has loaded.
    const late = await openPage(file, loading);
    expect(late.text()).toBe("Camera 2");
    await target.dispose();
  });

  it("keeps a text page OBS already shows following its text after the setup changes", async () => {
    const { obs, target } = harness();
    target.apply(setup("show"));
    target.apply(label(1, { width: 1216, height: 96 }, 52));
    await until(target, converged(1));
    const file = pageFile(obs);
    const open = await openPage(file);

    // A restarted composer publishes another setup: the target starts over with new handles,
    // but OBS has the same input, on the same file, and so keeps the page it already shows.
    target.apply({ ...setup("show"), assets: { version: "v2", entries: [logo] } });
    target.apply(label(1, { width: 1216, height: 96 }, 52));
    await until(target, converged(1));
    expect(pageFile(obs)).toBe(file);
    expect(obs.calls("CreateInput")).toHaveLength(1);

    target.apply(label(2, { width: 608, height: 48 }, 26));
    await until(target, converged(2));
    await open.resize();
    expect(open.style()).toContain("font-size: 26px;");
    target.apply(label(3, { width: 608, height: 48 }, 26, "Camera 2"));
    await until(target, converged(3));
    await open.emit(RereadSchema.parse(rereadsOf(obs).at(-1)));
    expect(open.text()).toBe("Camera 2");
    await target.dispose();
  });

  it("refuses a stream for a different show without touching OBS", async () => {
    const { obs, target } = harness();
    target.apply(setup());
    target.apply(update(1));
    await until(target, converged(1));
    const before = obs.requests.length;

    target.apply(setup("other"));
    target.apply({
      kind: "update",
      snapshot: {
        ...snapshot(1, { sources: [bg], scenes: [{ id: "main", items: [] }] }),
        id: "other",
      },
    });
    await until(target, (status) => status.phase === "error");

    expect(target.status.error?.message).toContain("manages 'show'; refusing to touch OBS");
    expect(obs.requests.slice(before)).toEqual([]);
    expect(names(obs).some((name) => name.startsWith("vignette/other"))).toBe(false);
    await target.dispose();
  });

  it("converges audio channels, managed filters and pictureless sources, and leaves an operator's filter", async () => {
    const heard: Source = {
      ...chat,
      audio: AudioChannelSchema.parse({
        volumeDb: -6,
        balance: -1,
        mono: true,
        filters: [{ kind: "compressor", id: "comp", ratio: 4 }],
      }),
    };
    const bed: Source = {
      id: "bed",
      kind: "audio",
      props: { src: "logo.png", loop: true, restartOnShow: false },
      size: { width: 1920, height: 1080 },
      audio: AudioChannelSchema.parse({ volumeDb: -20 }),
    };
    const sound = (revision: number) =>
      update(revision, {
        sources: [bg, heard, bed],
        mix: { volumeDb: -2 },
        scenes: [
          {
            id: "main",
            items: [item("main.0", "bg", 0), item("main.1", "chat", 0)],
            audio: ["bed"],
          },
        ],
      });
    const { obs, target } = harness();
    target.apply(setup("show"));
    target.apply(sound(1));
    await until(target, converged(1));

    const input = (name: string) => obs.inputs.find((entry) => entry.inputName === name);
    const page = input("vignette/show/chat");
    expect(page?.inputSettings).toMatchObject({ reroute_audio: true });
    expect(page?.audio).toMatchObject({
      inputVolumeDb: -8,
      inputAudioBalance: 0,
      inputMuted: false,
    });
    expect(page?.filters).toEqual([
      {
        filterName: "vignette/show/comp",
        filterKind: "compressor_filter",
        filterSettings: {
          ratio: 4,
          threshold: -18,
          attack_time: 6,
          release_time: 60,
          output_gain: 0,
        },
      },
    ]);
    expect(input("vignette/show/bed")?.audio?.inputVolumeDb).toBe(-22);
    const main = obs.scenes.find((scene) => scene.sceneName === "vignette/show/main");
    const bedItem = main?.items.find((entry) => entry.sourceName === "vignette/show/bed");
    expect(bedItem).toMatchObject({
      sceneItemEnabled: true,
      sceneItemTransform: { positionX: -2 },
    });
    // obs-websocket cannot set an input's mono downmix.
    expect(target.status.audio).toEqual({
      state: "running",
      unsupported: { chat: ["mono"] },
      mix: [],
    });

    page?.filters.unshift({
      filterName: "Operator gate",
      filterKind: "noise_gate_filter",
      filterSettings: {},
    });
    const before = obs.requests.length;
    target.apply(sound(2));
    await until(target, converged(2));
    const writes = obs.requests
      .slice(before)
      .filter(({ requestType }) => /^(Set|Create|Remove)/u.test(requestType));
    expect(writes).toEqual([]);
    expect(page?.filters.map((filter) => filter.filterName)).toEqual([
      "Operator gate",
      "vignette/show/comp",
    ]);
    await target.dispose();
  });

  it("restarts a video on a media:restart event", async () => {
    const video: Source = {
      id: "intro",
      kind: "video",
      props: { src: "logo.png", loop: false, restartOnShow: false },
      size: { width: 1920, height: 1080 },
    };
    const { obs, target } = harness();
    target.apply(setup("show"));
    target.apply(
      update(1, {
        sources: [video],
        scenes: [{ id: "main", items: [item("main.0", "intro", 0)] }],
      }),
    );
    await until(target, converged(1));
    // A source without an audio channel has its input muted.
    expect(obs.inputs[0]?.audio?.inputMuted).toBe(true);

    target.apply({ kind: "event", event: { kind: "media:restart", sourceId: "intro" } });
    await until(target, () => obs.calls("TriggerMediaInputAction").length === 1);
    expect(obs.calls("TriggerMediaInputAction")[0]?.requestData).toEqual({
      inputName: "vignette/show/intro",
      mediaAction: "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART",
    });
    await target.dispose();
  });
});
