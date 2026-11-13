/**
 * Avisos do celular: "a conta de luz vence hoje", "fatura vence amanhã", "orçamento de Lazer quase no limite".
 *
 * - A pessoa liga em Ajustes (o navegador pede permissão). Desligado por padrão.
 * - Ao abrir o app, ao voltar para ele e uma vez por hora com ele aberto, mostra o que ainda não foi avisado hoje.
 * - Com o app fechado: onde o aparelho deixa (Chrome no Android, com o app instalado), o service worker acorda
 *   cerca de uma vez por dia (Periodic Background Sync) e avisa a partir de uma lista que o app deixa pronta para
 *   os próximos 7 dias. Em outros aparelhos, os avisos chegam quando o app é aberto.
 * - Cada aviso tem uma chave: o mesmo aviso não se repete.
 */
(function (root) {
  const FM = (root.FM = root.FM || {});

  const SETTING_KEY = 'sobra.avisos';
  const CACHE = 'lembretes-sobra';
  const PLAN_URL = 'lembretes/plano.json';
  const SENT_URL = 'lembretes/enviados.json';
  const listeners = new Set();
  let store = null;

  const supported = () => 'Notification' in root && 'serviceWorker' in root.navigator && /^https?:$/.test(root.location.protocol);
  const permission = () => (supported() ? root.Notification.permission : 'unsupported');

  function enabled() {
    try {
      return root.localStorage.getItem(SETTING_KEY) === 'on' && permission() === 'granted';
    } catch {
      return false;
    }
  }

  function setSetting(on) {
    try {
      root.localStorage.setItem(SETTING_KEY, on ? 'on' : 'off');
    } catch {
      // Sem armazenamento, os avisos valem só nesta sessão.
    }
    listeners.forEach((l) => l());
  }

  async function readJson(url, fallback) {
    try {
      const cache = await root.caches.open(CACHE);
      const response = await cache.match(url);
      return response ? await response.json() : fallback;
    } catch {
      return fallback;
    }
  }

  async function writeJson(url, value) {
    try {
      const cache = await root.caches.open(CACHE);
      await cache.put(url, new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } }));
    } catch {
      // Sem Cache Storage, os avisos só saem com o app aberto.
    }
  }

  /** Lembretes de hoje e dos próximos 7 dias, cada um com o dia em que deve ser avisado. */
  function plan() {
    const today = store.today();
    const items = [];
    for (let i = 0; i <= 7; i++) {
      const day = FM.dates.addDays(today, i);
      for (const r of FM.reminders.reminders(store.state, day)) {
        // Orçamento só faz sentido avisar hoje: amanhã os números já serão outros.
        if (i > 0 && r.kind === 'budget') continue;
        items.push({ day, key: r.key, title: r.title, body: r.body, url: r.url });
      }
    }
    return { createdAt: new Date().toISOString(), items };
  }

  /** Mostra os avisos de hoje que ainda não saíram. */
  async function notifyDue() {
    if (!store || !enabled()) return 0;
    const next = plan();
    await writeJson(PLAN_URL, next);
    const today = store.today();
    const sent = await readJson(SENT_URL, {});
    const registration = await root.navigator.serviceWorker.ready;
    let shown = 0;
    for (const item of next.items) {
      if (item.day !== today || sent[item.key]) continue;
      await registration.showNotification(item.title, {
        body: item.body,
        tag: item.key,
        icon: 'assets/icone-192.png',
        badge: 'assets/icone-192.png',
        data: { url: item.url },
      });
      sent[item.key] = today;
      shown++;
    }
    // Guarda só as chaves dos últimos 40 dias.
    const cutoff = FM.dates.addDays(today, -40);
    for (const key of Object.keys(sent)) if (sent[key] < cutoff) delete sent[key];
    await writeJson(SENT_URL, sent);
    return shown;
  }

  /** Liga os avisos: pede a permissão e, onde dá, agenda a checagem diária com o app fechado. */
  async function enable() {
    if (!supported()) return { ok: false, reason: 'unsupported' };
    let result = root.Notification.permission;
    if (result === 'default') result = await root.Notification.requestPermission();
    if (result !== 'granted') {
      setSetting(false);
      return { ok: false, reason: result };
    }
    setSetting(true);
    try {
      const registration = await root.navigator.serviceWorker.ready;
      if (registration.periodicSync) {
        const status = await root.navigator.permissions.query({ name: 'periodic-background-sync' });
        if (status.state === 'granted') await registration.periodicSync.register('lembretes', { minInterval: 12 * 60 * 60 * 1000 });
      }
    } catch {
      // Sem checagem em segundo plano: os avisos saem quando o app é aberto.
    }
    await notifyDue();
    return { ok: true };
  }

  async function disable() {
    setSetting(false);
    try {
      const registration = await root.navigator.serviceWorker.ready;
      await registration.periodicSync?.unregister('lembretes');
    } catch {
      // Nada a desfazer.
    }
    await writeJson(PLAN_URL, { items: [] });
  }

  function start(appStore) {
    store = appStore;
    if (!supported()) return;
    const run = () => {
      if (root.document.visibilityState === 'visible') notifyDue().catch(() => {});
    };
    setTimeout(run, 2000);
    root.document.addEventListener('visibilitychange', run);
    root.setInterval(run, 60 * 60 * 1000);
    // Qualquer mudança nos dados refaz o plano para o service worker.
    store.subscribe(() => {
      if (enabled()) writeJson(PLAN_URL, plan());
    });
  }

  FM.notifications = {
    start,
    enable,
    disable,
    enabled,
    supported,
    permission,
    notifyDue,
    onChange: (listener) => listeners.add(listener),
  };
})(globalThis);
