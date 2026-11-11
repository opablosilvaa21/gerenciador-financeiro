/** Carteiras, relatórios e ajustes. */
(function (root) {
  const FM = (root.FM = root.FM || {});
  const { el, icon, field, openDialog, confirmDialog, segmented, download, pickFile, toast } = FM.dom;
  const { money, dates, queries: q, charts, common, storeLib, demo } = FM;

  /* ---------- Carteiras ---------- */

  function openAccountForm(ctx, account = null) {
    const { store } = ctx;
    const nameInput = el('input', { class: 'input', type: 'text', maxLength: 40, value: account?.name ?? '', placeholder: 'Conta do banco, carteira...', 'data-autofocus': true });
    const typeSelect = el('select', { class: 'input' }, Object.entries(storeLib.ACCOUNT_TYPES).map(([value, label]) => el('option', { value, selected: value === account?.type }, label)));
    const initialInput = el('input', { class: 'input input-money', type: 'text', inputMode: 'decimal', placeholder: '0,00', value: account ? money.formatPlain(account.initial) : '' });
    const nameField = field('Nome', nameInput);
    const initialField = field('Saldo inicial', initialInput, { class: 'field-money', hint: 'Quanto havia nela antes do primeiro lançamento. Pode ser negativo.' });

    const submit = () => {
      if (!nameInput.value.trim()) {
        nameField.setError('Dê um nome para a carteira.');
        nameInput.focus();
        return;
      }
      nameField.setError(null);
      const parsed = initialInput.value.trim() ? money.parse(initialInput.value) : { cents: 0 };
      if (parsed.error) {
        initialField.setError(parsed.error);
        initialInput.focus();
        return;
      }
      handle.close();
      store.saveAccount(account?.id ?? null, { name: nameInput.value.trim(), type: typeSelect.value, initial: parsed.cents });
      ctx.notify(account ? 'Carteira alterada' : 'Carteira criada');
    };

    const handle = openDialog({
      title: account ? 'Editar carteira' : 'Nova carteira',
      body: el('form', { class: 'form', id: 'form-carteira', noValidate: true, onsubmit: (event) => { event.preventDefault(); submit(); } }, nameField, field('Tipo', typeSelect), initialField),
      footer: [
        account && el('button', {
          class: 'button button-ghost-danger push-left',
          type: 'button',
          onclick: () => {
            const reason = store.deleteAccount(account.id);
            if (reason) {
              initialField.setError(reason);
              return;
            }
            handle.close();
            ctx.notify('Carteira excluída');
          },
        }, icon('trash'), 'Excluir'),
        el('button', { class: 'button button-primary', type: 'submit', form: 'form-carteira' }, account ? 'Salvar alterações' : 'Criar carteira'),
      ],
    });
  }

  let accountChartFilter = '';

  function accounts(ctx) {
    const { store } = ctx;
    const { state } = store;
    const today = store.today();
    const month = dates.monthOf(today);
    const endOfMonth = dates.dateIn(month, 31);
    if (accountChartFilter && !q.accountOf(state, accountChartFilter)) accountChartFilter = '';

    const rows = state.accounts.map((account) => {
      const now = q.accountBalance(state, account.id);
      const forecast = q.accountBalance(state, account.id, { includePending: true, upTo: endOfMonth });
      return el(
        'li',
        { class: 'account' },
        el(
          'button',
          { class: 'rule-main', type: 'button', dataset: { fk: `carteira-${account.id}` }, onclick: () => openAccountForm(ctx, account) },
          el('span', { class: 'tx-title' }, account.name),
          el('span', { class: 'tx-sub' }, storeLib.ACCOUNT_TYPES[account.type] ?? 'Carteira'),
        ),
        el('div', { class: 'account-values' }, el('strong', {}, money.format(now)), now !== forecast && el('small', {}, `${money.format(forecast)} no fim do mês`)),
        el('button', { class: 'link-button', type: 'button', onclick: () => ctx.go('lancamentos', { carteira: account.id }) }, 'Ver lançamentos'),
      );
    });

    const series = q.balanceSeries(state, month, 12, today, accountChartFilter || null);
    const line = charts.balanceChart(series);

    return el(
      'div',
      { class: 'view' },
      common.pageHead('Carteiras', {
        actions: [
          state.accounts.length > 1 && el('button', {
            class: 'button',
            type: 'button',
            dataset: { fk: 'transferir' },
            onclick: () => FM.txForm.open(ctx, { preset: { type: 'transfer', date: today } }),
          }, icon('swap'), 'Transferir'),
          el('button', { class: 'button button-primary', type: 'button', dataset: { fk: 'nova-carteira' }, onclick: () => openAccountForm(ctx) }, icon('plus'), 'Nova carteira'),
        ],
      }),
      el('p', { class: 'total-line' }, 'Somando tudo, você tem ', el('strong', { dataset: { count: q.totalBalance(state) } }, money.format(q.totalBalance(state))), ' hoje.'),
      el('ul', { class: 'account-list card' }, rows),
      el(
        'div',
        { class: 'chart-filter' },
        el(
          'label',
          { class: 'filter' },
          el('span', { class: 'filter-label' }, 'Mostrar saldo de'),
          el('select', {
            class: 'input input-compact',
            onchange: (event) => {
              accountChartFilter = event.target.value;
              ctx.refresh();
            },
          },
            el('option', { value: '', selected: !accountChartFilter }, 'Todas as carteiras'),
            state.accounts.map((a) => el('option', { value: a.id, selected: a.id === accountChartFilter }, a.name)),
          ),
        ),
      ),
      charts.frame({
        title: 'Saldo mês a mês',
        description: 'Valor no fim de cada mês; no mês atual, o saldo de hoje.',
        chart: line.chart,
        columns: line.columns,
        rows: line.rows,
      }),
    );
  }

  /* ---------- Relatórios ---------- */

  let reportRange = 6;

  function reports(ctx) {
    const { store } = ctx;
    const { state } = store;
    const today = store.today();
    const month = dates.monthOf(today);
    const months = dates.monthRange(month, reportRange);

    const flow = q.cashflow(state, month, reportRange);
    const income = flow.reduce((sum, d) => sum + d.income, 0);
    const expense = flow.reduce((sum, d) => sum + d.expense, 0);
    const left = income - expense;
    const rate = income > 0 ? Math.round((left / income) * 100) : null;
    const ranking = q.categoryRanking(state, months);
    const balance = q.balanceSeries(state, month, reportRange, today);
    const flowChart = charts.cashflowChart(flow, { selected: month, onSelect: (m) => { ctx.setMonth(m, { silent: true }); ctx.go('inicio'); } });
    const rankChart = charts.rankingChart(ranking, { onSelect: (id) => ctx.go('lancamentos', { mes: 'todos', categoria: id }) });
    const balanceChart = charts.balanceChart(balance);
    const insights = q.insights(state, month, today);
    const hasData = income > 0 || expense > 0;

    return el(
      'div',
      { class: 'view' },
      common.pageHead('Relatórios', {
        actions: segmented('periodo', 'Período', [
          { value: '3', label: '3 meses' },
          { value: '6', label: '6 meses' },
          { value: '12', label: '12 meses' },
        ], String(reportRange), (value) => {
          reportRange = Number(value);
          ctx.refresh();
        }),
      }),
      !hasData
        ? common.emptyState('Ainda não há o que comparar', 'Os relatórios aparecem assim que houver lançamentos no período.', common.newButton(ctx), 'chart')
        : [
            el(
              'dl',
              { class: 'stats stats-row' },
              common.stat('Entrou', income),
              common.stat('Saiu', expense),
              common.stat(left < 0 ? 'Faltou' : 'Sobrou', Math.abs(left), rate != null ? `${rate}% do que entrou` : null),
              common.stat('Média de gasto por mês', Math.round(expense / reportRange)),
            ),
            insights.length > 0 && el(
              'section',
              { class: 'band card' },
              el('div', { class: 'band-head' }, el('h2', {}, `Sobre ${dates.monthName(month)}`)),
              el('ul', { class: 'insights' }, insights.map((item) => el('li', { class: `insight insight-${item.tone}` }, item.text))),
            ),
            charts.frame({ title: 'Entradas e saídas', description: 'Escolha um mês para abrir.', chart: flowChart.chart, legend: flowChart.legend, columns: flowChart.columns, rows: flowChart.rows }),
            ranking.length > 0 && charts.frame({ title: 'Gastos por categoria', description: 'Escolha uma categoria para ver os lançamentos.', chart: rankChart.chart, columns: rankChart.columns, rows: rankChart.rows }),
            charts.frame({ title: 'Saldo', description: 'Somando todas as carteiras.', chart: balanceChart.chart, columns: balanceChart.columns, rows: balanceChart.rows }),
          ],
    );
  }

  /* ---------- Ajustes ---------- */

  function openCategoryForm(ctx, category = null, kind = 'expense') {
    const { store } = ctx;
    const nameInput = el('input', { class: 'input', type: 'text', maxLength: 30, value: category?.name ?? '', 'data-autofocus': true });
    const nameField = field('Nome da categoria', nameInput);
    const submit = () => {
      const name = nameInput.value.trim();
      if (!name) {
        nameField.setError('Dê um nome para a categoria.');
        nameInput.focus();
        return;
      }
      const duplicate = store.state.categories.some((c) => c.id !== category?.id && c.kind === (category?.kind ?? kind) && q.normalize(c.name) === q.normalize(name));
      if (duplicate) {
        nameField.setError('Já existe uma categoria com esse nome.');
        nameInput.focus();
        return;
      }
      handle.close();
      store.saveCategory(category?.id ?? null, category ? { name } : { name, kind });
      ctx.notify(category ? 'Categoria alterada' : 'Categoria criada');
    };

    const removeButton = category && el('button', {
      class: 'button button-ghost-danger push-left',
      type: 'button',
      onclick: () => {
        const others = store.state.categories.filter((c) => c.kind === category.kind && c.id !== category.id);
        if (!others.length) {
          nameField.setError('É preciso ter pelo menos uma categoria deste tipo.');
          return;
        }
        const used = store.state.transactions.filter((t) => t.categoryId === category.id).length;
        const replacement = others[others.length - 1];
        handle.close();
        const finish = () => {
          store.deleteCategory(category.id, replacement.id);
          ctx.notify('Categoria excluída');
        };
        if (!used) {
          finish();
          return;
        }
        confirmDialog({
          title: `Excluir ${category.name}?`,
          description: `${used === 1 ? '1 lançamento vai' : `${used} lançamentos vão`} para ${replacement.name}.`,
          confirmLabel: 'Excluir categoria',
          danger: true,
          onConfirm: finish,
        });
      },
    }, icon('trash'), 'Excluir');

    const handle = openDialog({
      title: category ? 'Editar categoria' : kind === 'expense' ? 'Nova categoria de despesa' : 'Nova categoria de receita',
      body: el('form', { class: 'form', id: 'form-categoria', noValidate: true, onsubmit: (event) => { event.preventDefault(); submit(); } }, nameField),
      footer: [removeButton, el('button', { class: 'button button-primary', type: 'submit', form: 'form-categoria' }, category ? 'Salvar alterações' : 'Criar categoria')],
    });
  }

  function categoryList(ctx, kind, title) {
    const { state } = ctx.store;
    return el(
      'div',
      { class: 'category-group' },
      el('h3', {}, title),
      el(
        'ul',
        { class: 'category-list' },
        state.categories.filter((c) => c.kind === kind).map((c) =>
          el('li', {}, el('button', { class: 'chip-button', type: 'button', dataset: { fk: `cat-${c.id}` }, onclick: () => openCategoryForm(ctx, c) }, common.categoryDot(c), c.name)),
        ),
        el('li', {}, el('button', { class: 'chip-button chip-add', type: 'button', dataset: { fk: `nova-cat-${kind}` }, onclick: () => openCategoryForm(ctx, null, kind) }, icon('plus', 14), 'Nova')),
      ),
    );
  }

  /** Importação de extrato: mostra o que vai entrar antes de gravar. */
  function openStatementImport(ctx, text, filename) {
    const { store } = ctx;
    const { state } = store;
    const { rows, errors } = q.parseStatementCsv(text);
    if (!rows.length) {
      toast(errors[0] || 'Nenhuma linha válida no arquivo.', { tone: 'error' });
      return;
    }
    const known = new Set(state.transactions.map((t) => `${t.date}|${t.amount}|${t.type}|${q.normalize(t.desc)}`));
    const fresh = rows.filter((r) => !known.has(`${r.date}|${r.amount}|${r.type}|${q.normalize(r.desc)}`));
    const duplicates = rows.length - fresh.length;

    const accountSelect = el('select', { class: 'input', 'data-autofocus': true }, state.accounts.map((a) => el('option', { value: a.id }, a.name)));
    const fallback = {
      expense: state.categories.filter((c) => c.kind === 'expense').slice(-1)[0],
      income: state.categories.filter((c) => c.kind === 'income').slice(-1)[0],
    };

    const handle = openDialog({
      title: `Importar ${filename}`,
      wide: true,
      body: el(
        'div',
        { class: 'form' },
        el('p', {}, `${fresh.length} ${fresh.length === 1 ? 'lançamento novo' : 'lançamentos novos'}.`, duplicates ? ` ${duplicates} já ${duplicates === 1 ? 'existia e fica' : 'existiam e ficam'} de fora.` : ''),
        errors.length > 0 && el('details', { class: 'import-errors' }, el('summary', {}, `${errors.length} ${errors.length === 1 ? 'linha ignorada' : 'linhas ignoradas'}`), el('ul', {}, errors.slice(0, 20).map((e) => el('li', {}, e)))),
        field('Importar para a carteira', accountSelect),
        el('p', { class: 'field-hint' }, `Sem histórico da descrição, a categoria será ${fallback.expense.name} ou ${fallback.income.name}. Dá para mudar depois, em lote.`),
        el(
          'div',
          { class: 'table-scroll table-preview' },
          el(
            'table',
            { class: 'data-table' },
            el('thead', {}, el('tr', {}, el('th', {}, 'Data'), el('th', {}, 'Descrição'), el('th', { class: 'num' }, 'Valor'))),
            el('tbody', {}, fresh.slice(0, 8).map((r) => el('tr', {}, el('td', {}, dates.dayLabel(r.date)), el('td', {}, r.desc), el('td', { class: 'num' }, common.amountText(r))))),
          ),
        ),
      ),
      footer: el('button', {
        class: 'button button-primary',
        type: 'button',
        disabled: !fresh.length,
        onclick: () => {
          const accountId = accountSelect.value;
          const today = store.today();
          handle.close();
          const count = store.importTransactions(fresh.map((r) => ({
            ...r,
            accountId,
            categoryId: q.suggestCategory(state, r.desc, r.type) || fallback[r.type].id,
            paid: r.date <= today,
          })));
          ctx.notify(`${count} lançamentos importados`);
        },
      }, `Importar ${fresh.length}`),
    });
  }

  function restoreBackup(ctx, text) {
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      toast('Este arquivo não é um JSON válido.', { tone: 'error' });
      return;
    }
    const problems = storeLib.validateState(data);
    if (problems.length) {
      toast(`Não dá para restaurar: ${problems[0]}`, { tone: 'error' });
      return;
    }
    confirmDialog({
      title: 'Substituir tudo por este backup?',
      description: `O backup tem ${data.transactions.length} lançamentos. Os dados atuais serão trocados por ele.`,
      confirmLabel: 'Restaurar backup',
      danger: true,
      onConfirm: () => {
        ctx.store.replace('Backup restaurado', { ...data, onboarded: true });
        ctx.notify('Backup restaurado');
      },
    });
  }

  function settings(ctx) {
    const { store } = ctx;
    const { state } = store;

    const eraseAll = () => {
      const input = el('input', { class: 'input', type: 'text', autocomplete: 'off', 'data-autofocus': true });
      const box = field('Escreva APAGAR para confirmar', input);
      const submit = () => {
        if (input.value.trim().toUpperCase() !== 'APAGAR') {
          box.setError('Escreva APAGAR, em uma palavra, para confirmar.');
          input.focus();
          return;
        }
        handle.close();
        store.replace('Dados apagados', storeLib.emptyState());
        ctx.notify('Dados apagados');
      };
      const handle = openDialog({
        title: 'Apagar todos os dados?',
        description: 'Lançamentos, carteiras, orçamentos e metas saem deste navegador. Baixe um backup antes, se quiser guardar.',
        body: el('form', { class: 'form', id: 'form-apagar', noValidate: true, onsubmit: (event) => { event.preventDefault(); submit(); } }, box),
        footer: el('button', { class: 'button button-danger', type: 'submit', form: 'form-apagar' }, 'Apagar tudo'),
      });
    };

    return el(
      'div',
      { class: 'view view-settings' },
      common.pageHead('Ajustes'),
      el(
        'section',
        { class: 'band card' },
        el('div', { class: 'band-head' }, el('h2', {}, 'Aparência')),
        segmented('tema', 'Tema', [
          { value: 'dark', label: 'Escuro' },
          { value: 'light', label: 'Claro' },
        ], state.theme === 'light' ? 'light' : 'dark', (value) => store.setTheme(value)),
      ),
      el(
        'section',
        { class: 'band card' },
        el('div', { class: 'band-head' }, el('h2', {}, 'Categorias')),
        categoryList(ctx, 'expense', 'Despesas'),
        categoryList(ctx, 'income', 'Receitas'),
        el('p', { class: 'field-hint' }, 'Os gráficos têm 8 cores, uma por categoria de despesa. Categorias além disso aparecem em sálvia.'),
      ),
      el(
        'section',
        { class: 'band card' },
        el(
          'div',
          { class: 'band-head' },
          el('h2', {}, 'Seus dados'),
          el('p', { class: 'chart-sub' }, 'Tudo fica só neste navegador, neste aparelho. Nada é enviado para a internet. Limpar os dados do navegador apaga o Sobra, então baixe um backup de vez em quando.'),
        ),
        el(
          'div',
          { class: 'action-list' },
          el('button', {
            class: 'button',
            type: 'button',
            onclick: async () => {
              if (await download(`sobra-backup-${store.today()}.json`, JSON.stringify(state, null, 2), 'application/json')) toast('Backup baixado');
            },
          }, icon('download'), 'Baixar backup'),
          el('button', { class: 'button', type: 'button', onclick: () => pickFile('.json,application/json', (text) => restoreBackup(ctx, text)) }, icon('upload'), 'Restaurar backup'),
          el('button', { class: 'button', type: 'button', onclick: () => pickFile('.csv,text/csv', (text, name) => openStatementImport(ctx, text, name)) }, icon('upload'), 'Importar extrato em CSV'),
        ),
        el('p', { class: 'field-hint' }, 'O CSV precisa de colunas de data, descrição e valor. Valor negativo vira despesa e positivo vira receita. Linhas iguais às que já existem ficam de fora.'),
      ),
      FM.pwa.canOffer() && el(
        'section',
        { class: 'band card' },
        el(
          'div',
          { class: 'band-head' },
          el('h2', {}, 'Instalar como aplicativo'),
          el('p', { class: 'chart-sub' }, 'O Sobra ganha um ícone na tela inicial, abre em tela cheia e funciona sem internet. Os dados do aplicativo podem ficar separados dos deste navegador: se já tiver lançamentos aqui, baixe um backup e restaure depois de instalar.'),
        ),
        el('div', { class: 'action-list' }, el('button', { class: 'button', type: 'button', onclick: () => FM.pwa.install() }, icon('download'), 'Instalar o Sobra')),
      ),
      el(
        'section',
        { class: 'band card band-shortcuts' },
        el('div', { class: 'band-head' }, el('h2', {}, 'Atalhos de teclado')),
        el(
          'dl',
          { class: 'shortcuts' },
          [['N', 'Novo lançamento'], ['/', 'Buscar lançamentos'], ['← →', 'Mudar de mês'], ['Ctrl + Z', 'Desfazer']].map(([key, text]) =>
            el('div', {}, el('dt', {}, el('kbd', {}, key)), el('dd', {}, text)),
          ),
        ),
      ),
      el(
        'section',
        { class: 'band card band-danger' },
        el('div', { class: 'band-head' }, el('h2', {}, 'Recomeçar')),
        el(
          'div',
          { class: 'action-list' },
          el('button', {
            class: 'button',
            type: 'button',
            onclick: () => {
              confirmDialog({
                title: 'Trocar tudo pelos dados de exemplo?',
                description: 'Os dados atuais serão substituídos por lançamentos fictícios.',
                confirmLabel: 'Usar dados de exemplo',
                onConfirm: () => {
                  store.replace('Dados de exemplo', demo.buildDemoState(store.today()));
                  ctx.notify('Dados de exemplo carregados');
                },
              });
            },
          }, 'Usar dados de exemplo'),
          el('button', { class: 'button button-ghost-danger', type: 'button', onclick: eraseAll }, icon('trash'), 'Apagar todos os dados'),
        ),
      ),
    );
  }

  FM.views = FM.views || {};
  Object.assign(FM.views, { accounts, reports, settings });
})(globalThis);
