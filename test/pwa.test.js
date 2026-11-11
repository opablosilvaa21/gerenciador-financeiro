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

test('os endereços do manifesto são relativos, para funcionar dentro da pasta do GitHub Pages', () => {
  const manifest = JSON.parse(read('manifest.webmanifest'));
  for (const url of [manifest.start_url, manifest.scope, ...manifest.shortcuts.map((s) => s.url)]) {
    assert.ok(url.startsWith('./'), url);
  }
});
