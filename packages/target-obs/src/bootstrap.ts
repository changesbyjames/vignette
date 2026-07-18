import type { ProjectId } from "@strangecyan/vignette-core";

import { parseManagedName } from "./naming.js";
import type {
  ObservedObsInput,
  ObservedObsScene,
  ObservedObsSceneItem,
  ObservedObsState,
} from "./observed-state.js";
import type { ObsJsonObject, ObsSceneItemTransform } from "./operations.js";
import type { ObsTransport } from "./transport.js";

export async function bootstrapObsState(
  transport: ObsTransport,
  projectId: ProjectId,
  observationEpoch: number,
): Promise<ObservedObsState> {
  const [version, kinds, sceneList, inputList] = await Promise.all([
    transport.call("GetVersion"),
    transport.call("GetInputKindList", { unversioned: false }),
    transport.call("GetSceneList"),
    transport.call("GetInputList"),
  ]);

  const scenes = readArray(sceneList, "scenes").map(normalizeScene);
  const inputHeaders = readArray(inputList, "inputs").map(asRecord);
  const managedInputs = inputHeaders.filter((input) => {
    const name = readString(input, "inputName");
    const parsed = parseManagedName(name);
    return parsed?.kind === "source" && parsed.projectId === projectId;
  });
  const inputs = await Promise.all(
    managedInputs.map(async (input): Promise<ObservedObsInput> => {
      const inputName = readString(input, "inputName");
      const settings = await transport.call("GetInputSettings", { inputName });
      return {
        inputName,
        inputUuid: readString(input, "inputUuid"),
        inputKind: readString(settings, "inputKind"),
        inputSettings: readObject(settings, "inputSettings"),
      };
    }),
  );

  const managedScenes = scenes.filter((scene) => {
    const parsed = parseManagedName(scene.sceneName);
    return parsed?.projectId === projectId;
  });
  const itemLists = await Promise.all(
    managedScenes.map(async (scene) => {
      const response = await transport.call("GetSceneItemList", { sceneUuid: scene.sceneUuid });
      return readArray(response, "sceneItems").map((item) => normalizeItem(scene.sceneUuid, item));
    }),
  );

  return {
    observationEpoch,
    capabilities: {
      obsVersion: readString(version, "obsVersion"),
      obsWebSocketVersion: readString(version, "obsWebSocketVersion"),
      rpcVersion: readNumber(version, "rpcVersion"),
      availableRequests: readStringArray(version, "availableRequests"),
      inputKinds: readStringArray(kinds, "inputKinds"),
      platform: readString(version, "platform"),
    },
    scenes,
    inputs,
    sceneItems: itemLists.flat(),
  };
}

function normalizeScene(value: unknown): ObservedObsScene {
  const scene = asRecord(value);
  return {
    sceneName: readString(scene, "sceneName"),
    sceneUuid: readString(scene, "sceneUuid"),
    sceneIndex: readNumber(scene, "sceneIndex"),
    ...(typeof scene.canvasUuid === "string" ? { canvasUuid: scene.canvasUuid } : {}),
  };
}

function normalizeItem(sceneUuid: string, value: unknown): ObservedObsSceneItem {
  const item = asRecord(value);
  const transform = item.sceneItemTransform;
  return {
    sceneUuid,
    sceneItemId: readNumber(item, "sceneItemId"),
    sceneItemIndex: readNumber(item, "sceneItemIndex"),
    sourceName: readString(item, "sourceName"),
    sourceUuid: readString(item, "sourceUuid"),
    sceneItemEnabled: readBoolean(item, "sceneItemEnabled"),
    ...(typeof transform === "object" && transform !== null
      ? { sceneItemTransform: transform as ObsSceneItemTransform }
      : {}),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) throw new Error("Malformed OBS response.");
  return value as Record<string, unknown>;
}

function readObject(value: ObsJsonObject, key: string): ObsJsonObject {
  return asRecord(value[key]) as ObsJsonObject;
}

function readArray(value: ObsJsonObject, key: string): readonly unknown[] {
  const result = value[key];
  if (!Array.isArray(result)) throw new Error(`OBS response is missing array '${key}'.`);
  return result;
}

function readStringArray(value: ObsJsonObject, key: string): string[] {
  const values = readArray(value, key);
  if (!values.every((item) => typeof item === "string")) {
    throw new Error(`OBS response array '${key}' contains a non-string value.`);
  }
  return values as string[];
}

function readString(value: Record<string, unknown> | ObsJsonObject, key: string): string {
  const result = value[key];
  if (typeof result !== "string") throw new Error(`OBS response is missing string '${key}'.`);
  return result;
}

function readNumber(value: Record<string, unknown> | ObsJsonObject, key: string): number {
  const result = value[key];
  if (typeof result !== "number") throw new Error(`OBS response is missing number '${key}'.`);
  return result;
}

function readBoolean(value: Record<string, unknown>, key: string): boolean {
  const result = value[key];
  if (typeof result !== "boolean") throw new Error(`OBS response is missing boolean '${key}'.`);
  return result;
}
