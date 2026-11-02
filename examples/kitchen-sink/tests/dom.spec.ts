import { expect, test, type Page } from "@playwright/test";

/** Waits for the preview to settle on the stream and returns the stage locator. */
async function openPreview(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("phase")).toHaveText("settled");
  return page.locator("[data-vignette-stage]");
}

test("renders the kitchen-sink stream on a <Stage>", async ({ page }) => {
  const stage = await openPreview(page);
  await expect(stage).toHaveAttribute("data-vignette-stage", /^(main|focus)$/u);
  await expect(page.locator("[data-vignette-stage='main']")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("[data-vignette-stage] [data-vignette-layer]")).not.toHaveCount(0);
  const labels = page.locator("iframe[src*='frame=Label']");
  await expect(labels).toHaveCount(3);
  await expect(labels.first().contentFrame().getByTestId("label-frame")).toContainText(
    "Yoga layers",
  );
  await expect(page.locator("[data-vignette-layer='logo'] img")).toHaveAttribute("src", /^blob:/u);

  const moq = page.locator("moq-watch");
  await expect(moq).toHaveCount(1);
  await expect(moq).toHaveAttribute("url", "https://cdn.moq.dev/demo");
  await expect(moq).toHaveAttribute("name", "bbb.hang");
  await expect(moq).toHaveAttribute("data-vignette-moq-quality", "auto");
});

/** What identifies the clock iframe's element and page: a reload starts a new time origin. */
interface ClockIdentity {
  readonly element: string | undefined;
  readonly document: string | undefined;
  readonly timeOrigin: number | undefined;
}

test("renders the clock frame as an iframe that keeps its page across params and scenes", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await openPreview(page);
  // The focus scene's clock: hidden but mounted while `main` shows; its title follows the card.
  const clock = page.locator("iframe[src*='frame=Clock'][src*='source=focus.clock']");
  await expect(clock).toHaveCount(1);
  const frame = clock.contentFrame();
  await expect(frame.getByTestId("clock-frame")).toHaveAttribute("data-mounted", "true");
  const time = frame.getByTestId("clock-time");
  const firstTime = await time.textContent();
  await expect.poll(async () => time.textContent()).not.toBe(firstTime);

  // Marks the iframe element and its document; a new element or a reloaded page lacks the marks.
  const identity = async (mark: boolean): Promise<ClockIdentity> =>
    clock.evaluate((element, marking) => {
      // Runs in the page: marks only when asked, then reads the marks and the page's time origin.
      if (!(element instanceof HTMLIFrameElement)) throw new Error("The clock is not an iframe.");
      const root = element.contentDocument?.documentElement;
      if (marking && root !== undefined) {
        element.dataset.marker = "original";
        root.dataset.marker = "original";
      }
      return {
        element: element.dataset.marker,
        document: root?.dataset.marker,
        timeOrigin: element.contentWindow?.performance.timeOrigin,
      };
    }, mark);
  const original = await identity(true);
  expect(original).toMatchObject({ element: "original", document: "original" });

  // A params change re-renders the page in place.
  const title = frame.getByTestId("clock-title");
  const firstTitle = await title.textContent();
  await expect.poll(async () => title.textContent(), { timeout: 10_000 }).not.toBe(firstTitle);
  expect(await identity(false)).toEqual(original);

  // Scene switches show and hide it without reloading.
  const stage = page.locator("[data-vignette-stage]");
  for (const scene of ["focus", "main", "focus"]) {
    await expect(stage).toHaveAttribute("data-vignette-stage", scene, { timeout: 15_000 });
    expect(await identity(false)).toEqual(original);
  }
  const lastTime = await time.textContent();
  await expect.poll(async () => time.textContent()).not.toBe(lastTime);
});

test("publishes new revisions from the composer", async ({ page }) => {
  await openPreview(page);
  const revision = page.getByTestId("revision");
  const initial = Number(await revision.textContent());
  await expect
    .poll(async () => Number(await revision.textContent()), { timeout: 5_000 })
    .toBeGreaterThan(initial);
});

for (const moveBefore of [true, false]) {
  test(`keeps the shared MoQ element across scene switches (moveBefore ${moveBefore ? "on" : "off"})`, async ({
    page,
  }) => {
    test.setTimeout(45_000);
    if (!moveBefore) {
      await page.addInitScript(() => {
        Object.defineProperty(Element.prototype, "moveBefore", {
          configurable: true,
          value: undefined,
        });
      });
    }
    await openPreview(page);
    const watch = await page.locator("moq-watch").elementHandle();
    if (watch === null) throw new Error("The shared MoQ element is missing.");
    await watch.evaluate((element) => {
      if (element instanceof HTMLElement) element.dataset.marker = "original";
    });
    const stageOf = async () =>
      watch.evaluate((element) =>
        element.isConnected
          ? element.closest<HTMLElement>("[data-vignette-stage]")?.dataset.vignetteStage
          : "detached",
      );

    for (const scene of ["focus", "main"]) {
      await expect(page.locator(`[data-vignette-stage='${scene}']`)).toBeVisible({
        timeout: 15_000,
      });
      await expect.poll(stageOf).toBe(scene);
      await expect(page.locator("moq-watch")).toHaveCount(1);
      await expect(page.locator("moq-watch")).toHaveAttribute("data-marker", "original");
    }
  });
}
