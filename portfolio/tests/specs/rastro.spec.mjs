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

test("telemetria · resposta atrasada não troca o veículo selecionado", async ({ page }) => {
  let release;
  let arrived;
  const pending = new Promise(resolve => { release = resolve; });
  const requested = new Promise(resolve => { arrived = resolve; });
  await page.route("**/api/vehicles/TRK-027/events", async route => {
    const response = await route.fetch();
    const body = await response.json();
    body.events[0].speed_kmh = 171;
    arrived();
    await pending;
    await route.fulfill({ response, json: body });
  });
  await page.goto(process.env.RASTRO_URL);
  await page.getByRole("button", { name: /Ipê.*TRK-027/ }).click();
  await requested;
  await page.getByRole("button", { name: /Jacarandá.*TRK-041/ }).click();
  await expect(page.locator("#vehicle-code")).toHaveText("TRK-041");
  await expect(page.locator("#event-list .history-row")).toHaveCount(3);
  const lateResponse = page.waitForResponse(r => r.url().endsWith("/api/vehicles/TRK-027/events"));
  release();
  await lateResponse;
  // Let the fetch completion handler settle, then inspect the rendered selection.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(page.locator("#track-heading")).toHaveText("Jacarandá");
  await expect(page.locator("#event-list")).not.toContainText("171 km/h");
  await expect(page.getByRole("button", { name: /Jacarandá.*TRK-041/ })).toHaveAttribute("aria-pressed", "true");
});

test("telemetria · paginação preserva registros e foco após falha e nova tentativa", async ({ page }) => {
  const positions = Array.from({ length: 32 }, (_, index) => ({
    event_id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    observed_at: new Date(Date.UTC(2025, 2, 12, 12, 32 - index)).toISOString(),
    device_seq: 132 - index, latitude: -23.5, longitude: -46.6, speed_kmh: 20, arrived_late: false,
  }));
  let nextAttempts = 0;
  await page.route("**/api/vehicles/TRK-018/events*", async route => {
    if (new URL(route.request().url()).searchParams.has("cursor")) {
      if (++nextAttempts === 1) return route.fulfill({ status: 503, json: { detail: "Falha temporária" } });
      return route.fulfill({ json: { events: positions.slice(20), next_cursor: null } });
    }
    return route.fulfill({ json: { events: positions.slice(0, 20), next_cursor: "controlled-test-page" } });
  });
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto(process.env.RASTRO_URL);
  await expect(page.locator("#event-list .history-row")).toHaveCount(20);
  const more = page.getByRole("button", { name: "Carregar posições anteriores" });
  await more.click();
  await expect(page.locator("#history-count")).toContainText("as anteriores foram preservadas");
  await expect(page.locator("#event-list .history-row")).toHaveCount(20);
  await expect(more).toBeEnabled();
  await more.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#event-list .history-row")).toHaveCount(32);
  await expect(page.locator("#history-count")).toContainText("fim do histórico");
  await expect(more).toBeHidden();
  await expect(page.locator("#timeline-heading")).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("telemetria · consulta antiga fica identificada e modo sem demo não oferece escrita", async ({ page }) => {
  await page.route("**/api/fleet", async route => {
    const response = await route.fetch();
    const body = await response.json();
    body.demo = false;
    await route.fulfill({ response, json: body });
  });
  await page.goto(process.env.RASTRO_URL);
  await expect(page.locator("#event-list .history-row").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Simular chegada" })).toBeHidden();
  const before = await page.locator("#last-time").textContent();
  await page.unroute("**/api/fleet");
  await page.route("**/api/fleet", route => route.fulfill({ status: 503, json: { detail: "Indisponível" } }));
  await page.getByRole("button", { name: "Atualizar", exact: true }).click();
  await expect(page.locator("#notice")).toContainText("Os dados exibidos são da última consulta");
  await expect(page.locator("#last-time")).toHaveText(before);
});
