import { z } from "zod";

import { ObsRequestError, readObsErrorCode, RESOURCE_NOT_FOUND } from "./errors.js";
import { parseManagedName } from "./naming.js";
import type {
  ObservedObsInput,
  ObservedObsScene,
  ObservedObsSceneItem,
  ObservedObsState,
} from "./observed-state.js";
import type { ObsJsonObject } from "./operations.js";
import type { ObsBatchResponse, ObsTransport } from "./transport.js";

/** obs-websocket requests convergence needs; an OBS missing one is a planning problem. */
export const REQUIRED_OBS_REQUESTS: readonly string[] = [
  "GetVersion",
  "GetInputKindList",
  "GetSceneList",
  "GetCurrentProgramScene",
  "GetInputList",
  "GetInputSettings",
  "GetInputMute",
  "GetSceneItemList",
  "CreateScene",
  "RemoveScene",
  "CreateInput",
  "RemoveInput",
  "SetInputSettings",
  "SetInputMute",
  "CreateSceneItem",
  "RemoveSceneItem",
  "SetSceneItemTransform",
  "SetSceneItemIndex",
  "SetSceneItemEnabled",
  "SetCurrentProgramScene",
];

/** A JSON object decoded at the obs-websocket boundary. */
export const JsonObjectSchema = z.record(z.string(), z.json());
/** A JSON object decoded at the obs-websocket boundary. */
export type JsonObject = z.output<typeof JsonObjectSchema>;

/** The transform fields convergence compares; OBS sends more, which are kept. */
const TransformSchema = z
  .object({
    positionX: z.number(),
    positionY: z.number(),
    rotation: z.number(),
    alignment: z.number(),
    boundsType: z.string(),
    boundsAlignment: z.number(),
    boundsWidth: z.number(),
    boundsHeight: z.number(),
    cropTop: z.number(),
    cropRight: z.number(),
    cropBottom: z.number(),
    cropLeft: z.number(),
  })
  .catchall(z.json());
/** The transform fields convergence compares. */
type Transform = z.output<typeof TransformSchema>;

const VersionSchema = z.object({ availableRequests: z.array(z.string()) });
/** The part of `GetVersion` convergence reads. */
type Version = z.output<typeof VersionSchema>;

const InputKindsSchema = z.object({ inputKinds: z.array(z.string()) });
/** `GetInputKindList`. */
type InputKinds = z.output<typeof InputKindsSchema>;

const SceneListSchema = z.object({
  scenes: z.array(z.object({ sceneName: z.string(), sceneUuid: z.string() })),
});
/** `GetSceneList`. */
type SceneList = z.output<typeof SceneListSchema>;

const ProgramSceneSchema = z.object({ currentProgramSceneName: z.string().optional() });
/** `GetCurrentProgramScene`. */
type ProgramScene = z.output<typeof ProgramSceneSchema>;

const InputListSchema = z.object({
  inputs: z.array(z.object({ inputName: z.string(), inputUuid: z.string() })),
});
/** `GetInputList`. */
type InputList = z.output<typeof InputListSchema>;

const InputSettingsSchema = z.object({ inputKind: z.string(), inputSettings: JsonObjectSchema });
/** `GetInputSettings`. */
type InputSettings = z.output<typeof InputSettingsSchema>;

const InputMuteSchema = z.object({ inputMuted: z.boolean() });
/** `GetInputMute`. */
type InputMute = z.output<typeof InputMuteSchema>;

const SceneItemListSchema = z.object({
  sceneItems: z.array(
    z.object({
      sceneItemId: z.number(),
      sceneItemIndex: z.number(),
      sourceName: z.string(),
      sourceUuid: z.string(),
      sceneItemEnabled: z.boolean(),
      sceneItemTransform: z.json().optional(),
    }),
  ),
});
/** `GetSceneItemList`. */
type SceneItemList = z.output<typeof SceneItemListSchema>;

/**
 * Reads everything the planner needs about one show from OBS: capabilities, scenes, the program
 * scene, the show's inputs with their settings and mute state, and the items of its scenes.
 * Resources outside `vignette/<show>` are listed by name only and never read further.
 */
export async function bootstrapObsState(
  transport: ObsTransport,
  show: string,
): Promise<ObservedObsState> {
  const [version, kinds, sceneList, program, inputList]: [
    Version,
    InputKinds,
    SceneList,
    ProgramScene,
    InputList,
  ] = await Promise.all([
    read(transport, "GetVersion", VersionSchema),
    read(transport, "GetInputKindList", InputKindsSchema, { unversioned: false }),
    read(transport, "GetSceneList", SceneListSchema),
    read(transport, "GetCurrentProgramScene", ProgramSceneSchema),
    read(transport, "GetInputList", InputListSchema),
  ]);
  const scenes: readonly ObservedObsScene[] = sceneList.scenes;
  const managedInputs = inputList.inputs.filter(
    (input) => parseManagedName(input.inputName, show)?.id !== undefined,
  );
  const managedScenes = scenes.filter(
    (scene) => parseManagedName(scene.sceneName, show) !== undefined,
  );
  const [inputs, itemLists] = await Promise.all([
    Promise.all(managedInputs.map(async (input) => readInput(transport, input))),
    Promise.all(
      managedScenes.map(async (scene) => {
        const list: SceneItemList | undefined = await unlessGone(
          read(transport, "GetSceneItemList", SceneItemListSchema, { sceneUuid: scene.sceneUuid }),
        );
        return (list?.sceneItems ?? []).map((item) => sceneItem(scene.sceneUuid, item));
      }),
    ),
  ]);
  const available = new Set(version.availableRequests);
  return {
    show,
    inputKinds: kinds.inputKinds,
    missingRequests: REQUIRED_OBS_REQUESTS.filter((request) => !available.has(request)),
    programSceneName: program.currentProgramSceneName,
    scenes,
    // An input OBS freed after listing it is absent, as the next observation will show.
    inputs: inputs.filter((input) => input !== undefined),
    sceneItems: itemLists.flat(),
  };
}

/**
 * Settings and mute state in one batch; inputs without audio fail `GetInputMute`, which is fine.
 * `undefined` when OBS freed the input after listing it.
 */
async function readInput(
  transport: ObsTransport,
  input: InputList["inputs"][number],
): Promise<ObservedObsInput | undefined> {
  const [settingsResponse, muteResponse] = await transport.callBatch([
    { requestType: "GetInputSettings", requestData: { inputUuid: input.inputUuid } },
    { requestType: "GetInputMute", requestData: { inputUuid: input.inputUuid } },
  ]);
  if (settingsResponse?.ok === false && settingsResponse.code === RESOURCE_NOT_FOUND) {
    return undefined;
  }
  const settings: InputSettings = InputSettingsSchema.parse(responseData(settingsResponse));
  const mute: InputMute | undefined =
    muteResponse?.ok === true ? InputMuteSchema.parse(muteResponse.responseData ?? {}) : undefined;
  return {
    inputName: input.inputName,
    inputUuid: input.inputUuid,
    inputKind: settings.inputKind,
    inputSettings: settings.inputSettings,
    inputMuted: mute?.inputMuted,
  };
}

/** The data of a successful batch response; a failed one fails the observation with its code. */
function responseData(response: ObsBatchResponse | undefined): ObsJsonObject {
  if (response === undefined) throw new Error("OBS returned too few batch responses.");
  if (!response.ok) {
    throw new ObsRequestError(response.requestType, response.code, response.comment);
  }
  return response.responseData ?? {};
}

function sceneItem(
  sceneUuid: string,
  item: SceneItemList["sceneItems"][number],
): ObservedObsSceneItem {
  return {
    sceneUuid,
    sceneItemId: item.sceneItemId,
    sceneItemIndex: item.sceneItemIndex,
    sourceName: item.sourceName,
    sourceUuid: item.sourceUuid,
    sceneItemEnabled: item.sceneItemEnabled,
    sceneItemTransform: parseTransform(item.sceneItemTransform),
  };
}

/** The comparable transform of an item, or undefined when OBS sent an incomplete one. */
function parseTransform(
  value: SceneItemList["sceneItems"][number]["sceneItemTransform"],
): Transform | undefined {
  return TransformSchema.safeParse(value).data;
}

/** What `read` resolves to, or `undefined` when OBS no longer has the resource it names. */
async function unlessGone<T>(read: Promise<T>): Promise<T | undefined> {
  try {
    return await read;
  } catch (cause) {
    if (readObsErrorCode(cause) === RESOURCE_NOT_FOUND) return undefined;
    throw cause;
  }
}

/** Calls one request and decodes its response; a malformed response is a failed observation. */
async function read<Schema extends z.ZodType>(
  transport: ObsTransport,
  requestType: string,
  schema: Schema,
  requestData?: ObsJsonObject,
): Promise<z.output<Schema>> {
  const response = await transport.call(requestType, requestData);
  const parsed = schema.safeParse(response);
  if (!parsed.success) throw new Error(`OBS returned a malformed '${requestType}' response.`);
  return parsed.data;
}
