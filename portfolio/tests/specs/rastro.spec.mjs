import { test, expect } from "@playwright/test";

test.beforeEach(async () => {
  test.skip(!process.env.RASTRO_URL, "Defina RASTRO_URL para um Rastro com dados de demonstração.");
});

test("telemetria · chegada fora de ordem e reenvio no celular", async ({ page, request }) => {
  const origin = process.env.RASTRO_URL;
  const fleet = async () => {
    const response = await request.get(origin + "/api/fleet");
    expect(response.ok()).toBe(true);
    return (await response.json()).vehicles.find(v => v.vehicle_id === "TRK-018");
  };
  const before = await fleet();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(origin);
  const simulate = page.getByRole("button", { name: /Simular chegada/i });
  const delivered = page.waitForResponse(r => r.url().endsWith("/api/demo/scenario") && r.request().method() === "POST");
  await simulate.click();
  const response = await delivered;
  expect(response.ok()).toBe(true);
  const receipts = (await response.json()).receipts;
  // Works both on a new synthetic shift and on a persisted, already exercised shift.
  const outcomes = receipts.map(r => r.outcome);
  expect([["advanced", "replay", "late"], ["replay", "replay", "replay"]]).toContainEqual(outcomes);
  const after = await fleet();
  expect(Number(after.unique_count)).toBe(Number(before.unique_count) + outcomes.filter(r => r !== "replay").length);
  expect(new Date(after.observed_at).toISOString()).toBe("2026-11-18T12:24:00.000Z");
  await expect(page.locator("#last-time")).toHaveText("09:24");
  await expect(page.locator("#last-date")).toHaveText("18/11/2026");
  await expect(page.locator("#event-list .history-row")).toHaveCount(5);
  await expect(page.locator("#event-list .badge.late")).toHaveCount(1);
  const delayed = page.locator(".history-row").filter({ hasText: "seq. 4" });
  await expect(delayed).toContainText("09:18");
  await expect(delayed).toContainText("Atrasada");
  await expect(simulate).toBeEnabled();
  await simulate.click();
  await expect(page.locator("#scenario-result")).toContainText(/3 reenvios/i);
  await expect(simulate).toBeEnabled();
  expect(await fleet()).toEqual(after);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("telemetria · navegação por teclado e leitura em 320 px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto(process.env.RASTRO_URL);
  await expect(page.locator("#db-status")).toHaveText("PostgreSQL conectado");
  const cedro = page.getByRole("button", { name: /Cedro.*TRK-018/ });
  const ipe = page.getByRole("button", { name: /Ipê.*TRK-027/ });
  await cedro.focus();
  await page.keyboard.press("Tab");
  await expect(ipe).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(ipe).toHaveAttribute("aria-pressed", "true");
  await expect(ipe).toBeFocused();
  await expect(page.locator("#track-heading")).toHaveText("Ipê");
  await expect(page.locator("#vehicle-code")).toHaveText("TRK-027");
  await expect(page.locator("#event-list .history-row")).toHaveCount(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("telemetria · falha de consulta e recuperação pelo monitor", async ({ page }) => {
  await page.route("**/api/fleet", route => route.fulfill({
    status: 503, contentType: "application/json", body: JSON.stringify({ detail: "Banco indisponível." }),
  }));
  await page.goto(process.env.RASTRO_URL);
  await expect(page.locator("#notice")).toContainText("Não foi possível atualizar a frota");
  await expect(page.locator("#db-status")).toHaveText("Sem conexão");
  const reload = page.getByRole("button", { name: "Atualizar", exact: true });
  await expect(reload).toBeEnabled();
  await page.unroute("**/api/fleet");
  await reload.click();
  await expect(page.locator("#db-status")).toHaveText("PostgreSQL conectado");
  await expect(page.locator("#notice")).toBeHidden();
  await expect(page.locator("#vehicle-list button")).toHaveCount(3);
  await expect(page.locator("#event-list .history-row").first()).toBeVisible();
});
