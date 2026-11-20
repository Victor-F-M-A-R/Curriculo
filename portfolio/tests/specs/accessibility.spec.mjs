import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function check(page, info, state) {
  const result = await new AxeBuilder({ page }).withTags([
    "wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa",
  ]).analyze();
  await info.attach(`${state}-accessibility`, {
    body: JSON.stringify({ violations: result.violations, incomplete: result.incomplete }, null, 2),
    contentType: "application/json",
  });
  expect(result.violations.map(v => ({ id: v.id, impact: v.impact,
    nodes: v.nodes.map(n => ({ target: n.target, reason: n.failureSummary })) }))).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await info.attach(`${state}-screen`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
}

const apps = {
  Doca: process.env.DOCA_URL || "http://127.0.0.1:8081",
  Lastro: process.env.LASTRO_URL || "http://127.0.0.1:8082",
  Farol: process.env.FAROL_URL || "http://127.0.0.1:8083",
  Rastro: process.env.RASTRO_URL || "http://127.0.0.1:8084",
};
for (const [name, url] of Object.entries(apps)) {
  for (const width of [1280, 320]) {
    test(`${name} · acessibilidade e reflow a ${width}px`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(url);
      await expect(page.locator("h1")).toBeVisible();
      if (name === "Rastro") await expect(page.locator("#vehicle-list button").first()).toBeVisible();
      if (name === "Doca") await expect(page.getByLabel("Reservar para")).toBeVisible();
      if (name === "Farol") {
        await page.getByLabel("Pergunte aos manuais do campus").fill("Onde fica o cabo HDMI de reserva?");
        await expect(page.getByRole("button", { name: "Consultar", exact: true })).toBeEnabled();
      }
      await check(page, info, `${name}-${width}`);
      if (name === "Lastro") {
        await page.getByRole("button", { name: "Importar extrato" }).click();
        await check(page, info, `Lastro-dialog-${width}`);
        await page.keyboard.press("Escape");
        await expect(page.getByRole("button", { name: "Importar extrato" })).toBeFocused();
      }
      if (name === "Farol") {
        await page.getByLabel("Pergunte aos manuais do campus").fill("Onde fica o cabo HDMI de reserva?");
        await page.getByRole("button", { name: "Consultar", exact: true }).click();
        await expect(page.locator(".answer")).toBeVisible();
        await check(page, info, `Farol-answer-${width}`);
      }
    });
  }
}
