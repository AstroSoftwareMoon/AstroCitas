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

  // --- ALTCHA: buscar n tal que SHA-256(salt + n) == challenge ---
  async function solve() {
    var ch = await fetch('/api/v1/public/captcha').then(function (r) { return r.json(); });
    var enc = new TextEncoder();
    for (var n = 0; n <= ch.maxnumber; n++) {
      var buf = await crypto.subtle.digest('SHA-256', enc.encode(ch.salt + n));
      var hex = Array.from(new Uint8Array(buf)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
      if (hex === ch.challenge) return btoa(JSON.stringify({ algorithm: ch.algorithm, challenge: ch.challenge, number: n, salt: ch.salt, signature: ch.signature }));
    }
    throw new Error('captcha');
  }

  function render() {
    var info = S.info;
    var form = h('div');
    root.replaceChildren(h('p', { class: 'muted' }, [info.business.name]), h('h1', {}, [reschedule ? T.moving : (info.business.locale === 'en' ? 'Book an appointment' : 'Reserva tu cita')]), form);

    form.append(h('h2', {}, [T.service]), h('div', { class: 'grid' }, info.services.map(function (s) {
      return h('button', { class: 'opt', type: 'button', 'aria-pressed': S.service === s.id ? 'true' : 'false', on: { click: function () { S.service = s.id; S.slot = null; loadDays(); } } },
        [s.name, h('small', {}, [s.durationMin + ' ' + T.min + (s.priceCents ? ' · ' + fmtMoney(s.priceCents) : '')])]);
    })));
    if (!S.service) return resize();

    var staff = info.staff.filter(function (p) { return !p.serviceIds.length || p.serviceIds.indexOf(S.service) >= 0; });
    if (staff.length > 1) form.append(h('h2', {}, [T.staff]), h('div', { class: 'chips' }, [{ id: '', name: T.any }].concat(staff).map(function (p) {
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
      h('p', { class: 'muted' }, [S.info.business.name]), h('h1', {}, [reschedule ? T.moved : T.done]),
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
