/** Liga tudo: rotas, tema, teclado e a primeira visita. */
(function (root) {
  const FM = root.FM;
  const { el, toast, tip } = FM.dom;
  const { dates, money, storeLib, demo, common } = FM;

  const ROUTES = [
    { key: 'inicio', label: 'Início', view: 'home', icon: 'home', tab: true },
    { key: 'lancamentos', label: 'Lançamentos', view: 'transactions', icon: 'list', tab: true },
    { key: 'carteiras', label: 'Carteiras', view: 'accounts', icon: 'wallet' },
    { key: 'orcamentos', label: 'Orçamentos', view: 'budgets', icon: 'pie', tab: true },
    { key: 'fixas', label: 'Contas fixas', view: 'recurring', icon: 'repeat' },
    { key: 'metas', label: 'Metas', view: 'goals', icon: 'target' },
    { key: 'relatorios', label: 'Relatórios', view: 'reports', icon: 'chart' },
    { key: 'ajustes', label: 'Ajustes', view: 'settings', icon: 'sliders' },
    // Fora do menu: só chega aqui quem conhece o endereço, e os números só saem do banco com login de administrador.
    { key: 'admin/instalacoes', label: 'Instalações', view: 'adminInstalls', icon: 'chart', hidden: true },
  ];

  let storage = null;
  try {
    storage = root.localStorage;
  } catch {
    storage = null;
  }
  const store = storeLib.createStore({ storage });
  store.load();

  const main = document.getElementById('main');
  const nav = document.getElementById('nav');
  const tabbar = document.getElementById('tabbar');
  const banners = document.getElementById('banners');
  const barColor = document.querySelector('meta[name="theme-color"]');

  const ctx = {
    store,
    month: dates.monthOf(store.today()),
    params: {},

    setMonth(month, { silent = false } = {}) {
      ctx.month = month;
      if (!silent) render({ keepFocus: true });
    },
    go(route, params = {}) {
      const query = new URLSearchParams(params).toString();
      const hash = `#/${route}${query ? `?${query}` : ''}`;
      if (location.hash === hash) render({ fromRoute: true });
      else location.hash = hash;
    },
    /** Os filtros vindos do link já foram aplicados: limpa o endereço sem recarregar a tela. */
    clearParams() {
      ctx.params = {};
      history.replaceState(null, '', `#/${currentRoute().key}`);
    },
    refresh() {
      render({ keepFocus: true });
    },
    /** Aviso de que algo mudou, sempre com a opção de desfazer. */
    notify(message) {
      toast(message, {
        undo: () => {
          store.undo();
          toast('Desfeito');
        },
      });
    },
  };

  function parseHash() {
    const raw = location.hash.replace(/^#\/?/, '');
    const [key, query] = raw.split('?');
    return { key, params: Object.fromEntries(new URLSearchParams(query || '')) };
  }

  function currentRoute() {
    const { key } = parseHash();
    return ROUTES.find((r) => r.key === key) || ROUTES[0];
  }

  function applyTheme() {
    // O claro (névoa) é o padrão; o escuro (floresta) só entra quando a pessoa escolhe.
    document.documentElement.dataset.theme = store.state.theme === 'dark' ? 'dark' : 'light';
    barColor.content = getComputedStyle(document.documentElement).getPropertyValue('--paper').trim();
  }

  function renderNav(route) {
    nav.replaceChildren(
      ...ROUTES.filter((r) => !r.hidden).map((r) =>
        el('a', { href: `#/${r.key}`, class: 'nav-link', 'aria-current': r.key === route.key ? 'page' : null }, FM.dom.icon(r.icon, 18), el('span', {}, r.label)),
      ),
    );
    renderTabbar(route);
  }

  /** No celular, as telas mais usadas ficam em abas ao alcance do polegar; as outras, em "Mais". */
  function renderTabbar(route) {
    if (tabbar.dataset.route === route.key) return;
    tabbar.dataset.route = route.key;
    const tab = (r) =>
      el('a', {
        href: `#/${r.key}`,
        class: 'tab',
        'aria-current': r.key === route.key ? 'page' : null,
        onclick: () => {
          if (currentRoute().key === r.key) window.scrollTo({ top: 0, behavior: 'smooth' });
        },
      }, FM.dom.icon(r.icon, 22), el('span', {}, r.label));
    const [first, second, third] = ROUTES.filter((r) => r.tab);
    tabbar.replaceChildren(
      tab(first),
      tab(second),
      el('button', {
        class: 'tab tab-new',
        type: 'button',
        'aria-label': 'Novo lançamento',
        onclick: () => FM.txForm.open(ctx, { preset: { date: common.defaultDate(ctx) } }),
      }, el('span', { class: 'tab-new-mark' }, FM.dom.icon('plus', 24))),
      tab(third),
      el('button', {
        class: 'tab',
        type: 'button',
        'aria-haspopup': 'dialog',
        'aria-current': route.tab ? null : 'true',
        onclick: openMore,
      }, FM.dom.icon('grid', 22), el('span', {}, 'Mais')),
    );
  }

  function openMore() {
    const current = currentRoute().key;
    const handle = FM.dom.openDialog({
      title: 'Mais',
      body: el(
        'ul',
        { class: 'more-list' },
        ROUTES.filter((r) => !r.tab && !r.hidden).map((r) =>
          el('li', {}, el('a', {
            href: `#/${r.key}`,
            class: 'more-link',
            'aria-current': r.key === current ? 'page' : null,
            onclick: () => handle.close(),
          }, FM.dom.icon(r.icon, 22), r.label)),
        ),
      ),
    });
  }

  function privacyDetails() {
    FM.dom.openDialog({
      title: 'O que o Sobra envia',
      body: el(
        'div',
        { class: 'form' },
        el('p', {}, 'Para saber quantos aparelhos usam o app, o Sobra envia uma vez por dia:'),
        el(
          'ul',
          { class: 'plain-list' },
          ['um identificador aleatório criado neste aparelho', 'sistema e versão (por exemplo, Android 15)', 'navegador e, quando o aparelho informa, o modelo', 'tamanho da tela, versão do app e se ele está instalado'].map((item) => el('li', {}, item)),
        ),
        el('p', {}, 'Nunca são enviados lançamentos, saldos, categorias, nome, e-mail, localização nem endereço IP. Seus dados financeiros continuam só neste aparelho.'),
        el('p', { class: 'field-hint' }, 'Você pode mudar essa escolha quando quiser, em Ajustes.'),
      ),
    });
  }

  function renderBanners() {
    banners.replaceChildren();
    if (FM.telemetry.needsNotice()) {
      banners.append(el(
        'div',
        { class: 'banner banner-privacy', role: 'region', 'aria-label': 'Aviso de privacidade' },
        el('span', {}, 'O Sobra conta quantos aparelhos usam o app. Para isso envia dados técnicos anônimos do aparelho (sistema, navegador e modelo). Nenhum dado financeiro ou pessoal sai daqui.'),
        el('button', { class: 'button button-small button-primary', type: 'button', onclick: () => FM.telemetry.accept() }, 'Tudo bem'),
        el('button', { class: 'button button-small', type: 'button', onclick: () => FM.telemetry.refuse() }, 'Recusar'),
        el('button', { class: 'link-button', type: 'button', onclick: privacyDetails }, 'O que é enviado'),
      ));
    }
    if (store.state.onboarded && FM.pwa.showOffer()) {
      banners.append(el(
        'div',
        { class: 'banner' },
        el('span', {}, 'Instale o Sobra na tela inicial para abrir como aplicativo, até sem internet.'),
        el('button', { class: 'link-button', type: 'button', onclick: () => FM.pwa.install() }, 'Instalar'),
        el('button', { class: 'link-button', type: 'button', onclick: () => FM.pwa.dismissOffer() }, 'Agora não'),
      ));
    }
    if (store.saveFailed) {
      banners.append(el('div', { class: 'banner banner-error', role: 'alert' }, 'O navegador não está gravando os dados, e eles podem se perder ao fechar. Em Ajustes, baixe um backup e confira se o armazenamento do navegador não está cheio ou bloqueado.'));
    }
    if (store.state.demo) {
      banners.append(el(
        'div',
        { class: 'banner' },
        el('span', {}, 'Você está vendo dados de exemplo.'),
        el('button', {
          class: 'link-button',
          type: 'button',
          onclick: () => {
            FM.dom.confirmDialog({
              title: 'Apagar o exemplo e começar do zero?',
              description: 'Os lançamentos fictícios saem e você começa com a conta vazia.',
              confirmLabel: 'Começar do zero',
              onConfirm: () => {
                store.replace('Começar do zero', { ...storeLib.emptyState(), onboarded: true, theme: store.state.theme });
                ctx.notify('Tudo limpo. Registre seu primeiro lançamento.');
              },
            });
          },
        }, 'Começar do zero'),
      ));
    }
  }

  function renderOnboarding() {
    const balanceInput = el('input', { class: 'input input-money', type: 'text', inputMode: 'decimal', placeholder: '0,00', id: 'saldo-inicial' });
    const balanceField = FM.dom.field('Quanto você tem na conta hoje?', balanceInput, { class: 'field-money', hint: 'Opcional. Dá para mudar depois em Carteiras.' });
    const sample = { month: ctx.month, left: 124030 };

    main.replaceChildren(el(
      'div',
      { class: 'welcome' },
      FM.note.note(sample),
      el(
        'div',
        { class: 'welcome-text' },
        el('h1', { id: 'page-title', tabIndex: -1 }, 'Quanto sobra no fim do mês?'),
        el('p', {}, 'Registre o que entra e o que sai. O Sobra imprime o resultado do mês em uma cédula, e ela muda de cor se faltar. Seus lançamentos ficam só neste navegador.'),
        el(
          'form',
          {
            class: 'form',
            noValidate: true,
            onsubmit: (event) => {
              event.preventDefault();
              let initial = 0;
              if (balanceInput.value.trim()) {
                const parsed = money.parse(balanceInput.value);
                if (parsed.error) {
                  balanceField.setError(parsed.error);
                  balanceInput.focus();
                  return;
                }
                initial = parsed.cents;
              }
              store.finishOnboarding(initial);
            },
          },
          balanceField,
          el(
            'div',
            { class: 'welcome-actions' },
            el('button', { class: 'button button-primary', type: 'submit' }, 'Começar do zero'),
            el('button', {
              class: 'button',
              type: 'button',
              onclick: () => store.replace('Dados de exemplo', demo.buildDemoState(store.today())),
            }, 'Ver com dados de exemplo'),
          ),
        ),
      ),
    ));
  }

  let wasOnboarding = false;
  let booted = false;

  function render({ keepFocus = false, fromRoute = false } = {}) {
    const firstRender = !booted;
    booted = true;
    applyTheme();
    tip.hide();
    // O painel de instalações não depende dos dados do app: abre mesmo em um aparelho que nunca usou o Sobra.
    const onboarding = !store.state.onboarded && !currentRoute().hidden;
    document.body.classList.toggle('is-onboarding', onboarding);
    renderBanners();

    if (onboarding) {
      wasOnboarding = true;
      nav.replaceChildren();
      renderOnboarding();
      if (firstRender) FM.motion.enter(main.firstElementChild);
      return;
    }

    // Quem acabou de começar (ou recomeçar) vai para o Início, de onde quer que estivesse.
    if (wasOnboarding && store.state.onboarded) {
      wasOnboarding = false;
      history.replaceState(null, '', '#/inicio');
      ctx.month = dates.monthOf(store.today());
      keepFocus = false;
    }
    const route = currentRoute();

    renderNav(route);
    if (fromRoute) ctx.params = parseHash().params;

    const focusKey = keepFocus ? document.activeElement?.dataset?.fk : null;
    const scroll = window.scrollY;
    const view = FM.views[route.view](ctx);
    main.replaceChildren(view);
    // A tela só "entra" ao abrir ou trocar de rota; salvar um dado redesenha sem animar de novo.
    if (firstRender || !keepFocus) FM.motion.enter(view);
    document.title = `${route.label} | Sobra`;

    if (keepFocus) {
      window.scrollTo(0, scroll);
      if (focusKey) main.querySelector(`[data-fk="${CSS.escape(focusKey)}"]`)?.focus();
    } else {
      window.scrollTo(0, 0);
      document.getElementById('page-title')?.focus({ preventScroll: true });
    }

    // O atalho "Novo lançamento" do ícone do app chega por aqui.
    if (ctx.params.novo) {
      ctx.clearParams();
      FM.txForm.open(ctx, { preset: { date: common.defaultDate(ctx) } });
    }
  }

  /* ---------- Eventos globais ---------- */

  window.addEventListener('hashchange', () => render({ fromRoute: true }));
  store.subscribe(() => render({ keepFocus: true }));

  window.addEventListener('storage', (event) => {
    if (event.key === storeLib.KEY) store.reload();
  });

  document.addEventListener('keydown', (event) => {
    const target = event.target;
    const typing = target.matches?.('input, select, textarea') || target.isContentEditable;
    if (document.querySelector('dialog[open]') || !store.state.onboarded || currentRoute().hidden) return;

    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'z' && !typing) {
      event.preventDefault();
      const label = store.undo();
      toast(label ? `Desfeito: ${label.toLowerCase()}` : 'Não há o que desfazer');
      return;
    }
    if (typing || event.ctrlKey || event.metaKey || event.altKey) return;

    if (event.key === 'n' || event.key === 'N') {
      event.preventDefault();
      FM.txForm.open(ctx, { preset: { date: common.defaultDate(ctx) } });
    } else if (event.key === '/') {
      event.preventDefault();
      if (currentRoute().key === 'lancamentos') FM.views.focusSearch();
      else {
        ctx.go('lancamentos');
        setTimeout(() => FM.views.focusSearch(), 0);
      }
    } else if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && ['inicio', 'lancamentos', 'orcamentos'].includes(currentRoute().key)) {
      ctx.setMonth(dates.addMonths(ctx.month, event.key === 'ArrowLeft' ? -1 : 1));
    }
  });

  FM.pwa.onChange(() => render({ keepFocus: true }));
  FM.telemetry.onChange(() => render({ keepFocus: true }));

  ctx.params = parseHash().params;
  render({ keepFocus: true });

  FM.app = { ctx, store };
})(globalThis);
