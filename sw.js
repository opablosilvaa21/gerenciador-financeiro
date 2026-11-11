/**
 * Deixa o Sobra abrir sem internet. Com internet, busca sempre a versão nova e guarda uma cópia;
 * sem internet, ou com a rede lenta demais, usa a última cópia.
 * Os dados da pessoa não passam por aqui: ficam no localStorage.
 */
const CACHE = 'sobra-v3';
const TIMEOUT_MS = 3000;

const FILES = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/tokens.css',
  'css/app.css',
  'assets/icone.svg',
  'assets/icone-192.png',
  'assets/fonts/space-grotesk.woff2',
  'assets/fonts/jetbrains-mono.woff2',
  'js/config.js',
  'js/core/money.js',
  'js/core/dates.js',
  'js/core/store.js',
  'js/core/queries.js',
  'js/core/demo.js',
  'js/core/device.js',
  'js/ui/dom.js',
  'js/ui/motion.js',
  'js/ui/charts.js',
  'js/ui/note.js',
  'js/ui/common.js',
  'js/ui/tx-form.js',
  'js/ui/pwa.js',
  'js/ui/backend.js',
  'js/ui/telemetry.js',
  'js/views/home.js',
  'js/views/transactions.js',
  'js/views/planning.js',
  'js/views/more.js',
  'js/views/admin.js',
  'js/app.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  // O endereço é dividido com outros projetos do mesmo usuário no GitHub Pages: só mexe nas cópias do Sobra.
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith('sobra-') && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  const network = fetch(request).then(async (response) => {
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
