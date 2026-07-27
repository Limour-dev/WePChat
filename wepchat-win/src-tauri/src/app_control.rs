//! 常规行为：系统托盘、开机自启、系统文件/目录选择器与资源管理器打开。
//! 方案与边界见 docs/settings-revamp.md 阶段 B。

use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_autostart::ManagerExt as _;
use tauri_plugin_dialog::DialogExt;

use crate::settings::{AppSettings, SettingsStore};

const TRAY_ID: &str = "wepchat-tray";

/// 托盘是否已创建（图标本体登记在 tauri 资源表里，这里只记状态）。
#[derive(Default)]
pub struct TrayState(Mutex<bool>);

pub fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn build_tray(app: &AppHandle) -> Result<(), String> {
    let show = MenuItem::with_id(app, "tray-show", "显示 WePChat", true, None::<&str>)
        .map_err(|e| e.to_string())?;
    let new_chat = MenuItem::with_id(app, "tray-new-chat", "新建聊天", true, None::<&str>)
        .map_err(|e| e.to_string())?;
    let separator = PredefinedMenuItem::separator(app).map_err(|e| e.to_string())?;
    let quit =
        MenuItem::with_id(app, "tray-quit", "退出", true, None::<&str>).map_err(|e| e.to_string())?;
    let menu =
        Menu::with_items(app, &[&show, &new_chat, &separator, &quit]).map_err(|e| e.to_string())?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip("WePChat")
        .on_menu_event(|app, event| match event.id().as_ref() {
            "tray-show" => show_main_window(app),
            "tray-new-chat" => {
                show_main_window(app);
                let _ = app.emit("tray://new-chat", json!({}));
            }
            // 真正退出：清理统一挂在 RunEvent::Exit（见 lib.rs）
            "tray-quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app).map_err(|e| e.to_string())?;
    Ok(())
}

/// 创建托盘（幂等）。Windows 托盘要求在主线程创建，命令线程调用时派发过去。
pub fn ensure_tray(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<TrayState>();
    let mut active = state.0.lock().map_err(|e| e.to_string())?;
    if *active {
        return Ok(());
    }
    let (tx, rx) = std::sync::mpsc::channel();
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let _ = tx.send(build_tray(&handle));
    })
    .map_err(|e| e.to_string())?;
    rx.recv_timeout(std::time::Duration::from_secs(5))
        .map_err(|error| format!("托盘创建超时：{error}"))??;
    *active = true;
    Ok(())
}

/// 移除托盘（幂等）。
pub fn destroy_tray(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<TrayState>();
    let mut active = state.0.lock().map_err(|e| e.to_string())?;
    if !*active {
        return Ok(());
    }
    *active = false;
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let _ = handle.remove_tray_by_id(TRAY_ID);
    })
    .map_err(|e| e.to_string())
}

/// 把托盘 / 开机自启的系统状态对齐到设置。失败作为 warnings 返回，不中断。
pub fn apply_behavior(app: &AppHandle, settings: &AppSettings) -> Result<Value, String> {
    let want_tray = settings.tray_enabled || settings.close_behavior == "tray";
    let mut warnings: Vec<String> = Vec::new();

    let tray_ok = if want_tray {
        ensure_tray(app)
    } else {
        destroy_tray(app)
    };
    if let Err(error) = tray_ok {
        warnings.push(format!("托盘：{error}"));
    }

    let autostart = app.autolaunch();
    let result = if settings.auto_start {
        autostart.enable().map_err(|e| e.to_string())
    } else if autostart.is_enabled().unwrap_or(false) {
        autostart.disable().map_err(|e| e.to_string())
    } else {
        Ok(())
    };
    if let Err(error) = result {
        warnings.push(format!("开机自启：{error}"));
    }

    Ok(json!({
        "trayActive": want_tray && warnings.iter().all(|w| !w.starts_with("托盘")),
        "autostartEnabled": autostart.is_enabled().unwrap_or(false),
        "warnings": warnings,
    }))
}

/// 前端在常规设置变更后调用：按最新设置对齐托盘与自启。
#[tauri::command]
pub fn sync_app_behavior(app: AppHandle) -> Result<Value, String> {
    let settings = SettingsStore::load(&app)?;
    apply_behavior(&app, &settings)
}

/// 关闭询问弹窗选「隐藏到托盘」：确保托盘存在后隐藏主窗口。
#[tauri::command]
pub fn app_hide_to_tray(app: AppHandle) -> Result<(), String> {
    ensure_tray(&app)?;
    if let Some(window) = app.get_webview_window("main") {
        window.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 真正退出（关闭询问弹窗 / 关于页等入口）。清理在 RunEvent::Exit。
#[tauri::command]
pub fn app_quit(app: AppHandle) {
    app.exit(0);
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDialogFilter {
    pub name: String,
    pub extensions: Vec<String>,
}

/// 系统目录选择器。blocking 变体不能在主线程跑，spawn_blocking 包一层。
#[tauri::command]
pub async fn pick_folder_path(
    app: AppHandle,
    title: Option<String>,
    default_path: Option<String>,
) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut dialog = app.dialog().file();
        if let Some(title) = title.as_deref().map(str::trim).filter(|t| !t.is_empty()) {
            dialog = dialog.set_title(title);
        }
        if let Some(dir) = default_path
            .as_deref()
            .map(str::trim)
            .filter(|p| !p.is_empty())
            .map(PathBuf::from)
            .filter(|p| p.is_dir())
        {
            dialog = dialog.set_directory(dir);
        }
        Ok(dialog
            .blocking_pick_folder()
            .and_then(|p| p.into_path().ok())
            .map(|p| p.to_string_lossy().into_owned()))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 系统文件选择器（可带扩展名过滤）。
#[tauri::command]
pub async fn pick_file_path(
    app: AppHandle,
    title: Option<String>,
    default_path: Option<String>,
    filters: Option<Vec<FileDialogFilter>>,
) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut dialog = app.dialog().file();
        if let Some(title) = title.as_deref().map(str::trim).filter(|t| !t.is_empty()) {
            dialog = dialog.set_title(title);
        }
        if let Some(base) = default_path
            .as_deref()
            .map(str::trim)
            .filter(|p| !p.is_empty())
            .map(PathBuf::from)
        {
            if base.is_dir() {
                dialog = dialog.set_directory(base);
            } else if let Some(parent) = base.parent().filter(|p| p.is_dir()) {
                dialog = dialog.set_directory(parent);
            }
        }
        for filter in filters.unwrap_or_default() {
            let extensions: Vec<&str> = filter.extensions.iter().map(String::as_str).collect();
            dialog = dialog.add_filter(filter.name.clone(), &extensions);
        }
        Ok(dialog
            .blocking_pick_file()
            .and_then(|p| p.into_path().ok())
            .map(|p| p.to_string_lossy().into_owned()))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 目录直接打开；文件在资源管理器中定位。
#[tauri::command]
pub fn open_path_in_explorer(path: String) -> Result<(), String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("路径为空".into());
    }
    let target = PathBuf::from(trimmed);
    if !target.exists() {
        return Err(format!("路径不存在：{trimmed}"));
    }
    if target.is_dir() {
        tauri_plugin_opener::open_path(target, None::<&str>).map_err(|e| e.to_string())
    } else {
        tauri_plugin_opener::reveal_item_in_dir(target).map_err(|e| e.to_string())
    }
}
