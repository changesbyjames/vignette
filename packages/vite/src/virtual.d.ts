declare module "virtual:vignette/frames" {
  export const frames: import("@cbj/vignette-frame/server").FrameBundle;
}

declare module "virtual:vignette/assets" {
  export const assets: import("@cbj/vignette-core").AssetManifest;
}
