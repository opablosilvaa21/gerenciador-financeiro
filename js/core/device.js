/**
 * Descobre que aparelho é este, só com o que o navegador informa: sistema, versão, navegador e modelo.
 * Nada daqui identifica a pessoa. Sem interface, para poder ser testado no Node.
 */
(function (root) {
  const FM = (root.FM = root.FM || {});

  const firstMatch = (regex, text) => (regex.exec(text) || [])[1] || null;

  function iosVersion(ua) {
    const match = /OS (\d+)_(\d+)(?:_(\d+))?/.exec(ua);
    return match ? match.slice(1).filter(Boolean).join('.') : null;
  }

  /** O Chrome novo esconde o modelo e escreve "K" no lugar; outros navegadores põem ali "Mobile" ou o idioma. */
  function androidModel(ua) {
    const raw = firstMatch(/Android[^;)]*;\s*([^;)]+)/, ua);
    if (!raw) return null;
    const model = raw.replace(/\s+Build\/.*$/, '').replace(/^SAMSUNG\s+/i, '').trim();
    if (!model || /^(K|wv|Mobile|Tablet|rv:[\d.]+|[a-z]{2}[-_][a-z]{2})$/i.test(model)) return null;
    return model;
  }

  function browserOf(ua) {
    const named = (name, regex) => {
      const major = firstMatch(regex, ua);
      return major ? `${name} ${major}` : null;
    };
    return (
      named('Edge', /Edg(?:e|A|iOS)?\/(\d+)/) ||
      named('Opera', /(?:OPR|OPT)\/(\d+)/) ||
      named('Samsung Internet', /SamsungBrowser\/(\d+)/) ||
      named('Firefox', /(?:FxiOS|Firefox)\/(\d+)/) ||
      named('Chrome', /CriOS\/(\d+)/) ||
      named(/; wv\)/.test(ua) ? 'WebView Android' : 'Chrome', /Chrome\/(\d+)/) ||
      named('Safari', /Version\/(\d+)[\d.]*.*Safari/) ||
      (/Safari/.test(ua) ? 'Safari' : 'Outro')
    );
  }

  /** Lê o user agent. É o caminho de quem não informa os dados de outro jeito, como o iPhone e o Firefox. */
  function parseUserAgent(ua = '', { maxTouchPoints = 0 } = {}) {
    let os = 'Outro';
    let osVersion = null;
    let model = null;
    // O iPad se apresenta como Mac; a tela de toque é o que entrega.
    const ipadAsMac = /Macintosh/.test(ua) && maxTouchPoints > 1;

    if (/iPhone|iPod/.test(ua)) {
      os = 'iOS';
      osVersion = iosVersion(ua);
      // No iPhone o modelo exato não é informado.
      model = /iPod/.test(ua) ? 'iPod touch' : 'iPhone';
    } else if (/iPad/.test(ua) || ipadAsMac) {
      os = 'iPadOS';
      osVersion = iosVersion(ua) || firstMatch(/Version\/(\d+(?:\.\d+)?)/, ua);
      model = 'iPad';
    } else if (/Android/.test(ua)) {
      os = 'Android';
      osVersion = firstMatch(/Android (\d+(?:\.\d+)*)/, ua);
      model = androidModel(ua);
    } else if (/Windows NT/.test(ua)) {
      os = 'Windows';
      const nt = firstMatch(/Windows NT (\d+\.\d+)/, ua);
      osVersion = { '10.0': '10 ou 11', '6.3': '8.1', '6.2': '8', '6.1': '7' }[nt] || nt;
    } else if (/CrOS/.test(ua)) {
      os = 'ChromeOS';
    } else if (/Mac OS X/.test(ua)) {
      os = 'macOS';
      osVersion = (firstMatch(/Mac OS X (\d+[_.]\d+(?:[_.]\d+)?)/, ua) || '').replace(/_/g, '.') || null;
    } else if (/Linux/.test(ua)) {
      os = 'Linux';
    }
    return { os, osVersion, browser: browserOf(ua), model };
  }

  const PLATFORMS = { Android: 'Android', Windows: 'Windows', macOS: 'macOS', 'Chrome OS': 'ChromeOS', 'Chromium OS': 'ChromeOS', Linux: 'Linux', iOS: 'iOS' };
  const BRANDS = { 'Google Chrome': 'Chrome', 'Microsoft Edge': 'Edge', Opera: 'Opera', 'Samsung Internet': 'Samsung Internet', Brave: 'Brave', 'Android WebView': 'WebView Android', Chromium: 'Chromium' };

  /**
   * Completa a leitura com o que o Chrome informa em navigator.userAgentData (modelo e versão do sistema).
   * hints: { platform, platformVersion, model, brands }.
   */
  function withClientHints(base, hints) {
    const out = { ...base };
    if (!hints) return out;

    const platform = PLATFORMS[hints.platform];
    if (platform && out.os !== 'iPadOS') out.os = platform;

    const version = String(hints.platformVersion || '').trim();
    if (version) {
      if (out.os === 'Windows') {
        // O Windows 11 se apresenta com versão de plataforma 13 ou mais.
        const major = parseInt(version, 10);
        if (major > 0) out.osVersion = major >= 13 ? '11' : '10';
      } else {
        out.osVersion = version.replace(/(\.0)+$/, '') || out.osVersion;
      }
    }

    const model = String(hints.model || '').trim();
    if (model) out.model = model;

    const brands = (hints.brands || []).filter((b) => b && b.brand && !/not.?a.?brand/i.test(b.brand));
    const brand = brands.find((b) => b.brand !== 'Chromium') || brands[0];
    if (brand) {
      const major = parseInt(brand.version, 10);
      out.browser = `${BRANDS[brand.brand] || brand.brand}${major ? ` ${major}` : ''}`;
    }
    return out;
  }

  FM.device = { parseUserAgent, withClientHints };
})(globalThis);
