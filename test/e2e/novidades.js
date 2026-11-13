/**
 * As novidades de ponta a ponta, num celular simulado: montar o mês em 1 minuto, cartão de crédito com fatura
 * e pagamento, lembretes no Início e avisos do celular (notificações de verdade, pelo service worker).
 *
 * Uso: node test/e2e/novidades.js [pasta-para-fotos]
 * Precisa do puppeteer-core (npm install) e do Chrome. Outro caminho: variável CHROME_PATH.
 */
const puppeteer = require('puppeteer-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const SHOTS = process.argv[2] ? path.resolve(process.argv[2]) : null;
const PHONE = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost');
  const file = path.join(ROOT, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    response.writeHead(404).end();
    return;
  }
  let body = fs.readFileSync(file);
  // Sem Supabase: este teste não fala com a nuvem.
  if (url.pathname === '/js/config.js') body = body.toString().replace(/supabaseUrl: '[^']*'/, "supabaseUrl: ''").replace(/supabaseKey: '[^']*'/, "supabaseKey: ''");
  response.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  response.end(body);
});

let page;
let passed = 0;
const failures = [];
const errors = [];

async function step(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (error) {
    failures.push(name);
    console.log(`FALHOU ${name}\n       ${String(error.message).split('\n').slice(0, 4).join('\n       ')}`);
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach((d) => d.remove())).catch(() => {});
  }
}

const click = (label, scope = 'body') => page.evaluate((wanted, root) => {
  const nodes = [...document.querySelector(root).querySelectorAll('button, a, label')].filter((n) => n.getClientRects().length);
  const node = nodes.find((n) => n.textContent.trim() === wanted) || nodes.find((n) => n.textContent.trim().includes(wanted));
  if (!node) throw new Error(`não achei "${wanted}"`);
  node.click();
}, label, scope);

/** Preenche o campo pelo texto do rótulo, dentro do diálogo aberto. */
const fill = (label, value) => page.evaluate((wanted, text) => {
  const labelNode = [...document.querySelectorAll('dialog[open] label')].find((l) => l.textContent.trim().startsWith(wanted));
  if (!labelNode) throw new Error(`não achei o campo "${wanted}"`);
  const input = document.getElementById(labelNode.htmlFor);
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}, label, value);

const shot = async (name) => {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, name) });
};

(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const URL_APP = `http://localhost:${server.address().port}/`;
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-first-run', '--hide-scrollbars'] });
  const context = browser.defaultBrowserContext();
  await context.overridePermissions(URL_APP.replace(/\/$/, ''), ['notifications']);
  page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.setViewport(PHONE);
  await page.goto(URL_APP, { waitUntil: 'networkidle0' });

  console.log('\nMontar meu mês');
  await step('a boas-vindas oferece montar o mês, e as respostas viram contas fixas e orçamentos', async () => {
    await click('Montar meu mês em 1 minuto');
    await page.waitForSelector('dialog[open] .setup-form');
    await shot('novidades-1-montar-mes.png');
    await fill('Quanto você tem na conta hoje?', '1500,00');
    await fill('Quanto você recebe por mês?', '4200,00');
    await fill('Em que dia cai?', '5');
    await fill('Quanto paga de aluguel', '1300,00');
    await fill('Em que dia vence?', String(new Date().getDate()));
    await fill('Quanto quer gastar com mercado', '800');
    await fill('E com lazer?', '300');
    await click('Montar meu mês', 'dialog[open] .dialog-foot');
    await page.waitForSelector('.view-home');
    const state = await page.evaluate(() => FM.app.store.state);
    assert.equal(state.onboarded, true);
    assert.equal(state.accounts[0].initial, 150000);
    assert.deepEqual(state.recurring.map((r) => [r.desc, r.amount]).sort(), [['Aluguel', 130000], ['Salário', 420000]]);
    assert.equal(state.categories.find((c) => c.name === 'Mercado').budget, 80000);
    assert.equal(state.categories.find((c) => c.name === 'Lazer').budget, 30000);
    assert.ok(state.transactions.some((t) => t.desc === 'Aluguel' && !t.paid), 'o aluguel deste mês já aparece a pagar');
  });

  console.log('\nLembretes');
  await step('o Início mostra o aluguel que vence hoje em Lembretes', async () => {
    await page.goto(`${URL_APP}#/inicio`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('.reminders');
    assert.match(await page.$eval('.reminders', (n) => n.textContent), /Aluguel vence hoje/);
    await shot('novidades-2-lembretes.png');
  });

  console.log('\nCartão de crédito');
  await step('criar um cartão com fechamento, vencimento e limite', async () => {
    await page.goto(`${URL_APP}#/carteiras`, { waitUntil: 'networkidle0' });
    await click('Nova carteira');
    await page.waitForSelector('dialog[open] select');
    await fill('Nome', 'Nubank');
    await page.select('dialog[open] select', 'cartao');
    await fill('Dia em que a fatura fecha', '3');
    await fill('Dia em que vence', '10');
    await fill('Limite do cartão', '2000');
    await click('Criar carteira', 'dialog[open] .dialog-foot');
    await page.waitForFunction(() => FM.app.store.state.accounts.some((a) => a.type === 'cartao'));
    const card = await page.evaluate(() => FM.app.store.state.accounts.find((a) => a.type === 'cartao'));
    assert.deepEqual([card.name, card.closingDay, card.dueDay, card.limit], ['Nubank', 3, 10, 200000]);
  });

  await step('no formulário de lançamento, escolher o cartão mostra em qual fatura a compra cai e some o "Já paguei"', async () => {
    await page.evaluate(() => FM.txForm.open(FM.app.ctx, {}));
    await page.waitForSelector('dialog[open] .input-money');
    const cardId = await page.evaluate(() => FM.app.store.state.accounts.find((a) => a.type === 'cartao').id);
    await page.type('dialog[open] .input-money', '250,00');
    await page.evaluate(() => [...document.querySelectorAll('dialog[open] input[type=text]')][1].value = 'Tênis');
    await click('Lazer', 'dialog[open]');
    await page.select('dialog[open] .form-row select', cardId);
    await page.$eval('dialog[open] input[type=date]', (n) => { n.value = '2026-11-20'; n.dispatchEvent(new Event('change', { bubbles: true })); });
    const hint = await page.$eval('dialog[open] .card-hint', (n) => n.textContent);
    assert.equal(hint, 'Entra na fatura de dezembro, que vence 10 de dez.');
    assert.equal(await page.$eval('dialog[open] .check-line', (n) => !n.getClientRects().length || n.hidden), true);
    await shot('novidades-3-compra-no-cartao.png');
    await click('Salvar lançamento', 'dialog[open] .dialog-foot');
    await page.waitForFunction(() => FM.app.store.state.transactions.some((t) => t.desc === 'Tênis'));
    assert.equal(await page.evaluate(() => FM.app.store.state.transactions.find((t) => t.desc === 'Tênis').paid), true);
  });

  await step('Carteiras mostra a fatura e o limite; pagar a fatura vira transferência e a fatura fica paga', async () => {
    // Fixa "hoje" depois do fechamento de dezembro, para a fatura estar fechada e pronta para pagar.
    await page.evaluate(() => { FM.app.store.today = () => '2026-12-05'; });
    await page.goto(`${URL_APP}#/carteiras`, { waitUntil: 'networkidle0' });
    await page.evaluate(() => { FM.app.store.today = () => '2026-12-05'; FM.app.ctx.refresh(); });
    await page.waitForSelector('.card-bill');
    const text = await page.$eval('.card-bill', (n) => n.textContent);
    assert.match(text, /Fatura de dezembro/);
    assert.match(text, /Fechada/);
    assert.match(text, /250,00/);
    assert.match(text, /Limite disponível: R\$\s1\.750,00/);
    await shot('novidades-4-fatura.png');
    await click('Pagar fatura', '.card-bill');
    await page.waitForSelector('dialog[open] #form-pagar-fatura');
    await click('Confirmar pagamento', 'dialog[open] .dialog-foot');
    await page.waitForFunction(() => FM.app.store.state.transactions.some((t) => t.billMonth === '2026-12'));
    const pay = await page.evaluate(() => FM.app.store.state.transactions.find((t) => t.billMonth));
    assert.equal(pay.type, 'transfer');
    assert.equal(pay.amount, 25000);
    await page.evaluate(() => FM.app.ctx.refresh());
    assert.match(await page.$eval('.card-bill', (n) => n.textContent), /Paga|Aberta/);
  });

  console.log('\nAvisos no celular');
  await step('ligar os avisos em Ajustes mostra uma notificação de verdade para o que vence', async () => {
    await page.evaluate(() => { FM.app.store.today = () => FM.dates.today(); });
    await page.goto(`${URL_APP}#/ajustes`, { waitUntil: 'networkidle0' });
    await page.evaluate(() => navigator.serviceWorker.ready);
    await click('Ligados');
    await page.waitForFunction(() => FM.notifications.enabled(), { timeout: 5000 });
    await page.waitForFunction(async () => (await (await navigator.serviceWorker.ready).getNotifications()).length > 0, { timeout: 8000 });
    const titles = await page.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).map((n) => n.title));
    assert.ok(titles.some((t) => t === 'Aluguel vence hoje'), titles.join(' | '));
  });

  await step('o mesmo aviso não se repete no mesmo dia', async () => {
    const shown = await page.evaluate(() => FM.notifications.notifyDue());
    assert.equal(shown, 0);
  });

  await step('o service worker tem o plano dos próximos dias para avisar com o app fechado', async () => {
    const plan = await page.evaluate(async () => (await (await caches.open('lembretes-sobra')).match('lembretes/plano.json')).json());
    assert.ok(plan.items.some((i) => i.title === 'Aluguel vence hoje'));
    assert.ok(plan.items.every((i) => /^\d{4}-\d{2}-\d{2}$/.test(i.day)));
  });

  await step('nenhum erro de script', async () => {
    assert.deepEqual(errors, []);
  });

  await browser.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  console.log(`\n${passed} passaram, ${failures.length} falharam`);
  process.exit(failures.length ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
