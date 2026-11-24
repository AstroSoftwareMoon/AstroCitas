// Widget AstroCitas: <script src="https://tu-servidor/widget.js" data-astrocitas="tu-negocio" async></script>
// Muestra un botón flotante «Reservar cita» que abre la reserva en una ventana sobre tu web.
(function () {
  'use strict';
  var me = document.currentScript || document.querySelector('script[data-astrocitas]');
  if (!me) return;
  var slug = me.getAttribute('data-astrocitas');
  var origin = new URL(me.src).origin;
  var label = me.getAttribute('data-label') || (navigator.language.indexOf('en') === 0 ? 'Book now' : 'Reservar cita');
  var css = '.astro-btn{position:fixed;right:20px;bottom:20px;z-index:2147483000;border:0;border-radius:999px;padding:14px 22px;font:600 15px/1 system-ui,-apple-system,sans-serif;color:#000;background:#fff;box-shadow:0 10px 30px -6px rgba(0,0,0,.45);cursor:pointer}' +
    '.astro-ov{position:fixed;inset:0;z-index:2147483001;background:rgba(0,0,0,.55);backdrop-filter:blur(6px);display:flex;align-items:flex-end;justify-content:center}' +
    '@media(min-width:640px){.astro-ov{align-items:center}}' +
    '.astro-fr{width:100%;max-width:560px;height:min(88vh,780px);border:0;border-radius:28px 28px 0 0;background:#000}' +
    '@media(min-width:640px){.astro-fr{border-radius:28px}}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  var btn = document.createElement('button'); btn.className = 'astro-btn'; btn.type = 'button'; btn.textContent = label;
  btn.setAttribute('aria-haspopup', 'dialog');
  btn.onclick = function () {
    var ov = document.createElement('div'); ov.className = 'astro-ov'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-label', label);
    var fr = document.createElement('iframe'); fr.className = 'astro-fr'; fr.title = label;
    fr.src = origin + '/b/' + encodeURIComponent(slug) + '?embed=1';
    ov.appendChild(fr);
    function close() { ov.remove(); document.removeEventListener('keydown', esc); }
    function esc(e) { if (e.key === 'Escape') close(); }
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    document.addEventListener('keydown', esc);
    document.body.appendChild(ov);
  };
  document.body.appendChild(btn);
})();
