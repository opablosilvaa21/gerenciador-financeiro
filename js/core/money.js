/**
 * Dinheiro em centavos inteiros: nada de double e nada de arredondamento silencioso.
 * Um valor com mais de 2 casas decimais é recusado, nunca arredondado.
 */
(function (root) {
  const FM = (root.FM = root.FM || {});

  const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const plain = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const compact = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });

  /** Limite do campo: R$ 999.999.999,99. Evita qualquer perda de precisão nas somas. */
  const MAX_CENTS = 99999999999;

  FM.money = {
    MAX_CENTS,

    /** 123456 vira "R$ 1.234,56". */
    format(cents) {
      return brl.format(cents / 100);
    },

    /** 123456 vira "1.234,56", para preencher campos de formulário. */
    formatPlain(cents) {
      return plain.format(cents / 100);
    },

    /** Para eixos de gráfico: 250000 vira "2,5 mil". */
    formatCompact(cents) {
      return compact.format(cents / 100);
    },

    /**
     * Lê o que a pessoa digitou. Aceita "1.234,56", "1234,56", "1234.56", "12,5", "12" e "R$ 12,00".
     * Devolve { cents } ou { error } com uma mensagem pronta para mostrar no campo.
     */
    parse(text) {
      const raw = String(text == null ? '' : text).replace(/R\$/gi, '').replace(/[\s ]/g, '');
      if (!raw) return { error: 'Informe o valor.' };

      const negative = raw.startsWith('-');
      const body = negative ? raw.slice(1) : raw;
      if (!/^[\d.,]+$/.test(body) || !/\d/.test(body)) {
        return { error: 'Use só números, como 1.234,56.' };
      }

      const parts = splitNumber(body);
      if (!parts) return { error: 'Use só números, como 1.234,56.' };
      const whole = parts.whole || '0';
      const fraction = parts.fraction;
      if (fraction.length > 2) return { error: 'Use no máximo 2 casas decimais.' };
      if (whole.length > 12) return { error: 'Valor alto demais.' };

      const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0') || 0);
      if (cents > MAX_CENTS) return { error: 'Valor alto demais.' };
      return { cents: negative ? -cents : cents };
    },

    /** Divide o total em parcelas que somam exatamente o total. Os centavos que sobram vão na primeira. */
    split(total, parts) {
      const base = Math.floor(total / parts);
      const rest = total - base * parts;
      return Array.from({ length: parts }, (_, i) => (i === 0 ? base + rest : base));
    },
  };

  /**
   * Separa a parte inteira dos decimais. "1.234" é milhar; "12.5", "1.234,56" e "1,234.56" têm decimais.
   * Devolve null para o que não é número bem escrito, como "1,2,3".
   */
  function splitNumber(text) {
    let match = text.match(/^(\d{1,3}(?:\.\d{3})+)(?:,(\d*))?$/);
    if (match) return { whole: match[1].replace(/\./g, ''), fraction: match[2] || '' };
    match = text.match(/^(\d{1,3}(?:,\d{3})+)\.(\d*)$/);
    if (match) return { whole: match[1].replace(/,/g, ''), fraction: match[2] };
    match = text.match(/^(\d*)(?:[.,](\d*))?$/);
    if (match) return { whole: match[1], fraction: match[2] || '' };
    return null;
  }
})(globalThis);
