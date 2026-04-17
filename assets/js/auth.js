// ── Auth ─────────────────────────────────────────────────────────────────────

function loginConGoogle() {
  auth.signInWithPopup(googleProvider).catch(async err => {
    console.error('Error al iniciar sesión:', err);
    await dlgAlert('Error al iniciar sesión', 'No se pudo conectar con Google. Intenta de nuevo.', 'danger');
  });
}

async function cerrarSesion() {
  const ok = await dlgConfirm('Cerrar sesión', '¿Deseas salir de tu cuenta?', 'warning', 'Salir');
  if (ok) auth.signOut();
}

function mostrarLogin() {
  document.getElementById('pantalla-login').classList.remove('hidden');
  document.getElementById('app').classList.add('hidden');
}

function mostrarApp(usuario) {
  document.getElementById('pantalla-login').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  document.getElementById('usuario-nombre').textContent = usuario.displayName || usuario.email;
  document.getElementById('usuario-foto').src = usuario.photoURL || '';
  document.getElementById('usuario-foto').classList.toggle('hidden', !usuario.photoURL);
  const fotoMovil = document.getElementById('usuario-foto-movil');
  fotoMovil.src = usuario.photoURL || '';
  fotoMovil.classList.toggle('hidden', !usuario.photoURL);
}

// Escucha cambios de sesion
auth.onAuthStateChanged(usuario => {
  if (usuario) {
    mostrarApp(usuario);
    initApp(usuario.uid);   // inicia la app con el uid del usuario
  } else {
    mostrarLogin();
  }
});

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btn-login').addEventListener('click', loginConGoogle);
  document.getElementById('btn-logout').addEventListener('click', cerrarSesion);

  // Hamburguesa
  const btnHam    = document.getElementById('btn-menu-hamburguesa');
  const actions   = document.getElementById('header-actions');
  const btnMovil  = document.getElementById('btn-nuevo-periodo-movil');

  btnHam.addEventListener('click', () => {
    actions.classList.toggle('menu-abierto');
    btnHam.classList.toggle('abierto');
  });

  // Cierra el menú al hacer click fuera
  document.addEventListener('click', e => {
    if (!btnHam.contains(e.target) && !actions.contains(e.target)) {
      actions.classList.remove('menu-abierto');
      btnHam.classList.remove('abierto');
    }
  });

  // Botón + Período del móvil hace lo mismo que el del header
  btnMovil.addEventListener('click', () => cerrarYCrearPeriodo());
});
