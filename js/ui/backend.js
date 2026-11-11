/**
 * Conversa com o Supabase por fetch, sem biblioteca: registrar o aparelho, entrar no painel e ler os números.
 * Os dados financeiros nunca passam por aqui: eles ficam só no localStorage, em js/core/store.js.
 */
(function (root) {
  const FM = (root.FM = root.FM || {});

  const SESSION_KEY = 'sobra.admin.sessao';
  const TIMEOUT_MS = 8000;

  const config = () => FM.config || {};
  const base = () => String(config().supabaseUrl || '').replace(/\/+$/, '');
  const configured = () => Boolean(base() && config().supabaseKey) && /^https?:$/.test(root.location.protocol);

  function readSession() {
    try {
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
  }

  /** Devolve { ok, status, data }. Erro de rede vira { ok: false, status: 0 }, nunca uma exceção. */
  async function request(path, { body = null, token = null, keepalive = false } = {}) {
    if (!configured()) return { ok: false, status: 0, data: null };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const headers = { apikey: config().supabaseKey, 'Content-Type': 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;
      const response = await root.fetch(`${base()}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body || {}),
        keepalive,
        signal: controller.signal,
      });
      const text = await response.text();
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = null;
      }
      return { ok: response.ok, status: response.status, data };
    } catch {
      return { ok: false, status: 0, data: null };
    } finally {
      clearTimeout(timer);
    }
  }

  function keepSession(data) {
    const session = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: data.expires_at || Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
    };
    writeSession(session);
    return session;
  }

  async function signIn(email, password) {
    const result = await request('/auth/v1/token?grant_type=password', { body: { email, password } });
    if (result.ok && result.data?.access_token) {
      keepSession(result.data);
      return { ok: true };
    }
    return { ok: false, status: result.status };
  }

  async function refresh() {
    const session = readSession();
    if (!session?.refresh_token) return null;
    const result = await request('/auth/v1/token?grant_type=refresh_token', { body: { refresh_token: session.refresh_token } });
    if (result.ok && result.data?.access_token) return keepSession(result.data);
    // Sem rede a sessão continua guardada; só um "não" do servidor a descarta.
    if (result.status >= 400) writeSession(null);
    return null;
  }

  async function signOut() {
    const session = readSession();
    writeSession(null);
    if (session) await request('/auth/v1/logout', { token: session.access_token });
  }

  /** Chama uma função do banco como a pessoa logada, renovando a sessão se ela tiver vencido. */
  async function rpcAsUser(name, body) {
    let session = readSession();
    if (!session) return { ok: false, status: 401, data: null };
    if (session.expires_at && session.expires_at * 1000 < Date.now() + 30000) session = (await refresh()) || session;
    let result = await request(`/rest/v1/rpc/${name}`, { body, token: session.access_token });
    if (result.status === 401) {
      const renewed = await refresh();
      if (!renewed) return result;
      result = await request(`/rest/v1/rpc/${name}`, { body, token: renewed.access_token });
    }
    return result;
  }

  /** Chamada anônima, usada só para registrar o aparelho. */
  const rpc = (name, body) => request(`/rest/v1/rpc/${name}`, { body, keepalive: true });

  FM.backend = { configured, rpc, rpcAsUser, signIn, signOut, hasSession: () => Boolean(readSession()) };
})(globalThis);
