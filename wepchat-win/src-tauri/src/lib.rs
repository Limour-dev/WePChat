mod app_control;
mod claude_agent;
mod db;
mod external_agent;
mod external_open;
mod external_project;
mod external_terminal;
mod http_client;
mod pi_agent;
mod preview_server;
mod sessions;
mod settings;
mod updater;
mod workspace_fs;

use app_control::{
    app_hide_to_tray, app_quit, open_path_in_explorer, pick_file_path, pick_folder_path,
    sync_app_behavior, TrayState,
};
use claude_agent::{
    claude_control, claude_respond, claude_send, claude_start, claude_status, claude_stop,
    claude_stop_all, ClaudeAgent,
};
use external_agent::{
    codex_disconnect, codex_request, codex_respond, codex_status, external_agent_detect,
    external_agent_detect_all, external_agent_supported, CodexAppServer,
};
use external_project::{external_project_list, external_project_read};
use external_open::{external_project_open, external_project_open_targets};
use external_terminal::{
    powershell_terminal_close, powershell_terminal_open, powershell_terminal_resize,
    powershell_terminal_write,
    PowerShellTerminal,
};
use http_client::{http_request, http_stream, http_stream_abort, AbortRegistry};
use pi_agent::{pi_request, pi_start, pi_status, pi_stop, pi_stop_all, pi_ui_respond, PiAgent};
use preview_server::{preview_ensure, preview_stage, preview_stop, preview_unstage};
use serde_json::Value;
use settings::{AppSettings, SettingsStore};
use tauri::{Emitter, Manager};
use tauri_plugin_autostart::MacosLauncher;
use updater::{
    update_check, update_download, update_download_abort, update_install, UpdateAbort,
};
use workspace_fs::{
    ws_delete, ws_edit, ws_exists, ws_list, ws_mkdir, ws_move, ws_open_workspace, ws_read,
    ws_read_bytes, ws_reveal_path, ws_stat_tree, ws_write,
};

#[tauri::command]
fn get_app_meta() -> serde_json::Value {
    serde_json::json!({
        "name": "WePChat",
        "version": env!("CARGO_PKG_VERSION"),
        "platform": "windows",
    })
}

#[tauri::command]
fn get_default_workspace_root(app: tauri::AppHandle) -> Result<String, String> {
    SettingsStore::default_workspace_root(&app)
}

#[tauri::command]
fn get_settings(app: tauri::AppHandle) -> Result<AppSettings, String> {
    SettingsStore::load(&app)
}

#[tauri::command]
fn save_settings(app: tauri::AppHandle, settings: AppSettings) -> Result<AppSettings, String> {
    SettingsStore::save(&app, &settings)?;
    Ok(settings)
}

#[tauri::command]
fn resolve_workspace_root(app: tauri::AppHandle) -> Result<String, String> {
    let s = SettingsStore::load(&app)?;
    Ok(SettingsStore::resolve_workspace_root(&app, &s)?)
}

#[tauri::command]
fn get_workspace_info(app: tauri::AppHandle) -> Result<Value, String> {
    sessions::get_workspace_info(app)
}

#[tauri::command]
fn list_sessions(app: tauri::AppHandle) -> Result<Vec<Value>, String> {
    sessions::list_sessions(app)
}

#[tauri::command]
fn load_session(app: tauri::AppHandle, id: String) -> Result<Value, String> {
    sessions::load_session(app, id)
}

#[tauri::command]
fn save_session(app: tauri::AppHandle, session: Value) -> Result<Value, String> {
    sessions::save_session(app, session)
}

#[tauri::command]
fn session_upsert_message(
    app: tauri::AppHandle,
    args: sessions::UpsertMessageArgs,
) -> Result<(), String> {
    sessions::upsert_message(app, args)
}

#[tauri::command]
fn session_messages_page(
    app: tauri::AppHandle,
    args: sessions::MessagesPageArgs,
) -> Result<Value, String> {
    sessions::messages_page(app, args)
}

#[tauri::command]
fn delete_session(app: tauri::AppHandle, id: String) -> Result<(), String> {
    sessions::delete_session(app, id)
}

#[tauri::command]
fn copy_session(app: tauri::AppHandle, id: String) -> Result<Value, String> {
    sessions::copy_session(app, id)
}

#[tauri::command]
fn get_session_workspace(app: tauri::AppHandle, id: String) -> Result<String, String> {
    sessions::get_session_workspace(app, id)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // 单实例最先注册：二次启动只聚焦既有窗口（含托盘隐藏态）
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            app_control::show_main_window(app);
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--from-autostart"]),
        ))
        .manage(http_client::new_abort_registry() as AbortRegistry)
        .manage(CodexAppServer::default())
        .manage(ClaudeAgent::default())
        .manage(PiAgent::default())
        .manage(PowerShellTerminal::default())
        .manage(TrayState::default())
        .manage(UpdateAbort::default())
        .setup(|app| {
            let handle = app.handle().clone();
            if let Ok(settings) = SettingsStore::load(&handle) {
                if let Ok(root) = SettingsStore::resolve_workspace_root(&handle, &settings) {
                    let _ = std::fs::create_dir_all(&root);
                }
                // 托盘 / 开机自启与设置对齐；失败不阻塞启动
                let _ = app_control::apply_behavior(&handle, &settings);
                // 自启动进托盘：仅 --from-autostart 且开了「启动时最小化到托盘」
                let from_autostart = std::env::args().any(|arg| arg == "--from-autostart");
                let tray_wanted = settings.tray_enabled || settings.close_behavior == "tray";
                if from_autostart && settings.start_minimized && tray_wanted {
                    if let Some(window) = handle.get_webview_window("main") {
                        let _ = window.hide();
                    }
                }
            }
            if let Ok(data) = handle.path().app_data_dir() {
                let _ = std::fs::create_dir_all(&data);
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let app = window.app_handle();
                let behavior = SettingsStore::load(app)
                    .map(|s| s.close_behavior)
                    .unwrap_or_else(|_| "ask".into());
                match behavior.as_str() {
                    // 放行关闭：清理统一在 RunEvent::Exit
                    "exit" => {}
                    "minimize" => {
                        api.prevent_close();
                        let _ = window.minimize();
                    }
                    "tray" => {
                        api.prevent_close();
                        if app_control::ensure_tray(app).is_ok() {
                            let _ = window.hide();
                        } else {
                            // 托盘异常时兜底最小化，避免窗口关不掉也藏不住
                            let _ = window.minimize();
                        }
                    }
                    // ask（默认）：前端弹选择框，记住后写回 close_behavior
                    _ => {
                        api.prevent_close();
                        let _ = window.emit("app://close-requested", serde_json::json!({}));
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_app_meta,
            get_default_workspace_root,
            get_settings,
            save_settings,
            resolve_workspace_root,
            get_workspace_info,
            list_sessions,
            load_session,
            save_session,
            session_upsert_message,
            session_messages_page,
            delete_session,
            copy_session,
            get_session_workspace,
            http_request,
            http_stream,
            http_stream_abort,
            ws_list,
            ws_read,
            ws_read_bytes,
            ws_write,
            ws_edit,
            ws_delete,
            ws_mkdir,
            ws_move,
            ws_exists,
            ws_stat_tree,
            ws_open_workspace,
            ws_reveal_path,
            preview_ensure,
            preview_stage,
            preview_unstage,
            preview_stop,
            external_agent_supported,
            external_agent_detect,
            external_agent_detect_all,
            codex_request,
            codex_respond,
            codex_status,
            codex_disconnect,
            claude_start,
            claude_send,
            claude_control,
            claude_respond,
            claude_stop,
            claude_stop_all,
            claude_status,
            pi_start,
            pi_request,
            pi_ui_respond,
            pi_stop,
            pi_stop_all,
            pi_status,
            powershell_terminal_open,
            powershell_terminal_write,
            powershell_terminal_resize,
            powershell_terminal_close,
            external_project_list,
            external_project_read,
            external_project_open_targets,
            external_project_open,
            sync_app_behavior,
            app_hide_to_tray,
            app_quit,
            pick_folder_path,
            pick_file_path,
            open_path_in_explorer,
            update_check,
            update_download,
            update_download_abort,
            update_install,
        ])
        .build(tauri::generate_context!())
        .expect("error while building WePChat")
        .run(|app, event| {
            // 真正退出才清理：托盘驻留期间外部 agent 会话与终端保持存活
            if let tauri::RunEvent::Exit = event {
                app.state::<CodexAppServer>().shutdown();
                app.state::<ClaudeAgent>().shutdown_all();
                app.state::<PiAgent>().shutdown_all();
                app.state::<PowerShellTerminal>().shutdown();
                let _ = db::checkpoint_truncate();
            }
        });
}
