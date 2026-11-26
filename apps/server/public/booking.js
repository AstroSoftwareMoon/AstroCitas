// Reserva pública AstroCitas (sin dependencias). Huecos en tiempo real calculados por el servidor
// con la misma lógica de la app; CAPTCHA ALTCHA (prueba de trabajo) resuelto aquí sin terceros.
(function () {
  'use strict';
  var root = document.getElementById('app');
  var slug = root.dataset.slug;
  var reschedule = root.dataset.reschedule || '';
  var embed = document.body.classList.contains('embed');
  var api = '/api/v1/public/' + encodeURIComponent(slug);
  var S = { info: null, service: null, staff: '', date: null, slot: null, days: [], slots: [], sending: false };
  var T = null;

  var es = {
    service: 'Servicio', staff: 'Profesional', any: 'Cualquiera', day: 'Día', time: 'Hora', none: 'No hay huecos este día.',
    you: 'Tus datos', name: 'Nombre y apellidos', phone: 'Teléfono', email: 'Email', notes: 'Comentarios (opcional)',
    consent: 'Acepto que este negocio trate mis datos para gestionar la cita y enviarme recordatorios.',
    book: 'Reservar cita', moving: 'Cambiar mi cita', booking: 'Reservando…', done: '¡Cita reservada!', moved: '¡Cita cambiada!',
    doneDesc: 'Te hemos enviado la confirmación. Puedes añadirla a tu calendario o cambiarla desde el mensaje.',
    another: 'Reservar otra cita', need: 'Indica un teléfono o un email.', min: 'min'
  };
  var en = {
    service: 'Service', staff: 'Professional', any: 'Anyone', day: 'Day', time: 'Time', none: 'No free slots this day.',
    you: 'Your details', name: 'Full name', phone: 'Phone', email: 'Email', notes: 'Comments (optional)',
    consent: 'I agree that this business processes my data to manage the appointment and send me reminders.',
    book: 'Book appointment', moving: 'Change my appointment', booking: 'Booking…', done: 'Appointment booked!', moved: 'Appointment changed!',
    doneDesc: 'We have sent you a confirmation. You can change it from the message.', another: 'Book another', need: 'Enter a phone or an email.', min: 'min'
  };

  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    for (var k in attrs || {}) {
      if (k === 'on') for (var ev in attrs.on) el.addEventListener(ev, attrs.on[ev]);
      else if (attrs[k] !== false && attrs[k] != null) el.setAttribute(k, attrs[k] === true ? '' : attrs[k]);
    }
    (kids || []).forEach(function (c) { if (c != null) el.append(c.nodeType ? c : document.createTextNode(String(c))); });
    return el;
  }
  function get(path) { return fetch(api + path).then(function (r) { return r.ok ? r.json() : r.json().then(function (j) { throw new Error(j.message || r.status); }); }); }
  function fmtTime(ms) { return new Intl.DateTimeFormat(S.info.business.locale === 'en' ? 'en-GB' : 'es-ES', { timeZone: S.info.business.timezone, hour: '2-digit', minute: '2-digit' }).format(ms); }
  function fmtMoney(c) { return c ? new Intl.NumberFormat(S.info.business.locale === 'en' ? 'en-GB' : 'es-ES', { style: 'currency', currency: S.info.business.currency, minimumFractionDigits: c % 100 ? 2 : 0 }).format(c / 100) : ''; }
  function resize() { if (embed && parent !== window) parent.postMessage({ astrocitas: 'resize', height: document.documentElement.scrollHeight }, '*'); }

  // SHA-256 en JS para http://IP-local, donde el navegador no ofrece crypto.subtle.
  var K = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  function sha256hex(msg) {
    var l = msg.length, nb = ((l + 9 + 63) >> 6) << 6, m = new Uint8Array(nb);
    m.set(msg); m[l] = 0x80;
    var bits = l * 8; for (var i = 0; i < 4; i++) m[nb - 1 - i] = (bits >>> (8 * i)) & 0xff;
    var H = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19], W = new Array(64);
    function r(x, n) { return (x >>> n) | (x << (32 - n)); }
    for (var o = 0; o < nb; o += 64) {
      for (var t = 0; t < 16; t++) W[t] = (m[o + 4 * t] << 24) | (m[o + 4 * t + 1] << 16) | (m[o + 4 * t + 2] << 8) | m[o + 4 * t + 3];
      for (t = 16; t < 64; t++) {
        var s0 = r(W[t - 15], 7) ^ r(W[t - 15], 18) ^ (W[t - 15] >>> 3), s1 = r(W[t - 2], 17) ^ r(W[t - 2], 19) ^ (W[t - 2] >>> 10);
        W[t] = (W[t - 16] + s0 + W[t - 7] + s1) | 0;
      }
      var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], hh = H[7];
      for (t = 0; t < 64; t++) {
        var t1 = (hh + (r(e, 6) ^ r(e, 11) ^ r(e, 25)) + ((e & f) ^ (~e & g)) + K[t] + W[t]) | 0;
        var t2 = ((r(a, 2) ^ r(a, 13) ^ r(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
      H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + hh) | 0;
    }
    return H.map(function (x) { return (x >>> 0).toString(16).padStart(8, '0'); }).join('');
  }

  // --- ALTCHA: buscar n tal que SHA-256(salt + n) == challenge ---
  async function solve() {
    var ch = await fetch('/api/v1/public/captcha').then(function (r) { return r.json(); });
    var enc = new TextEncoder();
    for (var n = 0; n <= ch.maxnumber; n++) {
      var bytes = enc.encode(ch.salt + n);
      var hex = crypto.subtle
        ? Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('')
        : sha256hex(bytes);
      if (hex === ch.challenge) return btoa(JSON.stringify({ algorithm: ch.algorithm, challenge: ch.challenge, number: n, salt: ch.salt, signature: ch.signature }));
    }
    throw new Error('captcha');
  }

  function render() {
    var info = S.info;
    var form = h('div');
    // La cabecera (logo, título, bienvenida) y el pie los pinta el servidor con la personalización.
    var opts = info.booking || { showPrices: true, chooseStaff: true };
    root.replaceChildren(form);

    form.append(h('h2', {}, [T.service]), h('div', { class: 'grid' }, info.services.map(function (s) {
      return h('button', { class: 'opt', type: 'button', 'aria-pressed': S.service === s.id ? 'true' : 'false', on: { click: function () { S.service = s.id; S.slot = null; loadDays(); } } },
        [s.name, h('small', {}, [s.durationMin + ' ' + T.min + (s.priceCents && opts.showPrices ? ' · ' + fmtMoney(s.priceCents) : '')])]);
    })));
    if (!S.service) return resize();

    var staff = info.staff.filter(function (p) { return !p.serviceIds.length || p.serviceIds.indexOf(S.service) >= 0; });
    if (staff.length > 1 && opts.chooseStaff) form.append(h('h2', {}, [T.staff]), h('div', { class: 'chips' }, [{ id: '', name: T.any }].concat(staff).map(function (p) {
      return h('button', { class: 'chip', type: 'button', 'aria-pressed': S.staff === p.id ? 'true' : 'false', on: { click: function () { S.staff = p.id; S.slot = null; loadDays(); } } }, [p.name]);
    })));

    form.append(h('h2', {}, [T.day]), h('div', { class: 'days' }, S.days.map(function (d) {
      var dt = new Date(d.date + 'T12:00:00Z');
      var loc = info.business.locale === 'en' ? 'en-GB' : 'es-ES';
      return h('button', { class: 'day', type: 'button', disabled: !d.count, 'aria-pressed': S.date === d.date ? 'true' : 'false', on: { click: function () { S.date = d.date; S.slot = null; loadSlots(); } } },
        [h('span', {}, [new Intl.DateTimeFormat(loc, { weekday: 'short', timeZone: 'UTC' }).format(dt)]), h('b', {}, [dt.getUTCDate()]), h('span', {}, [new Intl.DateTimeFormat(loc, { month: 'short', timeZone: 'UTC' }).format(dt)])]);
    })));
    if (!S.date) return resize();

    form.append(h('h2', {}, [T.time]), S.slots.length ? h('div', { class: 'chips' }, S.slots.map(function (s) {
      return h('button', { class: 'chip', type: 'button', 'aria-pressed': S.slot && S.slot.start === s.start ? 'true' : 'false', on: { click: function () { S.slot = s; render(); } } }, [fmtTime(s.start)]);
    })) : h('p', { class: 'muted' }, [T.none]));
    if (!S.slot) return resize();

    var name = h('input', { autocomplete: 'name', required: true, id: 'n' });
    var phone = h('input', { type: 'tel', autocomplete: 'tel', id: 'p' });
    var email = h('input', { type: 'email', autocomplete: 'email', id: 'e' });
    var notes = h('textarea', { rows: 2, id: 'c' });
    var consent = h('input', { type: 'checkbox', id: 'k' });
    var err = h('p', { class: 'error', role: 'alert' });
    var btn = h('button', { class: 'primary', type: 'submit' }, [reschedule ? T.moving : T.book]);
    var f = h('form', { class: 'glass', on: { submit: async function (e) {
      e.preventDefault();
      err.textContent = '';
      if (!phone.value.trim() && !email.value.trim()) { err.textContent = T.need; return; }
      if (!consent.checked) { consent.focus(); return; }
      btn.disabled = true; btn.textContent = T.booking;
      try {
        var payload = { serviceId: S.service, staffId: S.staff || null, startsAt: S.slot.start, name: name.value, phone: phone.value, email: email.value, notes: notes.value, consent: true, reschedule: reschedule || undefined };
        if (info.captcha) payload.altcha = await solve();
        var r = await fetch(api + '/book', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        var j = await r.json();
        if (!r.ok) throw new Error(j.message || 'Error');
        done(j);
      } catch (x) {
        err.textContent = x.message; btn.disabled = false; btn.textContent = reschedule ? T.moving : T.book;
        if (/disponible|available/.test(x.message)) loadSlots();
      }
    } } }, [
      h('h2', { style: 'margin-top:0' }, [T.you]),
      h('label', { for: 'n' }, [T.name]), name,
      h('label', { for: 'p' }, [T.phone]), phone,
      h('label', { for: 'e' }, [T.email]), email,
      h('label', { for: 'c' }, [T.notes]), notes,
      h('label', { class: 'check', for: 'k' }, [consent, T.consent]),
      btn, err
    ]);
    form.append(h('div', { style: 'height:14px' }), f);
    resize();
    name.focus();
  }

  function done(j) {
    var s = S.info.services.find(function (x) { return x.id === S.service; });
    var when = new Intl.DateTimeFormat(S.info.business.locale === 'en' ? 'en-GB' : 'es-ES', { timeZone: S.info.business.timezone, dateStyle: 'full', timeStyle: 'short' }).format(j.appointment.startsAt);
    root.replaceChildren(h('div', { class: 'glass ok', 'data-testid': 'booked' }, [
      h('h1', {}, [reschedule ? T.moved : T.done]),
      h('div', { class: 'summary' }, [h('span', {}, [s ? s.name : '']), h('b', {}, [when])]),
      h('p', { class: 'muted', style: 'margin-top:12px' }, [T.doneDesc]),
      h('button', { class: 'primary', type: 'button', on: { click: function () { reschedule = ''; S.slot = null; S.date = null; loadDays(); } } }, [T.another])
    ]));
    resize();
  }

  async function loadDays() {
    var q = '?service=' + encodeURIComponent(S.service) + (S.staff ? '&staff=' + encodeURIComponent(S.staff) : '');
    S.days = (await get('/days' + q)).days;
    if (!S.date || !S.days.some(function (d) { return d.date === S.date && d.count; })) S.date = (S.days.find(function (d) { return d.count; }) || {}).date || null;
    if (S.date) await loadSlots(); else render();
  }
  async function loadSlots() {
    var q = '?service=' + encodeURIComponent(S.service) + '&date=' + S.date + (S.staff ? '&staff=' + encodeURIComponent(S.staff) : '');
    S.slots = (await get('/slots' + q)).slots;
    render();
  }

  get('').then(function (info) {
    S.info = info;
    T = info.business.locale === 'en' ? en : es;
    if (info.services.length === 1) { S.service = info.services[0].id; loadDays(); } else render();
  }).catch(function (e) { root.replaceChildren(h('p', { class: 'error' }, [e.message])); });
})();
