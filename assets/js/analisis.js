let _chartEvolucion = null;
let _chartRanking   = null;

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
    document.getElementById('tabla-variacion').innerHTML = '';
    return;
  }

  renderResumenCards();
  renderChartEvolucion();
  renderChartRanking();
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

  const vTC  = varInfo(ultimo.totalTC,  previo?.totalTC  ?? null);
  const vCR  = varInfo(ultimo.totalCR,  previo?.totalCR  ?? null);
  const vOD  = varInfo(ultimo.totalOD,  previo?.totalOD  ?? null);
  const vTot = varInfo(ultimo.total,    previo?.total    ?? null);

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
          borderColor: '#d69e2e',
          backgroundColor: 'rgba(214,158,46,0.12)',
          tension: 0.35,
          fill: true,
          pointRadius: 4,
        },
        {
          label: 'CR',
          data: datos.map(d => d.totalCR),
          borderColor: '#dd6b20',
          backgroundColor: 'rgba(221,107,32,0.12)',
          tension: 0.35,
          fill: true,
          pointRadius: 4,
        },
        {
          label: 'OD',
          data: datos.map(d => d.totalOD),
          borderColor: '#38a169',
          backgroundColor: 'rgba(56,161,105,0.12)',
          tension: 0.35,
          fill: true,
          pointRadius: 4,
        },
        {
          label: 'Total',
          data: datos.map(d => d.total),
          borderColor: '#e53e3e',
          backgroundColor: 'rgba(229,62,62,0.05)',
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

  const colorMap = { TC: '#d69e2e', CR: '#dd6b20', OD: '#38a169' };

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
