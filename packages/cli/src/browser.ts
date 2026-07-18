import type { AnySourceDefinition, CompiledSnapshot } from "@strangecyan/vignette-core";
import {
  DomTarget,
  type DomSourceRenderer,
  type DomSourceView,
} from "@strangecyan/vignette-target-dom";

import type { BrowserPreviewInput, BrowserPreviewResult } from "./types.js";

const STATIC_SOURCE_KINDS = new Set(["source:image", "source:browser", "source:color"]);
let activeTarget: DomTarget | undefined;

declare global {
  var __vignettePreviewRender:
    ((input: BrowserPreviewInput) => Promise<BrowserPreviewResult>) | undefined;
}

globalThis.__vignettePreviewRender = renderPreview;

async function renderPreview(input: BrowserPreviewInput): Promise<BrowserPreviewResult> {
  await activeTarget?.dispose();
  const container = requireContainer();
  const snapshot = withoutPlaceholderAssets(input.snapshot);
  const placeholderKinds = [
    ...new Set(
      snapshot.sources
        .map((source) => source.definition.kind)
        .filter((kind) => !STATIC_SOURCE_KINDS.has(kind)),
    ),
  ];
  activeTarget = new DomTarget({
    id: "preview",
    container,
    sceneId: input.sceneId,
    extensions: placeholderKinds.map(createPlaceholderRenderer),
    assetResolver: {
      resolve(asset) {
        const manifestUrl = input.assetUrls[asset.name];
        const url = manifestUrl ?? resolveAssetUrl(input.assetBaseUrl, asset.name);
        return Promise.resolve({ kind: "url", url });
      },
    },
  });
  activeTarget.publish(snapshot);
  await activeTarget.whenSettled(snapshot.revision);
  await waitForStaticContent(container);
  return { placeholderCount: countVisiblePlaceholders(container) };
}

export function createPlaceholderRenderer(kind: `source:${string}`): DomSourceRenderer {
  return {
    kind,
    create(document): DomSourceView {
      const element = document.createElement("div");
      element.dataset.vignettePlaceholder = "";
      Object.assign(element.style, {
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        overflow: "hidden",
        padding: "24px",
        color: "#f4f0e8",
        backgroundColor: "#28252f",
        backgroundImage:
          "linear-gradient(135deg, rgba(255,255,255,.055) 25%, transparent 25%, transparent 50%, rgba(255,255,255,.055) 50%, rgba(255,255,255,.055) 75%, transparent 75%)",
        backgroundSize: "32px 32px",
        border: "4px dashed #b9a7dc",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        lineHeight: "1.35",
      });
      return {
        element,
        update(source, item) {
          element.replaceChildren(createPlaceholderContent(document, source, item.frame));
        },
        dispose() {
          element.replaceChildren();
        },
      };
    },
  };
}

function createPlaceholderContent(
  document: Document,
  source: AnySourceDefinition,
  frame: Readonly<{ width: number; height: number }>,
): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const title = document.createElement("strong");
  title.textContent = source.label ?? source.id;
  title.style.fontSize = "24px";
  const kind = document.createElement("span");
  kind.textContent = source.kind;
  kind.style.color = "#d8c6ff";
  kind.style.fontSize = "18px";
  const details = document.createElement("span");
  details.textContent = `${formatSettings(source)}\n${String(Math.round(frame.width))} x ${String(Math.round(frame.height))}`;
  details.style.whiteSpace = "pre-wrap";
  details.style.fontSize = "14px";
  details.style.opacity = "0.82";
  fragment.append(title, kind, details);
  return fragment;
}

function formatSettings(source: AnySourceDefinition): string {
  const settings = Object.entries(source)
    .filter(([key]) => key !== "id" && key !== "kind" && key !== "label")
    .map(([key, value]) => `${key}: ${formatValue(value)}`);
  return settings.join("\n");
}

function formatValue(value: unknown): string {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (isRecord(value) && value.kind === "asset" && typeof value.name === "string") {
    return value.name;
  }
  return JSON.stringify(value);
}

function withoutPlaceholderAssets(snapshot: CompiledSnapshot): CompiledSnapshot {
  return {
    ...snapshot,
    sources: snapshot.sources.map((source) => {
      if (STATIC_SOURCE_KINDS.has(source.definition.kind)) return source;
      const withoutAsset = { ...source };
      delete withoutAsset.asset;
      return withoutAsset;
    }),
  };
}

async function waitForStaticContent(container: HTMLElement): Promise<void> {
  await document.fonts.ready;
  const images = [...container.querySelectorAll("img")].map(async (image) => {
    if (!image.complete) await once(image, "load");
    await image.decode().catch(() => undefined);
  });
  const frames = [...container.querySelectorAll("iframe")].map(async (frame) => {
    if (frame.contentDocument?.readyState === "complete") return;
    await once(frame, "load");
  });
  await Promise.race([Promise.all([...images, ...frames]), delay(3_000)]);
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        resolve();
      });
    });
  });
}

function once(element: Element, event: string): Promise<void> {
  return new Promise((resolve) => {
    element.addEventListener(
      event,
      () => {
        resolve();
      },
      { once: true },
    );
  });
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function countVisiblePlaceholders(container: HTMLElement): number {
  return [...container.querySelectorAll<HTMLElement>("[data-vignette-placeholder]")].filter(
    (element) => element.getClientRects().length > 0,
  ).length;
}

function resolveAssetUrl(baseUrl: string | undefined, name: string): string {
  if (baseUrl === undefined) throw new Error(`No URL is available for asset '${name}'.`);
  return new URL(name, baseUrl).href;
}

function requireContainer(): HTMLElement {
  const container = document.querySelector<HTMLElement>("#preview");
  if (container === null) throw new Error("Preview container is missing.");
  return container;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
