import { test, expect } from "@playwright/test";

const doca = process.env.DOCA_URL ?? "http://127.0.0.1:8081";
const free = {
  docks: Array.from({ length: 6 }, (_, i) => ({ id: `D${i + 1}`, name: `Doca 0${i + 1}`, cargo: "Seca", status: "free", carrier: "", version: 0 })),
  moves: [],
};
const booked = {
  docks: [{ ...free.docks[0], status: "booked", carrier: "Transportes Aurora", version: 1 }, ...free.docks.slice(1)],
  moves: [],
};
const fresh = board => ({ ...board, sampledAt: new Date().toISOString() });

test.beforeEach(async ({ page }) => {
  await page.route("**/api/session", route => route.fulfill({ json: {
    actor: "Operador de teste", canWrite: true, federated: false,
    authenticated: false,
    csrfHeader: "X-Test-Token", csrf: "fixture",
  } }));
});

test("Doca · conflito e falha preservam a hora confirmada e bloqueiam movimentos no celular", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  let board = free;
  let unavailable = false;
  let commands = 0;
  await page.route("**/api/yard", route => unavailable
    ? route.fulfill({ status: 503, json: { detail: "Leitura indisponível" } })
    : route.fulfill({ json: fresh(board) }));
  await page.route("**/api/docks/D1/moves", route => {
    commands++;
    unavailable = true;
    board = booked;
    return route.fulfill({ status: 409, json: { detail: "A doca mudou. Confira o pátio antes de continuar." } });
  });

  await page.goto(doca);
  const time = page.locator(".sync time");
  const quality = page.getByRole("status", { name: "Qualidade da leitura" });
  const book = page.getByRole("button", { name: "Reservar doca" });
  await expect(time).toBeVisible();
  await expect(quality).toHaveText("Atualizada");
  const confirmed = await time.getAttribute("datetime");
  await page.getByLabel("Reservar para").fill("Transporte Ipê");
  await book.click();
  await expect(quality).toHaveText("Desatualizada");
  await expect(time).toHaveAttribute("datetime", confirmed);
  await expect(book).toBeDisabled();
  await expect(page.getByRole("alert")).toContainText("A doca mudou");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  unavailable = false;
  await page.getByRole("button", { name: "Atualizar leitura" }).click();
  await expect(quality).toHaveText("Atualizada");
  await expect(page.getByRole("button", { name: "Iniciar descarga" })).toBeEnabled();
  expect(commands).toBe(1);
});

test("Doca · um poll iniciado antes da reserva não desfaz a nova leitura confirmada", async ({ page }) => {
  let board = free;
  let held = false;
  let release;
  const holdRead = new Promise(resolve => { release = resolve; });
  let sawRead;
  const readStarted = new Promise(resolve => { sawRead = resolve; });
  await page.route("**/api/yard", async route => {
    if (held) {
      held = false;
      sawRead();
      await holdRead;
      await route.fulfill({ json: fresh(free), headers: { "x-doca-fixture": "previous-read" } });
      return;
    }
    await route.fulfill({ json: fresh(board) });
  });
  await page.route("**/api/docks/D1/moves", route => {
    board = booked;
    return route.fulfill({ json: booked.docks[0] });
  });

  await page.goto(doca);
  await expect(page.locator(".sync time")).toBeVisible();
  await page.getByLabel("Reservar para").fill("Transportes Aurora");
  held = true;
  try {
    await page.getByRole("button", { name: "Atualizar leitura" }).click();
    await readStarted;
    await page.getByRole("button", { name: "Reservar doca" }).click();
    await expect(page.getByRole("button", { name: "Iniciar descarga" })).toBeEnabled();
    const previousReply = page.waitForResponse(res => res.headers()["x-doca-fixture"] === "previous-read");
    release();
    await (await previousReply).finished();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  } finally {
    release();
  }
  await expect(page.getByRole("button", { name: "Iniciar descarga" })).toBeEnabled();
  await expect(page.getByLabel("Reservar para")).toHaveCount(0);
});
