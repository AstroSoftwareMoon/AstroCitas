import type { Business, Service, Staff } from './types';
import { formatMoney } from './presets';
import { minutesToHHMM } from './time';
import { normalizePhone } from './reminders';

/**
 * "Modo solicitud" del modo local: página HTML autocontenida (sin servidor, sin JS externo)
 * que el negocio puede compartir o subir a cualquier sitio. El cliente elige servicio y
 * preferencia y la petición se envía por WhatsApp o email al negocio, que la acepta en un toque.
 */
export function generateRequestPage(p: { business: Business; services: Service[]; staff: Staff[]; locale?: 'es' | 'en' }): string {
  const { business: b } = p;
  const es = (p.locale ?? b.locale) !== 'en';
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
  const days = es ? ['', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'] : ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const hours = new Map<number, string[]>();
  for (const s of p.staff.filter((x) => x.active))
    for (const h of s.hours) {
      const label = `${minutesToHHMM(h.start)}–${minutesToHHMM(h.end)}`;
      const list = hours.get(h.weekday) ?? [];
      if (!list.includes(label)) list.push(label);
      hours.set(h.weekday, list.sort());
    }
  const services = p.services.filter((s) => s.active);
  const phone = normalizePhone(b.phone);
  const t = es
    ? { title: 'Pide tu cita', name: 'Tu nombre', svc: 'Servicio', when: '¿Cuándo te viene bien?', whenPh: 'Ej. martes por la tarde', notes: 'Comentarios', wa: 'Enviar por WhatsApp', mail: 'Enviar por email', hours: 'Horario', note: 'Tu petición llega al negocio, que te confirmará la cita.', msg: 'Hola, quiero pedir cita' }
    : { title: 'Request an appointment', name: 'Your name', svc: 'Service', when: 'When suits you?', whenPh: 'e.g. Tuesday afternoon', notes: 'Comments', wa: 'Send via WhatsApp', mail: 'Send via email', hours: 'Opening hours', note: 'Your request goes to the business, who will confirm it.', msg: 'Hi, I would like to book' };
  const data = JSON.stringify({ phone, email: b.email, name: b.name, msg: t.msg });
  return `<!doctype html>
<html lang="${es ? 'es' : 'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(b.name)} · ${t.title}</title>
<style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;font-family:Outfit,ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#f2f2f3;background:#000 radial-gradient(60% 50% at 100% 0%,rgba(255,10,160,.14),transparent 70%),radial-gradient(60% 50% at 0% 100%,rgba(138,28,255,.18),transparent 70%);background-attachment:fixed;padding:24px 16px}
main{max-width:520px;margin:0 auto}h1{font-size:34px;letter-spacing:-.02em;margin:8px 0 4px}p{color:#9a9aa0;margin:0 0 20px}
.glass{border-radius:28px;padding:20px;background:linear-gradient(180deg,rgba(255,255,255,.10),transparent 50%),rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.18);backdrop-filter:blur(22px) saturate(180%);-webkit-backdrop-filter:blur(22px) saturate(180%);margin-bottom:16px}
label{display:block;font-size:12px;color:#9a9aa0;margin:12px 0 6px}input,select,textarea{width:100%;font:inherit;color:#fff;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:16px;padding:12px 14px;outline:none}
input:focus,select:focus,textarea:focus{border-color:rgba(255,255,255,.45)}select option{color:#000}
.row{display:flex;gap:10px;margin-top:18px;flex-wrap:wrap}button{flex:1;min-width:180px;font:inherit;font-weight:600;border:0;border-radius:999px;padding:14px 18px;cursor:pointer}
.primary{background:#fff;color:#000}.secondary{background:rgba(255,255,255,.1);color:#fff}button:disabled{opacity:.4;cursor:not-allowed}
ul{list-style:none;padding:0;margin:0}li{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.06);font-size:14px}li:last-child{border:0}small{color:#9a9aa0}
</style></head><body><main>
<p style="margin:0">${esc(b.name)}</p><h1>${t.title}</h1><p>${t.note}</p>
<form class="glass" id="f">
<label for="n">${t.name}</label><input id="n" required autocomplete="name">
<label for="s">${t.svc}</label><select id="s">${services.map((s) => `<option>${esc(s.name)} (${s.durationMin} min${s.priceCents ? ' · ' + esc(formatMoney(s.priceCents, b.currency, es ? 'es' : 'en')) : ''})</option>`).join('')}</select>
<label for="w">${t.when}</label><input id="w" placeholder="${t.whenPh}">
<label for="c">${t.notes}</label><textarea id="c" rows="2"></textarea>
<div class="row">${phone ? `<button type="button" class="primary" data-ch="wa">${t.wa}</button>` : ''}${b.email ? `<button type="button" class="${phone ? 'secondary' : 'primary'}" data-ch="mail">${t.mail}</button>` : ''}</div>
</form>
${hours.size ? `<section class="glass"><strong>${t.hours}</strong><ul>${[...hours.entries()].sort((a, c) => a[0] - c[0]).map(([d, l]) => `<li><span>${days[d]}</span><small>${l.join(' · ')}</small></li>`).join('')}</ul></section>` : ''}
${b.address ? `<p>${esc(b.address)}</p>` : ''}
</main>
<script>
var D=${data.replace(/</g, '\\u003c')};
document.querySelectorAll('[data-ch]').forEach(function(btn){btn.addEventListener('click',function(){
var f=document.getElementById('f');if(!f.reportValidity())return;
var v=function(id){return document.getElementById(id).value.trim()};
var text=D.msg+' — '+v('s')+'\\n'+v('n')+(v('w')?'\\n'+v('w'):'')+(v('c')?'\\n'+v('c'):'');
if(btn.dataset.ch==='wa')location.href='https://wa.me/'+D.phone+'?text='+encodeURIComponent(text);
else location.href='mailto:'+D.email+'?subject='+encodeURIComponent(D.msg+' · '+D.name)+'&body='+encodeURIComponent(text);
})});
</script></body></html>`;
}

/** Enlace directo para el QR del mostrador: abre WhatsApp con la plantilla de solicitud. */
export function requestLink(business: Pick<Business, 'phone' | 'email' | 'name'>, text: string): string | null {
  const phone = normalizePhone(business.phone);
  if (phone) return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
  if (business.email) return `mailto:${business.email}?subject=${encodeURIComponent(business.name)}&body=${encodeURIComponent(text)}`;
  return null;
}
