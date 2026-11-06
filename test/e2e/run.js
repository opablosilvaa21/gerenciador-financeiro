/**
 * Usa o app no Chrome de verdade, aberto direto pelo arquivo, como uma pessoa usaria.
 * Precisa do puppeteer-core (npm install) e do Chrome. Outro caminho: variável CHROME_PATH.
 */
const puppeteer = require('puppeteer-core');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const FILE = `file:///${path.resolve(__dirname, '../../index.html').replace(/\\/g, '/')}`;
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

let page;
let passed = 0;
const failures = [];
const consoleProblems = [];

async function step(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (error) {
    failures.push(name);
    console.log(`FALHOU ${name}\n       ${String(error.message).split('\n').slice(0, 3).join('\n       ')}`);
    await page.keyboard.press('Escape').catch(() => {});
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach((d) => d.remove())).catch(() => {});
  }
}

const text = (selector) => page.$eval(selector, (n) => n.textContent.trim());
const texts = (selector) => page.$$eval(selector, (ns) => ns.map((n) => n.textContent.trim()));
const exists = async (selector) => (await page.$(selector)) !== null;
const pageText = () => page.evaluate(() => document.body.innerText);

/** Clica no botão ou link visível que contém o texto. */
async function click(label, scope = 'body') {
  const handle = await page.evaluateHandle((wanted, root) => {
    const candidates = [...document.querySelector(root).querySelectorAll('button, a, label')];
    const visible = candidates.filter((n) => n.offsetParent !== null || n.getClientRects().length);
    return visible.find((n) => n.textContent.trim() === wanted) || visible.find((n) => n.textContent.trim().includes(wanted));
  }, label, scope);
  const element = handle.asElement();
  assert.ok(element, `não achei "${label}"`);
  await element.click();
  await delay(40);
}

async function clearFocused() {
  await page.keyboard.down('Control');
  await page.keyboard.press('a');
  await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');
}

/** Preenche o campo pelo rótulo, como quem clica e digita. */
async function fill(label, value) {
  const id = await page.evaluate((wanted) => {
    const scope = document.querySelector('dialog[open]') || document;
    const found = [...scope.querySelectorAll('label.field-label')].find((l) => l.textContent.trim() === wanted);
    return found ? found.htmlFor : null;
  }, label);
  assert.ok(id, `não achei o campo "${label}"`);
  await page.click(`[id="${id}"]`);
  await clearFocused();
  if (value) await page.type(`[id="${id}"]`, value);
}

async function setDate(label, value) {
  const id = await page.evaluate((wanted) => {
    const found = [...document.querySelectorAll('dialog[open] label.field-label')].find((l) => l.textContent.trim() === wanted);
    return found.htmlFor;
  }, label);
  await page.$eval(`[id="${id}"]`, (input, v) => {
    input.value = v;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

async function newTransaction({ type, amount, desc, category, date, paid, installments, monthly }) {
  await page.keyboard.press('Escape');
  await click('Novo lançamento');
  await page.waitForSelector('dialog[open]');
  if (type) await click(type, 'dialog[open]');
  await fill('Valor', amount);
  if (desc) await fill('Descrição', desc);
  if (category) await click(category, 'dialog[open] .chips');
  if (date) await setDate('Data', date);
  if (paid === false) await click('Já ', 'dialog[open]');
  if (monthly) await click('Todo mês', 'dialog[open]');
  if (installments) {
    await click('Parcelado', 'dialog[open]');
    await page.$eval('dialog[open] input[type=number]', (input, v) => {
      input.value = v;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, installments);
  }
  await click('Salvar lançamento', 'dialog[open]');
  await page.waitForFunction(() => !document.querySelector('dialog[open]'));
}

const go = async (route) => {
  await page.evaluate((r) => { location.hash = `#/${r}`; }, route);
  await delay(120);
};
const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('sobra.dados.v1')));
const money = (n) => n.replace(/\u00a0/g, ' ');
const noteValue = async () => money(await text('.note-value'));

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sobra-e2e-'));
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, userDataDir: profile, args: ['--no-first-run'] });
  page = await browser.newPage();
  page.on('pageerror', (e) => consoleProblems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') consoleProblems.push(`console: ${m.text()}`); });
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(FILE);

  console.log('\nPrimeira visita');
  await step('mostra as boas-vindas e recusa saldo inválido', async () => {
    assert.ok(await exists('.welcome'));
    await fill('Quanto você tem na conta hoje?', '10,005');
    await click('Começar do zero');
    assert.match(await pageText(), /no máximo 2 casas/);
    assert.ok(await exists('.welcome'));
  });
  await step('começa do zero com o saldo informado', async () => {
    await fill('Quanto você tem na conta hoje?', '1.000,00');
    await click('Começar do zero');
    await page.waitForSelector('.view-home');
    assert.match(money(await pageText()), /Saldo hoje\s+R\$ 1\.000,00/);
    assert.equal(await noteValue(), 'R$ 0,00');
    assert.match(await pageText(), /Nenhum lançamento em/);
  });

  console.log('\nLançamentos');
  await step('formulário vazio mostra os erros e não salva', async () => {
    await page.keyboard.press('n');
    await page.waitForSelector('dialog[open]');
    await click('Salvar lançamento', 'dialog[open]');
    const body = await pageText();
    assert.match(body, /Informe o valor/);
    assert.match(body, /Escolha uma categoria/);
    assert.equal((await saved()).transactions.length, 0);
  });
  await step('valor com 3 casas é recusado, não arredondado', async () => {
    await fill('Valor', '10,005');
    await click('Mercado', 'dialog[open] .chips');
    await click('Salvar lançamento', 'dialog[open]');
    assert.match(await pageText(), /no máximo 2 casas/);
    assert.equal((await saved()).transactions.length, 0);
  });
  await step('Esc fecha o diálogo e o foco volta para a página', async () => {
    await page.keyboard.press('Escape');
    await delay(60);
    assert.ok(!(await exists('dialog[open]')));
  });
  await step('receita atualiza a cédula na hora', async () => {
    await newTransaction({ type: 'Receita', amount: '3000', desc: 'Salário de novembro', category: 'Salário' });
    assert.equal(await noteValue(), 'R$ 3.000,00');
    assert.match(money(await pageText()), /Saldo hoje\s+R\$ 4\.000,00/);
  });
  await step('a soma em centavos fica exata (0,10 + 0,20)', async () => {
    await newTransaction({ amount: '0,10', desc: 'Bala', category: 'Mercado' });
    await newTransaction({ amount: '0,20', desc: 'Bala', category: 'Mercado' });
    assert.equal(await noteValue(), 'R$ 2.999,70');
  });
  await step('gastar mais do que entrou deixa a cédula vermelha', async () => {
    await newTransaction({ amount: '3500', desc: 'Notebook', category: 'Educação' });
    assert.ok(await exists('.note-short'));
    assert.match(await text('.note-label'), /Faltam/);
    assert.equal(await noteValue(), 'R$ 500,30');
  });
  await step('Desfazer no aviso volta tudo, inclusive a cor', async () => {
    await click('Desfazer', '#toasts');
    await delay(60);
    assert.ok(!(await exists('.note-short')));
    assert.equal(await noteValue(), 'R$ 2.999,70');
  });
  await step('Ctrl+Z também desfaz', async () => {
    await newTransaction({ amount: '1', desc: 'Para desfazer', category: 'Lazer' });
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.down('Control');
    await page.keyboard.press('z');
    await page.keyboard.up('Control');
    await delay(60);
    assert.equal(await noteValue(), 'R$ 2.999,70');
  });
  await step('o formulário sugere a categoria pela descrição já usada', async () => {
    await click('Novo lançamento');
    await page.waitForSelector('dialog[open]');
    await fill('Descrição', 'Bala');
    await delay(40);
    const checked = await page.$eval('dialog[open] .chips input:checked + span', (n) => n.textContent.trim());
    assert.equal(checked, 'Mercado');
    await page.keyboard.press('Escape');
  });
  await step('"Salvar e adicionar outro" mantém o formulário aberto', async () => {
    await click('Novo lançamento');
    await fill('Valor', '5');
    await click('Lazer', 'dialog[open] .chips');
    await click('Salvar e adicionar outro', 'dialog[open]');
    assert.ok(await exists('dialog[open]'));
    assert.equal(await page.$eval('dialog[open] .input-money', (n) => n.value), '');
    await page.keyboard.press('Escape');
    await delay(40);
    assert.equal(await noteValue(), 'R$ 2.994,70');
  });
  await step('editar um lançamento altera o valor', async () => {
    await go('lancamentos');
    await click('Lazer', '.tx-table');
    await page.waitForSelector('dialog[open]');
    await fill('Valor', '7,50');
    await click('Salvar alterações', 'dialog[open]');
    await delay(60);
    assert.match(money(await pageText()), /−R\$ 7,50/);
  });
  await step('texto digitado nunca vira código na página', async () => {
    await newTransaction({ amount: '1', desc: '<img src=x onerror="window.__xss=1">', category: 'Lazer' });
    await delay(100);
    assert.equal(await page.evaluate(() => window.__xss), undefined);
    assert.match(await pageText(), /<img src=x/);
  });
  await step('os dados continuam depois de recarregar a página', async () => {
    const before = (await saved()).transactions.length;
    await page.reload();
    await page.waitForSelector('.view');
    assert.equal((await saved()).transactions.length, before);
    assert.match(await pageText(), /<img src=x/);
  });

  console.log('\nParcelas, pendências e meses');
  await step('parcelamento em 3x soma exatamente o total', async () => {
    await go('inicio');
    await newTransaction({ amount: '1000', desc: 'Geladeira', category: 'Moradia', installments: '3' });
    const parts = (await saved()).transactions.filter((t) => t.installment);
    assert.deepEqual(parts.map((p) => p.amount).sort((a, b) => b - a), [33334, 33333, 33333]);
    assert.deepEqual(parts.map((p) => p.paid), [true, false, false]);
  });
  await step('as setas mudam de mês e a parcela aparece no mês seguinte', async () => {
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('ArrowRight');
    await delay(80);
    assert.match(await pageText(), /Geladeira \(2\/3\)/);
    assert.equal(await noteValue(), 'R$ 333,33');
    assert.ok(await exists('.note-short'));
    await click('Voltar para hoje');
    await delay(60);
  });
  await step('marcar como pago muda o saldo, e desmarcar devolve', async () => {
    const date = await page.evaluate(() => FM.dates.addDays(FM.dates.today(), 3));
    await newTransaction({ amount: '100', desc: 'Conta futura', category: 'Moradia', date });
    const balance = () => page.evaluate(() => FM.queries.totalBalance(FM.app.store.state));
    const before = await balance();
    const tx = (await saved()).transactions.find((t) => t.desc === 'Conta futura');
    assert.equal(tx.paid, false, 'data futura começa pendente');
    await page.click(`[data-fk="pago-${tx.id}"]`);
    await delay(50);
    assert.equal(await balance(), before - 10000);
    await page.click(`[data-fk="pago-${tx.id}"]`);
    await delay(50);
    assert.equal(await balance(), before);
  });
  await step('excluir uma parcela oferece excluir as seguintes', async () => {
    await go('lancamentos');
    await click('Geladeira (1/3)', '.tx-table');
    await page.waitForSelector('dialog[open]');
    await click('Excluir', 'dialog[open] .dialog-foot');
    await delay(40);
    await click('Excluir esta e as seguintes');
    await delay(60);
    assert.equal((await saved()).transactions.filter((t) => t.installment).length, 0);
    await click('Desfazer', '#toasts');
    await delay(60);
    assert.equal((await saved()).transactions.filter((t) => t.installment).length, 3);
  });

  console.log('\nBusca, filtros e lote');
  await step('a busca ignora acento e não perde o foco ao digitar', async () => {
    await go('lancamentos');
    await page.keyboard.press('/');
    await delay(40);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'busca-lancamentos');
    await page.type('#busca-lancamentos', 'salario');
    await delay(40);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'busca-lancamentos');
    assert.deepEqual(await texts('.tx-table tbody .tx-title'), ['Salário de novembro']);
  });
  await step('busca sem resultado oferece limpar os filtros', async () => {
    await page.type('#busca-lancamentos', 'zzzz');
    await delay(40);
    assert.match(await pageText(), /Nenhum lançamento com esses filtros/);
    await click('Limpar filtros');
    await delay(60);
    assert.ok((await texts('.tx-table tbody .tx-title')).length > 3);
  });
  await step('ordenar por valor funciona nos dois sentidos', async () => {
    await click('Valor', '.tx-table thead');
    const first = await texts('.tx-table tbody .cell-amount');
    assert.match(money(first[0]), /3\.000,00/);
    await click('Valor', '.tx-table thead');
    const second = await texts('.tx-table tbody .cell-amount');
    assert.match(money(second[0]), /0,10/);
    await click('Data', '.tx-table thead');
  });
  await step('filtro por tipo e por situação', async () => {
    await page.select('.filters label:nth-of-type(1) select', 'income');
    await delay(40);
    assert.deepEqual(await texts('.tx-table tbody .tx-title'), ['Salário de novembro']);
    await page.select('.filters label:nth-of-type(1) select', '');
    await page.select('.filters label:nth-of-type(4) select', 'pending');
    await delay(40);
    assert.ok((await texts('.tx-table tbody .tx-title')).includes('Conta futura'));
    await page.select('.filters label:nth-of-type(4) select', '');
    await delay(40);
  });
  await step('selecionar em lote e excluir, com desfazer', async () => {
    const before = (await saved()).transactions.length;
    const boxes = await page.$$('.tx-table tbody .cell-check input');
    await boxes[0].click();
    await boxes[1].click();
    assert.match(await text('.bulk strong'), /2 selecionados/);
    await click('Excluir', '.bulk');
    await delay(60);
    assert.equal((await saved()).transactions.length, before - 2);
    await click('Desfazer', '#toasts');
    await delay(60);
    assert.equal((await saved()).transactions.length, before);
  });
  await step('mudar a categoria em lote', async () => {
    const boxes = await page.$$('.tx-table tbody .cell-check input');
    const targets = await page.evaluate(() => FM.queries.sortTransactions(FM.app.store.state, FM.queries.filterTransactions(FM.app.store.state, { month: FM.app.ctx.month })).filter((t) => t.desc === 'Bala').map((t) => t.id));
    assert.equal(targets.length, 2);
    const rows = await page.$$eval('.tx-table tbody tr', (trs) => trs.map((tr) => tr.querySelector('[data-fk]')?.dataset.fk));
    for (const id of targets) await boxes[rows.indexOf(`tx-${id}`)].click();
    await click('Mudar categoria', '.bulk');
    await page.waitForSelector('dialog[open]');
    const lazer = await page.evaluate(() => FM.app.store.state.categories.find((c) => c.name === 'Lazer').id);
    await page.select('dialog[open] select', lazer);
    await click('Mudar categoria', 'dialog[open] .dialog-foot');
    await delay(60);
    const updated = (await saved()).transactions.filter((t) => t.desc === 'Bala');
    assert.ok(updated.every((t) => t.categoryId === lazer));
    await click('Desfazer', '#toasts');
    await delay(60);
  });
  await step('clicar em uma parte da régua abre os lançamentos da categoria', async () => {
    await go('inicio');
    await page.click('.rule-bar button.rule-part');
    await delay(120);
    assert.match(await page.evaluate(() => location.hash), /lancamentos/);
    const titles = await page.$$eval('.tx-table tbody .tx-sub', (ns) => ns.map((n) => n.innerText.trim()));
    assert.ok(titles.length >= 1);
    const firstCategory = titles[0].split(',')[0];
    assert.ok(titles.every((t) => t.includes(firstCategory)), 'só uma categoria na lista');
    await page.select('.filters label:nth-of-type(2) select', '');
    await delay(40);
  });

  await step('"Ver todos" de pendentes abre os pendentes de todos os meses', async () => {
    await go('inicio');
    await click('Ver todos', '.column');
    await delay(100);
    assert.equal(await page.$eval('.filter-all input', (n) => n.checked), true);
    assert.equal(await page.$eval('.filters label:nth-of-type(4) select', (n) => n.value), 'pending');
    assert.match(await pageText(), /Geladeira \(2\/3\)/);
    await page.select('.filters label:nth-of-type(4) select', '');
    await page.click('.filter-all input');
    await delay(60);
  });

  console.log('\nCarteiras');
  await step('criar carteira e transferir não muda o total', async () => {
    await go('carteiras');
    await click('Nova carteira');
    await fill('Nome', 'Reserva');
    await fill('Saldo inicial', '200');
    await click('Criar carteira', 'dialog[open]');
    await delay(60);
    const total = () => page.evaluate(() => FM.queries.totalBalance(FM.app.store.state));
    const before = await total();
    await click('Transferir');
    await page.waitForSelector('dialog[open]');
    await fill('Valor', '50');
    await click('Salvar lançamento', 'dialog[open]');
    await delay(60);
    assert.equal(await total(), before);
    const balances = await page.evaluate(() => FM.app.store.state.accounts.map((a) => FM.queries.accountBalance(FM.app.store.state, a.id)));
    assert.equal(balances[1], 25000);
  });
  await step('carteira com lançamentos não pode ser apagada e explica o motivo', async () => {
    await click('Reserva', '.account-list');
    await page.waitForSelector('dialog[open]');
    await click('Excluir', 'dialog[open] .dialog-foot');
    await delay(40);
    assert.match(await pageText(), /tem lançamentos/);
    assert.equal((await saved()).accounts.length, 2);
    await page.keyboard.press('Escape');
  });

  console.log('\nOrçamentos');
  await step('definir limite direto na linha, e valor inválido é recusado', async () => {
    await go('orcamentos');
    const input = await page.$('.budget-list .input-limit');
    await input.click();
    await clearFocused();
    await input.type('abc');
    await page.keyboard.press('Enter');
    await delay(40);
    assert.equal(await page.$eval('.budget-list .input-limit', (n) => n.getAttribute('aria-invalid')), 'true');
    assert.equal((await saved()).categories[0].budget, 0);
    await input.click();
    await clearFocused();
    await input.type('100');
    await page.keyboard.press('Enter');
    await delay(60);
    assert.equal((await saved()).categories[0].budget, 10000);
  });
  await step('o estado do limite aparece em palavras, não só na cor', async () => {
    await page.keyboard.press('Escape');
    assert.match(await pageText(), /Passou do limite|Perto do limite|Dentro do limite/);
  });

  console.log('\nContas fixas');
  await step('conta fixa cria o lançamento do mês como pendente', async () => {
    await go('fixas');
    await click('Nova conta fixa');
    await fill('Descrição', 'Academia');
    await fill('Valor', '89,90');
    await fill('Dia do mês', '31');
    await click('Criar conta fixa', 'dialog[open]');
    await delay(60);
    const data = await saved();
    const rule = data.recurring.find((r) => r.desc === 'Academia');
    assert.ok(rule);
    const created = data.transactions.filter((t) => t.recurringId === rule.id);
    assert.equal(created.length, 1);
    assert.equal(created[0].paid, false);
    assert.equal(created[0].amount, 8990);
  });
  await step('dia inválido é recusado', async () => {
    await click('Academia', '.rule-list');
    await page.waitForSelector('dialog[open]');
    await fill('Dia do mês', '40');
    await click('Salvar alterações', 'dialog[open]');
    assert.match(await pageText(), /dia de 1 a 31/);
    await page.keyboard.press('Escape');
    await delay(40);
  });
  await step('pausar e retomar', async () => {
    await page.click('[aria-label="Pausar Academia"]');
    await delay(50);
    assert.equal((await saved()).recurring[0].active, false);
    assert.match(await pageText(), /Pausada/);
    await page.click('[aria-label="Retomar Academia"]');
    await delay(50);
    assert.equal((await saved()).recurring[0].active, true);
  });

  console.log('\nMetas');
  await step('criar meta e guardar valor', async () => {
    await go('metas');
    await click('Nova meta');
    await fill('Nome da meta', 'Viagem');
    await fill('Quanto quer juntar', '1000');
    await click('Criar meta', 'dialog[open]');
    await delay(60);
    await click('Guardar', '.goal-list');
    await fill('Quanto guardar', '250');
    await click('Guardar', 'dialog[open] .dialog-foot');
    await delay(60);
    assert.equal((await saved()).goals[0].saved, 25000);
    assert.match(await pageText(), /25%/);
  });
  await step('retirar mais do que guardou é recusado', async () => {
    await click('Retirar', '.goal-list');
    await fill('Quanto retirar', '300');
    await click('Retirar', 'dialog[open] .dialog-foot');
    assert.match(money(await pageText()), /Só há R\$ 250,00/);
    assert.equal((await saved()).goals[0].saved, 25000);
    await page.keyboard.press('Escape');
    await delay(40);
  });
  await step('chegar ao valor marca a meta como alcançada', async () => {
    await click('Guardar', '.goal-list');
    await fill('Quanto guardar', '750');
    await click('Guardar', 'dialog[open] .dialog-foot');
    await delay(60);
    assert.match(await pageText(), /Meta alcançada/);
  });

  console.log('\nGráficos');
  await step('ver como tabela e voltar', async () => {
    await go('relatorios');
    await click('Ver tabela');
    assert.ok(await exists('.chart .data-table'));
    await click('Ver gráfico');
    await delay(60);
    assert.ok(await exists('.chart-svg'));
  });
  await step('passar o mouse no mês mostra a dica; sair esconde', async () => {
    const box = await (await page.$('.bar-group.is-selected .bar-hit')).boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await delay(50);
    assert.equal(await page.$eval('.tip', (n) => n.hidden), false);
    assert.match(await text('.tip'), /entrou/);
    await page.mouse.move(5, 5);
    await delay(50);
    assert.equal(await page.$eval('.tip', (n) => n.hidden), true);
  });
  await step('a dica também aparece pelo teclado', async () => {
    await page.$eval('.bar-group.is-selected', (n) => n.focus());
    await delay(50);
    assert.equal(await page.$eval('.tip', (n) => n.hidden), false);
    await page.evaluate(() => document.activeElement.blur());
  });
  await step('Enter em um mês do gráfico abre esse mês', async () => {
    await page.$eval('.bar-group', (n) => n.focus());
    await page.keyboard.press('Enter');
    await delay(100);
    assert.match(await page.evaluate(() => location.hash), /inicio/);
    await click('Voltar para hoje');
    await delay(60);
  });
  await step('trocar o período do relatório', async () => {
    await go('relatorios');
    await click('12 meses');
    await delay(100);
    assert.equal((await page.$$('.bar-group')).length, 12);
  });
  await step('o gráfico se ajusta ao mudar o tamanho da janela', async () => {
    await page.setViewport({ width: 700, height: 900 });
    await delay(150);
    const width = await page.$eval('.chart-svg', (n) => Number(n.getAttribute('width')));
    assert.ok(width < 700);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
    await page.setViewport({ width: 1280, height: 900 });
    await delay(150);
  });

  console.log('\nAjustes e arquivos');
  await step('criar categoria e recusar nome repetido', async () => {
    await go('ajustes');
    await page.click('[data-fk="nova-cat-expense"]');
    await page.waitForSelector('dialog[open]');
    await fill('Nome da categoria', 'mercado');
    await click('Criar categoria', 'dialog[open]');
    assert.match(await pageText(), /Já existe/);
    await fill('Nome da categoria', 'Pets');
    await click('Criar categoria', 'dialog[open]');
    await delay(60);
    assert.ok((await saved()).categories.some((c) => c.name === 'Pets'));
  });
  await step('importar extrato CSV: mostra o resumo e deixa as repetidas de fora', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sobra-csv-'));
    const file = path.join(dir, 'extrato.csv');
    fs.writeFileSync(file, 'Data;Histórico;Valor\n01/10/2026;Padaria;-12,50\n02/10/2026;Pix recebido;100,00\n99/99/2026;Linha ruim;1,00\n');
    const importOnce = async () => {
      const [chooser] = await Promise.all([page.waitForFileChooser(), click('Importar extrato em CSV')]);
      await chooser.accept([file]);
      await page.waitForSelector('dialog[open]');
    };
    const before = (await saved()).transactions.length;
    await importOnce();
    const dialogText = await page.$eval('dialog[open]', (n) => n.innerText);
    assert.match(dialogText, /2 lançamentos novos/);
    assert.match(dialogText, /1 linha ignorada/);
    await click('Importar 2', 'dialog[open]');
    await delay(60);
    assert.equal((await saved()).transactions.length, before + 2);
    await importOnce();
    assert.match(await page.$eval('dialog[open]', (n) => n.innerText), /0 lançamentos novos/);
    await page.keyboard.press('Escape');
    await delay(40);
  });
  await step('backup inválido é recusado sem tocar nos dados', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sobra-json-'));
    const file = path.join(dir, 'ruim.json');
    fs.writeFileSync(file, '{"accounts": "nada"}');
    const before = JSON.stringify(await saved());
    const [chooser] = await Promise.all([page.waitForFileChooser(), click('Restaurar backup')]);
    await chooser.accept([file]);
    await delay(100);
    assert.match(await text('#toasts'), /Não dá para restaurar/);
    assert.equal(JSON.stringify(await saved()), before);
  });
  await step('backup válido restaura tudo', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sobra-json-'));
    const file = path.join(dir, 'bom.json');
    const data = await saved();
    fs.writeFileSync(file, JSON.stringify(data));
    await page.evaluate(() => FM.app.store.deleteTransactions(FM.app.store.state.transactions.map((t) => t.id)));
    await delay(50);
    const [chooser] = await Promise.all([page.waitForFileChooser(), click('Restaurar backup')]);
    await chooser.accept([file]);
    await page.waitForSelector('dialog[open]');
    await click('Restaurar backup', 'dialog[open] .dialog-foot');
    await delay(60);
    assert.equal((await saved()).transactions.length, data.transactions.length);
  });
  await step('o tema escuro é escolhido e continua depois de recarregar', async () => {
    await click('Escuro');
    await delay(40);
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
    await page.reload();
    await page.waitForSelector('.view');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
    await click('Claro');
    await delay(40);
  });
  await step('exportar CSV avisa quantos saíram', async () => {
    await go('lancamentos');
    await click('Exportar CSV');
    await delay(60);
    assert.match(await text('#toasts'), /exportados/);
  });
  await step('dados corrompidos no navegador não derrubam o app', async () => {
    const good = await page.evaluate(() => localStorage.getItem('sobra.dados.v1'));
    await page.evaluate(() => localStorage.setItem('sobra.dados.v1', '{ quebrado'));
    await page.reload();
    await page.waitForSelector('.welcome');
    await page.evaluate((value) => localStorage.setItem('sobra.dados.v1', value), good);
    await page.reload();
    await page.waitForSelector('.view');
  });
  await step('apagar tudo exige escrever APAGAR', async () => {
    await go('ajustes');
    await click('Apagar todos os dados');
    await fill('Escreva APAGAR para confirmar', 'sim');
    await click('Apagar tudo', 'dialog[open]');
    assert.match(await pageText(), /Escreva APAGAR, em uma palavra/);
    assert.ok((await saved()).transactions.length > 0);
    await fill('Escreva APAGAR para confirmar', 'apagar');
    await click('Apagar tudo', 'dialog[open]');
    await page.waitForSelector('.welcome');
    assert.equal((await saved()).transactions.length, 0);
  });
  await step('recomeçar leva ao Início, e dá para sair do exemplo depois', async () => {
    await click('Ver com dados de exemplo');
    await page.waitForSelector('.view-home');
    assert.match(await page.evaluate(() => location.hash), /inicio/);
    assert.match(await pageText(), /dados de exemplo/);
    assert.ok((await saved()).transactions.length > 100);
    await click('Começar do zero', '#banners');
    await page.waitForSelector('dialog[open]');
    await click('Começar do zero', 'dialog[open] .dialog-foot');
    await delay(60);
    assert.equal((await saved()).transactions.length, 0);
    assert.equal((await saved()).demo, false);
  });

  console.log(`\n${passed} passaram, ${failures.length} falharam`);
  if (consoleProblems.length) {
    console.log('Erros no console do navegador:');
    [...new Set(consoleProblems)].forEach((p) => console.log(`  ${p}`));
  } else {
    console.log('Nenhum erro no console do navegador.');
  }
  await browser.close();
  fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
  process.exit(failures.length || consoleProblems.length ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
