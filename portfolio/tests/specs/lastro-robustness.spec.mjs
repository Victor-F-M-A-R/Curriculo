import { test, expect } from "@playwright/test";

const base = process.env.LASTRO_URL ?? "http://127.0.0.1:8082";
const headers = { "X-Lastro-Client": "desk" };

for (const width of [390, 1280]) {
  test(`Lastro · filtro mantém seleção e foco previsíveis (${width}px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(base);
    const filter = page.getByRole("combobox", { name: "Filtrar por situação" });
    await expect(page.locator("#entry-merchant")).toHaveText("Casa Botânica");
    await filter.focus();
    await filter.selectOption("pending");
    await expect(filter).toBeFocused();
    await expect(page.locator(".detail .ref")).toHaveText("REP-1047");
    await filter.selectOption("all");
    await expect(page.locator(".detail .ref")).toHaveText("REP-1047");
    const search = page.getByRole("textbox", { name: "Buscar referência ou empresa" });
    await search.fill("nenhum repasse");
    await expect(search).toBeFocused();
    await expect(page.locator("#entry-detail")).toHaveCount(0);
    await expect(page.locator(".desk [aria-live]")).toContainText("Nenhum repasse selecionado");
    await search.fill("Cedro");
    await expect(page.locator(".desk [aria-live]")).toContainText("REP-1045");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: /Ateliê Cedro.*REP-1045/ })).toBeFocused();
    await page.keyboard.press("Enter");
    if (width === 390) await expect(page.locator("#entry-merchant")).toBeFocused();
  });
}

test("Lastro · revisão retira item do filtro e devolve foco à próxima linha ou ao filtro vazio", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base);
  const filter = page.getByRole("combobox", { name: "Filtrar por situação" });
  await filter.selectOption("disputed");
  for (const ref of ["REP-1043", "REP-1045"]) {
    const row = page.getByRole("button", { name: new RegExp(ref) });
    await row.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#entry-merchant")).toBeFocused();
    await page.getByLabel("Justificativa de revisão").fill("Conferência comprovada no extrato sintético.");
    await page.getByRole("button", { name: "Registrar revisão" }).focus();
    await page.keyboard.press("Enter");
    await expect(row).toHaveCount(0);
    if (ref === "REP-1043") await expect(page.getByRole("button", { name: /REP-1045/ })).toBeFocused();
    else await expect(filter).toBeFocused();
  }
  await expect(page.locator("#entry-detail")).toHaveCount(0);
  await expect(page.locator(".desk [aria-live]")).toContainText("Nenhum repasse selecionado");
});

test("Lastro · reflow em 320 CSS pixels preserva filtros e ficha sem rolagem horizontal", async ({ page }) => {
  // Equivalent layout viewport to a 1280px desktop at 400% zoom; no claim of manual screen-reader testing.
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto(base);
  await expect(page.getByRole("button", { name: /Casa Botânica.*REP-1043/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("button", { name: /Casa Botânica.*REP-1043/ }).click();
  await expect(page.locator("#entry-merchant")).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("Lastro · sessão expirada remove dados antigos e permite recuperar a conta", async ({ page, context }) => {
  const user = "qa-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const password = "Synthetic-password-2026";
  expect((await page.request.post(base + "/api/register", { headers, data: { user, password } })).status()).toBe(204);
  await page.goto(base);
  await page.getByLabel("Justificativa de revisão").fill("Revisão que não deve atravessar a expiração.");
  await context.clearCookies();
  await page.getByRole("button", { name: "Registrar revisão" }).click();
  await expect(page.getByRole("alert")).toContainText("Sua sessão terminou");
  await expect(page.locator(".desk")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Importar extrato" })).toBeDisabled();
  await page.getByRole("button", { name: "Conta", exact: true }).click();
  await page.getByLabel("Usuário", { exact: true }).fill(user);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Acessar minha mesa" }).click();
  await expect(page.locator(".detail .badge")).toHaveText("Divergente");
  await expect(page.getByRole("button", { name: user, exact: true })).toBeVisible();
});

test("Lastro · contas, autenticação, logout e repetição preservam mesas separadas", async ({ playwright }) => {
  const a = await playwright.request.newContext({ baseURL: base, extraHTTPHeaders: headers });
  const b = await playwright.request.newContext({ baseURL: base, extraHTTPHeaders: headers });
  const user = "qa-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const password = "Synthetic-password-2026";
  try {
    expect((await a.get("/api/book")).status()).toBe(401);
    expect((await a.post("/api/register", { data: { user, password: "short" } })).status()).toBe(400);
    expect((await a.post("/api/register", { data: { user, password } })).status()).toBe(204);
    expect((await b.post("/api/register", { data: { user, password } })).status()).toBe(409);
    expect((await b.post("/api/login", { data: { user, password: "incorrect" } })).status()).toBe(401);
    expect((await b.post("/api/session/demo", { data: {} })).status()).toBe(204);
    const aBook = { "X-Lastro-Workspace": (await (await a.get("/api/session")).json()).workspace };
    const bBook = { "X-Lastro-Workspace": (await (await b.get("/api/session")).json()).workspace };
    const csv = "referencia;data;recebido\nPRIVATE-01;2026-11-20;10,01";
    expect((await a.post("/api/book/import", { headers: aBook, data: { csv } })).status()).toBe(200);
    expect((await a.post("/api/book/PRIVATE-01/review", { headers: aBook, data: { note: "Justificativa particular da mesa A." } })).status()).toBe(204);
    expect((await b.post("/api/book/PRIVATE-01/review", { headers: bBook, data: { note: "Tentativa sem referência na mesa B." } })).status()).toBe(404);
    expect((await (await b.get("/api/book")).json()).some(row => row.reference === "PRIVATE-01")).toBe(false);
    expect(await (await b.get("/audit?referencia=PRIVATE-01")).text()).not.toContain("Justificativa particular");
    expect((await a.post("/api/book/import", { headers: { "X-Lastro-Client": "" }, data: { csv } })).status()).toBe(403);
    expect((await a.post("/api/logout", { data: {} })).status()).toBe(204);
    expect((await a.get("/api/book/events")).status()).toBe(401);
    expect((await a.post("/api/login", { data: { user: user.toUpperCase(), password } })).status()).toBe(204);
    expect((await (await a.get("/api/book")).json()).find(row => row.reference === "PRIVATE-01").reason).toBe("Justificativa particular da mesa A.");
    expect((await (await a.post("/api/book/import", { headers: aBook, data: { csv } })).json()).replay).toBe(true);
  } finally { await a.dispose(); await b.dispose(); }
});

test("Lastro · auditoria pagina sem repetir registros quando um evento novo chega", async ({ page }) => {
  await page.goto(base);
  await expect(page.locator(".desk")).toBeVisible();
  const bookHeaders = { ...headers, "X-Lastro-Workspace": (await (await page.request.get(base + "/api/session")).json()).workspace };
  for (let i = 0; i < 23; i++) {
    const csv = `referencia;data;recebido\nAUD-${i};2026-11-20;0,01`;
    expect((await page.request.post(base + "/api/book/import", { headers: bookHeaders, data: { csv } })).status()).toBe(200);
  }
  await page.goto(base + "/audit?tipo=import");
  const first = await page.locator("article small").allTextContents();
  expect(first).toHaveLength(20);
  expect((await page.request.post(base + "/api/book/import", { headers: bookHeaders,
    data: { csv: "referencia;data;recebido\nAUD-NEW;2026-11-20;0,01" } })).status()).toBe(200);
  await page.getByRole("link", { name: "Eventos anteriores" }).click();
  expect(new URL(page.url()).searchParams.get("tipo")).toBe("import");
  const next = await page.locator("article small").allTextContents();
  expect(next).toHaveLength(3);
  expect(new Set([...first, ...next]).size).toBe(23);
  await page.getByRole("link", { name: "Eventos mais recentes" }).click();
  const refreshed = await page.locator("article small").allTextContents();
  expect(first).not.toContain(refreshed[0]);
  await page.getByLabel("Referência exata").fill("missing");
  await page.getByRole("button", { name: "Filtrar", exact: true }).click();
  await expect(page.getByText("Nenhum evento encontrado nesta mesa com os filtros atuais.")).toBeVisible();
});
