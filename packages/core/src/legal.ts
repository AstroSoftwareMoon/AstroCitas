import type { Business } from './types';

/**
 * Plantilla de política de privacidad (RGPD / LOPDGDD) para la reserva y los recordatorios.
 * Es un punto de partida: el negocio debe revisarla con su asesor. No es asesoramiento legal.
 */
export function privacyPolicy(b: Pick<Business, 'name' | 'address' | 'email' | 'phone'>, opts: { selfHosted: boolean; providers?: string[]; date?: string } = { selfHosted: false }): string {
  const date = opts.date ?? new Date().toISOString().slice(0, 10);
  const contact = [b.email, b.phone].filter(Boolean).join(' · ') || '[email o teléfono de contacto]';
  const providers = opts.providers?.length ? opts.providers.join(', ') : 'los proveedores de mensajería que el negocio tenga configurados (por ejemplo, su servidor de correo, WhatsApp Business o un proveedor de SMS)';
  return `# Política de privacidad — ${b.name}

_Última actualización: ${date}_

## 1. Responsable del tratamiento
**${b.name}**${b.address ? `, ${b.address}` : ''}. Contacto: ${contact}.

## 2. Qué datos tratamos
- Identificación y contacto: nombre, teléfono, email.
- Datos de las citas: servicio, fecha, hora, profesional, notas que nos facilites y estado de la cita.
- Opcionalmente: fecha de cumpleaños y preferencias, si nos las das.
No tratamos categorías especiales de datos salvo que sean imprescindibles para el servicio y nos des tu consentimiento explícito.

## 3. Para qué y con qué base legal
| Finalidad | Base legal |
|---|---|
| Gestionar tus citas (reservar, cambiar, cancelar) | Ejecución de un contrato o medidas precontractuales (art. 6.1.b RGPD) |
| Enviarte recordatorios y confirmaciones de tus citas | Interés legítimo / ejecución del contrato; puedes oponerte en cualquier momento |
| Felicitaciones, ofertas y comunicaciones comerciales | Tu consentimiento (art. 6.1.a RGPD), revocable en cualquier momento |
| Obligaciones contables y fiscales | Obligación legal (art. 6.1.c RGPD) |

## 4. Cuánto tiempo los conservamos
Mientras seas cliente y, después, durante los plazos legales (en general, hasta 6 años para documentación contable). Si nos pides la supresión, anonimizamos tus datos y conservamos solo lo que la ley exige.

## 5. Dónde se guardan
${
  opts.selfHosted
    ? `Los datos se guardan en un servidor controlado por ${b.name}. No se ceden a terceros ni a AstroCitas, que es un software de código abierto sin servicio en la nube propio.`
    : `Los datos se guardan en los dispositivos de ${b.name}. No se envían a ningún servidor externo ni a AstroCitas, que es un software de código abierto sin servicio en la nube propio.`
}

## 6. Destinatarios
No cedemos tus datos a terceros salvo obligación legal. Para enviarte mensajes utilizamos ${providers}, que actúan como encargados del tratamiento. Si alguno se encuentra fuera del Espacio Económico Europeo, la transferencia se ampara en las garantías adecuadas (decisión de adecuación o cláusulas contractuales tipo).

## 7. Tus derechos
Puedes ejercer tus derechos de acceso, rectificación, supresión, oposición, limitación y portabilidad escribiendo a ${contact}. Te entregaremos una copia de tus datos en formato electrónico. Si consideras que no hemos atendido correctamente tu solicitud, puedes reclamar ante la Agencia Española de Protección de Datos (www.aepd.es).

## 8. Seguridad
Aplicamos medidas técnicas y organizativas adecuadas: acceso con contraseña, cifrado de las comunicaciones${opts.selfHosted ? ' (HTTPS)' : ''}, copias de seguridad y, cuando está activado, cifrado de la base de datos en el dispositivo.

---
_Plantilla generada por AstroCitas. Revísala y adáptala a tu caso antes de publicarla._
`;
}
