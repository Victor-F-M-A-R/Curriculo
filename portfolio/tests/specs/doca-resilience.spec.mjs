import { test, expect } from "@playwright/test";

const doca = process.env.DOCA_URL ?? "http://127.0.0.1:8081";
const board = () => ({
  docks: Array.from({ length: 6 }, (_, i) => ({ id: `D${i + 1}`, name: `Doca 0${i + 1}`, cargo: "Seca", status: "free", carrier: "", version: 0 })),
  moves: [], sampledAt: new Date().toISOString(),
});
const session = { actor: "Teste", canWrite: true, federated: false, authenticated: false, csrfHeader: "X-Test-Token", csrf: "fixture" };

test("Doca · contrato inválido e data antiga não substituem a última leitura", async ({ page }) => {
  let payload = board();
  await page.route("**/api/session", route => route.fulfill({ json: session }));
  await page.route("**/api/yard", route => route.fulfill({ json: payload }));
  await page.goto(doca);
  const quality = page.getByRole("status", { name: "Qualidade da leitura" });
  await expect(quality).toHaveText("Atualizada");
  const time = await page.locator(".sync time").getAttribute("datetime");
  for (const invalid of [{ docks: [], moves: [] }, { ...board(), sampledAt: new Date(Date.now() - 120000).toISOString() },
    { ...board(), sampledAt: new Date(Date.now() + 60000).toISOString() },
    { ...board(), sampledAt: new Date().toString() },
    { ...board(), moves: [{ dockId: "D1", dockVersion: 1, action: "book", carrier: "Teste", actor: "operador", at: 2030 }] },
    { ...board(), moves: [{ dockId: "D1", dockVersion: 1, action: "book", carrier: "Teste", actor: "operador", at: "2026-02-30T12:00:00Z" }] },
    { ...board(), moves: [{ dockId: "D1", action: "book", carrier: "Teste", actor: "operador", at: new Date().toISOString() }] },
    { ...board(), moves: Array.from({ length: 2 }, () => ({ dockId: "D1", dockVersion: 1, action: "book", carrier: "Teste", actor: "operador", at: new Date().toISOString() })) }]) {
    payload = invalid;
    await page.getByRole("button", { name: "Atualizar leitura" }).click();
    await expect(quality).toHaveText("Desatualizada");
    await expect(page.locator(".sync time")).toHaveAttribute("datetime", time);
    await expect(page.getByRole("button", { name: "Reservar doca" })).toBeDisabled();
  }
  payload = board();
  await page.getByRole("button", { name: "Atualizar leitura" }).click();
  await expect(quality).toHaveText("Atualizada");
  await expect(page.getByRole("button", { name: "Reservar doca" })).toBeEnabled();
});

test("Doca · sessão expirada impede novas leituras até autenticar novamente", async ({ page }) => {
  let identity = { ...session, federated: true, authenticated: true };
  let unavailable = false;
  let boardReads = 0;
  await page.route("**/api/session", route => unavailable
    ? route.fulfill({ status: 503, json: { detail: "Sessão indisponível" }, headers: { "x-doca-fixture": "session-unavailable" } })
    : route.fulfill({ json: identity, headers: { "x-doca-fixture": identity.authenticated ? "session-current" : "session-denied" } }));
  await page.route("**/api/yard", route => {
    boardReads++;
    return route.fulfill({ json: board() });
  });
  await page.goto(doca);
  await expect(page.locator(".dock-switches button")).toHaveCount(6);
  const confirmedReads = boardReads;
  identity = { ...identity, authenticated: false, canWrite: false, actor: "Visitante" };
  const deniedResponse = page.waitForResponse(res => res.headers()["x-doca-fixture"] === "session-denied");
  await page.getByRole("button", { name: "Atualizar leitura" }).click();
  await (await deniedResponse).finished();
  await expect(page.getByRole("link", { name: "Entrar", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Atualizar leitura" })).toBeEnabled();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(page.locator(".dock-switches button")).toHaveCount(0);
  await expect(page.locator(".sync time")).toHaveCount(0);
  expect(boardReads).toBe(confirmedReads);
  unavailable = true;
  const unavailableResponse = page.waitForResponse(res => res.headers()["x-doca-fixture"] === "session-unavailable");
  await page.getByRole("button", { name: "Atualizar leitura" }).click();
  await (await unavailableResponse).finished();
  await expect(page.getByRole("button", { name: "Atualizar leitura" })).toBeEnabled();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(page.locator(".dock-switches button")).toHaveCount(0);
  expect(boardReads).toBe(confirmedReads);
  unavailable = false;
  identity = { ...session, federated: true, authenticated: true };
  await page.getByRole("button", { name: "Atualizar leitura" }).click();
  await expect(page.getByRole("button", { name: "Reservar doca" })).toBeEnabled();
  await expect(page.locator(".dock-switches button")).toHaveCount(6);
  expect(boardReads).toBeGreaterThan(confirmedReads);
});

test("Doca · renovação de sessão retira escrita e perda de identidade limpa dados", async ({ page }) => {
  let identity = { ...session, federated: true, authenticated: true };
  let denied = false;
  await page.route("**/api/session", route => route.fulfill({ json: identity }));
  await page.route("**/api/yard", route => {
    if (denied) identity = { ...identity, authenticated: false, actor: "Visitante" };
    return route.fulfill({ status: denied ? 401 : 200, json: denied ? { detail: "Entre novamente" } : board() });
  });
  await page.goto(doca);
  await expect(page.getByRole("button", { name: "Reservar doca" })).toBeEnabled();
  identity = { ...identity, canWrite: false };
  await page.getByRole("button", { name: "Atualizar leitura" }).click();
  await expect(page.getByRole("button", { name: "Reservar doca" })).toHaveCount(0);
  denied = true;
  await page.getByRole("button", { name: "Atualizar leitura" }).click();
  await expect(page.getByRole("link", { name: "Entrar", exact: true })).toBeVisible();
  await expect(page.locator(".dock-switches button")).toHaveCount(0);
  await expect(page.locator(".sync time")).toHaveCount(0);
});

for (const denial of [401, 403]) {
  test(`Doca · negação HTTP ${denial} da sessão oculta os dados até uma sessão válida`, async ({ page }) => {
    const identity = { ...session, federated: true, authenticated: true };
    let status = 200;
    let boardReads = 0;
    await page.route("**/api/session", route => route.fulfill({
      status,
      json: status === 200 ? identity : { detail: "Sessão indisponível" },
      headers: { "x-doca-fixture": `session-status-${status}` },
    }));
    await page.route("**/api/yard", route => {
      boardReads++;
      return route.fulfill({ json: board() });
    });
    await page.goto(doca);
    await expect(page.getByRole("button", { name: "Reservar doca" })).toBeEnabled();
    const confirmedReads = boardReads;
    for (const deniedOrUnavailable of [denial, 503]) {
      status = deniedOrUnavailable;
      const response = page.waitForResponse(res => res.headers()["x-doca-fixture"] === `session-status-${status}`);
      await page.getByRole("button", { name: "Atualizar leitura" }).click();
      await (await response).finished();
      await expect(page.getByRole("button", { name: "Atualizar leitura" })).toBeEnabled();
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await expect(page.locator(".dock-switches button")).toHaveCount(0);
      await expect(page.locator(".sync time")).toHaveCount(0);
      expect(boardReads).toBe(confirmedReads);
    }
    status = 200;
    await page.getByRole("button", { name: "Atualizar leitura" }).click();
    await expect(page.getByRole("button", { name: "Reservar doca" })).toBeEnabled();
    await expect(page.locator(".dock-switches button")).toHaveCount(6);
    expect(boardReads).toBeGreaterThan(confirmedReads);
  });
}

test("Doca · sessão antiga em trânsito não restaura escrita após um comando negado", async ({ page }) => {
  const operator = { ...session, federated: true, authenticated: true };
  const visitor = { ...operator, actor: "Visitante", authenticated: false, canWrite: false };
  let requests = 0;
  let denied = false;
  let release;
  let observed;
  const held = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { observed = resolve; });
  await page.route("**/api/session", async route => {
    requests++;
    if (requests === 2) {
      observed();
      await held;
      await route.fulfill({ json: operator, headers: { "x-doca-fixture": "previous-session" } });
      return;
    }
    await route.fulfill({ json: denied ? visitor : operator });
  });
  await page.route("**/api/yard", route => route.fulfill({ json: board() }));
  await page.route("**/api/docks/D1/moves", route => {
    denied = true;
    return route.fulfill({ status: 403, json: { detail: "Permissão vencida" } });
  });
  await page.goto(doca);
  await expect(page.getByRole("button", { name: "Reservar doca" })).toBeEnabled();
  await page.getByLabel("Reservar para").fill("Sintética");
  try {
    await page.getByRole("button", { name: "Atualizar leitura" }).click();
    await started;
    await page.getByRole("button", { name: "Reservar doca" }).click();
    await expect(page.getByRole("link", { name: "Entrar", exact: true })).toBeVisible();
    const previousReply = page.waitForResponse(res => res.headers()["x-doca-fixture"] === "previous-session");
    release();
    await (await previousReply).finished();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(page.locator(".dock-switches button")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Reservar doca" })).toHaveCount(0);
    await expect(page.locator(".crew")).toContainText("Visitante");
  } finally {
    release();
  }
});

test("Doca · quadro autorizado antes da negação não repopula os dados ao chegar tarde", async ({ page }) => {
  const operator = { ...session, federated: true, authenticated: true };
  const visitor = { ...operator, actor: "Visitante", authenticated: false, canWrite: false };
  let denied = false;
  let holdNextBoard = false;
  let release;
  let observed;
  const held = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { observed = resolve; });
  await page.route("**/api/session", route => route.fulfill({ json: denied ? visitor : operator }));
  await page.route("**/api/yard", async route => {
    if (holdNextBoard) {
      holdNextBoard = false;
      const earlierBoard = board();
      observed();
      await held;
      await route.fulfill({ json: earlierBoard, headers: { "x-doca-fixture": "previous-authorized-board" } });
      return;
    }
    await route.fulfill({ json: board() });
  });
  await page.route("**/api/docks/D1/moves", route => {
    denied = true;
    return route.fulfill({ status: 403, json: { detail: "Permissão vencida" } });
  });
  await page.goto(doca);
  await expect(page.getByRole("button", { name: "Reservar doca" })).toBeEnabled();
  await page.getByLabel("Reservar para").fill("Sintética");
  holdNextBoard = true;
  try {
    await page.getByRole("button", { name: "Atualizar leitura" }).click();
    await started;
    await page.getByRole("button", { name: "Reservar doca" }).click();
    await expect(page.getByRole("link", { name: "Entrar", exact: true })).toBeVisible();
    await expect(page.locator(".dock-switches button")).toHaveCount(0);
    const previousReply = page.waitForResponse(res => res.headers()["x-doca-fixture"] === "previous-authorized-board");
    release();
    await (await previousReply).finished();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(page.locator(".dock-switches button")).toHaveCount(0);
    await expect(page.locator(".sync time")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Reservar doca" })).toHaveCount(0);
    await expect(page.locator(".crew")).toContainText("Visitante");
  } finally {
    release();
  }
});

test("Doca · falha de conexão conserva a chave do comando no reenvio", async ({ page }) => {
  let value = board();
  const keys = [];
  await page.route("**/api/session", route => route.fulfill({ json: session }));
  await page.route("**/api/yard", route => route.fulfill({ json: { ...value, sampledAt: new Date().toISOString() } }));
  await page.route("**/api/docks/D1/moves", async route => {
    keys.push(route.request().headers()["idempotency-key"]);
    if (keys.length === 1) return route.abort("failed");
    value.docks[0] = { ...value.docks[0], status: "booked", carrier: "Reenvio", version: 1 };
    return route.fulfill({ json: value.docks[0] });
  });
  await page.goto(doca);
  await page.getByLabel("Reservar para").fill("Reenvio");
  await page.getByRole("button", { name: "Reservar doca" }).click();
  await expect(page.getByRole("alert")).toContainText("Não foi possível confirmar");
  await expect(page.getByRole("button", { name: "Reservar doca" })).toBeEnabled();
  await page.getByRole("button", { name: "Reservar doca" }).click();
  await expect(page.getByRole("button", { name: "Iniciar descarga" })).toBeEnabled();
  expect(keys).toHaveLength(2);
  expect(keys[1]).toBe(keys[0]);
});
