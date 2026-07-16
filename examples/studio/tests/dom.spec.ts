import { expect, test } from "@playwright/test";

test("receives complete snapshots from the Node composer over SSE", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("dom-status")).toHaveText("settled");
  await expect(page.locator("[data-react-obs-stage]")).toHaveAttribute(
    "data-react-obs-project",
    "studio-demo",
  );
  await expect(page.locator("[data-react-obs-layer]")).toHaveCount(17);
  await expect(page.locator('iframe[src*="/__react-obs/frame/"]')).toHaveCount(10);
  await expect(
    page.locator('iframe[data-react-obs-source^="slot."][data-react-obs-source$=".label.source"]'),
  ).toHaveCount(6);
});

test("downloads manifest assets into browser-owned blob URLs", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("dom-status")).toHaveText("settled");
  await expect(
    page.locator('img[data-react-obs-source="overlay.six-camera-border"]'),
  ).toHaveAttribute("src", /^blob:/u);
});

test("configures the MoQ panel through @moq/watch", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("dom-status")).toHaveText("settled");
  const watches = page.locator("moq-watch[data-react-obs-source]");
  await expect(watches).toHaveCount(6);
  await expect
    .poll(() =>
      watches.evaluateAll((elements) => ({
        configured: elements.every(
          (element) =>
            element
              .getAttribute("url")
              ?.startsWith("https://moq.conservation.stream/james?jwt=") === true &&
            element.getAttribute("name")?.endsWith(".hang") === true &&
            element.getAttribute("visible") === "always" &&
            element.getAttribute("data-react-obs-moq-quality") === "auto",
        ),
        latencies: elements
          .map(
            (element) =>
              `${element.getAttribute("data-react-obs-source") ?? "missing-source"}:${element.getAttribute("latency") ?? "missing-latency"}`,
          )
          .toSorted(),
      })),
    )
    .toEqual({
      configured: true,
      latencies: [
        "camera.emus:100",
        "camera.georgie:100",
        "camera.marmosets:100",
        "camera.parrots:100",
        "camera.serval:100",
        "camera.wolf-hybrids:100",
      ],
    });
  await expect(watches.locator("canvas")).toHaveCount(6);
});

test("shuffles complete camera slots every five seconds", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("dom-status")).toHaveText("settled");
  const cameraLayers = page.locator(
    '[data-react-obs-layer^="slot."][data-react-obs-layer$=".camera"]',
  );
  await expect(cameraLayers).toHaveCount(6);

  const readPlacements = () =>
    cameraLayers.evaluateAll((elements) =>
      elements
        .map(
          (element) =>
            `${element.getAttribute("data-react-obs-layer") ?? "missing-layer"}:${(element as HTMLElement).style.left}:${(element as HTMLElement).style.top}`,
        )
        .toSorted(),
    );
  const initial = await readPlacements();
  await expect.poll(readPlacements, { timeout: 7000 }).not.toEqual(initial);
});

test("serves and hydrates the transparent overlay frames", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.getByTestId("dom-status")).toHaveText("settled");
  const frames = page.locator('iframe[src*="/__react-obs/frame/"]');
  await expect(frames).toHaveCount(10);

  const clock = page.locator('iframe[data-react-obs-source="overlay.sanctuary-clock.source"]');
  const sourceUrl = await clock.getAttribute("src");
  expect(sourceUrl).not.toBeNull();
  const serverHtml = await request.get(sourceUrl ?? "");
  expect(serverHtml.ok()).toBe(true);
  expect(await serverHtml.text()).toContain("ALVEUS SANCTUARY");
  const invalidUrl = new URL(sourceUrl ?? "");
  invalidUrl.searchParams.set("props", "[]");
  expect((await request.get(invalidUrl.toString())).status()).toBe(400);

  const clockFrame = page.frameLocator(
    'iframe[data-react-obs-source="overlay.sanctuary-clock.source"]',
  );
  await expect(clockFrame.getByTestId("sanctuary-clock-frame")).toHaveAttribute(
    "data-hydrated",
    "true",
  );
  await expect(clockFrame.getByTestId("sanctuary-clock-frame")).toContainText("CT");
  const body = clockFrame.locator("body");
  await expect(body).toHaveCSS("overflow", "hidden");
  await expect(body).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");

  const firstTime = await clockFrame.getByTestId("sanctuary-clock-frame").textContent();
  await expect
    .poll(async () => clockFrame.getByTestId("sanctuary-clock-frame").textContent())
    .not.toBe(firstTime);

  await expect(
    page
      .frameLocator('iframe[data-react-obs-source="slot.serval.label.source"]')
      .getByTestId("camera-label-frame"),
  ).toContainText("Kasi (Serval) Temporary Enclosure");
  await expect(
    page
      .frameLocator('iframe[data-react-obs-source="overlay.sanctuary-links.source"]')
      .getByTestId("sanctuary-links-frame"),
  ).toContainText("alveussanctuary.org");
  await expect(
    page
      .frameLocator('iframe[data-react-obs-source="overlay.animal-disclaimer.source"]')
      .getByTestId("animal-disclaimer-frame"),
  ).toContainText("educational ambassadors");
  await expect(
    page
      .frameLocator('iframe[data-react-obs-source="overlay.testing-banner.source"]')
      .getByTestId("testing-banner-frame"),
  ).toHaveText("Not Alveus Sanctuary (testing)");
});
