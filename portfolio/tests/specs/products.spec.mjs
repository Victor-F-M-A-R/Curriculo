import { test, expect } from "@playwright/test";
const doca = process.env.DOCA_URL ?? "http://127.0.0.1:8081";
const lastro = process.env.LASTRO_URL ?? "http://127.0.0.1:8082";
const farol = process.env.FAROL_URL ?? "http://127.0.0.1:8083";

test("pátio · reservar, iniciar e liberar mantêm um único histórico", async ({ page }) => {
  await page.goto(doca);
  await page.getByLabel("Reservar para").fill("Transporte Ipê");
  await page.getByRole("button", { name: /Reservar doca/ }).click();
  await expect.poll(async () => {
    const gate = process.env.GATE_URL ?? "http://127.0.0.1:8085";
    const response = await page.request.get(gate + "/api/field");
    const board = await response.json();
    return board.docks.find((dock) => dock.id === "D1")?.status;
  }, { timeout: 12000 }).toBe("booked");
  await page.getByRole("button", { name: /Iniciar descarga/ }).click();
  await page.getByRole("button", { name: /Liberar doca/ }).click();
  await expect(page.getByLabel("Reservar para")).toBeVisible();
  await expect(page.locator(".journal .entry").filter({ hasText: "Transporte Ipê" })).toHaveCount(3);
});
test("conciliação · importar e repetir preserva valores, revisar deixa trilha Blazor", async ({
  page,
}) => {
  await page.goto(lastro);
  async function importExample() {
    await page.getByRole("button", { name: "Importar extrato" }).click();
    await page.getByRole("button", { name: "Usar extrato de exemplo" }).click();
    await page.getByRole("button", { name: "Conciliar lote" }).click();
  }
  await importExample();
  await expect(page.getByRole("status")).toContainText("2 repasses importados");
  await importExample();
  await expect(page.getByRole("status")).toContainText("já havia sido importado");
  await page.getByRole("button", { name: /Forma Oficina.*REP-1048/ }).click();
  await page.getByLabel("Justificativa de revisão").fill("Taxa de serviço confirmada no extrato.");
  await page.getByRole("button", { name: /Registrar revisão/ }).click();
  await expect(page.locator(".detail .badge")).toHaveText("Revisado");
  await page.getByRole("link", { name: "Abrir trilha de auditoria" }).click();
  await expect(page.getByRole("heading", { name: "Trilha de eventos." })).toBeVisible();
  await expect(page.getByText("Taxa de serviço confirmada no extrato.")).toBeVisible();
});
test("conta · novo usuário pode sair, entrar e recuperar a mesma mesa", async ({ page }) => {
  const name = "analista-" + crypto.randomUUID().slice(0, 8),
    password = "teste-interativo-2026";
  await page.goto(lastro);
  await page.getByRole("button", { name: "Mesa demo" }).click();
  await page.getByRole("button", { name: "Criar conta", exact: true }).click();
  await page.getByLabel("Usuário").fill(name);
  await page.getByLabel("Senha").fill(password);
  await page.getByRole("button", { name: "Criar minha mesa" }).click();
  await page.getByRole("button", { name, exact: true }).click();
  await page.getByRole("button", { name: "Sair da conta" }).click();
  await page.getByRole("button", { name: "Mesa demo" }).click();
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.getByLabel("Usuário").fill(name);
  await page.getByLabel("Senha").fill(password);
  await page.getByRole("button", { name: "Acessar minha mesa" }).click();
  await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
});
test("consulta · citação navegável, abstenção e fila de revisão", async ({ page }) => {
  await page.goto(farol);
  await page.getByRole("button", { name: /Quantas falhas na WAN/ }).click();
  await expect(page.locator(".answer")).toContainText("três falhas");
  await page.getByRole("button", { name: /RB-01#s1/ }).click();
  await expect(page.getByRole("heading", { name: "Quando o link de reserva assume" })).toBeVisible();
  await page.getByRole("button", { name: "Consulta", exact: true }).click();
  await page
    .getByLabel("Pergunte aos manuais do campus")
    .fill("Qual é o preço mensal do contrato da WAN Cedro?");
  await page.getByRole("button", { name: "Consultar", exact: true }).click();
  await expect(page.locator(".result-head")).toContainText("SEM EVIDÊNCIA SUFICIENTE");
  await page.getByRole("button", { name: /Encaminhar para revisão/ }).click();
  await expect(page.locator(".delivery")).toBeVisible();
});
for (const [name, url] of Object.entries({ Doca: doca, Lastro: lastro, Farol: farol })) {
  test(name + " · navegação mobile sem extravasamento", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(url);
    await expect(page.locator("h1")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
      true,
    );
  });
}
