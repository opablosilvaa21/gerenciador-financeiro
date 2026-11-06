/**
 * Datas como texto no fuso local: "2026-11-05" (dia) e "2026-11" (mês).
 * Texto compara em ordem certa e evita o erro clássico de o dia mudar por causa do UTC.
 */
(function (root) {
  const FM = (root.FM = root.FM || {});

  const pad = (n) => String(n).padStart(2, '0');
  const local = (iso) => {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d || 1);
  };

  const monthFormat = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' });
  const monthNameFormat = new Intl.DateTimeFormat('pt-BR', { month: 'long' });
  const monthShortFormat = new Intl.DateTimeFormat('pt-BR', { month: 'short' });
  const dayFormat = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short' });
  const fullFormat = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
  const weekdayFormat = new Intl.DateTimeFormat('pt-BR', { weekday: 'long' });

  const clean = (text) => text.replace('.', '');
  const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);

  const dates = {
    today(now = new Date()) {
      return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    },
    monthOf: (iso) => iso.slice(0, 7),
    dayOf: (iso) => Number(iso.slice(8, 10)),

    isValidDate(iso) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso))) return false;
      const [y, m, d] = iso.split('-').map(Number);
      const date = new Date(y, m - 1, d);
      return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
    },
    isValidMonth: (month) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(month)),

    daysInMonth(month) {
      const [y, m] = month.split('-').map(Number);
      return new Date(y, m, 0).getDate();
    },

    addMonths(month, amount) {
      const [y, m] = month.split('-').map(Number);
      const date = new Date(y, m - 1 + amount, 1);
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
    },

    /** Dia 31 em fevereiro vira o último dia de fevereiro. */
    dateIn(month, day) {
      return `${month}-${pad(Math.min(day, dates.daysInMonth(month)))}`;
    },

    addMonthsToDate(iso, amount) {
      return dates.dateIn(dates.addMonths(dates.monthOf(iso), amount), dates.dayOf(iso));
    },

    addDays(iso, amount) {
      const date = local(iso);
      date.setDate(date.getDate() + amount);
      return dates.today(date);
    },

    /** Dias de a até b. Positivo quando b vem depois. */
    diffDays(a, b) {
      const [ay, am, ad] = a.split('-').map(Number);
      const [by, bm, bd] = b.split('-').map(Number);
      return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
    },

    /** Quantos meses de a até b. */
    diffMonths(a, b) {
      const [ay, am] = a.split('-').map(Number);
      const [by, bm] = b.split('-').map(Number);
      return (by - ay) * 12 + (bm - am);
    },

    monthRange(end, count) {
      return Array.from({ length: count }, (_, i) => dates.addMonths(end, i - count + 1));
    },

    monthLabel: (month) => capitalize(monthFormat.format(local(month))),
    monthName: (month) => monthNameFormat.format(local(month)),
    monthShort: (month) => clean(monthShortFormat.format(local(month))),
    dayLabel: (iso) => clean(dayFormat.format(local(iso))),
    fullLabel: (iso) => fullFormat.format(local(iso)),
    weekday: (iso) => weekdayFormat.format(local(iso)),

    /** "hoje", "ontem", "amanhã" ou "5 nov". */
    relativeLabel(iso, today) {
      const diff = dates.diffDays(today, iso);
      if (diff === 0) return 'hoje';
      if (diff === -1) return 'ontem';
      if (diff === 1) return 'amanhã';
      return dates.dayLabel(iso);
    },
  };

  FM.dates = dates;
})(globalThis);
