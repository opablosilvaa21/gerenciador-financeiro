/** Orçamentos, contas fixas e parcelas, e metas. */
(function (root) {
  const FM = (root.FM = root.FM || {});
  const { el, icon, field, openDialog, segmented } = FM.dom;
  const { money, dates, queries: q, common } = FM;

  /* ---------- Orçamentos ---------- */

  function budgets(ctx) {
    const { store } = ctx;
    const { state } = store;
    const statuses = new Map(q.budgets(state, ctx.month).map((b) => [b.category.id, b]));
    const summary = q.monthSummary(state, ctx.month);
    const spentBy = new Map(summary.byCategory.map((i) => [i.category.id, i.amount]));
    const categories = state.categories.filter((c) => c.kind === 'expense');
    const planned = categories.reduce((sum, c) => sum + c.budget, 0);

    function limitInput(category) {
      const input = el('input', {
        class: 'input input-compact input-limit',
        type: 'text',
        inputMode: 'decimal',
        placeholder: 'Sem limite',
        'aria-label': `Limite mensal de ${category.name}`,
        value: category.budget ? money.formatPlain(category.budget) : '',
        dataset: { fk: `limite-${category.id}` },
        onkeydown: (event) => {
          if (event.key === 'Enter') input.blur();
          if (event.key === 'Escape') {
            input.value = category.budget ? money.formatPlain(category.budget) : '';
            input.blur();
          }
        },
        onblur: () => {
          const text = input.value.trim();
          const parsed = text ? money.parse(text) : { cents: 0 };
          if (parsed.error || parsed.cents < 0) {
            input.setAttribute('aria-invalid', 'true');
            FM.dom.toast(parsed.error || 'O limite não pode ser negativo.', { tone: 'error' });
            return;
          }
          input.removeAttribute('aria-invalid');
          if (parsed.cents === category.budget) return;
          store.setBudget(category.id, parsed.cents);
          ctx.notify(parsed.cents ? `Limite de ${category.name} salvo` : `Limite de ${category.name} removido`);
        },
      });
      return input;
    }

    function row(category) {
      const status = statuses.get(category.id);
      const used = spentBy.get(category.id) || 0;
      const average = q.categoryAverage(state, category.id, ctx.month);
      let detail = `${money.format(used)} gastos`;
      if (status) {
        detail = status.remaining >= 0
          ? `${money.format(status.used)} de ${money.format(category.budget)}. Restam ${money.format(status.remaining)}.`
          : `${money.format(status.used)} de ${money.format(category.budget)}. Passou ${money.format(-status.remaining)}.`;
      }
      return el(
        'li',
        { class: 'budget-row' },
        el(
          'div',
          { class: 'budget-info' },
          el('button', {
            class: 'budget-name',
            type: 'button',
            onclick: () => ctx.go('lancamentos', { mes: ctx.month, categoria: category.id }),
          }, common.categoryDot(category), category.name),
          status && common.levelBadge(status.level),
        ),
        el(
          'div',
          { class: 'budget-progress' },
          status
            ? common.meter(status.ratio, status.level, `${category.name}: ${common.LEVEL_TEXT[status.level]}`)
            : el('div', { class: 'meter meter-none' }),
          el('p', { class: 'budget-detail' }, detail, average ? ` Média recente: ${money.format(average)}.` : ''),
        ),
        el('div', { class: 'budget-limit' }, el('span', { class: 'input-prefix' }, 'R$'), limitInput(category)),
      );
    }

    return el(
      'div',
      { class: 'view' },
      common.pageHead(`Orçamentos de ${dates.monthName(ctx.month)}`, {
        monthNav: common.monthNav(ctx),
        actions: el('button', {
          class: 'button',
          type: 'button',
          onclick: () => {
            const values = {};
            for (const c of categories) {
              const average = q.categoryAverage(state, c.id, ctx.month);
              if (average && !c.budget) values[c.id] = Math.ceil(average / 1000) * 1000;
            }
            const count = Object.keys(values).length;
            if (!count) {
              FM.dom.toast('Não há histórico para sugerir novos limites.');
              return;
            }
            store.setBudgets(values);
            ctx.notify(`${count} ${count === 1 ? 'limite sugerido' : 'limites sugeridos'} pela média`);
          },
        }, 'Sugerir pela média'),
        intro: 'O limite vale para todos os meses. Escreva o valor e saia do campo para salvar.',
      }),
      el(
        'dl',
        { class: 'stats stats-row' },
        el('div', { class: 'stat' }, el('dt', {}, 'Planejado'), el('dd', {}, el('strong', {}, money.format(planned)))),
        el('div', { class: 'stat' }, el('dt', {}, 'Gasto no mês'), el('dd', {}, el('strong', {}, money.format(summary.expense)))),
        el('div', { class: 'stat' }, el('dt', {}, 'Entrou no mês'), el('dd', {}, el('strong', {}, money.format(summary.income)))),
      ),
      el('ul', { class: 'budget-list' }, categories.map(row)),
    );
  }

  /* ---------- Contas fixas ---------- */

  function nextDue(rule, today) {
    const month = dates.monthOf(today);
    const thisMonth = dates.dateIn(month, rule.day);
    return thisMonth >= today ? thisMonth : dates.dateIn(dates.addMonths(month, 1), rule.day);
  }

  function openRecurringForm(ctx, rule = null) {
    const { store } = ctx;
    const { state } = store;
    let type = rule?.type ?? 'expense';

    const descInput = el('input', { class: 'input', type: 'text', maxLength: 80, value: rule?.desc ?? '', placeholder: 'Aluguel, internet, academia...', 'data-autofocus': true });
    const amountInput = el('input', { class: 'input input-money', type: 'text', inputMode: 'decimal', placeholder: '0,00', value: rule ? money.formatPlain(rule.amount) : '' });
    const dayInput = el('input', { class: 'input input-short', type: 'number', min: 1, max: 31, value: rule?.day ?? dates.dayOf(store.today()) });
    const categorySelect = el('select', { class: 'input' });
    const accountSelect = el('select', { class: 'input' }, state.accounts.map((a) => el('option', { value: a.id, selected: a.id === rule?.accountId }, a.name)));

    const renderCategories = () => {
      categorySelect.replaceChildren(...state.categories
        .filter((c) => c.kind === type)
        .map((c) => el('option', { value: c.id, selected: c.id === rule?.categoryId }, c.name)));
    };
    renderCategories();

    const descField = field('Descrição', descInput);
    const amountField = field('Valor', amountInput, { class: 'field-money' });
    const dayField = field('Dia do mês', dayInput, { hint: 'Em meses mais curtos, vai para o último dia.' });
    const typeControl = segmented('tipo-fixa', 'Tipo', [
      { value: 'expense', label: 'Despesa' },
      { value: 'income', label: 'Receita' },
    ], type, (value) => {
      type = value;
      renderCategories();
    });

    const submit = () => {
      let ok = true;
      if (!descInput.value.trim()) {
        descField.setError('Dê um nome para reconhecer esta conta.');
        descInput.focus();
        ok = false;
      } else descField.setError(null);
      const cents = common.readMoney(amountInput, amountField);
      if (cents == null) ok = false;
      const day = Number(dayInput.value);
      if (!Number.isInteger(day) || day < 1 || day > 31) {
        dayField.setError('Use um dia de 1 a 31.');
        ok = false;
      } else dayField.setError(null);
      if (!ok) return;

      const data = {
        type,
        desc: descInput.value.trim(),
        amount: cents,
        day,
        categoryId: categorySelect.value,
        accountId: accountSelect.value,
      };
      handle.close();
      if (rule) {
        store.saveRecurring(rule.id, data);
        ctx.notify('Conta fixa alterada. Os próximos meses usam os novos dados.');
      } else {
        // O primeiro lançamento já sai no mês atual.
        store.saveRecurring(null, { ...data, lastMonth: dates.addMonths(dates.monthOf(store.today()), -1) });
        ctx.notify('Conta fixa criada');
      }
    };

    const handle = openDialog({
      title: rule ? 'Editar conta fixa' : 'Nova conta fixa',
      body: el(
        'form',
        { class: 'form', id: 'form-fixa', noValidate: true, onsubmit: (event) => { event.preventDefault(); submit(); } },
        typeControl,
        descField,
        el('div', { class: 'form-row' }, amountField, dayField),
        el('div', { class: 'form-row' }, field('Categoria', categorySelect), field('Carteira', accountSelect)),
      ),
      footer: [
        rule && el('button', {
          class: 'button button-ghost-danger push-left',
          type: 'button',
          onclick: () => {
            handle.close();
            store.deleteRecurring(rule.id);
            ctx.notify('Conta fixa excluída. Os lançamentos já criados continuam no histórico.');
          },
        }, icon('trash'), 'Excluir'),
        el('button', { class: 'button button-primary', type: 'submit', form: 'form-fixa' }, rule ? 'Salvar alterações' : 'Criar conta fixa'),
      ],
    });
  }

  function recurring(ctx) {
    const { store } = ctx;
    const { state } = store;
    const today = store.today();

    const active = state.recurring.filter((r) => r.active);
    const monthlyOut = active.filter((r) => r.type === 'expense').reduce((sum, r) => sum + r.amount, 0);
    const monthlyIn = active.filter((r) => r.type === 'income').reduce((sum, r) => sum + r.amount, 0);

    const sorted = [...state.recurring].sort((a, b) => a.day - b.day);
    const rows = sorted.map((rule) => {
      const category = q.categoryOf(state, rule.categoryId);
      return el(
        'li',
        { class: `rule-row${rule.active ? '' : ' is-paused'}` },
        el('button', {
          class: 'rule-main',
          type: 'button',
          dataset: { fk: `fixa-${rule.id}` },
          onclick: () => openRecurringForm(ctx, rule),
        },
          el('span', { class: 'tx-title' }, rule.desc),
          el('span', { class: 'tx-sub' }, common.categoryDot(category), `${category?.name ?? ''}, todo dia ${rule.day}`),
        ),
        el('span', { class: 'rule-next' }, rule.active ? `Próxima: ${dates.relativeLabel(nextDue(rule, today), today)}` : 'Pausada'),
        el('span', { class: `tx-amount tx-${rule.type}` }, common.amountText(rule)),
        el('button', {
          class: 'icon-button',
          type: 'button',
          'aria-label': rule.active ? `Pausar ${rule.desc}` : `Retomar ${rule.desc}`,
          title: rule.active ? 'Pausar' : 'Retomar',
          dataset: { fk: `pausa-${rule.id}` },
          onclick: () => {
            const next = !rule.active;
            // Ao retomar, não cria de uma vez os meses que ficaram parados.
            const changes = next ? { active: true, lastMonth: dates.addMonths(dates.monthOf(today), -1) > rule.lastMonth ? dates.addMonths(dates.monthOf(today), -1) : rule.lastMonth } : { active: false };
            store.saveRecurring(rule.id, changes);
            ctx.notify(next ? `${rule.desc} retomada` : `${rule.desc} pausada`);
          },
        }, icon(rule.active ? 'pause' : 'play')),
      );
    });

    /* Parcelas em andamento, agrupadas pela compra. */
    const groups = new Map();
    for (const tx of state.transactions) {
      if (!tx.installment) continue;
      const group = groups.get(tx.installment.group) || { items: [], desc: tx.desc || q.categoryOf(state, tx.categoryId)?.name || 'Parcelado', categoryId: tx.categoryId };
      group.items.push(tx);
      groups.set(tx.installment.group, group);
    }
    const running = [...groups.values()]
      .map((group) => {
        const paid = group.items.filter((t) => t.paid).length;
        const remaining = group.items.filter((t) => !t.paid).reduce((sum, t) => sum + t.amount, 0);
        const next = group.items.filter((t) => !t.paid).sort((a, b) => a.date.localeCompare(b.date))[0];
        return { ...group, paid, total: group.items[0].installment.total, remaining, next };
      })
      .filter((group) => group.remaining > 0);

    return el(
      'div',
      { class: 'view' },
      common.pageHead('Contas fixas', {
        actions: el('button', {
          class: 'button button-primary',
          type: 'button',
          dataset: { fk: 'nova-fixa' },
          onclick: () => openRecurringForm(ctx),
        }, icon('plus'), 'Nova conta fixa'),
        intro: 'Todo mês o Sobra cria o lançamento como pendente. Você só confirma quando pagar ou receber.',
      }),
      state.recurring.length > 0 && el(
        'dl',
        { class: 'stats stats-row' },
        el('div', { class: 'stat' }, el('dt', {}, 'Sai todo mês'), el('dd', {}, el('strong', {}, money.format(monthlyOut)))),
        el('div', { class: 'stat' }, el('dt', {}, 'Entra todo mês'), el('dd', {}, el('strong', {}, money.format(monthlyIn)))),
        el('div', { class: 'stat' }, el('dt', {}, 'Livre depois das fixas'), el('dd', {}, el('strong', {}, money.format(monthlyIn - monthlyOut)))),
      ),
      rows.length
        ? el('ul', { class: 'rule-list' }, rows)
        : common.emptyState('Nenhuma conta fixa', 'Cadastre aluguel, internet, salário e o que mais se repete todo mês.'),
      el(
        'section',
        { class: 'band' },
        el('div', { class: 'band-head' }, el('h2', {}, 'Parcelas em andamento')),
        running.length
          ? el(
              'ul',
              { class: 'rule-list' },
              running.map((group) =>
                el(
                  'li',
                  { class: 'rule-row' },
                  el(
                    'button',
                    {
                      class: 'rule-main',
                      type: 'button',
                      onclick: () => group.next && FM.txForm.open(ctx, { tx: group.next }),
                    },
                    el('span', { class: 'tx-title' }, group.desc),
                    el('span', { class: 'tx-sub' }, common.categoryDot(q.categoryOf(state, group.categoryId)), `${group.paid} de ${group.total} pagas`),
                  ),
                  el('span', { class: 'rule-next' }, group.next ? `Próxima: ${dates.relativeLabel(group.next.date, today)}` : ''),
                  el('span', { class: 'tx-amount' }, `Faltam ${money.format(group.remaining)}`),
                ),
              ),
            )
          : common.emptyState('Nenhuma parcela em andamento', 'Ao lançar uma compra, escolha "Parcelado" em Repetir.'),
      ),
    );
  }

  /* ---------- Metas ---------- */

  function openGoalForm(ctx, goal = null) {
    const { store } = ctx;
    const nameInput = el('input', { class: 'input', type: 'text', maxLength: 60, value: goal?.name ?? '', placeholder: 'Reserva de emergência, viagem...', 'data-autofocus': true });
    const targetInput = el('input', { class: 'input input-money', type: 'text', inputMode: 'decimal', placeholder: '0,00', value: goal ? money.formatPlain(goal.target) : '' });
    const deadlineInput = el('input', { class: 'input', type: 'month', value: goal?.deadline ?? '', min: dates.monthOf(store.today()) });

    const nameField = field('Nome da meta', nameInput);
    const targetField = field('Quanto quer juntar', targetInput, { class: 'field-money' });
    const deadlineField = field('Até quando', deadlineInput, { hint: 'Opcional. Com prazo, o Sobra calcula quanto guardar por mês.' });

    const submit = () => {
      let ok = true;
      if (!nameInput.value.trim()) {
        nameField.setError('Dê um nome para a meta.');
        nameInput.focus();
        ok = false;
      } else nameField.setError(null);
      const cents = common.readMoney(targetInput, targetField);
      if (cents == null) ok = false;
      if (!ok) return;
      handle.close();
      store.saveGoal(goal?.id ?? null, { name: nameInput.value.trim(), target: cents, deadline: deadlineInput.value || null });
      ctx.notify(goal ? 'Meta alterada' : 'Meta criada');
    };

    const handle = openDialog({
      title: goal ? 'Editar meta' : 'Nova meta',
      body: el('form', { class: 'form', id: 'form-meta', noValidate: true, onsubmit: (event) => { event.preventDefault(); submit(); } }, nameField, targetField, deadlineField),
      footer: [
        goal && el('button', {
          class: 'button button-ghost-danger push-left',
          type: 'button',
          onclick: () => {
            handle.close();
            store.deleteGoal(goal.id);
            ctx.notify('Meta excluída');
          },
        }, icon('trash'), 'Excluir'),
        el('button', { class: 'button button-primary', type: 'submit', form: 'form-meta' }, goal ? 'Salvar alterações' : 'Criar meta'),
      ],
    });
  }

  function openGoalMove(ctx, goal, direction) {
    const { store } = ctx;
    const saving = direction > 0;
    const input = el('input', { class: 'input input-money', type: 'text', inputMode: 'decimal', placeholder: '0,00', 'data-autofocus': true });
    const box = field(saving ? 'Quanto guardar' : 'Quanto retirar', input, {
      class: 'field-money',
      hint: `Guardado até agora: ${money.format(goal.saved)}.`,
    });
    const submit = () => {
      const cents = common.readMoney(input, box);
      if (cents == null) return;
      if (!saving && cents > goal.saved) {
        box.setError(`Só há ${money.format(goal.saved)} guardados nesta meta.`);
        input.focus();
        return;
      }
      handle.close();
      store.moveGoal(goal.id, saving ? cents : -cents, store.today());
      ctx.notify(saving ? `${money.format(cents)} guardados em ${goal.name}` : `${money.format(cents)} retirados de ${goal.name}`);
    };
    const handle = openDialog({
      title: goal.name,
      body: el('form', { class: 'form', id: 'form-mover', noValidate: true, onsubmit: (event) => { event.preventDefault(); submit(); } }, box),
      footer: el('button', { class: 'button button-primary', type: 'submit', form: 'form-mover' }, saving ? 'Guardar' : 'Retirar'),
    });
  }

  function goals(ctx) {
    const { state } = ctx.store;
    const today = ctx.store.today();
    const month = dates.monthOf(today);

    const row = (goal) => {
      const ratio = goal.target ? goal.saved / goal.target : 0;
      const missing = Math.max(goal.target - goal.saved, 0);
      const done = missing === 0;
      let plan = null;
      if (done) plan = 'Meta alcançada.';
      else if (goal.deadline) {
        const months = dates.diffMonths(month, goal.deadline);
        if (months <= 0) plan = `O prazo era ${dates.monthLabel(goal.deadline)}. Faltam ${money.format(missing)}.`;
        else plan = `Guardando ${money.format(Math.ceil(missing / months))} por mês, chega lá em ${dates.monthName(goal.deadline)} de ${goal.deadline.slice(0, 4)}.`;
      } else plan = `Faltam ${money.format(missing)}.`;

      return el(
        'li',
        { class: `goal${done ? ' is-done' : ''}` },
        el(
          'div',
          { class: 'goal-head' },
          el('button', { class: 'goal-name', type: 'button', dataset: { fk: `meta-${goal.id}` }, onclick: () => openGoalForm(ctx, goal) }, goal.name),
          el('span', { class: 'goal-values' }, el('strong', {}, money.format(goal.saved)), ` de ${money.format(goal.target)}`),
        ),
        common.meter(ratio, done ? 'ok' : 'goal', `${goal.name}: ${Math.floor(ratio * 100)}% da meta`),
        el(
          'div',
          { class: 'goal-foot' },
          el('p', {}, `${Math.min(Math.floor(ratio * 100), 100)}%. ${plan}`),
          el(
            'div',
            { class: 'goal-actions' },
            goal.saved > 0 && el('button', { class: 'button button-small', type: 'button', onclick: () => openGoalMove(ctx, goal, -1) }, 'Retirar'),
            el('button', { class: 'button button-small', type: 'button', dataset: { fk: `guardar-${goal.id}` }, onclick: () => openGoalMove(ctx, goal, 1) }, 'Guardar'),
          ),
        ),
      );
    };

    return el(
      'div',
      { class: 'view' },
      common.pageHead('Metas', {
        actions: el('button', {
          class: 'button button-primary',
          type: 'button',
          dataset: { fk: 'nova-meta' },
          onclick: () => openGoalForm(ctx),
        }, icon('plus'), 'Nova meta'),
        intro: 'Uma meta é um combinado com você mesmo. Guardar aqui não tira dinheiro de nenhuma carteira.',
      }),
      state.goals.length
        ? el('ul', { class: 'goal-list' }, state.goals.map(row))
        : common.emptyState('Nenhuma meta ainda', 'Crie uma meta e acompanhe quanto falta para chegar lá.'),
    );
  }

  FM.views = FM.views || {};
  Object.assign(FM.views, { budgets, recurring, goals });
})(globalThis);
