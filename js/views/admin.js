/**
 * Painel de instalações, em #/admin/instalacoes. Não aparece no menu.
 * A proteção de verdade está no banco: sem login de administrador, o Supabase não devolve nenhum número.
 * Esta tela só mostra o formulário de entrada e desenha o que o banco responde.
 */
(function (root) {
  const FM = (root.FM = root.FM || {});
  const { el, icon, field, skeleton } = FM.dom;
  const { dates, charts, common } = FM;

  const CACHE_MS = 60000;
  /** status: 'idle' | 'loading' | 'login' | 'ready' | 'denied' | 'error' | 'off' */
  const state = { status: 'idle', data: null, loadedAt: 0, loginError: null, signingIn: false };
  let refreshView = () => {};

  const number = (value) => Number(value || 0).toLocaleString('pt-BR');
  const set = (changes) => {
    Object.assign(state, changes);
    refreshView();
  };

  async function load({ force = false } = {}) {
    if (!FM.backend.configured()) return set({ status: 'off' });
    if (!FM.backend.hasSession()) return set({ status: 'login' });
    if (!force && state.data && Date.now() - state.loadedAt < CACHE_MS) return set({ status: 'ready' });
    set({ status: 'loading' });
    const result = await FM.backend.rpcAsUser('install_stats', { p_days: 30 });
    if (result.ok && result.data) {
      set({ status: 'ready', data: result.data, loadedAt: Date.now() });
      // Os números chegaram agora: contam e os gráficos crescem, como ao abrir qualquer tela.
      FM.motion.enter(root.document.querySelector('.view-admin'));
      return undefined;
    }
    if (result.status === 401) return set({ status: 'login', loginError: 'Sua sessão venceu. Entre de novo.' });
    if (result.status === 403) return set({ status: 'denied' });
    return set({ status: 'error' });
  }

  async function signOut() {
    await FM.backend.signOut();
    set({ status: 'login', data: null, loadedAt: 0, loginError: null });
  }

  /* ---------- Partes da tela ---------- */

  function countStat(label, value, note = null) {
    return el(
      'div',
      { class: 'stat card' },
      el('dt', {}, label),
      el('dd', {}, el('strong', { dataset: { count: value, countFormat: 'int' } }, number(value)), note && el('small', {}, note)),
    );
  }

  /** Barras horizontais com o número e a fatia ao lado: não dependem de passar o mouse. */
  function breakdown(title, items, total, emptyText) {
    const max = Math.max(...items.map((item) => item.count), 1);
    return el(
      'section',
      { class: 'chart card' },
      el('header', { class: 'chart-head' }, el('h2', {}, title)),
      items.length
        ? el(
            'ul',
            { class: 'ranking' },
            items.map((item, index) =>
              el(
                'li',
                { class: 'ranking-line', style: { '--d': String(index) } },
                el('span', { class: 'ranking-name' }, item.label),
                el('span', { class: 'ranking-track' }, el('span', { class: 'ranking-bar ranking-bar-accent', style: { width: `${Math.max((item.count / max) * 100, 1)}%` } })),
                el('span', { class: 'ranking-value' }, el('strong', {}, number(item.count)), el('small', {}, `${total ? Math.round((item.count / total) * 100) : 0}% dos aparelhos`)),
              ),
            ),
          )
        : el('p', { class: 'muted' }, emptyText),
    );
  }

  function recentTable(rows) {
    const when = (iso) => {
      const day = dates.today(new Date(iso));
      return dates.relativeLabel(day, dates.today());
    };
    return el(
      'section',
      { class: 'chart card' },
      el('header', { class: 'chart-head' }, el('div', {}, el('h2', {}, 'Vistos por último'), el('p', { class: 'chart-sub' }, 'Os 20 aparelhos que abriram o app mais recentemente.'))),
      el(
        'div',
        { class: 'table-scroll' },
        el(
          'table',
          { class: 'data-table' },
          el('thead', {}, el('tr', {}, ['Aparelho', 'Sistema', 'Navegador', 'Como abre', 'Versão do app', 'Primeira vez', 'Última vez'].map((title) => el('th', { scope: 'col' }, title)))),
          el('tbody', {}, rows.map((row) =>
            el(
              'tr',
              {},
              el('th', { scope: 'row' }, row.device_model || 'Não informado'),
              el('td', {}, [row.os, row.os_version].filter(Boolean).join(' ')),
              el('td', {}, row.browser || 'Não informado'),
              el('td', {}, row.is_standalone ? 'App instalado' : 'Navegador'),
              el('td', {}, row.app_version || ''),
              el('td', {}, when(row.first_seen)),
              el('td', {}, when(row.last_seen)),
            ))),
        ),
      ),
    );
  }

  function dashboard(data) {
    const total = data.total || 0;
    const share = (value) => (total ? `${Math.round((value / total) * 100)}% do total` : null);
    const daily = (data.daily || []).map((d) => ({ key: d.day, label: dates.fullLabel(d.day), short: `${d.day.slice(8, 10)}/${d.day.slice(5, 7)}`, value: d.count }));
    const newInPeriod = daily.reduce((sum, d) => sum + d.value, 0);
    const columns = charts.countChart(daily, { ariaLabel: 'Novas instalações por dia', one: 'aparelho novo', many: 'aparelhos novos' });

    if (!total) {
      return common.emptyState(
        'Nenhum aparelho registrado ainda',
        'Assim que alguém abrir o app publicado e aceitar o aviso de privacidade, o aparelho aparece aqui.',
        null,
        'phone',
      );
    }
    return [
      el(
        'dl',
        { class: 'stats stats-row' },
        countStat('Total de aparelhos', total, data.new_7d ? `${number(data.new_7d)} ${data.new_7d === 1 ? 'novo' : 'novos'} nos últimos 7 dias` : null),
        countStat('Ativos em 7 dias', data.active_7d, share(data.active_7d)),
        countStat('Ativos em 30 dias', data.active_30d, share(data.active_30d)),
        countStat('Instalados como app', data.standalone, share(data.standalone)),
      ),
      charts.frame({
        title: 'Novas instalações por dia',
        description: `${number(newInPeriod)} ${newInPeriod === 1 ? 'aparelho novo' : 'aparelhos novos'} nos últimos ${data.days || daily.length} dias.`,
        chart: columns.chart,
        columns: columns.columns,
        rows: columns.rows,
      }),
      el(
        'div',
        { class: 'columns' },
        breakdown('Por sistema', data.by_os || [], total, 'Sem dados ainda.'),
        breakdown('Por navegador', data.by_browser || [], total, 'Sem dados ainda.'),
        breakdown('Por modelo', data.by_model || [], total, 'Sem dados ainda.'),
        breakdown('Por versão do app', data.by_app_version || [], total, 'Sem dados ainda.'),
      ),
      recentTable(data.recent || []),
    ];
  }

  function loginForm() {
    const emailInput = el('input', { class: 'input', type: 'email', autocomplete: 'username', inputMode: 'email', required: true, 'data-autofocus': true });
    const passwordInput = el('input', { class: 'input', type: 'password', autocomplete: 'current-password', required: true });
    const emailField = field('E-mail', emailInput);
    const passwordField = field('Senha', passwordInput);
    if (state.loginError) passwordField.setError(state.loginError);
    const button = el('button', { class: 'button button-primary', type: 'submit', disabled: state.signingIn }, state.signingIn ? 'Entrando...' : 'Entrar');

    return el(
      'section',
      { class: 'band card admin-login' },
      el(
        'div',
        { class: 'band-head' },
        el('h2', {}, 'Área restrita'),
        el('p', { class: 'chart-sub' }, 'Entre com a conta de administrador para ver quantos aparelhos usam o Sobra. Seus lançamentos não têm relação com esta conta e continuam só neste aparelho.'),
      ),
      el(
        'form',
        {
          class: 'form',
          noValidate: true,
          onsubmit: async (event) => {
            event.preventDefault();
            if (state.signingIn) return;
            if (!emailInput.value.trim() || !passwordInput.value) {
              passwordField.setError('Informe o e-mail e a senha.');
              return;
            }
            button.disabled = true;
            button.textContent = 'Entrando...';
            state.signingIn = true;
            const result = await FM.backend.signIn(emailInput.value.trim(), passwordInput.value);
            state.signingIn = false;
            if (!result.ok) {
              set({ status: 'login', loginError: result.status === 0 ? 'Sem conexão com o servidor. Tente de novo.' : 'E-mail ou senha incorretos.' });
              return;
            }
            state.loginError = null;
            load({ force: true });
          },
        },
        emailField,
        passwordField,
        el('div', { class: 'action-list' }, button),
      ),
    );
  }

  function body() {
    switch (state.status) {
      case 'off':
        return common.emptyState('Contagem desligada', 'Falta informar o endereço e a chave pública do Supabase em js/config.js. Sem isso, o app não envia nem lê nada.', null, 'shield');
      case 'login':
        return loginForm();
      case 'denied':
        return common.emptyState(
          'Esta conta não tem acesso',
          'O painel só abre para a conta de administrador cadastrada no banco.',
          el('button', { class: 'button', type: 'button', onclick: signOut }, 'Sair e entrar com outra conta'),
          'shield',
        );
      case 'error':
        return common.emptyState(
          'Não deu para carregar os números',
          'O servidor não respondeu. Confira a conexão e tente de novo.',
          el('button', { class: 'button button-primary', type: 'button', onclick: () => load({ force: true }) }, 'Tentar de novo'),
          'alert',
        );
      case 'ready':
        return dashboard(state.data);
      default:
        return skeleton('Carregando as instalações');
    }
  }

  function adminInstalls(ctx) {
    refreshView = () => {
      if (root.location.hash.startsWith('#/admin/instalacoes')) ctx.refresh();
    };
    // O que não depende do servidor é decidido já, sem passar pelo esqueleto de carregamento.
    if (!FM.backend.configured()) state.status = 'off';
    else if (state.status === 'off' || (state.status === 'idle' && !FM.backend.hasSession())) state.status = 'login';
    const stale = state.status === 'ready' && Date.now() - state.loadedAt > CACHE_MS;
    if (state.status === 'idle' || stale) setTimeout(() => load(), 0);
    const signedIn = state.status === 'ready' || state.status === 'loading';

    return el(
      'div',
      { class: 'view view-admin' },
      common.pageHead('Instalações', {
        actions: signedIn && [
          el('button', { class: 'button', type: 'button', disabled: state.status === 'loading', dataset: { fk: 'admin-atualizar' }, onclick: () => load({ force: true }) }, icon('repeat'), 'Atualizar'),
          el('button', { class: 'button', type: 'button', dataset: { fk: 'admin-sair' }, onclick: signOut }, 'Sair'),
        ],
        intro: 'Quantos aparelhos usam o Sobra e quais. Só dados técnicos anônimos: nenhum lançamento, saldo ou dado pessoal chega aqui.',
      }),
      body(),
    );
  }

  FM.views = FM.views || {};
  FM.views.adminInstalls = adminInstalls;
})(globalThis);
