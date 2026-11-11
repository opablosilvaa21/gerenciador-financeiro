/**
 * O que faz o Sobra Finance funcionar como aplicativo: instalar na tela inicial e abrir sem internet.
 * Aberto direto pelo arquivo (file://) nada disso existe, e o resto do app funciona igual.
 */
(function (root) {
  const FM = (root.FM = root.FM || {});
  const { el, openDialog } = FM.dom;

  const DISMISS_KEY = 'sobra.instalar.dispensado';
  const served = root.location.protocol !== 'file:';
  const listeners = new Set();
  let installEvent = null;

  const notify = () => listeners.forEach((listener) => listener());

  function isInstalled() {
    return root.matchMedia('(display-mode: standalone)').matches || root.navigator.standalone === true;
  }

  function isIos() {
    const { userAgent, platform, maxTouchPoints } = root.navigator;
    return /iPhone|iPad|iPod/.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1);
  }

  /** O celular pode apagar os dados de um site; de um app instalado, o pedido costuma ser aceito. */
  function keepData() {
    root.navigator.storage?.persist?.().catch(() => {});
  }

  function readDismissed() {
    try {
      return root.localStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      return false;
    }
  }

  function dismissOffer() {
    try {
      root.localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // Sem armazenamento, o convite volta na próxima visita. Nada se perde.
    }
    notify();
  }

  /** Só faz sentido oferecer a instalação no endereço publicado e fora do app já instalado. */
  const canOffer = () => served && !isInstalled();

  /** O convite na tela só aparece em aparelho de toque, e uma vez dispensado não volta. */
  const showOffer = () => canOffer() && root.matchMedia('(pointer: coarse)').matches && !readDismissed();

  function showInstructions() {
    openDialog({
      title: 'Instalar o Sobra Finance',
      description: isIos()
        ? 'No Safari, toque em Compartilhar e depois em Adicionar à Tela de Início.'
        : 'No menu do navegador, toque em Instalar aplicativo ou em Adicionar à tela inicial.',
      body: null,
    });
  }

  async function install() {
    if (!installEvent) {
      showInstructions();
      return;
    }
    const event = installEvent;
    installEvent = null;
    await event.prompt();
    await event.userChoice;
    notify();
  }

  function start() {
    if (!served) return;
    document.head.append(el('link', { rel: 'manifest', href: 'manifest.webmanifest' }));

    root.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      installEvent = event;
      notify();
    });
    root.addEventListener('appinstalled', () => {
      installEvent = null;
      keepData();
      notify();
    });
    if (isInstalled()) keepData();

    if ('serviceWorker' in root.navigator) {
      root.addEventListener('load', () => {
        root.navigator.serviceWorker
          .register('sw.js')
          .then((registration) => watchUpdates(registration))
          .catch((error) => console.warn('Sem modo offline:', error));
      });
    }
  }

  /* ---------- Atualização automática ---------- */

  const CHECK_EVERY_MS = 30 * 60 * 1000;
  let updateReady = false;
  let reloading = false;

  /** Recarregar agora não atrapalha? Nada de formulário aberto nem campo sendo digitado. */
  function isIdle() {
    const active = root.document.activeElement;
    const typing = active && (active.matches?.('input, select, textarea') || active.isContentEditable);
    return !root.document.querySelector('dialog[open]') && !typing;
  }

  function reload() {
    if (reloading) return;
    reloading = true;
    root.location.reload();
  }

  /** A versão nova já está instalada. Os dados ficam no localStorage, então recarregar não perde nada. */
  function applyUpdate() {
    if (root.document.visibilityState === 'hidden' || isIdle()) {
      reload();
      return;
    }
    // A pessoa está no meio de algo: avisa, e aplica sozinho quando ela sair do app ou terminar o que fazia.
    if (updateReady) return;
    updateReady = true;
    notify();
    const waiting = root.setInterval(() => {
      if (!isIdle()) return;
      root.clearInterval(waiting);
      reload();
    }, 1000);
  }

  /**
   * Cada publicação muda o sw.js (ver BUILD lá). O navegador instala a versão nova, ela assume a página
   * (controllerchange) e a página se recarrega. Para perceber cedo, confere ao voltar para o app e a cada 30 min.
   */
  function watchUpdates(registration) {
    const sw = root.navigator.serviceWorker;
    // Na primeira visita o service worker também "assume" a página: isso não é atualização.
    let controlled = Boolean(sw.controller);
    sw.addEventListener('controllerchange', () => {
      if (!controlled) {
        controlled = true;
        return;
      }
      applyUpdate();
    });

    const check = () => registration.update().catch(() => {});
    root.document.addEventListener('visibilitychange', () => {
      if (root.document.visibilityState === 'visible') check();
      else if (updateReady) reload();
    });
    root.setInterval(check, CHECK_EVERY_MS);
  }

  start();

  FM.pwa = {
    canOffer,
    showOffer,
    dismissOffer,
    install,
    updateReady: () => updateReady,
    applyNow: reload,
    onChange: (listener) => listeners.add(listener),
  };
})(globalThis);
