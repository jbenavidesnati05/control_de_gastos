let _chartEvolucion  = null;
let _chartRanking    = null;
let _chartGastosTC   = null;
let _chartPagos      = null;

// ── Vista toggle ─────────────────────────────────────────────────────────────

function mostrarVista(vista) {
  const esAnalisis = vista === 'analisis';
  document.getElementById('vista-tabla').classList.toggle('hidden', esAnalisis);
  document.getElementById('vista-analisis').classList.toggle('hidden', !esAnalisis);
  document.getElementById('tab-tabla').classList.toggle('tab-activo', !esAnalisis);
  document.getElementById('tab-analisis').classList.toggle('tab-activo', esAnalisis);
  if (esAnalisis) renderAnalisis();
}

function initAnalisis() {
  document.getElementById('tab-tabla').addEventListener('click',   () => mostrarVista('tabla'));
  document.getElementById('tab-analisis').addEventListener('click', () => mostrarVista('analisis'));
}

// ── Datos calculados ─────────────────────────────────────────────────────────

// Solo períodos cerrados (historial real — excluye el período activo en edición)
function getDatosPeriodos() {
  return state.periodos
    .map((p, idx) => ({ p, idx }))
    .filter(({ p }) => p.cerrado)
    .map(({ p, idx }) => ({
      fecha:     p.fecha,
      esInicial: p.esInicial,
      totalTC:   sumaTotal(idx, 'TC', 'saldo'),
      totalCR:   sumaTotal(idx, 'CR', 'saldo'),
      totalOD:   sumaTotal(idx, 'OD', 'saldo'),
      get total() { return this.totalTC + this.totalCR + this.totalOD; },
      saldos: state.tarjetas.reduce((acc, t) => {
        acc[t.id] = getSaldo(idx, t.id);
        return acc;
      }, {}),
      _idx: idx
    }));
}

// Paleta categórica de Power BI (tema por defecto) para diferenciar cuentas
// individuales en las gráficas mensuales — tonos distintos entre sí para que
// cada cuenta se distinga de un vistazo, no una variación del mismo color.
const PALETA_CUENTAS = ['#118DFF', '#12239E', '#E66C37', '#6B007B', '#E044A7', '#744EC2', '#D9B300', '#D64550', '#01B8AA', '#374649'];
const colorCuenta = idx => PALETA_CUENTAS[idx % PALETA_CUENTAS.length];

function _nombreMes(anio, mesIndex) {
  const txt = new Date(anio, mesIndex, 1).toLocaleDateString('es-CO', { month: 'short', year: 'numeric' });
  return txt.charAt(0).toUpperCase() + txt.slice(1);
}

// Agrupa los gastos de cada tarjeta TC por mes calendario (getGastos = gasto real,
// compras nuevas). Solo períodos cerrados y no iniciales — si hubo más de un cierre
// en el mismo mes, se suman. Tarjetas sin ningún movimiento se excluyen del resultado.
// Las tarjetas quedan ordenadas de mayor a menor gasto total para comparar cuál se usa más.
function getGastosMensualesPorTarjeta() {
  const cuentas = state.tarjetas.filter(t => t.tipo === 'TC');
  const buckets = new Map(); // "YYYY-MM" -> { anio, mes, valores: { tarjetaId: monto } }

  state.periodos.forEach((p, idx) => {
    if (!p.cerrado || p.esInicial) return;
    const [, mm, yyyy] = p.fecha.split('/').map(Number);
    const clave = `${yyyy}-${String(mm).padStart(2, '0')}`;
    if (!buckets.has(clave)) buckets.set(clave, { anio: yyyy, mes: mm - 1, valores: {} });
    const valores = buckets.get(clave).valores;
    cuentas.forEach(t => { valores[t.id] = (valores[t.id] || 0) + getGastos(idx, t.id); });
  });

  const claves = [...buckets.keys()].sort();
  const labels = claves.map(k => _nombreMes(buckets.get(k).anio, buckets.get(k).mes));

  const datasets = cuentas
    .map(t => ({
      nombre: t.nombre,
      data:   claves.map(k => buckets.get(k).valores[t.id] || 0),
    }))
    .filter(ds => ds.data.some(v => v !== 0))
    .sort((a, b) => (b.data.reduce((s, v) => s + v, 0)) - (a.data.reduce((s, v) => s + v, 0)))
    .map((ds, i) => ({
      label: ds.nombre,
      data: ds.data,
      backgroundColor: colorCuenta(i),
      borderRadius: 4,
    }));

  return { labels, datasets };
}

// Agrupa los pagos (campo "pagos", ingresado directamente por el usuario) de TODAS las
// cuentas por mes calendario y tipo (TC/CR/OD) — a diferencia de gastos/interés, un pago
// es un valor real que ya se entregó, sin ambigüedad sobre qué representa.
function getPagosMensuales() {
  const buckets = new Map(); // "YYYY-MM" -> { anio, mes, TC, CR, OD }

  state.periodos.forEach((p, idx) => {
    if (!p.cerrado || p.esInicial) return;
    const [, mm, yyyy] = p.fecha.split('/').map(Number);
    const clave = `${yyyy}-${String(mm).padStart(2, '0')}`;
    if (!buckets.has(clave)) buckets.set(clave, { anio: yyyy, mes: mm - 1, TC: 0, CR: 0, OD: 0 });
    const bucket = buckets.get(clave);
    state.tarjetas.forEach(t => { bucket[t.tipo] += p.tarjetas[t.id]?.pagos || 0; });
  });

  const claves = [...buckets.keys()].sort();
  const labels = claves.map(k => _nombreMes(buckets.get(k).anio, buckets.get(k).mes));
  const tc = claves.map(k => buckets.get(k).TC);
  const cr = claves.map(k => buckets.get(k).CR);
  const od = claves.map(k => buckets.get(k).OD);
  const total = tc.map((v, i) => v + cr[i] + od[i]);

  return { labels, tc, cr, od, total };
}

// ── Render principal ─────────────────────────────────────────────────────────

function renderAnalisis() {
  if (!state || !state.periodos || state.periodos.length === 0) return;

  const cerrados = getDatosPeriodos();

  if (cerrados.length === 0) {
    document.getElementById('analisis-cards').innerHTML =
      '<p class="analisis-empty">Aún no hay períodos cerrados. Cierra al menos un período para ver el análisis.</p>';
    document.getElementById('chart-evolucion').closest('.chart-canvas-wrap').innerHTML =
      '<p class="chart-empty">Sin historial disponible.</p>';
    document.getElementById('chart-ranking').closest('.chart-canvas-wrap').innerHTML =
      '<p class="chart-empty">Sin historial disponible.</p>';
    document.getElementById('chart-gastos-tc').closest('.chart-canvas-wrap').innerHTML =
      '<p class="chart-empty">Sin historial disponible.</p>';
    document.getElementById('chart-pagos').closest('.chart-canvas-wrap').innerHTML =
      '<p class="chart-empty">Sin historial disponible.</p>';
    document.getElementById('tabla-gastos-tc').innerHTML = '';
    document.getElementById('tabla-pagos').innerHTML = '';
    document.getElementById('tabla-variacion').innerHTML = '';
    return;
  }

  renderResumenCards();
  renderChartEvolucion();
  renderChartRanking();
  renderChartGastosTC();
  renderTablaGastosTC();
  renderChartPagos();
  renderTablaPagos();
  renderTablaVariacion();
}

// ── Tarjetas de resumen ───────────────────────────────────────────────────────

function mkCard(acento, label, valor, varMonto, varPct) {
  const sinComparacion = varMonto === null;
  const subeClass = varMonto > 0 ? 'rc-up' : varMonto < 0 ? 'rc-down' : '';
  const icono     = varMonto > 0 ? '↑' : varMonto < 0 ? '↓' : '→';
  const subTexto  = sinComparacion
    ? 'Primer registro'
    : `${icono} ${formatCOP(Math.abs(varMonto))}${varPct !== null ? ' (' + Math.abs(varPct) + '%)' : ''} vs anterior`;

  return `
    <div class="resumen-card rc-acento-${acento}">
      <div class="rc-acento-bar"></div>
      <div class="rc-label">${label}</div>
      <div class="rc-valor">${formatCOP(valor)}</div>
      <div class="rc-sub ${sinComparacion ? '' : subeClass}">${subTexto}</div>
    </div>`;
}

function renderResumenCards() {
  const datos  = getDatosPeriodos();
  const ultimo = datos[datos.length - 1];
  const previo = datos.length > 1 ? datos[datos.length - 2] : null;

  function varInfo(actual, anterior) {
    if (anterior === null) return { monto: null, pct: null };
    const monto = actual - anterior;
    const pct   = anterior !== 0 ? +((monto / anterior) * 100).toFixed(1) : null;
    return { monto, pct };
  }

  const vTC   = varInfo(ultimo.totalTC,   previo?.totalTC   ?? null);
  const vCR   = varInfo(ultimo.totalCR,   previo?.totalCR   ?? null);
  const vOD   = varInfo(ultimo.totalOD,   previo?.totalOD   ?? null);
  const vTot  = varInfo(ultimo.total,     previo?.total     ?? null);

  document.getElementById('analisis-cards').innerHTML =
    mkCard('tc',  'Tarjetas de Crédito (TC)', ultimo.totalTC,  vTC.monto,  vTC.pct)  +
    mkCard('cr',  'Créditos (CR)',             ultimo.totalCR,  vCR.monto,  vCR.pct)  +
    mkCard('od',  'Otras Deudas (OD)',         ultimo.totalOD,  vOD.monto,  vOD.pct)  +
    mkCard('gen', 'Total General',             ultimo.total,    vTot.monto, vTot.pct);
}

// ── Chart: evolución por período ─────────────────────────────────────────────

function renderChartEvolucion() {
  const datos  = getDatosPeriodos();
  const labels = datos.map(d => d.fecha);

  if (_chartEvolucion) { _chartEvolucion.destroy(); _chartEvolucion = null; }

  const ctx = document.getElementById('chart-evolucion').getContext('2d');
  _chartEvolucion = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'TC',
          data: datos.map(d => d.totalTC),
          borderColor: '#118DFF',
          backgroundColor: 'rgba(17,141,255,0.12)',
          tension: 0.35,
          fill: true,
          pointRadius: 4,
        },
        {
          label: 'CR',
          data: datos.map(d => d.totalCR),
          borderColor: '#E66C37',
          backgroundColor: 'rgba(230,108,55,0.12)',
          tension: 0.35,
          fill: true,
          pointRadius: 4,
        },
        {
          label: 'OD',
          data: datos.map(d => d.totalOD),
          borderColor: '#744EC2',
          backgroundColor: 'rgba(116,78,194,0.12)',
          tension: 0.35,
          fill: true,
          pointRadius: 4,
        },
        {
          label: 'Total',
          data: datos.map(d => d.total),
          borderColor: '#12239E',
          backgroundColor: 'rgba(18,35,158,0.06)',
          borderWidth: 2.5,
          tension: 0.35,
          fill: false,
          pointRadius: 5,
        },
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: { font: { size: 11 }, padding: 16 }
        },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.dataset.label}: ${formatCOP(ctx.parsed.y)}`
          }
        }
      },
      scales: {
        y: {
          ticks: {
            callback: v => {
              if (v >= 1_000_000) return '$' + (v / 1_000_000).toFixed(1) + 'M';
              if (v >= 1_000)     return '$' + (v / 1_000).toFixed(0) + 'K';
              return '$' + v;
            }
          }
        }
      }
    }
  });
}

// ── Chart: ranking de deuda actual ───────────────────────────────────────────

function renderChartRanking() {
  const lastIdx = state.periodos.length - 1;
  const datos   = state.tarjetas
    .map(t => ({ nombre: t.nombre, tipo: t.tipo, saldo: getSaldo(lastIdx, t.id) }))
    .filter(d => d.saldo > 0)
    .sort((a, b) => b.saldo - a.saldo);

  if (_chartRanking) { _chartRanking.destroy(); _chartRanking = null; }

  if (datos.length === 0) {
    document.getElementById('chart-ranking').closest('.chart-canvas-wrap').innerHTML =
      '<p class="chart-empty">Sin deudas registradas en el período actual.</p>';
    return;
  }

  const colorMap = { TC: '#118DFF', CR: '#E66C37', OD: '#744EC2' };

  const ctx = document.getElementById('chart-ranking').getContext('2d');
  _chartRanking = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: datos.map(d => d.nombre),
      datasets: [{
        label: 'Saldo actual',
        data: datos.map(d => d.saldo),
        backgroundColor: datos.map(d => colorMap[d.tipo] || '#718096'),
        borderRadius: 5,
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => ` ${formatCOP(ctx.parsed.x)}`
          }
        }
      },
      scales: {
        x: {
          ticks: {
            callback: v => {
              if (v >= 1_000_000) return '$' + (v / 1_000_000).toFixed(1) + 'M';
              if (v >= 1_000)     return '$' + (v / 1_000).toFixed(0) + 'K';
              return '$' + v;
            }
          }
        }
      }
    }
  });
}

// ── Chart: gastos TC mensuales, apilado por tarjeta + línea de Total ──────────
// Un mes en el eje X, barras apiladas por tarjeta (ordenadas de mayor a menor
// gasto total) y una línea roja con el total del mes — igual estilo que Pagos.
function renderChartGastosTC() {
  const { labels, datasets } = getGastosMensualesPorTarjeta();
  if (_chartGastosTC) { _chartGastosTC.destroy(); _chartGastosTC = null; }

  if (datasets.length === 0) {
    document.getElementById('chart-gastos-tc').closest('.chart-canvas-wrap').innerHTML =
      '<p class="chart-empty">Aún no hay meses con movimientos para graficar.</p>';
    return;
  }

  const total = labels.map((_, i) => datasets.reduce((sum, ds) => sum + ds.data[i], 0));

  const ctx = document.getElementById('chart-gastos-tc').getContext('2d');
  _chartGastosTC = new Chart(ctx, {
    data: {
      labels,
      datasets: [
        ...datasets.map(ds => ({ ...ds, type: 'bar', stack: 'gastos' })),
        {
          type: 'line',
          label: 'Total',
          data: total,
          borderColor: '#1A202C',
          backgroundColor: 'rgba(26,32,44,0.06)',
          borderWidth: 2.5,
          tension: 0.35,
          fill: false,
          pointRadius: 5,
        },
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: { font: { size: 11 }, padding: 12, boxWidth: 12 }
        },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.dataset.label}: ${formatCOP(ctx.parsed.y)}`
          }
        }
      },
      scales: {
        x: { stacked: true },
        y: {
          stacked: true,
          ticks: {
            callback: v => {
              if (v >= 1_000_000) return '$' + (v / 1_000_000).toFixed(1) + 'M';
              if (v >= 1_000)     return '$' + (v / 1_000).toFixed(0) + 'K';
              return '$' + v;
            }
          }
        }
      }
    }
  });
}

// Tabla auxiliar tarjeta × mes con columna Total (por tarjeta) y fila Total mes
// (todas las tarjetas sumadas) — más precisa que la gráfica para comparar montos
// parecidos. Las filas ya vienen ordenadas de mayor a menor gasto total.
function renderTablaGastosTC() {
  const tabla = document.getElementById('tabla-gastos-tc');
  if (!tabla) return;

  const { labels, datasets } = getGastosMensualesPorTarjeta();

  if (datasets.length === 0) {
    tabla.innerHTML = '';
    return;
  }

  const totalesMes = labels.map((_, i) => datasets.reduce((sum, ds) => sum + ds.data[i], 0));
  const granTotal   = totalesMes.reduce((a, b) => a + b, 0);

  tabla.innerHTML = `
    <thead>
      <tr>
        <th>Tarjeta</th>
        ${labels.map(l => `<th class="td-r">${l}</th>`).join('')}
        <th class="td-r">Total</th>
      </tr>
    </thead>
    <tbody>
      ${datasets.map(ds => `
        <tr>
          <td class="fw">${ds.label}</td>
          ${ds.data.map(v => `<td class="td-r">${v ? formatCOP(v) : '—'}</td>`).join('')}
          <td class="td-r fw">${formatCOP(ds.data.reduce((a, b) => a + b, 0))}</td>
        </tr>`).join('')}
    </tbody>
    <tfoot>
      <tr class="tr-total">
        <td>Total mes</td>
        ${totalesMes.map(v => `<td class="td-r">${formatCOP(v)}</td>`).join('')}
        <td class="td-r">${formatCOP(granTotal)}</td>
      </tr>
    </tfoot>`;
}

// ── Chart: pagos mensuales, todos los componentes (TC + CR + OD) ──────────────
// Cuánto de tu dinero sale cada mes hacia deudas, con el desglose por tipo y
// una línea de total. A diferencia de gastos/interés, "pagos" es un valor que
// tú ingresas directamente — no hay ambigüedad sobre qué representa.
function renderChartPagos() {
  const { labels, tc, cr, od, total } = getPagosMensuales();
  if (_chartPagos) { _chartPagos.destroy(); _chartPagos = null; }

  if (labels.length === 0) {
    document.getElementById('chart-pagos').closest('.chart-canvas-wrap').innerHTML =
      '<p class="chart-empty">Aún no hay meses con pagos registrados.</p>';
    return;
  }

  const ctx = document.getElementById('chart-pagos').getContext('2d');
  _chartPagos = new Chart(ctx, {
    data: {
      labels,
      datasets: [
        { type: 'bar', label: 'TC', data: tc, backgroundColor: '#118DFF', stack: 'pagos', borderRadius: 3 },
        { type: 'bar', label: 'CR', data: cr, backgroundColor: '#E66C37', stack: 'pagos', borderRadius: 3 },
        { type: 'bar', label: 'OD', data: od, backgroundColor: '#744EC2', stack: 'pagos', borderRadius: 3 },
        {
          type: 'line',
          label: 'Total',
          data: total,
          borderColor: '#12239E',
          backgroundColor: 'rgba(18,35,158,0.06)',
          borderWidth: 2.5,
          tension: 0.35,
          fill: false,
          pointRadius: 5,
        },
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: { font: { size: 11 }, padding: 16 }
        },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.dataset.label}: ${formatCOP(ctx.parsed.y)}`
          }
        }
      },
      scales: {
        x: { stacked: true },
        y: {
          stacked: true,
          ticks: {
            callback: v => {
              if (v >= 1_000_000) return '$' + (v / 1_000_000).toFixed(1) + 'M';
              if (v >= 1_000)     return '$' + (v / 1_000).toFixed(0) + 'K';
              return '$' + v;
            }
          }
        }
      }
    }
  });
}

// Tabla auxiliar tipo × mes (TC/CR/OD) con columna Total (por tipo) y fila
// Total mes (los tres tipos sumados) — el mismo valor que la línea roja del chart.
function renderTablaPagos() {
  const tabla = document.getElementById('tabla-pagos');
  if (!tabla) return;

  const { labels, tc, cr, od, total } = getPagosMensuales();

  if (labels.length === 0) {
    tabla.innerHTML = '';
    return;
  }

  const filas = [
    { nombre: 'TC', valores: tc },
    { nombre: 'CR', valores: cr },
    { nombre: 'OD', valores: od },
  ].filter(f => f.valores.some(v => v !== 0));

  const granTotal = total.reduce((a, b) => a + b, 0);

  tabla.innerHTML = `
    <thead>
      <tr>
        <th>Tipo</th>
        ${labels.map(l => `<th class="td-r">${l}</th>`).join('')}
        <th class="td-r">Total</th>
      </tr>
    </thead>
    <tbody>
      ${filas.map(f => `
        <tr>
          <td class="fw">${f.nombre}</td>
          ${f.valores.map(v => `<td class="td-r">${v ? formatCOP(v) : '—'}</td>`).join('')}
          <td class="td-r fw">${formatCOP(f.valores.reduce((a, b) => a + b, 0))}</td>
        </tr>`).join('')}
    </tbody>
    <tfoot>
      <tr class="tr-total">
        <td>Total mes</td>
        ${total.map(v => `<td class="td-r">${formatCOP(v)}</td>`).join('')}
        <td class="td-r">${formatCOP(granTotal)}</td>
      </tr>
    </tfoot>`;
}

// ── Tabla de variación ───────────────────────────────────────────────────────

function renderTablaVariacion() {
  const cerrados = getDatosPeriodos();
  const lastIdx  = cerrados[cerrados.length - 1]._idx;
  const prevIdx  = cerrados.length > 1 ? cerrados[cerrados.length - 2]._idx : null;

  const filas = state.tarjetas.map(t => {
    const saldoActual = getSaldo(lastIdx, t.id);
    const saldoPrev   = prevIdx !== null ? getSaldo(prevIdx, t.id) : null;
    const variacion   = saldoPrev !== null ? saldoActual - saldoPrev : null;
    const pct         = (saldoPrev !== null && saldoPrev !== 0)
      ? ((variacion / saldoPrev) * 100).toFixed(1)
      : null;
    const esNueva     = saldoPrev === 0 && saldoActual > 0;

    let icono = '→', clase = 'igual';
    if (esNueva)          { icono = '✦'; clase = 'nueva'; }
    else if (variacion > 0) { icono = '↑'; clase = 'subio'; }
    else if (variacion < 0) { icono = '↓'; clase = 'bajo'; }

    return `
      <tr>
        <td>
          <span class="badge-tipo badge-${t.tipo.toLowerCase()}">${t.tipo}</span>
          ${t.nombre}
        </td>
        <td class="td-r fw">${formatCOP(saldoActual)}</td>
        <td class="td-r">${saldoPrev !== null ? formatCOP(saldoPrev) : '—'}</td>
        <td class="td-r td-var ${clase}">
          <span class="var-icono">${icono}</span>
          ${variacion !== null ? formatCOP(Math.abs(variacion)) : '—'}
          ${pct !== null && !esNueva
            ? `<span class="var-pct">${pct > 0 ? '+' : ''}${pct}%</span>`
            : esNueva ? '<span class="var-pct">Nueva</span>' : ''
          }
        </td>
      </tr>`;
  });

  document.getElementById('tabla-variacion').innerHTML = `
    <thead>
      <tr>
        <th>Cuenta</th>
        <th class="td-r">Saldo actual</th>
        <th class="td-r">Saldo anterior</th>
        <th class="td-r">Variación</th>
      </tr>
    </thead>
    <tbody>${filas.join('')}</tbody>
  `;
}
