/**
 * Contagem de instalações: quantos aparelhos usam o Sobra e quais (sistema, navegador, modelo, tela).
 *
 * O que sai do aparelho: um identificador aleatório criado aqui e os dados técnicos acima. Nada mais.
 * Nenhum lançamento, saldo, nome ou e-mail é lido por este arquivo.
 *
 * Só envia depois que a pessoa responde ao aviso da primeira abertura, e nunca se ela recusar.
 * Qualquer falha (sem rede, servidor fora do ar) é ignorada em silêncio: o app não depende disso.
 */
(function (root) {
  const FM = (root.FM = root.FM || {});

  const ID_KEY = 'sobra.aparelho.id';
  const CONSENT_KEY = 'sobra.aparelho.consentimento';
  const SENT_KEY = 'sobra.aparelho.envio';
  const listeners = new Set();

  const read = (key) => {
    try {
      return root.localStorage.getItem(key);
    } catch {
      return null;
    }
  };

  const write = (key, value) => {
    try {
      root.localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  };

  const enabled = () => Boolean(FM.backend && FM.backend.configured());

  /** 'aceito', 'recusado' ou null, quando a pessoa ainda não respondeu. */
  const consent = () => {
    const value = read(CONSENT_KEY);
    return value === 'aceito' || value === 'recusado' ? value : null;
  };

  const needsNotice = () => enabled() && consent() === null;

  function isStandalone() {
    return root.matchMedia('(display-mode: standalone)').matches || root.navigator.standalone === true;
  }

  function newId() {
    if (root.crypto?.randomUUID) return root.crypto.randomUUID();
    // Navegadores antigos: monta um UUID v4 com os mesmos números aleatórios seguros.
    const bytes = root.crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  function deviceId() {
    let id = read(ID_KEY);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id || '')) {
      id = newId();
      // Sem conseguir guardar o id, cada abertura contaria como um aparelho novo: melhor não enviar.
      if (!write(ID_KEY, id)) return null;
    }
    return id;
  }

  /** Sistema, navegador e modelo. O Chrome informa o modelo por userAgentData; nos outros, vem do user agent. */
  async function describe() {
    const { navigator, screen } = root;
    let info = FM.device.parseUserAgent(navigator.userAgent, { maxTouchPoints: navigator.maxTouchPoints });
    try {
      const data = navigator.userAgentData;
      if (data?.getHighEntropyValues) {
        const hints = await data.getHighEntropyValues(['model', 'platformVersion']);
        info = FM.device.withClientHints(info, { platform: data.platform, brands: data.brands, ...hints });
      }
    } catch {
      // O navegador pode negar esses detalhes; fica valendo o que veio do user agent.
    }
    const ratio = Math.round((root.devicePixelRatio || 1) * 100) / 100;
    return { ...info, screen: `${screen.width}x${screen.height}@${ratio}` };
  }

  let sending = false;

  /**
   * Registra o aparelho na primeira vez e, depois, só renova a data de último uso, no máximo uma vez por dia.
   * force ignora o limite diário; installed marca que o app acabou de ser instalado.
   */
  async function ping({ force = false, installed = false } = {}) {
    try {
      if (sending || !enabled() || consent() !== 'aceito') return false;
      const standalone = installed || isStandalone();
      const today = FM.dates.today();
      const version = FM.config.appVersion;
      let last = null;
      try {
        last = JSON.parse(read(SENT_KEY) || 'null');
      } catch {
        last = null;
      }
      const upToDate = last && last.day === today && last.version === version && (last.standalone || !standalone);
      if (!force && upToDate) return false;

      const id = deviceId();
      if (!id) return false;
      sending = true;
      const info = await describe();
      const result = await FM.backend.rpc('register_install', {
        p_id: id,
        p_os: info.os,
        p_os_version: info.osVersion,
        p_browser: info.browser,
        p_device_model: info.model,
        p_is_standalone: standalone,
        p_screen: info.screen,
        p_app_version: version,
      });
      if (result.ok) write(SENT_KEY, JSON.stringify({ day: today, version, standalone: standalone || Boolean(last?.standalone) }));
      return result.ok;
    } catch {
      return false;
    } finally {
      sending = false;
    }
  }

  function setConsent(accepted) {
    write(CONSENT_KEY, accepted ? 'aceito' : 'recusado');
    listeners.forEach((listener) => listener());
    if (accepted) ping({ force: true });
  }

  function start() {
    if (!enabled()) return;
    // Depois que a tela já apareceu, para não disputar a abertura do app.
    const later = root.requestIdleCallback || ((fn) => setTimeout(fn, 1500));
    later(() => ping());
    root.addEventListener('appinstalled', () => ping({ force: true, installed: true }));
    root.matchMedia('(display-mode: standalone)').addEventListener?.('change', () => ping());
  }

  start();

  FM.telemetry = {
    enabled,
    consent,
    needsNotice,
    accept: () => setConsent(true),
    refuse: () => setConsent(false),
    setConsent,
    ping,
    deviceId: () => read(ID_KEY),
    onChange: (listener) => listeners.add(listener),
  };
})(globalThis);
