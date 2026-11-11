/** As cores de css/tokens.css precisam manter o contraste mínimo do WCAG AA, no tema escuro e no claro. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { check } = require('./contrast.js');

test('todo par de texto e fundo da paleta passa no WCAG AA', () => {
  assert.deepEqual(check().failures, []);
});
