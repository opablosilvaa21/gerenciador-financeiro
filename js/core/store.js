/**
 * Guarda os dados e é o único lugar que os altera.
 * Toda alteração passa por commit(): grava no navegador, avisa a tela e permite desfazer.
 */
(function (root) {
  const FM = (root.FM = root.FM || {});
  const { dates, money } = FM;

  const KEY = 'sobra.dados.v1';
  const UNDO_LIMIT = 30;
  const SLOTS = 8;

  const ACCOUNT_TYPES = {
    corrente: 'Conta corrente',
    poupanca: 'Poupança',
    carteira: 'Dinheiro vivo',
    investimento: 'Investimento',
  };

  function uid() {
    if (root.crypto && root.crypto.randomUUID) {
      try {
        return root.crypto.randomUUID();
      } catch {
        /* Fora de contexto seguro: segue para o sorteio abaixo. */
      }
    }
    const bytes = new Uint8Array(16);
    root.crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }

  function defaultCategories() {
    const expense = ['Moradia', 'Mercado', 'Transporte', 'Lazer', 'Saúde', 'Educação', 'Assinaturas', 'Outros gastos'];
    const income = ['Salário', 'Trabalhos extras', 'Outras receitas'];
    return [
      ...expense.map((name, slot) => ({ id: uid(), name, kind: 'expense', slot, budget: 0 })),
      ...income.map((name) => ({ id: uid(), name, kind: 'income', slot: null, budget: 0 })),
    ];
  }

  function emptyState() {
    return {
      version: 1,
      onboarded: false,
      demo: false,
      theme: 'auto',
      accounts: [{ id: uid(), name: 'Conta principal', type: 'corrente', initial: 0 }],
      categories: defaultCategories(),
      transactions: [],
      recurring: [],
      goals: [],
    };
  }

  /** Confere um arquivo importado. Devolve a lista de problemas; vazia quer dizer que dá para usar. */
  function validateState(data) {
    const problems = [];
    if (!data || typeof data !== 'object' || Array.isArray(data)) return ['O arquivo não tem o formato do Sobra Finance.'];
    for (const key of ['accounts', 'categories', 'transactions', 'recurring', 'goals']) {
      if (!Array.isArray(data[key])) problems.push(`Falta a lista "${key}".`);
    }
    if (problems.length) return problems;
    if (!data.accounts.length) problems.push('O arquivo não tem nenhuma carteira.');

    const accounts = new Set(data.accounts.map((a) => a.id));
    const categories = new Set(data.categories.map((c) => c.id));
    data.transactions.forEach((t, i) => {
      const line = `Lançamento ${i + 1}`;
      if (!['income', 'expense', 'transfer'].includes(t.type)) problems.push(`${line}: tipo inválido.`);
      if (!Number.isSafeInteger(t.amount) || t.amount <= 0) problems.push(`${line}: valor inválido.`);
      if (!dates.isValidDate(t.date)) problems.push(`${line}: data inválida.`);
      if (!accounts.has(t.accountId)) problems.push(`${line}: carteira desconhecida.`);
      if (t.type === 'transfer' && !accounts.has(t.toAccountId)) problems.push(`${line}: carteira de destino desconhecida.`);
      if (t.type !== 'transfer' && !categories.has(t.categoryId)) problems.push(`${line}: categoria desconhecida.`);
    });
    return problems.slice(0, 5);
  }

  function createStore({ storage, today = () => dates.today() } = {}) {
    let state = emptyState();
    const listeners = new Set();
    const undoStack = [];
    let saveFailed = false;

    function save() {
      if (!storage) return;
      try {
        storage.setItem(KEY, JSON.stringify(state));
        saveFailed = false;
      } catch {
        saveFailed = true;
      }
    }

    const notify = () => listeners.forEach((fn) => fn(state));

    function commit(label, mutator) {
      const snapshot = JSON.stringify(state);
      const result = mutator(state);
      undoStack.push({ label, snapshot });
      if (undoStack.length > UNDO_LIMIT) undoStack.shift();
      save();
      notify();
      return result;
    }

    function byId(list, id) {
      const item = list.find((x) => x.id === id);
      if (!item) throw new Error(`Registro não encontrado: ${id}`);
      return item;
    }

    function buildTransaction(input) {
      if (!Number.isSafeInteger(input.amount) || input.amount <= 0) throw new Error('Valor inválido');
      if (!dates.isValidDate(input.date)) throw new Error('Data inválida');
      const base = {
        id: uid(),
        type: input.type,
        amount: input.amount,
        date: input.date,
        desc: (input.desc || '').trim(),
        accountId: input.accountId,
        paid: Boolean(input.paid),
      };
      if (input.type === 'transfer') {
        if (!input.toAccountId || input.toAccountId === input.accountId) throw new Error('Carteiras inválidas');
        return { ...base, toAccountId: input.toAccountId, categoryId: null };
      }
      return { ...base, categoryId: input.categoryId };
    }

    /** Cria os lançamentos das contas fixas que ainda não existem, até o mês atual. */
    function generateRecurringInto(s) {
      const currentMonth = dates.monthOf(today());
      let created = 0;
      for (const rule of s.recurring) {
        if (!rule.active) continue;
        let month = dates.addMonths(rule.lastMonth, 1);
        while (month <= currentMonth) {
          s.transactions.push({
            id: uid(),
            type: rule.type,
            amount: rule.amount,
            date: dates.dateIn(month, rule.day),
            desc: rule.desc,
            categoryId: rule.categoryId,
            accountId: rule.accountId,
            paid: false,
            recurringId: rule.id,
          });
          rule.lastMonth = month;
          month = dates.addMonths(month, 1);
          created++;
        }
      }
      return created;
    }

    const api = {
      get state() {
        return state;
      },
      get saveFailed() {
        return saveFailed;
      },
      get canUndo() {
        return undoStack.length > 0;
      },
      today,

      subscribe(fn) {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },

      /** Lê do navegador. Devolve false se não havia dados ou se estavam ilegíveis. */
      load() {
        if (!storage) return false;
        let raw = null;
        try {
          raw = storage.getItem(KEY);
        } catch {
          saveFailed = true;
          return false;
        }
        if (!raw) return false;
        try {
          const parsed = JSON.parse(raw);
          if (validateState(parsed).length) return false;
          state = parsed;
        } catch {
          return false;
        }
        if (generateRecurringInto(state) > 0) save();
        return true;
      },

      /** Outra aba alterou os dados. */
      reload() {
        if (api.load()) notify();
      },

      undo() {
        const entry = undoStack.pop();
        if (!entry) return null;
        state = JSON.parse(entry.snapshot);
        save();
        notify();
        return entry.label;
      },

      /** Troca tudo de uma vez (importação, dados de exemplo, apagar tudo). */
      replace(label, next) {
        commit(label, () => {
          state = next;
          generateRecurringInto(state);
        });
      },

      /**
       * Troca tudo pela versão que veio da nuvem. Não entra no "Desfazer": desfazer depois de sincronizar
       * traria de volta a versão antiga e a mandaria para a nuvem por cima da nova.
       */
      adopt(next) {
        if (validateState(next).length) throw new Error('Dados da nuvem inválidos');
        state = JSON.parse(JSON.stringify(next));
        undoStack.length = 0;
        generateRecurringInto(state);
        save();
        notify();
      },

      finishOnboarding(initialBalance) {
        commit('Início', (s) => {
          s.onboarded = true;
          if (initialBalance) s.accounts[0].initial = initialBalance;
        });
      },

      setTheme(theme) {
        commit('Tema', (s) => {
          s.theme = theme;
        });
      },

      /* ---------- Lançamentos ---------- */

      /** repeat: { mode: 'none' | 'monthly' | 'installments', count }. Devolve os lançamentos criados. */
      addTransaction(input) {
        const repeat = input.repeat || { mode: 'none' };
        return commit('Lançamento salvo', (s) => {
          if (repeat.mode === 'installments' && repeat.count > 1) {
            const group = uid();
            const parts = money.split(input.amount, repeat.count);
            const created = parts.map((amount, i) => ({
              ...buildTransaction({
                ...input,
                amount,
                date: dates.addMonthsToDate(input.date, i),
                paid: i === 0 ? input.paid : false,
              }),
              installment: { group, n: i + 1, total: repeat.count },
            }));
            s.transactions.push(...created);
            return created;
          }
          const tx = buildTransaction(input);
          if (repeat.mode === 'monthly' && tx.type !== 'transfer') {
            const rule = {
              id: uid(),
              type: tx.type,
              amount: tx.amount,
              desc: tx.desc,
              categoryId: tx.categoryId,
              accountId: tx.accountId,
              day: dates.dayOf(tx.date),
              active: true,
              lastMonth: dates.monthOf(tx.date),
            };
            s.recurring.push(rule);
            tx.recurringId = rule.id;
            s.transactions.push(tx);
            generateRecurringInto(s);
            return [tx];
          }
          s.transactions.push(tx);
          return [tx];
        });
      },

      updateTransaction(id, changes) {
        commit('Lançamento alterado', (s) => {
          const tx = byId(s.transactions, id);
          const next = buildTransaction({ ...tx, ...changes });
          Object.assign(tx, next, { id: tx.id });
          if (next.type === 'transfer') tx.categoryId = null;
          else delete tx.toAccountId;
        });
      },

      deleteTransactions(ids) {
        const set = new Set(ids);
        commit(ids.length === 1 ? 'Lançamento excluído' : `${ids.length} lançamentos excluídos`, (s) => {
          s.transactions = s.transactions.filter((t) => !set.has(t.id));
        });
      },

      setPaid(ids, paid) {
        const set = new Set(ids);
        commit(paid ? 'Marcado como pago' : 'Marcado como pendente', (s) => {
          s.transactions.forEach((t) => {
            if (set.has(t.id)) t.paid = paid;
          });
        });
      },

      setCategory(ids, categoryId) {
        const set = new Set(ids);
        const kind = byId(state.categories, categoryId).kind;
        commit('Categoria alterada', (s) => {
          s.transactions.forEach((t) => {
            if (set.has(t.id) && t.type === kind) t.categoryId = categoryId;
          });
        });
      },

      /** Importa linhas já conferidas. Devolve quantas entraram. */
      importTransactions(rows) {
        return commit(`${rows.length} lançamentos importados`, (s) => {
          rows.forEach((row) => s.transactions.push(buildTransaction(row)));
          return rows.length;
        });
      },

      /* ---------- Carteiras ---------- */

      saveAccount(id, data) {
        return commit(id ? 'Carteira alterada' : 'Carteira criada', (s) => {
          if (id) return Object.assign(byId(s.accounts, id), data);
          const account = { id: uid(), ...data };
          s.accounts.push(account);
          return account;
        });
      },

      /** Só apaga carteira sem lançamentos e nunca a última. Devolve o motivo se não puder. */
      deleteAccount(id) {
        if (state.accounts.length === 1) return 'É preciso ter pelo menos uma carteira.';
        const used = state.transactions.some((t) => t.accountId === id || t.toAccountId === id)
          || state.recurring.some((r) => r.accountId === id);
        if (used) return 'Esta carteira tem lançamentos. Mova ou exclua os lançamentos antes.';
        commit('Carteira excluída', (s) => {
          s.accounts = s.accounts.filter((a) => a.id !== id);
        });
        return null;
      },

      /* ---------- Categorias e orçamentos ---------- */

      saveCategory(id, data) {
        return commit(id ? 'Categoria alterada' : 'Categoria criada', (s) => {
          if (id) return Object.assign(byId(s.categories, id), data);
          const used = new Set(s.categories.map((c) => c.slot));
          let slot = null;
          if (data.kind === 'expense') {
            for (let i = 0; i < SLOTS; i++) {
              if (!used.has(i)) {
                slot = i;
                break;
              }
            }
          }
          const category = { id: uid(), budget: 0, slot, ...data };
          s.categories.push(category);
          return category;
        });
      },

      /** Os lançamentos da categoria passam para replacementId. */
      deleteCategory(id, replacementId) {
        commit('Categoria excluída', (s) => {
          s.transactions.forEach((t) => {
            if (t.categoryId === id) t.categoryId = replacementId;
          });
          s.recurring.forEach((r) => {
            if (r.categoryId === id) r.categoryId = replacementId;
          });
          s.categories = s.categories.filter((c) => c.id !== id);
        });
      },

      setBudget(categoryId, cents) {
        commit('Orçamento alterado', (s) => {
          byId(s.categories, categoryId).budget = cents;
        });
      },

      setBudgets(values) {
        commit('Orçamentos preenchidos', (s) => {
          for (const [id, cents] of Object.entries(values)) byId(s.categories, id).budget = cents;
        });
      },

      /* ---------- Contas fixas ---------- */

      saveRecurring(id, data) {
        return commit(id ? 'Conta fixa alterada' : 'Conta fixa criada', (s) => {
          if (id) return Object.assign(byId(s.recurring, id), data);
          const rule = { id: uid(), active: true, ...data };
          s.recurring.push(rule);
          generateRecurringInto(s);
          return rule;
        });
      },

      /** Os lançamentos já criados continuam no histórico. */
      deleteRecurring(id) {
        commit('Conta fixa excluída', (s) => {
          s.recurring = s.recurring.filter((r) => r.id !== id);
          s.transactions.forEach((t) => {
            if (t.recurringId === id) delete t.recurringId;
          });
        });
      },

      /* ---------- Metas ---------- */

      saveGoal(id, data) {
        return commit(id ? 'Meta alterada' : 'Meta criada', (s) => {
          if (id) return Object.assign(byId(s.goals, id), data);
          const goal = { id: uid(), saved: 0, history: [], ...data };
          s.goals.push(goal);
          return goal;
        });
      },

      deleteGoal(id) {
        commit('Meta excluída', (s) => {
          s.goals = s.goals.filter((g) => g.id !== id);
        });
      },

      /** amount positivo guarda; negativo retira. Nunca deixa o guardado negativo. */
      moveGoal(id, amount, date) {
        const goal = byId(state.goals, id);
        if (goal.saved + amount < 0) throw new Error('Retirada maior que o valor guardado');
        commit(amount > 0 ? 'Valor guardado' : 'Valor retirado', (s) => {
          const target = byId(s.goals, id);
          target.saved += amount;
          target.history.push({ date, amount });
        });
      },
    };

    return api;
  }

  FM.storeLib = { createStore, emptyState, validateState, uid, ACCOUNT_TYPES, KEY };
})(globalThis);
