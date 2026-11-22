//! Copias automáticas en la carpeta de datos de la app (se conservan las 10 últimas).
use serde::Serialize;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Serialize)]
pub struct BackupEntry {
    name: String,
    size: u64,
    date: u64,
}

fn dir(app: &AppHandle) -> Result<PathBuf, String> {
    let d = app.path().app_data_dir().map_err(|e| e.to_string())?.join("backups");
    std::fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    Ok(d)
}

fn safe(name: &str) -> Result<&str, String> {
    if name.contains(['/', '\\']) || name.starts_with('.') {
        return Err("Nombre de copia no válido".into());
    }
    Ok(name)
}

#[tauri::command]
pub fn backup_list(app: AppHandle) -> Result<Vec<BackupEntry>, String> {
    let mut out: Vec<BackupEntry> = std::fs::read_dir(dir(&app)?)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let m = e.metadata().ok()?;
            let date = m.modified().ok()?.duration_since(std::time::UNIX_EPOCH).ok()?.as_millis() as u64;
            Some(BackupEntry { name: e.file_name().to_string_lossy().into_owned(), size: m.len(), date })
        })
        .collect();
    out.sort_by(|a, b| b.date.cmp(&a.date));
    Ok(out)
}

#[tauri::command]
pub fn backup_save(app: AppHandle, name: String, content: String) -> Result<(), String> {
    std::fs::write(dir(&app)?.join(safe(&name)?), content).map_err(|e| e.to_string())?;
    for old in backup_list(app.clone())?.into_iter().skip(10) {
        let _ = std::fs::remove_file(dir(&app)?.join(old.name));
    }
    Ok(())
}

#[tauri::command]
pub fn backup_read(app: AppHandle, name: String) -> Result<String, String> {
    std::fs::read_to_string(dir(&app)?.join(safe(&name)?)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn backup_remove(app: AppHandle, name: String) -> Result<(), String> {
    std::fs::remove_file(dir(&app)?.join(safe(&name)?)).map_err(|e| e.to_string())
}
