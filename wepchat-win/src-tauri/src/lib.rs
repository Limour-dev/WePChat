mod claude_agent;
mod db;
mod external_agent;
mod external_open;
mod external_project;
mod external_terminal;
mod http_client;
mod preview_server;
mod sessions;
mod settings;
mod workspace_fs;

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
use preview_server::{preview_ensure, preview_stage, preview_stop, preview_unstage};
use serde_json::Value;
use settings::{AppSettings, SettingsStore};
use tauri::Manager;
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
        .plugin(tauri_plugin_opener::init())
        .manage(http_client::new_abort_registry() as AbortRegistry)
        .manage(CodexAppServer::default())
        .manage(ClaudeAgent::default())
        .manage(PowerShellTerminal::default())
        .setup(|app| {
            let handle = app.handle().clone();
            if let Ok(settings) = SettingsStore::load(&handle) {
                if let Ok(root) = SettingsStore::resolve_workspace_root(&handle, &settings) {
                    let _ = std::fs::create_dir_all(&root);
                }
            }
            if let Ok(data) = handle.path().app_data_dir() {
                let _ = std::fs::create_dir_all(&data);
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                window.state::<CodexAppServer>().shutdown();
                window.state::<ClaudeAgent>().shutdown_all();
                window.state::<PowerShellTerminal>().shutdown();
                let _ = db::checkpoint_truncate();
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
            powershell_terminal_open,
            powershell_terminal_write,
            powershell_terminal_resize,
            powershell_terminal_close,
            external_project_list,
            external_project_read,
            external_project_open_targets,
            external_project_open,
        ])
        .run(tauri::generate_context!())
        .expect("error while running WePChat");
}
