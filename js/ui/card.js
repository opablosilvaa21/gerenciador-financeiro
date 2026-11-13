/** Telas do cartão de crédito: resumo da fatura, a fatura aberta em detalhe e o pagamento. */
(function (root) {
  const FM = (root.FM = root.FM || {});
  const { el, icon, field, openDialog } = FM.dom;
  const { money, dates, queries: q, cards } = FM;

  const STATUS = {
    open: ['Aberta', 'pending'],
    closed: ['Fechada', 'warning'],
    overdue: ['Atrasada', 'critical'],
    paid: ['Paga', 'good'],
    empty: ['Sem compras', 'pending'],
  };

  const billName = (b) => `Fatura de ${dates.monthName(b.dueMonth)}`;

  function statusBadge(b) {
    const [label, tone] = STATUS[b.status];
    return el('span', { class: `badge badge-${tone}` }, label);
  }

  /** Qual fatura mostrar em destaque: a mais antiga com algo a pagar; se não houver, a aberta. */
  function featuredBill(state, card, today) {
    return cards.billsToPay(state, card, today)[0] || cards.openBill(state, card, today);
  }

  /** Resumo que aparece na linha do cartão, em Carteiras. */
  function summary(ctx, card) {
    const { state } = ctx.store;
    const today = ctx.store.today();
    const b = featuredBill(state, card, today);
    const used = cards.limitUsed(state, card);
    return el(
      'div',
      { class: 'card-bill' },
      el('div', { class: 'card-bill-line' },
        el('span', {}, billName(b), ' ', statusBadge(b)),
        el('strong', { class: 'tx-amount' }, money.format(b.remaining || b.total))),
      el('p', { class: 'tx-sub' }, `Fecha ${dates.dayLabel(b.closing)}, vence ${dates.dayLabel(b.due)}`),
      card.limit > 0 && FM.common.meter(Math.min(used / card.limit, 1), used > card.limit ? 'over' : used / card.limit >= 0.85 ? 'near' : 'ok', `Limite usado: ${Math.round((used / card.limit) * 100)}%`),
      card.limit > 0 && el('p', { class: 'tx-sub' }, `Limite disponível: ${money.format(Math.max(card.limit - used, 0))} de ${money.format(card.limit)}`),
      el('div', { class: 'action-list' },
        el('button', { class: 'button button-small', type: 'button', dataset: { fk: `fatura-${card.id}` }, onclick: () => openBill(ctx, card, b.dueMonth) }, 'Ver fatura'),
        b.remaining > 0 && b.status !== 'open' && el('button', { class: 'button button-small button-primary', type: 'button', onclick: () => openPay(ctx, card, b.dueMonth) }, 'Pagar fatura')),
    );
  }

  /** A fatura em detalhe, com setas para as faturas vizinhas. */
  function openBill(ctx, card, dueMonth) {
    const { state } = ctx.store;
    const today = ctx.store.today();
    const b = cards.bill(state, card, dueMonth, today);
    let handle = null;
    const go = (delta) => {
      handle.close();
      openBill(ctx, card, dates.addMonths(dueMonth, delta));
    };
    const body = el(
      'div',
      { class: 'form' },
      el('div', { class: 'card-bill-nav' },
        el('button', { class: 'icon-button', type: 'button', 'aria-label': 'Fatura anterior', onclick: () => go(-1) }, icon('left')),
        el('div', {},
          el('strong', { class: 'card-bill-total' }, money.format(b.total)),
          el('p', { class: 'tx-sub' }, statusBadge(b), ` Fecha ${dates.dayLabel(b.closing)}, vence ${dates.dayLabel(b.due)}`),
          b.paid > 0 && el('p', { class: 'tx-sub' }, `Pago: ${money.format(b.paid)}. Falta: ${money.format(b.remaining)}.`)),
        el('button', { class: 'icon-button', type: 'button', 'aria-label': 'Próxima fatura', onclick: () => go(1) }, icon('right'))),
      b.items.length
        ? el('ul', { class: 'tx-list' }, b.items.map((tx) => el('li', { class: 'tx-line' },
          el('div', { class: 'tx-line-main' },
            el('span', { class: 'tx-title' }, q.titleOf(state, tx)),
            el('span', { class: 'tx-sub' }, `${dates.dayLabel(tx.date)}, ${q.categoryOf(state, tx.categoryId)?.name ?? ''}`)),
          el('span', { class: `tx-amount tx-${tx.type}` }, FM.common.amountText(tx)))))
        : el('p', { class: 'muted' }, 'Nenhuma compra nesta fatura.'),
    );
    handle = openDialog({
      title: `${card.name}: ${billName(b).toLowerCase()}`,
      body,
      footer: b.remaining > 0 && el('button', { class: 'button button-primary', type: 'button', onclick: () => { handle.close(); openPay(ctx, card, dueMonth); } }, `Pagar ${money.format(b.remaining)}`),
    });
  }

  /** Pagar a fatura: uma transferência de outra carteira para o cartão. */
  function openPay(ctx, card, dueMonth) {
    const { store } = ctx;
    const { state } = store;
    const today = store.today();
    const b = cards.bill(state, card, dueMonth, today);
    const from = state.accounts.filter((a) => a.id !== card.id && a.type !== 'cartao');
    if (!from.length) {
      FM.dom.toast('Crie uma carteira (conta corrente, por exemplo) para pagar a fatura.');
      return;
    }
    const amountInput = el('input', { class: 'input input-money', type: 'text', inputMode: 'decimal', value: money.formatPlain(b.remaining), 'data-autofocus': true });
    const fromSelect = el('select', { class: 'input' }, from.map((a) => el('option', { value: a.id }, a.name)));
    const dateInput = el('input', { class: 'input', type: 'date', value: today });
    const amountField = field('Valor pago', amountInput, { class: 'field-money', hint: `Total da fatura: ${money.format(b.total)}. Dá para pagar só uma parte.` });
    let handle = null;
    const submit = () => {
      const cents = FM.common.readMoney(amountInput, amountField);
      if (cents == null) return;
      handle.close();
      store.addTransaction({
        type: 'transfer',
        amount: cents,
        date: dateInput.value || today,
        desc: `Fatura ${card.name} (${dates.monthShort(dueMonth)})`,
        accountId: fromSelect.value,
        toAccountId: card.id,
        paid: true,
        billMonth: dueMonth,
      });
      FM.motion?.haptic();
      ctx.notify(cents >= b.remaining ? 'Fatura paga' : `${money.format(cents)} pagos da fatura`);
    };
    handle = openDialog({
      title: `Pagar ${billName(b).toLowerCase()}`,
      description: card.name,
      body: el('form', { class: 'form', id: 'form-pagar-fatura', noValidate: true, onsubmit: (event) => { event.preventDefault(); submit(); } },
        amountField, field('Pagar com', fromSelect), field('Data', dateInput)),
      footer: el('button', { class: 'button button-primary', type: 'submit', form: 'form-pagar-fatura' }, 'Confirmar pagamento'),
    });
  }

  /** Linha de fatura na lista "A pagar e a receber" do Início. */
  function pendingLine(ctx, b) {
    const today = ctx.store.today();
    return el(
      'li',
      { class: 'tx-line' },
      el('i', { class: 'tx-mark' }, icon('wallet', 16)),
      el('button', { class: 'tx-line-main', type: 'button', onclick: () => openBill(ctx, b.card, b.dueMonth) },
        el('span', { class: 'tx-title' }, `Fatura ${b.card.name}`),
        el('span', { class: 'tx-sub' }, `${b.due < today ? 'venceu' : 'vence'} ${dates.relativeLabel(b.due, today)}`)),
      statusBadge(b),
      el('span', { class: 'tx-amount tx-expense' }, `−${money.format(b.remaining)}`),
    );
  }

  /** Dica do formulário de lançamento: em qual fatura a compra cai. */
  function purchaseHint(card, date) {
    if (!cards.isCard(card) || !dates.isValidDate(date)) return '';
    const month = cards.billMonthOf(card, date);
    return `Entra na fatura de ${dates.monthName(month)}, que vence ${dates.dayLabel(cards.dueDateOf(card, month))}.`;
  }

  FM.cardUi = { summary, openBill, openPay, pendingLine, purchaseHint, featuredBill };
})(globalThis);
