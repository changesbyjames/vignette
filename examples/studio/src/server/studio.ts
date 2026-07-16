import { projectId, type AssetManifest } from "@cbj/react-obs-core";
import { moqSourceModule } from "@cbj/react-obs-moq";

export const STUDIO_PROJECT_ID = projectId("studio-demo");
export const STUDIO_CANVAS = { width: 1920, height: 1080, frameRate: 60 } as const;
export const STUDIO_EXTENSIONS = [moqSourceModule] as const;

export function createStudioManifest(origin: string): AssetManifest {
  return {
    version: 1,
    assets: [
      {
        name: "streamborder6cam.png",
        url: `${origin}/assets/streamborder6cam.png`,
        integrity: "sha256-96/19LMcl//jZCUwV2bUXws7H2CiaXzXGKVzfQpygw8=",
      },
    ],
  };
}
