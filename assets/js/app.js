let state   = { tarjetas: [], periodos: [] };
let _uid    = null;   // UID del usuario autenticado

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

  userDocRef(_uid).set(state)
    .then(() => {
      _guardadoTimer = setTimeout(() => mostrarIndicador(false), 800);
    })
    .catch(err => console.error('Error al guardar:', err));
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
  fijarCelda(`${prefijo}TC_${pId}`, tc);
  fijarCelda(`${prefijo}CR_${pId}`, cr);
  fijarCelda(`${prefijo}T_${pId}`,  tc + cr);
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
  input.type      = 'number';
  input.className = 'input-valor';
  input.value     = valor;
  input.min       = 0;
  input.addEventListener('input', () => onCambio(parseFloat(input.value) || 0));
  return input;
}

function agregarTotales(tr, pId, prefijo, tc, cr) {
  const tdTC = mkTd('col-total col-tc');
  tdTC.id    = `${prefijo}TC_${pId}`;
  tdTC.textContent = formatCOP(tc);

  const tdCR = mkTd('col-total col-cr');
  tdCR.id    = `${prefijo}CR_${pId}`;
  tdCR.textContent = formatCOP(cr);

  const tdT  = mkTd('col-total col-gen');
  tdT.id     = `${prefijo}T_${pId}`;
  tdT.textContent = formatCOP(tc + cr);

  tr.appendChild(tdTC);
  tr.appendChild(tdCR);
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

  agregarTotales(tr, p.id, 'si', sumaTotal(idx, 'TC', 'saldo'), sumaTotal(idx, 'CR', 'saldo'));
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
      sumaTotal(idx, 'CR', fila.key));

    tbody.appendChild(tr);
  });
}

function renderPeriodo(p, idx) {
  const tbody = document.getElementById('tabla-body');

  if (!p.cerrado) {
    const trInd = document.createElement('tr');
    trInd.className = 'fila-indicador';
    const td = document.createElement('td');
    td.colSpan = state.tarjetas.length + 5;
    td.innerHTML = '<span class="badge-activo">● Período activo</span>';
    trInd.appendChild(td);
    tbody.appendChild(trInd);
  }

  if (p.esInicial) renderPeriodoInicial(p, idx, tbody);
  else             renderPeriodoNormal(p, idx, tbody);

  const trSep = document.createElement('tr');
  trSep.className = 'fila-separador';
  const tdSep = document.createElement('td');
  tdSep.colSpan = state.tarjetas.length + 5;
  trSep.appendChild(tdSep);
  tbody.appendChild(trSep);
}

function renderHeader() {
  const thead = document.getElementById('tabla-header');
  thead.innerHTML = '';
  const tr = document.createElement('tr');
  ['Fecha', 'Estado', ...state.tarjetas.map(t => t.nombre), 'Total TC', 'Total CR', 'Total']
    .forEach((n, i, arr) => {
      const th = document.createElement('th');
      th.textContent = n;
      if (i >= arr.length - 3) th.className = 'th-total';
      tr.appendChild(th);
    });
  thead.appendChild(tr);
}

function rerenderTabla() {
  const wrapper    = document.querySelector('.tabla-wrapper');
  const scrollLeft = wrapper?.scrollLeft || 0;
  document.getElementById('tabla-body').innerHTML = '';
  state.periodos.forEach((p, i) => renderPeriodo(p, i));
  if (wrapper) wrapper.scrollLeft = scrollLeft;
}

// ── Eventos ──────────────────────────────────────────────────────────────────

function cerrarYCrearPeriodo() {
  const actual = state.periodos.find(p => !p.cerrado);
  if (!actual) return;

  const ok = confirm(
    `¿Cerrar el período del ${actual.fecha} y crear uno nuevo?\n\n` +
    `Se creará un nuevo período en blanco con fecha de hoy.`
  );
  if (!ok) return;

  actual.cerrado = true;

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

function limpiarDatos() {
  if (confirm('¿Borrar todos los datos y empezar desde cero?')) {
    iniciarNuevo();
    renderHeader();
    rerenderTabla();
  }
}

// ── Gestión de columnas ───────────────────────────────────────────────────────

// Snapshot de nombres al abrir — permite cancelar sin guardar
let _nombresSnapshot = [];

function abrirModal() {
  _nombresSnapshot = state.tarjetas.map(t => ({ id: t.id, nombre: t.nombre }));
  renderListaColumnas();
  verificarCambiosModal();
  document.getElementById('modal-overlay').classList.remove('hidden');
}

function cerrarModal(guardar = false) {
  if (!guardar) {
    // Restaurar nombres originales si el usuario cancela
    _nombresSnapshot.forEach(snap => {
      const t = state.tarjetas.find(t => t.id === snap.id);
      if (t) t.nombre = snap.nombre;
    });
  }
  document.getElementById('modal-overlay').classList.add('hidden');
  document.getElementById('nueva-nombre').value = '';
}

function verificarCambiosModal() {
  const haycambios = _nombresSnapshot.some(snap => {
    const input = document.getElementById(`input-col-${snap.id}`);
    return input && input.value.trim() !== snap.nombre;
  });
  const btn = document.getElementById('modal-guardar');
  if (btn) btn.disabled = !haycambios;
}

function guardarCambiosModal() {
  // Leer los inputs del modal y aplicar los nombres editados
  state.tarjetas.forEach(t => {
    const input = document.getElementById(`input-col-${t.id}`);
    if (!input) return;
    const nuevoNombre = input.value.trim();
    if (nuevoNombre) t.nombre = nuevoNombre;
  });
  guardar();
  renderHeader();
  rerenderTabla();
  cerrarModal(true);
}

function renderListaColumnas() {
  ['TC', 'CR'].forEach(tipo => {
    const lista = document.getElementById(`lista-${tipo.toLowerCase()}`);
    lista.innerHTML = '';
    const cols = state.tarjetas.filter(t => t.tipo === tipo);

    cols.forEach(t => {
      const li = document.createElement('li');
      li.className = 'col-item';

      // Input de nombre (editable inline, se guarda con el botón del footer)
      const input = document.createElement('input');
      input.type      = 'text';
      input.id        = `input-col-${t.id}`;
      input.className = 'input-nombre-col';
      input.value     = t.nombre;
      input.maxLength = 20;

      input.addEventListener('input', verificarCambiosModal);
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') input.blur();
        if (e.key === 'Escape') { input.value = t.nombre; verificarCambiosModal(); input.blur(); }
      });

      // Botón eliminar
      const btn = document.createElement('button');
      btn.textContent = 'Eliminar';
      btn.className   = 'btn-eliminar-col';

      if (cols.length === 1) {
        btn.disabled = true;
        btn.title    = `Debe haber al menos una columna de tipo ${tipo}`;
      }

      btn.addEventListener('click', () => eliminarColumna(t.id, t.nombre));

      li.appendChild(input);
      li.appendChild(btn);
      lista.appendChild(li);
    });
  });
}

function agregarColumna() {
  const nombre = document.getElementById('nueva-nombre').value.trim();
  const tipo   = document.getElementById('nueva-tipo').value;

  if (!nombre) {
    alert('Ingresa un nombre para la columna.');
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
  document.getElementById('nueva-nombre').value = '';
}

function eliminarColumna(id, nombre) {
  const ok = confirm(`¿Eliminar la columna "${nombre}"?\n\nSe borrará de todos los períodos y no se puede deshacer.`);
  if (!ok) return;

  // Quitar de la lista de tarjetas
  state.tarjetas = state.tarjetas.filter(t => t.id !== id);

  // Quitar de todos los periodos
  state.periodos.forEach(p => delete p.tarjetas[id]);

  guardar();
  renderHeader();
  rerenderTabla();
  renderListaColumnas();
}

// ── Init ─────────────────────────────────────────────────────────────────────

// Llamado por auth.js cuando el usuario inicia sesion
async function initApp(uid) {
  _uid = uid;

  const tieneDatos = await cargar();
  if (!tieneDatos) iniciarNuevo();

  renderHeader();
  rerenderTabla();

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
