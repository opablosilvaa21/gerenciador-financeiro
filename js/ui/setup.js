/**
 * "Montar meu mês em 1 minuto": a primeira abertura guiada. Cinco perguntas, todas opcionais, e o app já sai
 * com saldo, salário e aluguel como contas fixas e limites de mercado e lazer. Tudo pode ser mudado depois.
 */
(function (root) {
  const FM = (root.FM = root.FM || {});
  const { el, field, openDialog } = FM.dom;
  const { money, dates } = FM;

  function moneyInput(placeholder = '0,00') {
    return el('input', { class: 'input input-money', type: 'text', inputMode: 'decimal', placeholder });
  }

  function dayInput() {
    return el('input', { class: 'input input-short', type: 'number', min: 1, max: 31, inputMode: 'numeric', placeholder: 'Dia' });
  }

  /** Lê um valor opcional: vazio vira 0; inválido mostra o erro e devolve null. */
  function optionalCents(input, box) {
    const text = input.value.trim();
    if (!text) {
      box.setError(null);
      return 0;
    }
    const parsed = money.parse(text);
    if (parsed.error || parsed.cents < 0) {
      box.setError(parsed.error || 'O valor não pode ser negativo.');
      return null;
    }
    box.setError(null);
    return parsed.cents;
  }

  function optionalDay(input, box, required) {
    if (!required) return 1;
    const day = Number(input.value);
    if (!Number.isInteger(day) || day < 1 || day > 31) {
      box.setError('Em que dia? De 1 a 31.');
      return null;
    }
    return day;
  }

  function open(ctx) {
    const { store } = ctx;
    const balance = moneyInput();
    const salary = moneyInput();
    const salaryDay = dayInput();
    const rent = moneyInput();
    const rentDay = dayInput();
    const food = moneyInput('Sem limite');
    const fun = moneyInput('Sem limite');

    const balanceField = field('Quanto você tem na conta hoje?', balance, { class: 'field-money' });
    const salaryField = field('Quanto você recebe por mês?', salary, { class: 'field-money', hint: 'Salário ou o que costuma entrar. Vira uma conta fixa de receita.' });
    const salaryDayField = field('Em que dia cai?', salaryDay);
    const rentField = field('Quanto paga de aluguel ou moradia?', rent, { class: 'field-money', hint: 'Vira uma conta fixa: todo mês aparece em "A pagar".' });
    const rentDayField = field('Em que dia vence?', rentDay);
    const foodField = field('Quanto quer gastar com mercado por mês?', food, { class: 'field-money' });
    const funField = field('E com lazer?', fun, { class: 'field-money', hint: 'Esses dois viram orçamentos: o app avisa quando chegar perto do limite.' });

    let handle = null;
    const submit = () => {
      const values = {
        balance: optionalCents(balance, balanceField),
        salary: optionalCents(salary, salaryField),
        rent: optionalCents(rent, rentField),
        food: optionalCents(food, foodField),
        fun: optionalCents(fun, funField),
      };
      if (Object.values(values).some((v) => v === null)) return;
      const payDay = optionalDay(salaryDay, salaryDayField, values.salary > 0);
      const dueDay = optionalDay(rentDay, rentDayField, values.rent > 0);
      if (payDay === null || dueDay === null) return;
      handle.close();
      build(store, { ...values, payDay, dueDay });
      // Sem "Desfazer": ele só desfaria o último passo, não a montagem inteira.
      FM.dom.toast('Seu mês está montado. Dá para ajustar tudo em Contas fixas e Orçamentos.');
    };

    handle = openDialog({
      title: 'Montar meu mês',
      description: 'Responda o que quiser: tudo é opcional e pode ser mudado depois.',
      wide: true,
      body: el('form', { class: 'form setup-form', id: 'form-montar-mes', noValidate: true, onsubmit: (event) => { event.preventDefault(); submit(); } },
        balanceField,
        el('div', { class: 'form-row' }, salaryField, salaryDayField),
        el('div', { class: 'form-row' }, rentField, rentDayField),
        el('div', { class: 'form-row' }, foodField, funField)),
      footer: [
        el('button', { class: 'button push-left', type: 'button', onclick: () => { handle.close(); store.finishOnboarding(0); } }, 'Pular'),
        el('button', { class: 'button button-primary', type: 'submit', form: 'form-montar-mes' }, 'Montar meu mês'),
      ],
    });
  }

  /** Grava as respostas pelo store, como se a pessoa tivesse feito cada passo nas telas. */
  function build(store, { balance, salary, payDay, rent, dueDay, food, fun }) {
    store.finishOnboarding(balance);
    const { state } = store;
    const account = state.accounts[0].id;
    const byName = (name, kind) => state.categories.find((c) => c.kind === kind && c.name === name) || state.categories.find((c) => c.kind === kind);
    // O lançamento deste mês já sai criado (como pendente), igual a uma conta fixa nova.
    const lastMonth = dates.addMonths(dates.monthOf(store.today()), -1);
    if (salary > 0) {
      store.saveRecurring(null, { type: 'income', desc: 'Salário', amount: salary, day: payDay, categoryId: byName('Salário', 'income').id, accountId: account, lastMonth });
    }
    if (rent > 0) {
      store.saveRecurring(null, { type: 'expense', desc: 'Aluguel', amount: rent, day: dueDay, categoryId: byName('Moradia', 'expense').id, accountId: account, lastMonth });
    }
    if (food > 0) store.setBudget(byName('Mercado', 'expense').id, food);
    if (fun > 0) store.setBudget(byName('Lazer', 'expense').id, fun);
  }

  FM.setup = { open, build };
})(globalThis);
