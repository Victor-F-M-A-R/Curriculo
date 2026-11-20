import { test, expect } from "@playwright/test";

const doca = process.env.DOCA_URL ?? "http://127.0.0.1:8081";
const board = () => ({
  docks: Array.from({ length: 6 }, (_, i) => ({ id: `D${i + 1}`, name: `Doca 0${i + 1}`, cargo: "Seca", status: "free", carrier: "", version: 0 })),
  moves: [], sampledAt: new Date().toISOString(),
});
const session = { actor: "Teste", canWrite: true, federated: false, csrfHeader: "X-Test-Token", csrf: "fixture" };

test("Doca · contrato inválido e data antiga não substituem a última leitura", async ({ page }) => {
  let payload = board();
  await page.route("**/api/session", route => route.fulfill({ json: session }));
  await page.route("**/api/yard", route => route.fulfill({ json: payload }));
  await page.goto(doca);
  const quality = page.getByRole("status", { name: "Qualidade da leitura" });
  await expect(quality).toHaveText("Atualizada");
  const time = await page.locator(".sync time").getAttribute("datetime");
  for (const invalid of [{ docks: [], moves: [] }, { ...board(), sampledAt: new Date(Date.now() - 120000).toISOString() },
    { ...board(), sampledAt: new Date(Date.now() + 60000).toISOString() }]) {
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

test("Doca · renovação de sessão retira escrita e perda de identidade limpa dados", async ({ page }) => {
  let identity = { ...session, federated: true, authenticated: true };
  let denied = false;
  await page.route("**/api/session", route => route.fulfill({ json: identity }));
  await page.route("**/api/yard", route => route.fulfill({ status: denied ? 401 : 200, json: denied ? { detail: "Entre novamente" } : board() }));
  await page.goto(doca);
  await expect(page.getByRole("button", { name: "Reservar doca" })).toBeEnabled();
  identity = { ...identity, canWrite: false };
  await page.getByRole("button", { name: "Atualizar leitura" }).click();
  await expect(page.getByRole("button", { name: "Reservar doca" })).toHaveCount(0);
  identity = { ...identity, authenticated: false, actor: "Visitante" };
  denied = true;
  await page.getByRole("button", { name: "Atualizar leitura" }).click();
  await expect(page.getByRole("link", { name: "Entrar", exact: true })).toBeVisible();
  await expect(page.locator(".dock-switches button")).toHaveCount(0);
  await expect(page.locator(".sync time")).toHaveCount(0);
});

test("Doca · confirmação perdida conserva a chave e não duplica a operação", async ({ page }) => {
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
