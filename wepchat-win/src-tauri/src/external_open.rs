use serde::Serialize;
use std::path::Path;
use std::process::Command;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectOpenTarget {
    pub id: String,
    pub label: String,
}

fn command_exists(command: &str) -> bool {
    Command::new("where")
        .arg(command)
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

fn supported_targets() -> Vec<ProjectOpenTarget> {
    let mut targets = vec![ProjectOpenTarget {
        id: "explorer".into(),
        label: "文件资源管理器".into(),
    }];
    if command_exists("code") {
        targets.push(ProjectOpenTarget { id: "vscode".into(), label: "VS Code".into() });
    }
    if command_exists("devenv") {
        targets.push(ProjectOpenTarget { id: "visual-studio".into(), label: "Visual Studio".into() });
    }
    if command_exists("git-bash") {
        targets.push(ProjectOpenTarget { id: "git-bash".into(), label: "Git Bash".into() });
    }
    targets
}

fn project_dir(path: &str) -> Result<&Path, String> {
    let path = Path::new(path);
    if !path.is_absolute() || !path.is_dir() {
        return Err("项目目录不存在".into());
    }
    Ok(path)
}

#[tauri::command]
pub fn external_project_open_targets() -> Vec<ProjectOpenTarget> {
    supported_targets()
}

#[tauri::command]
pub fn external_project_open(path: String, target: String) -> Result<(), String> {
    let project = project_dir(&path)?;
    let mut command = match target.as_str() {
        "explorer" => Command::new("explorer.exe"),
        "vscode" if command_exists("code") => Command::new("code"),
        "visual-studio" if command_exists("devenv") => Command::new("devenv"),
        "git-bash" if command_exists("git-bash") => {
            let mut command = Command::new("git-bash");
            command.arg(format!("--cd={}", project.display()));
            return command
                .spawn()
                .map(|_| ())
                .map_err(|error| format!("无法打开 Git Bash: {error}"));
        }
        _ => return Err("不支持的打开方式".into()),
    };
    command
        .arg(project)
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("无法打开项目: {error}"))
}
