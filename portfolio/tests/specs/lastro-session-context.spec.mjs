import { test, expect } from "@playwright/test";

const base = process.env.LASTRO_URL ?? "http://127.0.0.1:8082";
const client = { "X-Lastro-Client": "desk" };

for (const operation of ["review", "import"]) {
  test(`Lastro · troca em outra aba impede ${operation} na mesa inesperada`, async ({ page, context }) => {
    const suffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    const a = "qa-a-" + suffix;
    const b = "qa-b-" + suffix;
    const password = "Synthetic-password-2026";
    expect((await page.request.post(base + "/api/register", { headers: client, data: { user: a, password } })).status()).toBe(204);
    await page.goto(base);
    await expect(page.getByRole("button", { name: a, exact: true })).toBeVisible();
    await expect(page.locator(".desk")).toBeVisible();

    // A real second page shares the same cookie jar; its login must not redirect the old page's write.
    const other = await context.newPage();
    try {
      await other.goto(base);
      await other.getByRole("button", { name: a, exact: true }).click();
      await other.getByRole("button", { name: "Criar conta", exact: true }).click();
      await other.getByLabel("Usuário", { exact: true }).fill(b);
      await other.getByLabel("Senha", { exact: true }).fill(password);
      await other.getByRole("button", { name: "Criar minha mesa", exact: true }).click();
      await expect(other.getByRole("button", { name: b, exact: true })).toBeVisible();

      const response = page.waitForResponse(result => result.url().includes("/api/book/") && result.request().method() === "POST");
      const note = "Esta decisão pertence somente à mesa original A.";
      if (operation === "review") {
        await page.getByLabel("Justificativa de revisão").fill(note);
        await page.getByRole("button", { name: "Registrar revisão" }).click();
      } else {
        await page.getByRole("button", { name: "Importar extrato" }).click();
        await page.getByLabel("Conteúdo do lote").fill("referencia;data;recebido\nOLD-TAB-01;2026-11-20;1,00");
        await page.getByRole("button", { name: "Conciliar lote" }).click();
      }
      const result = await response;
      const rowsB = await (await other.request.get(base + "/api/book")).json();
      // Check persistence before the message: the baseline demonstrably writes into B.
      expect(rowsB.find(row => row.reference === "REP-1043").reason).toBeNull();
      expect(rowsB.some(row => row.reference === "OLD-TAB-01")).toBe(false);
      expect(result.status()).toBe(409);
      await expect(page.getByRole("alert")).toContainText("conta mudou em outra aba");
      await expect(page.locator(".desk")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Importar extrato" })).toBeDisabled();

      await page.getByRole("button", { name: "Carregar mesa atual", exact: true }).click();
      await expect(page.getByRole("button", { name: b, exact: true })).toBeVisible();
      await expect(page.locator(".detail .badge")).toHaveText("Divergente");
      expect((await (await page.request.get(base + "/api/book/events")).json()).filter(event => event.kind !== "opened")).toHaveLength(0);

      // Returning to A also confirms that the rejected operation was not automatically replayed.
      expect((await page.request.post(base + "/api/login", { headers: client, data: { user: a, password } })).status()).toBe(204);
      expect((await (await page.request.get(base + "/api/book/events")).json()).filter(event => event.kind !== "opened")).toHaveLength(0);
    } finally { await other.close(); }
  });
}

test("Lastro · contexto obrigatório rejeita clientes antigos e mesa divergente antes de gravar", async ({ playwright }) => {
  const a = await playwright.request.newContext({ baseURL: base, extraHTTPHeaders: client });
  const b = await playwright.request.newContext({ baseURL: base, extraHTTPHeaders: client });
  try {
    for (const context of [a, b]) expect((await context.post("/api/session/demo", { data: {} })).status()).toBe(204);
    const workspaceA = (await (await a.get("/api/session")).json()).workspace;
    const workspaceB = (await (await b.get("/api/session")).json()).workspace;
    expect(workspaceA).toMatch(/^[a-f0-9]{32}$/);
    expect(workspaceB).not.toBe(workspaceA);
    const csv = "referencia;data;recebido\nCONTEXT-01;2026-11-20;1,00";
    for (const path of ["/api/book/import", "/api/book/REP-1043/review"]) {
      const data = path.endsWith("import") ? { csv } : { note: "Decisão ligada à sessão apresentada." };
      expect((await a.post(path, { data })).status()).toBe(428);
      expect((await a.post(path, { headers: { "X-Lastro-Workspace": "" }, data })).status()).toBe(428);
      const conflict = await b.post(path, { headers: { "X-Lastro-Workspace": workspaceA }, data });
      expect(conflict.status()).toBe(409);
      expect((await conflict.json()).code).toBe("workspace_changed");
      expect((await a.post(path, { headers: { "X-Lastro-Workspace": workspaceA + ", " + workspaceA }, data })).status()).toBe(409);
    }
    expect((await b.get("/api/book", { headers: { "X-Lastro-Workspace": workspaceA } })).status()).toBe(409);
    for (const context of [a, b]) expect((await (await context.get("/api/book/events")).json()).filter(event => event.kind !== "opened")).toHaveLength(0);

    const correct = { "X-Lastro-Workspace": workspaceA };
    expect((await a.post("/api/book/import", { headers: correct, data: { csv } })).status()).toBe(200);
    expect((await (await a.post("/api/book/import", { headers: correct, data: { csv } })).json()).replay).toBe(true);
    expect((await a.post("/api/book/REP-1043/review", { headers: correct, data: { note: "Decisão ligada à sessão apresentada." } })).status()).toBe(204);
    expect((await (await a.get("/api/book/events")).json()).filter(event => event.kind !== "opened")).toHaveLength(2);
    expect((await (await b.get("/api/book/events")).json()).filter(event => event.kind !== "opened")).toHaveLength(0);
  } finally { await a.dispose(); await b.dispose(); }
});
