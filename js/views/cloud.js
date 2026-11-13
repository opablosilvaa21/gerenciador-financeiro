/** Nuvem: criar conta, entrar, ver se está tudo guardado e recuperar os lançamentos num celular novo. */
(function (root) {
  const FM = (root.FM = root.FM || {});
  const { el, icon, field, openDialog, confirmDialog, toast } = FM.dom;
  const { common } = FM;

  /** Estado da tela que não está nos dados: formulário escolhido, e-mail esperando confirmação, envio em andamento. */
  const ui = { mode: 'signup', waitingEmail: null, prefill: '', busy: false, notice: null, redirectHandled: false, hasCode: undefined };

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
    const recoverable = FM.config.emailRecovery || FM.cloud.status().recovery;
    const passField = field('Senha', passInput, {
      hint: signup ? (recoverable ? 'Pelo menos 8 caracteres.' : 'Pelo menos 8 caracteres. Anote a senha: por enquanto ela não pode ser recuperada.') : null,
    });
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
      // Conta nova: já sai com o código de recuperação, mostrado uma vez para a pessoa guardar.
      if (signup) createRecoveryCode(ctx);
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
        !signup && recoverable && el('button', { class: 'link-button', type: 'button', onclick: () => (FM.config.emailRecovery ? openRecover(emailInput.value.trim()) : openRecoverWithCode(ctx, emailInput.value.trim())) }, 'Esqueci minha senha')),
    );
  }

  /* ---------- Código de recuperação ---------- */

  const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  /** 16 letras e números sem os que se confundem (0/O, 1/I/L), em 4 grupos: ABCD-EFGH-JKMN-PQRS. */
  function newRecoveryCode() {
    const bytes = root.crypto.getRandomValues(new Uint8Array(16));
    const chars = [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
    return chars.match(/.{4}/g).join('-');
  }

  /** Mostra o código uma vez. Só fecha depois de a pessoa confirmar que guardou. */
  function showRecoveryCode(code, { title = 'Guarde seu código de recuperação', onClose = null } = {}) {
    const done = el('button', { class: 'button button-primary', type: 'button', disabled: true }, 'Pronto');
    const check = el('input', { type: 'checkbox', onchange: () => { done.disabled = !check.checked; } });
    let handle = null;
    done.addEventListener('click', () => handle.close());
    handle = openDialog({
      title,
      description: 'Se esquecer a senha, este código é o único jeito de recuperar a conta e os lançamentos da nuvem. Guarde fora do celular: anote num papel ou mande para o seu e-mail.',
      body: el('div', { class: 'form' },
        el('p', { class: 'recovery-code', 'aria-label': `Código: ${code.split('').join(' ')}` }, code),
        el('div', { class: 'action-list' },
          el('button', { class: 'button button-small', type: 'button', onclick: async () => {
            try {
              await root.navigator.clipboard.writeText(code);
              toast('Código copiado');
            } catch {
              toast('Não deu para copiar: anote o código.');
            }
          } }, 'Copiar'),
          el('button', { class: 'button button-small', type: 'button', onclick: () => FM.dom.download('sobra-finance-codigo-de-recuperacao.txt', `Código de recuperação do Sobra Finance: ${code}\nUse em "Esqueci minha senha", na tela Nuvem.\n`, 'text/plain') }, 'Baixar arquivo')),
        el('label', { class: 'check-line' }, check, el('span', {}, 'Guardei o código em lugar seguro'))),
      footer: done,
      onClose,
    });
    // Sem "fechar sem querer": o X e o toque fora só valem depois de confirmar.
    handle.dialog.addEventListener('cancel', (event) => {
      if (!done.disabled) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
    handle.dialog.addEventListener('mousedown', (event) => { if (done.disabled && event.target === handle.dialog) event.stopImmediatePropagation(); }, true);
    handle.dialog.querySelector('[aria-label="Fechar"]').hidden = true;
    check.addEventListener('change', () => { handle.dialog.querySelector('[aria-label="Fechar"]').hidden = !check.checked; });
    return handle;
  }

  /** Cria (ou troca) o código da conta logada e mostra. Sem o recurso no banco, não faz nada. */
  async function createRecoveryCode(ctx, options) {
    if (!FM.cloud.status().recovery) return false;
    const code = newRecoveryCode();
    const result = await FM.backend.rpcAsUser('set_recovery_code', { p_code: code });
    if (!result.ok || result.data?.status !== 'ok') {
      toast('Não deu para criar o código de recuperação agora. Gere em Nuvem, mais tarde.');
      return false;
    }
    ui.hasCode = true;
    // Enquanto o diálogo está aberto a tela não se redesenha: ao fechar, ela se atualiza.
    showRecoveryCode(code, { ...options, onClose: () => ctx && ctx.refresh() });
    return true;
  }

  /** Esqueceu a senha: e-mail, código e senha nova. Depois entra e já gera um código novo (o antigo foi gasto). */
  function openRecoverWithCode(ctx, email) {
    const emailInput = el('input', { class: 'input', type: 'email', inputMode: 'email', autocomplete: 'username', value: email || '', 'data-autofocus': true });
    const codeInput = el('input', { class: 'input recovery-input', type: 'text', autocomplete: 'off', autocapitalize: 'characters', spellcheck: false, placeholder: 'XXXX-XXXX-XXXX-XXXX' });
    const passInput = passwordInput('new-password');
    const emailField = field('E-mail da conta', emailInput);
    const codeField = field('Código de recuperação', codeInput, { hint: 'O código que você guardou ao criar a conta.' });
    const passField = field('Senha nova', passInput, { hint: 'Pelo menos 8 caracteres.' });
    const submitButton = el('button', { class: 'button button-primary', type: 'submit', form: 'form-recuperar-codigo' }, 'Criar senha nova');
    let handle = null;
    const send = async () => {
      [emailField, codeField, passField].forEach((f) => f.setError(null));
      const mail = emailInput.value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) return emailField.setError('Informe um e-mail válido.');
      if (codeInput.value.replace(/[^A-Za-z0-9]/g, '').length !== 16) return codeField.setError('O código tem 16 letras e números.');
      if (passInput.value.length < 8) return passField.setError('Use pelo menos 8 caracteres.');
      submitButton.disabled = true;
      const result = await FM.backend.rpc('reset_password_with_code', { p_email: mail, p_code: codeInput.value, p_new_password: passInput.value });
      submitButton.disabled = false;
      if (!result.ok || result.data?.status !== 'ok') {
        const code = result.data?.code;
        if (code === 'invalid_recovery_code') return codeField.setError('E-mail ou código incorretos.');
        if (code === 'over_request_rate_limit') return codeField.setError('Muitas tentativas. Espere uma hora e tente de novo.');
        if (code === 'weak_password') return passField.setError('Use pelo menos 8 caracteres.');
        return codeField.setError(errorText(result));
      }
      const entered = await FM.backend.signIn(mail, passInput.value);
      handle.close();
      if (!entered.ok) {
        toast('Senha trocada. Entre com a senha nova.');
        ui.mode = 'signin';
        ui.prefill = mail;
        ctx.refresh();
        return;
      }
      toast('Senha trocada. Você entrou.');
      ctx.refresh();
      FM.cloud.syncNow();
      // O código usado não vale mais: já entrega um novo.
      createRecoveryCode(ctx, { title: 'Seu novo código de recuperação' });
    };
    handle = openDialog({
      title: 'Esqueci minha senha',
      description: 'Use o código de recuperação que você guardou ao criar a conta.',
      body: el('form', { class: 'form', id: 'form-recuperar-codigo', noValidate: true, onsubmit: (event) => { event.preventDefault(); send(); } }, emailField, codeField, passField, showPasswordToggle(passInput)),
      footer: submitButton,
    });
  }

  /** Seção "Código de recuperação" da conta logada. */
  function recoverySection(ctx) {
    if (!FM.cloud.status().recovery) return null;
    if (ui.hasCode === undefined) {
      ui.hasCode = null;
      FM.backend.rpcAsUser('has_recovery_code', {}).then((r) => {
        if (r.ok) {
          ui.hasCode = r.data === true;
          ctx.refresh();
        }
      });
    }
    const missing = ui.hasCode === false;
    return el(
      'section',
      { class: `band card${missing ? ' recovery-missing' : ''}` },
      el('div', { class: 'band-head' },
        el('h2', {}, 'Código de recuperação'),
        el('p', { class: 'chart-sub' }, missing
          ? 'Esta conta ainda não tem código. Sem ele, quem esquecer a senha perde o acesso à nuvem. Gere agora e guarde.'
          : 'Se esquecer a senha, é com ele que você cria outra. Perdeu o código? Gere um novo: o anterior deixa de valer.')),
      el('div', { class: 'action-list' },
        el('button', { class: `button${missing ? ' button-primary' : ''}`, type: 'button', onclick: () => createRecoveryCode(ctx) }, missing ? 'Gerar meu código' : 'Gerar código novo')),
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
      recoverySection(ctx),
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
                ui.hasCode = undefined;
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
