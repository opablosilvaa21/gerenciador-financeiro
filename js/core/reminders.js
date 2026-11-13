/**
 * Lembretes: o que merece um aviso hoje. Contas que vencem hoje ou amanhã (ou atrasaram), faturas de cartão
 * perto do vencimento e orçamentos que passaram de 85% ou do limite no mês.
 * Função pura sobre o estado: quem mostra (na tela ou como notificação) é js/ui/reminders.js.
 *
 * Cada lembrete tem uma chave estável (key): o mesmo aviso não é repetido no mesmo dia.
 */
(function (root) {
  const FM = (root.FM = root.FM || {});
  const { dates, money, queries: q, cards } = FM;

  const when = (date, today) => {
    const diff = dates.diffDays(today, date);
    if (diff < 0) return diff === -1 ? 'venceu ontem' : `venceu em ${dates.dayLabel(date)}`;
    if (diff === 0) return 'vence hoje';
    if (diff === 1) return 'vence amanhã';
    return `vence em ${dates.dayLabel(date)}`;
  };

  /**
   * days: quantos dias à frente avisar (padrão: hoje e amanhã).
   * Devolve [{ key, kind, title, body, date, urgent, url }], o mais urgente primeiro.
   */
  function reminders(state, today, { days = 1 } = {}) {
    const limit = dates.addDays(today, days);
    const list = [];

    for (const tx of state.transactions) {
      if (tx.paid || tx.type !== 'expense' || tx.date > limit) continue;
      if (cards.isCard(q.accountOf(state, tx.accountId))) continue;
      // Atrasadas há mais de 7 dias já estão na tela de pendentes: não viram aviso todo dia.
      if (dates.diffDays(tx.date, today) > 7) continue;
      list.push({
        key: `conta:${tx.id}:${tx.date}`,
        kind: 'bill',
        title: `${q.titleOf(state, tx)} ${when(tx.date, today)}`,
        body: `${money.format(tx.amount)} a pagar.`,
        date: tx.date,
        urgent: tx.date <= today,
        url: '#/inicio',
      });
    }

    for (const b of cards.allBillsToPay(state, today)) {
      if (b.due > limit || b.status === 'open') continue;
      list.push({
        key: `fatura:${b.card.id}:${b.dueMonth}`,
        kind: 'card',
        title: `Fatura ${b.card.name} ${when(b.due, today)}`,
        body: `${money.format(b.remaining)} a pagar.`,
        date: b.due,
        urgent: b.due <= today,
        url: '#/carteiras',
      });
    }

    const month = dates.monthOf(today);
    for (const status of q.budgets(state, month)) {
      if (status.level === 'ok') continue;
      const over = status.level === 'over';
      list.push({
        key: `orcamento:${status.category.id}:${month}:${status.level}`,
        kind: 'budget',
        title: over ? `Orçamento de ${status.category.name} estourou` : `Orçamento de ${status.category.name} quase no limite`,
        body: over
          ? `Gastou ${money.format(status.used)} de ${money.format(status.category.budget)} em ${dates.monthName(month)}.`
          : `Já usou ${Math.round(status.ratio * 100)}%: restam ${money.format(status.remaining)} este mês.`,
        date: today,
        urgent: over,
        url: '#/orcamentos',
      });
    }

    return list.sort((a, b) => Number(b.urgent) - Number(a.urgent) || a.date.localeCompare(b.date));
  }

  FM.reminders = { reminders };
})(globalThis);
