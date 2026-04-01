use argon2::{
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use enigo::{
    Coordinate, Enigo, Key, Keyboard, Mouse, Settings
};
use futures_util::{stream::StreamExt, SinkExt};
use serde::{Deserialize, Serialize};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use std::{collections::HashSet, sync::Arc};
use tokio::{
    net::{TcpListener, TcpStream},
    sync::Mutex,
};
use tokio_util::sync::CancellationToken;
use tokio_tungstenite::{accept_async, tungstenite::Message};
use uuid::Uuid;
use xcap::Monitor;

mod file_manager;

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct ProcessItem {
    pub pid: u32,
    pub name: String,
    pub cpu: f32,
    pub mem_mb: u64,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct ServiceItem {
    pub name: String,
    pub status: String,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct DriveInfo {
    pub name: String,
    pub mount_point: String,
    pub total_gb: f32,
    pub used_gb: f32,
    pub drive_type: String,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct FileItem {
    pub name: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified: u64,
    pub extension: String,
}

#[derive(Clone, Deserialize, Debug)]
#[serde(tag = "type")]
enum ClientMessage {
    Auth { username: String, password: String },
    MouseMove { token: String, dx: i32, dy: i32 },
    MouseClick { token: String, button: String },
    KeyPress { token: String, key: String },
    SetVolume { token: String, volume: u8 },
    PowerAction { token: String, action: String },
    StartScreenShare { token: String },
    StopScreenShare { token: String },
    TakeScreenshot { token: String },
    StartTerminal { token: String },
    StopTerminal { _token: String },
    TerminalInput { token: String, input: String },
    StartTerminalV2 { token: String },
    StopTerminalV2 { _token: String },
    TerminalV2Input { token: String, input: String },
    TerminalV2Resize { token: String, rows: u16, cols: u16 },
    ListProcesses { token: String },
    KillProcess { token: String, pid: u32 },
    ListServices { token: String },
    ToggleService { token: String, name: String, action: String },
    GetClipboard { token: String },
    SetClipboard { token: String, text: String },
    ListDrives { token: String },
    ListDir { token: String, path: String },
    ListFolders { token: String, path: String },
    CreateDir { token: String, path: String },
    CreateFile { token: String, path: String },
    RenameFile { token: String, old_path: String, new_path: String },
    DeleteFile { token: String, path: String, permanent: bool },
    MoveFile { token: String, src: String, dest: String },
    CopyFile { token: String, src: String, dest: String },
    ReadFile { token: String, path: String },
    WriteFile { token: String, path: String, content: String },
    UploadChunk {
        token: String,
        id: String,
        path: String,
        data_base64: String,
        append: bool,
    },
    DownloadRequest {
        token: String,
        id: String,
        path: String,
    },
    OpenFile { token: String, path: String },
    ValidatePath { token: String, path: String },
    StartNotifications { token: String },
    EndNotifications { token: String },
}

#[derive(Clone, Serialize, Debug)]
#[serde(tag = "type")]
enum ServerMessage {
    AuthResult {
        success: bool,
        token: Option<String>,
        message: String,
        os: Option<String>,
        capabilities: Vec<String>,
    },
    ScreenFrame {
        frame_base64: String,
    },
    TerminalOutput {
        output: String,
    },
    TerminalV2Output {
        output: String,
    },
    TerminalCwd {
        path: String,
    },
    SystemInfo {
        os_name: String,
        os_version: String,
        hostname: String,
        cpu_usage: Vec<f32>,
        ram_total_gb: f32,
        ram_used_gb: f32,
        disk_usage_pct: u8,
        cpu_temp: f32,
        gpus: Vec<String>,
        network_name: String,
        local_ip: String,
        internet_online: bool,
        net_rx_kbps: f32,
        net_tx_kbps: f32,
    },
    AudioState {
        mute: bool,
        volume: u8,
        media_title: Option<String>,
    },
    Screenshot {
        image_base64: String,
    },
    ProcessList {
        processes: Vec<ProcessItem>,
    },
    ServiceList {
        services: Vec<ServiceItem>,
    },
    ClipboardContents {
        text: String,
    },
    DriveList {
        drives: Vec<DriveInfo>,
    },
    DirList {
        path: String,
        items: Vec<FileItem>,
    },
    FolderList {
        path: String,
        folders: Vec<String>,
    },
    UploadStatus {
        id: String,
        success: bool,
        message: String,
        chunk_index: usize,
    },
    FileContent {
        path: String,
        content: String,
    },
    PathValidation {
        path: String,
        is_valid: bool,
        is_dir: bool,
    },
    Error {
        message: String,
    },
    DownloadChunk {
        id: String,
        data_base64: String,
        is_last: bool,
    },
    HostNotification {
        title: String,
        body: String,
        source: String,
    },
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct FullSystemInfo {
    pub os_name: String,
    pub os_version: String,
    pub hostname: String,
    pub cpu_usage: Vec<f32>,
    pub ram_total_gb: f32,
    pub ram_used_gb: f32,
    pub disk_usage_pct: u8,
    pub cpu_temp: f32,
    pub gpus: Vec<String>,
    pub network_name: String,
    pub local_ip: String,
    pub internet_online: bool,
    pub net_rx_kbps: f32,
    pub net_tx_kbps: f32,
}

struct AppState {
    active_tokens: HashSet<String>,
    hashed_password: String,
    enigo: Enigo,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let password = "pass";
    let salt = SaltString::generate(&mut rand_core::OsRng);
    let argon2 = Argon2::default();
    let hashed_password = argon2.hash_password(password.as_bytes(), &salt).map_err(|e| e.to_string())?.to_string();

    #[cfg(target_os = "windows")]
    {
        println!("[SERVER] Ensuring AudioDeviceCmdlets is installed...");
        let _ = tokio::process::Command::new("powershell")
            .args(&[
                "-Command",
                "if (-not (Get-Module -ListAvailable AudioDeviceCmdlets)) { Install-Module -Name AudioDeviceCmdlets -Scope CurrentUser -AcceptLicense -Force }"
            ])
            .kill_on_drop(true)
            .status().await;
    }

    let state = Arc::new(Mutex::new(AppState {
        active_tokens: HashSet::new(),
        hashed_password,
        enigo: Enigo::new(&Settings::default()).unwrap(),
    }));

    // Notification Subscribers and Broadcast
    let subscriber_count = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let (notif_tx, _) = tokio::sync::broadcast::channel::<ServerMessage>(32);

    let addr = "0.0.0.0:8082";
    let listener = TcpListener::bind(&addr).await?;
    println!("Server running on ws://{}", addr);

    let shutdown_token = CancellationToken::new();
    let shutdown_token_spawn = shutdown_token.clone();

    // Global System Info Polling Task
    let (stats_tx, stats_rx) = tokio::sync::watch::channel(None::<FullSystemInfo>);
    let stop_sys = shutdown_token.clone();
    tokio::spawn(async move {
        use sysinfo::{System, Disks, Components, Networks};
        let mut sys = System::new_all();
        let mut components = Components::new_with_refreshed_list();
        let mut networks = Networks::new_with_refreshed_list();
        let disks = Disks::new_with_refreshed_list();
        let mut last_total_rx = 0;
        let mut last_total_tx = 0;
        let mut last_time = std::time::Instant::now();
        
        loop {
            if stop_sys.is_cancelled() { break; }
            sys.refresh_all();
            components.refresh(true);
            networks.refresh(true);
            
            let cpu_usage: Vec<f32> = sys.cpus().iter().map(|c| c.cpu_usage()).collect();
            let ram_total = sys.total_memory() as f32 / 1_073_741_824.0;
            let ram_used = sys.used_memory() as f32 / 1_073_741_824.0;
            
            let disk_usage = disks.iter().next().map(|d| {
                let total = d.total_space();
                let available = d.available_space();
                if total > 0 { ((total - available) * 100 / total) as u8 } else { 0 }
            }).unwrap_or(0);
            
            let cpu_temp = components.iter()
                .filter(|c| {
                    let label = c.label().to_lowercase();
                    label.contains("cpu") || label.contains("package") || label.contains("core")
                })
                .filter_map(|c| c.temperature())
                .fold(0.0, f32::max);
            
            let (gpus, net_name, online) = get_platform_system_details().await;

            let mut local_ip = "Unknown".to_string();
            for (_name, data) in &networks {
                for ip in data.ip_networks() {
                    let addr = ip.addr;
                    if !addr.is_loopback() && (addr.is_ipv4() || addr.is_ipv6()) {
                        local_ip = addr.to_string();
                        break;
                    }
                }
                if local_ip != "Unknown" { break; }
            }

            let now = std::time::Instant::now();
            let elapsed = now.duration_since(last_time).as_secs_f32();
            let mut total_rx = 0;
            let mut total_tx = 0;
            for (_name, data) in &networks {
                total_rx += data.received();
                total_tx += data.transmitted();
            }
            
            let net_rx = if elapsed > 0.0 { (total_rx.saturating_sub(last_total_rx)) as f32 / 1024.0 / elapsed } else { 0.0 };
            let net_tx = if elapsed > 0.0 { (total_tx.saturating_sub(last_total_tx)) as f32 / 1024.0 / elapsed } else { 0.0 };
            
            last_total_rx = total_rx;
            last_total_tx = total_tx;
            last_time = now;

            let info = FullSystemInfo {
                os_name: System::name().unwrap_or_default(),
                os_version: System::os_version().unwrap_or_default(),
                hostname: System::host_name().unwrap_or_default(),
                cpu_usage,
                ram_total_gb: ram_total,
                ram_used_gb: ram_used,
                disk_usage_pct: disk_usage,
                cpu_temp: cpu_temp,
                gpus: gpus,
                network_name: net_name,
                local_ip: local_ip,
                internet_online: online,
                net_rx_kbps: net_rx,
                net_tx_kbps: net_tx,
            };

            let _ = stats_tx.send(Some(info));

            tokio::select! {
                _ = tokio::time::sleep(std::time::Duration::from_secs(5)) => {}
                _ = stop_sys.cancelled() => break,
            }
        }
    });

    // Global Notification Polling Task
    let stop_notif = shutdown_token.clone();
    let notif_tx_spawn = notif_tx.clone();
    let sub_count_spawn = subscriber_count.clone();

    tokio::spawn(async move {
        let mut last_id = 0u32;
        // Initialize last_id to current max on start to avoid flooding old notifications
        #[cfg(target_os = "windows")]
        {
            let script = r#"
                $ErrorActionPreference = 'SilentlyContinue'
                Add-Type -AssemblyName System.Runtime.WindowsRuntime
                $l = [Windows.UI.Notifications.Management.UserNotificationListener]::Current
                $n = $l.GetNotificationsAsync(1).GetAwaiter().GetResult()
                if ($n.Count -gt 0) { $n | Measure-Object -Property Id -Maximum | Select-Object -ExpandProperty Maximum } else { 0 }
            "#;
            let output = tokio::process::Command::new("powershell")
                .args(&["-NoProfile", "-Command", script])
                .output().await;
            if let Ok(out) = output {
                let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
                last_id = s.parse::<u32>().unwrap_or(0);
            }
        }

        loop {
            if stop_notif.is_cancelled() { break; }
            let subs = sub_count_spawn.load(std::sync::atomic::Ordering::SeqCst);
            
            if subs > 0 {
                #[cfg(target_os = "windows")]
                {
                    let script = format!(r#"
                        $ErrorActionPreference = 'SilentlyContinue'
                        Add-Type -AssemblyName System.Runtime.WindowsRuntime
                        $l = [Windows.UI.Notifications.Management.UserNotificationListener]::Current
                        # Ensure access is granted (critical for non-packaged dev apps)
                        if ($l.GetAccessStatusAsync().GetAwaiter().GetResult() -ne 'Allowed') {{
                            $res = $l.RequestAccessAsync().GetAwaiter().GetResult()
                        }}
                        $ns = $l.GetNotificationsAsync(1).GetAwaiter().GetResult()
                        foreach ($n in $ns) {{
                            if ($n.Id -gt {}) {{
                                $id = $n.Id
                                $app = $n.AppInfo.DisplayInfo.DisplayName
                                $toast = $n.Notification.Visual.GetBinding([Windows.UI.Notifications.NotificationTemplateNames]::ToastGeneric)
                                if ($toast) {{
                                    $texts = $toast.GetTextElements()
                                    $title = $texts[0].Text.Replace("|", " ")
                                    $body = ($texts[1..($texts.Length-1)].Text -join " ").Replace("|", " ")
                                    "$id|$app|$title|$body"
                                }}
                            }}
                        }}
                    "#, last_id);

                    let output = tokio::process::Command::new("powershell")
                        .args(&["-NoProfile", "-Command", &script])
                        .output().await;

                    if let Ok(out) = output {
                        let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
                        if !s.is_empty() {
                            println!("[SERVER] Notification Poll Raw: {}", s);
                        }
                        for line in s.lines() {
                            let parts: Vec<&str> = line.split('|').collect();
                            if parts.len() >= 4 {
                                let id = parts[0].parse::<u32>().unwrap_or(0);
                                if id > last_id {
                                    println!("[SERVER] New Notification Found: {} - {}", parts[1], parts[2]);
                                    last_id = id;
                                    match notif_tx_spawn.send(ServerMessage::HostNotification {
                                        title: parts[2].to_string(),
                                        body: parts[3].to_string(),
                                        source: parts[1].to_string(),
                                    }) {
                                        Ok(n) => println!("[SERVER] Broadcasted notification to {} internal listeners", n),
                                        Err(e) => eprintln!("[SERVER] Broadcast Error: {}", e),
                                    }
                                }
                            }
                        }
                    }
                }

                #[cfg(target_os = "linux")]
                {
                    // Placeholder for Linux DBus notification signal monitoring 
                }

                tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            } else {
                tokio::time::sleep(std::time::Duration::from_secs(5)).await;
            }
        }
    });

    loop {
        tokio::select! {
            result = listener.accept() => {
                if let Ok((stream, addr)) = result {
                    println!("\n[SERVER] New connection incoming from: {}", addr);
                    let state_c = state.clone();
                    let token_c = shutdown_token_spawn.clone();
                    let stats_rx_c = stats_rx.clone();
                    let notif_tx_c = notif_tx.clone();
                    let sub_count_c = subscriber_count.clone();
                    tokio::spawn(async move {
                        handle_connection(stream, addr, state_c, token_c, stats_rx_c, notif_tx_c, sub_count_c).await;
                    });
                }
            }
            _ = tokio::signal::ctrl_c() => {
                println!("\nKeyboard interrupt received. Shutting down server gracefully...");
                shutdown_token.cancel();
                tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                break;
            }
        }
    }

    Ok(())
}

async fn handle_connection(
    stream: TcpStream, 
    addr: std::net::SocketAddr, 
    state: Arc<Mutex<AppState>>, 
    shutdown_token: CancellationToken, 
    mut stats_rx: tokio::sync::watch::Receiver<Option<FullSystemInfo>>,
    notif_tx: tokio::sync::broadcast::Sender<ServerMessage>,
    subscriber_count: Arc<std::sync::atomic::AtomicUsize>
) {
    let ws_stream = match accept_async(stream).await {
        Ok(ws) => ws,
        Err(_) => return,
    };

    let (mut sender, mut receiver) = ws_stream.split();
    let mut session_token = None;
    
    let is_sharing = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let (frame_tx, mut frame_rx) = tokio::sync::mpsc::unbounded_channel();
    let (term_out_tx, mut term_out_rx) = tokio::sync::mpsc::unbounded_channel::<String>();
    let mut term_in_tx: Option<tokio::sync::mpsc::UnboundedSender<String>> = None;
    let (term_v2_out_tx, mut term_v2_out_rx) = tokio::sync::mpsc::unbounded_channel::<String>();
    let mut term_v2_in_tx: Option<tokio::sync::mpsc::UnboundedSender<String>> = None;
    let mut master_pty: Option<Box<dyn portable_pty::MasterPty + Send>> = None;
    let mut is_subscribed = false;
    let mut notif_rx = notif_tx.subscribe();
    
    // Audio Polling Task
    let (msg_tx, mut msg_rx) = tokio::sync::mpsc::unbounded_channel::<ServerMessage>();
    let msg_tx_clone = msg_tx.clone();
    let stop_audio = shutdown_token.clone();
    tokio::spawn(async move {
        let mut last_state: Option<(bool, u8, Option<String>)> = None;
        loop {
            if stop_audio.is_cancelled() { break; }
            let (mute, volume, media_title) = get_audio_state().await;
            if last_state.is_none() || Some((mute, volume, media_title.clone())) != last_state {
                println!("[SERVER] Broadcasting AudioState: Vol={}%, Mute={}, Media={:?}", volume, mute, media_title);
                if msg_tx_clone.send(ServerMessage::AudioState { mute, volume, media_title: media_title.clone() }).is_err() {
                    break;
                }
                last_state = Some((mute, volume, media_title));
            }
            tokio::select! {
                _ = tokio::time::sleep(std::time::Duration::from_secs(3)) => {}
                _ = stop_audio.cancelled() => break,
            }
        }
    });
    
    // Global Stats Pipe
    let msg_tx_sys = msg_tx.clone();
    let stop_sys_pipe = shutdown_token.clone();
    tokio::spawn(async move {
        loop {
            if stop_sys_pipe.is_cancelled() { break; }
            
            let info_opt = stats_rx.borrow().clone();
            if let Some(info) = info_opt {
                let msg = ServerMessage::SystemInfo {
                    os_name: info.os_name,
                    os_version: info.os_version,
                    hostname: info.hostname,
                    cpu_usage: info.cpu_usage,
                    ram_total_gb: info.ram_total_gb,
                    ram_used_gb: info.ram_used_gb,
                    disk_usage_pct: info.disk_usage_pct,
                    cpu_temp: info.cpu_temp,
                    gpus: info.gpus,
                    network_name: info.network_name,
                    local_ip: info.local_ip,
                    internet_online: info.internet_online,
                    net_rx_kbps: info.net_rx_kbps,
                    net_tx_kbps: info.net_tx_kbps,
                };
                if msg_tx_sys.send(msg).is_err() { break; }
            }

            tokio::select! {
                Ok(_) = stats_rx.changed() => {}
                _ = stop_sys_pipe.cancelled() => break,
            }
        }
    });

    let is_sharing_clone = is_sharing.clone();
    std::thread::spawn(move || {
        let monitor = Monitor::all().unwrap_or_default().into_iter().next();
        if let Some(mon) = monitor {
            loop {
                if frame_tx.is_closed() {
                    break;
                }
                if is_sharing_clone.load(std::sync::atomic::Ordering::Relaxed) {
                    if let Ok(rgba_image) = mon.capture_image() {
                        let rgb_image = image::DynamicImage::ImageRgba8(rgba_image).into_rgb8();
                        let mut buf = Vec::new();
                        let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, 40);
                        if encoder.encode(rgb_image.as_raw(), rgb_image.width(), rgb_image.height(), image::ColorType::Rgb8.into()).is_ok() {
                            let b64 = STANDARD.encode(&buf);
                            if frame_tx.send(b64).is_err() {
                                break;
                            }
                        }
                    }
                }
                std::thread::sleep(std::time::Duration::from_millis(150)); // ~6 FPS
            }
        }
    });

    loop {
        tokio::select! {
            msg_opt = receiver.next() => {
                let msg = match msg_opt {
                    Some(Ok(Message::Text(text))) => text.to_string(), // Convert Utf8Bytes to String to parse correctly
                    Some(Ok(Message::Close(_))) | None => break,
                    _ => continue,
                };

                let client_msg: Result<ClientMessage, _> = serde_json::from_str(&msg);
                if let Ok(ref c_msg) = client_msg {
                    match c_msg {
                        ClientMessage::MouseMove { .. } => {} // Ignore spam
                        ClientMessage::Auth { username, .. } => println!("[{}] Request: Auth {{ username: \"{}\", password: \"***\" }}", addr, username),
                        _ => println!("[{}] Request: {:?}", addr, c_msg),
                    }
                }
                match client_msg {
                    Ok(ClientMessage::Auth { username, password }) => {
                        let mut state_lock = state.lock().await;
                        if username != "admin" {
                            let _ = sender.send(Message::Text(tokio_tungstenite::tungstenite::Utf8Bytes::from(serde_json::to_string(&ServerMessage::AuthResult { success: false, token: None, message: "Invalid username".into(), os: None, capabilities: vec![] }).unwrap()))).await;
                            continue;
                        }

                        let parsed_hash = PasswordHash::new(&state_lock.hashed_password).unwrap();
                        let is_valid = Argon2::default().verify_password(password.as_bytes(), &parsed_hash).is_ok();

                        if is_valid {
                            let token = Uuid::new_v4().to_string();
                            state_lock.active_tokens.insert(token.clone());
                            session_token = Some(token.clone());
                            let os_name = std::env::consts::OS.to_string();
                            let capabilities = get_server_capabilities();
                            let _ = sender.send(Message::Text(tokio_tungstenite::tungstenite::Utf8Bytes::from(serde_json::to_string(&ServerMessage::AuthResult { success: true, token: Some(token), message: "OK".into(), os: Some(os_name), capabilities }).unwrap()))).await;
                        } else {
                            let _ = sender.send(Message::Text(tokio_tungstenite::tungstenite::Utf8Bytes::from(serde_json::to_string(&ServerMessage::AuthResult { success: false, token: None, message: "Invalid password".into(), os: None, capabilities: vec![] }).unwrap()))).await;
                        }
                    }
                    Ok(ClientMessage::MouseMove { token, dx, dy }) => {
                        let mut state_lock = state.lock().await;
                        if state_lock.active_tokens.contains(&token) {
                            let _ = state_lock.enigo.move_mouse(dx, dy, Coordinate::Rel);
                        }
                    }
                    Ok(ClientMessage::MouseClick { token, button }) => {
                        let mut state_lock = state.lock().await;
                        if state_lock.active_tokens.contains(&token) {
                            let b = match button.as_str() {
                                "left" => enigo::Button::Left,
                                "right" => enigo::Button::Right,
                                _ => enigo::Button::Left,
                            };
                            let _ = state_lock.enigo.button(b, enigo::Direction::Click);
                        }
                    }
                    Ok(ClientMessage::KeyPress { token, key }) => {
                        let mut state_lock = state.lock().await;
                        if state_lock.active_tokens.contains(&token) {
                            if key != " " { println!("[127.0.0.1:{}] Request: KeyPress {{ key: {:?} }}", addr.port(), key); }
                            let is_media = key.starts_with("Media") || key.starts_with("Audio");
                            let k = match key.as_str() {
                                "Enter" => Some(Key::Return),
                                "Backspace" => Some(Key::Backspace),
                                "Escape" => Some(Key::Escape),
                                "Tab" => Some(Key::Tab),
                                " " => Some(Key::Space),
                                "ArrowUp" => Some(Key::UpArrow),
                                "ArrowDown" => Some(Key::DownArrow),
                                "ArrowLeft" => Some(Key::LeftArrow),
                                "ArrowRight" => Some(Key::RightArrow),
                                "PageUp" => Some(Key::PageUp),
                                "PageDown" => Some(Key::PageDown),
                                "MediaPlayPause" => Some(Key::MediaPlayPause),
                                "MediaTrackNext" => Some(Key::MediaNextTrack),
                                "MediaTrackPrevious" => Some(Key::MediaPrevTrack),
                                "AudioVolumeMute" => Some(Key::VolumeMute),
                                _ => if key.len() == 1 { Some(Key::Unicode(key.chars().next().unwrap())) } else { None }
                            };
                            if let Some(valid_key) = k {
                                if is_media {
                                   let _ = state_lock.enigo.key(valid_key, enigo::Direction::Press);
                                   drop(state_lock); // Release lock before awaiting sleep
                                   tokio::time::sleep(std::time::Duration::from_millis(50)).await;
                                   let mut state_lock = state.lock().await;
                                   let _ = state_lock.enigo.key(valid_key, enigo::Direction::Release);
                                } else {
                                   let _ = state_lock.enigo.key(valid_key, enigo::Direction::Click);
                                }
                            }
                        }
                    }
                    Ok(ClientMessage::StartScreenShare { token }) => {
                        if Some(token) == session_token {
                            println!("Client requested StartScreenShare!");
                            is_sharing.store(true, std::sync::atomic::Ordering::Relaxed);
                        }
                    }
                    Ok(ClientMessage::StopScreenShare { token }) => {
                        if Some(token) == session_token {
                            println!("Client requested StopScreenShare.");
                            is_sharing.store(false, std::sync::atomic::Ordering::Relaxed);
                        }
                    }
                    Ok(ClientMessage::StartTerminal { token }) => {
                        if Some(token) == session_token && term_in_tx.is_none() {
                            let shell = if cfg!(target_os = "windows") { "powershell.exe" } else { "bash" };
                            let mut cmd_builder = tokio::process::Command::new(shell);
                            if cfg!(target_os = "windows") {
                                cmd_builder.arg("-NoLogo");
                            }
                            if let Ok(mut child) = cmd_builder
                                .stdin(std::process::Stdio::piped())
                                .stdout(std::process::Stdio::piped())
                                .stderr(std::process::Stdio::piped())
                                .spawn()
                            {
                                let mut stdin = child.stdin.take().unwrap();
                                let mut stdout = child.stdout.take().unwrap();
                                let mut stderr = child.stderr.take().unwrap();
                                
                                // Send initial CWD
                                if let Ok(cwd) = std::env::current_dir() {
                                    let _ = msg_tx.send(ServerMessage::TerminalCwd { path: cwd.to_string_lossy().into_owned() });
                                }

                                let (in_tx, mut in_rx) = tokio::sync::mpsc::unbounded_channel::<String>();
                                term_in_tx = Some(in_tx);
                                
                                tokio::spawn(async move {
                                    use tokio::io::AsyncWriteExt;
                                    while let Some(input) = in_rx.recv().await {
                                        if stdin.write_all(input.as_bytes()).await.is_err() { break; }
                                        let _ = stdin.flush().await;
                                    }
                                });
                                
                                let out_tx_1 = term_out_tx.clone();
                                tokio::spawn(async move {
                                    use tokio::io::AsyncReadExt;
                                    let mut buf = [0u8; 1024];
                                    while let Ok(n) = stdout.read(&mut buf).await {
                                        if n == 0 { break; }
                                        let s = String::from_utf8_lossy(&buf[..n]).into_owned();
                                        let _ = out_tx_1.send(s);
                                    }
                                });
                                
                                let out_tx_2 = term_out_tx.clone();
                                tokio::spawn(async move {
                                    use tokio::io::AsyncReadExt;
                                    let mut buf = [0u8; 1024];
                                    while let Ok(n) = stderr.read(&mut buf).await {
                                        if n == 0 { break; }
                                        let s = String::from_utf8_lossy(&buf[..n]).into_owned();
                                        let _ = out_tx_2.send(s);
                                    }
                                });
                                
                                tokio::spawn(async move { let _ = child.wait().await; });
                            }
                        }
                    }
                    Ok(ClientMessage::StopTerminal { _token: _ }) => {
                        // We intentionally ignore StopTerminal now to persist session across tabs
                        // It will be cleaned up when the socket closes
                    }
                    Ok(ClientMessage::TerminalInput { token, input }) => {
                        if Some(token) == session_token {
                            if let Some(tx) = &term_in_tx {
                                let _ = tx.send(input);
                            }
                        }
                    }
                    Ok(ClientMessage::StartTerminalV2 { token }) => {
                        if Some(token) == session_token && term_v2_in_tx.is_none() {
                            let pty_system = portable_pty::native_pty_system();
                            if let Ok(pair) = pty_system.openpty(portable_pty::PtySize { rows: 24, cols: 80, pixel_width: 0, pixel_height: 0 }) {
                                let shell = if cfg!(target_os = "windows") { "powershell.exe" } else { "bash" };
                                let mut cmd = portable_pty::CommandBuilder::new(shell);
                                cmd.env("TERM", "xterm-256color");
                                if cfg!(target_os = "windows") { cmd.arg("-NoLogo"); }
                                if let Ok(mut child) = pair.slave.spawn_command(cmd) {
                                    drop(pair.slave);
                                    let master = pair.master;
                                    if let (Ok(mut reader), Ok(mut writer)) = (master.try_clone_reader(), master.take_writer()) {
                                        let (in_tx, mut in_rx) = tokio::sync::mpsc::unbounded_channel::<String>();
                                        term_v2_in_tx = Some(in_tx);
                                        
                                        // Send initial CWD
                                        if let Ok(cwd) = std::env::current_dir() {
                                            let _ = msg_tx.send(ServerMessage::TerminalCwd { path: cwd.to_string_lossy().into_owned() });
                                        }

                                        let out_tx = term_v2_out_tx.clone();
                                        std::thread::spawn(move || {
                                            use std::io::Read;
                                            let mut buf = [0u8; 1024];
                                            while let Ok(n) = reader.read(&mut buf) {
                                                if n == 0 { break; }
                                                let s = String::from_utf8_lossy(&buf[..n]).into_owned();
                                                let _ = out_tx.send(s);
                                            }
                                        });
                                        
                                        tokio::spawn(async move {
                                            use std::io::Write;
                                            while let Some(input) = in_rx.recv().await {
                                                let _ = writer.write_all(input.as_bytes());
                                            }
                                        });
                                        
                                        // Keep the PTY master alive until the shell truly exits!
                                        let _master_clone = master.try_clone_reader().unwrap(); // Just to keep reference to master if needed
                                        // Actually master itself needs to stick around
                                        master_pty = Some(master);
                                        let master_keepalive = master_pty.as_ref().unwrap().try_clone_reader().unwrap();
                                        
                                        std::thread::spawn(move || {
                                            let _ = child.wait();
                                            drop(master_keepalive);
                                        });
                                        
                                    } else {
                                        println!("[SERVER] ERROR: PTY master channels failed to clone!");
                                    }
                                } else {
                                    println!("[SERVER] ERROR: Failed to spawn PTY child process! Is PowerShell missing from PATH?");
                                }
                            }
                        }
                    }
                    Ok(ClientMessage::StopTerminalV2 { _token: _ }) => {
                        // We intentionally ignore StopTerminalV2 now to persist session across tabs
                    }
                    Ok(ClientMessage::TerminalV2Input { token, input }) => {
                        if Some(token) == session_token {
                            if let Some(tx) = &term_v2_in_tx {
                                let _ = tx.send(input);
                            }
                        }
                    }
                    Ok(ClientMessage::TerminalV2Resize { token, rows, cols }) => {
                        if Some(token) == session_token {
                            if let Some(master) = &master_pty {
                                let _ = master.resize(portable_pty::PtySize {
                                    rows,
                                    cols,
                                    pixel_width: 0,
                                    pixel_height: 0,
                                });
                            }
                        }
                    }
                    Ok(ClientMessage::PowerAction { token, action }) => {
                        let state_lock = state.lock().await;
                        if state_lock.active_tokens.contains(&token) {
                            println!("[{}] Request: PowerAction {}", addr, action);
                            
                            #[cfg(target_os = "windows")]
                            {
                                let cmd = match action.as_str() {
                                    "win_shutdown" | "win_shutdown_update" => Some("shutdown /s /t 0"),
                                    "win_restart" | "win_restart_update" => Some("shutdown /r /t 0"),
                                    "win_sleep" => Some("powershell -Command \"Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Application]::SetSuspendState('Suspend', $false, $false)\""),
                                    "win_lock" => Some("rundll32.exe user32.dll,LockWorkStation"),
                                    _ => None,
                                };
                                
                                if let Some(c) = cmd {
                                    tokio::spawn(async move {
                                        let base_cmd = if c.starts_with("powershell") { "powershell" } else { "cmd" };
                                        let args = if base_cmd == "powershell" {
                                            vec!["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", &c["powershell -Command ".len()..]]
                                        } else {
                                            vec!["/C", c]
                                        };
                                        
                                        let _ = tokio::process::Command::new(base_cmd)
                                            .args(&args)
                                            .creation_flags(0x08000000)
                                            .status().await;
                                    });
                                }
                            }
                            
                            #[cfg(target_os = "linux")]
                            {
                                let cmd = match action.as_str() {
                                    "lin_shutdown" => Some("systemctl poweroff"),
                                    "lin_restart" => Some("systemctl reboot"),
                                    "lin_sleep" => Some("systemctl suspend"),
                                    _ => None,
                                };
                                if let Some(c) = cmd {
                                    tokio::spawn(async move {
                                        let _ = tokio::process::Command::new("sh")
                                            .args(&["-c", c])
                                            .status().await;
                                    });
                                }
                            }

                            #[cfg(target_os = "macos")]
                            {
                                let cmd = match action.as_str() {
                                    "mac_shutdown" => Some("osascript -e 'tell app \"System Events\" to shut down'"),
                                    "mac_restart" => Some("osascript -e 'tell app \"System Events\" to restart'"),
                                    "mac_sleep" => Some("osascript -e 'tell app \"System Events\" to sleep'"),
                                    "mac_lock" => Some("osascript -e 'tell application \"System Events\" to keystroke \"q\" using {control command}'"),
                                    _ => None,
                                };
                                if let Some(c) = cmd {
                                    tokio::spawn(async move {
                                        let _ = tokio::process::Command::new("sh")
                                            .args(&["-c", c])
                                            .status().await;
                                    });
                                }
                            }
                        }
                    }
                    Ok(ClientMessage::TakeScreenshot { token }) => {
                        let state_lock = state.lock().await;
                        if state_lock.active_tokens.contains(&token) {
                            println!("[{}] Request: TakeScreenshot", addr);
                            let b64_opt = {
                                let monitor = Monitor::all().unwrap_or_default().into_iter().next();
                                if let Some(mon) = monitor {
                                    if let Ok(rgba_image) = mon.capture_image() {
                                        let rgb_image = image::DynamicImage::ImageRgba8(rgba_image);
                                        let mut buf = Vec::new();
                                        if rgb_image.write_to(&mut std::io::Cursor::new(&mut buf), image::ImageFormat::Png).is_ok() {
                                            Some(STANDARD.encode(&buf))
                                        } else { None }
                                    } else { None }
                                } else { None }
                            };
                            
                            if let Some(b64) = b64_opt {
                                let _ = sender.send(Message::Text(tokio_tungstenite::tungstenite::Utf8Bytes::from(serde_json::to_string(&ServerMessage::Screenshot { image_base64: b64 }).unwrap()))).await;
                            }
                        }
                    }
                    Ok(ClientMessage::SetVolume { token, volume }) => {
                        let state_lock = state.lock().await;
                        if state_lock.active_tokens.contains(&token) {
                            println!("[{}] Request: SetVolume {}%", addr, volume);
                            #[cfg(target_os = "windows")]
                            {
                                let cmd = format!("Import-Module AudioDeviceCmdlets -ErrorAction SilentlyContinue; Set-AudioDevice -PlaybackVolume {}", volume);
                                let tx_c = msg_tx.clone();
                                tokio::spawn(async move {
                                    let _ = tokio::process::Command::new("powershell")
                                        .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", &cmd])
                                        .creation_flags(0x08000000)
                                        .output().await;
                                    // Immediate broadcast after set
                                    let _ = tx_c.send(ServerMessage::AudioState { mute: false, volume, media_title: None });
                                });
                            }
                            #[cfg(target_os = "linux")]
                            {
                                let tx_c = msg_tx.clone();
                                tokio::spawn(async move {
                                    let _ = tokio::process::Command::new("amixer")
                                        .args(["-q", "sset", "Master", &format!("{}%", volume)])
                                        .output().await;
                                    let _ = tx_c.send(ServerMessage::AudioState { mute: false, volume, media_title: None });
                                });
                            }
                            #[cfg(target_os = "macos")]
                            {
                                let tx_c = msg_tx.clone();
                                tokio::spawn(async move {
                                    let _ = tokio::process::Command::new("osascript")
                                        .args(["-e", &format!("set volume output volume {}", volume)])
                                        .output().await;
                                    let _ = tx_c.send(ServerMessage::AudioState { mute: false, volume, media_title: None });
                                });
                            }
                        } else {
                            println!("[{}] Request: SetVolume - FAILED (Invalid Token)", addr);
                        }
                    }
                    Ok(ClientMessage::ListProcesses { token }) => {
                        let state_lock = state.lock().await;
                        if state_lock.active_tokens.contains(&token) {
                            let mut sys = sysinfo::System::new();
                            sys.refresh_all();
                            let processes: Vec<ProcessItem> = sys.processes().values().map(|p| {
                                ProcessItem {
                                    pid: p.pid().as_u32(),
                                    name: p.name().to_string_lossy().into_owned(),
                                    cpu: p.cpu_usage(),
                                    mem_mb: p.memory() / 1_048_576,
                                }
                            }).collect();
                            let response = ServerMessage::ProcessList { processes };
                            let _ = sender.send(Message::Text(tokio_tungstenite::tungstenite::Utf8Bytes::from(serde_json::to_string(&response).unwrap()))).await;
                        }
                    }
                    Ok(ClientMessage::KillProcess { token, pid }) => {
                        let state_lock = state.lock().await;
                        if state_lock.active_tokens.contains(&token) {
                            let mut sys = sysinfo::System::new();
                            sys.refresh_all();
                            if let Some(p) = sys.process(sysinfo::Pid::from_u32(pid)) {
                                    p.kill();
                                    println!("[{}] Killed process PID {}", addr, pid);
                                }
                            }
                        }
                    Ok(ClientMessage::ListServices { token }) => {
                        let state_lock = state.lock().await;
                        if state_lock.active_tokens.contains(&token) {
                            let mut services = Vec::new();
                            #[cfg(target_os = "windows")]
                            {
                                let output = tokio::process::Command::new("powershell")
                                    .args(["-NoProfile", "-Command", "Get-Service | ForEach-Object { $_.Name + '|' + $_.Status }"])
                                    .output().await;
                                if let Ok(out) = output {
                                    let s = String::from_utf8_lossy(&out.stdout);
                                    for line in s.lines() {
                                        let parts: Vec<&str> = line.split('|').collect();
                                        if parts.len() == 2 {
                                            services.push(ServiceItem { name: parts[0].to_string(), status: parts[1].to_string() });
                                        }
                                    }
                                }
                            }
                            #[cfg(target_os = "linux")]
                            {
                                let output = tokio::process::Command::new("systemctl")
                                    .args(["list-units", "--type=service", "--all", "--no-legend"])
                                    .output().await;
                                if let Ok(out) = output {
                                    let s = String::from_utf8_lossy(&out.stdout);
                                    for line in s.lines() {
                                        let parts: Vec<&str> = line.split_whitespace().collect();
                                        if parts.len() >= 4 {
                                            services.push(ServiceItem { name: parts[0].to_string(), status: parts[3].to_string() });
                                        }
                                    }
                                }
                            }
                            #[cfg(target_os = "macos")]
                            {
                                let output = tokio::process::Command::new("launchctl")
                                    .arg("list")
                                    .output().await;
                                if let Ok(out) = output {
                                    let s = String::from_utf8_lossy(&out.stdout);
                                    for line in s.lines().skip(1) { // Skip header
                                        let parts: Vec<&str> = line.split_whitespace().collect();
                                        if parts.len() >= 3 {
                                            let name = parts[2].to_string();
                                            let status = if parts[0] == "-" { "stopped" } else { "running" };
                                            services.push(ServiceItem { name, status: status.to_string() });
                                        }
                                    }
                                }
                            }
                            let response = ServerMessage::ServiceList { services };
                            let _ = sender.send(Message::Text(tokio_tungstenite::tungstenite::Utf8Bytes::from(serde_json::to_string(&response).unwrap()))).await;
                        }
                    }
                    Ok(ClientMessage::ToggleService { token, name, action }) => {
                        let state_lock = state.lock().await;
                        if state_lock.active_tokens.contains(&token) {
                            #[cfg(target_os = "windows")]
                            {
                                let cmd = match action.as_str() {
                                    "start" => "Start-Service",
                                    "stop" => "Stop-Service",
                                    "restart" => "Restart-Service",
                                    _ => "",
                                };
                                if !cmd.is_empty() {
                                    let _ = tokio::process::Command::new("powershell")
                                        .args(["-NoProfile", "-Command", &format!("{} -Name '{}'", cmd, name)])
                                        .status().await;
                                }
                            }
                            #[cfg(target_os = "linux")]
                            {
                                let cmd = match action.as_str() {
                                    "start" | "stop" | "restart" => action.as_str(),
                                    _ => "",
                                };
                                if !cmd.is_empty() {
                                    let _ = tokio::process::Command::new("systemctl")
                                        .args([cmd, &name])
                                        .status().await;
                                }
                            }
                            #[cfg(target_os = "macos")]
                            {
                                let cmd = match action.as_str() {
                                    "start" => Some("load"),
                                    "stop" => Some("unload"),
                                    _ => None,
                                };
                                if let Some(c) = cmd {
                                    // Basic launchctl command for service management
                                    let _ = tokio::process::Command::new("launchctl")
                                        .args([c, "-w", &name])
                                        .status().await;
                                }
                            }
                        }
                    }
                    Ok(ClientMessage::GetClipboard { token }) => {
                        let state_lock = state.lock().await;
                        if state_lock.active_tokens.contains(&token) {
                            println!("[{}] Request: GetClipboard", addr);
                            if let Ok(mut clipboard) = arboard::Clipboard::new() {
                                if let Ok(text) = clipboard.get_text() {
                                    let response = ServerMessage::ClipboardContents { text };
                                    let _ = sender.send(Message::Text(tokio_tungstenite::tungstenite::Utf8Bytes::from(serde_json::to_string(&response).unwrap()))).await;
                                }
                            }
                        }
                    }
                    Ok(ClientMessage::SetClipboard { token, text }) => {
                        let state_lock = state.lock().await;
                        if state_lock.active_tokens.contains(&token) {
                            println!("[{}] Request: SetClipboard ({} bytes)", addr, text.len());
                            if let Ok(mut clipboard) = arboard::Clipboard::new() {
                                let _ = clipboard.set_text(text);
                            }
                        }
                    }
                    Ok(ClientMessage::ListDrives { token }) => {
                        let state_lock = state.lock().await;
                        if state_lock.active_tokens.contains(&token) {
                            println!("[SERVER] Listing drives...");
                            let drives = file_manager::list_drives();
                            println!("[SERVER] Found {} drives.", drives.len());
                            let _ = sender.send(Message::Text(tokio_tungstenite::tungstenite::Utf8Bytes::from(serde_json::to_string(&ServerMessage::DriveList { drives }).unwrap()))).await;
                        }
                    }
                    Ok(ClientMessage::ListDir { token, path }) => {
                        let state_lock = state.lock().await;
                        if state_lock.active_tokens.contains(&token) {
                            let path_to_list = if path.is_empty() { file_manager::get_home_dir() } else { path };
                            println!("[SERVER] Listing directory: {}", path_to_list);
                            match file_manager::list_dir(&path_to_list) {
                                Ok(items) => {
                                    println!("[SERVER] Found {} items in {}", items.len(), path_to_list);
                                    let _ = sender.send(Message::Text(tokio_tungstenite::tungstenite::Utf8Bytes::from(serde_json::to_string(&ServerMessage::DirList { path: path_to_list, items }).unwrap()))).await;
                                },
                                Err(e) => {
                                    println!("[SERVER] Error listing {}: {}", path_to_list, e);
                                    let _ = sender.send(Message::Text(tokio_tungstenite::tungstenite::Utf8Bytes::from(serde_json::to_string(&ServerMessage::Error { message: format!("Failed to list directory: {}", e) }).unwrap()))).await;
                                }
                            }
                        }
                    }
                    Ok(ClientMessage::ValidatePath { token, path }) => {
                        let state_lock = state.lock().await;
                        if state_lock.active_tokens.contains(&token) {
                            let (is_valid, is_dir) = file_manager::validate_path(&path);
                            let _ = sender.send(Message::Text(tokio_tungstenite::tungstenite::Utf8Bytes::from(serde_json::to_string(&ServerMessage::PathValidation { path, is_valid, is_dir }).unwrap()))).await;
                        }
                    }
                    Ok(ClientMessage::CreateDir { token, path }) => {
                        let state_lock = state.lock().await;
                        if state_lock.active_tokens.contains(&token) {
                            match file_manager::create_dir(&path) {
                                Ok(_) => {
                                    // Refresh after action
                                    if let Some(parent) = std::path::Path::new(&path).parent() {
                                        if let Ok(items) = file_manager::list_dir(&parent.to_string_lossy()) {
                                            let _ = sender.send(Message::Text(tokio_tungstenite::tungstenite::Utf8Bytes::from(serde_json::to_string(&ServerMessage::DirList { path: parent.to_string_lossy().into_owned(), items }).unwrap()))).await;
                                        }
                                    }
                                },
                                Err(e) => {
                                    let _ = sender.send(Message::Text(tokio_tungstenite::tungstenite::Utf8Bytes::from(serde_json::to_string(&ServerMessage::Error { message: format!("Failed to create folder: {}", e) }).unwrap()))).await;
                                }
                            }
                        }
                    }
                    Ok(ClientMessage::CreateFile { token, path }) => {
                        let state_lock = state.lock().await;
                        if state_lock.active_tokens.contains(&token) {
                            match file_manager::create_file(&path) {
                                Ok(_) => {
                                    if let Some(parent) = std::path::Path::new(&path).parent() {
                                        if let Ok(items) = file_manager::list_dir(&parent.to_string_lossy()) {
                                            let _ = sender.send(Message::Text(tokio_tungstenite::tungstenite::Utf8Bytes::from(serde_json::to_string(&ServerMessage::DirList { path: parent.to_string_lossy().into_owned(), items }).unwrap()))).await;
                                        }
                                    }
                                },
                                Err(e) => {
                                    let _ = sender.send(Message::Text(tokio_tungstenite::tungstenite::Utf8Bytes::from(serde_json::to_string(&ServerMessage::Error { message: format!("Failed to create file: {}", e) }).unwrap()))).await;
                                }
                            }
                        }
                    }
                    Ok(ClientMessage::RenameFile { token, old_path, new_path }) => {
                        let state_lock = state.lock().await;
                        if state_lock.active_tokens.contains(&token) {
                            match file_manager::rename(&old_path, &new_path) {
                                Ok(_) => {
                                    if let Some(parent) = std::path::Path::new(&new_path).parent() {
                                        if let Ok(items) = file_manager::list_dir(&parent.to_string_lossy()) {
                                            let _ = sender.send(Message::Text(tokio_tungstenite::tungstenite::Utf8Bytes::from(serde_json::to_string(&ServerMessage::DirList { path: parent.to_string_lossy().into_owned(), items }).unwrap()))).await;
                                        }
                                    }
                                },
                                Err(e) => {
                                    let _ = sender.send(Message::Text(tokio_tungstenite::tungstenite::Utf8Bytes::from(serde_json::to_string(&ServerMessage::Error { message: format!("Failed to rename: {}", e) }).unwrap()))).await;
                                }
                            }
                        }
                    }
                    Ok(ClientMessage::DeleteFile { token, path, permanent }) => {
                        let state_lock = state.lock().await;
                        if state_lock.active_tokens.contains(&token) {
                            drop(state_lock); // Release lock before blocking
                            let path_clone = path.clone();
                            let result = tokio::task::spawn_blocking(move || {
                                file_manager::delete(&path_clone, permanent)
                            }).await;

                            match result {
                                Ok(Ok(())) => {
                                    // Refresh parent directory
                                    if let Some(parent) = std::path::Path::new(&path).parent() {
                                        if let Ok(items) = file_manager::list_dir(&parent.to_string_lossy()) {
                                            let _ = sender.send(Message::Text(tokio_tungstenite::tungstenite::Utf8Bytes::from(serde_json::to_string(&ServerMessage::DirList { path: parent.to_string_lossy().into_owned(), items }).unwrap()))).await;
                                        }
                                    }
                                },
                                Ok(Err(e)) => {
                                    println!("[SERVER] Delete error: {}", e);
                                    let _ = sender.send(Message::Text(tokio_tungstenite::tungstenite::Utf8Bytes::from(serde_json::to_string(&ServerMessage::Error { message: format!("Delete failed: {}", e) }).unwrap()))).await;
                                },
                                Err(e) => {
                                    println!("[SERVER] Delete task panicked: {}", e);
                                    let _ = sender.send(Message::Text(tokio_tungstenite::tungstenite::Utf8Bytes::from(serde_json::to_string(&ServerMessage::Error { message: "Delete operation failed unexpectedly.".into() }).unwrap()))).await;
                                }
                            }
                        }
                    }
                    Ok(ClientMessage::ListFolders { token, path }) => {
                        let state_lock = state.lock().await;
                        if state_lock.active_tokens.contains(&token) {
                            if path.is_empty() {
                                let folders = file_manager::list_root_folders();
                                let _ = sender.send(Message::Text(tokio_tungstenite::tungstenite::Utf8Bytes::from(serde_json::to_string(&ServerMessage::FolderList { path: "".to_string(), folders }).unwrap()))).await;
                            } else {
                                match file_manager::list_folders(&path) {
                                Ok(folders) => {
                                    let _ = sender.send(Message::Text(tokio_tungstenite::tungstenite::Utf8Bytes::from(serde_json::to_string(&ServerMessage::FolderList { path: path.clone(), folders }).unwrap()))).await;
                                },
                                Err(e) => {
                                    let _ = sender.send(Message::Text(tokio_tungstenite::tungstenite::Utf8Bytes::from(serde_json::to_string(&ServerMessage::Error { message: format!("Failed to list folders: {}", e) }).unwrap()))).await;
                                }
                            }
                        }
                    }
                }
                Ok(ClientMessage::MoveFile { token, src, dest }) => {
                        let state_lock = state.lock().await;
                        if state_lock.active_tokens.contains(&token) {
                            drop(state_lock);
                            let src_clone = src.clone();
                            let dest_clone = dest.clone();
                            let result = tokio::task::spawn_blocking(move || {
                                file_manager::move_item(&src_clone, &dest_clone)
                            }).await;
                            match result {
                                Ok(Ok(())) => {
                                    if let Some(parent) = std::path::Path::new(&src).parent() {
                                        if let Ok(items) = file_manager::list_dir(&parent.to_string_lossy()) {
                                            let _ = sender.send(Message::Text(tokio_tungstenite::tungstenite::Utf8Bytes::from(serde_json::to_string(&ServerMessage::DirList { path: parent.to_string_lossy().into_owned(), items }).unwrap()))).await;
                                        }
                                    }
                                },
                                Ok(Err(e)) => {
                                    let _ = sender.send(Message::Text(tokio_tungstenite::tungstenite::Utf8Bytes::from(serde_json::to_string(&ServerMessage::Error { message: format!("Move failed: {}", e) }).unwrap()))).await;
                                },
                                Err(e) => {
                                    let _ = sender.send(Message::Text(tokio_tungstenite::tungstenite::Utf8Bytes::from(serde_json::to_string(&ServerMessage::Error { message: format!("Move task failed: {}", e) }).unwrap()))).await;
                                }
                            }
                        }
                    }
                    Ok(ClientMessage::CopyFile { token, src, dest }) => {
                        let state_lock = state.lock().await;
                        if state_lock.active_tokens.contains(&token) {
                            drop(state_lock);
                            let src_clone = src.clone();
                            let dest_clone = dest.clone();
                            let result = tokio::task::spawn_blocking(move || {
                                file_manager::copy_item(&src_clone, &dest_clone)
                            }).await;
                            match result {
                                Ok(Ok(())) => {
                                    if let Some(parent) = std::path::Path::new(&src).parent() {
                                        if let Ok(items) = file_manager::list_dir(&parent.to_string_lossy()) {
                                            let _ = sender.send(Message::Text(tokio_tungstenite::tungstenite::Utf8Bytes::from(serde_json::to_string(&ServerMessage::DirList { path: parent.to_string_lossy().into_owned(), items }).unwrap()))).await;
                                        }
                                    }
                                },
                                Ok(Err(e)) => {
                                    let _ = sender.send(Message::Text(tokio_tungstenite::tungstenite::Utf8Bytes::from(serde_json::to_string(&ServerMessage::Error { message: format!("Copy failed: {}", e) }).unwrap()))).await;
                                },
                                Err(e) => {
                                    let _ = sender.send(Message::Text(tokio_tungstenite::tungstenite::Utf8Bytes::from(serde_json::to_string(&ServerMessage::Error { message: format!("Copy task failed: {}", e) }).unwrap()))).await;
                                }
                            }
                        }
                    }
                    Ok(ClientMessage::ReadFile { token, path }) => {
                        let state_lock = state.lock().await;
                        if state_lock.active_tokens.contains(&token) {
                            match file_manager::read_file(&path) {
                                Ok(content) => {
                                    let _ = sender.send(Message::Text(tokio_tungstenite::tungstenite::Utf8Bytes::from(serde_json::to_string(&ServerMessage::FileContent { path, content }).unwrap()))).await;
                                },
                                Err(e) => {
                                    let _ = sender.send(Message::Text(tokio_tungstenite::tungstenite::Utf8Bytes::from(serde_json::to_string(&ServerMessage::Error { message: format!("Failed to read file: {}", e) }).unwrap()))).await;
                                }
                            }
                        }
                    }
                    Ok(ClientMessage::WriteFile { token, path, content }) => {
                        let state_lock = state.lock().await;
                        if state_lock.active_tokens.contains(&token) {
                            match file_manager::write_file(&path, &content) {
                                Ok(_) => {
                                    // Optionally notify success
                                },
                                Err(e) => {
                                    let _ = sender.send(Message::Text(tokio_tungstenite::tungstenite::Utf8Bytes::from(serde_json::to_string(&ServerMessage::Error { message: format!("Failed to write file: {}", e) }).unwrap()))).await;
                                }
                            }
                        }
                    }
                    Ok(ClientMessage::UploadChunk { token, id, path, data_base64, append }) => {
                        let state_lock = state.lock().await;
                        if state_lock.active_tokens.contains(&token) {
                            drop(state_lock);
                            let data = STANDARD.decode(&data_base64).unwrap_or_default();
                            match file_manager::write_chunk(&path, &data, append) {
                                Ok(_) => {
                                    let _ = sender.send(Message::Text(tokio_tungstenite::tungstenite::Utf8Bytes::from(serde_json::to_string(&ServerMessage::UploadStatus { 
                                        id, 
                                        success: true, 
                                        message: "Chunk written".into(),
                                        chunk_index: 0
                                    }).unwrap()))).await;
                                },
                                Err(e) => {
                                    let _ = sender.send(Message::Text(tokio_tungstenite::tungstenite::Utf8Bytes::from(serde_json::to_string(&ServerMessage::UploadStatus { 
                                        id, 
                                        success: false, 
                                        message: format!("Write failed: {}", e),
                                        chunk_index: 0
                                    }).unwrap()))).await;
                                }
                            }
                        }
                    }
                    Ok(ClientMessage::DownloadRequest { token, id, path }) => {
                        let state_lock = state.lock().await;
                        if state_lock.active_tokens.contains(&token) {
                            drop(state_lock);
                            let path_c = path.clone();
                            let msg_tx_c = msg_tx.clone();
                            let id_c = id.clone();
                            tokio::spawn(async move {
                                let metadata = match std::fs::metadata(&path_c) {
                                    Ok(m) => m,
                                    Err(e) => {
                                        let _ = msg_tx_c.send(ServerMessage::Error { 
                                            message: format!("File not found or inaccessible: {}", e) 
                                        });
                                        return;
                                    }
                                };
                                let total_size = metadata.len();
                                let chunk_size = 256 * 1024; // 256KB
                                let mut offset = 0;
                                while offset < total_size {
                                    let read_size = std::cmp::min(chunk_size as u64, total_size - offset) as usize;
                                    match file_manager::read_file_chunk(&path_c, offset, read_size) {
                                        Ok(data) => {
                                            offset += read_size as u64;
                                            let is_last = offset >= total_size;
                                            let b64 = STANDARD.encode(&data);
                                            if msg_tx_c.send(ServerMessage::DownloadChunk { 
                                                id: id_c.clone(),
                                                data_base64: b64,
                                                is_last
                                            }).is_err() { break; }
                                            
                                            // Small throttle to avoid overwhelming buffers
                                            tokio::time::sleep(tokio::time::Duration::from_millis(15)).await;
                                        },
                                        Err(e) => {
                                            let _ = msg_tx_c.send(ServerMessage::Error { 
                                                message: format!("Read failed during download: {}", e) 
                                            });
                                            break;
                                        }
                                    }
                                }
                            });
                        }
                    }
                    Ok(ClientMessage::OpenFile { token, path }) => {
                        let state_lock = state.lock().await;
                        if state_lock.active_tokens.contains(&token) {
                            match file_manager::open_file(&path) {
                                Ok(_) => {},
                                Err(e) => {
                                    let _ = sender.send(Message::Text(tokio_tungstenite::tungstenite::Utf8Bytes::from(serde_json::to_string(&ServerMessage::Error { message: format!("Failed to open file: {}", e) }).unwrap()))).await;
                                }
                            }
                        }
                    }
                    Ok(ClientMessage::StartNotifications { token }) => {
                        if Some(token) == session_token && !is_subscribed {
                            is_subscribed = true;
                            subscriber_count.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                            println!("[{}] Client subscribed to notifications.", addr);
                        }
                    }
                    Ok(ClientMessage::EndNotifications { token }) => {
                        if Some(token) == session_token && is_subscribed {
                            is_subscribed = false;
                            subscriber_count.fetch_sub(1, std::sync::atomic::Ordering::SeqCst);
                            println!("[{}] Client unsubscribed from notifications.", addr);
                        }
                    }
                    Err(_) => {}
                }
            }
            Some(frame_base64) = frame_rx.recv() => {
                let response = ServerMessage::ScreenFrame { frame_base64 };
                if sender.send(Message::Text(tokio_tungstenite::tungstenite::Utf8Bytes::from(serde_json::to_string(&response).unwrap()))).await.is_err() {
                    break;
                }
            }
            Some(output) = term_out_rx.recv() => {
                let response = ServerMessage::TerminalOutput { output };
                if sender.send(Message::Text(tokio_tungstenite::tungstenite::Utf8Bytes::from(serde_json::to_string(&response).unwrap()))).await.is_err() {
                    break;
                }
            }
            Some(output) = term_v2_out_rx.recv() => {
                let response = ServerMessage::TerminalV2Output { output };
                if sender.send(Message::Text(tokio_tungstenite::tungstenite::Utf8Bytes::from(serde_json::to_string(&response).unwrap()))).await.is_err() {
                    break;
                }
            }
            Some(msg) = msg_rx.recv() => {
                if sender.send(Message::Text(tokio_tungstenite::tungstenite::Utf8Bytes::from(serde_json::to_string(&msg).unwrap()))).await.is_err() {
                    break;
                }
            }
            Ok(msg) = notif_rx.recv() => {
                if is_subscribed {
                    if sender.send(Message::Text(tokio_tungstenite::tungstenite::Utf8Bytes::from(serde_json::to_string(&msg).unwrap()))).await.is_err() {
                        break;
                    }
                }
            }
        }
    }
    
    if is_subscribed {
        subscriber_count.fetch_sub(1, std::sync::atomic::Ordering::SeqCst);
    }
    println!("[{}] Connection formally closed. Dropping OS handles.", addr);
}

async fn get_audio_state() -> (bool, u8, Option<String>) {
    if cfg!(target_os = "windows") {
        let script = r#"
            $v = 0
            $m = "False"
            $med = ""
            try {
                if (!(Get-Module -ListAvailable AudioDeviceCmdlets)) {
                    # Module not found, return obvious error
                    "-2|False|Err: Module Missing"
                    exit
                }
                Import-Module AudioDeviceCmdlets -ErrorAction Stop
                $vStat = Get-AudioDevice -PlaybackVolume
                # Handle both object and string returns
                if ($vStat -is [PSObject] -and $vStat.Volume -ne $null) { $v = $vStat.Volume }
                elseif ($vStat -is [string]) { $v = $vStat.Replace('%','') }
                else { $v = [int]$vStat }
                
                $m = (Get-AudioDevice -PlaybackMute).ToString()
            } catch {
                $err = $_.Exception.Message
                "-1|False|Err: $err"
                exit
            }
            
            try {
                Add-Type -AssemblyName System.Runtime.WindowsRuntime -ErrorAction SilentlyContinue
                $Manager = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync().GetAwaiter().GetResult()
                $Session = $Manager.GetCurrentSession()
                if ($Session) {
                    $Props = $Session.TryGetModelAsync().GetAwaiter().GetResult()
                    $app = $Session.SourceAppIdentifier.Split('!')[0]
                    $med = "{0}: {1} - {2}" -f $app, $Props.Title, $Props.Artist
                }
            } catch {}
            "$v|$m|$med"
        "#;
        let output = tokio::time::timeout(std::time::Duration::from_secs(4),
            tokio::process::Command::new("powershell")
                .args(&["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script])
                .kill_on_drop(true)
                .output()
        ).await;

        match output {
            Ok(Ok(out)) => {
                let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
                let e = String::from_utf8_lossy(&out.stderr).trim().to_string();
                if !e.is_empty() { eprintln!("[SERVER] Audio Poll PSH Error: {}", e); }
                
                let parts: Vec<&str> = s.split('|').collect();
                if parts.len() >= 2 {
                    let vol_val = parts[0].parse::<f32>().unwrap_or(-1.0);
                    let vol = if vol_val < 0.0 { 0 } else { vol_val as u8 };
                    let mute = parts[1].to_lowercase().contains("true");
                    let media = if parts.len() > 2 && !parts[2].is_empty() { Some(parts[2].to_string()) } else { None };
                    return (mute, vol, media);
                }
            },
            Ok(Err(e)) => eprintln!("[SERVER] Audio Poll Process Error: {}", e),
            Err(_) => eprintln!("[SERVER] Audio Poll Timeout"),
        }
    } else if cfg!(target_os = "linux") {
        let output = tokio::process::Command::new("amixer")
            .args(&["sget", "Master"])
            .kill_on_drop(true)
            .output().await;
        let mut mute = false;
        let mut vol = 0;
        if let Ok(out) = output {
            let s = String::from_utf8_lossy(&out.stdout);
            mute = s.contains("[off]");
            if let Some(p1) = s.split('[').nth(1) {
                if let Some(p2) = p1.split('%').next() {
                    vol = p2.parse::<u8>().unwrap_or(0);
                }
            }
        }
        let m_out = tokio::process::Command::new("playerctl")
            .args(&["metadata", "--format", "{{ playerName }}: {{ title }} - {{ artist }}"])
            .output().await;
        let media = if let Ok(mo) = m_out {
            let ms = String::from_utf8_lossy(&mo.stdout).trim().to_string();
            if !ms.is_empty() { Some(ms) } else { None }
        } else { None };
        
        return (mute, vol, media);
    } else if cfg!(target_os = "macos") {
        let mut mute = false;
        let mut vol = 0;
        let output = tokio::process::Command::new("osascript")
            .args(&["-e", "get volume settings"])
            .output().await;

        if let Ok(out) = output {
            let s = String::from_utf8_lossy(&out.stdout);
            // Example: output volume:50, input volume:50, alert volume:50, output muted:false
            if let Some(p) = s.split("output volume:").nth(1) {
                if let Some(val) = p.split(',').next() {
                    vol = val.parse::<u8>().unwrap_or(0);
                }
            }
            mute = s.contains("output muted:true");
        }
        
        // Media info on macOS is tricky via CLI, potentially use 'Now Playing' or specific app scripts
        let media = None; 
        
        return (mute, vol, media);
    }
    (false, 0, None)
}

fn get_server_capabilities() -> Vec<String> {
    let mut caps = vec![
        "terminal".to_string(), 
        "power".to_string(), 
        "system".to_string(),
        "file_manager".to_string(),
    ];
    
    let has_display: bool;

    if cfg!(target_os = "windows") || cfg!(target_os = "macos") {
        caps.push("screen_share".to_string());
        caps.push("touchpad".to_string());
        caps.push("media".to_string());
        caps.push("presentation".to_string());
        caps.push("screenshot".to_string());
        has_display = true; 
    } else {
        // Linux / WSL Check
        let is_wsl = std::env::var("WSL_DISTRO_NAME").is_ok() || 
                     std::fs::read_to_string("/proc/version").map(|s| s.to_lowercase().contains("microsoft")).unwrap_or(false);
        
        has_display = !is_wsl && (std::env::var("DISPLAY").is_ok() || std::env::var("WAYLAND_DISPLAY").is_ok());
        
        if has_display {
            caps.push("screen_share".to_string());
            caps.push("touchpad".to_string());
            caps.push("media".to_string());
            caps.push("presentation".to_string());
            caps.push("screenshot".to_string());
        }
    }

    // Notifications require a GUI session (especially on Windows/macOS)
    if has_display {
        caps.push("notifications".to_string());
    }

    caps
}

async fn get_platform_system_details() -> (Vec<String>, String, bool) {
    let mut gpus = Vec::new();
    let mut net = "Unknown".to_string();
    let mut online = false;

    if cfg!(target_os = "windows") {
        // GPU
        if let Ok(out) = tokio::process::Command::new("powershell").args(&["-Command", "Get-CimInstance Win32_VideoController | % { $_.Name }"]).kill_on_drop(true).output().await {
            gpus = String::from_utf8_lossy(&out.stdout).lines().map(|l| l.trim().to_string()).filter(|l| !l.is_empty()).collect();
        }
        // Net
        if let Ok(out) = tokio::process::Command::new("netsh").args(&["wlan", "show", "interfaces"]).kill_on_drop(true).output().await {
            let s = String::from_utf8_lossy(&out.stdout);
            net = s.lines().find(|l| l.contains(" SSID")).and_then(|l| l.split(':').nth(1)).map(|s| s.trim().to_string()).unwrap_or("Ethernet/Other".to_string());
        }
        // Ping
        online = tokio::process::Command::new("ping").args(&["-n", "1", "google.com"]).kill_on_drop(true).output().await.map(|o| o.status.success()).unwrap_or(false);
    } else if cfg!(target_os = "linux") {
        // GPU (Basic)
        if let Ok(out) = tokio::process::Command::new("sh").args(&["-c", "lspci | grep -i vga | cut -d: -f3"]).kill_on_drop(true).output().await {
            gpus = String::from_utf8_lossy(&out.stdout).lines().map(|l| l.trim().to_string()).filter(|l| !l.is_empty()).collect();
        }
        // Net
        if let Ok(out) = tokio::process::Command::new("sh").args(&["-c", "nmcli -t -f active,ssid dev wifi | grep '^yes' | cut -d: -f2"]).kill_on_drop(true).output().await {
            let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !s.is_empty() { net = s; }
        }
        // Ping
        online = tokio::process::Command::new("ping").args(&["-c", "1", "-W", "2", "google.com"]).kill_on_drop(true).status().await.map(|s| s.success()).unwrap_or(false);
    }

    (gpus, net, online)
}

