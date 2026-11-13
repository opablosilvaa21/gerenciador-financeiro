/** A junção do backup na nuvem: nenhum lançamento pode sumir nem se repetir por causa de dois aparelhos. */
const test = require('node:test');
const assert = require('node:assert/strict');

require('../js/core/money.js');
require('../js/core/dates.js');
require('../js/core/store.js');
require('../js/core/sync.js');

const { merge, mergeWithoutBase, isBlank, same } = globalThis.FM.sync;
const { emptyState, validateState } = globalThis.FM.storeLib;

const clone = (v) => JSON.parse(JSON.stringify(v));

function baseState() {
  const s = emptyState();
  s.onboarded = true;
  const account = s.accounts[0].id;
  const food = s.categories.find((c) => c.name === 'Mercado').id;
  const salary = s.categories.find((c) => c.name === 'Salário').id;
  s.transactions = [
    { id: 't1', type: 'expense', amount: 1000, date: '2026-11-02', desc: 'Feira', categoryId: food, accountId: account, paid: true },
    { id: 't2', type: 'income', amount: 500000, date: '2026-11-05', desc: 'Salário', categoryId: salary, accountId: account, paid: true },
  ];
  return s;
}

const ids = (s) => s.transactions.map((t) => t.id).sort();
const tx = (s, id) => s.transactions.find((t) => t.id === id);

test('sem mudança na nuvem, vale o que mudou neste aparelho', () => {
  const base = baseState();
  const local = clone(base);
  local.transactions.push({ ...local.transactions[0], id: 't3', desc: 'Padaria' });
  local.transactions[0].amount = 1200;
  const result = merge(base, local, clone(base));
  assert.deepEqual(ids(result), ['t1', 't2', 't3']);
  assert.equal(tx(result, 't1').amount, 1200);
});

test('dois aparelhos lançando ao mesmo tempo: os dois lançamentos ficam', () => {
  const base = baseState();
  const phone = clone(base);
  const computer = clone(base);
  phone.transactions.push({ ...base.transactions[0], id: 'celular', desc: 'Uber' });
  computer.transactions.push({ ...base.transactions[0], id: 'computador', desc: 'Mercado do mês' });
  const result = merge(base, phone, computer);
  assert.deepEqual(ids(result), ['celular', 'computador', 't1', 't2']);
  assert.deepEqual(validateState(result), []);
});

test('editado em cada aparelho em registros diferentes: as duas edições ficam', () => {
  const base = baseState();
  const local = clone(base);
  const remote = clone(base);
  local.transactions[0].paid = false;
  remote.transactions[1].desc = 'Salário de novembro';
  const result = merge(base, local, remote);
  assert.equal(tx(result, 't1').paid, false);
  assert.equal(tx(result, 't2').desc, 'Salário de novembro');
});

test('o mesmo lançamento editado nos dois: vale o deste aparelho', () => {
  const base = baseState();
  const local = clone(base);
  const remote = clone(base);
  local.transactions[0].amount = 1111;
  remote.transactions[0].amount = 2222;
  assert.equal(tx(merge(base, local, remote), 't1').amount, 1111);
});

test('apagado no outro aparelho e intacto aqui: sai; apagado lá mas editado aqui: fica', () => {
  const base = baseState();
  const local = clone(base);
  const remote = clone(base);
  remote.transactions = [];
  local.transactions[1].desc = 'Editado aqui';
  const result = merge(base, local, remote);
  assert.deepEqual(ids(result), ['t2']);
});

test('apagado aqui sai, mesmo que a nuvem não saiba ainda', () => {
  const base = baseState();
  const local = clone(base);
  local.transactions = local.transactions.filter((t) => t.id !== 't1');
  assert.deepEqual(ids(merge(base, local, clone(base))), ['t2']);
});

test('a conta fixa criada nos dois aparelhos no mesmo mês vira um lançamento só, ficando o já pago', () => {
  const base = baseState();
  const rule = { id: 'aluguel', type: 'expense', desc: 'Aluguel', amount: 150000, day: 10, categoryId: base.categories[0].id, accountId: base.accounts[0].id, active: true, lastMonth: '2026-10' };
  base.recurring.push(rule);
  const local = clone(base);
  const remote = clone(base);
  const generated = (id, paid) => ({ id, type: 'expense', amount: 150000, date: '2026-11-10', desc: 'Aluguel', categoryId: rule.categoryId, accountId: rule.accountId, paid, recurringId: 'aluguel' });
  local.transactions.push(generated('aluguel-celular', false));
  local.recurring[0].lastMonth = '2026-11';
  remote.transactions.push(generated('aluguel-computador', true));
  remote.recurring[0].lastMonth = '2026-11';
  const result = merge(base, local, remote);
  const rent = result.transactions.filter((t) => t.recurringId === 'aluguel');
  assert.equal(rent.length, 1);
  assert.equal(rent[0].paid, true);
  assert.equal(result.recurring[0].lastMonth, '2026-11');
});

test('carteira apagada num aparelho: os lançamentos que apontavam para ela continuam válidos', () => {
  const base = baseState();
  base.accounts.push({ id: 'poupanca', name: 'Poupança', type: 'poupanca', initial: 0 });
  const local = clone(base);
  const remote = clone(base);
  remote.accounts = remote.accounts.filter((a) => a.id !== 'poupanca');
  local.transactions.push({ ...base.transactions[0], id: 't-poupanca', accountId: 'poupanca' });
  const result = merge(base, local, remote);
  assert.deepEqual(validateState(result), []);
});

test('primeira vez sem base: une os dois lados e não duplica categorias, carteiras nem lançamentos iguais', () => {
  const remote = baseState();
  const local = emptyState();
  local.onboarded = true;
  const localFood = local.categories.find((c) => c.name === 'Mercado');
  localFood.budget = 80000;
  local.transactions = [
    { id: 'novo', type: 'expense', amount: 3990, date: '2026-11-08', desc: 'Pizza', categoryId: localFood.id, accountId: local.accounts[0].id, paid: true },
    { ...remote.transactions[0], id: 'mesmo-de-outro-jeito', categoryId: localFood.id, accountId: local.accounts[0].id },
  ];
  const result = mergeWithoutBase(local, remote);
  assert.equal(result.categories.length, remote.categories.length, 'categorias com o mesmo nome viram uma só');
  assert.equal(result.accounts.length, 1, 'a "Conta principal" dos dois lados é a mesma');
  assert.deepEqual(ids(result), ['novo', 't1', 't2']);
  const remoteFood = remote.categories.find((c) => c.name === 'Mercado').id;
  assert.equal(tx(result, 'novo').categoryId, remoteFood);
  assert.equal(result.categories.find((c) => c.id === remoteFood).budget, 80000);
  assert.deepEqual(validateState(result), []);
});

test('aparelho em branco ou só com o exemplo não tem nada a guardar', () => {
  assert.equal(isBlank(emptyState()), true);
  assert.equal(isBlank({ ...baseState(), demo: true }), true);
  assert.equal(isBlank({ ...emptyState(), onboarded: true }), true);
  assert.equal(isBlank(baseState()), false);
});

test('a comparação ignora a ordem das chaves', () => {
  assert.equal(same({ a: 1, b: [1, { c: 2, d: 3 }] }, { b: [1, { d: 3, c: 2 }], a: 1 }), true);
  assert.equal(same({ a: 1 }, { a: 2 }), false);
});
