/** Fatura do cartão e lembretes: em qual fatura cai cada compra, quanto pagar e quando avisar. */
const test = require('node:test');
const assert = require('node:assert/strict');

require('../js/core/money.js');
require('../js/core/dates.js');
require('../js/core/store.js');
require('../js/core/queries.js');
require('../js/core/cards.js');
require('../js/core/reminders.js');

const { cards, storeLib, queries: q, reminders: r } = globalThis.FM;

function setup({ closingDay = 3, dueDay = 10, today = '2026-11-15' } = {}) {
  const memory = new Map();
  const storage = { getItem: (k) => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, v) };
  const store = storeLib.createStore({ storage, today: () => today });
  store.finishOnboarding(0);
  const created = store.saveAccount(null, { name: 'Nubank', type: 'cartao', initial: 0, closingDay, dueDay, limit: 500000 });
  const card = () => store.state.accounts.find((a) => a.id === created.id);
  const checking = store.state.accounts[0];
  const food = store.state.categories.find((c) => c.name === 'Mercado');
  const buy = (date, amount, extra = {}) => store.addTransaction({ type: 'expense', amount, date, desc: `Compra ${date}`, categoryId: food.id, accountId: created.id, paid: true, ...extra });
  return { store, card, checking, food, buy };
}

test('fecha dia 3 e vence dia 10: a compra até o dia 3 entra na fatura deste mês, depois do dia 3 na do mês seguinte', () => {
  const { card } = setup();
  assert.equal(cards.billMonthOf(card(), '2026-11-03'), '2026-11');
  assert.equal(cards.billMonthOf(card(), '2026-11-04'), '2026-12');
  assert.equal(cards.billMonthOf(card(), '2026-10-25'), '2026-11');
  assert.equal(cards.closingDateOf(card(), '2026-12'), '2026-12-03');
  assert.equal(cards.dueDateOf(card(), '2026-12'), '2026-12-10');
});

test('fecha dia 28 e vence dia 5: a fatura de dezembro fecha em novembro', () => {
  const { card } = setup({ closingDay: 28, dueDay: 5 });
  assert.equal(cards.closingDateOf(card(), '2026-12'), '2026-11-28');
  assert.equal(cards.billMonthOf(card(), '2026-11-28'), '2026-12');
  assert.equal(cards.billMonthOf(card(), '2026-11-29'), '2027-01');
  // 31/12 é depois do fechamento de 28/12: cai na fatura que fecha em 28/01 e vence em fevereiro.
  assert.equal(cards.billMonthOf(card(), '2026-12-31'), '2027-02');
});

test('fechamento dia 31 vira o último dia de meses curtos', () => {
  const { card } = setup({ closingDay: 31, dueDay: 8 });
  assert.equal(cards.closingDateOf(card(), '2026-03'), '2026-02-28');
  assert.equal(cards.billMonthOf(card(), '2026-02-28'), '2026-03');
  assert.equal(cards.billMonthOf(card(), '2026-03-01'), '2026-04');
});

test('a fatura soma compras, desconta estorno e mostra o que falta pagar', () => {
  const { store, card, buy, checking } = setup();
  buy('2026-11-05', 10000);
  buy('2026-11-20', 25000);
  buy('2026-12-03', 5000);
  buy('2026-12-04', 99900); // já é da fatura de janeiro
  const refund = store.state.categories.find((c) => c.kind === 'income');
  store.addTransaction({ type: 'income', amount: 3000, date: '2026-11-21', desc: 'Estorno', categoryId: refund.id, accountId: card().id, paid: true });
  const dec = cards.bill(store.state, card(), '2026-12', '2026-11-15');
  assert.equal(dec.items.length, 4);
  assert.equal(dec.total, 10000 + 25000 + 5000 - 3000);
  assert.equal(dec.status, 'open');

  store.addTransaction({ type: 'transfer', amount: 20000, date: '2026-12-08', desc: 'Fatura', accountId: checking.id, toAccountId: card().id, paid: true, billMonth: '2026-12' });
  const partial = cards.bill(store.state, card(), '2026-12', '2026-12-08');
  assert.equal(partial.paid, 20000);
  assert.equal(partial.remaining, 17000);
  assert.equal(partial.status, 'closed');
  assert.equal(cards.bill(store.state, card(), '2026-12', '2026-12-11').status, 'overdue');

  store.addTransaction({ type: 'transfer', amount: 17000, date: '2026-12-10', desc: 'Fatura', accountId: checking.id, toAccountId: card().id, paid: true, billMonth: '2026-12' });
  assert.equal(cards.bill(store.state, card(), '2026-12', '2026-12-11').status, 'paid');
});

test('pagar a fatura não conta como despesa de novo no mês', () => {
  const { store, card, buy, checking } = setup();
  buy('2026-11-05', 10000);
  const before = q.monthSummary(store.state, '2026-12');
  store.addTransaction({ type: 'transfer', amount: 10000, date: '2026-12-10', desc: 'Fatura', accountId: checking.id, toAccountId: card().id, paid: true, billMonth: '2026-12' });
  const after = q.monthSummary(store.state, '2026-12');
  assert.equal(after.expense, before.expense);
  assert.equal(q.monthSummary(store.state, '2026-11').expense, 10000, 'a compra conta no mês em que foi feita');
  assert.equal(q.accountBalance(store.state, card().id), 0, 'fatura paga zera o cartão');
  assert.equal(q.accountBalance(store.state, checking.id), -10000);
});

test('compra parcelada no cartão cai uma parcela em cada fatura', () => {
  const { store, card, buy } = setup();
  buy('2026-11-05', 30000, { repeat: { mode: 'installments', count: 3 } });
  // A primeira parcela é do dia 5/11 e vence na fatura de dezembro; as outras, em janeiro e fevereiro.
  for (const month of ['2026-12', '2027-01', '2027-02']) {
    assert.equal(cards.bill(store.state, card(), month, '2026-11-15').total, 10000, month);
  }
  assert.equal(store.state.transactions.filter((t) => t.installment).every((t) => t.paid), false, 'parcelas futuras ficam pendentes como antes');
});

test('faturas a pagar e limite usado', () => {
  const { store, card, buy } = setup({ today: '2026-12-15' });
  buy('2026-11-01', 5000); // fatura de novembro, nunca paga
  buy('2026-11-20', 7000); // fatura de dezembro
  buy('2026-12-10', 1000); // fatura de janeiro, aberta
  const list = cards.billsToPay(store.state, card(), '2026-12-15');
  assert.deepEqual(list.map((b) => [b.dueMonth, b.status]), [['2026-11', 'overdue'], ['2026-12', 'overdue'], ['2027-01', 'open']]);
  assert.equal(cards.limitUsed(store.state, card()), 13000);
});

test('pagamento de fatura guarda o mês e perde a marca se virar outro tipo', () => {
  const { store, card, checking } = setup();
  const [tx] = store.addTransaction({ type: 'transfer', amount: 100, date: '2026-11-15', accountId: checking.id, toAccountId: card().id, paid: true, billMonth: '2026-12' });
  assert.equal(store.state.transactions.find((t) => t.id === tx.id).billMonth, '2026-12');
  store.updateTransaction(tx.id, { type: 'expense', categoryId: store.state.categories[0].id });
  assert.equal('billMonth' in store.state.transactions.find((t) => t.id === tx.id), false);
});

test('lembretes: conta que vence hoje e amanhã, fatura perto do vencimento e orçamento apertado', () => {
  const { store, buy, checking, food } = setup({ today: '2026-12-09' });
  const home = store.state.categories.find((c) => c.name === 'Moradia');
  store.addTransaction({ type: 'expense', amount: 14787, date: '2026-12-09', desc: 'Conta de luz', categoryId: home.id, accountId: checking.id, paid: false });
  store.addTransaction({ type: 'expense', amount: 9990, date: '2026-12-10', desc: 'Internet', categoryId: home.id, accountId: checking.id, paid: false });
  store.addTransaction({ type: 'expense', amount: 5000, date: '2026-12-20', desc: 'Longe ainda', categoryId: home.id, accountId: checking.id, paid: false });
  buy('2026-11-20', 25000);
  store.setBudget(food.id, 30000);
  buy('2026-12-05', 27000);
  const list = r.reminders(store.state, '2026-12-09');
  const titles = list.map((x) => x.title);
  assert.ok(titles.includes('Conta de luz vence hoje'), titles.join(' | '));
  assert.ok(titles.includes('Internet vence amanhã'));
  assert.ok(titles.includes('Fatura Nubank vence amanhã'));
  assert.ok(titles.some((t) => t.startsWith('Orçamento de Mercado')));
  assert.ok(!titles.some((t) => t.startsWith('Longe ainda')));
  assert.equal(list[0].urgent, true, 'o mais urgente vem primeiro');
  assert.equal(new Set(list.map((x) => x.key)).size, list.length, 'chaves únicas');
});
