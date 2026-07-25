use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use std::path::{Component, Path, PathBuf};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectEntry {
    name: String,
    path: String,
    is_directory: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFile {
    data_base64: String,
}

fn resolve_project_path(root: &str, relative_path: &str) -> Result<(PathBuf, PathBuf), String> {
    let root = Path::new(root)
        .canonicalize()
        .map_err(|error| format!("无法访问项目目录: {error}"))?;
    if !root.is_dir() {
        return Err("项目根路径不是目录".to_string());
    }
    let relative = Path::new(relative_path);
    if relative.is_absolute()
        || relative.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return Err("文件路径必须位于项目目录内".to_string());
    }
    let target = root
        .join(relative)
        .canonicalize()
        .map_err(|error| format!("无法访问项目文件: {error}"))?;
    if !target.starts_with(&root) {
        return Err("文件路径超出项目目录".to_string());
    }
    Ok((root, target))
}

fn relative_display_path(root: &Path, path: &Path) -> Result<String, String> {
    Ok(path
        .strip_prefix(root)
        .map_err(|error| error.to_string())?
        .to_string_lossy()
        .replace('\\', "/"))
}

#[tauri::command]
pub fn external_project_list(
    root: String,
    relative_path: String,
) -> Result<Vec<ProjectEntry>, String> {
    let (root, target) = resolve_project_path(&root, &relative_path)?;
    if !target.is_dir() {
        return Err("目标路径不是目录".to_string());
    }
    let mut entries = std::fs::read_dir(&target)
        .map_err(|error| format!("无法读取项目目录: {error}"))?
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let path = entry.path();
            let metadata = entry.metadata().ok()?;
            Some(ProjectEntry {
                name: entry.file_name().to_string_lossy().into_owned(),
                path: relative_display_path(&root, &path).ok()?,
                is_directory: metadata.is_dir(),
            })
        })
        .collect::<Vec<_>>();
    entries.sort_by(|a, b| {
        b.is_directory
            .cmp(&a.is_directory)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(entries)
}

#[tauri::command]
pub fn external_project_read(root: String, relative_path: String) -> Result<ProjectFile, String> {
    let (_, target) = resolve_project_path(&root, &relative_path)?;
    if !target.is_file() {
        return Err("目标路径不是文件".to_string());
    }
    let bytes = std::fs::read(&target).map_err(|error| format!("无法读取项目文件: {error}"))?;
    Ok(ProjectFile {
        data_base64: STANDARD.encode(bytes),
    })
}
