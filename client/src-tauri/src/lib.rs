use base64::{Engine as _, engine::general_purpose::STANDARD};
use chrono::Local;
use std::fs;
use tauri::Manager;
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_dialog::DialogExt;

#[tauri::command]
fn save_screenshot(
    app: tauri::AppHandle,
    name: String,
    ip: String,
    port: String,
    image_base64: String
) -> Result<String, String> {
    let pictures_dir = app.path().picture_dir().map_err(|e| e.to_string())?;
    
    let netman_dir = pictures_dir.join("NetMan");
    let instance_dir = netman_dir.join(&name);
    
    fs::create_dir_all(&instance_dir).map_err(|e| e.to_string())?;
    
    let now = Local::now();
    let timestamp = now.format("%Y%m%d_%H%M%S").to_string();
    // User requested format: remote-<instance>-<ip>-<port>-<dateTime>.png
    let filename = format!("remote-{}-{}-{}-{}.png", name, ip, port, timestamp);
    let path = instance_dir.join(filename);
    
    let decoded = STANDARD.decode(image_base64).map_err(|e| e.to_string())?;
    fs::write(&path, decoded).map_err(|e| e.to_string())?;
    
    // Open the screenshot in the default system photo viewer
    let path_str = path.to_string_lossy().to_string();
    let _ = app.opener().open_path(&path_str, None::<String>);

    Ok(path_str)
}

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
async fn pick_folder(app: tauri::AppHandle) -> Result<String, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog().file().pick_folder(move |folder| {
        let _ = tx.send(folder);
    });
    
    match rx.await {
        Ok(Some(p)) => Ok(p.to_string()),
        Ok(None) => Err("Cancelled".to_string()),
        Err(_) => Err("Dialog failed".to_string()),
    }
}

#[tauri::command]
async fn pick_save_path(app: tauri::AppHandle, default_name: String) -> Result<String, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_file_name(default_name)
        .save_file(move |file| {
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
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            greet, 
            save_screenshot,
            pick_folder,
            pick_save_path,
            write_file_binary,
            append_file_binary
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
