/**
 * Deixa o Sobra abrir sem internet e faz toda publicação chegar a todos os aparelhos.
 *
 * Com internet, busca sempre a versão nova (revalidando com o servidor, sem confiar no cache do navegador)
 * e guarda uma cópia; sem internet, ou com a rede lenta demais, usa a última cópia.
 *
 * BUILD é trocado pela publicação automática (.github/workflows/publicar.yml) a cada envio para a main.
 * Como este arquivo muda a cada publicação, o navegador percebe que existe uma versão nova, instala esta,
 * e a página (js/ui/pwa.js) se recarrega para usá-la.
 *
 * Os dados da pessoa não passam por aqui: ficam no localStorage.
 */
const BUILD = '__BUILD__';
const CACHE = `sobra-${BUILD}`;
const TIMEOUT_MS = 3000;

const FILES = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/tokens.css',
  'css/app.css',
  'assets/icone.svg',
  'assets/icone-192.png',
  'assets/fonts/fraunces.woff2',
  'assets/fonts/inter.woff2',
  'assets/fonts/jetbrains-mono.woff2',
  'js/config.js',
  'js/core/money.js',
  'js/core/dates.js',
  'js/core/store.js',
  'js/core/queries.js',
  'js/core/demo.js',
  'js/core/cards.js',
  'js/core/reminders.js',
  'js/core/sync.js',
  'js/core/device.js',
  'js/ui/dom.js',
  'js/ui/motion.js',
  'js/ui/charts.js',
  'js/ui/note.js',
  'js/ui/common.js',
  'js/ui/tx-form.js',
  'js/ui/card.js',
  'js/ui/setup.js',
  'js/ui/pwa.js',
  'js/ui/backend.js',
  'js/ui/telemetry.js',
  'js/ui/cloud.js',
  'js/ui/reminders.js',
  'js/views/home.js',
  'js/views/transactions.js',
  'js/views/planning.js',
  'js/views/more.js',
  'js/views/admin.js',
  'js/views/cloud.js',
  'js/app.js',
];

self.addEventListener('install', (event) => {
  // cache: 'reload' busca direto no servidor: a cópia nova nunca sai do cache antigo do navegador.
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(FILES.map((file) => new Request(file, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  // O endereço é dividido com outros projetos do mesmo usuário no GitHub Pages: só mexe nas cópias do Sobra.
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith('sobra-') && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

/* ---------- Avisos com o app fechado ---------- */

// O app deixa pronto, em Cache Storage, o plano dos próximos 7 dias (js/ui/reminders.js). Onde o aparelho deixa,
// o navegador acorda este service worker cerca de uma vez por dia e ele avisa o que é de hoje e ainda não saiu.
const REMINDERS = 'lembretes-sobra';

async function readReminders(url, fallback) {
  const response = await (await caches.open(REMINDERS)).match(url);
  return response ? response.json() : fallback;
}

async function notifyFromPlan() {
  const plan = await readReminders('lembretes/plano.json', { items: [] });
  const sent = await readReminders('lembretes/enviados.json', {});
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  for (const item of plan.items || []) {
    if (item.day !== today || sent[item.key]) continue;
    await self.registration.showNotification(item.title, { body: item.body, tag: item.key, icon: 'assets/icone-192.png', badge: 'assets/icone-192.png', data: { url: item.url } });
    sent[item.key] = today;
  }
  await (await caches.open(REMINDERS)).put('lembretes/enviados.json', new Response(JSON.stringify(sent), { headers: { 'Content-Type': 'application/json' } }));
}

self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'lembretes') event.waitUntil(notifyFromPlan().catch(() => {}));
});

// Tocar no aviso abre o app (ou traz a janela aberta para a frente) na tela certa.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '#/inicio', self.registration.scope).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = windows.find((w) => w.url.startsWith(self.registration.scope));
    if (open) {
      await open.focus();
      return open.navigate(target);
    }
    return self.clients.openWindow(target);
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  // no-cache: pergunta ao servidor se mudou (resposta curta quando não mudou), em vez de usar a cópia do navegador.
  const network = fetch(request, { cache: 'no-cache' }).then(async (response) => {
    if (response.ok) {
      const copy = response.clone();
      await (await caches.open(CACHE)).put(request, copy);
    }
    return response;
  });
  // Mesmo se a cópia responder antes, a resposta da rede ainda atualiza o que está guardado.
  event.waitUntil(network.catch(() => {}));
  event.respondWith(respond(request, network));
});

async function respond(request, network) {
  const cache = await caches.open(CACHE);
  const cached = (await cache.match(request, { ignoreSearch: true })) || (request.mode === 'navigate' ? await cache.match('./') : undefined);
  if (!cached) return network;
  const slow = new Promise((resolve) => setTimeout(() => resolve(cached), TIMEOUT_MS));
  return Promise.race([network.catch(() => cached), slow]);
}
