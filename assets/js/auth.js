// ── Auth ─────────────────────────────────────────────────────────────────────

function loginConGoogle() {
  auth.signInWithPopup(googleProvider).catch(err => {
    console.error('Error al iniciar sesión:', err);
    alert('No se pudo iniciar sesión. Intenta de nuevo.');
  });
}

function cerrarSesion() {
  if (confirm('¿Cerrar sesión?')) auth.signOut();
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
});
