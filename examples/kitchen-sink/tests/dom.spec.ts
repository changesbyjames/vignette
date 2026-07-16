import { expect, test } from "@playwright/test";

test("receives the kitchen-sink snapshot over SSE", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("dom-status")).toHaveText("settled");
  await expect(page.locator("[data-vignette-stage]")).toHaveAttribute(
    "data-vignette-project",
    "kitchen-sink",
  );
  await expect(page.locator("[data-vignette-layer]")).toHaveCount(12);
  await expect(page.locator('iframe[src*="/__vignette/frame/"]')).toHaveCount(4);
});

test("serves parameterized frames and configures the public MoQ demo", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("dom-status")).toHaveText("settled");
  await expect(page.locator('iframe[data-vignette-source^="card."]')).toHaveCount(3);
  const firstLabel = page.frameLocator('iframe[data-vignette-source="card.layout.label.source"]');
  await expect(firstLabel.getByTestId("label-frame")).toContainText("Yoga boxes");

  const moq = page.locator('moq-watch[data-vignette-source="demo.moq"]');
  await expect(moq).toHaveCount(1);
  await expect(moq).toHaveAttribute("url", "https://cdn.moq.dev/demo");
  await expect(moq).toHaveAttribute("name", "bbb.hang");
  await expect(moq).toHaveAttribute("data-vignette-moq-quality", "auto");
});

test("hydrates the clock as an independent React root", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.getByTestId("dom-status")).toHaveText("settled");

  const clock = page.locator('iframe[data-vignette-source="clock.source"]');
  const sourceUrl = await clock.getAttribute("src");
  expect(sourceUrl).not.toBeNull();
  const response = await request.get(sourceUrl ?? "");
  expect(response.ok()).toBe(true);
  expect(await response.text()).toContain("Vignette kitchen sink");

  const clockFrame = page.frameLocator('iframe[data-vignette-source="clock.source"]');
  await expect(clockFrame.getByTestId("clock-frame")).toHaveAttribute("data-hydrated", "true");
  const firstTime = await clockFrame.getByTestId("clock-frame").textContent();
  await expect
    .poll(async () => clockFrame.getByTestId("clock-frame").textContent())
    .not.toBe(firstTime);
});

test("publishes dynamic layer updates from the Node composer", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("dom-status")).toHaveText("settled");
  const revision = page.getByTestId("commit-status");
  const initial = Number(await revision.textContent());
  await expect
    .poll(async () => Number(await revision.textContent()), { timeout: 5000 })
    .toBeGreaterThan(initial);
});
