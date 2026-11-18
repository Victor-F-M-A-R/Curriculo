/** Record real, disposable product sessions. Run after installing dependencies in portfolio/tests. */
import { createRequire } from "node:module";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { setTimeout as pause } from "node:timers/promises";

const require = createRequire(new URL("../tests/package.json", import.meta.url));
const { chromium, expect } = require("playwright/test");
const { values } = parseArgs({ options: { out: { type: "string" }, only: { type: "string", multiple: true } } });
if (!values.out) throw Error("Use --out /diretorio/das/capturas");
const output = path.resolve(values.out);
const projects = {
  doca: [process.env.DOCA_URL || "http://127.0.0.1:8081", doca],
  lastro: [process.env.LASTRO_URL || "http://127.0.0.1:8082", lastro],
  farol: [process.env.FAROL_URL || "http://127.0.0.1:8083", farol],
  rastro: [process.env.RASTRO_URL || "http://127.0.0.1:8084", rastro],
};
const selected = values.only ?? Object.keys(projects);
if (selected.some((key) => !(key in projects))) throw Error("Projeto inválido.");

async function scrollToItem(locator, block = "center") {
  await locator.evaluate((node, pos) => node.scrollIntoView({ block: pos, behavior: "instant" }), block);
}

async function click(locator) {
  await locator.hover();
  await pause(250);
  await locator.click();
  await pause(350);
}

async function type(locator, text) {
  await locator.fill("");
  await locator.pressSequentially(text, { delay: 26 });
}

async function openPage(page, origin) {
  await page.goto(origin, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

// Images are sampled while Chromium performs the operation. Failed assertions invalidate the take.
async function record(page, dir, slug, operation) {
  const location = path.join(dir, slug);
  await mkdir(location, { recursive: true });
  let finished = false;
  const film = (async () => {
    let sequence = 0;
    while (!finished) {
      const start = Date.now();
      const number = String(sequence++).padStart(4, "0");
      await page.screenshot({ path: path.join(location, number + ".jpg"), type: "jpeg", quality: 88, timeout: 15000 });
      await pause(Math.max(0, 120 - (Date.now() - start)));
    }
    return sequence;
  })();
  try {
    await pause(400);
    await operation();
    await pause(850);
  } finally {
    finished = true;
    await film;
  }
}

async function doca(page, take) {
  const carrier = "Transporte Horizonte";
  const reserve = page.getByLabel("Reservar para");
  await expect(reserve).toBeEnabled();
  await take("A", async () => {
    await type(reserve, carrier);
    await click(page.getByRole("button", { name: /Reservar doca/ }));
    await expect(page.getByRole("button", { name: /Iniciar descarga/ })).toBeEnabled();
  });
  await take("B", async () => {
    await click(page.getByRole("button", { name: /Iniciar descarga/ }));
    await expect(page.getByRole("button", { name: /Liberar doca/ })).toBeEnabled();
  });
  await take("C", async () => {
    await click(page.getByRole("button", { name: /Liberar doca/ }));
    await expect(reserve).toBeEnabled();
    const changed = page.locator(".journal .entry").filter({ hasText: carrier });
    await expect(changed.first()).toBeVisible();
    await scrollToItem(page.getByRole("heading", { name: "Livro de movimentos" }), "start");
    if ((await changed.count()) < 3) throw Error("A demonstração precisa das três movimentações no histórico.");
  });
}

async function lastro(page, take) {
  async function importSample() {
    await click(page.getByRole("button", { name: "Importar extrato" }));
    await click(page.getByRole("button", { name: "Usar extrato de exemplo" }));
    await click(page.getByRole("button", { name: "Conciliar lote" }));
  }
  await take("A", async () => {
    await importSample();
    await expect(page.getByRole("status")).toContainText("2 repasses importados");
  });
  await take("B", async () => {
    await importSample();
    await expect(page.getByRole("status")).toContainText("já havia sido importado");
    await click(page.getByRole("button", { name: /Forma Oficina.*REP-1048/ }));
    await expect(page.locator(".detail")).toContainText("17,50");
  });
  await take("C", async () => {
    await type(page.getByLabel("Justificativa de revisão"), "Taxa de serviço conferida no extrato.");
    await click(page.getByRole("button", { name: /Registrar revisão/ }));
    await expect(page.locator(".detail .badge")).toHaveText("Revisado");
    await click(page.getByRole("link", { name: "Abrir trilha de auditoria" }));
    await expect(page.getByText("Taxa de serviço conferida no extrato.").first()).toBeVisible();
  });
}

async function farol(page, take) {
  await take("A", async () => {
    await type(page.getByLabel("Pergunte aos manuais do campus"), "Quem dá o aceite de uma mudança programada e quando podemos executá-la?");
    await click(page.getByRole("button", { name: "Consultar", exact: true }));
    await expect(page.locator(".answer")).toContainText("quarta-feira");
    await scrollToItem(page.locator(".result"), "center");
  });
  await take("B", async () => {
    await click(page.getByRole("button", { name: /RB-06#s1/ }));
    const heading = page.getByRole("heading", { name: /Aprovação e janela de manutenção/ });
    await expect(heading).toBeVisible();
    await scrollToItem(heading);
  });
  await take("C", async () => {
    await click(page.getByRole("button", { name: "Consulta", exact: true }));
    await type(page.getByLabel("Pergunte aos manuais do campus"), "Qual é o preço mensal do contrato da WAN Cedro?");
    await click(page.getByRole("button", { name: "Consultar", exact: true }));
    await expect(page.locator(".result-head")).toContainText(/sem evidência suficiente/i);
    await click(page.getByRole("button", { name: /Encaminhar para revisão/ }));
    await expect(page.locator(".delivery")).toBeVisible();
    await scrollToItem(page.locator(".delivery"));
  });
}

async function rastro(page, take) {
  const simulate = page.getByRole("button", { name: /simular chegada/i });
  await expect(simulate).toBeEnabled();
  await take("A", async () => {
    await scrollToItem(simulate);
    await simulate.hover();
    await pause(1150);
  });
  await take("B", async () => {
    const response = page.waitForResponse(r => new URL(r.url()).pathname === "/api/demo/scenario" && r.request().method() === "POST");
    await click(simulate);
    if (!(await response).ok()) throw Error("O cenário real do Rastro falhou.");
    await expect(page.locator("#scenario-result")).toContainText(/1 leitura atrasada/i);
    await scrollToItem(page.locator("#scenario-result"));
  });
  await take("C", async () => {
    await click(simulate);
    await expect(page.locator("#scenario-result")).toContainText(/3 reenvios/i);
    await scrollToItem(page.locator("#event-list"));
    await pause(1200);
  });
}

await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_PATH && { executablePath: process.env.CHROMIUM_PATH }),
});
try {
  for (const key of selected) {
    const [origin, operations] = projects[key];
    const dir = await mkdtemp(path.join(output, "." + key + "-"));
    const context = await browser.newContext({
      viewport: { width: 1360, height: 688 }, locale: "pt-BR", timezoneId: "America/Sao_Paulo",
      reducedMotion: "reduce",
    });
    try {
      const page = await context.newPage();
      await openPage(page, origin);
      await page.getByRole("heading", { level: 1 }).first().waitFor();
      if (key === "doca") await expect(page.getByLabel("Reservar para")).toBeEnabled();
      if (key === "lastro") await expect(page.getByRole("button", { name: /Casa Botânica/ }).first()).toBeVisible();
      if (key === "farol") await expect(page.getByRole("button", { name: /Quantas falhas na WAN/ })).toBeVisible();
      if (key === "rastro") await expect(page.getByRole("button", { name: /Simular chegada/i })).toBeEnabled();
      await page.screenshot({ path: path.join(dir, "poster.png") });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: path.join(dir, "mobile.png") });
      await page.setViewportSize({ width: 1360, height: 688 });
      await operations(page, (slug, work) => record(page, dir, slug, work));
      await writeFile(path.join(dir, "manifest.json"), JSON.stringify({ project: key, source: "chromium", phases: ["A","B","C"] }) + "\n");
      const ready = path.join(output, key);
      await rm(ready, { recursive: true, force: true });
      await rename(dir, ready);
      console.log("Captura validada:", key);
    } finally {
      await context.close();
      await rm(dir, { recursive: true, force: true });
    }
  }
} finally {
  await browser.close();
}
