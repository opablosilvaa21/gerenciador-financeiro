/** Confere o que faz o app abrir sem internet: uma lista desatualizada só apareceria para quem está offline. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const swFiles = () => JSON.parse(`[${read('sw.js').match(/const FILES = \[([\s\S]*?)\];/)[1].replace(/'/g, '"').replace(/,\s*$/, '')}]`);

test('todo arquivo da lista offline existe', () => {
  for (const file of swFiles().filter((f) => f !== './')) {
    assert.ok(fs.existsSync(path.join(ROOT, file)), `${file} não existe`);
  }
});

test('tudo o que a página carrega está na lista offline', () => {
  const html = read('index.html');
  const used = [...html.matchAll(/<(?:script src|link rel="stylesheet" href)="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(used.length > 10);
  const fonts = [...read('css/tokens.css').matchAll(/url\('\.\.\/([^']+)'\)/g)].map((m) => m[1]);
  assert.equal(fonts.length, 3);
  const list = swFiles();
  for (const file of [...used, ...fonts, './', 'index.html', 'manifest.webmanifest']) {
    assert.ok(list.includes(file), `${file} não abre sem internet`);
  }
});

test('os ícones e as telas do manifesto existem no tamanho declarado', () => {
  const manifest = JSON.parse(read('manifest.webmanifest'));
  assert.ok(manifest.icons.some((i) => i.purpose === 'maskable'));
  assert.ok(manifest.icons.some((i) => i.sizes === '512x512' && i.purpose === 'any'));
  for (const image of [...manifest.icons, ...manifest.screenshots]) {
    const png = fs.readFileSync(path.join(ROOT, image.src));
    assert.equal(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`, image.sizes, image.src);
  }
});

test('toda publicação muda o sw.js, e é isso que faz os aparelhos se atualizarem', () => {
  const has = (text, piece, message) => assert.ok(text.includes(piece), message || `falta: ${piece}`);
  const sw = read('sw.js');
  has(sw, "const BUILD = '__BUILD__';");
  has(sw, 'const CACHE = `sobra-${BUILD}`;');
  has(read('js/config.js'), "build: '__BUILD__'");
  const workflow = read('.github/workflows/publicar.yml');
  has(workflow, 'sed -i "s/__BUILD__/${BUILD}/g" sw.js js/config.js');
  has(workflow, 'run: npm test');
  has(workflow, 'needs: testes', 'só publica se os testes passarem');
});

test('a publicação leva tudo o que a página carrega', () => {
  const line = read('.github/workflows/publicar.yml').split('\n').find((l) => l.trim().startsWith('cp -r '));
  const copy = line.trim().replace('cp -r ', '').replace(' _site/', '').split(' ');
  for (const file of swFiles().filter((f) => f !== './')) {
    assert.ok(copy.some((entry) => file === entry || file.startsWith(`${entry}/`)), `${file} não seria publicado`);
  }
});

test('a versão do app é a mesma no package.json e em js/config.js', () => {
  const { version } = JSON.parse(read('package.json'));
  assert.ok(read('js/config.js').includes(`appVersion: '${version}'`), `js/config.js não está na versão ${version}`);
});

test('os endereços do manifesto são relativos, para funcionar dentro da pasta do GitHub Pages', () => {
  const manifest = JSON.parse(read('manifest.webmanifest'));
  for (const url of [manifest.start_url, manifest.scope, ...manifest.shortcuts.map((s) => s.url)]) {
    assert.ok(url.startsWith('./'), url);
  }
});

test('o site publica o que a versão Android precisa: assetlinks e a política de privacidade', () => {
  const links = JSON.parse(read('.well-known/assetlinks.json'));
  const twa = JSON.parse(read('android/twa-manifest.json'));
  assert.equal(links[0].target.package_name, twa.packageId);
  assert.match(links[0].target.sha256_cert_fingerprints[0], /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
  assert.equal(twa.host, 'opablosilvaa21.github.io');
  assert.match(twa.startUrl, /^\/gerenciador-financeiro\//);
  const copy = read('.github/workflows/publicar.yml').split('\n').find((l) => l.trim().startsWith('cp -r '));
  for (const file of ['.well-known', 'privacidade.html']) assert.ok(copy.includes(` ${file} `), `${file} não seria publicado`);
  assert.match(read('privacidade.html'), /Política de privacidade/);
  assert.ok(!fs.existsSync(path.join(ROOT, 'android', 'app')), 'o projeto Android gerado (com chaves) não deve estar no repositório');
});
