use base64::{Engine as _, engine::general_purpose::STANDARD};
use std::fs;
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;
#[cfg(not(mobile))]
use tokio::sync::oneshot;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
async fn pick_folder(app: tauri::AppHandle) -> Result<String, String> {
    #[cfg(mobile)]
    {
        let _ = app; // Unused
        return Err("Folder picking is not supported on mobile platforms".to_string());
    }

    #[cfg(not(mobile))]
    {
        let (tx, rx) = tokio::sync::oneshot::channel();
        app.dialog().file().pick_folder(move |folder: Option<tauri_plugin_dialog::FilePath>| {
            let _ = tx.send(folder);
        });
        
        match rx.await {
            Ok(Some(p)) => Ok(p.to_string()),
            Ok(None) => Err("Cancelled".to_string()),
            Err(_) => Err("Dialog failed".to_string()),
        }
    }
}

#[tauri::command]
async fn pick_save_path(app: tauri::AppHandle, default_name: String) -> Result<String, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_file_name(default_name)
        .save_file(move |file: Option<tauri_plugin_dialog::FilePath>| {
            let _ = tx.send(file);
        });
    
    match rx.await {
        Ok(Some(p)) => Ok(p.to_string()),
        Ok(None) => Err("Cancelled".to_string()),
        Err(_) => Err("Dialog failed".to_string()),
    }
}

#[tauri::command]
fn write_file_binary(path: String, data_base64: String) -> Result<(), String> {
    let decoded = STANDARD.decode(data_base64).map_err(|e| e.to_string())?;
    fs::write(path, decoded).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn append_file_binary(path: String, data_base64: String) -> Result<(), String> {
    use std::io::Write;
    let decoded = STANDARD.decode(data_base64).map_err(|e| e.to_string())?;
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|e| e.to_string())?;
    file.write_all(&decoded).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            greet, 
            pick_folder,
            pick_save_path,
            write_file_binary,
            append_file_binary
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
