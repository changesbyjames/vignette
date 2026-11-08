import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import type { AssetEntry } from "../core/assets.js";
import type { Item, Snapshot, Source } from "../core/snapshot.js";
import type { SetupMessage, StreamMessage } from "../stream/messages.js";
import type { Target } from "../target/kernel.js";
import type { TargetStatus } from "../target/status.js";
import { ObsRequestError } from "./errors.js";
import { obsTarget, type ObsTargetOptions } from "./target.js";
import { FakeObs, ManualClock, type FakeObsRequest } from "./testing.js";

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
function label(revision: number, size: Source["size"], fontSize: number): StreamMessage {
  const title: Source = {
    id: "title",
    kind: "text",
    props: { text: "Camera 1", style: { fontSize, color: "#ffffff" } },
    size,
  };
  return update(revision, {
    sources: [title],
    scenes: [{ id: "main", items: [item("main.0", "title", 0)] }],
  });
}

/** The parts of a text page state these tests read. */
const PageStateSchema = z.looseObject({ seq: z.number(), style: z.string() });
type PageState = z.output<typeof PageStateSchema>;

/** The page states pushed through obs-browser `emit_event` among `requests`, in order. */
function pushesOf(requests: readonly FakeObsRequest[]): readonly PageState[] {
  return requests.flatMap((request) => {
    if (request.requestType !== "CallVendorRequest") return [];
    const data = z.object({ event_data: PageStateSchema }).parse(request.requestData?.requestData);
    return [data.event_data];
  });
}

/** The text page's file, as OBS would load it. */
function pageFile(obs: FakeObs): string {
  const input = obs.inputs.find((entry) => entry.inputName === "vignette/show/title");
  return z.string().parse(input?.inputSettings.local_file);
}

/** An element's inline style, as a text page's script sets it. */
interface PageStyle {
  cssText: string;
}

/** A page element the text page's script touches. */
interface PageElement {
  textContent: string;
  readonly style: PageStyle;
}

/** An event a text page's script listens for; only `vignette-text` carries a state. */
interface PageEvent {
  readonly detail?: PageState;
}

type PageListener = (event: PageEvent) => void;

/** The elements with an `id` in `html`, with their raw text content and `style` attribute. */
function pageElements(html: string): Map<string, PageElement> {
  const elements = new Map<string, PageElement>();
  for (const match of html.matchAll(/<(\w+)([^>]*)>([^<]*)/gu)) {
    // Each opening tag, its attributes, and the text up to the next tag: enough for the page's
    // own elements, none of which holds another element before its text. Tags without an `id`
    // are skipped; a missing group or `style` reads as empty.
    const attributes = match[2] ?? "";
    const id = /\bid="([^"]*)"/u.exec(attributes)?.[1];
    if (id === undefined) continue;
    const cssText = /\bstyle="([^"]*)"/u.exec(attributes)?.[1] ?? "";
    elements.set(id, { textContent: match[3] ?? "", style: { cssText } });
  }
  return elements;
}

/** A text page as obs-browser shows it, open on its file. */
interface OpenPage {
  /** The text's CSS as the page shows it now. */
  style(): string | undefined;
  /** Delivers an `emit_event`; resolves once the page has handled it. */
  push(state: PageState): Promise<void>;
  /** Fires the window's `resize`; resolves once the page has re-read its file. */
  resize(): Promise<void>;
}

/**
 * Runs the script of the text page in `file` against the elements it touches. Its `fetch` of
 * itself reads the file as it is at that moment.
 */
async function openPage(file: string): Promise<OpenPage> {
  const html = readFileSync(file, "utf8");
  const elements = pageElements(html);
  const listeners = new Map<string, PageListener[]>();
  const script = z.string().parse(/<script>([\s\S]*?)<\/script>/u.exec(html)?.[1]);
  const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
  const dispatch = (type: string, detail?: PageState) => {
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
    style: () => elements.get("text")?.style.cssText,
    push: (state) => dispatch("vignette-text", state),
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

  it("renders text as a lasting local page, pushing changes into it or reloading it", async () => {
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

    // A change goes into the open page; the file is rewritten for a later fresh load.
    target.apply(title(2, "Up next"));
    await until(target, converged(2));
    expect(page()).toBe(first);
    expect(readFileSync(first, "utf8")).toContain("Up next");
    const [pushed] = obs.calls("CallVendorRequest");
    expect(pushed?.requestData).toMatchObject({
      inputName: "vignette/show/title",
      vendorName: "obs-browser",
      requestType: "emit_event",
      requestData: { event_name: "vignette-text", event_data: { text: "Up next" } },
    });

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

  it("writes and pushes a resized text's new style, which the page re-reads if the push is lost", async () => {
    const { obs, target } = harness();
    target.apply(setup("show"));
    target.apply(label(1, { width: 1216, height: 96 }, 52));
    await until(target, converged(1));
    const page = await openPage(pageFile(obs));
    expect(page.style()).toContain("font-size: 52px");
    const before = obs.requests.length;

    // The label moves to a smaller slot: a resize and a style change in one update.
    target.apply(label(2, { width: 608, height: 48 }, 26));
    await until(target, converged(2));
    const after = obs.requests.slice(before);
    const resized = after.some(
      (request) =>
        request.requestType === "SetInputSettings" &&
        z.looseObject({ width: z.number() }).safeParse(request.requestData?.inputSettings).data
          ?.width === 608,
    );
    expect(resized).toBe(true);
    const pushes = pushesOf(after);
    expect(pushes).toHaveLength(1);
    expect(pushes[0]?.style).toContain("font-size: 26px");

    // obs-browser dropped the push mid-resize; the resize makes the page re-read its file.
    expect(page.style()).toContain("font-size: 52px");
    await page.resize();
    expect(page.style()).toContain("font-size: 26px");
    expect(target.status.sourceErrors).toEqual({});
    await target.dispose();
  });

  it("keeps a text page on the newest state when an older one arrives late", async () => {
    const { obs, target } = harness();
    target.apply(setup("show"));
    target.apply(label(1, { width: 1216, height: 96 }, 52));
    await until(target, converged(1));
    const page = await openPage(pageFile(obs));

    target.apply(label(2, { width: 608, height: 48 }, 26));
    await until(target, converged(2));
    target.apply(label(3, { width: 1216, height: 96 }, 40));
    await until(target, converged(3));
    const [older, newer] = pushesOf(obs.requests);
    expect(older?.style).toContain("font-size: 26px");
    expect(newer?.style).toContain("font-size: 40px");

    await page.push(PageStateSchema.parse(newer));
    expect(page.style()).toContain("font-size: 40px");
    await page.push(PageStateSchema.parse(older));
    expect(page.style()).toContain("font-size: 40px");
    // The file holds the newest state too, so a re-read keeps it.
    await page.resize();
    expect(page.style()).toContain("font-size: 40px");
    await target.dispose();
  });

  it("keeps a text source live when OBS refuses both its push and its reload", async () => {
    const { obs, target } = harness();
    target.apply(setup("show"));
    target.apply(label(1, { width: 1216, height: 96 }, 52));
    await until(target, converged(1));
    // The reload every setup asks for, out of the way first.
    const reloads = () => obs.calls("PressInputPropertiesButton").length;
    await until(target, () => reloads() === 1);

    obs.fail("CallVendorRequest", new Error("No vendor."));
    obs.fail("PressInputPropertiesButton", new Error("No button."));
    target.apply(label(2, { width: 608, height: 48 }, 26));
    await until(target, converged(2));
    expect(target.status.sourceErrors).toEqual({});
    expect(reloads()).toBe(2);
    // The file has the new state, for the page's next load or resize.
    const page = await openPage(pageFile(obs));
    expect(page.style()).toContain("font-size: 26px");
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

  it("restarts a video on a media:restart event", async () => {
    const video: Source = {
      id: "intro",
      kind: "video",
      props: { src: "logo.png", loop: false, muted: true, restartOnShow: false },
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
    expect(obs.inputs[0]?.inputMuted).toBe(true);

    target.apply({ kind: "event", event: { kind: "media:restart", sourceId: "intro" } });
    await until(target, () => obs.calls("TriggerMediaInputAction").length === 1);
    expect(obs.calls("TriggerMediaInputAction")[0]?.requestData).toEqual({
      inputName: "vignette/show/intro",
      mediaAction: "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART",
    });
    await target.dispose();
  });
});
