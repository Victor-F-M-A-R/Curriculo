import { test, expect } from '@playwright/test';

const farol = process.env.FAROL_URL ?? 'http://127.0.0.1:8083';
const input = page => page.getByLabel('Pergunte aos manuais do campus');
const submit = page => page.getByRole('button', { name: 'Consultar', exact: true });
async function ready(page) {
  await page.goto(farol);
  await expect(page.getByRole('button', {name:/Quantas falhas na WAN/})).toBeEnabled();
}
async function ask(page, query) {
  await input(page).fill(query);
  await submit(page).click();
  await expect(submit(page)).toBeEnabled();
}

test('farol · missing attribute refuses while directory paraphrase preserves both facts', async ({page}) => {
  await ready(page);
  await ask(page, 'Qual é a marca do projetor que usa o cabo HDMI da mesa?');
  await expect(page.locator('.result-head')).toContainText('SEM EVIDÊNCIA SUFICIENTE');
  await expect(page.locator('.result .source')).toHaveCount(0);
  await ask(page, 'Em qual diretório e com qual identificador devo testar a cópia recuperada antes de devolvê-la?');
  await expect(page.locator('.answer')).toContainText('pasta temporária');
  await expect(page.locator('.answer')).toContainText('número do chamado');
  await page.getByRole('button', {name:/RB-07#s2/}).click();
  await expect(page.locator('mark')).toContainText('pasta temporária');
});

test('farol · interrupted request unlocks form and preserves a usable session', async ({page}) => {
  await ready(page);
  await page.route('**/api/ask', route => route.abort('failed'), {times:1});
  await ask(page, 'Onde fica o cabo HDMI reserva?');
  await expect(page.getByRole('alert')).toContainText('conexão foi interrompida');
  await ask(page, 'Onde fica o cabo HDMI reserva?');
  await expect(page.locator('.answer')).toContainText('armário A2');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('farol · deadline releases form without silently retrying a mutation', async ({page}) => {
  await ready(page);
  await page.clock.install();
  let requests = 0;
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  await page.route('**/api/ask', async route => {
    requests++;
    await pending;
    await route.abort().catch(() => {});
  });
  await input(page).fill('Onde fica o cabo HDMI reserva?');
  await submit(page).click();
  await expect.poll(() => requests).toBe(1);
  await page.clock.fastForward(50_100);
  await expect(page.getByRole('alert')).toContainText('demorou demais');
  await expect(submit(page)).toBeEnabled();
  expect(requests).toBe(1);
  release();
});

test('farol · pending question blocks reset and repeated shortcut; history reload works', async ({page}) => {
  await ready(page);
  await ask(page, 'Onde fica o cabo HDMI reserva?');
  let release;
  let requests = 0;
  const pending = new Promise(resolve => { release = resolve; });
  await page.route('**/api/ask', async route => {
    requests++;
    await pending;
    await route.continue();
  });
  await input(page).fill('Qual é o percentual de toner para pedir suprimento?');
  await input(page).press('Control+Enter');
  await input(page).press('Control+Enter');
  await expect.poll(() => requests).toBe(1);
  await page.getByRole('button', {name:'Histórico',exact:true}).click();
  await expect(page.getByRole('button', {name:'Apagar histórico',exact:true})).toBeDisabled();
  release();
  await expect(page.getByRole('button', {name:'Atualizar histórico'})).toBeEnabled();
  await page.getByRole('button', {name:'Atualizar histórico'}).click();
  await expect(page.getByRole('button', {name:'Qual é o percentual de toner para pedir suprimento?'})).toBeVisible();
  await page.getByRole('button', {name:'Apagar histórico',exact:true}).click();
  await page.getByRole('button', {name:'Confirmar',exact:true}).click();
  await expect(page.getByText('Nenhuma consulta registrada.')).toBeVisible();
  await page.reload();
  await page.getByRole('button', {name:'Histórico',exact:true}).click();
  await expect(page.getByText('Nenhuma consulta registrada.')).toBeVisible();
});

test('farol · failed history refresh does not report a saved answer as lost', async ({page}) => {
  await ready(page);
  await page.route('**/api/runs', route => route.abort('failed'), {times:1});
  await ask(page, 'Onde fica o cabo HDMI reserva?');
  await expect(page.locator('.answer')).toContainText('armário A2');
  await expect(page.getByRole('alert')).toContainText('A resposta foi salva');
  await page.getByRole('button', {name:'Histórico',exact:true}).click();
  await page.getByRole('button', {name:'Atualizar histórico'}).click();
  await expect(page.getByRole('button', {name:'Onde fica o cabo HDMI reserva?'})).toBeVisible();
});

test('farol · another browser cannot read or review a private run', async ({page,browser}) => {
  await ready(page);
  const own = await page.request.post(farol+'/api/ask', {
    headers:{'X-Farol-Client':'desk'}, data:{query:'Onde fica o cabo HDMI reserva?'},
  });
  const run = await own.json();
  const other = await browser.newContext();
  try {
    expect((await other.request.get(farol+'/api/runs/'+run.id)).status()).toBe(404);
    expect((await other.request.post(farol+'/api/runs/'+run.id+'/review', {
      headers:{'X-Farol-Client':'desk'},
    })).status()).toBe(404);
    expect(await (await other.request.get(farol+'/api/runs')).json()).toEqual([]);
  } finally {
    await other.close();
  }
});
