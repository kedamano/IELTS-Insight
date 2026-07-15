// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri_plugin_shell::ShellExt;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // Launch backend sidecar
            let sidecar_command = app.shell().sidecar("backend").expect("Failed to create sidecar command");

            match sidecar_command.spawn() {
                Ok((_rx, _child)) => {
                    println!("[Tauri] Backend sidecar launched successfully");
                }
                Err(e) => {
                    eprintln!("[Tauri] Failed to launch backend sidecar: {}", e);
                }
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
