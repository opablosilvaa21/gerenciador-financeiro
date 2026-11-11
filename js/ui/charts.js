/**
 * Gráficos em SVG e HTML, sem biblioteca. Todos têm dica no ponteiro e no teclado,
 * e a moldura oferece a visão em tabela: nenhum valor depende de passar o mouse.
 */
(function (root) {
  const FM = (root.FM = root.FM || {});
  const { el, svg, withTip, tip } = FM.dom;
  const { money, dates } = FM;

  const seriesColor = (slot) => (slot == null ? 'var(--series-other)' : `var(--series-${slot + 1})`);

  /** Redesenha quando a largura muda e para de observar quando o gráfico sai da tela. */
  function responsive(host, draw) {
    let lastWidth = 0;
    const run = () => {
      const width = Math.floor(host.clientWidth);
      if (!width || width === lastWidth) return;
      lastWidth = width;
      host.replaceChildren(draw(width));
    };
    const observer = new ResizeObserver(() => {
      if (!host.isConnected) {
        observer.disconnect();
        tip.hide();
        return;
      }
      run();
    });
    observer.observe(host);
    return host;
  }

  /** Valor redondo para o topo do eixo e o passo entre as marcas. */
  function niceScale(max, ticks = 4) {
    if (max <= 0) return { top: 100000, step: 25000 };
    const rough = max / ticks;
    const power = 10 ** Math.floor(Math.log10(rough));
    const unit = [1, 2, 2.5, 5, 10].map((m) => m * power).find((m) => m >= rough);
    return { top: Math.ceil(max / unit) * unit, step: unit };
  }

  /** Coluna com a ponta de dados arredondada e a base reta. */
  function columnPath(x, y, width, height, radius = 4) {
    const r = Math.min(radius, height, width / 2);
    return `M${x} ${y + height}V${y + r}Q${x} ${y} ${x + r} ${y}H${x + width - r}Q${x + width} ${y} ${x + width} ${y + r}V${y + height}Z`;
  }

  /** Moldura padrão: título, ação de trocar entre gráfico e tabela e o conteúdo. */
  function frame({ title, description = null, chart, columns, rows, legend = null, startAsTable = false }) {
    const body = el('div', { class: 'chart-body' });
    let table = startAsTable;
    const toggle = el('button', { class: 'link-button', type: 'button', 'aria-pressed': String(table) });
    const render = () => {
      toggle.textContent = table ? 'Ver gráfico' : 'Ver tabela';
      toggle.setAttribute('aria-pressed', String(table));
      tip.hide();
      body.replaceChildren(table ? tableView(columns, rows) : chart());
    };
    toggle.addEventListener('click', () => {
      table = !table;
      render();
    });
    render();
    return el(
      'section',
      { class: 'chart' },
      el(
        'header',
        { class: 'chart-head' },
        el('div', {}, el('h2', {}, title), description && el('p', { class: 'chart-sub' }, description)),
        toggle,
      ),
      legend,
      body,
    );
  }

  function tableView(columns, rows) {
    return el(
      'div',
      { class: 'table-scroll' },
      el(
        'table',
        { class: 'data-table' },
        el('thead', {}, el('tr', {}, columns.map((c, i) => el('th', { scope: 'col', class: i ? 'num' : '' }, c)))),
        el('tbody', {}, rows.map((row) => el('tr', {}, row.map((cell, i) => el(i ? 'td' : 'th', { class: i ? 'num' : '', scope: i ? null : 'row' }, cell))))),
      ),
    );
  }

  function legendList(items) {
    return el(
      'ul',
      { class: 'legend' },
      items.map((item) =>
        el(
          'li',
          {},
          el('span', { class: `legend-key${item.line ? ' legend-line' : ''}`, style: { background: item.color } }),
          item.label,
        ),
      ),
    );
  }

  /**
   * A régua do mês: uma faixa que representa tudo o que entrou (ou o que saiu, se saiu mais).
   * Cada bloco é uma categoria, e o que fica sem cor é a sobra. Clicar leva aos lançamentos.
   */
  function monthRule(summary, { onSelect }) {
    const whole = Math.max(summary.income, summary.expense);
    if (!whole) return null;

    const groups = summary.byCategory.map((item) => ({
      key: item.category.id,
      name: item.category.name,
      slot: item.category.slot,
      amount: item.amount,
      clickable: true,
    }));
    const left = Math.max(summary.left, 0);

    const percent = (amount) => {
      const value = (amount / whole) * 100;
      return value >= 10 || value === 0 ? `${Math.round(value)}%` : `${value.toFixed(1).replace('.', ',')}%`;
    };

    const bar = el(
      'div',
      {
        class: 'rule-bar',
        role: 'group',
        'aria-label': `Divisão de ${money.format(whole)} entre categorias`,
      },
      groups.map((group) => {
        const content = () => ({
          title: group.name,
          rows: [{ value: money.format(group.amount), label: `${percent(group.amount)} do total`, color: seriesColor(group.slot) }],
        });
        return withTip(
          el(
            'button',
            {
              class: 'rule-part',
              type: 'button',
              style: { 'flex-grow': String(group.amount), background: seriesColor(group.slot), color: 'var(--series-ink)' },
              'aria-label': `${group.name}: ${money.format(group.amount)}, ${percent(group.amount)} do total. Ver lançamentos`,
              onclick: () => onSelect(group.key),
            },
            el('span', {}, percent(group.amount)),
          ),
          content,
        );
      }),
      left > 0 && withTip(
        el(
          'div',
          {
            class: 'rule-part rule-left',
            style: { 'flex-grow': String(left) },
            tabIndex: 0,
            role: 'img',
            'aria-label': `Sobra: ${money.format(left)}, ${percent(left)} do total`,
          },
          el('span', {}, percent(left)),
        ),
        () => ({ title: 'Sobra', rows: [{ value: money.format(left), label: `${percent(left)} do total` }] }),
      ),
    );

    const legend = legendList([
      ...groups.map((g) => ({ label: g.name, color: seriesColor(g.slot) })),
      ...(left > 0 ? [{ label: 'Sobra', color: 'var(--rule-left)' }] : []),
    ]);

    // Um bloco estreito demais não imprime o percentual, que continua na dica e na tabela.
    const observer = new ResizeObserver(() => {
      if (!bar.isConnected) {
        observer.disconnect();
        return;
      }
      for (const label of bar.querySelectorAll('.rule-part > span')) {
        label.style.visibility = label.offsetWidth > label.parentElement.clientWidth ? 'hidden' : 'visible';
      }
    });
    observer.observe(bar);
    return el('div', { class: 'rule' }, bar, legend);
  }

  /** Entradas e saídas por mês: colunas lado a lado, no mesmo eixo. */
  function cashflowChart(data, { selected = null, onSelect = null, height = 260 } = {}) {
    const series = [
      { key: 'income', label: 'Entrou', color: 'var(--flow-in)' },
      { key: 'expense', label: 'Saiu', color: 'var(--flow-out)' },
    ];
    const chart = () =>
      responsive(el('div', { class: 'chart-canvas', style: { height: `${height}px` } }), (width) => {
        const pad = { top: 10, right: 4, bottom: 26, left: 52 };
        const plotW = width - pad.left - pad.right;
        const plotH = height - pad.top - pad.bottom;
        const scale = niceScale(Math.max(...data.flatMap((d) => [d.income, d.expense]), 1));
        const y = (value) => pad.top + plotH - (value / scale.top) * plotH;
        const band = plotW / data.length;
        const barW = Math.min(24, Math.max(4, (band - 8) / 2 - 1));
        const root = svg('svg', { width, height, role: 'group', 'aria-label': 'Entradas e saídas por mês', class: 'chart-svg' });

        for (let value = 0; value <= scale.top + 1; value += scale.step) {
          root.append(svg('line', { x1: pad.left, x2: width - pad.right, y1: y(value), y2: y(value), class: value === 0 ? 'axis-base' : 'axis-grid' }));
          root.append(svg('text', { x: pad.left - 8, y: y(value) + 4, 'text-anchor': 'end', class: 'axis-text' }, money.formatCompact(value)));
        }

        const labelEvery = band < 34 ? 2 : 1;
        data.forEach((d, i) => {
          const center = pad.left + band * i + band / 2;
          const isSelected = d.month === selected;
          const group = svg('g', {
            class: `bar-group${onSelect ? ' is-clickable' : ''}${isSelected ? ' is-selected' : ''}`,
            tabindex: 0,
            role: onSelect ? 'button' : 'img',
            'aria-label': `${dates.monthLabel(d.month)}: entrou ${money.format(d.income)}, saiu ${money.format(d.expense)}, sobra ${money.format(d.left)}`,
          });
          group.append(svg('rect', { x: center - band / 2, y: pad.top, width: band, height: plotH + pad.bottom, class: 'bar-hit' }));
          series.forEach((s, index) => {
            const value = d[s.key];
            if (value <= 0) return;
            const x = center + (index === 0 ? -barW - 1 : 1);
            group.append(svg('path', { d: columnPath(x, y(value), barW, y(0) - y(value)), fill: s.color, class: 'bar' }));
          });
          if (i % labelEvery === (data.length - 1) % labelEvery) {
            group.append(svg('text', { x: center, y: height - 8, 'text-anchor': 'middle', class: `axis-text${isSelected ? ' axis-strong' : ''}` }, dates.monthShort(d.month)));
          }
          withTip(group, () => ({
            title: dates.monthLabel(d.month),
            rows: [
              { value: money.format(d.income), label: 'entrou', color: series[0].color },
              { value: money.format(d.expense), label: 'saiu', color: series[1].color },
              { value: money.format(Math.abs(d.left)), label: d.left < 0 ? 'faltou' : 'sobrou' },
            ],
          }));
          if (onSelect) {
            group.addEventListener('click', () => onSelect(d.month));
            group.addEventListener('keydown', (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onSelect(d.month);
              }
            });
          }
          root.append(group);
        });
        return root;
      });

    return {
      chart,
      legend: legendList(series),
      columns: ['Mês', 'Entrou', 'Saiu', 'Sobra'],
      rows: data.map((d) => [dates.monthLabel(d.month), money.format(d.income), money.format(d.expense), money.format(d.left)]),
    };
  }

  /** Evolução do saldo: uma linha, com a marca seguindo o mês mais próximo do ponteiro. */
  function balanceChart(data, { height = 240 } = {}) {
    const chart = () =>
      responsive(el('div', { class: 'chart-canvas', style: { height: `${height}px` } }), (width) => {
        const pad = { top: 22, right: 18, bottom: 26, left: 56 };
        const plotW = width - pad.left - pad.right;
        const plotH = height - pad.top - pad.bottom;
        const values = data.map((d) => d.balance);
        const max = Math.max(...values, 0);
        const min = Math.min(...values, 0);
        const scale = niceScale(Math.max(max - min, 1));
        const bottom = min < 0 ? Math.floor(min / scale.step) * scale.step : 0;
        const top = Math.max(Math.ceil(max / scale.step) * scale.step, bottom + scale.step);
        const y = (value) => pad.top + plotH - ((value - bottom) / (top - bottom)) * plotH;
        const x = (i) => pad.left + (data.length > 1 ? (i / (data.length - 1)) * plotW : plotW / 2);

        const root = svg('svg', { width, height, class: 'chart-svg', role: 'img', 'aria-label': `Saldo por mês. Último valor: ${money.format(values[values.length - 1])}` });
        for (let value = bottom; value <= top + 1; value += scale.step) {
          root.append(svg('line', { x1: pad.left, x2: width - pad.right, y1: y(value), y2: y(value), class: value === 0 ? 'axis-base' : 'axis-grid' }));
          root.append(svg('text', { x: pad.left - 8, y: y(value) + 4, 'text-anchor': 'end', class: 'axis-text' }, money.formatCompact(value)));
        }
        const labelEvery = plotW / data.length < 34 ? 2 : 1;
        data.forEach((d, i) => {
          if (i % labelEvery === (data.length - 1) % labelEvery) {
            root.append(svg('text', { x: x(i), y: height - 8, 'text-anchor': 'middle', class: 'axis-text' }, dates.monthShort(d.month)));
          }
        });

        const line = data.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(d.balance).toFixed(1)}`).join('');
        root.append(svg('path', { d: `${line}L${x(data.length - 1)} ${y(Math.max(bottom, 0))}L${x(0)} ${y(Math.max(bottom, 0))}Z`, class: 'line-area' }));
        root.append(svg('path', { d: line, class: 'line-stroke' }));

        const lastIndex = data.length - 1;
        root.append(svg('circle', { cx: x(lastIndex), cy: y(values[lastIndex]), r: 5, class: 'line-dot' }));
        root.append(svg('text', {
          x: Math.min(x(lastIndex), width - 2),
          y: Math.max(y(values[lastIndex]) - 12, 12),
          'text-anchor': 'end',
          class: 'line-label',
        }, money.format(values[lastIndex])));

        const hair = svg('line', { y1: pad.top, y2: pad.top + plotH, class: 'crosshair', visibility: 'hidden' });
        const marker = svg('circle', { r: 5, class: 'line-dot', visibility: 'hidden' });
        root.append(hair, marker);
        const hit = svg('rect', { x: pad.left - 10, y: 0, width: plotW + 20, height, class: 'bar-hit', tabindex: 0, role: 'presentation' });
        root.append(hit);

        let active = lastIndex;
        const showIndex = (index, clientX, clientY) => {
          active = index;
          const d = data[index];
          hair.setAttribute('x1', x(index));
          hair.setAttribute('x2', x(index));
          hair.setAttribute('visibility', 'visible');
          marker.setAttribute('cx', x(index));
          marker.setAttribute('cy', y(d.balance));
          marker.setAttribute('visibility', 'visible');
          tip.show(clientX, clientY, dates.monthLabel(d.month), [{ value: money.format(d.balance), label: 'de saldo' }]);
        };
        const clear = () => {
          hair.setAttribute('visibility', 'hidden');
          marker.setAttribute('visibility', 'hidden');
          tip.hide();
        };
        const showAtPointer = (event) => {
          const box = root.getBoundingClientRect();
          const position = event.clientX - box.left - pad.left;
          const index = Math.max(0, Math.min(lastIndex, Math.round((position / plotW) * lastIndex)));
          showIndex(index, event.clientX, event.clientY);
        };
        hit.addEventListener('pointermove', showAtPointer);
        hit.addEventListener('pointerdown', showAtPointer);
        hit.addEventListener('pointerleave', (event) => {
          if (event.pointerType !== 'touch') clear();
        });
        hit.addEventListener('blur', clear);
        const showFocused = (index) => {
          const box = root.getBoundingClientRect();
          showIndex(index, box.left + x(index), box.top + y(data[index].balance));
        };
        hit.addEventListener('focus', () => showFocused(active));
        hit.addEventListener('keydown', (event) => {
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault();
            event.stopPropagation();
            showFocused(Math.max(0, Math.min(lastIndex, active + (event.key === 'ArrowLeft' ? -1 : 1))));
          }
        });
        return root;
      });

    return {
      chart,
      columns: ['Mês', 'Saldo'],
      rows: data.map((d) => [dates.monthLabel(d.month), money.format(d.balance)]),
    };
  }

  /** Categorias em barras horizontais, da maior para a menor, com a variação ao período anterior. */
  function rankingChart(items, { onSelect = null } = {}) {
    const max = Math.max(...items.map((i) => i.amount), 1);
    const delta = (item) => {
      if (item.previous === null) return null;
      if (item.previous === 0) return 'Sem gastos no período anterior';
      const change = Math.round((item.amount / item.previous - 1) * 100);
      if (change === 0) return 'Igual ao período anterior';
      return `${change > 0 ? '+' : '\u2212'}${Math.abs(change)}% sobre o período anterior`;
    };
    const chart = () =>
      el(
        'ul',
        { class: 'ranking' },
        items.map((item) => {
          const content = el(
            'span',
            { class: 'ranking-line' },
            el('span', { class: 'ranking-name' }, item.category.name),
            el('span', { class: 'ranking-track' }, el('span', {
              class: 'ranking-bar',
              style: { width: `${Math.max((item.amount / max) * 100, 1)}%`, background: seriesColor(item.category.slot) },
            })),
            el('span', { class: 'ranking-value' }, el('strong', {}, money.format(item.amount)), delta(item) && el('small', {}, delta(item))),
          );
          return el(
            'li',
            {},
            onSelect
              ? el('button', { class: 'ranking-button', type: 'button', onclick: () => onSelect(item.category.id) }, content)
              : content,
          );
        }),
      );
    return {
      chart,
      columns: ['Categoria', 'Valor', 'Período anterior'],
      rows: items.map((i) => [i.category.name, money.format(i.amount), i.previous === null ? 'Sem dados' : money.format(i.previous)]),
    };
  }

  FM.charts = { frame, monthRule, cashflowChart, balanceChart, rankingChart, legendList, seriesColor };
})(globalThis);
