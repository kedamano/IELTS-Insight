//! 外壳（Tauri 主进程）把自己的启动结论写进磁盘（契约 §15.4 第 6 条）。
//!
//! 为什么必须有这个文件：release 构建里 `main.rs` 顶着
//! `#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]`，进程**没有控制台**，
//! `println!` / `eprintln!` 全部进黑洞。而「端口 8765 已被占用，本次没有启动引擎」正是
//! 最需要用户看得见的一条 —— 它决定用户接下来是去关旧窗口还是去重装。
//!
//! 行格式、轮转参数与后端 `services/faultlog.py`（契约 §15.3 第 2 条）一致：
//! `时间 | 级别 | PID | [标签] 消息`，1 MiB × 3。PID 写**外壳自己的**进程号，
//! 与 sidecar 的行区分开靠标签 `[Shell]`；两边同一份文件里对照着看，
//! 就能回答「这一次启动，引擎是被我拉起来的，还是我让位给了别人」。

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub const FILE_NAME: &str = "app.log";
pub const MAX_BYTES: u64 = 1024 * 1024;
pub const KEEP: usize = 3;

static LOCK: Mutex<()> = Mutex::new(());

/// `时间 | 级别 | PID | [标签] 消息`（与 faultlog.py 同一口径）。
pub fn line(level: &str, tag: &str, message: &str, pid: u32, stamp: &str) -> String {
    format!("{stamp} | {level} | {pid} | [{tag}] {message}")
}

fn now_stamp() -> String {
    chrono::Local::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, false)
}

/// 日志目录：`IELTS_LOG_DIR` > `IELTS_DB_PATH` 所在目录下的 `logs/` > 默认用户数据目录。
/// 与后端 `config._db_dir()` + `default_log_dir()` 同一优先级，抽成纯函数便于测（第 6 条）。
pub fn log_dir_for(lookup: impl Fn(&str) -> Option<String>) -> PathBuf {
    if let Some(value) = non_empty(&lookup, "IELTS_LOG_DIR") {
        return PathBuf::from(value);
    }
    if let Some(db) = non_empty(&lookup, "IELTS_DB_PATH") {
        if let Some(parent) = PathBuf::from(db).parent() {
            return parent.join("logs");
        }
    }
    default_data_dir_for(&lookup).join("logs")
}

fn non_empty(lookup: &impl Fn(&str) -> Option<String>, key: &str) -> Option<String> {
    lookup(key).map(|v| v.trim().to_string()).filter(|v| !v.is_empty())
}

/// 用户数据根：Windows 用 `%LOCALAPPDATA%\\IELTSInsight`，其余用 `~/.ielts-insight`，
/// 与 `pyinstaller_entry.py:_appdata_dir()` / `config.default_data_dir()` 对齐。
pub fn default_data_dir_for(lookup: &impl Fn(&str) -> Option<String>) -> PathBuf {
    if let Some(local) = non_empty(lookup, "LOCALAPPDATA").or_else(|| non_empty(lookup, "APPDATA")) {
        return PathBuf::from(local).join("IELTSInsight");
    }
    match non_empty(lookup, "HOME") {
        Some(home) => PathBuf::from(home).join(".ielts-insight"),
        None => PathBuf::from(".ielts-insight"),
    }
}

fn file_path() -> PathBuf {
    log_dir_for(|key| std::env::var(key).ok()).join(FILE_NAME)
}

/// 超限就滚动：`app.log.3` 丢弃、`.2`→`.3`、`.1`→`.2`、`app.log`→`.1`（与 Python 侧同序）。
pub fn shift(path: &Path) -> std::io::Result<()> {
    for index in (1..KEEP).rev() {
        let from = rotated_name(path, index);
        let to = rotated_name(path, index + 1);
        if from.exists() {
            fs::rename(&from, &to)?;
        }
    }
    if path.exists() {
        fs::rename(path, rotated_name(path, 1))?;
    }
    Ok(())
}

fn rotated_name(path: &Path, index: usize) -> PathBuf {
    let 名字 = path.file_name().map(|v| v.to_string_lossy().into_owned()).unwrap_or_default();
    path.with_file_name(format!("{名字}.{index}"))
}

fn emit(level: &str, tag: &str, message: &str) {
    let text = line(level, tag, message, std::process::id(), &now_stamp());
    // 落盘失败绝不能挡住启动：外壳写不进日志时该继续起窗口，而不是弹个更糟的错误。
    let wrote = (|| -> std::io::Result<()> {
        // 中毒也不放弃：这把锁只保护一次 append，没有需要跨调用维持的不变式。
        let _guard = match LOCK.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        let path = file_path();
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        if let Ok(meta) = path.metadata() {
            if meta.len() + text.len() as u64 > MAX_BYTES {
                shift(&path)?;
            }
        }
        let mut handle = OpenOptions::new().create(true).append(true).open(&path)?;
        handle.write_all(text.as_bytes())?;
        handle.write_all(b"\n")?;
        handle.flush()
    })();
    if let Err(error) = wrote {
        // 只剩 stdout 这条 best-effort 退路（§15.3：文件是主载体）。
        eprintln!("[IELTS][Shell] 日志落盘失败（{error}）：{text}");
    }
    // stdout 副本：`tauri dev` 的终端里能直接看到。
    println!("{text}");
}

pub fn info(tag: &str, message: &str) {
    emit("INFO", tag, message);
}

pub fn warn(tag: &str, message: &str) {
    emit("WARNING", tag, message);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn 环境(表: &[(&str, &str)]) -> impl Fn(&str) -> Option<String> {
        let owned: Vec<(String, String)> =
            表.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect();
        move |key: &str| owned.iter().find(|(k, _)| k == key).map(|(_, v)| v.clone())
    }

    #[test]
    fn 行格式与后端一致() {
        let 文本 = line("WARNING", "Shell", "端口 8765 已被占用", 4321, "2026-10-30T21:00:00+08:00");
        assert_eq!(文本, "2026-10-30T21:00:00+08:00 | WARNING | 4321 | [Shell] 端口 8765 已被占用");
        assert_eq!(文本.split(" | ").count(), 4, "字段数必须与 faultlog.py 一致");
    }

    #[test]
    fn 日志目录优先级与后端相同() {
        let 显式 = log_dir_for(环境(&[("IELTS_LOG_DIR", "D:/自定义/日志"), ("IELTS_DB_PATH", "D:/库/app.db")]));
        assert_eq!(显式, PathBuf::from("D:/自定义/日志"), "IELTS_LOG_DIR 最大");

        let 随库 = log_dir_for(环境(&[("IELTS_DB_PATH", "D:/库/app.db")]));
        assert_eq!(随库, PathBuf::from("D:/库/logs"), "凭据文件与库同目录（§15.4 第 8 条）");

        let 默认 = log_dir_for(环境(&[("LOCALAPPDATA", "C:/Users/x/AppData/Local")]));
        assert_eq!(默认, PathBuf::from("C:/Users/x/AppData/Local/IELTSInsight/logs"));

        let 空值 = log_dir_for(环境(&[("IELTS_LOG_DIR", "  "), ("LOCALAPPDATA", "C:/Data")]));
        assert_eq!(空值, PathBuf::from("C:/Data/IELTSInsight/logs"), "空字符串按没设置处理");
    }

    #[test]
    fn 滚动只保留三份() {
        let 目录 = std::env::temp_dir().join(format!("ielts-shelllog-{}", std::process::id()));
        fs::create_dir_all(&目录).unwrap();
        let 文件 = 目录.join(FILE_NAME);
        for index in 1..=KEEP {
            fs::write(目录.join(format!("{FILE_NAME}.{index}")), format!("旧{index}")).unwrap();
        }
        fs::write(&文件, "当前").unwrap();
        shift(&文件).unwrap();
        assert_eq!(fs::read_to_string(目录.join(format!("{FILE_NAME}.1"))).unwrap(), "当前");
        assert_eq!(fs::read_to_string(目录.join(format!("{FILE_NAME}.2"))).unwrap(), "旧1");
        assert_eq!(fs::read_to_string(目录.join(format!("{FILE_NAME}.3"))).unwrap(), "旧2");
        assert!(!目录.join(format!("{FILE_NAME}.4")).exists(), "超出 KEEP 的那份必须被挤掉");
        fs::remove_dir_all(&目录).ok();
    }
}
