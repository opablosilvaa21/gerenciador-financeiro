/**
 * Conversa com o Supabase por fetch, sem biblioteca: conta (criar, entrar, sair, trocar senha),
 * chamadas ao banco como a pessoa logada e chamadas anônimas.
 * Este arquivo não conhece o formato dos dados do app: só leva e traz o que os outros módulos pedem.
 */
(function (root) {
  const FM = (root.FM = root.FM || {});

  const SESSION_KEY = 'sobra.sessao';
  const OLD_SESSION_KEY = 'sobra.admin.sessao';
  const TIMEOUT_MS = 15000;
  const listeners = new Set();

  const config = () => FM.config || {};
  const base = () => String(config().supabaseUrl || '').replace(/\/+$/, '');
  const configured = () => Boolean(base() && config().supabaseKey) && /^https?:$/.test(root.location.protocol);

  /* ---------- Sessão ---------- */

  function readSession() {
    try {
      // Quem entrou no painel antes desta versão continua logado.
      const old = root.localStorage.getItem(OLD_SESSION_KEY);
      if (old && !root.localStorage.getItem(SESSION_KEY)) root.localStorage.setItem(SESSION_KEY, old);
      if (old) root.localStorage.removeItem(OLD_SESSION_KEY);
      const session = JSON.parse(root.localStorage.getItem(SESSION_KEY) || 'null');
      return session && session.access_token ? session : null;
    } catch {
      return null;
    }
  }

  function writeSession(session) {
    try {
      if (session) root.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      else root.localStorage.removeItem(SESSION_KEY);
    } catch {
      // Sem armazenamento, a sessão vale só até recarregar a página.
    }
    listeners.forEach((listener) => listener(session));
  }

  /** O que o token diz sobre a pessoa logada: id e e-mail. Não confere a assinatura (quem confere é o servidor). */
  function claims(token) {
    try {
      const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      const json = decodeURIComponent([...root.atob(payload)].map((c) => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`).join(''));
      return JSON.parse(json);
    } catch {
      return {};
    }
  }

  function currentUser() {
    const session = readSession();
    if (!session) return null;
    const data = claims(session.access_token);
    return { id: data.sub || null, email: session.email || data.email || null };
  }

  function keepSession(data) {
    const session = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Number(data.expires_at) || Math.floor(Date.now() / 1000) + (Number(data.expires_in) || 3600),
      email: data.user?.email || claims(data.access_token).email || null,
    };
    writeSession(session);
    return session;
  }

  /* ---------- Rede ---------- */

  /**
   * Devolve { ok, status, code, data }. Erro de rede vira { ok: false, status: 0 }, nunca uma exceção.
   * code é o código de erro do Supabase (ex.: invalid_credentials), quando houver.
   */
  async function request(path, { method = 'POST', body = null, token = null, keepalive = false, headers: extra = {} } = {}) {
    if (!configured()) return { ok: false, status: 0, code: 'not_configured', data: null };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const headers = { apikey: config().supabaseKey, 'Content-Type': 'application/json', ...extra };
      if (token) headers.Authorization = `Bearer ${token}`;
      const response = await root.fetch(`${base()}${path}`, {
        method,
        headers,
        body: method === 'GET' ? undefined : JSON.stringify(body || {}),
        keepalive,
        cache: 'no-store',
        signal: controller.signal,
      });
      const text = await response.text();
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = null;
      }
      const code = response.ok ? null : data?.error_code || data?.code || data?.error || null;
      return { ok: response.ok, status: response.status, code, data };
    } catch {
      return { ok: false, status: 0, code: 'network', data: null };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Endereço para onde os links de e-mail devolvem a pessoa: o próprio app, sem a rota. */
  const appUrl = () => `${root.location.origin}${root.location.pathname}`;

  /* ---------- Conta ---------- */

  async function signIn(email, password) {
    const result = await request('/auth/v1/token?grant_type=password', { body: { email, password } });
    if (result.ok && result.data?.access_token) {
      keepSession(result.data);
      return { ok: true };
    }
    return { ok: false, status: result.status, code: result.code };
  }

  /**
   * Cria a conta. Primeiro pela função create_account do banco, que cria a conta já confirmada (o e-mail embutido
   * do Supabase não entrega para quem usa o app) e em seguida entra. Sem essa função, usa o cadastro do Supabase:
   * se o projeto não exige confirmar o e-mail, já entra (confirmed: true); se exige, manda um link (confirmed: false).
   */
  async function signUp(email, password) {
    const created = await request('/rest/v1/rpc/create_account', { body: { p_email: email, p_password: password } });
    if (created.ok) {
      if (created.data?.status !== 'ok') return { ok: false, status: 422, code: created.data?.code || 'validation_failed' };
      const entered = await signIn(email, password);
      return entered.ok ? { ok: true, confirmed: true } : entered;
    }
    if (created.status !== 404) return { ok: false, status: created.status, code: created.code };
    return signUpWithEmail(email, password);
  }

  async function signUpWithEmail(email, password) {
    const result = await request(`/auth/v1/signup?redirect_to=${encodeURIComponent(appUrl())}`, { body: { email, password } });
    if (!result.ok) return { ok: false, status: result.status, code: result.code };
    if (result.data?.access_token) {
      keepSession(result.data);
      return { ok: true, confirmed: true };
    }
    // Com confirmação ligada, um e-mail já cadastrado devolve um usuário sem identidades (para não revelar quem tem conta).
    const user = result.data?.user || result.data;
    if (user && Array.isArray(user.identities) && !user.identities.length) return { ok: false, status: 422, code: 'user_already_exists' };
    return { ok: true, confirmed: false };
  }

  /** Manda o e-mail para criar uma senha nova. O link volta para o app já logado, pedindo a senha nova. */
  async function recover(email) {
    const result = await request(`/auth/v1/recover?redirect_to=${encodeURIComponent(appUrl())}`, { body: { email } });
    return { ok: result.ok, status: result.status, code: result.code };
  }

  async function refresh() {
    const session = readSession();
    if (!session?.refresh_token) return null;
    const result = await request('/auth/v1/token?grant_type=refresh_token', { body: { refresh_token: session.refresh_token } });
    if (result.ok && result.data?.access_token) return keepSession({ ...result.data, user: result.data.user || { email: session.email } });
    // Sem rede a sessão continua guardada; só um "não" do servidor a descarta (conta excluída, sessão revogada).
    if (result.status >= 400 && result.status < 500) writeSession(null);
    return null;
  }

  /** Token válido para usar agora: renova se estiver para vencer. null se não há sessão. */
  async function validToken() {
    let session = readSession();
    if (!session) return null;
    if (session.expires_at && session.expires_at * 1000 < Date.now() + 60000) session = (await refresh()) || readSession();
    return session ? session.access_token : null;
  }

  async function signOut() {
    const session = readSession();
    writeSession(null);
    if (session) await request('/auth/v1/logout', { token: session.access_token });
  }

  /** Chamada como a pessoa logada; se o token for recusado, renova uma vez e tenta de novo. */
  async function asUser(path, options = {}) {
    let token = await validToken();
    if (!token) return { ok: false, status: 401, code: 'no_session', data: null };
    let result = await request(path, { ...options, token });
    if (result.status === 401) {
      const renewed = await refresh();
      if (!renewed) return result;
      token = renewed.access_token;
      result = await request(path, { ...options, token });
    }
    return result;
  }

  const rpcAsUser = (name, body) => asUser(`/rest/v1/rpc/${name}`, { body });
  const selectAsUser = (pathAndQuery) => asUser(`/rest/v1/${pathAndQuery}`, { method: 'GET' });

  async function updatePassword(password) {
    const result = await asUser('/auth/v1/user', { method: 'PUT', body: { password } });
    return { ok: result.ok, status: result.status, code: result.code };
  }

  /** Chamada anônima, usada só para registrar o aparelho. */
  const rpc = (name, body) => request(`/rest/v1/rpc/${name}`, { body, keepalive: true });

  /** Leitura anônima: só para saber se uma tabela existe (404 quando não existe; recusa quando existe). */
  const probe = (pathAndQuery) => request(`/rest/v1/${pathAndQuery}`, { method: 'GET' });

  /* ---------- Volta dos links de e-mail ---------- */

  /**
   * O link de confirmação ou de nova senha volta para o app com os tokens depois do #, onde o app guarda a rota.
   * Isso é lido aqui, antes de o app olhar a rota, e o endereço é limpo para os tokens não ficarem no histórico.
   * Devolve 'signup', 'recovery', 'magiclink', 'error' ou null.
   */
  function consumeRedirect() {
    const hash = root.location.hash.replace(/^#\/?/, '');
    if (!/(^|&)(access_token|error_description|error)=/.test(hash)) return null;
    const params = new URLSearchParams(hash);
    const clean = (route) => root.history.replaceState(null, '', `${root.location.pathname}${root.location.search}#/${route}`);
    if (params.get('access_token')) {
      keepSession({
        access_token: params.get('access_token'),
        refresh_token: params.get('refresh_token'),
        expires_at: params.get('expires_at'),
        expires_in: params.get('expires_in'),
      });
      clean('nuvem');
      return params.get('type') || 'signup';
    }
    clean('nuvem');
    redirectError = params.get('error_description') || params.get('error') || 'O link não é mais válido.';
    return 'error';
  }

  let redirectError = null;
  const redirectType = configured() ? consumeRedirect() : null;

  FM.backend = {
    configured,
    rpc,
    probe,
    rpcAsUser,
    selectAsUser,
    signIn,
    signUp,
    signOut,
    recover,
    updatePassword,
    currentUser,
    hasSession: () => Boolean(readSession()),
    onAuthChange: (listener) => listeners.add(listener),
    redirectType: () => redirectType,
    redirectError: () => redirectError,
  };
})(globalThis);
