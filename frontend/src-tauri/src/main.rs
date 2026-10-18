// Prevents additional console window on Windows in release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::net::TcpListener;
use std::sync::Mutex;

use tauri::Manager;
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

/// Backend sidecar listen port (must match `settings.API_PORT` / `.env` `API_PORT`).
const BACKEND_PORT: u16 = 8765;

/// Holds the spawned sidecar child so we can terminate it when the app exits.
struct SidecarState(Mutex<Option<CommandChild>>);

fn main() {
    // --- Microphone under WebView2 -------------------------------------------
    // Tauri has NO "microphone" capability: getUserMedia({audio}) is gated by
    // the WebView2 `PermissionRequested` event. The bundled `wry` (0.55.x) only
    // auto-approves CLIPBOARD_READ and leaves MICROPHONE at the default state,
    // which WebView2 denies silently (no browser UI in an app window).
    // `--use-fake-ui-for-media-stream` makes Chromium auto-grant the prompt while
    // still recording from the REAL microphone. It is additive to wry's default
    // browser args. See docs/specs/ielts/mic-on-windows.md.
    // Must be set before the WebView2 environment is created (first window).
    std::env::set_var(
        "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
        "--use-fake-ui-for-media-stream",
    );

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(SidecarState(Mutex::new(None)))
        .setup(|app| {
            // Guard against a stale sidecar still holding port 8765 (which would
            // also lock backend-*.exe so a rebuild can't overwrite it).
            match TcpListener::bind(("127.0.0.1", BACKEND_PORT)) {
                Ok(probe) => {
                    // Port is free — release it and let the sidecar bind it.
                    drop(probe);
                    let sidecar = match app.shell().sidecar("backend") {
                        Ok(c) => c,
                        Err(e) => {
                            eprintln!("[IELTS] 无法创建后端 sidecar 命令: {e}");
                            return Ok(());
                        }
                    };
                    match sidecar.spawn() {
                        Ok((_rx, child)) => {
                            *app.state::<SidecarState>().0.lock().unwrap() = Some(child);
                            println!("[IELTS] 后端 sidecar 已启动，监听 127.0.0.1:{BACKEND_PORT}");
                        }
                        Err(e) => {
                            eprintln!("[IELTS] 启动后端 sidecar 失败: {e}");
                        }
                    }
                }
                Err(e) => {
                    // Something already serves 8765 (most likely a previous instance
                    // of this app that is still running). Do NOT spawn a duplicate and
                    // do NOT kill an unknown process. The frontend's useBackendReady()
                    // will simply connect to the already-running engine.
                    eprintln!(
                        "[IELTS] 端口 {BACKEND_PORT} 已被占用（{e}）。可能是上一次未退出的 IELTS Insight 实例，已跳过重复启动；如需干净重启，请先关闭旧的 IELTS Insight 窗口。"
                    );
                }
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building IELTS Insight tauri application");

    app.run(|app_handle, event| {
        if let tauri::RunEvent::Exit = event {
            if let Some(state) = app_handle.try_state::<SidecarState>() {
                if let Some(child) = state.0.lock().unwrap().take() {
                    match child.kill() {
                        Ok(_) => println!("[IELTS] 后端 sidecar 已终止"),
                        Err(e) => eprintln!("[IELTS] 终止后端 sidecar 失败: {e}"),
                    }
                }
            }
        }
    });
}
