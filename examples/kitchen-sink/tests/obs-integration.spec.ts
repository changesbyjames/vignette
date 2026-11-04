import { expect, test } from "@playwright/test";
import { moqObs } from "@vignette/moq/obs";
import { OBSWebSocket } from "obs-websocket-js";
import process from "node:process";
import { fromSse } from "@strangecyan/vignette";
import { obsTarget } from "@strangecyan/vignette/obs";
import { z } from "zod";

const enabled = process.env.VIGNETTE_ALLOW_INTEGRATION === "1";
const show = "kitchen-sink";
const prefix = `vignette/${show}`;

/**
 * What `vignette obs <stream> --source @vignette/moq/obs` does, in process: follow the example
 * server's stream with `obsTarget` and converge a real, disposable OBS scene collection.
 */
test("obsTarget converges the kitchen-sink stream in OBS", async ({ baseURL }) => {
  test.skip(!enabled, "Set VIGNETTE_ALLOW_INTEGRATION=1 for a disposable local OBS instance.");
  test.setTimeout(90_000);
  const url = requiredEnvironment("VIGNETTE_OBS_URL");
  const password = requiredEnvironment("VIGNETTE_OBS_PASSWORD");
  const expectedCollection = requiredEnvironment("VIGNETTE_OBS_TEST_COLLECTION");
  await assertDisposableCollection(url, password, expectedCollection);
  const previousProgramScene = await currentProgramScene(url, password);

  const obs = obsTarget({ url, password, sources: [moqObs] });
  const stop = obs.follow(fromSse(new URL("/stream", baseURL).href));
  try {
    await expect
      .poll(() => obs.status.phase, { timeout: 60_000, message: JSON.stringify(obs.status) })
      .toBe("settled");
    expect(obs.status.sources["main.clock"]).toBe("live");
    expect(obs.status.connection).toEqual({ phase: "open" });

    const scenes = await sceneNames(url, password);
    expect(scenes).toEqual(expect.arrayContaining([`${prefix}/main`, `${prefix}/focus`]));

    const clock = await inputSettings(url, password, `${prefix}/main.clock`);
    expect(clock).toMatchObject({ width: 1760, height: 130 });
    const page = new URL(z.string().parse(clock.url));
    expect(page.pathname).toBe("/vignette/frames.html");
    expect(page.searchParams.get("frame")).toBe("Clock");
    expect(page.searchParams.get("source")).toBe("main.clock");
    expect(page.searchParams.get("stream")).toBe(new URL("/stream", baseURL).href);
  } finally {
    stop();
    await obs.dispose();
    await setProgramScene(url, password, previousProgramScene);
    await removeManagedScenes(url, password);
  }
});

const ObsInputSettingsSchema = z.record(z.string(), z.json());
type ObsInputSettings = z.output<typeof ObsInputSettingsSchema>;
const ObsSceneHeaderSchema = z.object({ sceneName: z.string(), sceneUuid: z.string().optional() });
type ObsSceneHeader = z.output<typeof ObsSceneHeaderSchema>;

async function assertDisposableCollection(
  url: string,
  password: string,
  expectedCollection: string,
): Promise<void> {
  await withClient(url, password, async (client) => {
    const response = await client.call("GetSceneCollectionList");
    expect(response.currentSceneCollectionName).toBe(expectedCollection);
  });
}

async function inputSettings(
  url: string,
  password: string,
  inputName: string,
): Promise<ObsInputSettings> {
  return withClient(url, password, async (client) => {
    const response = await client.call("GetInputSettings", { inputName });
    return ObsInputSettingsSchema.parse(response.inputSettings);
  });
}

async function currentProgramScene(url: string, password: string): Promise<string> {
  return withClient(url, password, async (client) => {
    const response = await client.call("GetCurrentProgramScene");
    return response.currentProgramSceneName;
  });
}

async function setProgramScene(url: string, password: string, sceneName: string): Promise<void> {
  await withClient(url, password, async (client) => {
    await client.call("SetCurrentProgramScene", { sceneName });
  });
}

async function managedScenes(client: OBSWebSocket): Promise<readonly ObsSceneHeader[]> {
  const response = await client.call("GetSceneList");
  return response.scenes.flatMap((value) => {
    const parsed = ObsSceneHeaderSchema.safeParse(value);
    return parsed.success && parsed.data.sceneName.startsWith(prefix) ? [parsed.data] : [];
  });
}

async function sceneNames(url: string, password: string): Promise<readonly string[]> {
  return withClient(url, password, async (client) =>
    (await managedScenes(client)).map((scene) => scene.sceneName),
  );
}

/** Removes only this show's managed scenes; their inputs go with the registry scene. */
async function removeManagedScenes(url: string, password: string): Promise<void> {
  await withClient(url, password, async (client) => {
    for (const scene of await managedScenes(client)) {
      if (scene.sceneUuid === undefined) throw new Error("Managed scene has no UUID.");
      await client.call("RemoveScene", { sceneUuid: scene.sceneUuid });
    }
  });
}

async function withClient<T>(
  url: string,
  password: string,
  action: (client: OBSWebSocket) => Promise<T>,
): Promise<T> {
  const client = new OBSWebSocket();
  try {
    await client.connect(url, password, { rpcVersion: 1 });
    return await action(client);
  } finally {
    try {
      await client.disconnect();
    } catch {
      // A failed preflight may leave no socket to close.
    }
  }
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) throw new Error(`Missing required ${name}.`);
  return value;
}
