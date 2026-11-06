/** Cálculos sobre os dados. Funções puras: recebem o estado e não alteram nada. */
(function (root) {
  const FM = (root.FM = root.FM || {});
  const { dates, money } = FM;

  const normalize = (text) =>
    String(text || '')
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .trim();

  const categoryOf = (state, id) => state.categories.find((c) => c.id === id) || null;
  const accountOf = (state, id) => state.accounts.find((a) => a.id === id) || null;

  /** Título do lançamento: descrição, ou o nome da categoria quando não há descrição. */
  function titleOf(state, tx) {
    const base = tx.desc || (tx.type === 'transfer' ? 'Transferência' : categoryOf(state, tx.categoryId)?.name || 'Sem nome');
    return tx.installment ? `${base} (${tx.installment.n}/${tx.installment.total})` : base;
  }

  /** Quanto o lançamento muda o saldo desta carteira. */
  function effectOn(tx, accountId) {
    if (tx.type === 'transfer') {
      if (tx.accountId === accountId) return -tx.amount;
      if (tx.toAccountId === accountId) return tx.amount;
      return 0;
    }
    if (tx.accountId !== accountId) return 0;
    return tx.type === 'income' ? tx.amount : -tx.amount;
  }

  /**
   * Saldo da carteira. Por padrão só conta o que já foi pago ou recebido.
   * upTo limita pela data; includePending soma também o que está previsto.
   */
  function accountBalance(state, accountId, { upTo = null, includePending = false } = {}) {
    const account = accountOf(state, accountId);
    if (!account) return 0;
    let total = account.initial;
    for (const tx of state.transactions) {
      if (!tx.paid && !includePending) continue;
      if (upTo && tx.date > upTo) continue;
      total += effectOn(tx, accountId);
    }
    return total;
  }

  const totalBalance = (state, options) =>
    state.accounts.reduce((sum, account) => sum + accountBalance(state, account.id, options), 0);

  const inMonth = (state, month) => state.transactions.filter((t) => dates.monthOf(t.date) === month);

  /**
   * Resumo do mês. "left" é a sobra prevista: tudo que entra menos tudo que sai, pago ou não.
   * byCategory vem em ordem fixa de categoria, para a cor de cada parte nunca mudar de vizinha.
   */
  function monthSummary(state, month) {
    const summary = {
      month,
      income: 0,
      expense: 0,
      incomeReceived: 0,
      expensePaid: 0,
      toPay: 0,
      toReceive: 0,
      left: 0,
      count: 0,
      byCategory: [],
    };
    const perCategory = new Map();
    for (const tx of inMonth(state, month)) {
      if (tx.type === 'transfer') continue;
      summary.count++;
      if (tx.type === 'income') {
        summary.income += tx.amount;
        if (tx.paid) summary.incomeReceived += tx.amount;
        else summary.toReceive += tx.amount;
      } else {
        summary.expense += tx.amount;
        if (tx.paid) summary.expensePaid += tx.amount;
        else summary.toPay += tx.amount;
        perCategory.set(tx.categoryId, (perCategory.get(tx.categoryId) || 0) + tx.amount);
      }
    }
    summary.left = summary.income - summary.expense;
    summary.byCategory = state.categories
      .filter((c) => perCategory.has(c.id))
      .sort((a, b) => (a.slot ?? 99) - (b.slot ?? 99))
      .map((category) => ({ category, amount: perCategory.get(category.id) }));
    return summary;
  }

  /** Quanto ainda dá para gastar por dia até o fim do mês. Só faz sentido para o mês atual. */
  function perDayAllowance(state, month, today) {
    if (dates.monthOf(today) !== month) return null;
    const left = monthSummary(state, month).left;
    const lastDay = dates.dateIn(month, 31);
    const days = dates.diffDays(today, lastDay) + 1;
    return { perDay: left > 0 ? Math.floor(left / days) : 0, days, left };
  }

  /** Pendentes em ordem de vencimento. Os atrasados vêm primeiro e trazem overdue: true. */
  function pending(state, today, { limit = null, month = null } = {}) {
    const list = state.transactions
      .filter((t) => !t.paid && t.type !== 'transfer' && (!month || dates.monthOf(t.date) === month))
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((tx) => ({ tx, overdue: tx.date < today, inDays: dates.diffDays(today, tx.date) }));
    return limit ? list.slice(0, limit) : list;
  }

  const budgetLevel = (ratio) => (ratio > 1 ? 'over' : ratio >= 0.85 ? 'near' : 'ok');

  /** Orçamentos do mês, do mais apertado para o mais folgado. */
  function budgets(state, month) {
    const spent = new Map();
    for (const tx of inMonth(state, month)) {
      if (tx.type === 'expense') spent.set(tx.categoryId, (spent.get(tx.categoryId) || 0) + tx.amount);
    }
    return state.categories
      .filter((c) => c.kind === 'expense' && c.budget > 0)
      .map((category) => {
        const used = spent.get(category.id) || 0;
        const ratio = used / category.budget;
        return { category, used, ratio, remaining: category.budget - used, level: budgetLevel(ratio) };
      })
      .sort((a, b) => b.ratio - a.ratio);
  }

  /** Média mensal de gasto da categoria nos meses anteriores a este. */
  function categoryAverage(state, categoryId, month, count = 3) {
    const months = dates.monthRange(dates.addMonths(month, -1), count);
    const first = state.transactions
      .filter((t) => t.categoryId === categoryId && t.type === 'expense')
      .reduce((min, t) => (min === null || t.date < min ? t.date : min), null);
    if (!first) return 0;
    const active = months.filter((m) => m >= dates.monthOf(first));
    if (!active.length) return 0;
    const total = state.transactions
      .filter((t) => t.categoryId === categoryId && t.type === 'expense' && active.includes(dates.monthOf(t.date)))
      .reduce((sum, t) => sum + t.amount, 0);
    return Math.round(total / active.length);
  }

  function cashflow(state, endMonth, count) {
    return dates.monthRange(endMonth, count).map((month) => {
      const summary = monthSummary(state, month);
      return { month, income: summary.income, expense: summary.expense, left: summary.left };
    });
  }

  /** Saldo no fim de cada mês; no mês atual, o saldo de hoje. Meses futuros incluem o previsto. */
  function balanceSeries(state, endMonth, count, today, accountId = null) {
    const currentMonth = dates.monthOf(today);
    return dates.monthRange(endMonth, count).map((month) => {
      const future = month > currentMonth;
      const options = {
        upTo: month === currentMonth ? today : dates.dateIn(month, 31),
        includePending: future,
      };
      const balance = accountId ? accountBalance(state, accountId, options) : totalBalance(state, options);
      return { month, balance };
    });
  }

  /**
   * Gasto por categoria num período, do maior para o menor.
   * previous só vem preenchido se há dados de todo o período anterior: comparar com meio período engana.
   */
  function categoryRanking(state, months) {
    const set = new Set(months);
    const previous = new Set(months.map((m) => dates.addMonths(m, -months.length)));
    const earliest = state.transactions.reduce((min, t) => (min === null || t.date < min ? t.date : min), null);
    const comparable = earliest !== null && dates.monthOf(earliest) <= dates.addMonths(months[0], -months.length);
    const now = new Map();
    const before = new Map();
    for (const tx of state.transactions) {
      if (tx.type !== 'expense') continue;
      const month = dates.monthOf(tx.date);
      if (set.has(month)) now.set(tx.categoryId, (now.get(tx.categoryId) || 0) + tx.amount);
      else if (previous.has(month)) before.set(tx.categoryId, (before.get(tx.categoryId) || 0) + tx.amount);
    }
    return state.categories
      .filter((c) => now.has(c.id))
      .map((category) => ({
        category,
        amount: now.get(category.id),
        previous: comparable ? before.get(category.id) || 0 : null,
      }))
      .sort((a, b) => b.amount - a.amount);
  }

  /** Frases curtas sobre o mês, da mais importante para a menos. */
  function insights(state, month, today) {
    const list = [];
    const summary = monthSummary(state, month);
    if (!summary.count) return list;

    const overdue = pending(state, today).filter((p) => p.overdue);
    if (overdue.length) {
      const total = overdue.reduce((sum, p) => sum + p.tx.amount, 0);
      list.push({
        tone: 'warn',
        text: `${overdue.length === 1 ? 'Há 1 lançamento atrasado' : `Há ${overdue.length} lançamentos atrasados`}, somando ${money.format(total)}.`,
      });
    }
    for (const budget of budgets(state, month)) {
      if (budget.level === 'over') {
        list.push({
          tone: 'warn',
          text: `${budget.category.name} passou ${money.format(-budget.remaining)} do orçamento.`,
        });
      }
    }
    if (summary.income > 0) {
      const rate = Math.round((summary.left / summary.income) * 100);
      if (rate >= 0) list.push({ tone: 'good', text: `Sobram ${rate}% do que entrou neste mês.` });
      else list.push({ tone: 'warn', text: `Os gastos passaram ${money.format(-summary.left)} do que entrou.` });
    }
    let largest = null;
    for (const item of summary.byCategory) {
      const average = categoryAverage(state, item.category.id, month);
      if (average > 0 && item.amount > average * 1.2 && item.amount - average >= 5000) {
        const rise = Math.round((item.amount / average - 1) * 100);
        if (!largest || rise > largest.rise) largest = { name: item.category.name, rise, average };
      }
    }
    if (largest) {
      list.push({
        tone: 'info',
        text: `${largest.name} está ${largest.rise}% acima da média dos últimos meses (${money.format(largest.average)}).`,
      });
    }
    return list;
  }

  /** Filtra os lançamentos. Campos vazios não filtram. */
  function filterTransactions(state, filters = {}, today = dates.today()) {
    const q = normalize(filters.q);
    return state.transactions.filter((tx) => {
      if (filters.month && dates.monthOf(tx.date) !== filters.month) return false;
      if (filters.type && tx.type !== filters.type) return false;
      if (filters.categoryId && tx.categoryId !== filters.categoryId) return false;
      if (filters.accountId && tx.accountId !== filters.accountId && tx.toAccountId !== filters.accountId) return false;
      if (filters.status === 'paid' && !tx.paid) return false;
      if (filters.status === 'pending' && tx.paid) return false;
      if (filters.status === 'overdue' && (tx.paid || tx.date >= today)) return false;
      if (q) {
        const haystack = normalize(
          `${titleOf(state, tx)} ${categoryOf(state, tx.categoryId)?.name || ''} ${accountOf(state, tx.accountId)?.name || ''}`,
        );
        if (!q.split(/\s+/).every((word) => haystack.includes(word))) return false;
      }
      return true;
    });
  }

  function sortTransactions(state, list, sort = { by: 'date', dir: 'desc' }) {
    const sign = sort.dir === 'asc' ? 1 : -1;
    const value = {
      date: (t) => t.date,
      amount: (t) => t.amount,
      title: (t) => normalize(titleOf(state, t)),
    }[sort.by];
    return [...list].sort((a, b) => {
      const [x, y] = [value(a), value(b)];
      const order = x < y ? -1 : x > y ? 1 : 0;
      return order * sign || b.id.localeCompare(a.id);
    });
  }

  /** Categoria mais usada para uma descrição parecida. Preenche o formulário sozinho. */
  function suggestCategory(state, desc, type) {
    const key = normalize(desc);
    if (key.length < 2) return null;
    const counts = new Map();
    for (const tx of state.transactions) {
      if (tx.type === type && normalize(tx.desc) === key) {
        counts.set(tx.categoryId, (counts.get(tx.categoryId) || 0) + 1);
      }
    }
    let best = null;
    for (const [id, count] of counts) if (!best || count > best.count) best = { id, count };
    return best ? best.id : null;
  }

  /** Descrições já usadas, das mais frequentes para as menos. */
  function knownDescriptions(state, limit = 50) {
    const counts = new Map();
    for (const tx of state.transactions) if (tx.desc) counts.set(tx.desc, (counts.get(tx.desc) || 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([desc]) => desc);
  }

  /* ---------- CSV ---------- */

  /** Texto que começa com = + - @ viraria fórmula no Excel. */
  const csvText = (text) => {
    const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
    return `"${safe.replace(/"/g, '""')}"`;
  };

  /** CSV no padrão do Excel brasileiro: ponto e vírgula, vírgula decimal e BOM para os acentos. */
  function toCsv(state, list) {
    const rows = [['Data', 'Tipo', 'Descrição', 'Categoria', 'Carteira', 'Destino', 'Valor', 'Situação'].join(';')];
    const typeName = { income: 'Receita', expense: 'Despesa', transfer: 'Transferência' };
    for (const tx of list) {
      const signed = tx.type === 'expense' ? -tx.amount : tx.amount;
      rows.push([
        tx.date,
        typeName[tx.type],
        csvText(titleOf(state, tx)),
        csvText(categoryOf(state, tx.categoryId)?.name || ''),
        csvText(accountOf(state, tx.accountId)?.name || ''),
        csvText(accountOf(state, tx.toAccountId)?.name || ''),
        (signed < 0 ? '-' : '') + money.formatPlain(Math.abs(signed)).replace(/\./g, ''),
        tx.paid ? 'Pago' : 'Pendente',
      ].join(';'));
    }
    return `﻿${rows.join('\r\n')}\r\n`;
  }

  function splitCsvLine(line, separator) {
    const cells = [];
    let cell = '';
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (quoted) {
        if (c === '"' && line[i + 1] === '"') {
          cell += '"';
          i++;
        } else if (c === '"') quoted = false;
        else cell += c;
      } else if (c === '"') quoted = true;
      else if (c === separator) {
        cells.push(cell.trim());
        cell = '';
      } else cell += c;
    }
    cells.push(cell.trim());
    return cells;
  }

  function parseCsvDate(text) {
    const value = text.trim();
    if (dates.isValidDate(value)) return value;
    const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!match) return null;
    const iso = `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
    return dates.isValidDate(iso) ? iso : null;
  }

  /**
   * Lê um extrato em CSV com colunas de data, descrição e valor (nessa ordem de nomes, em qualquer posição).
   * Valor negativo é despesa e positivo é receita. Devolve as linhas boas e os erros, com o número da linha.
   */
  function parseStatementCsv(text) {
    const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((line) => line.trim());
    if (lines.length < 2) return { rows: [], errors: ['O arquivo precisa de um cabeçalho e pelo menos uma linha.'] };

    const separator = [';', '\t', ','].sort((a, b) => lines[0].split(b).length - lines[0].split(a).length)[0];
    const header = splitCsvLine(lines[0], separator).map(normalize);
    const find = (...names) => header.findIndex((h) => names.some((n) => h.includes(n)));
    const dateCol = find('data', 'date');
    const descCol = find('descri', 'historico', 'memo', 'lancamento');
    const valueCol = find('valor', 'amount', 'quantia');
    if (dateCol < 0 || valueCol < 0) {
      return { rows: [], errors: ['Não achei as colunas de data e valor no cabeçalho do arquivo.'] };
    }

    const rows = [];
    const errors = [];
    lines.slice(1).forEach((line, index) => {
      const cells = splitCsvLine(line, separator);
      const date = parseCsvDate(cells[dateCol] || '');
      const parsed = money.parse(cells[valueCol] || '');
      if (!date) errors.push(`Linha ${index + 2}: data inválida.`);
      else if (parsed.error) errors.push(`Linha ${index + 2}: ${parsed.error}`);
      else if (parsed.cents === 0) errors.push(`Linha ${index + 2}: valor zerado.`);
      else {
        rows.push({
          date,
          desc: descCol >= 0 ? cells[descCol] || '' : '',
          amount: Math.abs(parsed.cents),
          type: parsed.cents < 0 ? 'expense' : 'income',
        });
      }
    });
    return { rows, errors };
  }

  FM.queries = {
    normalize,
    categoryOf,
    accountOf,
    titleOf,
    effectOn,
    accountBalance,
    totalBalance,
    monthSummary,
    perDayAllowance,
    pending,
    budgets,
    categoryAverage,
    cashflow,
    balanceSeries,
    categoryRanking,
    insights,
    filterTransactions,
    sortTransactions,
    suggestCategory,
    knownDescriptions,
    toCsv,
    parseStatementCsv,
  };
})(globalThis);
