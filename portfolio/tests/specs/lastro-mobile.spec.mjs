import { test, expect } from "@playwright/test";

test("conciliação no celular · seleção e retorno pelo teclado, auditoria filtrada", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(process.env.LASTRO_URL ?? "http://127.0.0.1:8082");
  await page.getByRole("button", { name: "Importar extrato" }).click();
  await page.getByRole("button", { name: "Usar extrato de exemplo" }).click();
  await page.getByRole("button", { name: "Conciliar lote" }).click();
  const selected = page.getByRole("button", { name: /Forma Oficina.*REP-1048/ });
  await selected.click();
  await expect(page.locator("#entry-merchant")).toBeFocused();
  await page.getByRole("button", { name: "Voltar ao repasse selecionado" }).click();
  await expect(selected).toBeFocused();
  await page.keyboard.press("Enter");
  await page.getByLabel("Justificativa de revisão").fill("Diferença confirmada com o extrato de teste.");
  await page.getByRole("button", { name: /Registrar revisão/ }).click();
  await expect(page.locator(".detail .badge")).toHaveText("Revisado");
  await page.getByRole("link", { name: "Abrir trilha de auditoria" }).click();
  await expect(page.getByLabel("Referência exata")).toHaveValue("REP-1048");
  await page.getByLabel("Tipo de evento").selectOption("review");
  await page.getByRole("button", { name: "Filtrar" }).click();
  await expect(page.getByText("Diferença confirmada com o extrato de teste.")).toBeVisible();
});
