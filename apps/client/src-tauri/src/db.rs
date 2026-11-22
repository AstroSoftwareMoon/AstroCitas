//! Driver SQLite nativo para `SqlAdapter` (packages/core). SQLCipher permite cifrar el archivo
//! con la contraseña opcional del usuario; sin contraseña es un SQLite normal.

use rusqlite::{types::Value, Connection};
use serde_json::{Map, Value as Json};
use std::{path::PathBuf, sync::Mutex};

pub struct Db {
    pub path: PathBuf,
    pub conn: Mutex<Option<Connection>>,
}

fn to_sql(v: &Json) -> Value {
    match v {
        Json::Null => Value::Null,
        Json::Bool(b) => Value::Integer(*b as i64),
        Json::Number(n) => n.as_i64().map(Value::Integer).unwrap_or_else(|| Value::Real(n.as_f64().unwrap_or(0.0))),
        Json::String(s) => Value::Text(s.clone()),
        other => Value::Text(other.to_string()),
    }
}

fn from_sql(v: rusqlite::types::ValueRef) -> Json {
    use rusqlite::types::ValueRef::*;
    match v {
        Null => Json::Null,
        Integer(i) => Json::from(i),
        Real(f) => Json::from(f),
        Text(t) => Json::String(String::from_utf8_lossy(t).into_owned()),
        Blob(b) => Json::Array(b.iter().map(|x| Json::from(*x)).collect()),
    }
}

fn quote(key: &str) -> String {
    format!("'{}'", key.replace('\'', "''"))
}

impl Db {
    pub fn open(&self, key: Option<String>) -> Result<(), String> {
        if let Some(dir) = self.path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        let conn = Connection::open(&self.path).map_err(|e| e.to_string())?;
        if let Some(k) = key.as_deref().filter(|k| !k.is_empty()) {
            conn.execute_batch(&format!("PRAGMA key = {};", quote(k))).map_err(|e| e.to_string())?;
        }
        // Si el archivo está cifrado y no hay clave (o es incorrecta), esto falla con "file is not a database".
        if conn.query_row("SELECT count(*) FROM sqlite_master", [], |r| r.get::<_, i64>(0)).is_err() {
            return Err("ASTRO_LOCKED".into());
        }
        // WAL descartado a propósito: el reemplazo de archivo al cifrar/descifrar es más simple con DELETE.
        conn.execute_batch("PRAGMA journal_mode = DELETE; PRAGMA foreign_keys = ON;").map_err(|e| e.to_string())?;
        *self.conn.lock().unwrap() = Some(conn);
        Ok(())
    }

    pub fn with<T>(&self, f: impl FnOnce(&Connection) -> Result<T, String>) -> Result<T, String> {
        let guard = self.conn.lock().unwrap();
        let conn = guard.as_ref().ok_or("La base de datos no está abierta")?;
        f(conn)
    }
}

#[tauri::command]
pub fn db_open(db: tauri::State<Db>, key: Option<String>) -> Result<(), String> {
    db.open(key)
}

#[tauri::command]
pub fn db_exec(db: tauri::State<Db>, sql: String) -> Result<(), String> {
    db.with(|c| c.execute_batch(&sql).map_err(|e| e.to_string()))
}

#[tauri::command]
pub fn db_run(db: tauri::State<Db>, sql: String, params: Vec<Json>) -> Result<Json, String> {
    db.with(|c| {
        let values: Vec<Value> = params.iter().map(to_sql).collect();
        let changes = c.execute(&sql, rusqlite::params_from_iter(values)).map_err(|e| e.to_string())?;
        Ok(serde_json::json!({ "changes": changes }))
    })
}

#[tauri::command]
pub fn db_all(db: tauri::State<Db>, sql: String, params: Vec<Json>) -> Result<Vec<Map<String, Json>>, String> {
    db.with(|c| {
        let values: Vec<Value> = params.iter().map(to_sql).collect();
        let mut stmt = c.prepare(&sql).map_err(|e| e.to_string())?;
        let names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
        let mut rows = stmt.query(rusqlite::params_from_iter(values)).map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        while let Some(row) = rows.next().map_err(|e| e.to_string())? {
            let mut m = Map::new();
            for (i, n) in names.iter().enumerate() {
                m.insert(n.clone(), from_sql(row.get_ref(i).map_err(|e| e.to_string())?));
            }
            out.push(m);
        }
        Ok(out)
    })
}

#[tauri::command]
pub fn db_is_encrypted(db: tauri::State<Db>) -> Result<bool, String> {
    // Un SQLite sin cifrar empieza por la cabecera "SQLite format 3".
    let head = std::fs::read(&db.path).map(|b| b.get(..15).map(|h| h.to_vec())).map_err(|e| e.to_string())?;
    Ok(head.as_deref() != Some(b"SQLite format 3"))
}

fn file_is_plain(path: &std::path::Path) -> bool {
    std::fs::read(path).map(|b| b.starts_with(b"SQLite format 3")).unwrap_or(true)
}

/// Establece, cambia o quita (None) la contraseña de la base de datos.
/// - claro → cifrado y cifrado → claro: `sqlcipher_export` a un archivo nuevo y se reemplaza.
/// - cifrado → otra clave: `PRAGMA rekey`.
#[tauri::command]
pub fn db_rekey(db: tauri::State<Db>, new_key: Option<String>) -> Result<(), String> {
    let new_key = new_key.filter(|k| !k.is_empty());
    let plain = file_is_plain(&db.path);
    if !plain {
        if let Some(k) = &new_key {
            return db.with(|c| c.execute_batch(&format!("PRAGMA rekey = {};", quote(k))).map_err(|e| e.to_string()));
        }
    } else if new_key.is_none() {
        return Ok(());
    }
    let tmp = db.path.with_extension("db.rekey");
    let _ = std::fs::remove_file(&tmp);
    db.with(|c| {
        c.execute_batch(&format!(
            "ATTACH DATABASE {} AS target KEY {}; SELECT sqlcipher_export('target'); DETACH DATABASE target;",
            quote(&tmp.to_string_lossy()),
            quote(new_key.as_deref().unwrap_or(""))
        ))
        .map_err(|e| e.to_string())
    })?;
    // Cerrar, reemplazar el archivo (y los WAL) y reabrir con la nueva clave.
    *db.conn.lock().unwrap() = None;
    for ext in ["db-wal", "db-shm"] {
        let _ = std::fs::remove_file(db.path.with_extension(ext));
    }
    std::fs::rename(&tmp, &db.path).map_err(|e| e.to_string())?;
    db.open(new_key)
}
