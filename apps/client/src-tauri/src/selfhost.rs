//! «Servidor en este equipo»: instala y gestiona el servidor AstroCitas con Docker desde la app de
//! escritorio, sin terminal. Un solo contenedor (`astrocitas`) con los datos en el volumen
//! `astrocitas-data`; se publica por http en la IP local para que el móvil y el iPhone lo usen en la red.

use serde::{Deserialize, Serialize};
use std::{
    net::{TcpListener, UdpSocket},
    path::PathBuf,
    process::{Command, Output},
};
use tauri::{AppHandle, Manager};

const CONTAINER: &str = "astrocitas";
const VOLUME: &str = "astrocitas-data";
const IMAGE: &str = "ghcr.io/astrosoftwaremoon/astrocitas-server";

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    pub port: u16,
    pub secret: String,
    pub ip: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    /// Docker instalado (existe el comando).
    docker: bool,
    /// El motor de Docker está en marcha.
    docker_running: bool,
    installed: bool,
    running: bool,
    url: Option<String>,
    /// IP local actual (puede haber cambiado desde la instalación).
    ip: Option<String>,
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join("selfhost.json"))
}

fn load(app: &AppHandle) -> Option<Config> {
    serde_json::from_str(&std::fs::read_to_string(config_path(app).ok()?).ok()?).ok()
}

fn save(app: &AppHandle, c: &Config) -> Result<(), String> {
    let p = config_path(app)?;
    std::fs::create_dir_all(p.parent().unwrap()).map_err(|e| e.to_string())?;
    std::fs::write(p, serde_json::to_string_pretty(c).unwrap()).map_err(|e| e.to_string())
}

/// Las apps de escritorio en macOS no heredan el PATH de la terminal: se prueban rutas habituales.
fn docker_bin() -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = vec!["docker".into()];
    if cfg!(target_os = "macos") {
        candidates.extend(["/usr/local/bin/docker", "/opt/homebrew/bin/docker", "/Applications/Docker.app/Contents/Resources/bin/docker"].map(PathBuf::from));
    }
    if cfg!(target_os = "windows") {
        candidates.push(r"C:\Program Files\Docker\Docker\resources\bin\docker.exe".into());
    }
    candidates.into_iter().find(|c| cmd(c).arg("--version").output().map(|o| o.status.success()).unwrap_or(false))
}

fn cmd(bin: &PathBuf) -> Command {
    #[allow(unused_mut)]
    let mut c = Command::new(bin);
    #[cfg(target_os = "windows")]
    {
        // Sin ventanas de consola parpadeando.
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000);
    }
    c
}

fn run(bin: &PathBuf, args: &[&str]) -> Result<Output, String> {
    cmd(bin).args(args).output().map_err(|e| e.to_string())
}

fn ok(o: Output) -> Result<String, String> {
    if o.status.success() {
        Ok(String::from_utf8_lossy(&o.stdout).trim().to_string())
    } else {
        Err(String::from_utf8_lossy(&o.stderr).trim().to_string())
    }
}

/// IP de la interfaz por la que se sale a internet (no envía nada: UDP sin datos).
fn local_ip() -> Option<String> {
    let s = UdpSocket::bind("0.0.0.0:0").ok()?;
    s.connect("1.1.1.1:80").ok()?;
    let ip = s.local_addr().ok()?.ip();
    (!ip.is_loopback()).then(|| ip.to_string())
}

fn free_port() -> u16 {
    (8080..8100).find(|p| TcpListener::bind(("0.0.0.0", *p)).is_ok()).unwrap_or(8080)
}

fn url_of(c: &Config) -> String {
    format!("http://{}:{}", c.ip, c.port)
}

#[tauri::command(async)]
pub fn selfhost_status(app: AppHandle) -> Status {
    let ip = local_ip();
    let Some(bin) = docker_bin() else {
        return Status { docker: false, docker_running: false, installed: false, running: false, url: None, ip };
    };
    let docker_running = run(&bin, &["info", "--format", "{{.ServerVersion}}"]).map(|o| o.status.success()).unwrap_or(false);
    let state = run(&bin, &["inspect", "-f", "{{.State.Running}}", CONTAINER]).ok().filter(|o| o.status.success());
    let installed = state.is_some();
    let running = state.map(|o| String::from_utf8_lossy(&o.stdout).trim() == "true").unwrap_or(false);
    let url = load(&app).filter(|_| installed).map(|c| url_of(&c));
    Status { docker: true, docker_running, installed, running, url, ip }
}

/// Descarga la imagen y (re)crea el contenedor. Los datos del volumen se conservan.
/// `secret` lo genera la app (aleatorio); si ya había una instalación se reutiliza el anterior.
#[tauri::command(async)]
pub fn selfhost_install(app: AppHandle, version: String, secret: String) -> Result<String, String> {
    let bin = docker_bin().ok_or("Docker no está instalado")?;
    let prev = load(&app);
    let ip = local_ip().unwrap_or_else(|| "localhost".into());
    // Si ya existía, liberar su puerto antes de buscar uno libre.
    let _ = run(&bin, &["rm", "-f", CONTAINER]);
    let port = prev.as_ref().map(|c| c.port).filter(|p| TcpListener::bind(("0.0.0.0", *p)).is_ok()).unwrap_or_else(free_port);
    let cfg = Config { port, secret: prev.map(|c| c.secret).unwrap_or(secret), ip };
    if cfg.secret.len() < 32 {
        return Err("Secreto no válido".into());
    }

    let versioned = format!("{IMAGE}:{version}");
    let image = if ok(run(&bin, &["pull", &versioned])?).is_ok() {
        versioned
    } else {
        let latest = format!("{IMAGE}:latest");
        ok(run(&bin, &["pull", &latest])?).map_err(|e| format!("No se pudo descargar el servidor: {e}"))?;
        latest
    };
    let url = url_of(&cfg);
    ok(run(
        &bin,
        &[
            "run", "-d", "--name", CONTAINER, "--restart", "unless-stopped",
            "-p", &format!("{port}:8080"),
            "-v", &format!("{VOLUME}:/data"),
            "-e", &format!("ASTRO_SECRET={}", cfg.secret),
            "-e", &format!("PUBLIC_URL={url}"),
            "-e", "CORS_ORIGINS=*",
            &image,
        ],
    )?)
    .map_err(|e| format!("No se pudo arrancar el servidor: {e}"))?;
    save(&app, &cfg)?;
    Ok(url)
}

#[tauri::command(async)]
pub fn selfhost_start() -> Result<(), String> {
    let bin = docker_bin().ok_or("Docker no está instalado")?;
    ok(run(&bin, &["start", CONTAINER])?).map(|_| ())
}

#[tauri::command(async)]
pub fn selfhost_stop() -> Result<(), String> {
    let bin = docker_bin().ok_or("Docker no está instalado")?;
    ok(run(&bin, &["stop", CONTAINER])?).map(|_| ())
}
