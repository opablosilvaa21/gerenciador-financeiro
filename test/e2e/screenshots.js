/**
 * Tira fotos do app com dados de exemplo, no celular (375 px) e no computador, em claro e escuro.
 * Uso: node test/e2e/screenshots.js <pasta-de-saida> [prefixo]
 * Precisa do puppeteer-core (npm install) e do Chrome. Outro caminho: variável CHROME_PATH.
 */
const puppeteer = require('puppeteer-core');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'test', 'screenshots'));
const PREFIX = process.argv[3] || '';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
const ROUTES = ['inicio', 'lancamentos', 'orcamentos', 'metas', 'relatorios', 'ajustes'];
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost');
  const file = path.join(ROOT, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  response.end(fs.readFileSync(file));
});

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const URL_APP = `http://localhost:${server.address().port}/`;
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-first-run', '--hide-scrollbars'] });

  for (const [device, viewport] of Object.entries({
    phone: { width: 375, height: 812, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
    desktop: { width: 1280, height: 800, deviceScaleFactor: 1 },
  })) {
    for (const scheme of ['dark', 'light']) {
      const context = await browser.createBrowserContext();
      const page = await context.newPage();
      await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }]);
      await page.setViewport(viewport);
      await page.goto(URL_APP, { waitUntil: 'networkidle0' });
      // O tema é escolhido no app (o escuro é o padrão); o do sistema não muda nada.
      await page.evaluate((theme) => FM.app?.store.setTheme(theme), scheme);
      await delay(1200);
      await page.screenshot({ path: path.join(OUT, `${PREFIX}${device}-${scheme}-boas-vindas.png`) });
      // Entra com os dados de exemplo e deixa o aviso de instalação de lado.
      await page.evaluate(() => {
        const button = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('dados de exemplo'));
        button?.click();
      });
      // Os dados de exemplo trocam o estado inteiro, tema incluído: escolhe de novo.
      await page.evaluate((theme) => FM.app?.store.setTheme(theme), scheme);
      await delay(300);
      for (const route of ROUTES) {
        await page.goto(`${URL_APP}#/${route}`, { waitUntil: 'networkidle0' });
        await page.evaluate(() => document.querySelectorAll('.banner').forEach((b) => b.remove()));
        // Os gráficos crescem quando entram na tela: rola até o fim para todos aparecerem na foto inteira.
        await page.evaluate(async () => {
          for (let y = 0; y < document.documentElement.scrollHeight; y += 400) {
            window.scrollTo(0, y);
            await new Promise((r) => setTimeout(r, 60));
          }
          window.scrollTo(0, 0);
        });
        await delay(1800);
        await page.screenshot({ path: path.join(OUT, `${PREFIX}${device}-${scheme}-${route}.png`), fullPage: device === 'desktop' });
      }
      await context.close();
    }
  }
  await browser.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  console.log(`Fotos em ${OUT}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
