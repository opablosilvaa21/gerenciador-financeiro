/**
 * Cartão de crédito: em qual fatura cai cada compra, quanto é cada fatura, quanto já foi pago e quando vence.
 * Funções puras sobre o estado, testadas no Node.
 *
 * Regras:
 * - Um cartão é uma carteira do tipo "cartao", com dia de fechamento (closingDay) e de vencimento (dueDay).
 * - A fatura é identificada pelo mês em que vence. Ela junta as compras feitas depois do fechamento anterior
 *   até o fechamento dela (inclusive).
 * - Gasto no cartão conta no mês da compra, como qualquer despesa: o resumo do mês não muda.
 * - Pagar a fatura é uma transferência de outra carteira para o cartão, marcada com billMonth. Por ser
 *   transferência, não conta de novo como despesa.
 */
(function (root) {
  const FM = (root.FM = root.FM || {});
  const { dates } = FM;

  const isCard = (account) => Boolean(account && account.type === 'cartao' && account.closingDay && account.dueDay);

  /** Data de vencimento da fatura que vence no mês dueMonth. */
  const dueDateOf = (card, dueMonth) => dates.dateIn(dueMonth, card.dueDay);

  /**
   * Data de fechamento da fatura que vence em dueMonth. Se o vencimento vem depois do fechamento no mês,
   * fecha no mesmo mês; senão, fechou no mês anterior.
   */
  function closingDateOf(card, dueMonth) {
    const month = card.dueDay > card.closingDay ? dueMonth : dates.addMonths(dueMonth, -1);
    return dates.dateIn(month, card.closingDay);
  }

  /** Mês de vencimento da fatura em que cai uma compra feita nesta data. */
  function billMonthOf(card, date) {
    let month = dates.monthOf(date);
    // A fatura que vence neste mês pode já ter fechado no mês passado: anda até achar a que ainda aceita a data.
    for (let i = 0; i < 3 && date > closingDateOf(card, month); i++) month = dates.addMonths(month, 1);
    return month;
  }

  /** Uma fatura: compras, estornos, total, pago e situação. */
  function bill(state, card, dueMonth, today) {
    const closing = closingDateOf(card, dueMonth);
    const previousClosing = closingDateOf(card, dates.addMonths(dueMonth, -1));
    const due = dueDateOf(card, dueMonth);
    const items = state.transactions
      .filter((t) => t.type !== 'transfer' && t.accountId === card.id && t.date > previousClosing && t.date <= closing)
      .sort((a, b) => a.date.localeCompare(b.date));
    const total = items.reduce((sum, t) => sum + (t.type === 'expense' ? t.amount : -t.amount), 0);
    const paid = state.transactions
      .filter((t) => t.type === 'transfer' && t.toAccountId === card.id && t.billMonth === dueMonth)
      .reduce((sum, t) => sum + t.amount, 0);
    const remaining = Math.max(total - paid, 0);
    let status = 'open';
    if (total <= 0 && today > closing) status = 'empty';
    else if (remaining === 0 && total > 0) status = 'paid';
    else if (today > due) status = 'overdue';
    else if (today > closing) status = 'closed';
    return { card, dueMonth, closing, previousClosing, due, items, total, paid, remaining, status };
  }

  /** A fatura que está recebendo as compras de hoje. */
  const openBill = (state, card, today) => bill(state, card, billMonthOf(card, today), today);

  /**
   * Faturas com algo a pagar, da mais antiga para a mais nova: as atrasadas, a fechada e a aberta.
   * Olha até 12 meses para trás, para não esquecer uma fatura antiga sem pagamento.
   */
  function billsToPay(state, card, today) {
    const current = billMonthOf(card, today);
    const list = [];
    for (let i = -12; i <= 0; i++) {
      const b = bill(state, card, dates.addMonths(current, i), today);
      if (b.remaining > 0) list.push(b);
    }
    return list;
  }

  /** Todas as faturas a pagar de todos os cartões, pela data de vencimento. */
  function allBillsToPay(state, today) {
    return state.accounts
      .filter(isCard)
      .flatMap((card) => billsToPay(state, card, today))
      .sort((a, b) => a.due.localeCompare(b.due));
  }

  /** Quanto do limite já está usado: tudo o que foi comprado e ainda não foi pago. */
  function limitUsed(state, card) {
    let used = -(card.initial || 0);
    for (const t of state.transactions) {
      if (t.type === 'transfer') {
        if (t.toAccountId === card.id) used -= t.amount;
        if (t.accountId === card.id) used += t.amount;
      } else if (t.accountId === card.id) {
        used += t.type === 'expense' ? t.amount : -t.amount;
      }
    }
    return Math.max(used, 0);
  }

  FM.cards = { isCard, billMonthOf, closingDateOf, dueDateOf, bill, openBill, billsToPay, allBillsToPay, limitUsed };
})(globalThis);
