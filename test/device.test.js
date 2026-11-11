/** A leitura do aparelho alimenta a contagem de instalações: sistema, versão, navegador e modelo. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

require('../js/core/device.js');

const { parseUserAgent, withClientHints } = globalThis.FM.device;
const read = (file) => fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8');

test('iPhone: o modelo exato não vem, fica "iPhone"', () => {
  const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
  assert.deepEqual(parseUserAgent(ua), { os: 'iOS', osVersion: '18.5', browser: 'Safari 18', model: 'iPhone' });
});

test('Chrome no iPhone é reconhecido como Chrome', () => {
  const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.7390.41 Mobile/15E148 Safari/604.1';
  const info = parseUserAgent(ua);
  assert.equal(info.browser, 'Chrome 141');
  assert.equal(info.osVersion, '17.6.1');
});

test('iPad que se apresenta como Mac é reconhecido pela tela de toque', () => {
  const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15';
  assert.deepEqual(parseUserAgent(ua, { maxTouchPoints: 5 }), { os: 'iPadOS', osVersion: '18.1', browser: 'Safari 18', model: 'iPad' });
  assert.equal(parseUserAgent(ua, { maxTouchPoints: 0 }).os, 'macOS');
});

test('Android antigo traz o modelo no user agent', () => {
  const ua = 'Mozilla/5.0 (Linux; Android 9; SM-G960F Build/PPR1.180610.011) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/74.0.3729.157 Mobile Safari/537.36';
  assert.deepEqual(parseUserAgent(ua), { os: 'Android', osVersion: '9', browser: 'Chrome 74', model: 'SM-G960F' });
});

test('Chrome novo no Android esconde o modelo ("K"): fica sem modelo até o userAgentData informar', () => {
  const ua = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';
  const base = parseUserAgent(ua);
  assert.equal(base.model, null);
  const full = withClientHints(base, {
    platform: 'Android',
    platformVersion: '15.0.0',
    model: 'Pixel 8',
    brands: [{ brand: 'Not?A_Brand', version: '8' }, { brand: 'Chromium', version: '141' }, { brand: 'Google Chrome', version: '141' }],
  });
  assert.deepEqual(full, { os: 'Android', osVersion: '15', browser: 'Chrome 141', model: 'Pixel 8' });
});

test('Samsung Internet e Firefox no Android', () => {
  const samsung = parseUserAgent('Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/27.0 Chrome/125.0.0.0 Mobile Safari/537.36');
  assert.equal(samsung.browser, 'Samsung Internet 27');
  assert.equal(samsung.model, 'SM-S918B');
  const firefox = parseUserAgent('Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0');
  assert.deepEqual(firefox, { os: 'Android', osVersion: '14', browser: 'Firefox 131', model: null });
});

test('computador: Windows 11 só é distinguido pelo userAgentData', () => {
  const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0';
  const base = parseUserAgent(ua);
  assert.deepEqual(base, { os: 'Windows', osVersion: '10 ou 11', browser: 'Edge 141', model: null });
  const hints = { platform: 'Windows', platformVersion: '15.0.0', model: '', brands: [{ brand: 'Microsoft Edge', version: '141' }, { brand: 'Chromium', version: '141' }] };
  assert.equal(withClientHints(base, hints).osVersion, '11');
  assert.equal(withClientHints(base, { ...hints, platformVersion: '10.0.0' }).osVersion, '10');
  assert.equal(withClientHints(base, hints).model, null);
});

test('user agent vazio ou estranho não quebra', () => {
  assert.deepEqual(parseUserAgent(''), { os: 'Outro', osVersion: null, browser: 'Outro', model: null });
  assert.deepEqual(withClientHints(parseUserAgent(''), null), { os: 'Outro', osVersion: null, browser: 'Outro', model: null });
});

test('a contagem não toca nos dados financeiros', () => {
  // O arquivo que envia dados não pode ler o que o store grava nem conhecer a chave dele.
  for (const file of ['js/ui/telemetry.js', 'js/ui/backend.js', 'js/core/device.js']) {
    const code = read(file);
    assert.doesNotMatch(code, /sobra\.dados|storeLib|\.store\b|transactions|accounts/, file);
  }
});

test('nenhuma chave secreta do Supabase está no código', () => {
  const files = ['js/config.js', 'js/ui/backend.js', 'js/ui/telemetry.js', 'js/views/admin.js', 'index.html'];
  for (const file of files) {
    const code = read(file);
    assert.doesNotMatch(code, /sb_secret_/, `${file} tem uma chave secreta`);
    // Chaves antigas são JWTs: o papel fica no meio, em base64. Só "anon" pode aparecer.
    for (const [, payload] of code.matchAll(/eyJ[\w-]+\.(eyJ[\w-]+)\.[\w-]+/g)) {
      const role = JSON.parse(Buffer.from(payload, 'base64url').toString()).role;
      assert.equal(role, 'anon', `${file} tem uma chave com papel ${role}`);
    }
  }
});
