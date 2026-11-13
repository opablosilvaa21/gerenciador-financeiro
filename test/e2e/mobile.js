/**
 * Usa o Sobra como um celular: tela estreita, toque e endereço http, que é o que libera a instalação e o modo offline.
 * Precisa do puppeteer-core (npm install) e do Chrome. Outro caminho: variável CHROME_PATH.
 */
const puppeteer = require('puppeteer-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PHONE = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const ROUTES = ['inicio', 'lancamentos', 'carteiras', 'orcamentos', 'fixas', 'metas', 'relatorios', 'ajustes'];
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

let page;
let passed = 0;
let newVersionMark = '';
/** Faz o papel da publicação automática, que troca __BUILD__ no sw.js a cada envio para a main. */
let swBuild = 'teste-1';
const failures = [];
const consoleProblems = [];
let watchConsole = true;

const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost');
  const file = path.join(ROOT, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    response.writeHead(404).end();
    return;
  }
  let body = fs.readFileSync(file);
  if (file.endsWith('index.html') && newVersionMark) body = body.toString().replace('</head>', `<meta name="versao" content="${newVersionMark}"></head>`);
  if (file.endsWith('sw.js')) body = body.toString().replace("'__BUILD__'", `'${swBuild}'`);
  response.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  response.end(body);
});

async function step(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (error) {
    failures.push(name);
    console.log(`FALHOU ${name}\n       ${String(error.message).split('\n').slice(0, 3).join('\n       ')}`);
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach((d) => d.remove())).catch(() => {});
  }
}

/** Toca no botão ou link visível que contém o texto. */
async function tap(label, scope = 'body') {
  const handle = await page.evaluateHandle((wanted, root) => {
    const candidates = [...document.querySelector(root).querySelectorAll('button, a, label')];
    const visible = candidates.filter((n) => n.getClientRects().length);
    return visible.find((n) => n.textContent.trim() === wanted) || visible.find((n) => n.textContent.trim().includes(wanted));
  }, label, scope);
  const element = handle.asElement();
  assert.ok(element, `não achei "${label}"`);
  await element.tap();
  await delay(60);
}

const tapTab = (label) => tap(label, '#tabbar');
const go = async (route) => {
  await page.evaluate((r) => { location.hash = `#/${r}`; }, route);
  await delay(80);
};
const noOverflow = () => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
const hidden = (selector) => page.$eval(selector, (n) => !n.getClientRects().length);
const box = (selector) => page.$eval(selector, (n) => {
  const r = n.getBoundingClientRect();
  return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height };
});

(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const URL_APP = `http://localhost:${server.address().port}/`;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sobra-mobile-'));
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, userDataDir: profile, args: ['--no-first-run'] });
  page = await browser.newPage();
  page.on('pageerror', (e) => consoleProblems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (watchConsole && m.type() === 'error') consoleProblems.push(`console: ${m.text()}`); });
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }, { name: 'prefers-color-scheme', value: 'light' }]);
  await page.setViewport(PHONE);
  // O pedido real de instalação não abre janela em teste: o caminho sem pedido e o com pedido são provados à parte.
  await page.evaluateOnNewDocument(() => {
    // A contagem de instalações tem teste próprio (installs.js); aqui ela fica recusada e nada sai para o Supabase.
    try {
      localStorage.setItem('sobra.aparelho.consentimento', 'recusado');
    } catch {}
    window.addEventListener('beforeinstallprompt', (event) => {
      if (!event.simulated) event.stopImmediatePropagation();
    }, true);
  });
  await page.goto(URL_APP);

  console.log('\nCara de aplicativo');
  await step('a primeira visita não mostra as abas', async () => {
    await page.waitForSelector('.welcome');
    assert.equal(await hidden('#tabbar'), true);
    assert.equal(await noOverflow(), true);
  });
  await step('depois de começar, as abas ficam na base e a lateral some', async () => {
    await tap('Ver com dados de exemplo');
    await page.waitForSelector('.view-home');
    assert.equal(await hidden('.side'), true);
    const bar = await box('#tabbar');
    assert.equal(Math.round(bar.bottom), PHONE.height);
    assert.equal(bar.width, PHONE.width);
    assert.equal((await page.$$('#tabbar .tab')).length, 5);
  });
  await step('as abas têm alvo de toque de pelo menos 44 px, mesmo em celular pequeno', async () => {
    await page.setViewport({ ...PHONE, width: 320, height: 568 });
    await delay(60);
    const sizes = await page.$$eval('#tabbar .tab', (ns) => ns.map((n) => n.getBoundingClientRect()).map((r) => [r.width, r.height]));
    for (const [width, height] of sizes) assert.ok(width >= 44 && height >= 44, `${width}x${height}`);
    const clipped = await page.$$eval('#tabbar .tab span', (ns) => ns.filter((n) => n.scrollWidth > n.parentElement.clientWidth).map((n) => n.textContent));
    assert.deepEqual(clipped, []);
    await page.setViewport(PHONE);
    await delay(60);
  });
  await step('tocar em uma aba troca de tela e marca a aba', async () => {
    await tapTab('Lançamentos');
    assert.match(await page.evaluate(() => location.hash), /lancamentos/);
    assert.equal(await page.$eval('#tabbar [aria-current]', (n) => n.textContent), 'Lançamentos');
  });
  await step('"Mais" abre as outras telas e fica marcada nelas', async () => {
    await tapTab('Mais');
    assert.deepEqual(await page.$$eval('dialog[open] .more-link', (ns) => ns.map((n) => n.textContent)), ['Carteiras', 'Contas fixas', 'Metas', 'Relatórios', 'Nuvem', 'Ajustes']);
    await tap('Metas', 'dialog[open]');
    await delay(60);
    assert.equal(await page.$('dialog[open]'), null);
    assert.match(await page.evaluate(() => location.hash), /metas/);
    assert.equal(await page.$eval('#tabbar [aria-current]', (n) => n.textContent), 'Mais');
  });
  await step('nenhuma tela passa da largura do celular', async () => {
    for (const [width, height] of [[390, 844], [320, 568], [844, 390]]) {
      await page.setViewport({ ...PHONE, width, height });
      for (const route of ROUTES) {
        await go(route);
        assert.equal(await noOverflow(), true, `${route} em ${width}px`);
      }
    }
    await page.setViewport(PHONE);
    await delay(60);
  });
  await step('com o celular deitado, as abas continuam no lugar da lateral', async () => {
    await page.setViewport({ ...PHONE, width: 844, height: 390 });
    await delay(60);
    assert.equal(await hidden('.side'), true);
    assert.equal(await hidden('#tabbar'), false);
    await page.setViewport(PHONE);
    await delay(60);
  });
  await step('botões, campos e setas têm tamanho de dedo', async () => {
    for (const route of ROUTES) {
      await go(route);
      const small = await page.$$eval('main .button:not(.button-small), main .icon-button, main .input', (ns) =>
        ns.filter((n) => n.getClientRects().length && n.getBoundingClientRect().height < 44).map((n) => n.className));
      assert.deepEqual(small, [], route);
    }
  });
  await step('o botão de pago aceita toque fora do círculo', async () => {
    await go('inicio');
    const hit = await page.evaluate(() => {
      const toggle = document.querySelector('.paid-toggle');
      toggle.scrollIntoView({ block: 'center' });
      const r = toggle.getBoundingClientRect();
      return document.elementFromPoint(r.left + r.width + 6, r.top + r.height / 2) === toggle;
    });
    assert.equal(hit, true);
  });
  await step('a escolha de tema colore a barra do sistema', async () => {
    // O claro (névoa) é o padrão; o escuro é escolhido em Ajustes.
    assert.equal(await page.$eval('meta[name="theme-color"]', (n) => n.content), '#f4f5ef');
    await page.evaluate(() => FM.app.store.setTheme('dark'));
    await delay(40);
    assert.equal(await page.$eval('meta[name="theme-color"]', (n) => n.content), '#0b0f0d');
    await page.evaluate(() => FM.app.store.setTheme('light'));
    await delay(40);
    assert.equal(await page.$eval('meta[name="theme-color"]', (n) => n.content), '#f4f5ef');
  });
  await step('os atalhos de teclado saem dos Ajustes', async () => {
    await go('ajustes');
    assert.equal(await hidden('.band-shortcuts'), true);
  });

  console.log('\nLançando pelo celular');
  await step('o "+" abre o formulário subindo da base da tela', async () => {
    await go('inicio');
    await (await page.$('#tabbar .tab-new')).tap();
    await page.waitForSelector('dialog[open]');
    const sheet = await box('dialog[open]');
    assert.equal(Math.round(sheet.bottom), PHONE.height);
    assert.equal(sheet.width, PHONE.width);
  });
  await step('os campos não fazem o iPhone dar zoom', async () => {
    const small = await page.$$eval('dialog[open] input:not([type=radio]):not([type=checkbox]), dialog[open] select', (ns) =>
      ns.filter((n) => parseFloat(getComputedStyle(n).fontSize) < 16).map((n) => n.className));
    assert.deepEqual(small, []);
    assert.equal(await page.$eval('dialog[open] .input-money', (n) => n.inputMode), 'decimal');
  });
  await step('salvar um lançamento; o aviso fica acima das abas', async () => {
    await page.type('dialog[open] .input-money', '12,50');
    const desc = await page.$$('dialog[open] input[type=text]');
    await desc[1].type('Café pelo celular');
    await tap('Lazer', 'dialog[open]');
    await tap('Salvar lançamento', 'dialog[open]');
    await delay(80);
    assert.equal(await page.$('dialog[open]'), null);
    const toast = await box('.toast');
    const bar = await box('#tabbar');
    assert.ok(toast.bottom <= bar.top, `${toast.bottom} > ${bar.top}`);
    assert.match(await page.evaluate(() => document.body.innerText), /Café pelo celular/);
  });
  await step('desfazer pelo aviso', async () => {
    await tap('Desfazer', '.toast');
    await delay(60);
    assert.doesNotMatch(await page.evaluate(() => document.body.innerText), /Café pelo celular/);
  });
  await step('tocar fora do formulário fecha', async () => {
    await (await page.$('#tabbar .tab-new')).tap();
    await page.waitForSelector('dialog[open]');
    const { top } = await box('dialog[open]');
    assert.ok(top > 10, 'o formulário ocupa a tela inteira');
    await page.touchscreen.tap(200, 4);
    await delay(80);
    assert.equal(await page.$('dialog[open]'), null);
  });

  console.log('\nLançamentos');
  await step('os filtros ficam recolhidos até serem pedidos, e a lista aparece logo', async () => {
    await tapTab('Lançamentos');
    assert.equal(await hidden('.filters .filter'), true);
    const notices = (await box('#banners')).height;
    assert.ok((await box('.tx-table')).top - notices < 370, 'a lista começa muito para baixo');
    await tap('Filtros');
    assert.equal(await hidden('.filters .filter'), false);
    await page.select('.filters label:nth-of-type(1) select', 'expense');
    await delay(60);
    assert.equal(await page.$eval('.phone-tools button', (n) => n.textContent), 'Filtros (1)');
    await page.select('.filters label:nth-of-type(1) select', '');
    await delay(60);
    await tap('Filtros');
    assert.equal(await hidden('.filters .filter'), true);
  });
  await step('a seleção em lote só aparece quando pedida', async () => {
    assert.equal(await hidden('.tx-table tbody .cell-check input'), true);
    await tap('Selecionar');
    assert.equal(await hidden('.tx-table tbody .cell-check input'), false);
    await (await page.$('.tx-table tbody .cell-check input')).tap();
    await delay(40);
    assert.match(await page.$eval('.bulk', (n) => n.textContent), /1 selecionado/);
    assert.equal(await noOverflow(), true);
    await tap('Cancelar seleção');
    assert.equal(await hidden('.bulk'), true);
    assert.equal(await hidden('.tx-table tbody .cell-check input'), true);
  });
  await step('o gráfico de saldo responde ao toque e a dica some ao rolar', async () => {
    await go('carteiras');
    await delay(100);
    const hit = await page.$('.chart-svg .bar-hit');
    await page.evaluate((n) => n.scrollIntoView({ block: 'center' }), hit);
    await delay(100);
    await hit.tap();
    await delay(60);
    assert.equal(await page.$eval('.tip', (n) => n.hidden), false);
    await page.evaluate(() => window.scrollBy(0, -80));
    await delay(100);
    assert.equal(await page.$eval('.tip', (n) => n.hidden), true);
  });

  console.log('\nInstalar e abrir sem internet');
  await step('convida a instalar, mostra como e não insiste depois de dispensado', async () => {
    await go('inicio');
    assert.match(await page.$eval('#banners', (n) => n.textContent), /Instale o Sobra/);
    await tap('Instalar', '#banners');
    await page.waitForSelector('dialog[open]');
    assert.match(await page.$eval('dialog[open]', (n) => n.textContent), /Instalar aplicativo|Tela de Início/);
    await page.evaluate(() => document.querySelector('dialog[open] [aria-label="Fechar"]').click());
    await tap('Agora não', '#banners');
    await delay(40);
    assert.doesNotMatch(await page.$eval('#banners', (n) => n.textContent), /Instale o Sobra/);
    await page.reload();
    await page.waitForSelector('.view-home');
    assert.doesNotMatch(await page.$eval('#banners', (n) => n.textContent), /Instale o Sobra/);
    await go('ajustes');
    assert.match(await page.evaluate(() => document.body.innerText), /Instalar como aplicativo/);
  });
  await step('quando o navegador oferece a instalação, o botão usa o pedido dele', async () => {
    await page.evaluate(() => {
      const event = new Event('beforeinstallprompt');
      event.simulated = true;
      event.prompt = async () => { window.promptShown = true; };
      event.userChoice = Promise.resolve({ outcome: 'accepted' });
      window.dispatchEvent(event);
    });
    await tap('Instalar o Sobra');
    assert.equal(await page.evaluate(() => window.promptShown), true);
    assert.equal(await page.$('dialog[open]'), null);
  });
  await step('o atalho "Novo lançamento" do ícone abre o formulário', async () => {
    await page.goto(`${URL_APP}#/inicio?novo=1`);
    await page.reload();
    await page.waitForSelector('dialog[open]');
    assert.equal(await page.evaluate(() => location.hash), '#/inicio');
    await page.evaluate(() => document.querySelector('dialog[open] [aria-label="Fechar"]').click());
  });
  await step('o service worker assume a página', async () => {
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await page.waitForSelector('.view-home');
    assert.equal(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)), true);
  });
  /** Simula uma publicação nova e pede ao navegador para conferir, como o app faz ao voltar para a tela. */
  const publishAndCheck = async (build) => {
    swBuild = build;
    await page.evaluate(() => { window.versaoAntiga = true; });
    await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r.update()));
  };
  await step('uma publicação nova chega sozinha: a página se recarrega com ela', async () => {
    await publishAndCheck('teste-2');
    await page.waitForFunction(() => !window.versaoAntiga, { timeout: 20000 });
    await page.waitForSelector('.view-home');
    assert.ok((await page.evaluate(() => caches.keys())).includes('sobra-teste-2'));
    assert.ok(!(await page.evaluate(() => caches.keys())).includes('sobra-teste-1'), 'a cópia antiga é apagada');
  });
  await step('no meio de um lançamento a atualização espera, avisa e entra quando o formulário fecha', async () => {
    await (await page.$('#tabbar .tab-new')).tap();
    await page.waitForSelector('dialog[open]');
    await page.type('dialog[open] .input-money', '9,99');
    await publishAndCheck('teste-3');
    await page.waitForFunction(() => /versão nova/.test(document.querySelector('#banners').textContent), { timeout: 20000 });
    await delay(1500);
    assert.equal(await page.evaluate(() => window.versaoAntiga), true, 'recarregou com o formulário aberto');
    assert.equal(await page.$eval('dialog[open] .input-money', (n) => n.value), '9,99');
    await page.evaluate(() => document.querySelector('dialog[open] [aria-label="Fechar"]').click());
    await page.waitForFunction(() => !window.versaoAntiga, { timeout: 20000 });
    await page.waitForSelector('.view-home');
    assert.ok((await page.evaluate(() => caches.keys())).includes('sobra-teste-3'));
  });
  await step('o Chrome considera o app instalável', async () => {
    const cdp = await page.createCDPSession();
    const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
    assert.deepEqual(installabilityErrors, []);
    const { errors } = await cdp.send('Page.getAppManifest');
    assert.deepEqual(errors, []);
  });
  await step('com internet, uma versão nova aparece ao abrir de novo', async () => {
    newVersionMark = 'nova';
    await page.reload();
    await page.waitForSelector('.view-home');
    assert.equal(await page.$eval('meta[name="versao"]', (n) => n.content), 'nova');
  });
  await step('sem internet, abre com os dados e as fontes', async () => {
    const before = await page.evaluate(() => FM.app.store.state.transactions.length);
    assert.ok(before > 0);
    await delay(200);
    watchConsole = false;
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await page.reload();
    await page.waitForSelector('.view-home');
    assert.equal(await page.evaluate(() => FM.app.store.state.transactions.length), before);
    assert.equal(await page.$eval('meta[name="versao"]', (n) => n.content), 'nova');
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.evaluate(() => [...document.fonts].every((f) => f.status === 'loaded')), true);
  });
  await step('sem internet, lançar continua funcionando e fica gravado', async () => {
    await page.evaluate(() => {
      const { store } = FM.app;
      const s = store.state;
      store.addTransaction({ type: 'expense', amount: 1000, date: FM.dates.today(), desc: 'Sem internet', categoryId: s.categories.find((c) => c.kind === 'expense').id, accountId: s.accounts[0].id, paid: true });
    });
    await page.reload();
    await page.waitForSelector('.view-home');
    assert.equal(await page.evaluate(() => FM.app.store.state.transactions.some((t) => t.desc === 'Sem internet')), true);
  });

  await step('sem erros no console', async () => {
    assert.deepEqual(consoleProblems, []);
  });

  await browser.close();
  fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
  console.log(`\n${passed} passaram, ${failures.length} falharam`);
  process.exit(failures.length ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
