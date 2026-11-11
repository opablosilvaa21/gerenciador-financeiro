/**
 * Confere o contraste das cores de css/tokens.css pela fórmula do WCAG 2.
 * Texto precisa de 4,5:1 (AA); ícones, bordas de controle e blocos de gráfico, de 3:1.
 * Uso: node test/contrast.js   (também roda dentro do npm test)
 */
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.resolve(__dirname, '../css/tokens.css'), 'utf8');

/** Lê as variáveis de um bloco e resolve as que apontam para outras. */
function readTokens(selector, base = {}) {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`Bloco ${selector} não encontrado em tokens.css`);
  const body = css.slice(start, css.indexOf('\n}', start));
  const raw = { ...base };
  for (const [, name, value] of body.matchAll(/(--[\w-]+):\s*([^;]+);/g)) raw[name] = value.trim();
  const resolve = (value, depth = 0) => {
    const ref = /^var\((--[\w-]+)\)$/.exec(value);
    return ref && depth < 8 ? resolve(raw[ref[1]], depth + 1) : value;
  };
  const resolved = Object.fromEntries(Object.entries(raw).map(([name, value]) => [name, resolve(value)]));
  return { raw, resolved };
}

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** [cor da frente, fundos, mínimo]. Todo texto é conferido nos fundos em que de fato aparece. */
const SURFACES = ['--paper', '--surface-solid', '--surface-sunken', '--field'];
const PAIRS = [
  ['--ink', SURFACES, 4.5],
  ['--ink-2', SURFACES, 4.5],
  ['--ink-3', SURFACES, 4.5],
  ['--accent-text', SURFACES, 4.5],
  ['--income-text', SURFACES, 4.5],
  ['--expense-text', SURFACES, 4.5],
  ['--danger', SURFACES, 4.5],
  ['--accent-ink', ['--accent'], 4.5],
  ['--cta-ink', ['--cta', '--cta-hover'], 4.5],
  ['--danger-ink', ['--danger-fill'], 4.5],
  ['--status-good', ['--status-good-wash'], 4.5],
  ['--status-warning', ['--status-warning-wash'], 4.5],
  ['--status-critical', ['--status-critical-wash'], 4.5],
  ['--ink', ['--accent-wash', '--danger-wash', '--control', '--control-hover'], 4.5],
  ['--ink-2', ['--accent-wash', '--control', '--control-hover'], 4.5],
  ['--accent-text', ['--accent-wash'], 4.5],
  ['--toast-ink', ['--toast-surface'], 4.5],
  ['--note-ink', ['--note-paper', '--note-paper-2'], 4.5],
  ['--note-ink-2', ['--note-paper', '--note-paper-2'], 4.5],
  ['--note-short-ink', ['--note-short-paper', '--note-short-paper-2'], 4.5],
  ['--note-short-ink-2', ['--note-short-paper', '--note-short-paper-2'], 4.5],
  ['--axis-text', SURFACES, 4.5],
  ['--rule-left-ink', ['--rule-left'], 4.5],
  ['--focus', SURFACES, 3],
  ['--line-strong', ['--paper', '--surface-solid'], 3],
  ['--meter-good', ['--meter-track'], 3],
  ['--meter-warning', ['--meter-track'], 3],
  ['--meter-critical', ['--meter-track'], 3],
  ['--meter-goal', ['--meter-track'], 3],
  ['--flow-in', ['--paper', '--surface-solid'], 3],
  ['--flow-out', ['--paper', '--surface-solid'], 3],
  ...[1, 2, 3, 4, 5, 6, 7, 8, 'other'].flatMap((n) => [
    [`--series-${n}`, ['--paper', '--surface-solid'], 3],
    ['--series-ink', [`--series-${n}`], 4.5],
  ]),
];

function check() {
  // O claro é o padrão (:root); o escuro herda dele e troca o que precisa.
  const light = readTokens(':root');
  const dark = readTokens(":root[data-theme='dark']", light.raw);
  const failures = [];
  const lines = [];
  for (const [theme, { resolved }] of [['escuro', dark], ['claro', light]]) {
    for (const [front, backs, min] of PAIRS) {
      for (const back of backs) {
        const a = resolved[front];
        const b = resolved[back];
        if (!/^#[0-9a-f]{6}$/i.test(a || '') || !/^#[0-9a-f]{6}$/i.test(b || '')) {
          failures.push(`${theme}: ${front} (${a}) sobre ${back} (${b}) não é cor sólida`);
          continue;
        }
        const ratio = contrast(a, b);
        const ok = ratio >= min;
        lines.push(`${ok ? '  ok ' : 'FALHA'} ${theme.padEnd(6)} ${front.padEnd(22)} ${a} sobre ${back.padEnd(22)} ${b}  ${ratio.toFixed(2)}:1 (mín. ${min})`);
        if (!ok) failures.push(`${theme}: ${front} sobre ${back} dá ${ratio.toFixed(2)}:1, abaixo de ${min}:1`);
      }
    }
  }
  return { failures, lines };
}

module.exports = { check, contrast };

if (require.main === module) {
  const { failures, lines } = check();
  console.log(lines.join('\n'));
  console.log(failures.length ? `\n${failures.length} par(es) abaixo do mínimo` : '\nTodos os pares passam no WCAG AA');
  process.exit(failures.length ? 1 : 0);
}
