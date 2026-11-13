/** Nuvem: criar conta, entrar, ver se está tudo guardado e recuperar os lançamentos num celular novo. */
(function (root) {
  const FM = (root.FM = root.FM || {});
  const { el, icon, field, openDialog, confirmDialog, toast } = FM.dom;
  const { common } = FM;

  /** Estado da tela que não está nos dados: formulário escolhido, e-mail esperando confirmação, envio em andamento. */
  const ui = { mode: 'signup', waitingEmail: null, prefill: '', busy: false, notice: null, redirectHandled: false };

  const ERRORS = {
    invalid_credentials: 'E-mail ou senha incorretos.',
    invalid_grant: 'E-mail ou senha incorretos.',
    email_not_confirmed: 'Falta confirmar o e-mail: abra o link que enviamos para você e depois entre.',
    user_already_exists: 'Já existe uma conta com este e-mail. Toque em "Entrar".',
    email_exists: 'Já existe uma conta com este e-mail. Toque em "Entrar".',
    weak_password: 'Use uma senha mais forte, com pelo menos 8 caracteres.',
    over_email_send_rate_limit: 'Muitos e-mails enviados agora. Tente de novo daqui a alguns minutos.',
    over_request_rate_limit: 'Muitas tentativas seguidas. Espere um pouco e tente de novo.',
    email_address_not_authorized: 'O servidor ainda não está liberado para enviar e-mails a este endereço.',
    email_address_invalid: 'Este e-mail não parece válido.',
    validation_failed: 'Confira o e-mail e a senha.',
    signup_disabled: 'Novos cadastros estão fechados no momento.',
    same_password: 'A senha nova precisa ser diferente da atual.',
    network: 'Sem conexão com o servidor. Confira a internet e tente de novo.',
  };
  const errorText = (result) => ERRORS[result.code] || (result.status === 0 ? ERRORS.network : 'Não deu certo. Tente de novo em instantes.');

  const STATUS = {
    idle: { icon: 'cloud', title: 'Tudo guardado na nuvem', tone: 'good' },
    pending: { icon: 'clock', title: 'Alterações esperando para subir', tone: 'busy' },
    syncing: { icon: 'repeat', title: 'Sincronizando…', tone: 'busy' },
    offline: { icon: 'cloudOff', title: 'Sem internet agora', tone: 'warn' },
    error: { icon: 'alert', title: 'Não deu para sincronizar', tone: 'warn' },
    choice: { icon: 'alert', title: 'Falta uma escolha sua', tone: 'warn' },
    off: { icon: 'cloud', title: 'Conectando…', tone: 'busy' },
  };

  function when(iso) {
    if (!iso) return null;
    const date = new Date(iso);
    const time = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const sameDay = date.toDateString() === new Date().toDateString();
    return sameDay ? `hoje às ${time}` : `${date.toLocaleDateString('pt-BR')} às ${time}`;
  }

  /* ---------- Escolha quando o aparelho e a nuvem têm dados diferentes ---------- */

  function openChoice(ctx) {
    const choice = FM.cloud.status().choice;
    if (!choice) return;
    const here = ctx.store.state.transactions.length;
    const there = choice.remote.data.transactions.length;
    const plural = (n) => `${n} ${n === 1 ? 'lançamento' : 'lançamentos'}`;
    let handle = null;
    const pick = (option, message) => async () => {
      handle.close();
      await FM.cloud.resolveChoice(option);
      toast(message);
    };
    handle = openDialog({
      title: 'Este aparelho e a sua conta têm dados diferentes',
      description: `Neste aparelho: ${plural(here)}. Na nuvem: ${plural(there)}. O que fazer?`,
      body: el(
        'ul',
        { class: 'choice-list' },
        el('li', {}, el('button', { class: 'choice', type: 'button', 'data-autofocus': true, onclick: pick('merge', 'Os dois foram juntados') },
          el('strong', {}, 'Juntar os dois'), el('span', {}, 'Recomendado. Nada se perde: lançamentos repetidos aparecem uma vez só.'))),
        el('li', {}, el('button', { class: 'choice', type: 'button', onclick: pick('cloud', 'Agora este aparelho tem os dados da nuvem') },
          el('strong', {}, 'Usar os da nuvem'), el('span', {}, 'Os lançamentos deste aparelho são trocados pelos da sua conta.'))),
        el('li', {}, el('button', { class: 'choice', type: 'button', onclick: pick('device', 'A nuvem agora tem os dados deste aparelho') },
          el('strong', {}, 'Manter os deste aparelho'), el('span', {}, 'A nuvem passa a ter os lançamentos daqui, no lugar dos que estavam lá.'))),
      ),
    });
  }

  /* ---------- Formulários ---------- */

  function passwordInput(autocomplete) {
    return el('input', { class: 'input', type: 'password', autocomplete, minLength: 8, required: true });
  }

  function showPasswordToggle(...inputs) {
    return el('label', { class: 'check-line' },
      el('input', { type: 'checkbox', onchange: (event) => inputs.forEach((i) => { i.type = event.target.checked ? 'text' : 'password'; }) }),
      el('span', {}, 'Mostrar senha'));
  }

  function authForm(ctx) {
    const signup = ui.mode === 'signup';
    const emailInput = el('input', { class: 'input', type: 'email', autocomplete: 'username', inputMode: 'email', required: true, value: ui.prefill || '' });
    const passInput = passwordInput(signup ? 'new-password' : 'current-password');
    const emailField = field('E-mail', emailInput);
    const passField = field('Senha', passInput, { hint: signup ? 'Pelo menos 8 caracteres.' : null });
    const submit = el('button', { class: 'button button-primary', type: 'submit', disabled: ui.busy }, ui.busy ? 'Aguarde…' : signup ? 'Criar conta e guardar' : 'Entrar e recuperar');

    const onSubmit = async (event) => {
      event.preventDefault();
      if (ui.busy) return;
      const email = emailInput.value.trim();
      const password = passInput.value;
      emailField.setError(null);
      passField.setError(null);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        emailField.setError('Informe um e-mail válido.');
        emailInput.focus();
        return;
      }
      if (password.length < 8) {
        passField.setError(signup ? 'Use pelo menos 8 caracteres.' : 'Informe a sua senha.');
        passInput.focus();
        return;
      }
      ui.busy = true;
      submit.disabled = true;
      submit.textContent = 'Aguarde…';
      const result = signup ? await FM.backend.signUp(email, password) : await FM.backend.signIn(email, password);
      ui.busy = false;
      if (!result.ok) {
        submit.disabled = false;
        submit.textContent = signup ? 'Criar conta e guardar' : 'Entrar e recuperar';
        passField.setError(errorText(result));
        return;
      }
      ui.prefill = email;
      if (signup && !result.confirmed) {
        ui.waitingEmail = email;
        ctx.refresh();
        return;
      }
      ui.waitingEmail = null;
      toast(signup ? 'Conta criada. Seus lançamentos vão para a nuvem.' : 'Pronto, você entrou.');
      ctx.refresh();
      FM.cloud.syncNow();
    };

    return el(
      'form',
      { class: 'form cloud-form', noValidate: true, onsubmit: onSubmit },
      FM.dom.segmented('modo-conta', 'Criar conta ou entrar', [
        { value: 'signup', label: 'Criar conta' },
        { value: 'signin', label: 'Já tenho conta' },
      ], ui.mode, (value) => {
        ui.mode = value;
        ctx.refresh();
      }),
      emailField,
      passField,
      showPasswordToggle(passInput),
      el('div', { class: 'action-list' }, submit,
        !signup && el('button', { class: 'link-button', type: 'button', onclick: () => openRecover(emailInput.value.trim()) }, 'Esqueci minha senha')),
    );
  }

  function openRecover(email) {
    const input = el('input', { class: 'input', type: 'email', inputMode: 'email', autocomplete: 'username', value: email || '', 'data-autofocus': true });
    const box = field('E-mail da sua conta', input);
    let handle = null;
    const send = async () => {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.value.trim())) {
        box.setError('Informe um e-mail válido.');
        return;
      }
      const result = await FM.backend.recover(input.value.trim());
      if (!result.ok) {
        box.setError(errorText(result));
        return;
      }
      handle.close();
      toast('Se houver uma conta com esse e-mail, chega um link para criar a senha nova.');
    };
    handle = openDialog({
      title: 'Criar uma senha nova',
      description: 'Enviamos um link para o seu e-mail. Abra o link neste aparelho e escolha a senha nova.',
      body: el('form', { class: 'form', id: 'form-recuperar', noValidate: true, onsubmit: (event) => { event.preventDefault(); send(); } }, box),
      footer: el('button', { class: 'button button-primary', type: 'submit', form: 'form-recuperar' }, 'Enviar link'),
    });
  }

  function openNewPassword({ title = 'Trocar a senha', description = null } = {}) {
    const input = passwordInput('new-password');
    input.dataset.autofocus = '1';
    const box = field('Senha nova', input, { hint: 'Pelo menos 8 caracteres.' });
    let handle = null;
    const save = async () => {
      if (input.value.length < 8) {
        box.setError('Use pelo menos 8 caracteres.');
        return;
      }
      const result = await FM.backend.updatePassword(input.value);
      if (!result.ok) {
        box.setError(errorText(result));
        return;
      }
      handle.close();
      toast('Senha trocada');
    };
    handle = openDialog({
      title,
      description,
      body: el('form', { class: 'form', id: 'form-senha', noValidate: true, onsubmit: (event) => { event.preventDefault(); save(); } }, box, showPasswordToggle(input)),
      footer: el('button', { class: 'button button-primary', type: 'submit', form: 'form-senha' }, 'Salvar senha'),
    });
  }

  function openDeleteAccount(ctx) {
    const input = el('input', { class: 'input', type: 'text', autocomplete: 'off', 'data-autofocus': true });
    const box = field('Escreva EXCLUIR para confirmar', input);
    let handle = null;
    const confirm = async () => {
      if (input.value.trim().toUpperCase() !== 'EXCLUIR') {
        box.setError('Escreva EXCLUIR, em uma palavra, para confirmar.');
        return;
      }
      const result = await FM.cloud.deleteAccount();
      if (!result.ok) {
        box.setError(result.status === 0 ? ERRORS.network : 'Não deu para excluir agora. Tente de novo.');
        return;
      }
      handle.close();
      toast('Conta excluída. Seus lançamentos continuam neste aparelho.');
      ctx.refresh();
    };
    handle = openDialog({
      title: 'Excluir a conta e os dados da nuvem?',
      description: 'A conta e tudo o que está guardado na nuvem são apagados de vez. Os lançamentos deste aparelho continuam aqui. Outros aparelhos ligados a esta conta param de sincronizar.',
      body: el('form', { class: 'form', id: 'form-excluir-conta', noValidate: true, onsubmit: (event) => { event.preventDefault(); confirm(); } }, box),
      footer: el('button', { class: 'button button-danger', type: 'submit', form: 'form-excluir-conta' }, 'Excluir conta'),
    });
  }

  /* ---------- A tela ---------- */

  function benefits() {
    return el(
      'ul',
      { class: 'cloud-benefits' },
      [
        ['phone', 'Trocou, perdeu ou quebrou o celular?', 'Entre com a mesma conta no aparelho novo e todos os lançamentos voltam.'],
        ['repeat', 'Celular e computador iguais', 'O que você lança num aparece no outro, sozinho.'],
        ['cloudOff', 'Funciona sem internet', 'O app continua igual; as alterações sobem quando a conexão voltar.'],
      ].map(([name, title, text]) => el('li', {}, el('span', { class: 'cloud-benefit-icon' }, icon(name, 20)), el('div', {}, el('strong', {}, title), el('p', {}, text)))),
    );
  }

  function privacyNote() {
    return el('p', { class: 'field-hint' }, 'Os lançamentos ficam guardados na sua conta, num servidor em São Paulo, e só você acessa pelo app. Dá para excluir a conta e tudo o que está na nuvem quando quiser, nesta tela.');
  }

  function signedOutView(ctx, preStart) {
    if (ui.waitingEmail) {
      return el(
        'section',
        { class: 'band card cloud-wait' },
        el('span', { class: 'empty-art', 'aria-hidden': 'true' }, icon('mail', 26)),
        el('h2', {}, 'Confira o seu e-mail'),
        el('p', {}, 'Enviamos um link para ', el('strong', {}, ui.waitingEmail), '. Abra o link neste aparelho para ativar a conta; seus lançamentos sobem em seguida.'),
        el('p', { class: 'field-hint' }, 'Não chegou? Veja a caixa de spam. O link vale por 24 horas.'),
        el('div', { class: 'action-list' },
          el('button', { class: 'button', type: 'button', onclick: () => { ui.mode = 'signin'; ui.waitingEmail = null; ctx.refresh(); } }, 'Já confirmei: entrar'),
          el('button', { class: 'link-button', type: 'button', onclick: () => { ui.waitingEmail = null; ctx.refresh(); } }, 'Usar outro e-mail')),
      );
    }
    return [
      el(
        'section',
        { class: 'band card cloud-hero' },
        el('div', { class: 'band-head' },
          el('h2', {}, preStart ? 'Recupere seus lançamentos' : 'Guarde seus lançamentos na nuvem'),
          el('p', { class: 'chart-sub' }, preStart
            ? 'Entre com a conta que você usava no outro aparelho: tudo volta para cá.'
            : 'Crie uma conta grátis com seu e-mail. A partir daí, tudo o que você lança vai também para a nuvem.')),
        benefits(),
      ),
      el('section', { class: 'band card' }, authForm(ctx), privacyNote()),
    ];
  }

  function signedInView(ctx) {
    const view = FM.cloud.status();
    const info = STATUS[view.status] || STATUS.idle;
    const user = FM.backend.currentUser();
    const lastSync = when(view.lastSync);
    const detail = {
      idle: lastSync ? `Última sincronização ${lastSync}.` : 'Seus lançamentos estão na sua conta.',
      pending: 'Elas sobem em alguns segundos.',
      syncing: 'Conferindo a nuvem e enviando o que mudou.',
      offline: 'Pode continuar usando: as alterações sobem quando a conexão voltar.',
      error: view.error || 'Seus dados continuam neste aparelho. Tente de novo em instantes.',
      choice: 'Este aparelho e a nuvem têm lançamentos diferentes. Escolha o que fazer.',
      off: 'Conferindo a sua conta.',
    }[view.status];

    return [
      el(
        'section',
        { class: `band card cloud-status cloud-${info.tone}`, role: 'status' },
        el('span', { class: 'cloud-status-icon', 'aria-hidden': 'true' }, icon(info.icon, 26)),
        el('div', {},
          el('h2', {}, info.title),
          el('p', {}, detail),
          user?.email && el('p', { class: 'field-hint' }, 'Conta: ', el('strong', {}, user.email))),
        el('div', { class: 'action-list' },
          view.status === 'choice'
            ? el('button', { class: 'button button-primary', type: 'button', onclick: () => openChoice(ctx) }, 'Escolher agora')
            : el('button', { class: 'button', type: 'button', disabled: view.status === 'syncing', dataset: { fk: 'sincronizar' }, onclick: () => FM.cloud.syncNow() }, icon('repeat'), 'Sincronizar agora')),
      ),
      el(
        'section',
        { class: 'band card' },
        el('div', { class: 'band-head' }, el('h2', {}, 'Num celular novo')),
        el('ol', { class: 'cloud-steps' },
          el('li', {}, 'Abra o Sobra Finance no aparelho novo.'),
          el('li', {}, 'Na tela de boas-vindas, toque em ', el('strong', {}, 'Já tenho conta'), '.'),
          el('li', {}, 'Entre com ', el('strong', {}, user?.email || 'o seu e-mail'), ' e a sua senha. Tudo volta.')),
      ),
      el(
        'section',
        { class: 'band card' },
        el('div', { class: 'band-head' }, el('h2', {}, 'Conta')),
        el('div', { class: 'action-list' },
          el('button', { class: 'button', type: 'button', onclick: () => openNewPassword() }, 'Trocar a senha'),
          el('button', {
            class: 'button',
            type: 'button',
            onclick: () => confirmDialog({
              title: 'Sair da conta neste aparelho?',
              description: 'Seus lançamentos continuam aqui, mas param de ir para a nuvem até você entrar de novo.',
              confirmLabel: 'Sair',
              onConfirm: async () => {
                await FM.cloud.signOut();
                toast('Você saiu da conta. Os lançamentos continuam neste aparelho.');
                ctx.refresh();
              },
            }),
          }, 'Sair desta conta'),
          el('button', { class: 'button button-ghost-danger', type: 'button', onclick: () => openDeleteAccount(ctx) }, icon('trash'), 'Excluir conta e dados da nuvem')),
        privacyNote(),
      ),
    ];
  }

  /** O link do e-mail trouxe a pessoa de volta: confirmação de cadastro ou senha nova. */
  function handleRedirect(ctx) {
    if (ui.redirectHandled) return;
    ui.redirectHandled = true;
    const type = FM.backend.redirectType();
    if (!type) return;
    if (type === 'error') {
      ui.notice = `O link do e-mail não funcionou: ${FM.backend.redirectError()} Peça outro.`;
      return;
    }
    setTimeout(() => {
      if (type === 'recovery') {
        openNewPassword({ title: 'Escolha a senha nova', description: 'Você entrou pelo link do e-mail. Agora defina a senha que vai usar daqui em diante.' });
      } else {
        toast('E-mail confirmado. Sua conta está ativa.');
      }
      FM.cloud.syncNow();
      ctx.refresh();
    }, 0);
  }

  function cloudView(ctx) {
    handleRedirect(ctx);
    const preStart = !ctx.store.state.onboarded;
    if (!FM.cloud.enabled()) {
      return el('div', { class: 'view' }, common.pageHead('Nuvem'), common.emptyState('Nuvem indisponível', 'O backup na nuvem só funciona no endereço publicado do app.', null, 'cloudOff'));
    }
    const signedIn = FM.cloud.signedIn();
    return el(
      'div',
      { class: 'view view-cloud' },
      common.pageHead(preStart ? 'Já tenho conta' : 'Nuvem', {
        actions: preStart && el('button', { class: 'button', type: 'button', onclick: () => { root.location.hash = ''; } }, icon('left'), 'Voltar'),
      }),
      ui.notice && el('p', { class: 'banner banner-error', role: 'alert' }, ui.notice),
      // Conta nova, ainda sem lançamentos na nuvem: começa a usar, e o que for lançado vai sendo guardado nela.
      signedIn && preStart && FM.cloud.status().status === 'idle' && el(
        'section',
        { class: 'band card' },
        el('div', { class: 'band-head' }, el('h2', {}, 'Esta conta ainda não tem lançamentos'), el('p', { class: 'chart-sub' }, 'Comece a usar: tudo o que você lançar vai sendo guardado nela.')),
        el('div', { class: 'action-list' }, el('button', { class: 'button button-primary', type: 'button', onclick: () => ctx.store.finishOnboarding(0) }, 'Começar a usar')),
      ),
      signedIn ? signedInView(ctx) : signedOutView(ctx, preStart),
    );
  }

  /** Quem chega pela tela de boas-vindas já vem no modo "entrar". */
  function startSignIn() {
    ui.mode = 'signin';
  }

  FM.views = FM.views || {};
  Object.assign(FM.views, { cloud: cloudView, cloudChoice: openChoice, cloudStartSignIn: startSignIn });
})(globalThis);
