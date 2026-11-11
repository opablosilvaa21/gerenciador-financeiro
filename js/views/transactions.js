/** Lançamentos: busca, filtros, ordenação, seleção em lote e exportação. */
(function (root) {
  const FM = (root.FM = root.FM || {});
  const { el, icon, download, openDialog } = FM.dom;
  const { money, dates, queries: q, common } = FM;

  const PAGE = 80;

  /** Filtros ficam guardados enquanto o app está aberto, mesmo trocando de tela. */
  const filters = { q: '', type: '', categoryId: '', accountId: '', status: '', allMonths: false };
  let sort = { by: 'date', dir: 'desc' };
  let visible = PAGE;
  const selected = new Set();
  /** No celular, os filtros e as caixas de seleção só aparecem quando pedidos, para sobrar tela para a lista. */
  let filtersOpen = false;
  let selecting = false;

  /** A tela pode ser aberta com filtros prontos, como ao clicar em uma parte da régua. */
  function applyParams(ctx) {
    const { params } = ctx;
    if (!Object.keys(params).length) return;
    filters.q = '';
    filters.type = '';
    filters.accountId = '';
    filters.categoryId = params.categoria || '';
    filters.status = params.situacao || '';
    filters.allMonths = params.mes === 'todos';
    if (params.mes && dates.isValidMonth(params.mes)) ctx.setMonth(params.mes, { silent: true });
    if (params.carteira) {
      filters.accountId = params.carteira;
      filters.allMonths = true;
    }
    ctx.clearParams();
  }

  function currentFilters(ctx) {
    return { ...filters, month: filters.allMonths ? null : ctx.month };
  }

  const anyFilter = () => Boolean(filters.q || filters.type || filters.categoryId || filters.accountId || filters.status);

  function selectControl(label, value, options, onChange) {
    return el(
      'label',
      { class: 'filter' },
      el('span', { class: 'filter-label' }, label),
      el('select', { class: 'input input-compact', onchange: (event) => onChange(event.target.value) }, options.map((o) =>
        o.group
          ? el('optgroup', { label: o.group }, o.items.map((i) => el('option', { value: i.value, selected: i.value === value }, i.label)))
          : el('option', { value: o.value, selected: o.value === value }, o.label),
      )),
    );
  }

  function transactions(ctx) {
    applyParams(ctx);
    const { store } = ctx;
    const { state } = store;
    const today = store.today();
    visible = PAGE;
    for (const id of [...selected]) if (!state.transactions.some((t) => t.id === id)) selected.delete(id);

    const listRegion = el('div', { class: 'tx-region card' });
    const summaryLine = el('p', { class: 'filter-summary', 'aria-live': 'polite' });
    const bulkBar = el('div', { class: 'bulk', hidden: true });

    const search = el('input', {
      class: 'input search-input',
      type: 'search',
      id: 'busca-lancamentos',
      placeholder: 'Buscar por descrição, categoria ou carteira',
      'aria-label': 'Buscar lançamentos',
      value: filters.q,
      oninput: () => {
        filters.q = search.value;
        visible = PAGE;
        renderList();
      },
    });

    const expenseCats = state.categories.filter((c) => c.kind === 'expense').map((c) => ({ value: c.id, label: c.name }));
    const incomeCats = state.categories.filter((c) => c.kind === 'income').map((c) => ({ value: c.id, label: c.name }));

    const update = (key) => (value) => {
      filters[key] = value;
      visible = PAGE;
      renderList();
    };

    const filterToggle = el('button', {
      class: 'button button-small',
      type: 'button',
      'aria-expanded': String(filtersOpen),
      onclick: () => {
        filtersOpen = !filtersOpen;
        filterToggle.setAttribute('aria-expanded', String(filtersOpen));
        filterRow.classList.toggle('is-open', filtersOpen);
      },
    });
    const syncFilterToggle = () => {
      const count = [filters.type, filters.categoryId, filters.accountId, filters.status, filters.allMonths].filter(Boolean).length;
      filterToggle.textContent = count ? `Filtros (${count})` : 'Filtros';
    };
    const selectToggle = el('button', {
      class: 'button button-small',
      type: 'button',
      onclick: () => {
        selecting = !selecting;
        selectToggle.textContent = selecting ? 'Cancelar seleção' : 'Selecionar';
        if (!selecting) selected.clear();
        renderList();
      },
    }, selecting ? 'Cancelar seleção' : 'Selecionar');

    const exportCsv = async () => {
      const list = currentList();
      if (!list.length) {
        FM.dom.toast('Não há lançamentos para exportar com esses filtros.');
        return;
      }
      const name = filters.allMonths ? 'todos' : ctx.month;
      if (await download(`sobra-lancamentos-${name}.csv`, q.toCsv(state, list), 'text/csv;charset=utf-8')) {
        FM.dom.toast(`${list.length} lançamentos exportados`);
      }
    };

    const filterRow = el(
      'div',
      { class: `filters${filtersOpen ? ' is-open' : ''}` },
      el('div', { class: 'search-box' }, icon('search'), search),
      el(
        'div',
        { class: 'phone-tools' },
        filterToggle,
        selectToggle,
        el('button', { class: 'button button-small', type: 'button', onclick: exportCsv }, 'Exportar'),
      ),
      selectControl('Tipo', filters.type, [
        { value: '', label: 'Todos' },
        { value: 'expense', label: 'Despesas' },
        { value: 'income', label: 'Receitas' },
        { value: 'transfer', label: 'Transferências' },
      ], update('type')),
      selectControl('Categoria', filters.categoryId, [
        { value: '', label: 'Todas' },
        { group: 'Despesas', items: expenseCats },
        { group: 'Receitas', items: incomeCats },
      ], update('categoryId')),
      selectControl('Carteira', filters.accountId, [
        { value: '', label: 'Todas' },
        ...state.accounts.map((a) => ({ value: a.id, label: a.name })),
      ], update('accountId')),
      selectControl('Situação', filters.status, [
        { value: '', label: 'Todas' },
        { value: 'paid', label: 'Pagas e recebidas' },
        { value: 'pending', label: 'Pendentes' },
        { value: 'overdue', label: 'Atrasadas' },
      ], update('status')),
      el(
        'label',
        { class: 'check-line filter-all' },
        el('input', {
          type: 'checkbox',
          checked: filters.allMonths,
          onchange: (event) => {
            filters.allMonths = event.target.checked;
            ctx.refresh();
          },
        }),
        el('span', {}, 'Todos os meses'),
      ),
    );

    function currentList() {
      return q.sortTransactions(state, q.filterTransactions(state, currentFilters(ctx), today), sort);
    }

    function renderBulk() {
      const count = selected.size;
      bulkBar.hidden = count === 0;
      if (!count) {
        bulkBar.replaceChildren();
        return;
      }
      const ids = () => [...selected];
      const finish = (message) => {
        selected.clear();
        ctx.notify(message);
      };
      bulkBar.replaceChildren(
        el('strong', {}, count === 1 ? '1 selecionado' : `${count} selecionados`),
        el('button', {
          class: 'button button-small',
          type: 'button',
          onclick: () => {
            const list = ids();
            store.setPaid(list, true);
            finish(list.length === 1 ? 'Marcado como pago' : `${list.length} marcados como pagos`);
          },
        }, 'Marcar como pago'),
        el('button', {
          class: 'button button-small',
          type: 'button',
          onclick: () => openBulkCategory(ctx, ids(), () => selected.clear()),
        }, 'Mudar categoria'),
        el('button', {
          class: 'button button-small button-ghost-danger',
          type: 'button',
          onclick: () => {
            const list = ids();
            selected.clear();
            store.deleteTransactions(list);
            ctx.notify(list.length === 1 ? 'Lançamento excluído' : `${list.length} lançamentos excluídos`);
          },
        }, icon('trash', 16), 'Excluir'),
        el('button', {
          class: 'link-button',
          type: 'button',
          onclick: () => {
            selected.clear();
            renderList();
          },
        }, 'Limpar seleção'),
      );
    }

    function sortHeader(label, by, extraClass = '') {
      const active = sort.by === by;
      return el(
        'th',
        { scope: 'col', class: extraClass, 'aria-sort': active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none' },
        el(
          'button',
          {
            class: 'sort-button',
            type: 'button',
            onclick: () => {
              sort = active ? { by, dir: sort.dir === 'asc' ? 'desc' : 'asc' } : { by, dir: by === 'title' ? 'asc' : 'desc' };
              renderList();
            },
          },
          label,
          active && icon(sort.dir === 'asc' ? 'up' : 'down', 14),
        ),
      );
    }

    function row(tx) {
      const category = q.categoryOf(state, tx.categoryId);
      return el(
        'tr',
        { class: selected.has(tx.id) ? 'is-selected' : '' },
        el('td', { class: 'cell-check' }, el('input', {
          type: 'checkbox',
          'aria-label': `Selecionar ${q.titleOf(state, tx)}`,
          checked: selected.has(tx.id),
          onchange: (event) => {
            if (event.target.checked) selected.add(tx.id);
            else selected.delete(tx.id);
            event.target.closest('tr').classList.toggle('is-selected', event.target.checked);
            renderBulk();
            syncSelectAll();
          },
        })),
        el('td', { class: 'cell-date' }, dates.dayLabel(tx.date)),
        el(
          'td',
          { class: 'cell-title' },
          el(
            'button',
            { class: 'row-title', type: 'button', dataset: { fk: `tx-${tx.id}` }, onclick: () => FM.txForm.open(ctx, { tx }) },
            el('span', { class: 'tx-title' }, q.titleOf(state, tx)),
            el('span', { class: 'tx-sub' }, common.categoryDot(category), el('span', { class: 'cell-date-mobile' }, `${dates.dayLabel(tx.date)}, `), common.subtitle(state, tx)),
          ),
        ),
        el('td', { class: 'cell-status' }, common.statusBadge(tx, today)),
        el('td', { class: `cell-amount tx-${tx.type}` }, common.amountText(tx)),
        el('td', { class: 'cell-paid' }, tx.type === 'transfer' ? el('i', { class: 'tx-mark' }, icon('swap', 16)) : common.paidButton(ctx, tx)),
      );
    }

    let selectAll = null;
    function syncSelectAll() {
      if (!selectAll) return;
      const ids = currentList().slice(0, visible).map((t) => t.id);
      const count = ids.filter((id) => selected.has(id)).length;
      selectAll.checked = count > 0 && count === ids.length;
      selectAll.indeterminate = count > 0 && count < ids.length;
    }

    function renderList() {
      const list = currentList();
      let income = 0;
      let expense = 0;
      for (const t of list) {
        if (t.type === 'income') income += t.amount;
        else if (t.type === 'expense') expense += t.amount;
      }
      const scope = filters.allMonths ? 'em todos os meses' : `em ${dates.monthName(ctx.month)}`;
      summaryLine.textContent = list.length
        ? `${list.length} ${list.length === 1 ? 'lançamento' : 'lançamentos'} ${scope}. Entrou ${money.format(income)} e saiu ${money.format(expense)}.`
        : '';

      syncFilterToggle();
      renderBulk();

      if (!list.length) {
        selectAll = null;
        listRegion.replaceChildren(
          anyFilter()
            ? common.emptyState('Nenhum lançamento com esses filtros', 'Tente outra busca ou limpe os filtros.', el('button', {
                class: 'button',
                type: 'button',
                onclick: () => {
                  Object.assign(filters, { q: '', type: '', categoryId: '', accountId: '', status: '' });
                  ctx.refresh();
                },
              }, 'Limpar filtros'), 'search')
            : common.emptyState(`Nenhum lançamento ${scope}`, 'Registre o primeiro para começar.', common.newButton(ctx), 'list'),
        );
        return;
      }

      const page = list.slice(0, visible);
      selectAll = el('input', {
        type: 'checkbox',
        'aria-label': 'Selecionar todos os lançamentos visíveis',
        onchange: (event) => {
          for (const t of page) {
            if (event.target.checked) selected.add(t.id);
            else selected.delete(t.id);
          }
          renderList();
        },
      });

      const body = el('tbody', {});
      let lastMonth = null;
      for (const tx of page) {
        const month = dates.monthOf(tx.date);
        if (sort.by === 'date' && filters.allMonths && month !== lastMonth) {
          body.append(el('tr', { class: 'group-row' }, el('th', { colSpan: 6, scope: 'colgroup' }, dates.monthLabel(month))));
          lastMonth = month;
        }
        body.append(row(tx));
      }

      listRegion.replaceChildren(
        el(
          'table',
          { class: `tx-table${selecting ? ' is-selecting' : ''}` },
          el('thead', {}, el(
            'tr',
            {},
            el('th', { class: 'cell-check', scope: 'col' }, selectAll),
            sortHeader('Data', 'date', 'cell-date'),
            sortHeader('Descrição', 'title', 'cell-title'),
            el('th', { class: 'cell-status', scope: 'col' }, el('span', { class: 'sr-only' }, 'Situação')),
            sortHeader('Valor', 'amount', 'cell-amount'),
            el('th', { class: 'cell-paid', scope: 'col' }, el('span', { class: 'sr-only' }, 'Pago')),
          )),
          body,
        ),
      );
      if (list.length > visible) {
        listRegion.append(el('div', { class: 'more' }, el('button', {
          class: 'button',
          type: 'button',
          onclick: () => {
            visible += PAGE;
            renderList();
          },
        }, `Mostrar mais ${Math.min(PAGE, list.length - visible)}`)));
      }
      syncSelectAll();
    }

    renderList();

    return el(
      'div',
      { class: 'view' },
      common.pageHead(filters.allMonths ? 'Lançamentos' : `Lançamentos de ${dates.monthName(ctx.month)}`, {
        monthNav: filters.allMonths ? null : common.monthNav(ctx),
        actions: [
          el('button', { class: 'button only-wide', type: 'button', onclick: exportCsv }, icon('download'), 'Exportar CSV'),
          common.newButton(ctx),
        ],
      }),
      filterRow,
      summaryLine,
      bulkBar,
      listRegion,
    );
  }

  function openBulkCategory(ctx, ids, done) {
    const { state } = ctx.store;
    const chosen = state.transactions.filter((t) => ids.includes(t.id) && t.type !== 'transfer');
    const kinds = [...new Set(chosen.map((t) => t.type))];
    if (!chosen.length) {
      FM.dom.toast('Transferências não têm categoria.');
      return;
    }
    if (kinds.length > 1) {
      FM.dom.toast('Selecione só despesas ou só receitas para mudar a categoria.');
      return;
    }
    const select = el('select', { class: 'input', 'data-autofocus': true }, state.categories
      .filter((c) => c.kind === kinds[0])
      .map((c) => el('option', { value: c.id }, c.name)));
    let handle = null;
    handle = openDialog({
      title: `Mudar a categoria de ${chosen.length === 1 ? '1 lançamento' : `${chosen.length} lançamentos`}`,
      body: FM.dom.field('Nova categoria', select),
      footer: [
        el('button', { class: 'button', type: 'button', onclick: () => handle.close() }, 'Cancelar'),
        el('button', {
          class: 'button button-primary',
          type: 'button',
          onclick: () => {
            handle.close();
            done();
            ctx.store.setCategory(chosen.map((t) => t.id), select.value);
            ctx.notify('Categoria alterada');
          },
        }, 'Mudar categoria'),
      ],
    });
  }

  FM.views = FM.views || {};
  FM.views.transactions = transactions;
  FM.views.focusSearch = () => document.getElementById('busca-lancamentos')?.focus();
})(globalThis);
