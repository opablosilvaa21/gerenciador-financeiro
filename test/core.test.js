const test = require('node:test');
const assert = require('node:assert/strict');

require('../js/core/money.js');
require('../js/core/dates.js');
require('../js/core/store.js');
require('../js/core/queries.js');
require('../js/core/demo.js');

const { money, dates, queries: q, storeLib, demo } = globalThis.FM;

const TODAY = '2026-11-15';

function newStore(today = TODAY) {
  const memory = new Map();
  const storage = {
    getItem: (k) => (memory.has(k) ? memory.get(k) : null),
    setItem: (k, v) => memory.set(k, v),
  };
  return { store: storeLib.createStore({ storage, today: () => today }), storage, memory };
}

function category(store, name) {
  return store.state.categories.find((c) => c.name === name);
}

function expense(store, overrides = {}) {
  return store.addTransaction({
    type: 'expense',
    amount: 1000,
    date: TODAY,
    desc: 'Teste',
    categoryId: category(store, 'Mercado').id,
    accountId: store.state.accounts[0].id,
    paid: true,
    ...overrides,
  });
}

test('money.parse aceita os formatos brasileiros e o ponto decimal', () => {
  assert.equal(money.parse('1.234,56').cents, 123456);
  assert.equal(money.parse('1234,56').cents, 123456);
  assert.equal(money.parse('1234.56').cents, 123456);
  assert.equal(money.parse('12,5').cents, 1250);
  assert.equal(money.parse('12').cents, 1200);
  assert.equal(money.parse('R$ 1.000').cents, 100000);
  assert.equal(money.parse('1.000.000,00').cents, 100000000);
  assert.equal(money.parse('-50,10').cents, -5010);
});

test('money.parse recusa em vez de arredondar', () => {
  assert.match(money.parse('10,005').error, /2 casas/);
  assert.ok(money.parse('').error);
  assert.ok(money.parse('abc').error);
  assert.ok(money.parse('1,2,3').error);
  assert.ok(money.parse('9999999999999').error);
});

test('money.parse não sofre com erro de ponto flutuante', () => {
  assert.equal(money.parse('0,07').cents, 7);
  assert.equal(money.parse('1,15').cents, 115);
  assert.equal(money.parse('4,35').cents, 435);
});

test('money.split: as parcelas somam exatamente o total', () => {
  const parts = money.split(100000, 3);
  assert.deepEqual(parts, [33334, 33333, 33333]);
  assert.equal(parts.reduce((a, b) => a + b), 100000);
});

test('dates: dia 31 cabe no último dia do mês', () => {
  assert.equal(dates.dateIn('2026-02', 31), '2026-02-28');
  assert.equal(dates.dateIn('2028-02', 31), '2028-02-29');
  assert.equal(dates.addMonthsToDate('2026-01-31', 1), '2026-02-28');
});

test('dates: meses atravessam o ano', () => {
  assert.equal(dates.addMonths('2026-12', 1), '2027-01');
  assert.equal(dates.addMonths('2026-01', -1), '2025-12');
  assert.deepEqual(dates.monthRange('2026-02', 3), ['2025-12', '2026-01', '2026-02']);
  assert.equal(dates.diffMonths('2026-11', '2027-02'), 3);
});

test('dates.isValidDate recusa datas que não existem', () => {
  assert.ok(dates.isValidDate('2028-02-29'));
  assert.ok(!dates.isValidDate('2026-02-30'));
  assert.ok(!dates.isValidDate('05/11/2026'));
});

test('saldo só conta o que já foi pago', () => {
  const { store } = newStore();
  const accountId = store.state.accounts[0].id;
  store.saveAccount(accountId, { initial: 10000 });
  expense(store, { amount: 3000, paid: true });
  expense(store, { amount: 2000, paid: false });

  assert.equal(q.accountBalance(store.state, accountId), 7000);
  assert.equal(q.accountBalance(store.state, accountId, { includePending: true }), 5000);
});

test('transferência move entre carteiras e não entra como receita nem despesa', () => {
  const { store } = newStore();
  const from = store.state.accounts[0].id;
  const to = store.saveAccount(null, { name: 'Poupança', type: 'poupanca', initial: 0 }).id;
  store.addTransaction({ type: 'transfer', amount: 5000, date: TODAY, accountId: from, toAccountId: to, paid: true });

  assert.equal(q.accountBalance(store.state, from), -5000);
  assert.equal(q.accountBalance(store.state, to), 5000);
  assert.equal(q.totalBalance(store.state), 0);
  const summary = q.monthSummary(store.state, '2026-11');
  assert.equal(summary.income, 0);
  assert.equal(summary.expense, 0);
});

test('transferência para a mesma carteira é recusada', () => {
  const { store } = newStore();
  const id = store.state.accounts[0].id;
  assert.throws(() =>
    store.addTransaction({ type: 'transfer', amount: 100, date: TODAY, accountId: id, toAccountId: id, paid: true }),
  );
});

test('resumo do mês separa pago e pendente e calcula a sobra prevista', () => {
  const { store } = newStore();
  const accountId = store.state.accounts[0].id;
  store.addTransaction({ type: 'income', amount: 100000, date: TODAY, categoryId: category(store, 'Salário').id, accountId, paid: true });
  expense(store, { amount: 30000, paid: true });
  expense(store, { amount: 20000, paid: false });
  expense(store, { amount: 99999, date: '2026-10-01' });

  const summary = q.monthSummary(store.state, '2026-11');
  assert.equal(summary.income, 100000);
  assert.equal(summary.expense, 50000);
  assert.equal(summary.toPay, 20000);
  assert.equal(summary.left, 50000);
});

test('valor gasto por dia usa os dias restantes, incluindo hoje', () => {
  const { store } = newStore();
  const accountId = store.state.accounts[0].id;
  store.addTransaction({ type: 'income', amount: 160000, date: TODAY, categoryId: category(store, 'Salário').id, accountId, paid: true });

  const allowance = q.perDayAllowance(store.state, '2026-11', TODAY);
  assert.equal(allowance.days, 16);
  assert.equal(allowance.perDay, 10000);
  assert.equal(q.perDayAllowance(store.state, '2026-10', TODAY), null);
});

test('parcelamento gera as parcelas certas e soma o total', () => {
  const { store } = newStore();
  const created = expense(store, {
    amount: 100000,
    date: '2026-01-31',
    paid: true,
    repeat: { mode: 'installments', count: 3 },
  });

  assert.equal(created.length, 3);
  assert.deepEqual(created.map((t) => t.date), ['2026-01-31', '2026-02-28', '2026-03-31']);
  assert.deepEqual(created.map((t) => t.paid), [true, false, false]);
  assert.equal(created.reduce((sum, t) => sum + t.amount, 0), 100000);
  assert.equal(q.titleOf(store.state, created[1]), 'Teste (2/3)');
});

test('conta fixa gera um lançamento por mês até o mês atual, sem duplicar', () => {
  const { store, storage } = newStore();
  expense(store, { amount: 5000, date: '2026-09-30', repeat: { mode: 'monthly' } });

  assert.deepEqual(store.state.transactions.map((t) => t.date).sort(), ['2026-09-30', '2026-10-30', '2026-11-30']);
  assert.equal(store.state.recurring[0].lastMonth, '2026-11');

  const reopened = storeLib.createStore({ storage, today: () => TODAY });
  reopened.load();
  assert.equal(reopened.state.transactions.length, 3);

  const nextMonth = storeLib.createStore({ storage, today: () => '2026-12-01' });
  nextMonth.load();
  assert.equal(nextMonth.state.transactions.length, 4);
  assert.equal(nextMonth.state.transactions.filter((t) => !t.paid).length, 3);
});

test('conta fixa pausada não gera lançamentos', () => {
  const { store, storage } = newStore();
  expense(store, { date: '2026-11-01', repeat: { mode: 'monthly' } });
  store.saveRecurring(store.state.recurring[0].id, { active: false });

  const later = storeLib.createStore({ storage, today: () => '2027-03-01' });
  later.load();
  assert.equal(later.state.transactions.length, 1);
});

test('desfazer devolve exatamente o estado anterior e grava', () => {
  const { store, storage } = newStore();
  expense(store);
  const before = JSON.stringify(store.state);
  store.deleteTransactions([store.state.transactions[0].id]);
  assert.equal(store.state.transactions.length, 0);

  assert.equal(store.undo(), 'Lançamento excluído');
  assert.equal(JSON.stringify(store.state), before);
  assert.equal(storage.getItem(storeLib.KEY), before);
});

test('os dados voltam depois de fechar e abrir', () => {
  const { store, storage } = newStore();
  expense(store, { desc: 'Persistiu' });
  const reopened = storeLib.createStore({ storage, today: () => TODAY });
  assert.ok(reopened.load());
  assert.equal(reopened.state.transactions[0].desc, 'Persistiu');
});

test('dados corrompidos no navegador não derrubam o app', () => {
  const storage = { getItem: () => '{ quebrado', setItem() {} };
  const store = storeLib.createStore({ storage, today: () => TODAY });
  assert.equal(store.load(), false);
  assert.equal(store.state.transactions.length, 0);
});

test('falha ao gravar fica visível em vez de derrubar', () => {
  const storage = {
    getItem: () => null,
    setItem() {
      throw new Error('cheio');
    },
  };
  const store = storeLib.createStore({ storage, today: () => TODAY });
  expense(store);
  assert.equal(store.saveFailed, true);
  assert.equal(store.state.transactions.length, 1);
});

test('validateState recusa arquivos ruins', () => {
  assert.ok(storeLib.validateState(null).length);
  assert.ok(storeLib.validateState({ accounts: [] }).length);
  const { store } = newStore();
  expense(store);
  assert.deepEqual(storeLib.validateState(store.state), []);

  const bad = JSON.parse(JSON.stringify(store.state));
  bad.transactions[0].amount = 10.5;
  assert.ok(storeLib.validateState(bad).length);
});

test('carteira com lançamentos e a última carteira não podem ser apagadas', () => {
  const { store } = newStore();
  const first = store.state.accounts[0].id;
  assert.ok(store.deleteAccount(first));
  const second = store.saveAccount(null, { name: 'B', type: 'carteira', initial: 0 }).id;
  expense(store);
  assert.match(store.deleteAccount(first), /lançamentos/);
  assert.equal(store.deleteAccount(second), null);
});

test('excluir categoria move os lançamentos para a substituta', () => {
  const { store } = newStore();
  const market = category(store, 'Mercado').id;
  const others = category(store, 'Outros gastos').id;
  const [tx] = expense(store);
  store.deleteCategory(market, others);
  assert.equal(store.state.transactions.find((t) => t.id === tx.id).categoryId, others);
});

test('categoria nova usa uma cor livre e, sem cor livre, fica neutra', () => {
  const { store } = newStore();
  assert.equal(store.saveCategory(null, { name: 'Pet', kind: 'expense' }).slot, null);
  store.deleteCategory(category(store, 'Lazer').id, category(store, 'Outros gastos').id);
  assert.equal(store.saveCategory(null, { name: 'Viagem', kind: 'expense' }).slot, 3);
});

test('meta nunca fica com guardado negativo', () => {
  const { store } = newStore();
  const goal = store.saveGoal(null, { name: 'Viagem', target: 10000 });
  store.moveGoal(goal.id, 3000, TODAY);
  assert.throws(() => store.moveGoal(goal.id, -5000, TODAY));
  store.moveGoal(goal.id, -1000, TODAY);
  assert.equal(store.state.goals[0].saved, 2000);
});

test('orçamentos indicam folga, atenção e estouro', () => {
  const { store } = newStore();
  const market = category(store, 'Mercado');
  const fun = category(store, 'Lazer');
  const health = category(store, 'Saúde');
  store.setBudget(market.id, 10000);
  store.setBudget(fun.id, 10000);
  store.setBudget(health.id, 10000);
  expense(store, { amount: 12000, categoryId: market.id });
  expense(store, { amount: 9000, categoryId: fun.id });
  expense(store, { amount: 1000, categoryId: health.id });

  const result = q.budgets(store.state, '2026-11');
  assert.deepEqual(result.map((b) => b.level), ['over', 'near', 'ok']);
  assert.equal(result[0].remaining, -2000);
});

test('busca ignora acentos e maiúsculas', () => {
  const { store } = newStore();
  expense(store, { desc: 'Açougue do João' });
  expense(store, { desc: 'Padaria' });
  const found = q.filterTransactions(store.state, { q: 'acougue joao' }, TODAY);
  assert.equal(found.length, 1);
  assert.equal(found[0].desc, 'Açougue do João');
});

test('filtro de atrasados não inclui o que vence hoje', () => {
  const { store } = newStore();
  expense(store, { desc: 'Vence hoje', paid: false, date: TODAY });
  expense(store, { desc: 'Atrasada', paid: false, date: '2026-11-01' });
  const found = q.filterTransactions(store.state, { status: 'overdue' }, TODAY);
  assert.deepEqual(found.map((t) => t.desc), ['Atrasada']);
});

test('sugestão de categoria usa o histórico da mesma descrição', () => {
  const { store } = newStore();
  const fun = category(store, 'Lazer').id;
  expense(store, { desc: 'Cinema', categoryId: fun });
  assert.equal(q.suggestCategory(store.state, 'cinema', 'expense'), fun);
  assert.equal(q.suggestCategory(store.state, 'desconhecido', 'expense'), null);
});

test('CSV exportado protege contra fórmulas e usa vírgula decimal', () => {
  const { store } = newStore();
  expense(store, { desc: '=HYPERLINK("x")', amount: 123456 });
  const csv = q.toCsv(store.state, store.state.transactions);
  assert.ok(csv.startsWith('﻿'));
  assert.ok(csv.includes(`"'=HYPERLINK(""x"")"`));
  assert.ok(csv.includes('-1234,56'));
});

test('CSV de extrato: lê datas brasileiras, sinal, aspas e relata os erros', () => {
  const text = [
    'Data;Histórico;Valor',
    '05/11/2026;"Mercado; centro";-120,50',
    '2026-11-06;Salário;3.000,00',
    '31/02/2026;Data ruim;10,00',
    '07/11/2026;Valor ruim;abc',
  ].join('\n');
  const { rows, errors } = q.parseStatementCsv(text);
  assert.deepEqual(rows, [
    { date: '2026-11-05', desc: 'Mercado; centro', amount: 12050, type: 'expense' },
    { date: '2026-11-06', desc: 'Salário', amount: 300000, type: 'income' },
  ]);
  assert.equal(errors.length, 2);
  assert.match(errors[0], /Linha 4/);
});

test('CSV sem as colunas necessárias explica o problema', () => {
  const { rows, errors } = q.parseStatementCsv('a;b\n1;2');
  assert.equal(rows.length, 0);
  assert.match(errors[0], /colunas/);
});

test('dados de exemplo são válidos, coerentes e não têm saldo absurdo', () => {
  const state = demo.buildDemoState(TODAY);
  assert.deepEqual(storeLib.validateState(state), []);
  const summary = q.monthSummary(state, '2026-11');
  assert.ok(summary.income > 0);
  assert.ok(summary.toPay > 0, 'o mês atual precisa ter contas a pagar');
  assert.ok(q.totalBalance(state) > 0);
  assert.ok(state.transactions.every((t) => t.paid === t.date <= TODAY));
});

test('comparação com o período anterior só existe com dados de todo o período', () => {
  const { store } = newStore();
  expense(store, { amount: 1000, date: '2026-11-01' });
  expense(store, { amount: 500, date: '2026-08-01' });
  const months = dates.monthRange('2026-11', 3);
  assert.equal(q.categoryRanking(store.state, months)[0].previous, null);

  expense(store, { amount: 500, date: '2026-06-01' });
  assert.equal(q.categoryRanking(store.state, months)[0].previous, 1000);
});

test('série de saldo termina no saldo de hoje', () => {
  const state = demo.buildDemoState(TODAY);
  const series = q.balanceSeries(state, '2026-11', 6, TODAY);
  assert.equal(series.length, 6);
  assert.equal(series[5].balance, q.totalBalance(state, { upTo: TODAY }));
});
