// Prevents additional console window on Windows in release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::net::TcpListener;
use std::sync::Mutex;

use tauri::Manager;
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

mod shelllog;

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
                            let text = format!("无法创建后端 sidecar 命令: {e}");
                            shelllog::warn("Shell", &text); // 契约 §15.4 第 6 条：release 没有控制台
                            eprintln!("[IELTS] {text}");
                            return Ok(());
                        }
                    };
                    match sidecar.spawn() {
                        Ok((_rx, child)) => {
                            *app.state::<SidecarState>().0.lock().unwrap() = Some(child);
                            shelllog::info(
                                "Shell",
                                &format!(
                                    "引擎由本次启动拉起，监听 127.0.0.1:{BACKEND_PORT}；\
                                     它是谁、什么时候起来的，看同一文件里 [Startup] 与 [RunFile] 的行"
                                ),
                            );
                        }
                        Err(e) => {
                            let text = format!("启动后端 sidecar 失败: {e}");
                            shelllog::warn("Shell", &text);
                            eprintln!("[IELTS] {text}");
                        }
                    }
                }
                Err(e) => {
                    // Something already serves 8765 (most likely a previous instance
                    // of this app that is still running). Do NOT spawn a duplicate and
                    // do NOT kill an unknown process. The frontend's useBackendReady()
                    // will simply connect to the already-running engine.
                    // 契约 §15.4 第 5 条：结束别人的进程风险太高，这里只负责说清楚。
                    let text = format!(
                        "端口 {BACKEND_PORT} 已被占用（{e}）：本次没有启动引擎，界面会连到上一个还在跑的 \
                         IELTS Insight 引擎 —— 它多半是没有正常退出的旧窗口（任务管理器里那个没有界面的 \
                         backend 进程）。想彻底重启请关闭全部 IELTS Insight 窗口再打开；若没有可见窗口，\
                         说明是上一次退出遗留的引擎。"
                    );
                    shelllog::warn("Shell", &text);
                    eprintln!("[IELTS] {text}");
                }
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building IELTS Insight tauri application");

    app.run(|app_handle, event| {
        if let tauri::RunEvent::Exit = event {
            if let Some(state) = app_handle.try_state::<SidecarState>() {
                match state.0.lock().unwrap().take() {
                    Some(child) => match child.kill() {
                        Ok(_) => shelllog::info("Shell", "退出：已终止本次由自己启动的引擎进程"),
                        Err(e) => shelllog::warn("Shell", &format!("退出：终止引擎进程失败: {e}")),
                    },
                    // 这一行才是「让位给了别人」的证据：本次没 spawn，所以没有可终止的进程。
                    None => shelllog::info("Shell", "退出：本次启动没有自己拉起引擎进程（未 spawn）"),
                }
            }
        }
    });
}
