let state          = { tarjetas: [], periodos: [] };
let _uid           = null;
let _mostrarTodosP = false;

// ── Utilidades ───────────────────────────────────────────────────────────────

function hoy() {
  const d = new Date();
  return [d.getDate(), d.getMonth() + 1, d.getFullYear()]
    .map(n => String(n).padStart(2, '0')).join('/');
}

function formatCOP(v) {
  if (v === 0) return '$ -';
  return new Intl.NumberFormat('es-CO', {
    style:                 'currency',
    currency:              'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(v);
}

function formatMiles(n) {
  if (!n) return '';
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function fijarCelda(id, valor) {
  const el = document.getElementById(id);
  if (el) el.textContent = formatCOP(valor);
}

// ── Persistencia (Firestore) ──────────────────────────────────────────────────

let _guardadoTimer = null;

function mostrarIndicador(guardando) {
  const btn = document.getElementById('btn-guardado');
  if (!btn) return;
  btn.textContent = guardando ? '💾 Guardando...' : '✓ Guardado';
  btn.classList.toggle('guardando', guardando);
}

function guardar() {
  if (!_uid) return;
  mostrarIndicador(true);
  clearTimeout(_guardadoTimer);

  // Debounce: espera 600ms desde el último cambio antes de escribir
  _guardadoTimer = setTimeout(() => {
    userDocRef(_uid).set(state)
      .then(() => mostrarIndicador(false))
      .catch(err => {
        console.error('Error al guardar:', err);
        mostrarIndicador(false);
      });
  }, 600);
}

async function cargar() {
  if (!_uid) return false;
  const doc = await userDocRef(_uid).get();
  if (!doc.exists) return false;
  state = doc.data();
  return true;
}

function iniciarNuevo() {
  const tarjetas = {};
  DEFAULT_TARJETAS.forEach(t => { tarjetas[t.id] = { saldoInicial: 0 }; });
  state = {
    tarjetas: DEFAULT_TARJETAS.map(t => ({ ...t })),
    periodos: [{
      id:        Date.now(),
      fecha:     hoy(),
      esInicial: true,
      cerrado:   false,
      tarjetas
    }]
  };
  guardar();
}

// ── Calculos ─────────────────────────────────────────────────────────────────

// Si no se ingresó deudaActual (es 0), hereda el saldo del periodo anterior
function getDeudaEfectiva(idx, tId) {
  const da = state.periodos[idx].tarjetas[tId]?.deudaActual || 0;
  if (da === 0 && idx > 0) return getSaldo(idx - 1, tId);
  return da;
}

// Saldo de un periodo para una tarjeta
// - Periodo inicial: saldoInicial (editable)
// - Periodo normal: deudaEfectiva - pagos
function getSaldo(idx, tId) {
  const p = state.periodos[idx];
  if (p.esInicial) return p.tarjetas[tId]?.saldoInicial || 0;
  return getDeudaEfectiva(idx, tId) - (p.tarjetas[tId]?.pagos || 0);
}

// Gastos = Deuda Efectiva - Saldo del periodo anterior
function getGastos(idx, tId) {
  if (idx === 0) return 0;
  const p = state.periodos[idx];
  if (p.esInicial) return 0;
  return getDeudaEfectiva(idx, tId) - getSaldo(idx - 1, tId);
}

// Suma de un campo para todas las tarjetas de un tipo (TC o CR)
function sumaTotal(idx, tipo, campo) {
  return state.tarjetas
    .filter(t => t.tipo === tipo)
    .reduce((sum, t) => {
      if (campo === 'gastos')      return sum + getGastos(idx, t.id);
      if (campo === 'saldo')       return sum + getSaldo(idx, t.id);
      if (campo === 'deudaActual') return sum + getDeudaEfectiva(idx, t.id);
      return sum + (state.periodos[idx].tarjetas[t.id]?.[campo] || 0);
    }, 0);
}

// ── Actualizacion dinamica de celdas (sin re-render) ─────────────────────────

function actualizarTotalesFila(pId, idx, prefijo, campo) {
  const tc = sumaTotal(idx, 'TC', campo);
  const cr = sumaTotal(idx, 'CR', campo);
  const od = sumaTotal(idx, 'OD', campo);
  fijarCelda(`${prefijo}TC_${pId}`, tc);
  fijarCelda(`${prefijo}CR_${pId}`, cr);
  fijarCelda(`${prefijo}OD_${pId}`, od);
  fijarCelda(`${prefijo}T_${pId}`,  tc + cr + od);
}

function actualizarGastosNextPeriodo(idx) {
  if (idx + 1 >= state.periodos.length) return;
  const nextIdx = idx + 1;
  const nextId  = state.periodos[nextIdx].id;

  state.tarjetas.forEach(t => fijarCelda(`gc_${nextId}_${t.id}`, getGastos(nextIdx, t.id)));
  actualizarTotalesFila(nextId, nextIdx, 'g', 'gastos');
}

function actualizarCeldas(periodoId) {
  const idx = state.periodos.findIndex(p => p.id === periodoId);
  const p   = state.periodos[idx];

  if (p.esInicial) {
    actualizarTotalesFila(periodoId, idx, 'si', 'saldo');
    actualizarGastosNextPeriodo(idx);
    return;
  }

  // Celdas calculadas por tarjeta
  state.tarjetas.forEach(t => {
    fijarCelda(`gc_${periodoId}_${t.id}`, getGastos(idx, t.id));
    fijarCelda(`sc_${periodoId}_${t.id}`, getSaldo(idx, t.id));
  });

  // Totales de cada fila
  actualizarTotalesFila(periodoId, idx, 'da', 'deudaActual');
  actualizarTotalesFila(periodoId, idx, 'g',  'gastos');
  actualizarTotalesFila(periodoId, idx, 'p',  'pagos');
  actualizarTotalesFila(periodoId, idx, 's',  'saldo');

  actualizarGastosNextPeriodo(idx);
}

// ── Render ───────────────────────────────────────────────────────────────────

function mkTd(className) {
  const td = document.createElement('td');
  if (className) td.className = className;
  return td;
}

function mkInput(valor, onCambio) {
  const input = document.createElement('input');
  input.type      = 'text';
  input.className = 'input-valor';
  input.value     = valor === 0 ? '' : formatCOP(valor);
  input._valor    = valor;

  input.addEventListener('focus', () => {
    const num = input._valor || 0;
    input.value = num === 0 ? '' : formatMiles(num);
    input.select();
  });

  input.addEventListener('input', () => {
    const raw = input.value.replace(/\./g, '').replace(/[^\d]/g, '');
    const num = parseInt(raw, 10) || 0;
    input._valor = num;
    if (raw) {
      input.value = formatMiles(num);
      input.setSelectionRange(input.value.length, input.value.length);
    }
    onCambio(num);
  });

  input.addEventListener('blur', () => {
    const num = input._valor || 0;
    input.value = num === 0 ? '' : formatCOP(num);
  });

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
  });

  return input;
}

function agregarTotales(tr, pId, prefijo, tc, cr, od) {
  const tdTC = mkTd('col-total col-tc');
  tdTC.id    = `${prefijo}TC_${pId}`;
  tdTC.textContent = formatCOP(tc);

  const tdCR = mkTd('col-total col-cr');
  tdCR.id    = `${prefijo}CR_${pId}`;
  tdCR.textContent = formatCOP(cr);

  const tdOD = mkTd('col-total col-od');
  tdOD.id    = `${prefijo}OD_${pId}`;
  tdOD.textContent = formatCOP(od);

  const tdT  = mkTd('col-total col-gen');
  tdT.id     = `${prefijo}T_${pId}`;
  tdT.textContent = formatCOP(tc + cr + od);

  tr.appendChild(tdTC);
  tr.appendChild(tdCR);
  tr.appendChild(tdOD);
  tr.appendChild(tdT);
}

// Primer periodo: solo fila "Saldo Inicial"
function renderPeriodoInicial(p, idx, tbody) {
  const tr = document.createElement('tr');
  tr.className = 'fila-saldoInicial';

  const tdF = mkTd('col-fecha');
  tdF.textContent = p.fecha;
  tr.appendChild(tdF);

  const tdE = mkTd('col-estado');
  tdE.textContent = 'Saldo Inicial';
  tr.appendChild(tdE);

  state.tarjetas.forEach(t => {
    const td = mkTd('col-valor');
    if (!p.cerrado) {
      td.appendChild(mkInput(p.tarjetas[t.id]?.saldoInicial || 0, v => {
        p.tarjetas[t.id].saldoInicial = v;
        guardar();
        actualizarCeldas(p.id);
      }));
    } else {
      td.textContent = formatCOP(p.tarjetas[t.id]?.saldoInicial || 0);
    }
    tr.appendChild(td);
  });

  agregarTotales(tr, p.id, 'si', sumaTotal(idx, 'TC', 'saldo'), sumaTotal(idx, 'CR', 'saldo'), sumaTotal(idx, 'OD', 'saldo'));
  tbody.appendChild(tr);
}

// Periodos normales: Deuda Actual / Gastos / Pagos / Saldo
function renderPeriodoNormal(p, idx, tbody) {
  const FILAS = [
    { key: 'deudaActual', label: 'Deuda Actual', calculado: false, prefijo: 'da' },
    { key: 'gastos',      label: 'Gastos',        calculado: true,  prefijo: 'g'  },
    { key: 'pagos',       label: 'Pagos',         calculado: false, prefijo: 'p'  },
    { key: 'saldo',       label: 'Saldo',         calculado: true,  prefijo: 's'  },
  ];

  FILAS.forEach((fila, fi) => {
    const tr = document.createElement('tr');
    tr.className = `fila-${fila.key}`;

    const tdF = mkTd('col-fecha');
    if (fi === 0) tdF.textContent = p.fecha;
    tr.appendChild(tdF);

    const tdE = mkTd('col-estado');
    tdE.textContent = fila.label;
    tr.appendChild(tdE);

    state.tarjetas.forEach(t => {
      const td = mkTd('col-valor');

      if (fila.calculado) {
        const valor = fila.key === 'gastos' ? getGastos(idx, t.id) : getSaldo(idx, t.id);
        td.id = `${fila.prefijo}c_${p.id}_${t.id}`;
        td.textContent = formatCOP(valor);

      } else if (!p.cerrado) {
        td.appendChild(mkInput(p.tarjetas[t.id]?.[fila.key] || 0, v => {
          p.tarjetas[t.id][fila.key] = v;
          guardar();
          actualizarCeldas(p.id);
        }));

      } else {
        td.textContent = formatCOP(p.tarjetas[t.id]?.[fila.key] || 0);
      }

      tr.appendChild(td);
    });

    agregarTotales(tr, p.id, fila.prefijo,
      sumaTotal(idx, 'TC', fila.key),
      sumaTotal(idx, 'CR', fila.key),
      sumaTotal(idx, 'OD', fila.key));

    tbody.appendChild(tr);
  });
}

function renderPeriodo(p, idx) {
  const tbody = document.getElementById('tabla-body');

  if (!p.cerrado) {
    const trInd = document.createElement('tr');
    trInd.className = 'fila-indicador';
    const td = document.createElement('td');
    td.colSpan = state.tarjetas.length + 6;
    td.innerHTML = '<span class="badge-activo">● Período activo</span>';
    trInd.appendChild(td);
    tbody.appendChild(trInd);
  }

  if (p.esInicial) renderPeriodoInicial(p, idx, tbody);
  else             renderPeriodoNormal(p, idx, tbody);

  const trSep = document.createElement('tr');
  trSep.className = 'fila-separador';
  const tdSep = document.createElement('td');
  tdSep.colSpan = state.tarjetas.length + 6;
  trSep.appendChild(tdSep);
  tbody.appendChild(trSep);
}

// ── (reservado) ──────────────────────────────────────────────────────────────

function renderAcordeonPeriodo(p, idx, contenedor) {
  const esInicial = p.esInicial;
  const tcTotal   = sumaTotal(idx, 'TC', 'saldo');
  const crTotal   = sumaTotal(idx, 'CR', 'saldo');
  const total     = tcTotal + crTotal;

  const card = document.createElement('div');
  card.className = 'ac-card' + (p.cerrado ? '' : ' ac-activo');

  // Header del acordeón
  const header = document.createElement('div');
  header.className = 'ac-header';
  header.innerHTML = `
    <div class="ac-header-left">
      ${!p.cerrado ? '<span class="ac-badge">● Activo</span>' : ''}
      <span class="ac-fecha">${p.fecha}</span>
      <span class="ac-label">${esInicial ? 'Saldo Inicial' : 'Período'}</span>
    </div>
    <div class="ac-header-right">
      <span class="ac-total">${formatCOP(total)}</span>
      <span class="ac-chevron">▾</span>
    </div>`;

  // Cuerpo del acordeón (empieza abierto si es activo)
  const body = document.createElement('div');
  body.className = 'ac-body' + (!p.cerrado ? ' ac-open' : '');

  // Filas por tarjeta
  state.tarjetas.forEach(t => {
    const tData   = p.tarjetas[t.id] || {};
    const saldo   = getSaldo(idx, t.id);
    const gastos  = getGastos(idx, t.id);

    const row = document.createElement('div');
    row.className = 'ac-row';

    if (esInicial) {
      // Saldo inicial: una sola fila editable
      const inputEl = !p.cerrado ? `<input type="text" class="ac-input" data-tid="${t.id}" data-pid="${p.id}" value="${tData.saldoInicial ? formatCOP(tData.saldoInicial) : ''}">` : `<span class="ac-val">${formatCOP(tData.saldoInicial || 0)}</span>`;
      row.innerHTML = `<span class="ac-nombre">${t.nombre}</span>${inputEl}`;
    } else {
      row.innerHTML = `
        <span class="ac-nombre">${t.nombre}</span>
        <div class="ac-valores">
          <div class="ac-fila-val">
            <span class="ac-etiq">Deuda</span>
            ${!p.cerrado
              ? `<input type="text" class="ac-input" data-campo="deudaActual" data-tid="${t.id}" data-pid="${p.id}" value="${tData.deudaActual ? formatCOP(tData.deudaActual) : ''}">`
              : `<span class="ac-val">${formatCOP(tData.deudaActual || 0)}</span>`}
          </div>
          <div class="ac-fila-val">
            <span class="ac-etiq ac-gastos">Gastos</span>
            <span class="ac-val ac-gastos">${formatCOP(gastos)}</span>
          </div>
          <div class="ac-fila-val">
            <span class="ac-etiq">Pagos</span>
            ${!p.cerrado
              ? `<input type="text" class="ac-input" data-campo="pagos" data-tid="${t.id}" data-pid="${p.id}" value="${tData.pagos ? formatCOP(tData.pagos) : ''}">`
              : `<span class="ac-val">${formatCOP(tData.pagos || 0)}</span>`}
          </div>
          <div class="ac-fila-val ac-fila-saldo">
            <span class="ac-etiq">Saldo</span>
            <span class="ac-val ac-saldo-val" data-sid="${p.id}-${t.id}">${formatCOP(saldo)}</span>
          </div>
        </div>`;
    }

    body.appendChild(row);
  });

  // Totales al pie
  const footer = document.createElement('div');
  footer.className = 'ac-footer';
  footer.innerHTML = `
    <div class="ac-total-row"><span>Total TC</span><span>${formatCOP(tcTotal)}</span></div>
    <div class="ac-total-row"><span>Total CR</span><span>${formatCOP(crTotal)}</span></div>
    <div class="ac-total-row ac-total-gen"><span>Total</span><span>${formatCOP(total)}</span></div>`;
  body.appendChild(footer);

  // Toggle acordeón
  header.addEventListener('click', () => {
    body.classList.toggle('ac-open');
    header.querySelector('.ac-chevron').textContent = body.classList.contains('ac-open') ? '▾' : '▸';
  });

  card.appendChild(header);
  card.appendChild(body);
  contenedor.appendChild(card);

  // Inputs del acordeón — misma lógica que la tabla
  card.querySelectorAll('.ac-input').forEach(input => {
    const pid   = Number(input.dataset.pid);
    const tid   = input.dataset.tid;
    const campo = input.dataset.campo || 'saldoInicial';
    const periodoObj = state.periodos.find(x => x.id === pid);
    if (!periodoObj) return;

    input.addEventListener('focus', () => {
      const num = periodoObj.tarjetas[tid]?.[campo] || 0;
      input.value = num === 0 ? '' : formatMiles(num);
      input.select();
    });
    input.addEventListener('input', () => {
      const raw = input.value.replace(/\./g, '').replace(/[^\d]/g, '');
      const num = parseInt(raw, 10) || 0;
      input._valor = num;
      if (raw) {
        input.value = formatMiles(num);
        input.setSelectionRange(input.value.length, input.value.length);
      }
      periodoObj.tarjetas[tid][campo] = num;
      guardar();
      const idxP = state.periodos.findIndex(x => x.id === pid);
      const saldoEl = card.querySelector(`[data-sid="${pid}-${tid}"]`);
      if (saldoEl) saldoEl.textContent = formatCOP(getSaldo(idxP, tid));
    });
    input.addEventListener('blur', () => {
      const num = periodoObj.tarjetas[tid]?.[campo] || 0;
      input.value = num === 0 ? '' : formatCOP(num);
    });
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    });
  });
}

function rerenderAcordeon() {
  const contenedor = document.getElementById('acordeon-body');
  if (!contenedor) return;
  contenedor.innerHTML = '';
  state.periodos.forEach((p, i) => renderAcordeonPeriodo(p, i, contenedor));
}

function renderHeader() {
  const thead = document.getElementById('tabla-header');
  thead.innerHTML = '';
  const tr = document.createElement('tr');

  ['Fecha', 'Estado'].forEach(n => {
    const th = document.createElement('th');
    th.textContent = n;
    tr.appendChild(th);
  });

  state.tarjetas.forEach(t => {
    const th = document.createElement('th');
    th.textContent = t.nombre;
    tr.appendChild(th);
  });

  ['Total TC', 'Total CR', 'Total OD', 'Total'].forEach(n => {
    const th = document.createElement('th');
    th.className = 'th-total';
    th.textContent = n;
    tr.appendChild(th);
  });

  thead.appendChild(tr);
}

function toggleHistorial() {
  _mostrarTodosP = !_mostrarTodosP;
  rerenderTabla();
}

function rerenderTabla() {
  const wrapper    = document.querySelector('.tabla-wrapper');
  const scrollLeft = wrapper?.scrollLeft || 0;
  const tbody      = document.getElementById('tabla-body');
  tbody.innerHTML  = '';

  const total   = state.periodos.length;
  const VISIBLE = 3;
  const desde   = (!_mostrarTodosP && total > VISIBLE) ? total - VISIBLE : 0;
  const cols    = state.tarjetas.length + 6;

  if (desde > 0) {
    const tr = document.createElement('tr');
    tr.className = 'fila-historial';
    const td = document.createElement('td');
    td.colSpan = cols;
    td.innerHTML = `<button class="btn-ver-historial" onclick="toggleHistorial()">+ Ver ${desde} período${desde !== 1 ? 's' : ''} anterior${desde !== 1 ? 'es' : ''}</button>`;
    tr.appendChild(td);
    tbody.appendChild(tr);
  } else if (_mostrarTodosP && total > VISIBLE) {
    const tr = document.createElement('tr');
    tr.className = 'fila-historial';
    const td = document.createElement('td');
    td.colSpan = cols;
    td.innerHTML = `<button class="btn-ver-historial btn-colapsar" onclick="toggleHistorial()">− Mostrar solo los últimos ${VISIBLE} períodos</button>`;
    tr.appendChild(td);
    tbody.appendChild(tr);
  }

  state.periodos.forEach((p, i) => { if (i >= desde) renderPeriodo(p, i); });
  if (wrapper) wrapper.scrollLeft = scrollLeft;
  rerenderAcordeon();
}

// ── Eventos ──────────────────────────────────────────────────────────────────

async function cerrarYCrearPeriodo() {
  const actual = state.periodos.find(p => !p.cerrado);
  if (!actual) return;

  const ok = await dlgConfirm(
    'Cerrar período',
    `¿Cerrar el período del <strong>${actual.fecha}</strong> y crear uno nuevo?<br><br>Se creará un nuevo período en blanco con fecha de hoy.`,
    'warning',
    'Cerrar y crear nuevo'
  );
  if (!ok) return;

  actual.cerrado = true;
  actual.fecha   = hoy();

  const tarjetas = {};
  state.tarjetas.forEach(t => { tarjetas[t.id] = { deudaActual: 0, pagos: 0 }; });

  state.periodos.push({
    id:        Date.now(),
    fecha:     hoy(),
    esInicial: false,
    cerrado:   false,
    tarjetas
  });

  guardar();
  renderHeader();
  rerenderTabla();
}

async function limpiarDatos() {
  const ok = await dlgConfirm(
    'Reiniciar datos',
    'Se borrarán <strong>todos los períodos y columnas</strong> y empezarás desde cero.<br><br>Esta acción no se puede deshacer.',
    'danger',
    'Sí, reiniciar'
  );
  if (ok) {
    iniciarNuevo();
    renderHeader();
    rerenderTabla();
  }
}

// ── Gestión de columnas ───────────────────────────────────────────────────────

// Snapshot de nombres al abrir — permite cancelar sin guardar
let _nombresSnapshot = [];

function abrirModal() {
  _nombresSnapshot = state.tarjetas.map(t => ({ id: t.id, nombre: t.nombre, diaPago: t.diaPago, valorCuota: t.valorCuota }));
  renderListaColumnas();
  verificarCambiosModal();
  document.getElementById('modal-overlay').classList.remove('hidden');
}

function cerrarModal(guardar = false) {
  if (!guardar) {
    _nombresSnapshot.forEach(snap => {
      const t = state.tarjetas.find(t => t.id === snap.id);
      if (t) {
        t.nombre = snap.nombre;
        if (snap.diaPago)    t.diaPago    = snap.diaPago;    else delete t.diaPago;
        if (snap.valorCuota) t.valorCuota = snap.valorCuota; else delete t.valorCuota;
      }
    });
  }
  document.getElementById('modal-overlay').classList.add('hidden');
  document.getElementById('nueva-nombre').value = '';
}

function verificarCambiosModal() {
  const hayCambios = _nombresSnapshot.some(snap => {
    const inputN = document.getElementById(`input-col-${snap.id}`);
    const inputD = document.getElementById(`input-dia-${snap.id}`);
    const inputC = document.getElementById(`input-cuota-${snap.id}`);
    const nombreCambio = inputN && inputN.value.trim() !== snap.nombre;
    const diaCambio    = inputD && (inputD.value || '') !== String(snap.diaPago || '');
    const cuotaActual  = inputC ? (parseInt(inputC.value.replace(/[^\d]/g, ''), 10) || 0) : 0;
    const cuotaCambio  = inputC && cuotaActual !== (snap.valorCuota || 0);
    return nombreCambio || diaCambio || cuotaCambio;
  });
  const btn = document.getElementById('modal-guardar');
  if (btn) btn.disabled = !hayCambios;
}

function guardarCambiosModal() {
  state.tarjetas.forEach(t => {
    const inputN = document.getElementById(`input-col-${t.id}`);
    if (inputN) {
      const nuevoNombre = inputN.value.trim();
      if (nuevoNombre) t.nombre = nuevoNombre;
    }
    const inputD = document.getElementById(`input-dia-${t.id}`);
    if (inputD) {
      const dia = parseInt(inputD.value, 10);
      if (dia >= 1 && dia <= 31) t.diaPago = dia; else delete t.diaPago;
    }
    const inputC = document.getElementById(`input-cuota-${t.id}`);
    if (inputC) {
      const cuota = parseInt(inputC.value.replace(/[^\d]/g, ''), 10) || 0;
      if (cuota > 0) t.valorCuota = cuota; else delete t.valorCuota;
    }
  });
  guardar();
  renderHeader();
  rerenderTabla();
  if (window.actualizarNotificaciones) actualizarNotificaciones();
  cerrarModal(true);
}

function mkMetaInput(id, placeholder, value, type = 'text') {
  const input = document.createElement('input');
  input.type        = type;
  input.id          = id;
  input.className   = 'input-meta';
  input.placeholder = placeholder;
  input.value       = value;
  if (type === 'number') { input.min = 1; input.max = 31; }
  input.addEventListener('input', verificarCambiosModal);
  return input;
}

function renderListaColumnas() {
  ['TC', 'CR', 'OD'].forEach(tipo => {
    const lista   = document.getElementById(`lista-${tipo.toLowerCase()}`);
    lista.innerHTML = '';
    const cols    = state.tarjetas.filter(t => t.tipo === tipo);
    const esCuota = tipo === 'CR' || tipo === 'OD';

    cols.forEach(t => {
      const li = document.createElement('li');
      li.className = 'col-item';

      // Nombre (ocupa el espacio disponible)
      const inputNombre = document.createElement('input');
      inputNombre.type      = 'text';
      inputNombre.id        = `input-col-${t.id}`;
      inputNombre.className = 'input-nombre-col';
      inputNombre.value     = t.nombre;
      inputNombre.maxLength = 20;
      inputNombre.addEventListener('input', verificarCambiosModal);
      inputNombre.addEventListener('keydown', e => {
        if (e.key === 'Enter')  inputNombre.blur();
        if (e.key === 'Escape') { inputNombre.value = t.nombre; verificarCambiosModal(); inputNombre.blur(); }
      });
      li.appendChild(inputNombre);

      // Día de pago (label + input, todo en línea)
      const lblDia = document.createElement('label');
      lblDia.className = 'col-item-label';
      lblDia.innerHTML = '<span>Día de pago</span>';
      lblDia.appendChild(mkMetaInput(`input-dia-${t.id}`, '1–31', t.diaPago || '', 'number'));
      li.appendChild(lblDia);

      // Cuota mensual (solo CR y OD)
      if (esCuota) {
        const lblCuota = document.createElement('label');
        lblCuota.className = 'col-item-label';
        lblCuota.innerHTML = '<span>Cuota mensual</span>';

        const inputCuota = document.createElement('input');
        inputCuota.type        = 'text';
        inputCuota.id          = `input-cuota-${t.id}`;
        inputCuota.className   = 'input-meta input-meta-cuota';
        inputCuota.placeholder = '$ 0';
        inputCuota.value       = t.valorCuota ? formatCOP(t.valorCuota) : '';
        inputCuota.addEventListener('focus', () => {
          const num = t.valorCuota || 0;
          inputCuota.value = num ? formatMiles(num) : '';
          inputCuota.select();
        });
        inputCuota.addEventListener('input', () => {
          const raw = inputCuota.value.replace(/\./g, '').replace(/[^\d]/g, '');
          const num = parseInt(raw, 10) || 0;
          if (raw) {
            inputCuota.value = formatMiles(num);
            inputCuota.setSelectionRange(inputCuota.value.length, inputCuota.value.length);
          }
          verificarCambiosModal();
        });
        inputCuota.addEventListener('blur', () => {
          const num = parseInt(inputCuota.value.replace(/[^\d]/g, ''), 10) || 0;
          inputCuota.value = num ? formatCOP(num) : '';
        });
        inputCuota.addEventListener('keydown', e => { if (e.key === 'Enter') inputCuota.blur(); });

        lblCuota.appendChild(inputCuota);
        li.appendChild(lblCuota);
      }

      // Eliminar (al final de la línea)
      const btnEliminar = document.createElement('button');
      btnEliminar.textContent = 'Eliminar';
      btnEliminar.className   = 'btn-eliminar-col';
      if (cols.length === 1) {
        btnEliminar.disabled = true;
        btnEliminar.title    = `Debe haber al menos una columna de tipo ${tipo}`;
      }
      btnEliminar.addEventListener('click', () => eliminarColumna(t.id, t.nombre));
      li.appendChild(btnEliminar);

      lista.appendChild(li);
    });
  });
}

async function agregarColumna() {
  const nombre = document.getElementById('nueva-nombre').value.trim();
  const tipo   = document.getElementById('nueva-tipo').value;

  if (!nombre) {
    await dlgAlert('Campo requerido', 'Ingresa un nombre para la nueva cuenta.', 'info');
    return;
  }

  // ID único basado en el nombre (sin espacios, minúsculas)
  const id = 'col_' + nombre.toLowerCase().replace(/\s+/g, '_') + '_' + Date.now();

  // Agregar a la lista de tarjetas
  state.tarjetas.push({ id, nombre, tipo });

  // Agregar a todos los periodos existentes con valores en 0
  state.periodos.forEach(p => {
    if (p.esInicial) {
      p.tarjetas[id] = { saldoInicial: 0 };
    } else {
      p.tarjetas[id] = { deudaActual: 0, pagos: 0 };
    }
  });

  guardar();
  renderHeader();
  rerenderTabla();
  renderListaColumnas();
  if (window.actualizarNotificaciones) actualizarNotificaciones();
  document.getElementById('nueva-nombre').value = '';
}

async function eliminarColumna(id, nombre) {
  const ok = await dlgConfirm(
    `Eliminar columna`,
    `¿Eliminar <strong>${nombre}</strong>?<br><br>Se borrará de todos los períodos y no se puede deshacer.`,
    'danger',
    'Eliminar'
  );
  if (!ok) return;

  // Quitar de la lista de tarjetas
  state.tarjetas = state.tarjetas.filter(t => t.id !== id);

  // Quitar de todos los periodos
  state.periodos.forEach(p => delete p.tarjetas[id]);

  guardar();
  renderHeader();
  rerenderTabla();
  renderListaColumnas();
  if (window.actualizarNotificaciones) actualizarNotificaciones();
}

// ── Init ─────────────────────────────────────────────────────────────────────

// Llamado por auth.js cuando el usuario inicia sesion
async function initApp(uid) {
  _uid = uid;

  const tieneDatos = await cargar();
  if (!tieneDatos) iniciarNuevo();

  renderHeader();
  rerenderTabla();
  initAnalisis();
  if (window.actualizarNotificaciones) actualizarNotificaciones();

  // Eventos — solo se registran una vez
  if (!window._eventosRegistrados) {
    window._eventosRegistrados = true;

    document.getElementById('btn-nuevo-periodo').addEventListener('click', cerrarYCrearPeriodo);
    document.getElementById('btn-limpiar').addEventListener('click', limpiarDatos);
    document.getElementById('btn-columnas').addEventListener('click', abrirModal);
    document.getElementById('modal-cerrar').addEventListener('click', () => cerrarModal(false));
    document.getElementById('modal-cancelar').addEventListener('click', () => cerrarModal(false));
    document.getElementById('modal-guardar').addEventListener('click', guardarCambiosModal);
    document.getElementById('btn-agregar-col').addEventListener('click', agregarColumna);

    document.getElementById('modal-overlay').addEventListener('click', e => {
      if (e.target === document.getElementById('modal-overlay')) cerrarModal(false);
    });
  }
}
