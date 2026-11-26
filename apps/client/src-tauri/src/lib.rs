mod backups;
mod db;
mod mail;
mod selfhost;

use std::sync::Mutex;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        // Una sola instancia: si se abre de nuevo, se muestra la ventana existente.
        builder = builder
            .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }))
            .plugin(tauri_plugin_updater::Builder::new().build());
    }

    builder
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            app.manage(db::Db { path: Mutex::new(dir.join("astrocitas.db")), dir, conn: Mutex::new(None) });
            #[cfg(desktop)]
            tray::setup(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            db::db_open,
            db::db_exec,
            db::db_run,
            db::db_all,
            db::db_is_encrypted,
            db::db_rekey,
            mail::send_email,
            backups::backup_list,
            backups::backup_save,
            backups::backup_read,
            backups::backup_remove,
            selfhost::selfhost_status,
            selfhost::selfhost_install,
            selfhost::selfhost_start,
            selfhost::selfhost_stop,
        ])
        .on_window_event(|window, event| {
            // Escritorio: cerrar la ventana la manda a la bandeja; los recordatorios siguen funcionando.
            #[cfg(desktop)]
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
            #[cfg(not(desktop))]
            let _ = (window, event);
        })
        .run(tauri::generate_context!())
        .expect("error al iniciar AstroCitas");
}

#[cfg(desktop)]
mod tray {
    use tauri::{
        menu::{Menu, MenuItem},
        tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
        App, Manager,
    };

    pub fn setup(app: &mut App) -> tauri::Result<()> {
        let show = MenuItem::with_id(app, "show", "Abrir AstroCitas", true, None::<&str>)?;
        let quit = MenuItem::with_id(app, "quit", "Salir", true, None::<&str>)?;
        let menu = Menu::with_items(app, &[&show, &quit])?;
        TrayIconBuilder::with_id("main")
            .icon(app.default_window_icon().unwrap().clone())
            .tooltip("AstroCitas")
            .menu(&menu)
            .show_menu_on_left_click(false)
            .on_menu_event(|app, e| match e.id.as_ref() {
                "show" => {
                    if let Some(w) = app.get_webview_window("main") {
                        let _ = w.show();
                        let _ = w.set_focus();
                    }
                }
                "quit" => app.exit(0),
                _ => {}
            })
            .on_tray_icon_event(|tray, e| {
                if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
                    if let Some(w) = tray.app_handle().get_webview_window("main") {
                        let _ = w.show();
                        let _ = w.set_focus();
                    }
                }
            })
            .build(app)?;
        Ok(())
    }
}
