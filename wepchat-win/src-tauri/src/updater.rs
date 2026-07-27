//! 应用内更新：GitHub Releases 检查 / 下载 / 安装。
//! 桌面端 release tag 前缀 `win-v`，资产只认 `*-setup.exe`（nsis），
//! 安卓端 `vX.Y.Z` tag 永不匹配。方案见 docs/settings-revamp.md 阶段 C。

use futures_util::StreamExt;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

const RELEASES_API: &str = "https://api.github.com/repos/WEP-56/WePChat/releases?per_page=30";
const DOWNLOAD_PREFIX: &str = "https://github.com/WEP-56/WePChat/releases/download/";
const TAG_PREFIX: &str = "win-v";
const CHECK_TIMEOUT: Duration = Duration::from_secs(20);
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(30 * 60);
const PROGRESS_STEP: u64 = 256 * 1024;
/// 防异常资产的兜底上限。
const MAX_INSTALLER_BYTES: u64 = 1024 * 1024 * 1024;

/// 下载取消标记（同一时刻至多一个下载，UI 侧保证）。
#[derive(Default)]
pub struct UpdateAbort(Arc<AtomicBool>);

fn parse_version(raw: &str) -> Option<(u64, u64, u64)> {
    let mut parts = raw.trim().split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next().unwrap_or("0").parse().ok()?;
    let patch = parts.next().unwrap_or("0").parse().ok()?;
    if parts.next().is_some() {
        return None;
    }
    Some((major, minor, patch))
}

#[tauri::command]
pub async fn update_check() -> Result<Value, String> {
    let client = crate::http_client::shared_client()?;
    let response = client
        .get(RELEASES_API)
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .timeout(CHECK_TIMEOUT)
        .send()
        .await
        .map_err(|e| format!("检查更新失败：{e}"))?;
    let status = response.status().as_u16();
    if status == 403 || status == 429 {
        return Err("GitHub 接口暂时受限，请稍后再试".into());
    }
    if !(200..300).contains(&status) {
        return Err(format!("检查更新失败：HTTP {status}"));
    }
    let releases: Value = response
        .json()
        .await
        .map_err(|e| format!("解析更新信息失败：{e}"))?;

    let current_raw = env!("CARGO_PKG_VERSION");
    let current = parse_version(current_raw).ok_or("当前版本号无效")?;

    let empty = Vec::new();
    let list = releases.as_array().unwrap_or(&empty);
    // 只认 win-v 前缀 tag 且带 -setup.exe 资产的正式 release，取最高版本。
    let mut best: Option<((u64, u64, u64), &Value, &Value)> = None;
    for release in list {
        if release.get("draft").and_then(Value::as_bool).unwrap_or(false)
            || release
                .get("prerelease")
                .and_then(Value::as_bool)
                .unwrap_or(false)
        {
            continue;
        }
        let Some(tag) = release.get("tag_name").and_then(Value::as_str) else {
            continue;
        };
        let Some(version_raw) = tag.strip_prefix(TAG_PREFIX) else {
            continue;
        };
        let Some(version) = parse_version(version_raw) else {
            continue;
        };
        let Some(asset) = release
            .get("assets")
            .and_then(Value::as_array)
            .and_then(|assets| {
                assets.iter().find(|asset| {
                    asset
                        .get("name")
                        .and_then(Value::as_str)
                        .map(|name| name.to_ascii_lowercase().ends_with("-setup.exe"))
                        .unwrap_or(false)
                })
            })
        else {
            continue;
        };
        if best.as_ref().map(|(v, _, _)| version > *v).unwrap_or(true) {
            best = Some((version, release, asset));
        }
    }

    let Some((version, release, asset)) = best else {
        return Ok(json!({ "currentVersion": current_raw, "hasUpdate": false }));
    };
    if version <= current {
        return Ok(json!({
            "currentVersion": current_raw,
            "hasUpdate": false,
            "latestTag": release.get("tag_name"),
        }));
    }
    let sha256 = asset
        .get("digest")
        .and_then(Value::as_str)
        .and_then(|digest| digest.strip_prefix("sha256:"))
        .map(str::to_string);
    Ok(json!({
        "currentVersion": current_raw,
        "hasUpdate": true,
        "tag": release.get("tag_name"),
        "version": format!("{}.{}.{}", version.0, version.1, version.2),
        "name": release.get("name"),
        "notes": release.get("body"),
        "publishedAt": release.get("published_at"),
        "releaseUrl": release.get("html_url"),
        "asset": {
            "name": asset.get("name"),
            "size": asset.get("size"),
            "url": asset.get("browser_download_url"),
            "sha256": sha256,
        },
    }))
}

#[tauri::command]
pub async fn update_download(
    app: AppHandle,
    state: tauri::State<'_, UpdateAbort>,
    url: String,
    file_name: String,
    sha256: Option<String>,
) -> Result<String, String> {
    if !url.starts_with(DOWNLOAD_PREFIX) {
        return Err("下载地址不在本项目 Releases 下".into());
    }
    let safe_name = file_name.trim();
    if safe_name.is_empty()
        || safe_name.contains(['/', '\\'])
        || safe_name.contains("..")
        || !safe_name.to_ascii_lowercase().ends_with(".exe")
    {
        return Err("安装包文件名无效".into());
    }

    let abort = state.0.clone();
    abort.store(false, Ordering::SeqCst);

    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("updates");
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建更新目录失败：{e}"))?;
    let final_path = dir.join(safe_name);
    let partial_path = dir.join(format!("{safe_name}.partial"));

    let client = crate::http_client::shared_client()?;
    let response = client
        .get(&url)
        .timeout(DOWNLOAD_TIMEOUT)
        .send()
        .await
        .map_err(|e| format!("下载失败：{e}"))?;
    if !response.status().is_success() {
        return Err(format!("下载失败：HTTP {}", response.status().as_u16()));
    }
    let total = response.content_length().unwrap_or(0);
    if total > MAX_INSTALLER_BYTES {
        return Err("安装包超出大小上限".into());
    }

    let mut file =
        std::fs::File::create(&partial_path).map_err(|e| format!("创建临时文件失败：{e}"))?;
    let mut hasher = Sha256::new();
    let mut received: u64 = 0;
    let mut last_emit: u64 = 0;
    let mut stream = response.bytes_stream();

    let download_result: Result<(), String> = async {
        while let Some(item) = stream.next().await {
            if abort.load(Ordering::SeqCst) {
                return Err("已取消下载".into());
            }
            let bytes = item.map_err(|e| format!("下载中断：{e}"))?;
            received += bytes.len() as u64;
            if received > MAX_INSTALLER_BYTES {
                return Err("安装包超出大小上限".into());
            }
            hasher.update(&bytes);
            file.write_all(&bytes).map_err(|e| format!("写入失败：{e}"))?;
            if received - last_emit >= PROGRESS_STEP {
                last_emit = received;
                let _ = app.emit(
                    "update://progress",
                    json!({ "received": received, "total": total }),
                );
            }
        }
        file.flush().map_err(|e| format!("写入失败：{e}"))?;
        Ok(())
    }
    .await;

    drop(file);
    if let Err(error) = download_result {
        let _ = std::fs::remove_file(&partial_path);
        return Err(error);
    }

    if let Some(expected) = sha256.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        let actual = format!("{:x}", hasher.finalize());
        if !actual.eq_ignore_ascii_case(expected) {
            let _ = std::fs::remove_file(&partial_path);
            return Err("安装包校验失败（sha256 不匹配）".into());
        }
    }

    let _ = std::fs::remove_file(&final_path);
    std::fs::rename(&partial_path, &final_path).map_err(|e| format!("保存安装包失败：{e}"))?;
    let _ = app.emit(
        "update://progress",
        json!({ "received": received, "total": total, "done": true }),
    );
    Ok(final_path.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn update_download_abort(state: tauri::State<'_, UpdateAbort>) {
    state.0.store(true, Ordering::SeqCst);
}

/// 拉起 NSIS 安装器（交互式）并退出应用；清理走 RunEvent::Exit。
#[tauri::command]
pub fn update_install(app: AppHandle, path: String) -> Result<(), String> {
    let updates_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("updates");
    let canonical_dir = updates_dir
        .canonicalize()
        .map_err(|e| format!("更新目录不存在：{e}"))?;
    let installer = PathBuf::from(path.trim())
        .canonicalize()
        .map_err(|e| format!("安装包不存在：{e}"))?;
    if !installer.starts_with(&canonical_dir) {
        return Err("安装包路径不在更新目录内".into());
    }
    if !installer
        .extension()
        .map(|ext| ext.eq_ignore_ascii_case("exe"))
        .unwrap_or(false)
    {
        return Err("安装包类型无效".into());
    }
    std::process::Command::new(&installer)
        .spawn()
        .map_err(|e| format!("启动安装程序失败：{e}"))?;
    app.exit(0);
    Ok(())
}
