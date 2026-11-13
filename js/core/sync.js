/**
 * Junta os dados de dois aparelhos sem perder nada, para o backup na nuvem.
 * Sem interface e sem rede: só recebe estados e devolve um estado, e por isso é testado no Node.
 *
 * merge(base, local, remote): junção em três vias, registro por registro (pelo id).
 *   base   é como os dados estavam na última vez que este aparelho e a nuvem concordaram;
 *   local  é como estão neste aparelho agora;
 *   remote é como estão na nuvem agora (alterados por outro aparelho).
 * Para cada registro: quem mudou em relação à base vence; se os dois mudaram o mesmo registro, vale
 * o deste aparelho; apagado de um lado e intacto do outro, sai; apagado de um lado e editado do outro, fica.
 *
 * mergeWithoutBase(local, remote): para a primeira vez que um aparelho com dados entra numa conta que também
 * tem dados. Junta tudo, reconhecendo categorias e carteiras com o mesmo nome.
 */
(function (root) {
  const FM = (root.FM = root.FM || {});

  const COLLECTIONS = ['accounts', 'categories', 'transactions', 'recurring', 'goals'];

  /** JSON com as chaves em ordem: dois registros iguais dão sempre o mesmo texto. */
  function stable(value) {
    if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
    if (value && typeof value === 'object') {
      return `{${Object.keys(value).sort().filter((k) => value[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
    }
    return JSON.stringify(value);
  }

  const same = (a, b) => stable(a) === stable(b);
  const clone = (value) => JSON.parse(JSON.stringify(value));

  /** Nada que valha guardar: aparelho que acabou de abrir o app ou que só viu os dados de exemplo. */
  function isBlank(state) {
    if (!state || state.demo || !state.onboarded) return true;
    return !state.transactions.length && !state.recurring.length && !state.goals.length;
  }

  const normalize = (text) => String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

  /** Junção de uma lista de registros pelo id, mantendo a ordem: primeiro a do aparelho, depois os novos da nuvem. */
  function mergeList(baseList, localList, remoteList) {
    const base = new Map((baseList || []).map((r) => [r.id, r]));
    const local = new Map(localList.map((r) => [r.id, r]));
    const remote = new Map(remoteList.map((r) => [r.id, r]));
    const order = [...local.keys(), ...[...remote.keys()].filter((id) => !local.has(id))];
    const out = [];
    for (const id of order) {
      const b = base.get(id);
      const l = local.get(id);
      const r = remote.get(id);
      if (l && r) {
        // Os dois têm: se só a nuvem mudou, vale a nuvem; nos outros casos, vale o deste aparelho.
        out.push(b && same(l, b) && !same(r, b) ? r : l);
      } else if (l) {
        // Só aqui: é novo (fica) ou foi apagado na nuvem. Apagado lá e editado aqui, fica.
        if (!b || !same(l, b)) out.push(l);
      } else if (r) {
        // Só na nuvem: é novo (fica) ou foi apagado aqui. Apagado aqui e editado lá, fica.
        if (!b || !same(r, b)) out.push(r);
      }
    }
    return out;
  }

  /** Valor simples (tema, já começou, exemplo): quem mudou em relação à base vence; os dois mudaram, vale o daqui. */
  function mergeValue(base, local, remote, key) {
    if (!base) return local[key];
    return same(local[key], base[key]) ? remote[key] : local[key];
  }

  /**
   * As contas fixas criam o lançamento do mês ao abrir o app, em cada aparelho, com um id novo.
   * O mesmo mês da mesma conta fixa é um lançamento só: fica o que já foi mexido (pago, editado).
   */
  function dedupeRecurring(state) {
    const kept = new Map();
    const drop = new Set();
    for (const tx of state.transactions) {
      if (!tx.recurringId) continue;
      const key = `${tx.recurringId}|${tx.date.slice(0, 7)}`;
      const other = kept.get(key);
      if (!other) {
        kept.set(key, tx);
        continue;
      }
      const prefer = tx.paid && !other.paid ? tx : other;
      drop.add(prefer === tx ? other.id : tx.id);
      kept.set(key, prefer);
    }
    if (drop.size) state.transactions = state.transactions.filter((t) => !drop.has(t.id));
    // Uma conta fixa avançada num aparelho não volta atrás por causa do outro.
    return state;
  }

  /** Tudo o que aponta para uma carteira ou categoria que não existe mais é ajustado, para os dados continuarem válidos. */
  function repairReferences(state) {
    const accounts = new Set(state.accounts.map((a) => a.id));
    const categories = new Set(state.categories.map((c) => c.id));
    if (!state.accounts.length) return state;
    const firstAccount = state.accounts[0].id;
    const fallback = (kind) => state.categories.filter((c) => c.kind === kind).slice(-1)[0]?.id;
    for (const tx of state.transactions) {
      if (!accounts.has(tx.accountId)) tx.accountId = firstAccount;
      if (tx.type === 'transfer') {
        if (!accounts.has(tx.toAccountId)) tx.toAccountId = state.accounts.find((a) => a.id !== tx.accountId)?.id ?? tx.accountId;
      } else if (!categories.has(tx.categoryId)) {
        tx.categoryId = fallback(tx.type);
      }
    }
    for (const rule of state.recurring) {
      if (!accounts.has(rule.accountId)) rule.accountId = firstAccount;
      if (!categories.has(rule.categoryId)) rule.categoryId = fallback(rule.type);
    }
    // Uma transferência entre a mesma carteira não faz sentido: vira uma movimentação perdida, então sai.
    state.transactions = state.transactions.filter((t) => t.type !== 'transfer' || t.toAccountId !== t.accountId);
    return state;
  }

  function merge(base, local, remote) {
    const out = {};
    for (const key of ['version', 'onboarded', 'demo', 'theme']) out[key] = mergeValue(base, local, remote, key);
    out.version = Math.max(local.version || 1, remote.version || 1);
    out.onboarded = Boolean(local.onboarded || remote.onboarded);
    for (const key of COLLECTIONS) out[key] = clone(mergeList(base?.[key], local[key], remote[key]));
    for (const rule of out.recurring) {
      const others = [local, remote].map((s) => s.recurring.find((r) => r.id === rule.id)?.lastMonth).filter(Boolean);
      if (others.length) rule.lastMonth = others.sort().pop();
    }
    return repairReferences(dedupeRecurring(out));
  }

  /**
   * Primeira junção, sem base: une os dois lados. Categorias com o mesmo nome e tipo, e carteiras com o mesmo nome,
   * viram uma só (cada aparelho cria as suas com ids diferentes). Lançamentos idênticos não se repetem.
   */
  function mergeWithoutBase(local, remote) {
    const out = clone(remote);
    out.onboarded = true;
    out.demo = false;
    const idMap = new Map();

    const unite = (key, sameAs) => {
      for (const item of local[key]) {
        if (out[key].some((r) => r.id === item.id)) continue;
        const twin = sameAs && out[key].find((r) => sameAs(r, item));
        if (twin) idMap.set(item.id, twin.id);
        else out[key].push(clone(item));
      }
    };
    unite('accounts', (a, b) => normalize(a.name) === normalize(b.name));
    unite('categories', (a, b) => a.kind === b.kind && normalize(a.name) === normalize(b.name));
    const remap = (id) => (idMap.has(id) ? idMap.get(id) : id);

    // Limites de orçamento: o daqui completa os que a nuvem não tem.
    for (const item of local.categories) {
      const target = out.categories.find((c) => c.id === remap(item.id));
      if (target && !target.budget && item.budget) target.budget = item.budget;
    }

    const fingerprint = (t) => stable({ ...t, id: undefined, installment: t.installment ? { n: t.installment.n, total: t.installment.total } : undefined });
    const seen = new Set(out.transactions.map(fingerprint));
    for (const rule of local.recurring) {
      if (!out.recurring.some((r) => r.id === rule.id)) out.recurring.push({ ...clone(rule), accountId: remap(rule.accountId), categoryId: remap(rule.categoryId) });
    }
    for (const tx of local.transactions) {
      if (out.transactions.some((t) => t.id === tx.id)) continue;
      const moved = { ...clone(tx), accountId: remap(tx.accountId), toAccountId: tx.toAccountId ? remap(tx.toAccountId) : tx.toAccountId, categoryId: tx.categoryId ? remap(tx.categoryId) : tx.categoryId };
      if (moved.toAccountId === undefined) delete moved.toAccountId;
      const print = fingerprint(moved);
      if (seen.has(print)) continue;
      seen.add(print);
      out.transactions.push(moved);
    }
    for (const goal of local.goals) {
      if (!out.goals.some((g) => g.id === goal.id)) out.goals.push(clone(goal));
    }
    return repairReferences(dedupeRecurring(out));
  }

  FM.sync = { merge, mergeWithoutBase, isBlank, stable, same };
})(globalThis);
