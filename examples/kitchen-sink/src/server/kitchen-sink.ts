import { projectId } from "@cbj/vignette-core";
import { moqSourceModule } from "@cbj/vignette-moq";

export const KITCHEN_SINK_PROJECT_ID = projectId("kitchen-sink");
export const KITCHEN_SINK_CANVAS = { width: 1920, height: 1080, frameRate: 60 } as const;
export const KITCHEN_SINK_EXTENSIONS = [moqSourceModule] as const;
