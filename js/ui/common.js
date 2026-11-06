/** Partes de tela usadas em mais de um lugar. */
(function (root) {
  const FM = (root.FM = root.FM || {});
  const { el, icon } = FM.dom;
  const { money, dates, queries: q } = FM;

  /** Cabeçalho de tela: título, seletor de mês opcional e ações. */
  function pageHead(title, { monthNav: nav = null, actions = null, intro = null } = {}) {
    return el(
      'header',
      { class: 'page-head' },
      el('div', { class: 'page-title' }, el('h1', { tabIndex: -1, id: 'page-title' }, title), nav),
      actions && el('div', { class: 'page-actions' }, actions),
      intro && el('p', { class: 'page-intro' }, intro),
    );
  }

  function monthNav(ctx) {
    const current = dates.monthOf(ctx.store.today());
    return el(
      'div',
      { class: 'month-nav', role: 'group', 'aria-label': 'Mudar de mês' },
      el('button', { class: 'icon-button', type: 'button', 'aria-label': 'Mês anterior', dataset: { fk: 'mes-anterior' }, onclick: () => ctx.setMonth(dates.addMonths(ctx.month, -1)) }, icon('left')),
      el('button', { class: 'icon-button', type: 'button', 'aria-label': 'Próximo mês', dataset: { fk: 'mes-seguinte' }, onclick: () => ctx.setMonth(dates.addMonths(ctx.month, 1)) }, icon('right')),
      ctx.month !== current && el('button', { class: 'link-button', type: 'button', onclick: () => ctx.setMonth(current) }, 'Voltar para hoje'),
    );
  }

  function newButton(ctx, preset = {}, label = 'Novo lançamento') {
    return el(
      'button',
      {
        class: 'button button-primary',
        type: 'button',
        dataset: { fk: 'novo-lancamento' },
        onclick: () => FM.txForm.open(ctx, { preset: { date: defaultDate(ctx), ...preset } }),
      },
      icon('plus'),
      label,
    );
  }

  /** Em outro mês, o formulário já abre com uma data desse mês. */
  function defaultDate(ctx) {
    const today = ctx.store.today();
    return dates.monthOf(today) === ctx.month ? today : dates.dateIn(ctx.month, 1);
  }

  /** Valor com sinal: + para receita, − para despesa. Não depende de cor. */
  function amountText(tx) {
    if (tx.type === 'income') return `+${money.format(tx.amount)}`;
    if (tx.type === 'expense') return `−${money.format(tx.amount)}`;
    return money.format(tx.amount);
  }

  /** Situação de um lançamento em ícone e palavra. */
  function statusBadge(tx, today) {
    if (tx.type === 'transfer') return null;
    if (tx.paid) return null;
    if (tx.date < today) return el('span', { class: 'badge badge-critical' }, icon('alert', 14), 'Atrasada');
    return el('span', { class: 'badge badge-pending' }, icon('clock', 14), tx.type === 'income' ? 'A receber' : 'A pagar');
  }

  function categoryDot(category) {
    if (!category) return null;
    if (category.slot == null) return el('i', { class: 'dot dot-neutral' });
    return el('i', { class: 'dot', style: { background: FM.charts.seriesColor(category.slot) } });
  }

  /** Segunda linha do lançamento: categoria e carteira. */
  function subtitle(state, tx) {
    if (tx.type === 'transfer') {
      return `${q.accountOf(state, tx.accountId)?.name ?? ''} para ${q.accountOf(state, tx.toAccountId)?.name ?? ''}`;
    }
    return `${q.categoryOf(state, tx.categoryId)?.name ?? 'Sem categoria'}, ${q.accountOf(state, tx.accountId)?.name ?? ''}`;
  }

  /** Marca como pago ou recebido, com desfazer. */
  function togglePaid(ctx, tx) {
    ctx.store.setPaid([tx.id], !tx.paid);
    ctx.notify(tx.paid ? 'Voltou a ficar pendente' : tx.type === 'income' ? 'Marcado como recebido' : 'Marcado como pago');
  }

  function paidButton(ctx, tx) {
    const verb = tx.type === 'income' ? 'recebido' : 'pago';
    const title = q.titleOf(ctx.store.state, tx);
    return el(
      'button',
      {
        class: `paid-toggle${tx.paid ? ' is-paid' : ''}`,
        type: 'button',
        role: 'switch',
        'aria-checked': String(tx.paid),
        'aria-label': `${title}: ${verb}`,
        title: tx.paid ? `Marcar como não ${verb}` : `Marcar como ${verb}`,
        dataset: { fk: `pago-${tx.id}` },
        onclick: () => togglePaid(ctx, tx),
      },
      icon('check', 14),
    );
  }

  /** Lançamento em uma linha compacta, para listas curtas. */
  function txLine(ctx, tx, { showDate = true } = {}) {
    const { state } = ctx.store;
    const today = ctx.store.today();
    const category = q.categoryOf(state, tx.categoryId);
    return el(
      'li',
      { class: 'tx-line' },
      tx.type === 'transfer' ? el('i', { class: 'tx-mark' }, icon('swap', 16)) : paidButton(ctx, tx),
      el(
        'button',
        { class: 'tx-line-main', type: 'button', dataset: { fk: `tx-${tx.id}` }, onclick: () => FM.txForm.open(ctx, { tx }) },
        el('span', { class: 'tx-title' }, q.titleOf(state, tx)),
        el(
          'span',
          { class: 'tx-sub' },
          categoryDot(category),
          showDate ? `${dates.relativeLabel(tx.date, today)}, ${category?.name ?? 'transferência'}` : subtitle(state, tx),
        ),
      ),
      statusBadge(tx, today),
      el('span', { class: `tx-amount tx-${tx.type}` }, amountText(tx)),
    );
  }

  function emptyState(title, text, action = null) {
    return el('div', { class: 'empty' }, el('p', { class: 'empty-title' }, title), text && el('p', {}, text), action);
  }

  /** Lê um campo de dinheiro e mostra o erro nele. Devolve os centavos ou null. */
  function readMoney(input, box, { allowZero = false, required = true } = {}) {
    if (!required && !input.value.trim()) {
      box.setError(null);
      return 0;
    }
    const parsed = money.parse(input.value);
    if (parsed.error) {
      box.setError(parsed.error);
      input.focus();
      return null;
    }
    if (parsed.cents < 0 || (!allowZero && parsed.cents === 0)) {
      box.setError(allowZero ? 'O valor não pode ser negativo.' : 'O valor precisa ser maior que zero.');
      input.focus();
      return null;
    }
    box.setError(null);
    return parsed.cents;
  }

  /** Medidor de consumo com rótulo em palavras e ícone. level: ok, near ou over. */
  function meter(ratio, level, label) {
    return el(
      'div',
      {
        class: `meter meter-${level}`,
        role: 'meter',
        'aria-valuemin': 0,
        'aria-valuemax': 100,
        'aria-valuenow': Math.min(Math.round(ratio * 100), 100),
        'aria-label': label,
      },
      el('span', { class: 'meter-fill', style: { width: `${Math.min(ratio * 100, 100)}%` } }),
    );
  }

  const LEVEL_TEXT = { ok: 'Dentro do limite', near: 'Perto do limite', over: 'Passou do limite' };

  function levelBadge(level) {
    const iconName = { ok: 'check', near: 'clock', over: 'alert' }[level];
    const tone = { ok: 'good', near: 'warning', over: 'critical' }[level];
    return el('span', { class: `badge badge-${tone}` }, icon(iconName, 14), LEVEL_TEXT[level]);
  }

  FM.common = {
    pageHead,
    monthNav,
    newButton,
    defaultDate,
    amountText,
    statusBadge,
    categoryDot,
    subtitle,
    togglePaid,
    paidButton,
    txLine,
    emptyState,
    readMoney,
    meter,
    levelBadge,
    LEVEL_TEXT,
  };
})(globalThis);
