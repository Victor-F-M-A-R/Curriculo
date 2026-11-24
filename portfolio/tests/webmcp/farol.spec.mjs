import { test, expect } from '@playwright/test';

const question = 'Quem dá o aceite de uma mudança programada e quando podemos executá-la?';
async function ready(page) {
  await page.goto('/');
  await page.getByText('Laboratório de agentes · WebMCP', { exact: true }).click();
  await expect(page.getByRole('status')).toContainText('5 ferramentas');
}
async function invoke(page, name, input = {}) {
  return page.evaluate(async ({ name, input }) => {
    const ctx = document.modelContext;
    const tool = (await ctx.getTools()).find(t => t.name === name && t.source === window);
    try { return { result: JSON.parse(await ctx.executeTool(tool, input)) }; }
    catch (error) { return { error: error.name }; }
  }, { name, input });
}

test('real polyfill exposes Tool getters and executes original handles', async ({ page }) => {
  await ready(page);
  const contract = await page.evaluate(async () => {
    const tools = await document.modelContext.getTools();
    const tool = tools.find(t => t.name === 'farol_ask');
    return { names: tools.map(t => t.name), json: JSON.stringify(tool), spread: Object.keys({ ...tool }),
      source: tool.source === window, schema: tool.inputSchema, annotations: tool.annotations };
  });
  expect(contract.names).toHaveLength(5);
  expect(contract.names.some(n => /review|erase|delete/.test(n))).toBe(false);
  expect(contract.json).toBe('{}');
  expect(contract.spread).toEqual([]);
  expect(contract.source).toBe(true);
  expect(contract.schema.additionalProperties).toBe(false);
  expect(contract.annotations.readOnlyHint).toBe(false);
  expect((await invoke(page, 'farol_catalog')).result).toHaveLength(8);
});

test('human rejection sends no write and cannot be bypassed with an approval argument', async ({ page }) => {
  await ready(page);
  let writes = 0;
  page.on('request', request => { if (request.method() === 'POST') writes++; });
  page.once('dialog', dialog => dialog.dismiss());
  expect((await invoke(page, 'farol_ask', { query: question })).result.status).toBe('cancelled');
  expect((await invoke(page, 'farol_ask', { query: question, approved: true })).error).toBe('OperationError');
  expect((await invoke(page, 'farol_history')).result).toEqual([]);
  expect(writes).toBe(0);
});

test('approved query reuses real API, renders evidence and retrieves exact source', async ({ page }) => {
  await ready(page);
  page.once('dialog', async dialog => {
    expect(dialog.message()).toContain(question);
    await dialog.accept();
  });
  await page.getByRole('button', { name: 'Solicitar consulta com aprovação' }).click();
  await expect(page.locator('.result .source').first()).toContainText('RB-06#s1');
  const runs = (await invoke(page, 'farol_history')).result;
  expect(runs).toHaveLength(1);
  const run = (await invoke(page, 'farol_run', { id: runs[0].id })).result;
  const source = (await invoke(page, 'farol_source', { citation: run.evidence[0].id })).result;
  expect(source.text).toContain(run.evidence[0].quote);
  expect(source.revision).toBe(run.evidence[0].revision);
  await expect(page.locator('.answer')).toHaveText(run.answer);
});

test('separate browser sessions cannot read or review each other’s run', async ({ browser }) => {
  const a = await browser.newContext(); const b = await browser.newContext();
  try {
    const pa = await a.newPage(); const pb = await b.newPage();
    await ready(pa); await ready(pb);
    pa.once('dialog', dialog => dialog.accept());
    const run = (await invoke(pa, 'farol_ask', { query: question })).result;
    expect((await invoke(pb, 'farol_history')).result).toEqual([]);
    expect((await invoke(pb, 'farol_run', { id: run.id })).error).toBe('OperationError');
    const response = await b.request.post(`/api/runs/${run.id}/review`, { headers: { 'X-Farol-Client': 'desk' } });
    expect(response.status()).toBe(404);
    const cookie = (await a.cookies()).find(c => c.name === 'farol-session');
    expect(cookie.httpOnly).toBe(true); expect(cookie.sameSite).toBe('Strict');
    expect(await pa.evaluate(() => document.cookie)).not.toContain('farol-session');
  } finally { await a.close(); await b.close(); }
});

test('out-of-scope query abstains; only operator control creates review', async ({ page }) => {
  await ready(page);
  page.once('dialog', dialog => dialog.accept());
  const run = (await invoke(page, 'farol_ask', { query: 'Qual é o preço mensal do contrato da WAN Cedro?' })).result;
  expect(run.state).toBe('abstained'); expect(run.evidence).toEqual([]); expect(run.delivery).toBeNull();
  await page.getByRole('button', { name: 'Encaminhar para revisão' }).click();
  await expect(page.locator('.result')).toContainText('Na fila local');
});

test('invalid arguments, path injection and unknown citations fail closed', async ({ page }) => {
  await ready(page);
  for (const [name, input] of [
    ['farol_history', { session: 'another-session' }], ['farol_catalog', { url: 'https://example.com' }],
    ['farol_ask', { query: 'x' }], ['farol_ask', { query: question, document: '../x' }],
    ['farol_source', { citation: 'RB-99#s1' }], ['farol_run', { id: '../catalog' }],
  ]) expect((await invoke(page, name, input)).error).toBe('OperationError');
});

test('same name re-registration cannot revive a stale Tool handle', async ({ page }) => {
  await ready(page);
  const result = await page.evaluate(async () => {
    const ctx = document.modelContext; const controller = new AbortController();
    await ctx.registerTool({ name: 'probe', description: 'Lifecycle probe', execute: () => ({ old: true }) }, { signal: controller.signal });
    const old = (await ctx.getTools()).find(t => t.name === 'probe');
    const nullable = old.inputSchema === null && old.annotations === null;
    controller.abort();
    const replacement = new AbortController();
    await ctx.registerTool({ name: 'probe', description: 'Replacement', execute: () => ({ old: false }) }, { signal: replacement.signal });
    try { await ctx.executeTool(old); return { stale: 'executed' }; }
    catch (error) { return { stale: error.name, nullable }; }
    finally { replacement.abort(); }
  });
  expect(result).toEqual({ stale: 'NotFoundError', nullable: true });
});

test('network failure does not retry a write and leaves session usable', async ({ page }) => {
  await ready(page);
  let attempts = 0;
  await page.route('**/api/ask', route => { attempts++; return route.abort(); }, { times: 1 });
  page.once('dialog', dialog => dialog.accept());
  expect((await invoke(page, 'farol_ask', { query: question })).error).toBe('OperationError');
  expect(attempts).toBe(1);
  expect((await invoke(page, 'farol_history')).result).toEqual([]);
});

test('caller cancellation prevents execution and shared lock rejects overlapping requests', async ({ page }) => {
  await ready(page);
  expect(await page.evaluate(async () => {
    const ctx = document.modelContext; const tool = (await ctx.getTools()).find(t => t.name === 'farol_ask');
    const controller = new AbortController(); controller.abort();
    try { await ctx.executeTool(tool, { query: 'Onde fica o cabo HDMI reserva?' }, { signal: controller.signal }); }
    catch (error) { return error.name; }
  })).toBe('AbortError');
  let release; const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/api/runs', async route => { await gate; await route.continue(); }, { times: 1 });
  const first = invoke(page, 'farol_history');
  await expect(page.locator('main')).toHaveAttribute('aria-busy', 'true');
  expect((await invoke(page, 'farol_catalog')).error).toBe('OperationError');
  release(); await first;
  expect((await invoke(page, 'farol_catalog')).result).toHaveLength(8);
});

test('desktop and mobile demo remain readable and keyboard accessible', async ({ page }, testInfo) => {
  await ready(page);
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByLabel('Pergunta do agente').focus();
    await expect(page.getByLabel('Pergunta do agente')).toBeFocused();
    await page.screenshot({ path: testInfo.outputPath(`webmcp-${width}.png`), fullPage: true });
  }
});
