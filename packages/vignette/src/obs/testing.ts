/**
 * Test doubles for the OBS target: an in-memory OBS that answers the obs-websocket requests the
 * target uses, and a clock whose time only moves when a test says so. Pass them as `transport`
 * and `clock` to `obsTarget`.
 *
 * @module
 */
import { z } from "zod";

import { JsonObjectSchema, REQUIRED_OBS_REQUESTS } from "./bootstrap.js";
import { ObsRequestError } from "./errors.js";
import type { ObsJsonObject } from "./operations.js";
import type { ObsClock } from "./target.js";
import type {
  ObsBatchRequest,
  ObsBatchResponse,
  ObsConnectionInfo,
  ObsConnectOptions,
  ObsEventListener,
  ObsTransport,
} from "./transport.js";

/** One request the fake received. */
export interface FakeObsRequest {
  readonly requestType: string;
  readonly requestData?: ObsJsonObject;
}

/** A scene in the fake OBS; its items are in stacking order, bottom first. */
export interface FakeObsScene {
  readonly sceneName: string;
  readonly sceneUuid: string;
  items: FakeObsSceneItem[];
}

/** A scene item in the fake OBS. */
export interface FakeObsSceneItem {
  readonly sceneItemId: number;
  readonly sourceName: string;
  readonly sourceUuid: string;
  sceneItemEnabled: boolean;
  sceneItemTransform: ObsJsonObject;
}

/** An input in the fake OBS. `inputMuted` is undefined for inputs without audio. */
export interface FakeObsInput {
  readonly inputName: string;
  readonly inputUuid: string;
  readonly inputKind: string;
  inputSettings: ObsJsonObject;
  inputMuted?: boolean;
}

/** Input kinds the fake advertises unless a test changes them. */
const DEFAULT_INPUT_KINDS = ["color_source_v3", "image_source", "ffmpeg_source", "browser_source"];

/** Inputs of these kinds have audio, so they answer `GetInputMute`. */
const AUDIO_KINDS = new Set(["ffmpeg_source", "browser_source"]);

/**
 * An in-memory OBS behind the {@link ObsTransport} seam. It keeps scenes, inputs, items and the
 * program scene, applies the requests the OBS target sends, and records every request. Like OBS,
 * it frees an input once no scene item shows it. It emits no events by itself; call `emit` to
 * simulate one.
 */
export class FakeObs implements ObsTransport {
  readonly requests: FakeObsRequest[] = [];
  readonly scenes: FakeObsScene[] = [];
  readonly inputs: FakeObsInput[] = [];
  inputKinds: string[] = [...DEFAULT_INPUT_KINDS];
  availableRequests: string[] = [...REQUIRED_OBS_REQUESTS, "TriggerMediaInputAction"];
  programSceneName: string | undefined = undefined;
  connected = false;
  connections = 0;
  private readonly failures = new Map<string, Error[]>();
  private readonly listeners = new Map<string, Set<ObsEventListener>>();
  private nextId = 1;

  /** Makes the next `count` calls of `requestType` (or `connect`) fail with `error`. */
  fail(requestType: string, error: Error, count = 1): this {
    const queue = this.failures.get(requestType) ?? [];
    for (let index = 0; index < count; index += 1) queue.push(error);
    this.failures.set(requestType, queue);
    return this;
  }

  /** A scene an operator made, outside any show's namespace. */
  addScene(sceneName: string): FakeObsScene {
    const scene: FakeObsScene = { sceneName, sceneUuid: this.uuid("scene"), items: [] };
    this.scenes.push(scene);
    return scene;
  }

  /** Requests of one type, in order. */
  calls(requestType: string): readonly FakeObsRequest[] {
    return this.requests.filter((request) => request.requestType === requestType);
  }

  connect(options: ObsConnectOptions): Promise<ObsConnectionInfo> {
    const failure = this.failures.get("connect")?.shift();
    if (failure !== undefined) return Promise.reject(failure);
    this.connections += 1;
    this.connected = options.url !== "";
    return Promise.resolve({ obsWebSocketVersion: "5.fake", negotiatedRpcVersion: 1 });
  }

  disconnect(): Promise<void> {
    this.connected = false;
    return Promise.resolve();
  }

  call(requestType: string, requestData?: ObsJsonObject): Promise<ObsJsonObject> {
    try {
      return Promise.resolve(this.handle(requestType, requestData));
    } catch (cause) {
      return Promise.reject(cause instanceof Error ? cause : new Error(String(cause)));
    }
  }

  /** Runs each request in order and reports each outcome, as obs-websocket batches do. */
  async callBatch(requests: readonly ObsBatchRequest[]): Promise<readonly ObsBatchResponse[]> {
    const responses: ObsBatchResponse[] = [];
    for (const request of requests) {
      // Like OBS without `haltOnFailure`: every request runs, and failures become responses.
      try {
        const responseData = await this.call(request.requestType, request.requestData);
        responses.push({ requestType: request.requestType, ok: true, code: 100, responseData });
      } catch (cause) {
        // Request errors keep their OBS status code; anything else is a generic failure.
        const error = cause instanceof ObsRequestError ? cause : undefined;
        responses.push({
          requestType: request.requestType,
          ok: false,
          code: error?.code ?? 500,
          comment: cause instanceof Error ? cause.message : "Fake failure.",
        });
      }
    }
    return responses;
  }

  on(event: string, listener: ObsEventListener): () => void {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.listeners.set(event, listeners);
    return () => {
      listeners.delete(listener);
    };
  }

  /** Delivers an obs-websocket event; `ConnectionClosed` also drops the connection. */
  emit(event: string, payload?: ObsJsonObject | Error): void {
    if (event === "ConnectionClosed") this.connected = false;
    for (const listener of this.listeners.get(event) ?? []) listener(payload);
  }

  /** Records a request and applies it, throwing as OBS would answer with a failure. */
  private handle(requestType: string, data: ObsJsonObject = {}): ObsJsonObject {
    if (!this.connected) throw new Error("Fake OBS is not connected.");
    this.requests.push({ requestType, requestData: data });
    const failure = this.failures.get(requestType)?.shift();
    if (failure !== undefined) throw failure;
    return (
      this.readScenes(requestType, data) ??
      this.readInputs(requestType, data) ??
      this.writeResources(requestType, data) ??
      this.writeItem(requestType, data)
    );
  }

  /** Requests that read capabilities and scenes; undefined for any other request. */
  private readScenes(requestType: string, data: ObsJsonObject): ObsJsonObject | undefined {
    switch (requestType) {
      case "GetVersion":
        return { obsVersion: "31.0.0", availableRequests: this.availableRequests };
      case "GetInputKindList":
        return { inputKinds: this.inputKinds };
      case "GetSceneList":
        return {
          scenes: this.scenes.map((scene) => ({
            sceneName: scene.sceneName,
            sceneUuid: scene.sceneUuid,
          })),
        };
      case "GetCurrentProgramScene":
        return this.programSceneName === undefined
          ? {}
          : { currentProgramSceneName: this.programSceneName };
      case "GetSceneItemList":
        return {
          sceneItems: this.scene(data).items.map((item, index) => ({
            sceneItemId: item.sceneItemId,
            sceneItemIndex: index,
            sourceName: item.sourceName,
            sourceUuid: item.sourceUuid,
            sceneItemEnabled: item.sceneItemEnabled,
            sceneItemTransform: item.sceneItemTransform,
          })),
        };
      default:
        return undefined;
    }
  }

  /** Requests that read inputs; undefined for any other request. */
  private readInputs(requestType: string, data: ObsJsonObject): ObsJsonObject | undefined {
    switch (requestType) {
      case "GetInputList":
        return {
          inputs: this.inputs.map((input) => ({
            inputName: input.inputName,
            inputUuid: input.inputUuid,
            inputKind: input.inputKind,
          })),
        };
      case "GetInputSettings": {
        const input = this.input(data);
        return { inputKind: input.inputKind, inputSettings: input.inputSettings };
      }
      case "GetInputMute": {
        const muted = this.input(data).inputMuted;
        if (muted === undefined) throw new ObsRequestError(requestType, 604, "No audio.");
        return { inputMuted: muted };
      }
      default:
        return undefined;
    }
  }

  /** Requests that create or remove scenes and inputs; undefined for any other request. */
  private writeResources(requestType: string, data: ObsJsonObject): ObsJsonObject | undefined {
    switch (requestType) {
      case "CreateScene":
        return { sceneUuid: this.createScene(text(data, "sceneName")) };
      case "RemoveScene":
        this.removeScene(this.scene(data));
        return {};
      case "CreateInput":
        return this.createInput(data);
      case "RemoveInput":
        this.removeSource(this.inputs, this.input(data));
        return {};
      default:
        return this.writeInput(requestType, data);
    }
  }

  /** Requests that change an input or the program scene; undefined for any other request. */
  private writeInput(requestType: string, data: ObsJsonObject): ObsJsonObject | undefined {
    switch (requestType) {
      case "SetInputSettings":
        this.input(data).inputSettings = object(data, "inputSettings");
        return {};
      case "SetInputMute":
        this.input(data).inputMuted = flag(data, "inputMuted");
        return {};
      case "SetCurrentProgramScene":
        this.programSceneName = this.scene(data).sceneName;
        return {};
      case "TriggerMediaInputAction":
      case "PressInputPropertiesButton":
        this.input(data);
        return {};
      // A vendor request about an input, such as obs-browser's `emit_event` for a text page.
      case "CallVendorRequest":
        this.input(data);
        return { vendorName: data.vendorName ?? null, requestType: data.requestType ?? null };
      default:
        return undefined;
    }
  }

  private removeScene(scene: FakeObsScene): void {
    this.removeSource(this.scenes, scene);
    if (this.programSceneName === scene.sceneName) this.programSceneName = undefined;
    this.freeUnplacedInputs();
  }

  /** OBS frees an input when the last scene item showing it goes, as scene items own inputs. */
  private freeUnplacedInputs(): void {
    const placed = new Set(
      this.scenes.flatMap((scene) => scene.items.map((item) => item.sourceUuid)),
    );
    for (const input of this.inputs.filter((candidate) => !placed.has(candidate.inputUuid))) {
      remove(this.inputs, input);
    }
  }

  /** Removes a scene or input and every item that shows it. */
  private removeSource<T extends FakeObsScene | FakeObsInput>(list: T[], resource: T): void {
    remove(list, resource);
    const uuid = "sceneUuid" in resource ? resource.sceneUuid : resource.inputUuid;
    for (const scene of this.scenes) {
      scene.items = scene.items.filter((item) => item.sourceUuid !== uuid);
    }
  }

  /** Requests that change scene items. */
  private writeItem(requestType: string, data: ObsJsonObject): ObsJsonObject {
    const scene = this.scene(data);
    switch (requestType) {
      case "CreateSceneItem": {
        const source = this.source(text(data, "sourceName"));
        return { sceneItemId: this.place(scene, source, flag(data, "sceneItemEnabled")) };
      }
      case "RemoveSceneItem":
        remove(scene.items, this.item(scene, data));
        this.freeUnplacedInputs();
        return {};
      case "SetSceneItemTransform": {
        const item = this.item(scene, data);
        item.sceneItemTransform = {
          ...item.sceneItemTransform,
          ...object(data, "sceneItemTransform"),
        };
        return {};
      }
      case "SetSceneItemIndex": {
        const item = this.item(scene, data);
        remove(scene.items, item);
        scene.items.splice(count(data, "sceneItemIndex"), 0, item);
        return {};
      }
      case "SetSceneItemEnabled":
        this.item(scene, data).sceneItemEnabled = flag(data, "sceneItemEnabled");
        return {};
      default:
        throw new ObsRequestError(requestType, 204, "Unknown request type.");
    }
  }

  private createScene(sceneName: string): string {
    if (this.taken(sceneName)) throw new ObsRequestError("CreateScene", 601, "Name taken.");
    const scene: FakeObsScene = { sceneName, sceneUuid: this.uuid("scene"), items: [] };
    this.scenes.push(scene);
    return scene.sceneUuid;
  }

  private createInput(data: ObsJsonObject): ObsJsonObject {
    const inputName = text(data, "inputName");
    const inputKind = text(data, "inputKind");
    if (this.taken(inputName)) throw new ObsRequestError("CreateInput", 601, "Name taken.");
    if (!this.inputKinds.includes(inputKind)) {
      throw new ObsRequestError("CreateInput", 605, `Unknown input kind '${inputKind}'.`);
    }
    const input: FakeObsInput = {
      inputName,
      inputUuid: this.uuid("input"),
      inputKind,
      inputSettings: object(data, "inputSettings"),
      inputMuted: AUDIO_KINDS.has(inputKind) ? false : undefined,
    };
    this.inputs.push(input);
    const source: FakeSource = { name: inputName, uuid: input.inputUuid };
    const sceneItemId = this.place(this.scene(data), source, flag(data, "sceneItemEnabled"));
    return { inputUuid: input.inputUuid, sceneItemId };
  }

  private place(scene: FakeObsScene, source: FakeSource, enabled: boolean): number {
    const sceneItemId = this.nextId++;
    scene.items.push({
      sceneItemId,
      sourceName: source.name,
      sourceUuid: source.uuid,
      sceneItemEnabled: enabled,
      sceneItemTransform: {},
    });
    return sceneItemId;
  }

  private taken(name: string): boolean {
    return (
      this.scenes.some((scene) => scene.sceneName === name) ||
      this.inputs.some((input) => input.inputName === name)
    );
  }

  private scene(data: ObsJsonObject): FakeObsScene {
    const scene = this.scenes.find(
      (candidate) =>
        candidate.sceneUuid === data.sceneUuid || candidate.sceneName === data.sceneName,
    );
    if (scene === undefined) throw new ObsRequestError("scene", 600, "No such scene.");
    return scene;
  }

  private input(data: ObsJsonObject): FakeObsInput {
    const input = this.inputs.find(
      (candidate) =>
        candidate.inputUuid === data.inputUuid || candidate.inputName === data.inputName,
    );
    if (input === undefined) throw new ObsRequestError("input", 600, "No such input.");
    return input;
  }

  private source(name: string): FakeSource {
    const input = this.inputs.find((candidate) => candidate.inputName === name);
    if (input !== undefined) return { name, uuid: input.inputUuid };
    const scene = this.scenes.find((candidate) => candidate.sceneName === name);
    if (scene !== undefined) return { name, uuid: scene.sceneUuid };
    throw new ObsRequestError("source", 600, "No such source.");
  }

  private item(scene: FakeObsScene, data: ObsJsonObject): FakeObsSceneItem {
    const id = count(data, "sceneItemId");
    const item = scene.items.find((candidate) => candidate.sceneItemId === id);
    if (item === undefined) throw new ObsRequestError("item", 600, "No such scene item.");
    return item;
  }

  private uuid(kind: string): string {
    return `${kind}-${String(this.nextId++)}`;
  }
}

/** A scene or input as something a scene item can show. */
interface FakeSource {
  readonly name: string;
  readonly uuid: string;
}

/**
 * A clock whose time moves only through `advance`. `random` is 0.5, so backoff delays carry no
 * jitter and tests can name them exactly.
 */
export class ManualClock implements ObsClock {
  now = 0;
  private tasks: ManualClockTask[] = [];

  /** Timers not yet fired. */
  get pending(): number {
    return this.tasks.length;
  }

  schedule(delayMs: number, callback: () => void): () => void {
    const task: ManualClockTask = { at: this.now + delayMs, callback };
    this.tasks.push(task);
    return () => {
      this.tasks = this.tasks.filter((candidate) => candidate !== task);
    };
  }

  random(): number {
    return 0.5;
  }

  /** Moves time forward, firing due timers in order. */
  advance(durationMs: number): void {
    const end = this.now + durationMs;
    for (;;) {
      const next = [...this.tasks].sort((left, right) => left.at - right.at)[0];
      if (next === undefined || next.at > end) break;
      this.tasks = this.tasks.filter((candidate) => candidate !== next);
      this.now = next.at;
      next.callback();
    }
    this.now = end;
  }
}

/** A timer of the manual clock. */
interface ManualClockTask {
  readonly at: number;
  readonly callback: () => void;
}

function remove<T>(values: T[], value: T): void {
  const index = values.indexOf(value);
  if (index >= 0) values.splice(index, 1);
}

function text(data: ObsJsonObject, key: string): string {
  const parsed = z.string().safeParse(data[key]);
  if (!parsed.success) throw new ObsRequestError(key, 300, `Missing string '${key}'.`);
  return parsed.data;
}

function count(data: ObsJsonObject, key: string): number {
  const parsed = z.number().safeParse(data[key]);
  if (!parsed.success) throw new ObsRequestError(key, 300, `Missing number '${key}'.`);
  return parsed.data;
}

function flag(data: ObsJsonObject, key: string): boolean {
  return data[key] === true;
}

function object(data: ObsJsonObject, key: string): ObsJsonObject {
  return JsonObjectSchema.safeParse(data[key]).data ?? {};
}
