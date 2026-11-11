/** Formulário de lançamento: criar e editar despesa, receita ou transferência. */
(function (root) {
  const FM = (root.FM = root.FM || {});
  const { el, icon, field, segmented, openDialog } = FM.dom;
  const { money, dates, queries: q } = FM;

  const TYPES = [
    { value: 'expense', label: 'Despesa' },
    { value: 'income', label: 'Receita' },
    { value: 'transfer', label: 'Transferência' },
  ];

  /**
   * ctx traz store e notify. tx edita um lançamento; preset preenche campos de um novo.
   */
  function open(ctx, { tx = null, preset = {} } = {}) {
    const { store } = ctx;
    const state = store.state;
    const today = store.today();
    const isEdit = Boolean(tx);

    let type = tx?.type ?? preset.type ?? 'expense';
    let repeat = 'none';
    let categoryTouched = isEdit || Boolean(preset.categoryId);
    let categoryId = tx?.categoryId ?? preset.categoryId ?? null;

    /* ---------- Controles ---------- */

    const amountInput = el('input', {
      class: 'input input-money',
      type: 'text',
      inputMode: 'decimal',
      autocomplete: 'off',
      placeholder: '0,00',
      value: tx ? money.formatPlain(tx.amount) : '',
      'data-autofocus': true,
      onblur: () => {
        const parsed = money.parse(amountInput.value);
        if (amountInput.value && !parsed.error && parsed.cents > 0) amountInput.value = money.formatPlain(parsed.cents);
        updatePreview();
      },
      oninput: () => updatePreview(),
    });

    const listId = 'descricoes-usadas';
    const descInput = el('input', {
      class: 'input',
      type: 'text',
      maxLength: 80,
      autocomplete: 'off',
      list: listId,
      placeholder: 'Mercado, aluguel, salário...',
      value: tx?.desc ?? preset.desc ?? '',
      oninput: () => suggest(),
      onchange: () => suggest(),
    });
    const descList = el('datalist', { id: listId }, q.knownDescriptions(state).map((d) => el('option', { value: d })));

    const accountOptions = (selected) =>
      state.accounts.map((a) => el('option', { value: a.id, selected: a.id === selected }, a.name));
    const accountSelect = el('select', { class: 'input' }, accountOptions(tx?.accountId ?? preset.accountId ?? state.accounts[0].id));
    const otherAccount = state.accounts.find((a) => a.id !== accountSelect.value);
    const toSelect = el('select', { class: 'input' }, accountOptions(tx?.toAccountId ?? otherAccount?.id));

    const dateInput = el('input', { class: 'input', type: 'date', required: true, value: tx?.date ?? preset.date ?? today });
    const dateShortcuts = el(
      'div',
      { class: 'chips-inline' },
      [['Hoje', today], ['Ontem', dates.addDays(today, -1)]].map(([label, value]) =>
        el('button', { class: 'chip-button', type: 'button', onclick: () => { dateInput.value = value; syncPaid(); } }, label),
      ),
    );

    const paidInput = el('input', { type: 'checkbox', checked: tx ? tx.paid : true });
    const paidLabelText = el('span', {});
    const paidBox = el('label', { class: 'check-line' }, paidInput, paidLabelText);
    let paidTouched = isEdit;
    paidInput.addEventListener('change', () => { paidTouched = true; });
    dateInput.addEventListener('change', () => syncPaid());

    /** Data futura costuma ser conta a pagar. Só sugere enquanto a pessoa não mexeu na caixa. */
    function syncPaid() {
      if (!paidTouched) paidInput.checked = dateInput.value <= today;
    }

    const categoryBox = el('div', { class: 'chips', role: 'radiogroup', 'aria-label': 'Categoria' });
    function renderCategories() {
      const options = state.categories.filter((c) => c.kind === type);
      if (!options.some((c) => c.id === categoryId)) categoryId = null;
      categoryBox.replaceChildren(
        ...options.map((c) =>
          el(
            'label',
            { class: 'chip' },
            el('input', {
              type: 'radio',
              name: 'categoria',
              value: c.id,
              checked: c.id === categoryId,
              onchange: () => {
                categoryId = c.id;
                categoryTouched = true;
                categoryField.setError(null);
              },
            }),
            el('span', {}, c.slot != null && el('i', { class: 'dot', style: { background: FM.charts.seriesColor(c.slot) } }), c.name),
          ),
        ),
      );
    }

    function suggest() {
      if (categoryTouched || type === 'transfer') return;
      const id = q.suggestCategory(state, descInput.value, type);
      if (id) {
        categoryId = id;
        renderCategories();
      }
    }

    const installmentsInput = el('input', {
      class: 'input input-short',
      type: 'number',
      min: 2,
      max: 120,
      value: 2,
      oninput: () => updatePreview(),
    });
    const preview = el('p', { class: 'field-hint', 'aria-live': 'polite' });
    const installmentsBox = el(
      'div',
      { class: 'installments', hidden: true },
      el('label', { class: 'inline-label' }, 'Parcelas', installmentsInput),
      preview,
    );
    const monthlyHint = el('p', { class: 'field-hint', hidden: true }, 'Todo mês entra um lançamento pendente, no mesmo dia. Dá para pausar em Contas fixas.');
    const repeatControl = segmented('repetir', 'Repetir', [
      { value: 'none', label: 'Não repete' },
      { value: 'monthly', label: 'Todo mês' },
      { value: 'installments', label: 'Parcelado' },
    ], repeat, (value) => {
      repeat = value;
      installmentsBox.hidden = value !== 'installments';
      monthlyHint.hidden = value !== 'monthly';
      updatePreview();
    });

    function updatePreview() {
      if (repeat !== 'installments') return;
      const parsed = money.parse(amountInput.value);
      const count = Number(installmentsInput.value);
      if (parsed.error || parsed.cents <= 0 || !Number.isInteger(count) || count < 2 || count > 120) {
        preview.textContent = 'Informe o valor total e de 2 a 120 parcelas.';
        return;
      }
      const parts = money.split(parsed.cents, count);
      preview.textContent = parts[0] === parts[1]
        ? `${count}x de ${money.format(parts[1])}, de ${dates.monthShort(dates.monthOf(dateInput.value))} em diante.`
        : `Primeira de ${money.format(parts[0])} e ${count - 1}x de ${money.format(parts[1])}.`;
    }

    /* ---------- Montagem ---------- */

    const amountField = field('Valor', amountInput, { class: 'field-money' });
    const descField = field('Descrição', descInput);
    const categoryField = field('Categoria', categoryBox);
    categoryField.querySelector('label').removeAttribute('for');
    const accountField = field('Carteira', accountSelect);
    const toField = field('Para qual carteira', toSelect);
    const dateField = field('Data', dateInput);
    dateField.append(dateShortcuts);
    const repeatField = el(
      'div',
      { class: 'field' },
      el('span', { class: 'field-label' }, 'Repetir'),
      repeatControl,
      monthlyHint,
      installmentsBox,
    );

    function syncType() {
      const transfer = type === 'transfer';
      categoryField.hidden = transfer;
      toField.hidden = !transfer;
      paidBox.hidden = transfer;
      accountField.querySelector('label').textContent = transfer ? 'De qual carteira' : 'Carteira';
      paidLabelText.textContent = type === 'income' ? 'Já recebi' : 'Já paguei';
      repeatField.hidden = isEdit || transfer;
      renderCategories();
    }

    const typeControl = segmented('tipo', 'Tipo de lançamento', TYPES, type, (value) => {
      type = value;
      categoryTouched = isEdit;
      syncType();
      suggest();
    });

    const form = el(
      'form',
      {
        class: 'form',
        id: 'form-lancamento',
        noValidate: true,
        onsubmit: (event) => {
          event.preventDefault();
          submit(false);
        },
      },
      typeControl,
      el('div', { class: 'form-row' }, amountField, dateField),
      descField,
      descList,
      categoryField,
      el('div', { class: 'form-row' }, accountField, toField),
      paidBox,
      repeatField,
    );

    /* ---------- Envio ---------- */

    function read() {
      let valid = true;
      const fail = (box, message) => {
        box.setError(message);
        if (valid) box.querySelector('input,select')?.focus();
        valid = false;
      };
      [amountField, dateField, categoryField, toField].forEach((box) => box.setError(null));

      const parsed = money.parse(amountInput.value);
      if (parsed.error) fail(amountField, parsed.error);
      else if (parsed.cents <= 0) fail(amountField, 'O valor precisa ser maior que zero.');
      if (!dates.isValidDate(dateInput.value)) fail(dateField, 'Informe uma data válida.');
      if (type !== 'transfer' && !categoryId) fail(categoryField, 'Escolha uma categoria.');
      if (type === 'transfer') {
        if (state.accounts.length < 2) fail(toField, 'Crie outra carteira para poder transferir.');
        else if (toSelect.value === accountSelect.value) fail(toField, 'Escolha uma carteira diferente da de origem.');
      }
      const count = Number(installmentsInput.value);
      if (repeat === 'installments' && (!Number.isInteger(count) || count < 2 || count > 120)) {
        valid = false;
        preview.textContent = 'Informe de 2 a 120 parcelas.';
        installmentsInput.focus();
      }
      if (!valid) return null;
      return {
        type,
        amount: parsed.cents,
        date: dateInput.value,
        desc: descInput.value,
        categoryId: type === 'transfer' ? null : categoryId,
        accountId: accountSelect.value,
        toAccountId: type === 'transfer' ? toSelect.value : undefined,
        paid: type === 'transfer' ? true : paidInput.checked,
        repeat: repeat === 'installments' ? { mode: 'installments', count } : { mode: repeat },
      };
    }

    function submit(addAnother) {
      const data = read();
      if (!data) return;
      if (isEdit) {
        const { repeat: _ignored, ...changes } = data;
        handle.close();
        store.updateTransaction(tx.id, changes);
        FM.motion.haptic();
        ctx.notify('Lançamento alterado');
        return;
      }
      if (addAnother) {
        store.addTransaction(data);
        FM.motion.haptic();
        ctx.notify('Lançamento salvo');
        amountInput.value = '';
        descInput.value = '';
        categoryTouched = false;
        amountInput.focus();
        return;
      }
      handle.close();
      store.addTransaction(data);
      FM.motion.haptic();
      const name = data.repeat.mode === 'installments' ? `${data.repeat.count} parcelas salvas` : 'Lançamento salvo';
      ctx.notify(name);
    }

    function remove() {
      const later = tx.installment
        ? state.transactions.filter((t) => t.installment?.group === tx.installment.group && t.installment.n > tx.installment.n)
        : [];
      if (later.length) {
        let choice = null;
        choice = openDialog({
          title: `Excluir ${q.titleOf(state, tx)}?`,
          description: `Depois desta ainda ${later.length === 1 ? 'vem 1 parcela' : `vêm ${later.length} parcelas`}.`,
          body: null,
          footer: [
            el('button', { class: 'button', type: 'button', onclick: () => choice.close() }, 'Cancelar'),
            el('button', { class: 'button button-danger', type: 'button', onclick: () => finish([tx.id]) }, 'Excluir só esta'),
            el('button', {
              class: 'button button-danger',
              type: 'button',
              'data-autofocus': true,
              onclick: () => finish([tx.id, ...later.map((t) => t.id)]),
            }, 'Excluir esta e as seguintes'),
          ],
        });
        const finish = (ids) => {
          choice.close();
          handle.close();
          store.deleteTransactions(ids);
          ctx.notify(ids.length === 1 ? 'Lançamento excluído' : `${ids.length} parcelas excluídas`);
        };
        return;
      }
      handle.close();
      store.deleteTransactions([tx.id]);
      ctx.notify('Lançamento excluído');
    }

    syncType();

    const footer = [
      isEdit && el('button', { class: 'button button-ghost-danger push-left', type: 'button', onclick: remove }, icon('trash'), 'Excluir'),
      !isEdit && el('button', { class: 'button push-left', type: 'button', onclick: () => submit(true) }, 'Salvar e adicionar outro'),
      el('button', { class: 'button button-primary', type: 'submit', form: 'form-lancamento' }, isEdit ? 'Salvar alterações' : 'Salvar lançamento'),
    ];

    const handle = openDialog({
      title: isEdit ? 'Editar lançamento' : 'Novo lançamento',
      body: form,
      footer,
    });
    return handle;
  }

  FM.txForm = { open };
})(globalThis);
