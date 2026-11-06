/** Dados de exemplo, todos fictícios, gerados em volta da data de hoje. */
(function (root) {
  const FM = (root.FM = root.FM || {});
  const { dates, storeLib } = FM;
  const { uid } = storeLib;

  /** Sorteio com semente fixa: o exemplo sai igual toda vez. */
  function seeded(seed) {
    let a = seed;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function buildDemoState(today) {
    const random = seeded(42);
    const between = (min, max) => Math.round(min + random() * (max - min));
    const pick = (list) => list[Math.floor(random() * list.length)];

    const state = storeLib.emptyState();
    state.onboarded = true;
    state.demo = true;

    const main = { id: uid(), name: 'Conta do banco', type: 'corrente', initial: 180000 };
    const savings = { id: uid(), name: 'Reserva', type: 'poupanca', initial: 420000 };
    const cash = { id: uid(), name: 'Carteira', type: 'carteira', initial: 15000 };
    state.accounts = [main, savings, cash];

    const cat = Object.fromEntries(state.categories.map((c) => [c.name, c]));
    const budgets = { Moradia: 165000, Mercado: 80000, Transporte: 35000, Lazer: 40000, Assinaturas: 12000, Saúde: 25000 };
    for (const [name, value] of Object.entries(budgets)) cat[name].budget = value;

    const currentMonth = dates.monthOf(today);
    const add = (type, amount, date, desc, categoryName, extra = {}) => {
      state.transactions.push({
        id: uid(),
        type,
        amount,
        date,
        desc,
        accountId: main.id,
        categoryId: categoryName ? cat[categoryName].id : null,
        paid: date <= today,
        ...extra,
      });
    };

    const rules = [
      { desc: 'Salário', type: 'income', amount: 485000, day: 5, category: 'Salário' },
      { desc: 'Aluguel', type: 'expense', amount: 125000, day: 10, category: 'Moradia' },
      { desc: 'Conta de luz', type: 'expense', amount: 13800, day: 15, category: 'Moradia' },
      { desc: 'Internet', type: 'expense', amount: 9990, day: 12, category: 'Moradia' },
      { desc: 'Streaming de filmes', type: 'expense', amount: 3990, day: 8, category: 'Assinaturas' },
      { desc: 'Curso de inglês', type: 'expense', amount: 18900, day: 20, category: 'Educação' },
    ].map((rule) => ({
      id: uid(),
      type: rule.type,
      amount: rule.amount,
      desc: rule.desc,
      categoryId: cat[rule.category].id,
      accountId: main.id,
      day: rule.day,
      active: true,
      lastMonth: currentMonth,
      category: rule.category,
    }));

    const markets = ['Mercado do bairro', 'Supermercado', 'Feira', 'Padaria', 'Açougue'];
    const rides = ['Ônibus', 'Corrida de aplicativo', 'Combustível'];
    const fun = ['Cinema', 'Restaurante', 'Barzinho com amigos', 'Show', 'Lanche'];
    const health = ['Farmácia', 'Consulta', 'Academia'];

    for (const month of dates.monthRange(currentMonth, 9)) {
      for (const rule of rules) {
        const seasonal = rule.desc === 'Conta de luz' ? between(-2500, 3500) : 0;
        add(rule.type, rule.amount + seasonal, dates.dateIn(month, rule.day), rule.desc, rule.category, {
          recurringId: rule.id,
        });
      }
      const spread = (count, list, categoryName, min, max) => {
        for (let i = 0; i < count; i++) {
          add('expense', between(min, max), dates.dateIn(month, between(1, 28)), pick(list), categoryName);
        }
      };
      spread(between(4, 6), markets, 'Mercado', 3500, 24000);
      spread(between(3, 5), rides, 'Transporte', 900, 9000);
      spread(between(2, 4), fun, 'Lazer', 2500, 16000);
      spread(between(0, 2), health, 'Saúde', 2500, 15000);
      if (random() < 0.45) add('income', between(30000, 95000), dates.dateIn(month, between(10, 26)), 'Trabalho de fim de semana', 'Trabalhos extras');
      if (random() < 0.3) add('expense', between(4000, 22000), dates.dateIn(month, between(1, 28)), 'Presente', 'Outros gastos');
      add('transfer', 30000, dates.dateIn(month, 6), 'Reserva do mês', null, { toAccountId: savings.id });
    }

    const group = uid();
    const start = dates.dateIn(dates.addMonths(currentMonth, -3), 18);
    for (let i = 0; i < 10; i++) {
      add('expense', 24990, dates.addMonthsToDate(start, i), 'Notebook novo', 'Educação', {
        installment: { group, n: i + 1, total: 10 },
      });
    }

    state.recurring = rules.map(({ category, ...rule }) => rule);
    state.goals = [
      {
        id: uid(),
        name: 'Reserva de emergência',
        target: 1800000,
        saved: 680000,
        deadline: dates.addMonths(currentMonth, 14),
        history: [{ date: today, amount: 680000 }],
      },
      {
        id: uid(),
        name: 'Viagem de fim de ano',
        target: 450000,
        saved: 310000,
        deadline: dates.addMonths(currentMonth, 6),
        history: [{ date: today, amount: 310000 }],
      },
    ];
    return state;
  }

  FM.demo = { buildDemoState };
})(globalThis);
