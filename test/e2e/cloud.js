/**
 * Backup na nuvem de ponta a ponta, com vários "celulares" e um Supabase de mentira servido por este teste.
 * Prova o objetivo: trocar ou perder o celular não perde nenhum lançamento.
 *
 * Uso: node test/e2e/cloud.js [pasta-para-fotos]
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
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- O Supabase de mentira ---------- */

const db = { codes: new Map(), resets: 0, users: new Map(), vaults: new Map(), autoconfirm: true, recovers: [], passwordChanges: 0, deleted: [], tableMissing: false, noCreateAccount: false, created: 0 };
const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
const tokenFor = (user) => `${b64({ alg: 'none' })}.${b64({ sub: user.id, email: user.email, exp: Math.floor(Date.now() / 1000) + 3600 })}.assinatura`;
const session = (user) => ({ access_token: tokenFor(user), refresh_token: `renovar-${user.id}`, expires_in: 3600, token_type: 'bearer', user: { id: user.id, email: user.email } });

function userFromToken(header) {
  const token = (header || '').replace('Bearer ', '');
  try {
    const { sub } = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    return [...db.users.values()].find((u) => u.id === sub) || null;
  } catch {
    return null;
  }
}

function readBody(request) {
  return new Promise((resolve) => {
    let text = '';
    request.on('data', (c) => { text += c; });
    request.on('end', () => {
      try { resolve(JSON.parse(text || '{}')); } catch { resolve({}); }
    });
  });
}

async function fakeSupabase(request, response, url) {
  const body = request.method === 'GET' ? {} : await readBody(request);
  const json = (status, data) => {
    response.writeHead(status, { 'Content-Type': 'application/json' });
    response.end(data === undefined ? '' : JSON.stringify(data));
  };
  if (!request.headers.apikey) return json(401, { message: 'No API key' });
  const route = url.pathname.replace('/supabase', '');
  const grant = url.searchParams.get('grant_type');

  if (route === '/auth/v1/signup') {
    const existing = db.users.get(body.email);
    if (existing) return db.autoconfirm ? json(422, { error_code: 'user_already_exists' }) : json(200, { id: 'falso', email: body.email, identities: [] });
    if (String(body.password).length < 6) return json(422, { error_code: 'weak_password' });
    const user = { id: `u-${db.users.size + 1}`, email: body.email, password: body.password, confirmed: db.autoconfirm };
    db.users.set(body.email, user);
    return db.autoconfirm ? json(200, session(user)) : json(200, { id: user.id, email: user.email, identities: [{ id: 'x' }] });
  }
  if (route === '/auth/v1/token' && grant === 'password') {
    const user = db.users.get(body.email);
    if (!user || user.password !== body.password) return json(400, { error_code: 'invalid_credentials' });
    if (!user.confirmed) return json(400, { error_code: 'email_not_confirmed' });
    return json(200, session(user));
  }
  if (route === '/auth/v1/token' && grant === 'refresh_token') {
    const user = [...db.users.values()].find((u) => `renovar-${u.id}` === body.refresh_token);
    return user ? json(200, session(user)) : json(400, { error_code: 'refresh_token_not_found' });
  }
  if (route === '/auth/v1/recover') {
    db.recovers.push(body.email);
    return json(200, {});
  }
  if (route === '/auth/v1/logout') return json(204);
  if (route === '/rest/v1/rpc/create_account') {
    if (db.noCreateAccount) return json(404, { code: 'PGRST202' });
    const email = String(body.p_email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(200, { status: 'error', code: 'email_address_invalid' });
    if (String(body.p_password || '').length < 8) return json(200, { status: 'error', code: 'weak_password' });
    if (db.users.has(email)) return json(200, { status: 'error', code: 'user_already_exists' });
    db.users.set(email, { id: `u-${db.users.size + 1}`, email, password: body.p_password, confirmed: true });
    db.created++;
    return json(200, { status: 'ok' });
  }
  // Código de recuperação (no banco de verdade fica só embaralhado; aqui basta guardar).
  const normalizeCode = (code) => String(code || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (route === '/rest/v1/rpc/reset_password_with_code') {
    if (String(body.p_new_password || '').length < 8) return json(200, { status: 'error', code: 'weak_password' });
    const user = db.users.get(String(body.p_email || '').trim().toLowerCase());
    if (!user || !db.codes.has(user.id) || db.codes.get(user.id) !== normalizeCode(body.p_code)) return json(200, { status: 'error', code: 'invalid_recovery_code' });
    user.password = body.p_new_password;
    db.codes.delete(user.id);
    db.resets++;
    return json(200, { status: 'ok' });
  }
  if (route === '/rest/v1/vaults' && db.tableMissing) return json(404, { code: 'PGRST205', message: 'tabela não encontrada' });

  const user = userFromToken(request.headers.authorization);
  if (!user) return json(401, { code: 'PGRST301', message: 'JWT inválido' });

  if (route === '/rest/v1/rpc/set_recovery_code') {
    if (normalizeCode(body.p_code).length !== 16) return json(200, { status: 'error', code: 'invalid_recovery_code' });
    db.codes.set(user.id, normalizeCode(body.p_code));
    return json(200, { status: 'ok' });
  }
  if (route === '/rest/v1/rpc/has_recovery_code') return json(200, db.codes.has(user.id));
  if (route === '/auth/v1/user' && request.method === 'PUT') {
    user.password = body.password;
    db.passwordChanges++;
    return json(200, { id: user.id, email: user.email });
  }
  if (route === '/rest/v1/vaults' && request.method === 'GET') {
    const row = db.vaults.get(user.id);
    return json(200, row ? [{ data: row.data, revision: row.revision, updated_at: row.updatedAt }] : []);
  }
  if (route === '/rest/v1/rpc/save_vault') {
    const row = db.vaults.get(user.id);
    const base = Number(body.p_base_revision) || 0;
    if (base === 0 && !row) {
      db.vaults.set(user.id, { data: body.p_data, revision: 1, updatedAt: new Date().toISOString() });
      return json(200, { status: 'ok', revision: 1 });
    }
    if (row && row.revision === base) {
      row.data = body.p_data;
      row.revision += 1;
      row.updatedAt = new Date().toISOString();
      return json(200, { status: 'ok', revision: row.revision });
    }
    return json(200, { status: 'conflict', revision: row ? row.revision : null });
  }
  if (route === '/rest/v1/rpc/delete_my_account') {
    db.vaults.delete(user.id);
    db.users.delete(user.email);
    db.deleted.push(user.email);
    return json(204);
  }
  if (route.startsWith('/rest/v1/rpc/register_install')) return json(204);
  return json(404, {});
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost');
  if (url.pathname.startsWith('/supabase/')) {
    fakeSupabase(request, response, url);
    return;
  }
  const file = path.join(ROOT, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    response.writeHead(404).end();
    return;
  }
  let content = fs.readFileSync(file);
  // O teste nunca usa o Supabase de verdade.
  if (url.pathname === '/js/config.js') {
    content = `globalThis.FM = globalThis.FM || {}; FM.config = { appVersion: 'teste', build: '__BUILD__', emailRecovery: ${emailRecovery}, supabaseUrl: location.origin + '/supabase', supabaseKey: 'sb_publishable_teste' };`;
  }
  response.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  response.end(content);
});

let emailRecovery = false;

/* ---------- Apoio ---------- */

let browser;
let URL_APP;
let passed = 0;
const failures = [];
const pageErrors = [];

async function step(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (error) {
    failures.push(name);
    console.log(`FALHOU ${name}\n       ${String(error.message).split('\n').slice(0, 4).join('\n       ')}`);
  }
}

/** Um celular novo: perfil limpo, contagem de aparelhos recusada (para o aviso não ficar na frente). */
async function newPhone(hash = '') {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.evaluateOnNewDocument(() => {
    try { localStorage.setItem('sobra.aparelho.consentimento', 'recusado'); } catch {}
  });
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.setViewport(PHONE);
  await page.goto(URL_APP + hash, { waitUntil: 'networkidle0' });
  return { context, page };
}

const clickText = (page, label, scope = 'body') => page.evaluate((wanted, root) => {
  const nodes = [...document.querySelector(root).querySelectorAll('button, a, label')].filter((n) => n.getClientRects().length);
  const node = nodes.find((n) => n.textContent.trim() === wanted) || nodes.find((n) => n.textContent.trim().includes(wanted));
  if (!node) throw new Error(`não achei "${wanted}"`);
  node.click();
}, label, scope);

async function fillAuth(page, email, password) {
  await page.waitForSelector('.cloud-form input[type=email]');
  await page.$eval('.cloud-form input[type=email]', (n) => { n.value = ''; });
  await page.type('.cloud-form input[type=email]', email);
  await page.type('.cloud-form input[type=password]', password);
}

async function waitFor(check, message, timeout = 12000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await check()) return;
    await delay(150);
  }
  throw new Error(`esperei demais: ${message}`);
}

const addExpense = (page, desc, amount = 1000) => page.evaluate((d, a) => {
  const { store } = FM.app;
  const s = store.state;
  store.addTransaction({ type: 'expense', amount: a, date: FM.dates.today(), desc: d, categoryId: s.categories.find((c) => c.kind === 'expense').id, accountId: s.accounts[0].id, paid: true });
}, desc, amount);

const localDescs = (page) => page.evaluate(() => FM.app.store.state.transactions.map((t) => t.desc).sort());
const cloudDescs = (email) => {
  const user = db.users.get(email);
  const row = user && db.vaults.get(user.id);
  return row ? row.data.transactions.map((t) => t.desc).sort() : null;
};
const shot = async (page, name) => {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, name) });
};

/* ---------- Roteiro ---------- */

(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  URL_APP = `http://localhost:${server.address().port}/`;
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-first-run', '--hide-scrollbars'] });
  const EMAIL = 'maria@exemplo.com';
  let recoveryCode = '';
  const PASSWORD = 'senha-forte-123';

  console.log('\nAntes de o banco estar pronto');
  await step('sem a tabela no banco, a nuvem não aparece em lugar nenhum e nada quebra', async () => {
    db.tableMissing = true;
    const { context, page } = await newPhone();
    await delay(300);
    assert.doesNotMatch(await page.evaluate(() => document.body.innerText), /Já tenho conta/);
    await clickText(page, 'Começar do zero');
    await page.waitForSelector('.view-home');
    for (const desc of ['Um', 'Dois', 'Três']) await addExpense(page, desc);
    await page.reload({ waitUntil: 'networkidle0' });
    await delay(300);
    assert.doesNotMatch(await page.$eval('#banners', (n) => n.textContent), /nuvem/i);
    assert.equal(await page.$$eval('#nav a', (ns) => ns.some((n) => n.textContent.includes('Nuvem'))), false);
    await page.goto(`${URL_APP}#/nuvem`, { waitUntil: 'networkidle0' });
    assert.match(await page.evaluate(() => document.body.innerText), /Nuvem indisponível/);

    // A tabela é criada: na próxima abertura a nuvem aparece, sem publicar o app de novo.
    db.tableMissing = false;
    await page.goto(URL_APP, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => /guarde uma cópia na nuvem/.test(document.querySelector('#banners').textContent));
    assert.equal(await page.$$eval('#nav a', (ns) => ns.some((n) => n.textContent.includes('Nuvem'))), true);
    await context.close();
  });

  console.log('\nAtivar o backup');
  const a = await newPhone();
  await step('quem já usa o app recebe o convite e cria a conta em poucos toques', async () => {
    await clickText(a.page, 'Começar do zero');
    await a.page.waitForSelector('.view-home');
    for (const desc of ['Aluguel', 'Mercado', 'Farmácia']) await addExpense(a.page, desc);
    await a.page.reload({ waitUntil: 'networkidle0' });
    assert.match(await a.page.$eval('#banners', (n) => n.textContent), /guarde uma cópia na nuvem/);
    await clickText(a.page, 'Ativar backup', '#banners');
    await a.page.waitForSelector('.view-cloud');
    await shot(a.page, 'nuvem-1-criar-conta.png');
    await fillAuth(a.page, EMAIL, PASSWORD);
    await clickText(a.page, 'Criar conta e guardar');
    // A conta nova já vem com o código de recuperação, que só fecha depois de a pessoa confirmar que guardou.
    await a.page.waitForSelector('dialog[open] .recovery-code');
    recoveryCode = await a.page.$eval('dialog[open] .recovery-code', (n) => n.textContent);
    assert.match(recoveryCode, /^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/);
    assert.equal(await a.page.$eval('dialog[open] .dialog-foot .button-primary', (n) => n.disabled), true, 'só fecha depois de confirmar');
    await shot(a.page, 'nuvem-0-codigo.png');
    await a.page.click('dialog[open] input[type=checkbox]');
    await clickText(a.page, 'Pronto', 'dialog[open] .dialog-foot');
    await waitFor(() => cloudDescs(EMAIL)?.length === 3, 'os 3 lançamentos na nuvem');
    assert.equal(db.codes.get(db.users.get(EMAIL).id), recoveryCode.replace(/-/g, ''), 'o código ficou guardado na conta');
    assert.equal(db.created, 1, 'a conta foi criada pela função create_account, sem e-mail');
    assert.deepEqual(cloudDescs(EMAIL), ['Aluguel', 'Farmácia', 'Mercado']);
    await a.page.waitForFunction(() => /Tudo guardado na nuvem/.test(document.querySelector('.view-cloud').textContent));
    assert.equal(await a.page.$eval('.cloud-chip', (n) => n.textContent), 'Na nuvem');
    await shot(a.page, 'nuvem-2-conectado.png');
  });

  await step('cada lançamento novo sobe sozinho, alguns segundos depois', async () => {
    await addExpense(a.page, 'Padaria');
    await waitFor(() => cloudDescs(EMAIL)?.includes('Padaria'), 'Padaria na nuvem');
    assert.equal(db.vaults.get(db.users.get(EMAIL).id).revision, 2);
  });

  console.log('\nCelular novo');
  const b = await newPhone();
  await step('no celular novo, "Já tenho conta" traz todos os lançamentos de volta', async () => {
    await shot(b.page, 'nuvem-3-boas-vindas.png');
    await clickText(b.page, 'Já tenho conta: recuperar meus lançamentos');
    await b.page.waitForSelector('.view-cloud');
    assert.match(await b.page.$eval('h1', (n) => n.textContent), /Já tenho conta/);
    await fillAuth(b.page, EMAIL, PASSWORD);
    await clickText(b.page, 'Entrar e recuperar');
    await b.page.waitForSelector('.view-home');
    assert.equal(await b.page.evaluate(() => location.hash), '#/inicio');
    assert.deepEqual(await localDescs(b.page), ['Aluguel', 'Farmácia', 'Mercado', 'Padaria']);
    await shot(b.page, 'nuvem-4-recuperado.png');
  });

  await step('os dados recuperados continuam no celular novo depois de fechar e abrir', async () => {
    await b.page.reload({ waitUntil: 'networkidle0' });
    await b.page.waitForSelector('.view-home');
    assert.deepEqual(await localDescs(b.page), ['Aluguel', 'Farmácia', 'Mercado', 'Padaria']);
  });

  console.log('\nDois aparelhos');
  await step('lançado num aparelho sem internet e no outro ao mesmo tempo: os dois ficam', async () => {
    await a.page.setOfflineMode(true);
    await addExpense(a.page, 'Uber sem internet');
    await a.page.evaluate(() => FM.cloud.syncNow());
    await a.page.waitForFunction(() => FM.cloud.status().status === 'offline');
    assert.equal(await a.page.$eval('.cloud-chip', (n) => n.textContent), 'Sem internet');

    await addExpense(b.page, 'Cinema no outro celular');
    await waitFor(() => cloudDescs(EMAIL)?.includes('Cinema no outro celular'), 'Cinema na nuvem');

    await a.page.setOfflineMode(false);
    await a.page.evaluate(() => FM.cloud.syncNow());
    await waitFor(() => cloudDescs(EMAIL)?.includes('Uber sem internet'), 'Uber na nuvem');
    assert.deepEqual(await localDescs(a.page), ['Aluguel', 'Cinema no outro celular', 'Farmácia', 'Mercado', 'Padaria', 'Uber sem internet']);

    await b.page.evaluate(() => FM.cloud.syncNow());
    await waitFor(async () => (await localDescs(b.page)).includes('Uber sem internet'), 'Uber no outro celular');
    assert.deepEqual(cloudDescs(EMAIL), await localDescs(b.page));
  });

  await step('apagado num aparelho, sai também do outro', async () => {
    await a.page.evaluate(() => {
      const { store } = FM.app;
      store.deleteTransactions(store.state.transactions.filter((t) => t.desc === 'Farmácia').map((t) => t.id));
    });
    await waitFor(() => !cloudDescs(EMAIL).includes('Farmácia'), 'Farmácia apagada na nuvem');
    await b.page.evaluate(() => FM.cloud.syncNow());
    await waitFor(async () => !(await localDescs(b.page)).includes('Farmácia'), 'Farmácia apagada no outro celular');
  });

  console.log('\nAparelho que já tinha dados');
  const c = await newPhone();
  await step('entrar num aparelho com outros lançamentos pergunta o que fazer, e "Juntar" não perde nada', async () => {
    await clickText(c.page, 'Começar do zero');
    await c.page.waitForSelector('.view-home');
    await addExpense(c.page, 'Lançado no tablet');
    await c.page.goto(`${URL_APP}#/nuvem`, { waitUntil: 'networkidle0' });
    await clickText(c.page, 'Já tenho conta');
    await fillAuth(c.page, EMAIL, PASSWORD);
    await clickText(c.page, 'Entrar e recuperar');
    await c.page.waitForFunction(() => /lançamentos diferentes/.test(document.querySelector('#banners').textContent));
    await clickText(c.page, 'Escolher o que fazer', '#banners');
    await c.page.waitForSelector('dialog[open] .choice');
    await shot(c.page, 'nuvem-5-escolha.png');
    await clickText(c.page, 'Juntar os dois', 'dialog[open]');
    await waitFor(() => cloudDescs(EMAIL)?.includes('Lançado no tablet'), 'tablet na nuvem');
    const expected = ['Aluguel', 'Cinema no outro celular', 'Lançado no tablet', 'Mercado', 'Padaria', 'Uber sem internet'];
    assert.deepEqual(cloudDescs(EMAIL), expected);
    assert.deepEqual(await localDescs(c.page), expected);
    const categories = await c.page.evaluate(() => FM.app.store.state.categories.map((x) => x.name));
    assert.equal(new Set(categories).size, categories.length, 'categorias repetidas depois de juntar');
  });

  console.log('\nConta');
  await step('senha errada mostra o motivo, sem travar', async () => {
    const { context, page } = await newPhone('#/nuvem');
    await clickText(page, 'Já tenho conta');
    await fillAuth(page, EMAIL, 'senha-errada-999');
    await clickText(page, 'Entrar e recuperar');
    await page.waitForFunction(() => /incorretos/.test(document.querySelector('.cloud-form').textContent));
    await context.close();
  });

  await step('com confirmação de e-mail ligada (sem a função de criar conta): pede para conferir o e-mail e entra pelo link', async () => {
    db.autoconfirm = false;
    db.noCreateAccount = true;
    const { context, page } = await newPhone('#/nuvem');
    await fillAuth(page, 'joao@exemplo.com', PASSWORD);
    await clickText(page, 'Criar conta e guardar');
    await page.waitForFunction(() => /Confira o seu e-mail/.test(document.querySelector('.view-cloud').textContent));
    await shot(page, 'nuvem-6-confira-email.png');
    const user = db.users.get('joao@exemplo.com');
    user.confirmed = true;
    const link = `${URL_APP}#access_token=${tokenFor(user)}&refresh_token=renovar-${user.id}&expires_in=3600&token_type=bearer&type=signup`;
    await page.goto(link, { waitUntil: 'networkidle0' });
    await page.reload({ waitUntil: 'networkidle0' });
    assert.equal(await page.evaluate(() => location.hash), '#/nuvem', 'os tokens saem do endereço');
    assert.equal(await page.evaluate(() => FM.cloud.signedIn()), true);
    db.autoconfirm = true;
    db.noCreateAccount = false;
    await context.close();
  });

  await step('com o código de recuperação disponível, o cadastro não pede mais para anotar a senha', async () => {
    const { context, page } = await newPhone('#/nuvem');
    await page.waitForFunction(() => FM.cloud.status().recovery);
    await page.evaluate(() => FM.app.ctx.refresh());
    assert.doesNotMatch(await page.$eval('.cloud-form', (n) => n.textContent), /Anote a senha/);
    await clickText(page, 'Já tenho conta');
    await page.waitForSelector('.cloud-form');
    assert.match(await page.$eval('.cloud-form', (n) => n.textContent), /Esqueci minha senha/);
    await context.close();
  });

  await step('"Esqueci minha senha" com o código de recuperação: código errado é recusado, o certo troca a senha e gera outro', async () => {
    const { context, page } = await newPhone('#/nuvem');
    await clickText(page, 'Já tenho conta');
    await page.waitForSelector('.cloud-form');
    await clickText(page, 'Esqueci minha senha');
    await page.waitForSelector('dialog[open] #form-recuperar-codigo');
    await page.type('dialog[open] input[type=email]', EMAIL);
    await page.type('dialog[open] .recovery-input', 'AAAA-BBBB-CCCC-DDDD');
    await page.type('dialog[open] input[type=password]', 'senha-recuperada-1');
    await clickText(page, 'Criar senha nova', 'dialog[open] .dialog-foot');
    await page.waitForFunction(() => /incorretos/.test(document.querySelector('dialog[open]').textContent));
    await page.$eval('dialog[open] .recovery-input', (n) => { n.value = ''; });
    await page.type('dialog[open] .recovery-input', recoveryCode.toLowerCase().replace(/-/g, ' '));
    await clickText(page, 'Criar senha nova', 'dialog[open] .dialog-foot');
    await page.waitForSelector('dialog[open] .recovery-code');
    const fresh = await page.$eval('dialog[open] .recovery-code', (n) => n.textContent);
    assert.notEqual(fresh, recoveryCode, 'o código usado não vale mais: vem um novo');
    assert.equal(db.resets, 1);
    assert.equal(db.users.get(EMAIL).password, 'senha-recuperada-1');
    assert.equal(await page.evaluate(() => FM.cloud.signedIn()), true);
    await page.click('dialog[open] input[type=checkbox]');
    await clickText(page, 'Pronto', 'dialog[open] .dialog-foot');
    // Volta a senha usada pelos passos seguintes.
    db.users.get(EMAIL).password = PASSWORD;
    await context.close();
  });

  await step('"Esqueci minha senha": o link do e-mail abre o pedido de senha nova', async () => {
    emailRecovery = true;
    const { context, page } = await newPhone('#/nuvem');
    await clickText(page, 'Já tenho conta');
    await page.waitForSelector('.cloud-form');
    await clickText(page, 'Esqueci minha senha');
    await page.waitForSelector('dialog[open] input[type=email]');
    await page.type('dialog[open] input[type=email]', EMAIL);
    await clickText(page, 'Enviar link', 'dialog[open]');
    await waitFor(() => db.recovers.includes(EMAIL), 'pedido de senha nova');
    const user = db.users.get(EMAIL);
    await page.goto(`${URL_APP}#access_token=${tokenFor(user)}&refresh_token=renovar-${user.id}&expires_in=3600&type=recovery`);
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForFunction(() => /senha nova/i.test(document.querySelector('dialog[open]')?.textContent || ''));
    await page.type('dialog[open] input[type=password]', 'outra-senha-456');
    await clickText(page, 'Salvar senha', 'dialog[open]');
    await waitFor(() => db.passwordChanges === 1, 'senha trocada');
    emailRecovery = false;
    await context.close();
  });

  await step('sair da conta mantém os lançamentos no aparelho e para de enviar', async () => {
    await c.page.goto(`${URL_APP}#/nuvem`, { waitUntil: 'networkidle0' });
    await clickText(c.page, 'Sair desta conta');
    await clickText(c.page, 'Sair', 'dialog[open] .dialog-foot');
    await c.page.waitForFunction(() => !FM.cloud.signedIn());
    const before = db.vaults.get(db.users.get(EMAIL).id).revision;
    await addExpense(c.page, 'Depois de sair');
    await delay(3500);
    assert.equal(db.vaults.get(db.users.get(EMAIL).id).revision, before);
    assert.ok((await localDescs(c.page)).includes('Lançado no tablet'));
  });

  await step('excluir a conta apaga a nuvem e deixa os lançamentos no aparelho', async () => {
    await b.page.goto(`${URL_APP}#/nuvem`, { waitUntil: 'networkidle0' });
    await clickText(b.page, 'Excluir conta e dados da nuvem');
    await b.page.waitForSelector('dialog[open] input');
    await b.page.type('dialog[open] input', 'excluir');
    await clickText(b.page, 'Excluir conta', 'dialog[open] .dialog-foot');
    await waitFor(() => db.deleted.includes(EMAIL), 'conta excluída');
    await b.page.waitForFunction(() => !FM.cloud.signedIn());
    assert.ok((await localDescs(b.page)).length > 0);
  });

  await step('sem conta, nada sai do aparelho', async () => {
    const before = db.vaults.size;
    const { context, page } = await newPhone();
    await clickText(page, 'Começar do zero');
    await page.waitForSelector('.view-home');
    await addExpense(page, 'Só neste aparelho');
    await delay(3500);
    assert.equal(db.vaults.size, before);
    await context.close();
  });

  await step('nenhum erro de script', async () => {
    assert.deepEqual(pageErrors, []);
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
