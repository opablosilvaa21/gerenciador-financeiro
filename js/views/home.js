/** Início: a cédula do mês, para onde foi o dinheiro e o que vem pela frente. */
(function (root) {
  const FM = (root.FM = root.FM || {});
  const { el } = FM.dom;
  const { money, dates, queries: q, charts, common } = FM;

  const { stat } = common;

  function stats(ctx, summary) {
    const { state } = ctx.store;
    const today = ctx.store.today();
    const allowance = q.perDayAllowance(state, ctx.month, today);
    const list = [
      stat('Saldo hoje', q.totalBalance(state), 'Em todas as carteiras'),
      stat('Entradas do mês', summary.income, summary.toReceive ? `${money.format(summary.toReceive)} a receber` : null),
      stat('Saídas do mês', summary.expense, summary.toPay ? `${money.format(summary.toPay)} a pagar` : null),
    ];
    if (allowance) {
      list.push(stat(
        'Dá para gastar por dia',
        allowance.perDay,
        allowance.left > 0
          ? `Nos próximos ${allowance.days} ${allowance.days === 1 ? 'dia' : 'dias'}, sem ficar no vermelho`
          : 'O mês já está sem folga',
      ));
    }
    return el('dl', { class: 'stats' }, list);
  }

  function ruleSection(ctx, summary) {
    const rule = charts.monthRule(summary, {
      onSelect: (categoryId) => ctx.go('lancamentos', { mes: ctx.month, categoria: categoryId }),
    });
    if (!rule) return null;
    return el(
      'section',
      { class: 'band card' },
      el(
        'div',
        { class: 'band-head' },
        el('h2', {}, 'Para onde foi o dinheiro'),
        el('p', { class: 'chart-sub' }, 'A faixa inteira é ', money.format(Math.max(summary.income, summary.expense)), '. Escolha uma parte para ver os lançamentos.'),
      ),
      rule,
    );
  }

  function pendingSection(ctx) {
    const { state } = ctx.store;
    const today = ctx.store.today();
    const isCurrent = dates.monthOf(today) === ctx.month;
    const list = q.pending(state, today, { limit: 6, month: isCurrent ? null : ctx.month });
    return el(
      'section',
      { class: 'column card' },
      el(
        'div',
        { class: 'column-head' },
        el('h2', {}, 'A pagar e a receber'),
        el('button', { class: 'link-button', type: 'button', onclick: () => ctx.go('lancamentos', { situacao: 'pending', mes: 'todos' }) }, 'Ver todos'),
      ),
      list.length
        ? el('ul', { class: 'tx-list' }, list.map((p) => common.txLine(ctx, p.tx)))
        : common.emptyState('Nada pendente', 'Lançamentos com data futura ou marcados como não pagos aparecem aqui.', null, 'check'),
    );
  }

  function budgetSection(ctx) {
    const list = q.budgets(ctx.store.state, ctx.month).slice(0, 4);
    return el(
      'section',
      { class: 'column card' },
      el(
        'div',
        { class: 'column-head' },
        el('h2', {}, 'Orçamentos mais apertados'),
        el('button', { class: 'link-button', type: 'button', onclick: () => ctx.go('orcamentos') }, list.length ? 'Ver todos' : 'Definir orçamentos'),
      ),
      list.length
        ? el(
            'ul',
            { class: 'budget-mini' },
            list.map((b) =>
              el(
                'li',
                {},
                el(
                  'div',
                  { class: 'budget-mini-line' },
                  el('span', {}, common.categoryDot(b.category), b.category.name),
                  el('span', { class: 'muted' }, `${money.format(b.used)} de ${money.format(b.category.budget)}`),
                ),
                common.meter(b.ratio, b.level, `${b.category.name}: ${common.LEVEL_TEXT[b.level]}`),
                b.level !== 'ok' && common.levelBadge(b.level),
              ),
            ),
          )
        : common.emptyState('Nenhum limite definido', 'Defina quanto quer gastar por categoria e acompanhe aqui.', null, 'pie'),
    );
  }

  function recentSection(ctx) {
    const { state } = ctx.store;
    const month = q.filterTransactions(state, { month: ctx.month }, ctx.store.today()).filter((t) => t.paid);
    const list = q.sortTransactions(state, month).slice(0, 6);
    if (!list.length) return null;
    return el(
      'section',
      { class: 'column card' },
      el(
        'div',
        { class: 'column-head' },
        el('h2', {}, 'Últimos lançamentos'),
        el('button', { class: 'link-button', type: 'button', onclick: () => ctx.go('lancamentos', { mes: ctx.month }) }, 'Ver todos'),
      ),
      el('ul', { class: 'tx-list' }, list.map((t) => common.txLine(ctx, t))),
    );
  }

  function insightsSection(ctx) {
    const list = q.insights(ctx.store.state, ctx.month, ctx.store.today());
    if (!list.length) return null;
    return el(
      'section',
      { class: 'column card' },
      el('div', { class: 'column-head' }, el('h2', {}, 'O que chama atenção')),
      el('ul', { class: 'insights' }, list.map((item) => el('li', { class: `insight insight-${item.tone}` }, item.text))),
    );
  }

  function home(ctx) {
    const { state } = ctx.store;
    const summary = q.monthSummary(state, ctx.month);
    const data = q.cashflow(state, dates.monthOf(ctx.store.today()), 12);
    const flow = charts.cashflowChart(data, { selected: ctx.month, onSelect: (month) => ctx.setMonth(month) });

    return el(
      'div',
      { class: 'view view-home' },
      common.pageHead(dates.monthLabel(ctx.month), { monthNav: common.monthNav(ctx), actions: common.newButton(ctx) }),
      el(
        'div',
        { class: 'hero' },
        FM.note.note(summary, { emphasizeEmpty: !summary.count }),
        stats(ctx, summary),
      ),
      !summary.count && common.emptyState(
        `Nenhum lançamento em ${dates.monthName(ctx.month)}`,
        'Registre o que entrou e o que saiu para ver quanto sobra.',
        common.newButton(ctx, {}, 'Registrar o primeiro'),
        'list',
      ),
      ruleSection(ctx, summary),
      el(
        'div',
        { class: 'columns' },
        pendingSection(ctx),
        budgetSection(ctx),
        recentSection(ctx),
        insightsSection(ctx),
      ),
      charts.frame({
        title: 'Entradas e saídas em 12 meses',
        description: 'Escolha um mês para abrir.',
        chart: flow.chart,
        legend: flow.legend,
        columns: flow.columns,
        rows: flow.rows,
      }),
    );
  }

  FM.views = FM.views || {};
  FM.views.home = home;
})(globalThis);
