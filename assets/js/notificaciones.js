// ── Notificaciones de fecha de corte / pago ───────────────────────────────────
// Avisa (badge + panel + notificación nativa del navegador) cuando se acerca
// el "Día de pago" configurado en Mis Cuentas para una tarjeta/crédito.

const UMBRAL_DIAS_NOTIF = 3; // avisa desde N días antes del vencimiento (incluye el día 0 = vence hoy)

function _diasEnMes(anio, mesIndex) {
  return new Date(anio, mesIndex + 1, 0).getDate();
}

function _construirFecha(anio, mesIndex, dia) {
  return new Date(anio, mesIndex, Math.min(dia, _diasEnMes(anio, mesIndex)));
}

// Próxima fecha (>= hoy) en que cae el día de pago indicado
function proximaFechaPago(diaPago) {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);

  let fecha = _construirFecha(hoy.getFullYear(), hoy.getMonth(), diaPago);
  if (fecha < hoy) {
    let mes  = hoy.getMonth() + 1;
    let anio = hoy.getFullYear();
    if (mes > 11) { mes = 0; anio++; }
    fecha = _construirFecha(anio, mes, diaPago);
  }
  return fecha;
}

function _diasHasta(fecha) {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  return Math.round((fecha - hoy) / 86400000);
}

function _textoVencimiento(dias) {
  if (dias === 0) return 'Vence hoy';
  if (dias === 1) return 'Vence mañana';
  return `Vence en ${dias} días`;
}

function obtenerCuentasProximas() {
  return state.tarjetas
    .filter(t => t.diaPago)
    .map(t => {
      const fecha = proximaFechaPago(t.diaPago);
      return { ...t, fecha, dias: _diasHasta(fecha) };
    })
    .filter(t => t.dias <= UMBRAL_DIAS_NOTIF)
    .sort((a, b) => a.dias - b.dias);
}

// ── Notificaciones nativas del navegador ──────────────────────────────────────

function _claveEnviadas() {
  return `notifEnviadas_${_uid || 'anon'}`;
}

function _fechaHoyStr() {
  const d = new Date();
  return [d.getFullYear(), d.getMonth() + 1, d.getDate()].join('-');
}

function _leerEnviadas() {
  try { return JSON.parse(localStorage.getItem(_claveEnviadas())) || {}; }
  catch { return {}; }
}

function _marcarEnviada(tarjetaId) {
  const enviadas = _leerEnviadas();
  enviadas[tarjetaId] = _fechaHoyStr();
  localStorage.setItem(_claveEnviadas(), JSON.stringify(enviadas));
}

function _yaEnviadaHoy(tarjetaId) {
  return _leerEnviadas()[tarjetaId] === _fechaHoyStr();
}

function enviarNotificacionesNativas(cuentas) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  cuentas.forEach(c => {
    if (_yaEnviadaHoy(c.id)) return;
    new Notification('Control de Gastos', {
      body: `${c.nombre}: ${_textoVencimiento(c.dias).toLowerCase()} (día ${c.diaPago}).`,
      icon: 'favicon.svg',
      tag: `pago-${c.id}-${_fechaHoyStr()}`,
    });
    _marcarEnviada(c.id);
  });
}

// ── Render UI ──────────────────────────────────────────────────────────────────

function _actualizarPermisoUI() {
  const bloque = document.getElementById('notif-permiso');
  if (!bloque) return;
  const soportado = 'Notification' in window;
  bloque.classList.toggle('hidden', !soportado || Notification.permission !== 'default');
}

function renderNotifPanel(cuentas) {
  const lista = document.getElementById('notif-lista');
  const vacio = document.getElementById('notif-vacio');
  if (!lista) return;

  lista.innerHTML = '';
  vacio.classList.toggle('hidden', cuentas.length > 0);

  cuentas.forEach(c => {
    const li = document.createElement('li');
    li.className = 'notif-item' + (c.dias === 0 ? ' notif-urgente' : '');
    li.innerHTML = `
      <span class="notif-item-icono"><i class="fa-solid fa-circle-exclamation"></i></span>
      <div class="notif-item-info">
        <span class="notif-item-nombre">${c.nombre}</span>
        <span class="notif-item-detalle">${_textoVencimiento(c.dias)} · día ${c.diaPago}${c.valorCuota ? ' · ' + formatCOP(c.valorCuota) : ''}</span>
      </div>`;
    lista.appendChild(li);
  });
}

function actualizarBadge(cantidad) {
  const badge = document.getElementById('notif-badge');
  if (!badge) return;
  badge.textContent = cantidad > 9 ? '9+' : String(cantidad);
  badge.classList.toggle('hidden', cantidad === 0);
}

function actualizarNotificaciones() {
  if (!state || !Array.isArray(state.tarjetas)) return;
  const cuentas = obtenerCuentasProximas();
  actualizarBadge(cuentas.length);
  renderNotifPanel(cuentas);
  _actualizarPermisoUI();
  enviarNotificacionesNativas(cuentas);
}

// ── Interacción (abrir/cerrar panel, activar permisos) ────────────────────────

function _toggleNotifPanel(forzarCerrado = false) {
  const panel = document.getElementById('notif-panel');
  if (!panel) return;
  if (forzarCerrado) { panel.classList.add('hidden'); return; }
  panel.classList.toggle('hidden');
}

document.addEventListener('DOMContentLoaded', () => {
  const btn   = document.getElementById('btn-notificaciones');
  const panel = document.getElementById('notif-panel');
  const btnActivar = document.getElementById('btn-activar-notif');

  btn?.addEventListener('click', e => {
    e.stopPropagation();
    _toggleNotifPanel();
  });

  document.addEventListener('click', e => {
    if (panel && !panel.classList.contains('hidden') && !panel.contains(e.target) && e.target !== btn) {
      _toggleNotifPanel(true);
    }
  });

  btnActivar?.addEventListener('click', () => {
    if (!('Notification' in window)) return;
    Notification.requestPermission().then(() => actualizarNotificaciones());
  });

  // Revisa de nuevo si la pestaña vuelve a estar activa (ej: pasó la medianoche)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') actualizarNotificaciones();
  });

  // Revisión periódica por si la app queda abierta mucho tiempo
  setInterval(actualizarNotificaciones, 30 * 60 * 1000);
});
