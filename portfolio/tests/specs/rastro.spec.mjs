import { test, expect } from "@playwright/test";

test("telemetria · chegada fora de ordem e reenvio no celular", async ({ page }) => {
  test.skip(!process.env.RASTRO_URL, "Defina RASTRO_URL para um Rastro com dados de demonstração novos.");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(process.env.RASTRO_URL);
  const simulate = page.getByRole("button", { name: /Simular chegada/i });
  await simulate.click();
  const result = page.locator("#scenario-result");
  await expect(result).toContainText(/1 leitura atrasada/i);
  await simulate.click();
  await expect(result).toContainText(/3 reenvios/i);
  await expect(page.locator("#event-list")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
