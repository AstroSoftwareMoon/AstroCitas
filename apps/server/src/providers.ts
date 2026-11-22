import { z } from 'zod';
import { normalizePhone, type MessageChannel } from '@astrocitas/core';

/**
 * Mensajería BYO: cada negocio usa SUS credenciales. AstroCitas no hace de intermediario.
 * Todas las llamadas salen directamente de tu servidor hacia el proveedor elegido.
 */
export const ProviderSchemas = {
  smtp: z.object({ host: z.string().min(1), port: z.number().int().default(587), secure: z.boolean().default(false), user: z.string().default(''), pass: z.string().default(''), from: z.string().min(3) }),
  resend: z.object({ apiKey: z.string().min(10), from: z.string().min(3) }),
  whatsapp: z.object({
    phoneNumberId: z.string().min(3),
    token: z.string().min(10),
    /** Plantilla aprobada por Meta para mensajes iniciados por el negocio (obligatoria fuera de la ventana de 24 h). */
    templateName: z.string().default(''),
    templateLang: z.string().default('es'),
    verifyToken: z.string().default(''),
  }),
  twilio: z.object({ accountSid: z.string().min(10), authToken: z.string().min(10), from: z.string().min(3) }),
} as const;
export type ProviderKind = keyof typeof ProviderSchemas;
export const PROVIDER_KINDS = Object.keys(ProviderSchemas) as ProviderKind[];
export const SECRET_FIELDS = new Set(['pass', 'apiKey', 'token', 'authToken', 'verifyToken']);

export interface OutgoingMessage {
  channel: MessageChannel;
  to: string;
  subject: string;
  text: string;
  /** Botones de respuesta (WhatsApp interactivo); en email/SMS van como enlaces en el texto. */
  buttons?: { id: string; title: string }[];
}

export interface SendResult {
  providerId: string;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    /** false = no reintentar (credenciales/destino inválidos). */
    readonly retryable = true,
  ) {
    super(message);
  }
}

type FetchLike = typeof fetch;

async function check(res: Response, provider: string) {
  if (res.ok) return res.json().catch(() => ({}));
  const text = await res.text().catch(() => '');
  throw new ProviderError(`${provider} ${res.status}: ${text.slice(0, 300)}`, res.status >= 500 || res.status === 429);
}

export async function sendVia(
  kind: ProviderKind,
  cfg: Record<string, unknown>,
  msg: OutgoingMessage,
  deps: { fetch?: FetchLike; smtp?: (cfg: z.infer<typeof ProviderSchemas.smtp>, m: OutgoingMessage) => Promise<string> } = {},
): Promise<SendResult> {
  const f = deps.fetch ?? fetch;
  switch (kind) {
    case 'smtp': {
      const c = ProviderSchemas.smtp.parse(cfg);
      if (deps.smtp) return { providerId: await deps.smtp(c, msg) };
      const nodemailer = await import('nodemailer');
      const t = nodemailer.default.createTransport({ host: c.host, port: c.port, secure: c.secure, auth: c.user ? { user: c.user, pass: c.pass } : undefined });
      try {
        const info = await t.sendMail({ from: c.from, to: msg.to, subject: msg.subject, text: msg.text });
        return { providerId: String(info.messageId ?? '') };
      } catch (e) {
        const code = (e as { responseCode?: number }).responseCode ?? 0;
        // 5xx = rechazo permanente (no reintentar); 4xx o error de red = temporal.
        throw new ProviderError(`SMTP: ${(e as Error).message}`, !(code >= 500 && code < 600));
      }
    }
    case 'resend': {
      const c = ProviderSchemas.resend.parse(cfg);
      const r = await check(
        await f('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${c.apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: c.from, to: [msg.to], subject: msg.subject, text: msg.text }),
        }),
        'Resend',
      );
      return { providerId: String((r as { id?: string }).id ?? '') };
    }
    case 'whatsapp': {
      const c = ProviderSchemas.whatsapp.parse(cfg);
      const to = normalizePhone(msg.to);
      const payload = c.templateName
        ? {
            messaging_product: 'whatsapp',
            to,
            type: 'template',
            template: { name: c.templateName, language: { code: c.templateLang }, components: [{ type: 'body', parameters: [{ type: 'text', text: msg.text.slice(0, 1000) }] }] },
          }
        : msg.buttons?.length
          ? {
              messaging_product: 'whatsapp',
              to,
              type: 'interactive',
              interactive: { type: 'button', body: { text: msg.text.slice(0, 1024) }, action: { buttons: msg.buttons.slice(0, 3).map((b) => ({ type: 'reply', reply: { id: b.id.slice(0, 256), title: b.title.slice(0, 20) } })) } },
            }
          : { messaging_product: 'whatsapp', to, type: 'text', text: { body: msg.text.slice(0, 4096) } };
      const r = await check(
        await f(`https://graph.facebook.com/v21.0/${encodeURIComponent(c.phoneNumberId)}/messages`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }),
        'WhatsApp',
      );
      return { providerId: String((r as { messages?: { id: string }[] }).messages?.[0]?.id ?? '') };
    }
    case 'twilio': {
      const c = ProviderSchemas.twilio.parse(cfg);
      const form = new URLSearchParams({ To: `+${normalizePhone(msg.to)}`, From: c.from, Body: msg.text });
      const r = await check(
        await f(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(c.accountSid)}/Messages.json`, {
          method: 'POST',
          headers: { Authorization: `Basic ${Buffer.from(`${c.accountSid}:${c.authToken}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: form,
        }),
        'Twilio',
      );
      return { providerId: String((r as { sid?: string }).sid ?? '') };
    }
  }
}

/** Qué proveedor usar para cada canal (el primero configurado y activo). */
export function providerForChannel(channel: MessageChannel, enabled: Set<ProviderKind>): ProviderKind | null {
  const order: Record<MessageChannel, ProviderKind[]> = { email: ['smtp', 'resend'], whatsapp: ['whatsapp'], sms: ['twilio'] };
  return order[channel].find((k) => enabled.has(k)) ?? null;
}

export function redact(cfg: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(cfg).map(([k, v]) => [k, SECRET_FIELDS.has(k) && v ? '••••••••' : v]));
}
