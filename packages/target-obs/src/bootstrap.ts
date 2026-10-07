import { z } from "zod";
import { ObsWireObjectSchema, ObsWireTransformSchema } from "./wire-schemas.js";
import { omitUndefined } from "@strangecyan/vignette-core";
import type { ProjectId } from "@strangecyan/vignette-core";

import { parseManagedName } from "./naming.js";
import type {
  ObservedObsInput,
  ObservedObsScene,
  ObservedObsSceneItem,
  ObservedObsState,
} from "./observed-state.js";
import type { ObsJsonObject, ObsJsonValue } from "./operations.js";
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

function normalizeScene(value: ObsJsonValue | undefined): ObservedObsScene {
  const scene = asRecord(value);
  return {
    sceneName: readString(scene, "sceneName"),
    sceneUuid: readString(scene, "sceneUuid"),
    sceneIndex: readNumber(scene, "sceneIndex"),
    ...omitUndefined({
      canvasUuid: z.string().safeParse(scene.canvasUuid).data,
    }),
  };
}

function normalizeItem(sceneUuid: string, value: ObsJsonValue | undefined): ObservedObsSceneItem {
  const item = asRecord(value);
  const transform = item.sceneItemTransform;
  return {
    sceneUuid,
    sceneItemId: readNumber(item, "sceneItemId"),
    sceneItemIndex: readNumber(item, "sceneItemIndex"),
    sourceName: readString(item, "sourceName"),
    sourceUuid: readString(item, "sourceUuid"),
    sceneItemEnabled: readBoolean(item, "sceneItemEnabled"),
    ...omitUndefined({
      sceneItemTransform: ObsWireTransformSchema.safeParse(transform).data,
    }),
  };
}

function asRecord(value: ObsJsonValue | undefined): ObsJsonObject {
  const parsed = ObsWireObjectSchema.safeParse(value);
  if (!parsed.success) throw new Error("Malformed OBS response.");
  return parsed.data;
}

function readObject(value: ObsJsonObject, key: string): ObsJsonObject {
  return asRecord(value[key]);
}

function readArray(value: ObsJsonObject, key: string): readonly ObsJsonValue[] {
  const parsed = z.array(z.json()).safeParse(value[key]);
  if (!parsed.success) throw new Error(`OBS response is missing array '${key}'.`);
  return parsed.data;
}

function readStringArray(value: ObsJsonObject, key: string): string[] {
  const parsed = z.array(z.string()).safeParse(readArray(value, key));
  if (!parsed.success) throw new Error(`OBS response array '${key}' contains a non-string value.`);
  return parsed.data;
}

function readString(value: ObsJsonObject, key: string): string {
  const parsed = z.string().safeParse(value[key]);
  if (!parsed.success) throw new Error(`OBS response is missing string '${key}'.`);
  return parsed.data;
}

function readNumber(value: ObsJsonObject, key: string): number {
  const parsed = z.number().safeParse(value[key]);
  if (!parsed.success) throw new Error(`OBS response is missing number '${key}'.`);
  return parsed.data;
}

function readBoolean(value: ObsJsonObject, key: string): boolean {
  const parsed = z.boolean().safeParse(value[key]);
  if (!parsed.success) throw new Error(`OBS response is missing boolean '${key}'.`);
  return parsed.data;
}
