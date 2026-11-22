//! Envío de email con el SMTP del propio usuario (sin intermediarios).
use lettre::{
    message::header::ContentType, transport::smtp::authentication::Credentials, AsyncSmtpTransport, AsyncTransport, Message,
    Tokio1Executor,
};
use serde::Deserialize;

#[derive(Deserialize)]
pub struct SmtpConfig {
    host: String,
    port: u16,
    secure: bool,
    user: String,
    pass: String,
    from: String,
}

#[derive(Deserialize)]
pub struct EmailMessage {
    to: String,
    subject: String,
    text: String,
}

#[tauri::command]
pub async fn send_email(cfg: SmtpConfig, msg: EmailMessage) -> Result<(), String> {
    let from = if cfg.from.is_empty() { cfg.user.clone() } else { cfg.from.clone() };
    let email = Message::builder()
        .from(from.parse().map_err(|e| format!("Remitente no válido: {e}"))?)
        .to(msg.to.parse().map_err(|e| format!("Destinatario no válido: {e}"))?)
        .subject(msg.subject)
        .header(ContentType::TEXT_PLAIN)
        .body(msg.text)
        .map_err(|e| e.to_string())?;
    let builder = if cfg.secure {
        AsyncSmtpTransport::<Tokio1Executor>::relay(&cfg.host)
    } else {
        AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(&cfg.host)
    }
    .map_err(|e| e.to_string())?
    .port(cfg.port);
    let transport = if cfg.user.is_empty() { builder } else { builder.credentials(Credentials::new(cfg.user, cfg.pass)) }.build();
    transport.send(email).await.map(|_| ()).map_err(|e| e.to_string())
}
