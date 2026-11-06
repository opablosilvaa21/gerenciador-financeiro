/**
 * A cédula do mês. O valor impresso é o que sobra; a arte é um guilloché, o desenho de linhas
 * das cédulas de verdade, calculado a partir do mês: cada mês tem o seu, e sempre o mesmo.
 */
(function (root) {
  const FM = (root.FM = root.FM || {});
  const { el, svg } = FM.dom;
  const { money, dates } = FM;

  const WIDTH = 720;
  const HEIGHT = 300;

  /** Número pseudoaleatório estável para o mesmo mês. */
  function hash(text) {
    let h = 2166136261;
    for (const char of text) h = Math.imul(h ^ char.charCodeAt(0), 16777619);
    return (h >>> 0) / 4294967296;
  }

  /** Curva fechada de uma roseta: uma circunferência que ondula n vezes. */
  function rosettePath(cx, cy, radius, amplitude, waves, phase) {
    const steps = 360;
    let d = '';
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * Math.PI * 2;
      const r = radius + amplitude * Math.cos(waves * t + phase);
      const x = cx + r * Math.cos(t);
      const y = cy + r * Math.sin(t);
      d += `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
    }
    return `${d}Z`;
  }

  /** Faixa de ondas que atravessa a cédula, como o fundo de segurança do papel-moeda. */
  function wavePath(y, amplitude, period, phase) {
    let d = '';
    for (let x = -10; x <= WIDTH + 10; x += 6) {
      const yy = y + amplitude * Math.sin((x / period) * Math.PI * 2 + phase);
      d += `${x === -10 ? 'M' : 'L'}${x} ${yy.toFixed(1)}`;
    }
    return d;
  }

  function art(month, animate) {
    const seed = hash(month);
    const waves = 9 + Math.floor(seed * 7);
    const phase = seed * Math.PI * 2;
    const cx = WIDTH - 148;
    const cy = HEIGHT / 2;

    const group = svg('g', { class: `note-rosette${animate ? ' is-drawing' : ''}` });
    for (let i = 0; i < 26; i++) {
      group.append(svg('path', {
        d: rosettePath(cx, cy, 44 + i * 3.4, 12 + i * 0.75, waves, phase + i * 0.242),
        pathLength: 1,
      }));
    }
    const inner = svg('g', { class: 'note-rosette-core' });
    for (let i = 0; i < 12; i++) {
      inner.append(svg('path', { d: rosettePath(cx, cy, 13 + i * 1.8, 5, waves * 2, phase - i * 0.52) }));
    }

    const background = svg('g', { class: 'note-waves' });
    for (let i = 0; i < 22; i++) {
      background.append(svg('path', {
        d: wavePath(16 + i * 12.8, 7 + 3 * Math.sin(i * 0.6 + phase), 170 + seed * 90, phase + i * 0.24),
      }));
    }

    const microId = `micro-${month}`;
    const inset = 12;
    const frame = `M${inset} ${inset}H${WIDTH - inset}V${HEIGHT - inset}H${inset}Z`;
    const microText = 'SOBRA '.repeat(90);

    return svg(
      'svg',
      { class: 'note-art', viewBox: `0 0 ${WIDTH} ${HEIGHT}`, preserveAspectRatio: 'xMaxYMid slice', 'aria-hidden': 'true', focusable: 'false' },
      background,
      group,
      inner,
      svg('path', { id: microId, d: frame, fill: 'none', stroke: 'none' }),
      svg('text', { class: 'note-micro' }, svg('textPath', { href: `#${microId}` }, microText)),
      svg('rect', { class: 'note-frame', x: inset + 7, y: inset + 7, width: WIDTH - 2 * (inset + 7), height: HEIGHT - 2 * (inset + 7), rx: 3 }),
    );
  }

  let alreadyDrawn = false;

  /**
   * summary vem de queries.monthSummary. O desenho se traça só na primeira vez que a cédula aparece;
   * trocar de mês apenas troca a arte, em resposta ao clique.
   */
  function note(summary, { emphasizeEmpty = false } = {}) {
    const { month, left } = summary;
    const short = left < 0;
    const animate = !alreadyDrawn;
    alreadyDrawn = true;
    const name = dates.monthName(month);
    const label = short ? `Faltam em ${name}` : `Sobra prevista em ${name}`;

    return el(
      'section',
      {
        class: `note${short ? ' note-short' : ''}${emphasizeEmpty ? ' note-empty' : ''}`,
        'aria-label': `${label}: ${money.format(Math.abs(left))}`,
      },
      art(month, animate),
      el(
        'div',
        { class: 'note-face' },
        el('p', { class: 'note-label' }, label),
        el('p', { class: 'note-value', id: 'note-value' }, money.format(Math.abs(left))),
        el('p', { class: 'note-serial' }, `Série ${month.replace('-', '/')}`),
      ),
    );
  }

  FM.note = { note };
})(globalThis);
