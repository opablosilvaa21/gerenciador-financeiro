/**
 * Backup na nuvem: mantém os dados deste aparelho iguais aos da conta da pessoa no Supabase.
 *
 * - Cada alteração vai para a nuvem alguns segundos depois. Sem internet, fica pendente e sobe quando voltar.
 * - Ao abrir o app, ao voltar para ele e a cada poucos minutos, confere se outro aparelho mudou algo.
 * - Se os dois mudaram, junta registro por registro (js/core/sync.js) em vez de um apagar o outro.
 * - Celular novo ou app em branco: entrar na conta traz tudo de volta.
 *
 * Nada disso acontece sem a pessoa criar conta e entrar. Os dados continuam também no aparelho,
 * então o app funciona igual sem internet.
 */
(function (root) {
  const FM = (root.FM = root.FM || {});
  const { sync, backend } = FM;

  const META_KEY = 'sobra.nuvem';
  const BASE_KEY = 'sobra.nuvem.base';
  const PUSH_DELAY_MS = 2500;
  const CHECK_EVERY_MS = 5 * 60 * 1000;

  /** status: off | idle | pending | syncing | offline | error | choice */
  const view = { status: 'off', lastSync: null, error: null, choice: null };
  const listeners = new Set();
  let store = null;
  let applying = false;
  let running = null;
  let again = false;
  let pushTimer = null;

  /* ---------- O que fica guardado no aparelho ---------- */

  function readMeta() {
    try {
      return JSON.parse(root.localStorage.getItem(META_KEY) || 'null') || {};
    } catch {
      return {};
    }
  }

  function writeMeta(changes) {
    const meta = { ...readMeta(), ...changes };
    try {
      root.localStorage.setItem(META_KEY, JSON.stringify(meta));
    } catch {
      // Sem armazenamento, a nuvem ainda funciona nesta sessão; só vai juntar sem base na próxima.
    }
    return meta;
  }

  /** Como os dados estavam na última vez que este aparelho e a nuvem concordaram (a base da junção). */
  function readBase() {
    try {
      return JSON.parse(root.localStorage.getItem(BASE_KEY) || 'null');
    } catch {
      return null;
    }
  }

  function writeBase(state) {
    try {
      if (state) root.localStorage.setItem(BASE_KEY, JSON.stringify(state));
      else root.localStorage.removeItem(BASE_KEY);
    } catch {
      root.localStorage.removeItem?.(BASE_KEY);
    }
  }

  function setView(changes) {
    Object.assign(view, changes);
    listeners.forEach((listener) => listener(view));
  }

  const enabled = () => backend.configured();
  const signedIn = () => enabled() && backend.hasSession();

  /** A conta mudou desde a última sincronização? Então este aparelho ainda não está ligado a ela. */
  function linkedToCurrentUser() {
    const user = backend.currentUser();
    const meta = readMeta();
    return Boolean(user?.id && meta.userId === user.id && meta.revision > 0);
  }

  function deviceId() {
    return FM.telemetry?.deviceId?.() || readMeta().device || writeMeta({ device: FM.storeLib.uid() }).device;
  }

  /* ---------- Conversa com a nuvem ---------- */

  async function fetchRemote() {
    const result = await backend.selectAsUser('vaults?select=data,revision,updated_at&limit=1');
    if (!result.ok) return { ok: false, result };
    const row = Array.isArray(result.data) ? result.data[0] : null;
    return { ok: true, row: row ? { data: row.data, revision: Number(row.revision), updatedAt: row.updated_at } : null };
  }

  async function pushState(state, baseRevision) {
    const result = await backend.rpcAsUser('save_vault', { p_data: state, p_base_revision: baseRevision, p_device: deviceId() });
    if (!result.ok) return { ok: false, result };
    return { ok: true, status: result.data?.status, revision: Number(result.data?.revision) || 0 };
  }

  /** Troca os dados do aparelho pelos da nuvem, sem isso contar como alteração a enviar. */
  function adopt(remoteState) {
    applying = true;
    try {
      store.adopt(remoteState);
    } finally {
      applying = false;
    }
    // Abrir o app pode ter criado o lançamento do mês de uma conta fixa: isso precisa subir.
    return !sync.same(store.state, remoteState);
  }

  function linked(revision, state) {
    writeMeta({ userId: backend.currentUser()?.id, revision, dirty: false, lastSync: new Date().toISOString() });
    writeBase(state);
  }

  function failed(result) {
    if (result?.status === 0) return setView({ status: 'offline', error: null });
    if (result?.status === 401) return setView({ status: 'off', error: null });
    return setView({ status: 'error', error: result?.data?.message || 'A nuvem não respondeu como esperado.' });
  }

  /**
   * Um ciclo completo: busca a versão da nuvem, junta se preciso e envia o que mudou aqui.
   * Nunca lança exceção: qualquer falha vira um estado na tela, e os dados do aparelho ficam intactos.
   */
  async function cycle() {
    if (!store || !signedIn()) return setView({ status: 'off' });
    if (view.status === 'choice') return undefined;
    setView({ status: 'syncing', error: null });

    for (let attempt = 0; attempt < 3; attempt++) {
      const remote = await fetchRemote();
      if (!remote.ok) return failed(remote.result);
      const meta = readMeta();
      const local = store.state;

      // Primeira vez deste aparelho nesta conta.
      if (!linkedToCurrentUser()) {
        if (!remote.row) {
          if (sync.isBlank(local)) return setView({ status: 'idle', lastSync: meta.lastSync || null });
          const pushed = await pushState(local, 0);
          if (!pushed.ok) return failed(pushed.result);
          if (pushed.status !== 'ok') continue;
          linked(pushed.revision, local);
          return setView({ status: 'idle', lastSync: new Date().toISOString() });
        }
        if (sync.isBlank(local) || sync.same(local, remote.row.data)) {
          const changed = adopt(remote.row.data);
          linked(remote.row.revision, remote.row.data);
          if (changed) {
            writeMeta({ dirty: true });
            continue;
          }
          return setView({ status: 'idle', lastSync: new Date().toISOString() });
        }
        // Os dois lados têm dados diferentes: a pessoa escolhe.
        return setView({ status: 'choice', choice: { remote: remote.row } });
      }

      const base = readBase();
      // A nuvem foi apagada (ou a conta recriada): este aparelho volta a ser a fonte.
      if (!remote.row) {
        const pushed = await pushState(local, 0);
        if (!pushed.ok) return failed(pushed.result);
        if (pushed.status !== 'ok') continue;
        linked(pushed.revision, local);
        return setView({ status: 'idle', lastSync: new Date().toISOString() });
      }

      let next = local;
      let baseRevision = meta.revision;
      if (remote.row.revision !== meta.revision) {
        // Outro aparelho gravou. Sem nada novo aqui, só traz; com mudanças aqui, junta.
        if (!meta.dirty) {
          const changed = adopt(remote.row.data);
          linked(remote.row.revision, remote.row.data);
          if (changed) {
            writeMeta({ dirty: true });
            continue;
          }
          return setView({ status: 'idle', lastSync: new Date().toISOString() });
        }
        next = base ? sync.merge(base, local, remote.row.data) : sync.mergeWithoutBase(local, remote.row.data);
        adopt(next);
        next = store.state;
        baseRevision = remote.row.revision;
      } else if (!meta.dirty || (base && sync.same(local, base))) {
        // Nada mudou aqui (ou mudou e voltou ao que a nuvem já tem): não precisa enviar.
        writeMeta({ dirty: false, lastSync: new Date().toISOString() });
        return setView({ status: 'idle', lastSync: new Date().toISOString() });
      }

      const pushed = await pushState(next, baseRevision);
      if (!pushed.ok) return failed(pushed.result);
      if (pushed.status === 'ok') {
        // Algo mudou aqui enquanto enviava? Continua pendente e vai no próximo ciclo.
        const changedMeanwhile = !sync.same(store.state, next);
        linked(pushed.revision, next);
        if (changedMeanwhile) {
          writeMeta({ dirty: true });
          continue;
        }
        return setView({ status: 'idle', lastSync: new Date().toISOString() });
      }
      // Conflito: outro aparelho gravou no meio do caminho. Busca de novo e junta.
    }
    return setView({ status: 'error', error: 'Outro aparelho está gravando ao mesmo tempo. Tentando de novo em instantes.' });
  }

  /** Roda um ciclo; se pedirem outro durante, roda mais um no fim. */
  function syncNow() {
    if (running) {
      again = true;
      return running;
    }
    running = cycle()
      .catch(() => setView({ status: 'error', error: 'Algo deu errado ao sincronizar. Seus dados continuam neste aparelho.' }))
      .finally(() => {
        running = null;
        if (again) {
          again = false;
          syncNow();
        }
      });
    return running;
  }

  function schedulePush() {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => syncNow(), PUSH_DELAY_MS);
  }

  /** A pessoa escolheu o que fazer quando o aparelho e a nuvem tinham dados diferentes. */
  async function resolveChoice(option) {
    const remote = view.choice?.remote;
    if (!remote) return;
    setView({ status: 'syncing', choice: null });
    if (option === 'cloud') {
      const changed = adopt(remote.data);
      linked(remote.revision, remote.data);
      if (changed) writeMeta({ dirty: true });
    } else if (option === 'merge') {
      const merged = sync.mergeWithoutBase(store.state, remote.data);
      adopt(merged);
      writeMeta({ userId: backend.currentUser()?.id, revision: remote.revision, dirty: true });
      writeBase(remote.data);
    } else {
      // Este aparelho vence: grava por cima da nuvem (a versão anterior fica no histórico do servidor).
      writeMeta({ userId: backend.currentUser()?.id, revision: remote.revision, dirty: true });
      writeBase(remote.data);
    }
    setView({ status: 'idle' });
    await syncNow();
  }

  /** Sai da conta neste aparelho. Os dados continuam aqui; só param de ir para a nuvem. */
  async function signOut() {
    await backend.signOut();
    writeMeta({ userId: null, revision: 0, dirty: false, lastSync: null });
    writeBase(null);
    setView({ status: 'off', choice: null, lastSync: null });
  }

  /** Exclui a conta e tudo o que estava na nuvem. Os dados deste aparelho ficam. */
  async function deleteAccount() {
    const result = await backend.rpcAsUser('delete_my_account', {});
    if (!result.ok) return { ok: false, status: result.status };
    await signOut();
    return { ok: true };
  }

  function start(appStore) {
    store = appStore;
    if (!enabled()) return;
    store.subscribe(() => {
      if (applying || !signedIn()) return;
      writeMeta({ dirty: true });
      if (view.status !== 'choice') setView({ status: 'pending' });
      schedulePush();
    });
    backend.onAuthChange((session) => {
      if (!session) setView({ status: 'off', choice: null });
    });
    root.addEventListener('online', () => syncNow());
    root.document.addEventListener('visibilitychange', () => {
      if (root.document.visibilityState === 'visible') syncNow();
    });
    root.setInterval(() => {
      if (root.document.visibilityState === 'visible') syncNow();
    }, CHECK_EVERY_MS);
    if (signedIn()) {
      setView({ status: readMeta().dirty ? 'pending' : 'idle', lastSync: readMeta().lastSync || null });
      syncNow();
    }
  }

  FM.cloud = {
    start,
    syncNow,
    resolveChoice,
    signOut,
    deleteAccount,
    enabled,
    signedIn,
    status: () => view,
    onChange: (listener) => listeners.add(listener),
  };
})(globalThis);
