import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

export const MAX_DIFFERENCE_RATIO = 0.02;

export interface ParityMask {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface ParityOptions {
  readonly masks?: readonly ParityMask[];
}

export interface ParityResult {
  readonly width: number;
  readonly height: number;
  readonly differingPixels: number;
  readonly differenceRatio: number;
  readonly diffPng: Buffer;
}

export function comparePngBuffers(
  domBytes: Buffer,
  obsBytes: Buffer,
  options: ParityOptions = {},
): ParityResult {
  const dom = PNG.sync.read(domBytes);
  const obs = PNG.sync.read(obsBytes);
  if (dom.width !== obs.width || dom.height !== obs.height) {
    throw new Error(
      `Parity dimensions differ: DOM ${String(dom.width)}x${String(dom.height)}, OBS ${String(obs.width)}x${String(obs.height)}.`,
    );
  }
  for (const mask of options.masks ?? []) {
    maskRegion(dom, mask);
    maskRegion(obs, mask);
  }
  const diff = new PNG({ width: dom.width, height: dom.height });
  const differingPixels = pixelmatch(dom.data, obs.data, diff.data, dom.width, dom.height, {
    threshold: 0.1,
    includeAA: false,
  });
  return {
    width: dom.width,
    height: dom.height,
    differingPixels,
    differenceRatio: differingPixels / (dom.width * dom.height),
    diffPng: PNG.sync.write(diff),
  };
}

export function createComparisonStrip(
  domBytes: Buffer,
  obsBytes: Buffer,
  diffBytes: Buffer,
): Buffer {
  const images = [domBytes, obsBytes, diffBytes].map((bytes) => PNG.sync.read(bytes));
  const [first] = images;
  if (first === undefined) throw new Error("Parity strip requires images.");
  if (images.some((image) => image.width !== first.width || image.height !== first.height)) {
    throw new Error("Parity strip images must have equal dimensions.");
  }
  const gap = 12;
  const strip = new PNG({
    width: first.width * images.length + gap * (images.length - 1),
    height: first.height,
    fill: true,
    colorType: 6,
    bgColor: { red: 9, green: 13, blue: 24 },
  });
  images.forEach((image, index) => {
    PNG.bitblt(image, strip, 0, 0, image.width, image.height, index * (image.width + gap), 0);
  });
  return PNG.sync.write(strip);
}

export function createParityReportHtml(
  domBytes: Buffer,
  obsBytes: Buffer,
  result: ParityResult,
): string {
  const image = (bytes: Buffer) => `data:image/png;base64,${bytes.toString("base64")}`;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>React OBS frame parity</title>
    <style>
      :root { color-scheme: dark; font-family: ui-sans-serif, system-ui, sans-serif; background: #090d18; color: #eef2ff; }
      body { margin: 0; padding: 32px; }
      header { display: flex; align-items: end; justify-content: space-between; gap: 24px; margin-bottom: 24px; }
      h1, p { margin: 0; }
      p { color: #9aa6c1; }
      strong { color: #8da9ff; }
      main { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
      figure { margin: 0; overflow: hidden; border: 1px solid #27314d; border-radius: 14px; background: #11182a; }
      figcaption { padding: 10px 14px; font-size: 12px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
      img { display: block; width: 100%; height: auto; }
    </style>
  </head>
  <body>
    <header>
      <div><p>React OBS</p><h1>&lt;View /&gt; parity</h1></div>
      <p><strong>${String(result.differingPixels)}</strong> differing pixels · <strong>${(result.differenceRatio * 100).toFixed(4)}%</strong></p>
    </header>
    <main>
      <figure><figcaption>DOM runtime</figcaption><img src="${image(domBytes)}" alt="DOM runtime frame" /></figure>
      <figure><figcaption>OBS browser source</figcaption><img src="${image(obsBytes)}" alt="OBS browser source frame" /></figure>
      <figure><figcaption>Pixel diff</figcaption><img src="${image(result.diffPng)}" alt="Pixel difference" /></figure>
    </main>
  </body>
</html>`;
}

function maskRegion(image: PNG, mask: ParityMask): void {
  const startX = Math.max(0, Math.floor(mask.x));
  const startY = Math.max(0, Math.floor(mask.y));
  const endX = Math.min(image.width, Math.ceil(mask.x + mask.width));
  const endY = Math.min(image.height, Math.ceil(mask.y + mask.height));
  for (let y = startY; y < endY; y += 1) {
    for (let x = startX; x < endX; x += 1) {
      const offset = (y * image.width + x) * 4;
      image.data[offset] = 0;
      image.data[offset + 1] = 0;
      image.data[offset + 2] = 0;
      image.data[offset + 3] = 255;
    }
  }
}
