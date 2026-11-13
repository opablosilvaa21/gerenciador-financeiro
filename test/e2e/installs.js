/**
 * Simula a contagem de instalações de ponta a ponta, sem tocar no Supabase de verdade:
 * este servidor entrega o app com uma configuração de teste e faz o papel do banco.
 * Confere o aviso de privacidade, o que é enviado (e o que nunca é), o limite de uma vez por dia,
 * o evento de instalação, a falha de rede e o painel protegido.
 *
 * Uso: node test/e2e/installs.js [pasta-para-fotos]
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
const PHONE = { width: 375, height: 812, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
const ALLOWED_FIELDS = ['p_app_version', 'p_browser', 'p_device_model', 'p_id', 'p_is_standalone', 'p_os', 'p_os_version', 'p_screen'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PIXEL_UA = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';
const PIXEL_HINTS = {
  brands: [{ brand: 'Not?A_Brand', version: '8' }, { brand: 'Chromium', version: '141' }, { brand: 'Google Chrome', version: '141' }],
  fullVersionList: [{ brand: 'Google Chrome', version: '141.0.7390.41' }],
  platform: 'Android',
  platformVersion: '15.0.0',
  architecture: '',
  model: 'Pixel 8',
  mobile: true,
};
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- O Supabase de mentira ---------- */

const backend = { registers: [], down: false, statsCalls: 0 };

function statsFixture() {
  const today = new Date();
  const daily = Array.from({ length: 30 }, (_, i) => {
    const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (29 - i));
    const iso = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
    return { day: iso, count: [0, 1, 0, 2, 4, 1, 0, 3, 5, 2][i % 10] };
  });
  const now = Date.now();
  const seen = (hours) => new Date(now - hours * 3600000).toISOString();
  return {
    total: 128, active_7d: 61, active_30d: 97, standalone: 44, new_7d: 12, days: 30,
    by_os: [{ label: 'Android', count: 83 }, { label: 'iOS', count: 31 }, { label: 'Windows', count: 11 }, { label: 'macOS', count: 3 }],
    by_browser: [{ label: 'Chrome', count: 79 }, { label: 'Safari', count: 31 }, { label: 'Samsung Internet', count: 12 }, { label: 'Edge', count: 6 }],
    by_model: [{ label: 'iPhone', count: 31 }, { label: 'Não informado', count: 22 }, { label: 'SM-A546E', count: 14 }, { label: 'moto g84 5G', count: 11 }, { label: 'Pixel 8', count: 7 }],
    by_app_version: [{ label: '1.1.0', count: 120 }, { label: 'Não informada', count: 8 }],
    daily,
    recent: [
      { first_seen: seen(30), last_seen: seen(1), os: 'Android', os_version: '15', browser: 'Chrome 141', device_model: 'Pixel 8', is_standalone: true, screen: '412x915@2.63', app_version: '1.1.0' },
      { first_seen: seen(200), last_seen: seen(5), os: 'iOS', os_version: '18.5', browser: 'Safari 18', device_model: 'iPhone', is_standalone: false, screen: '390x844@3', app_version: '1.1.0' },
      { first_seen: seen(400), last_seen: seen(26), os: 'Windows', os_version: '11', browser: 'Edge 141', device_model: null, is_standalone: false, screen: '1920x1080@1', app_version: '1.1.0' },
    ],
  };
}

function readBody(request) {
  return new Promise((resolve) => {
    let text = '';
    request.on('data', (chunk) => { text += chunk; });
    request.on('end', () => {
      try { resolve(JSON.parse(text || '{}')); } catch { resolve({}); }
    });
  });
}

async function fakeSupabase(request, response, url) {
  if (backend.down) {
    request.socket.destroy();
    return;
  }
  const body = await readBody(request);
  const json = (status, data) => {
    response.writeHead(status, { 'Content-Type': 'application/json' });
    response.end(data === undefined ? '' : JSON.stringify(data));
  };
  const token = (request.headers.authorization || '').replace('Bearer ', '');
  if (!request.headers.apikey) return json(401, { message: 'No API key found in request' });

  if (url.pathname.endsWith('/rest/v1/rpc/register_install')) {
    backend.registers.push({ body, authorization: request.headers.authorization || null });
    return json(204);
  }
  if (url.pathname.endsWith('/auth/v1/token')) {
    if (body.password === 'senha-certa') return json(200, { access_token: 'token-admin', refresh_token: 'renovar', expires_in: 3600 });
    if (body.password === 'senha-de-outro') return json(200, { access_token: 'token-outro', refresh_token: 'renovar', expires_in: 3600 });
    return json(400, { error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
  }
  if (url.pathname.endsWith('/rest/v1/rpc/install_stats')) {
    backend.statsCalls++;
    if (token === 'token-admin') return json(200, statsFixture());
    if (token === 'token-outro') return json(403, { code: '42501', message: 'Acesso restrito ao administrador.' });
    return json(401, { message: 'JWT inválido' });
  }
  if (url.pathname.endsWith('/auth/v1/logout')) return json(204);
  return json(404, {});
}

let configured = true;

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
  // O teste nunca usa a configuração de verdade: ou aponta para o banco de mentira, ou fica sem nenhum.
  if (url.pathname === '/js/config.js') {
    content = configured
      ? `globalThis.FM = globalThis.FM || {}; FM.config = { appVersion: '9.9.9-teste', supabaseUrl: location.origin + '/supabase', supabaseKey: 'sb_publishable_chave_de_teste' };`
      : `globalThis.FM = globalThis.FM || {}; FM.config = { appVersion: '9.9.9-teste', supabaseUrl: '', supabaseKey: '' };`;
  }
  response.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  response.end(content);
});

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

/** Abre o app como um aparelho novo: sem nada guardado. */
async function freshDevice({ userAgent = PIXEL_UA, hints = PIXEL_HINTS, viewport = PHONE, hash = '' } = {}) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.setViewport(viewport);
  if (hints) await page.setUserAgent(userAgent, hints);
  else await page.setUserAgent(userAgent);
  await page.goto(URL_APP + hash, { waitUntil: 'networkidle0' });
  return { context, page };
}

const clickText = (page, label, scope = 'body') => page.evaluate((wanted, root) => {
  const nodes = [...document.querySelector(root).querySelectorAll('button, a, label')].filter((n) => n.getClientRects().length);
  const node = nodes.find((n) => n.textContent.trim() === wanted) || nodes.find((n) => n.textContent.trim().includes(wanted));
  if (!node) throw new Error(`não achei "${wanted}"`);
  node.click();
}, label, scope);

const bannerText = (page) => page.$eval('#banners', (n) => n.textContent);
const shot = async (page, name, options = {}) => {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, name), ...options });
};
const settle = () => delay(400);

/* ---------- Roteiro ---------- */

(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  URL_APP = `http://localhost:${server.address().port}/`;
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-first-run', '--hide-scrollbars'] });

  console.log('\nAviso de privacidade');
  await step('na primeira abertura o aviso aparece e nada é enviado antes da resposta', async () => {
    const { context, page } = await freshDevice();
    await settle();
    assert.match(await bannerText(page), /dados técnicos anônimos/);
    assert.match(await bannerText(page), /Recusar/);
    assert.equal(backend.registers.length, 0);
    await shot(page, 'instalacoes-1-aviso-de-privacidade.png');
    await clickText(page, 'O que é enviado', '#banners');
    await page.waitForSelector('dialog[open]');
    assert.match(await page.$eval('dialog[open]', (n) => n.textContent), /A contagem nunca envia lançamentos/);
    await context.close();
  });

  await step('quem recusa não envia nada, nem depois de recarregar ou de instalar', async () => {
    const { context, page } = await freshDevice();
    await clickText(page, 'Recusar', '#banners');
    await settle();
    assert.doesNotMatch(await bannerText(page), /dados técnicos/);
    await page.reload({ waitUntil: 'networkidle0' });
    await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
    await settle();
    assert.doesNotMatch(await bannerText(page), /dados técnicos/);
    assert.equal(backend.registers.length, 0);
    assert.equal(await page.evaluate(() => localStorage.getItem('sobra.aparelho.id')), null, 'nem o identificador é criado');
    await context.close();
  });

  console.log('\nRegistro do aparelho');
  let deviceContext;
  let devicePage;
  let deviceId;
  await step('quem aceita é registrado uma vez, só com dados técnicos', async () => {
    ({ context: deviceContext, page: devicePage } = await freshDevice());
    // Enche o app de dados financeiros antes de aceitar: nada disso pode aparecer no envio.
    await clickText(devicePage, 'Ver com dados de exemplo');
    await devicePage.waitForSelector('.view-home');
    await clickText(devicePage, 'Tudo bem', '#banners');
    await settle();
    assert.equal(backend.registers.length, 1);
    const { body, authorization } = backend.registers[0];
    assert.deepEqual(Object.keys(body).sort(), ALLOWED_FIELDS);
    assert.match(body.p_id, UUID);
    assert.equal(body.p_os, 'Android');
    assert.equal(body.p_os_version, '15');
    assert.equal(body.p_browser, 'Chrome 141');
    assert.equal(body.p_device_model, 'Pixel 8', 'modelo vindo de userAgentData');
    assert.equal(body.p_is_standalone, false);
    assert.match(body.p_screen, /^\d+x\d+@[\d.]+$/);
    assert.equal(body.p_app_version, '9.9.9-teste');
    assert.equal(authorization, null, 'o registro é anônimo');
    const sent = JSON.stringify(body);
    assert.doesNotMatch(sent, /Salário|Aluguel|Mercado|amount|saldo/i);
    deviceId = body.p_id;
    assert.equal(await devicePage.evaluate(() => localStorage.getItem('sobra.aparelho.id')), deviceId);
    assert.doesNotMatch(await bannerText(devicePage), /dados técnicos/);
  });

  await step('abrir de novo no mesmo dia não envia outra vez', async () => {
    await devicePage.reload({ waitUntil: 'networkidle0' });
    await settle();
    await devicePage.reload({ waitUntil: 'networkidle0' });
    await settle();
    assert.equal(backend.registers.length, 1);
  });

  await step('no dia seguinte, renova o último uso com o mesmo identificador', async () => {
    await devicePage.evaluate(() => {
      const sent = JSON.parse(localStorage.getItem('sobra.aparelho.envio'));
      localStorage.setItem('sobra.aparelho.envio', JSON.stringify({ ...sent, day: '2000-01-01' }));
    });
    await devicePage.reload({ waitUntil: 'networkidle0' });
    await settle();
    assert.equal(backend.registers.length, 2);
    assert.equal(backend.registers[1].body.p_id, deviceId);
    await devicePage.reload({ waitUntil: 'networkidle0' });
    await settle();
    assert.equal(backend.registers.length, 2);
  });

  await step('o evento de instalação registra o aparelho como app instalado', async () => {
    await devicePage.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
    await settle();
    assert.equal(backend.registers.length, 3);
    assert.equal(backend.registers[2].body.p_id, deviceId);
    assert.equal(backend.registers[2].body.p_is_standalone, true);
  });

  await step('em Ajustes dá para sair da contagem, e o envio para', async () => {
    await devicePage.goto(`${URL_APP}#/ajustes`, { waitUntil: 'networkidle0' });
    assert.match(await devicePage.evaluate(() => document.body.innerText), /Privacidade/);
    await clickText(devicePage, 'Não participar');
    await settle();
    await devicePage.evaluate(() => localStorage.removeItem('sobra.aparelho.envio'));
    await devicePage.reload({ waitUntil: 'networkidle0' });
    await settle();
    assert.equal(backend.registers.length, 3);
    await deviceContext.close();
  });

  await step('no iPhone o modelo fica "iPhone" e o sistema vem do user agent', async () => {
    const before = backend.registers.length;
    const { context, page } = await freshDevice({ userAgent: IPHONE_UA, hints: null });
    // Este Chrome tem userAgentData; o Safari de verdade não tem.
    await page.evaluateOnNewDocument(() => Object.defineProperty(Navigator.prototype, 'userAgentData', { get: () => undefined }));
    await page.reload({ waitUntil: 'networkidle0' });
    await clickText(page, 'Tudo bem', '#banners');
    await settle();
    assert.equal(backend.registers.length, before + 1);
    const { body } = backend.registers[before];
    assert.equal(body.p_os, 'iOS');
    assert.equal(body.p_os_version, '18.5');
    assert.equal(body.p_browser, 'Safari 18');
    assert.equal(body.p_device_model, 'iPhone');
    await context.close();
  });

  await step('se a rede falhar, o app segue funcionando e tenta de novo depois', async () => {
    const before = backend.registers.length;
    const errorsBefore = pageErrors.length;
    backend.down = true;
    const { context, page } = await freshDevice();
    await clickText(page, 'Ver com dados de exemplo');
    await page.waitForSelector('.view-home');
    await clickText(page, 'Tudo bem', '#banners');
    await settle();
    assert.equal(backend.registers.length, before);
    assert.equal(pageErrors.length, errorsBefore, pageErrors.slice(errorsBefore).join('; '));
    await page.goto(`${URL_APP}#/lancamentos`, { waitUntil: 'networkidle0' });
    assert.ok(await page.$('.tx-table'), 'a tela de lançamentos abre normalmente');
    backend.down = false;
    await page.reload({ waitUntil: 'networkidle0' });
    await settle();
    assert.equal(backend.registers.length, before + 1, 'com a rede de volta, o registro acontece');
    await context.close();
  });

  console.log('\nPainel protegido');
  await step('sem login, o painel só mostra o formulário e não pede números', async () => {
    const { context, page } = await freshDevice({ hash: '#/admin/instalacoes' });
    await page.waitForSelector('.admin-login');
    assert.equal(backend.statsCalls, 0);
    assert.equal(await page.$('.view-admin .stat'), null);
    assert.equal(await page.$$eval('#nav a, #tabbar a', (ns) => ns.some((n) => n.getAttribute('href').includes('admin'))), false, 'o painel não aparece no menu');
    await shot(page, 'instalacoes-2-login.png');

    await page.type('.admin-login input[type=email]', 'alguem@exemplo.com');
    await page.type('.admin-login input[type=password]', 'senha-errada');
    await clickText(page, 'Entrar', '.admin-login');
    await page.waitForFunction(() => /incorretos/.test(document.querySelector('.admin-login')?.textContent || ''));
    assert.equal(backend.statsCalls, 0);
    await context.close();
  });

  await step('uma conta que não é a do administrador entra, mas não vê nada', async () => {
    const { context, page } = await freshDevice({ hash: '#/admin/instalacoes' });
    await page.waitForSelector('.admin-login');
    await page.type('.admin-login input[type=email]', 'outra@exemplo.com');
    await page.type('.admin-login input[type=password]', 'senha-de-outro');
    await clickText(page, 'Entrar', '.admin-login');
    await page.waitForFunction(() => /não tem acesso/.test(document.querySelector('.view-admin')?.textContent || ''));
    assert.equal(await page.$('.view-admin .stat'), null);
    await context.close();
  });

  await step('o administrador vê totais, ativos, instalados, sistemas, modelos e navegadores', async () => {
    const { context, page } = await freshDevice({ hash: '#/admin/instalacoes' });
    await page.waitForSelector('.admin-login');
    await page.type('.admin-login input[type=email]', 'admin@exemplo.com');
    await page.type('.admin-login input[type=password]', 'senha-certa');
    await clickText(page, 'Entrar', '.admin-login');
    await page.waitForSelector('.view-admin .stat');
    const stats = await page.$$eval('.view-admin .stat', (ns) => ns.map((n) => [n.querySelector('dt').textContent, n.querySelector('strong').textContent]));
    assert.deepEqual(stats, [['Total de aparelhos', '128'], ['Ativos em 7 dias', '61'], ['Ativos em 30 dias', '97'], ['Instalados como app', '44']]);
    const text = await page.evaluate(() => document.querySelector('.view-admin').innerText);
    for (const expected of ['Novas instalações por dia', 'Por sistema', 'Android', 'Por modelo', 'Pixel 8', 'Por navegador', 'Samsung Internet', 'Vistos por último']) {
      assert.ok(text.includes(expected), `falta "${expected}"`);
    }
    await delay(300);
    assert.ok((await page.$$('.view-admin .chart-svg .bar')).length > 10, 'o gráfico por dia tem colunas');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true, 'sem rolagem lateral em 375 px');
    await shot(page, 'instalacoes-3-painel-celular.png', { fullPage: true });

    await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
    await delay(300);
    await shot(page, 'instalacoes-4-painel-desktop.png', { fullPage: true });

    await clickText(page, 'Sair', '.view-admin');
    await page.waitForSelector('.admin-login');
    assert.equal(await page.evaluate(() => localStorage.getItem('sobra.admin.sessao')), null);
    await context.close();
  });

  console.log('\nSem configuração');
  await step('sem endereço e chave em js/config.js, não há aviso nem envio', async () => {
    configured = false;
    const before = backend.registers.length;
    const { context, page } = await freshDevice();
    await settle();
    assert.equal(await bannerText(page), '');
    assert.equal(backend.registers.length, before);
    assert.equal(await page.evaluate(() => FM.telemetry.enabled()), false);
    await page.goto(`${URL_APP}#/admin/instalacoes`, { waitUntil: 'networkidle0' });
    assert.match(await page.evaluate(() => document.querySelector('.view-admin').innerText), /Contagem desligada/);
    await context.close();
    configured = true;
  });

  await step('nenhum erro de script durante o roteiro', async () => {
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
