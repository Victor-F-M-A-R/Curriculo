import { test, expect } from "@playwright/test";

test("Lastro · confirmação perdida libera a tela e conserva o lote já gravado", async ({ page }) => {
  let first = true;
  let release;
  const delayedResponse = new Promise(resolve => { release = resolve; });
  await page.route("**/api/book/import", async route => {
    if (!first) return route.continue();
    first = false;
    // The real API commits the batch; only its response to the browser is delayed.
    const response = await route.fetch();
    await delayedResponse;
    try {
      await route.fulfill({ response });
    } catch {
      // The application may already have aborted its request at the deadline.
    }
  });

  async function importSample() {
    await page.getByRole("button", { name: "Importar extrato" }).click();
    await page.getByRole("button", { name: "Usar extrato de exemplo" }).click();
    await page.getByRole("button", { name: "Conciliar lote" }).click();
  }

  try {
    await page.goto(process.env.LASTRO_URL ?? "http://127.0.0.1:8082");
    await importSample();
    const dialog = page.getByRole("dialog", { name: "Importar extrato" });
    await expect(dialog.getByRole("alert")).toContainText("O resultado pode já ter sido gravado", { timeout: 15_000 });
    await expect(dialog.getByRole("alert")).toContainText("antes de tentar novamente");
    await expect(page.getByRole("button", { name: "Conciliar lote" })).toBeEnabled();
    await dialog.getByRole("button", { name: "Fechar", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    release();
    await page.reload();
    const row = page.getByRole("button", { name: /Forma Oficina.*REP-1048/ });
    await expect(row).toContainText("Divergente");
    await importSample();
    await expect(page.getByRole("status")).toContainText("já havia sido importado");
    const events = await (await page.request.get((process.env.LASTRO_URL ?? "http://127.0.0.1:8082") + "/api/book/events")).json();
    expect(events.filter(event => event.kind === "import")).toHaveLength(1);
  } finally {
    release();
  }
});
