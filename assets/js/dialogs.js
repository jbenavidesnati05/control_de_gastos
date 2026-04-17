// ── Sistema de diálogos custom (reemplaza alert/confirm nativos) ──────────────

(function () {

  // Inyecta el HTML del dialogo en el body al cargar
  const template = `
    <div id="dlg-overlay" class="dlg-overlay dlg-hidden">
      <div class="dlg-card">
        <div class="dlg-icon-wrap">
          <span class="dlg-icon"></span>
        </div>
        <h3 class="dlg-title"></h3>
        <p class="dlg-msg"></p>
        <div class="dlg-actions">
          <button class="dlg-btn-cancel btn-secondary">Cancelar</button>
          <button class="dlg-btn-ok btn-primary">Aceptar</button>
        </div>
      </div>
    </div>`;

  document.addEventListener('DOMContentLoaded', () => {
    document.body.insertAdjacentHTML('beforeend', template);
  });

  // Tipos de icono y color
  const TIPOS = {
    success: { icon: '✓', color: '#48bb78', bg: '#f0fff4' },
    warning: { icon: '⚠',  color: '#ed8936', bg: '#fffaf0' },
    danger:  { icon: '✕',  color: '#e53e3e', bg: '#fff5f5' },
    info:    { icon: 'ℹ',  color: '#3182ce', bg: '#ebf8ff' },
  };

  function mostrarDlg({ tipo = 'info', titulo, mensaje, confirmText = 'Aceptar', cancelText = 'Cancelar', soloOk = false }) {
    return new Promise(resolve => {
      const overlay  = document.getElementById('dlg-overlay');
      const t        = TIPOS[tipo] || TIPOS.info;

      overlay.querySelector('.dlg-icon').textContent      = t.icon;
      overlay.querySelector('.dlg-icon').style.background = t.color;
      overlay.querySelector('.dlg-card').style.borderTop  = `4px solid ${t.color}`;
      overlay.querySelector('.dlg-title').textContent     = titulo;
      overlay.querySelector('.dlg-msg').innerHTML         = mensaje;

      const btnOk     = overlay.querySelector('.dlg-btn-ok');
      const btnCancel = overlay.querySelector('.dlg-btn-cancel');

      btnOk.textContent     = confirmText;
      btnCancel.textContent = cancelText;
      btnCancel.style.display = soloOk ? 'none' : '';

      // Color del botón ok según tipo
      btnOk.style.background = t.color;
      btnOk.style.borderColor = t.color;

      overlay.classList.remove('dlg-hidden');

      function cerrar(resultado) {
        overlay.classList.add('dlg-hidden');
        btnOk.removeEventListener('click', onOk);
        btnCancel.removeEventListener('click', onCancel);
        overlay.removeEventListener('click', onOverlay);
        resolve(resultado);
      }

      const onOk      = () => cerrar(true);
      const onCancel  = () => cerrar(false);
      const onOverlay = e => { if (e.target === overlay) cerrar(false); };

      btnOk.addEventListener('click', onOk);
      btnCancel.addEventListener('click', onCancel);
      overlay.addEventListener('click', onOverlay);
    });
  }

  // API pública
  window.dlgAlert = (titulo, mensaje, tipo = 'info') =>
    mostrarDlg({ tipo, titulo, mensaje, soloOk: true });

  window.dlgConfirm = (titulo, mensaje, tipo = 'warning', confirmText = 'Confirmar') =>
    mostrarDlg({ tipo, titulo, mensaje, confirmText });

})();
