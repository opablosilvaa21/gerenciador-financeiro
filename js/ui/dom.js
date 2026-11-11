/**
 * Peças de interface: criação de elementos, ícones, diálogos, avisos e dica flutuante.
 * Texto entra sempre como nó de texto, nunca como HTML: nada que a pessoa digita vira código na página.
 */
(function (root) {
  const FM = (root.FM = root.FM || {});
  const SVG_NS = 'http://www.w3.org/2000/svg';

  function apply(node, props, isSvg) {
    for (const [key, value] of Object.entries(props || {})) {
      if (value == null || value === false) continue;
      if (key === 'class') node.setAttribute('class', value);
      else if (key === 'style' && typeof value === 'object') {
        for (const [name, v] of Object.entries(value)) node.style.setProperty(name, v);
      } else if (key === 'dataset') Object.assign(node.dataset, value);
      else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
      else if (!isSvg && key in node && key !== 'list' && key !== 'form') node[key] = value;
      else node.setAttribute(key, value === true ? '' : value);
    }
  }

  function append(node, children) {
    for (const child of children.flat(Infinity)) {
      if (child == null || child === false) continue;
      node.append(child instanceof Node ? child : String(child));
    }
  }

  function el(tag, props, ...children) {
    const node = document.createElement(tag);
    apply(node, props, false);
    append(node, children);
    return node;
  }

  function svg(tag, props, ...children) {
    const node = document.createElementNS(SVG_NS, tag);
    apply(node, props, true);
    append(node, children);
    return node;
  }

  const ICONS = {
    plus: 'M12 5v14M5 12h14',
    left: 'M15 18l-6-6 6-6',
    right: 'M9 18l6-6-6-6',
    check: 'M5 12.5l4.5 4.5L19 7.5',
    close: 'M6 6l12 12M18 6L6 18',
    search: 'M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14zM20 20l-3.8-3.8',
    trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13',
    edit: 'M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4',
    alert: 'M12 4l9 16H3L12 4zM12 10v4M12 17.5v.5',
    clock: 'M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18zM12 7v5l3.5 2',
    swap: 'M7 4v14M7 18l-3-3M7 18l3-3M17 20V6M17 6l-3 3M17 6l3 3',
    up: 'M12 19V5M6 11l6-6 6 6',
    down: 'M12 5v14M6 13l6 6 6-6',
    download: 'M12 4v11M7 11l5 5 5-5M5 20h14',
    upload: 'M12 16V5M7 9l5-5 5 5M5 20h14',
    pause: 'M9 5v14M15 5v14',
    play: 'M8 5l11 7-11 7V5z',
    home: 'M4 11l8-7 8 7M6 9.5V20h12V9.5',
    list: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
    pie: 'M12 3a9 9 0 1 0 9 9h-9V3z',
    grid: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
    wallet: 'M4 7h15a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7zM4 7V6a1 1 0 0 1 1-1h11M16 13h.01',
    repeat: 'M17 3l4 4-4 4M21 7H8a4 4 0 0 0-4 4v1M7 21l-4-4 4-4M3 17h13a4 4 0 0 0 4-4v-1',
    target: 'M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8z',
    chart: 'M4 20h16M7 16v-5M12 16V6M17 16V9',
    sliders: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4',
    inbox: 'M4 13l2.5-8h11L20 13M4 13v6h16v-6M4 13h4.5a3.5 3.5 0 0 0 7 0H20',
  };

  function icon(name, size = 18) {
    return svg(
      'svg',
      { viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', class: 'icon' },
      svg('path', { d: ICONS[name] }),
    );
  }

  /** Blocos no lugar do conteúdo enquanto ele não chega, para a tela não ficar vazia nem pular. */
  function skeleton(label = 'Carregando') {
    const block = (kind) => el('span', { class: `sk sk-${kind}` });
    return el(
      'div',
      { class: 'skeleton', role: 'status', 'aria-label': label },
      block('title'),
      block('hero'),
      el('div', { class: 'sk-row' }, block('card'), block('card'), block('card'), block('card')),
      block('block'),
    );
  }

  /* ---------- Avisos com "Desfazer" ---------- */

  let toastTimer = null;

  function toast(message, { undo = null, tone = null } = {}) {
    const region = document.getElementById('toasts');
    region.replaceChildren();
    const box = el(
      'div',
      { class: `toast${tone ? ` toast-${tone}` : ''}` },
      el('span', {}, message),
      undo && el('button', {
        class: 'toast-action',
        type: 'button',
        onclick: () => {
          undo();
          region.replaceChildren();
        },
      }, 'Desfazer'),
    );
    region.append(box);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => box.remove(), undo ? 8000 : 4000);
  }

  /* ---------- Diálogos ---------- */

  /**
   * Abre um diálogo. O navegador cuida do foco preso e da tecla Esc.
   * Ao fechar, o foco volta para quem abriu (se esse elemento ainda existir).
   */
  function openDialog({ title, description = null, body, footer, wide = false, onClose = null }) {
    const opener = document.activeElement;
    const closeButton = el('button', { class: 'icon-button', type: 'button', 'aria-label': 'Fechar', onclick: () => close() }, icon('close'));
    const dialog = el(
      'dialog',
      { class: `dialog${wide ? ' dialog-wide' : ''}`, 'aria-labelledby': 'dialog-title' },
      el('header', { class: 'dialog-head' }, el('h2', { id: 'dialog-title' }, title), closeButton),
      description && el('p', { class: 'dialog-text' }, description),
      el('div', { class: 'dialog-body' }, body),
      footer && el('footer', { class: 'dialog-foot' }, footer),
    );

    let closed = false;
    function close() {
      if (closed) return;
      closed = true;
      dialog.close();
      dialog.remove();
      if (opener && opener.isConnected) opener.focus();
      if (onClose) onClose();
    }
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      close();
    });
    dialog.addEventListener('mousedown', (event) => {
      if (event.target === dialog) close();
    });

    document.body.append(dialog);
    dialog.showModal();
    const first = dialog.querySelector('[data-autofocus]');
    if (first) first.focus();
    return { close, dialog };
  }

  /** Pergunta de sim ou não. O botão diz exatamente o que vai acontecer. */
  function confirmDialog({ title, description, confirmLabel, danger = false, onConfirm }) {
    let handle = null;
    handle = openDialog({
      title,
      description,
      body: null,
      footer: [
        el('button', { class: 'button', type: 'button', onclick: () => handle.close() }, 'Cancelar'),
        el('button', {
          class: `button ${danger ? 'button-danger' : 'button-primary'}`,
          type: 'button',
          'data-autofocus': true,
          onclick: () => {
            handle.close();
            onConfirm();
          },
        }, confirmLabel),
      ],
    });
    return handle;
  }

  /* ---------- Campos de formulário ---------- */

  let fieldCount = 0;

  /** Campo com rótulo, dica e mensagem de erro ligados ao controle para leitores de tela. */
  function field(label, control, { hint = null, class: extra = '' } = {}) {
    const id = control.id || `campo-${++fieldCount}`;
    control.id = id;
    const errorId = `${id}-erro`;
    const error = el('p', { class: 'field-error', id: errorId, hidden: true });
    const box = el(
      'div',
      { class: `field ${extra}` },
      el('label', { for: id, class: 'field-label' }, label),
      control,
      hint && el('p', { class: 'field-hint' }, hint),
      error,
    );
    box.setError = (message) => {
      error.textContent = message || '';
      error.hidden = !message;
      control.setAttribute('aria-invalid', message ? 'true' : 'false');
      if (message) control.setAttribute('aria-describedby', errorId);
      else control.removeAttribute('aria-describedby');
    };
    return box;
  }

  /** Grupo de opções excludentes com aparência de botões. */
  function segmented(name, label, options, value, onChange) {
    return el(
      'div',
      { class: 'segmented', role: 'radiogroup', 'aria-label': label },
      options.map((option) =>
        el(
          'label',
          { class: 'segment' },
          el('input', {
            type: 'radio',
            name,
            value: option.value,
            checked: option.value === value,
            onchange: () => onChange(option.value),
          }),
          el('span', {}, option.label),
        ),
      ),
    );
  }

  /* ---------- Dica flutuante dos gráficos ---------- */

  const tip = {
    node: null,
    ensure() {
      if (!tip.node) {
        tip.node = el('div', { class: 'tip', role: 'status', hidden: true });
        document.body.append(tip.node);
        // No toque não existe tirar o ponteiro de cima: a dica some no toque seguinte ou ao rolar a tela.
        root.addEventListener('pointerdown', (event) => {
          if (event.pointerType === 'touch') tip.hide();
        }, true);
        root.addEventListener('scroll', () => tip.hide(), { passive: true });
      }
      return tip.node;
    },
    /** rows: [{ value, label, color? }]. title fica em cima. */
    show(x, y, title, rows) {
      const node = tip.ensure();
      node.replaceChildren(
        title ? el('div', { class: 'tip-title' }, title) : '',
        ...rows.map((row) =>
          el(
            'div',
            { class: 'tip-row' },
            row.color && el('span', { class: 'tip-key', style: { background: row.color } }),
            el('strong', {}, row.value),
            el('span', {}, row.label),
          ),
        ),
      );
      node.hidden = false;
      const box = node.getBoundingClientRect();
      const left = Math.min(Math.max(8, x + 14), window.innerWidth - box.width - 8);
      const top = y - box.height - 12 > 8 ? y - box.height - 12 : y + 16;
      node.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
    },
    hide() {
      if (tip.node) tip.node.hidden = true;
    },
  };

  /** Liga a dica a um elemento: ponteiro e foco de teclado mostram o mesmo conteúdo. */
  function withTip(node, getContent) {
    const showAt = (x, y) => {
      const { title, rows } = getContent();
      tip.show(x, y, title, rows);
    };
    node.addEventListener('pointermove', (event) => showAt(event.clientX, event.clientY));
    node.addEventListener('pointerdown', (event) => showAt(event.clientX, event.clientY));
    node.addEventListener('pointerleave', (event) => {
      if (event.pointerType !== 'touch') tip.hide();
    });
    node.addEventListener('focus', () => {
      const box = node.getBoundingClientRect();
      showAt(box.left + box.width / 2, box.top);
    });
    node.addEventListener('blur', () => tip.hide());
    return node;
  }

  /**
   * Entrega um texto como arquivo e diz se ele foi entregue. No celular abre o menu de compartilhar,
   * que deixa escolher onde salvar; se o aparelho não aceitar esse tipo de arquivo, baixa.
   */
  async function download(filename, content, type) {
    const file = new File([content], filename, { type });
    if (root.matchMedia('(pointer: coarse)').matches && root.navigator.canShare?.({ files: [file] })) {
      try {
        await root.navigator.share({ files: [file] });
        return true;
      } catch (error) {
        if (error.name === 'AbortError') return false;
      }
    }
    const url = URL.createObjectURL(file);
    const link = el('a', { href: url, download: filename });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  }

  /** Pede um arquivo à pessoa e entrega o texto. */
  function pickFile(accept, onText) {
    const input = el('input', {
      type: 'file',
      accept,
      onchange: async () => {
        const file = input.files[0];
        if (file) onText(await file.text(), file.name);
      },
    });
    input.click();
  }

  FM.dom = { el, svg, icon, skeleton, toast, openDialog, confirmDialog, field, segmented, tip, withTip, download, pickFile };
})(globalThis);
