/**
 * Microinterações: onda ao tocar, brilho que segue o ponteiro nos cartões, contagem dos valores,
 * entrada das telas e dos gráficos, e vibração curta ao salvar.
 * Com "reduzir movimento" ligado no aparelho, nada disso anima: os valores e gráficos já aparecem prontos.
 */
(function (root) {
  const FM = (root.FM = root.FM || {});
  const doc = root.document;

  const reducedQuery = root.matchMedia ? root.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const reduced = () => !reducedQuery || reducedQuery.matches;

  const RIPPLE_HOSTS = '.button, .tab, .chip-button, .chip, .segment, .icon-button, .nav-link, .more-link';
  const REVEAL_UNITS = '.chart, .rule, .meter';
  const ENTER_MS = 900;
  const COUNT_MS = 850;
  const REVEAL_MS = 1500;

  /* ---------- Onda ao tocar ---------- */

  function ripple(event) {
    if (reduced() || event.button > 0) return;
    const target = event.target.closest ? event.target : null;
    if (!target) return;
    const host = target.closest('.tab-new')?.querySelector('.tab-new-mark') || target.closest(RIPPLE_HOSTS);
    if (!host || host.disabled) return;
    const box = host.getBoundingClientRect();
    const size = Math.max(box.width, box.height) * 2.2;
    const wave = doc.createElement('span');
    wave.className = 'ripple';
    wave.style.width = wave.style.height = `${size}px`;
    wave.style.left = `${event.clientX - box.left - size / 2}px`;
    wave.style.top = `${event.clientY - box.top - size / 2}px`;
    host.append(wave);
    const remove = () => wave.remove();
    wave.addEventListener('animationend', remove, { once: true });
    setTimeout(remove, 800);
  }

  /* ---------- Brilho que segue o ponteiro nos cartões ---------- */

  let glowFrame = 0;

  function glow(event) {
    const card = event.target.closest?.('.card, .note');
    if (!card) return;
    if (event.type === 'pointerdown' && event.pointerType === 'touch') {
      card.classList.add('is-touched');
      setTimeout(() => card.classList.remove('is-touched'), 650);
    }
    if (glowFrame) return;
    const { clientX, clientY } = event;
    glowFrame = root.requestAnimationFrame(() => {
      glowFrame = 0;
      const box = card.getBoundingClientRect();
      card.style.setProperty('--mx', `${Math.round(clientX - box.left)}px`);
      card.style.setProperty('--my', `${Math.round(clientY - box.top)}px`);
    });
  }

  /* ---------- Contagem dos valores ---------- */

  /** Todo elemento com data-count (centavos) conta de zero até o valor. O texto final é sempre o exato. */
  function countUp(scope) {
    const nodes = [...scope.querySelectorAll('[data-count]')];
    if (!nodes.length || reduced()) return;
    const items = nodes
      .map((node) => ({ node, cents: Number(node.dataset.count), final: node.textContent }))
      .filter((item) => Number.isFinite(item.cents) && item.cents !== 0);
    if (!items.length) return;
    const start = root.performance.now();
    const tick = (now) => {
      const progress = Math.min((now - start) / COUNT_MS, 1);
      const eased = 1 - (1 - progress) ** 4;
      for (const item of items) {
        if (!item.node.isConnected) continue;
        item.node.textContent = progress < 1 ? FM.money.format(Math.round(item.cents * eased)) : item.final;
      }
      if (progress < 1 && items.some((item) => item.node.isConnected)) root.requestAnimationFrame(tick);
    };
    root.requestAnimationFrame(tick);
  }

  /* ---------- Gráficos que animam ao entrar na tela ---------- */

  function reveal(scope) {
    if (reduced() || !('IntersectionObserver' in root)) return;
    const units = [...scope.querySelectorAll(REVEAL_UNITS)];
    if (!units.length) return;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const unit = entry.target;
        observer.unobserve(unit);
        unit.dataset.reveal = 'in';
        setTimeout(() => unit.removeAttribute('data-reveal'), REVEAL_MS);
      }
    }, { threshold: 0.2 });
    for (const unit of units) {
      unit.dataset.reveal = 'wait';
      observer.observe(unit);
    }
    // Se a tela for trocada antes de tudo aparecer, o observador não fica preso a elementos soltos.
    setTimeout(() => {
      if (!scope.isConnected) observer.disconnect();
    }, 4000);
  }

  /** Chamado quando uma tela abre (troca de rota ou primeira abertura), não a cada alteração nos dados. */
  function enter(view) {
    if (!view || reduced()) return;
    view.classList.add('is-entering');
    setTimeout(() => view.classList.remove('is-entering'), ENTER_MS);
    countUp(view);
    reveal(view);
  }

  /** Vibração curta de confirmação. Só existe em alguns aparelhos (não no iPhone); onde não há, não faz nada. */
  function haptic(pattern = 12) {
    try {
      if (typeof root.navigator.vibrate === 'function') root.navigator.vibrate(pattern);
    } catch {
      // Alguns navegadores bloqueiam a vibração fora de um toque: não é erro do app.
    }
  }

  if (doc) {
    doc.addEventListener('pointerdown', ripple, { passive: true });
    doc.addEventListener('pointerdown', glow, { passive: true });
    doc.addEventListener('pointermove', glow, { passive: true });
    // No iPhone, o estado :active só funciona se a página escutar o toque.
    doc.addEventListener('touchstart', () => {}, { passive: true });
  }

  FM.motion = { enter, countUp, haptic, reduced };
})(globalThis);
