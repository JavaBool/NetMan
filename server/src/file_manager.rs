use std::fs::{self, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::Path;
use std::time::UNIX_EPOCH;
use crate::{DriveInfo, FileItem};
use sysinfo::Disks;

pub fn list_drives() -> Vec<DriveInfo> {
    let mut drives = Vec::new();

    // Use sysinfo for logical drives
    let disks = Disks::new_with_refreshed_list();
    for disk in &disks {
        let mut name = disk.name().to_string_lossy().into_owned();
        let mount_point = disk.mount_point().to_string_lossy().into_owned();
        
        if name.is_empty() {
            if mount_point == "/" {
                name = "System Root".to_string();
            } else {
                name = mount_point.clone();
            }
        }

        let total_gb = disk.total_space() as f32 / 1_073_741_824.0;
        let used_gb = (disk.total_space() - disk.available_space()) as f32 / 1_073_741_824.0;
        let drive_type = format!("{:?}", disk.kind());

        drives.push(DriveInfo {
            name,
            mount_point,
            total_gb,
            used_gb,
            drive_type,
        });
    }

    // On Linux/macOS, specifically check /media, /mnt, /Volumes if not already present
    #[cfg(any(target_os = "linux", target_os = "macos"))]
    {
        #[cfg(target_os = "linux")]
        let common_mounts = vec!["/media", "/mnt"];
        #[cfg(target_os = "macos")]
        let common_mounts = vec!["/Volumes"];

        for base in common_mounts {
            if let Ok(entries) = fs::read_dir(base) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.is_dir() {
                        let mount_str = path.to_string_lossy().into_owned();
                        if !drives.iter().any(|d| d.mount_point == mount_str) {
                           drives.push(DriveInfo {
                               name: path.file_name().unwrap_or_default().to_string_lossy().into_owned(),
                               mount_point: mount_str,
                               total_gb: 0.0, // sysinfo handles the actual stats usually, but fallback
                               used_gb: 0.0,
                               drive_type: "Removable/Mount".to_string(),
                           });
                        }
                    }
                }
            }
        }
    }

    drives
}

pub fn list_dir(path_str: &str) -> std::io::Result<Vec<FileItem>> {
    let path = Path::new(path_str);
    let mut items = Vec::new();

    for entry in fs::read_dir(path)? {
        let entry = entry?;
        let metadata = entry.metadata()?;
        let file_name = entry.file_name().to_string_lossy().into_owned();
        
        items.push(FileItem {
            name: file_name,
            is_dir: metadata.is_dir(),
            size: if metadata.is_dir() { 0 } else { metadata.len() },
            modified: metadata.modified()?.duration_since(UNIX_EPOCH).unwrap_or_default().as_secs(),
            extension: entry.path().extension().and_then(|s| s.to_str()).unwrap_or("").to_string(),
        });
    }

    Ok(items)
}

pub fn create_dir(path: &str) -> std::io::Result<()> {
    fs::create_dir_all(path)
}

pub fn create_file(path: &str) -> std::io::Result<()> {
    fs::File::create(path)?;
    Ok(())
}

pub fn rename(old: &str, new: &str) -> std::io::Result<()> {
    fs::rename(old, new)
}

pub fn delete(path: &str, permanent: bool) -> Result<(), String> {
    if permanent {
        let p = Path::new(path);
        if p.is_dir() {
            fs::remove_dir_all(p).map_err(|e| e.to_string())
        } else {
            fs::remove_file(p).map_err(|e| e.to_string())
        }
    } else {
        trash::delete(path).map_err(|e| e.to_string())
    }
}

pub fn read_file(path: &str) -> std::io::Result<String> {
    fs::read_to_string(path)
}

pub fn read_file_chunk(path: &str, offset: u64, size: usize) -> std::io::Result<Vec<u8>> {
    let mut file = fs::File::open(path)?;
    file.seek(SeekFrom::Start(offset))?;
    let mut buffer = vec![0; size];
    let n = file.read(&mut buffer)?;
    buffer.truncate(n);
    Ok(buffer)
}

pub fn write_file(path: &str, content: &str) -> std::io::Result<()> {
    fs::write(path, content)
}

pub fn write_chunk(path: &str, data: &[u8], append: bool) -> std::io::Result<()> {
    let mut file = OpenOptions::new()
        .write(true)
        .create(true)
        .append(append)
        .truncate(!append)
        .open(path)?;
    file.write_all(data)?;
    Ok(())
}

pub fn open_file(path: &str) -> Result<(), String> {
    open::that(path).map_err(|e| e.to_string())
}

pub fn list_folders(path_str: &str) -> std::io::Result<Vec<String>> {
    let path = Path::new(path_str);
    let mut folders = Vec::new();
    for entry in fs::read_dir(path)? {
        let entry = entry?;
        let metadata = entry.metadata()?;
        if metadata.is_dir() {
            folders.push(entry.file_name().to_string_lossy().into_owned());
        }
    }
    folders.sort();
    Ok(folders)
}

pub fn list_root_folders() -> Vec<String> {
    #[cfg(target_os = "windows")]
    {
        list_drives().into_iter().map(|d| d.mount_point).collect()
    }
    #[cfg(not(target_os = "windows"))]
    {
        vec!["/".to_string()]
    }
}

pub fn validate_path(path_str: &str) -> (bool, bool) {
    let path = Path::new(path_str);
    (path.exists(), path.is_dir())
}

pub fn move_item(src: &str, dest: &str) -> Result<(), String> {
    let src_path = Path::new(src);
    let file_name = src_path.file_name()
        .ok_or_else(|| "Invalid source path".to_string())?;
    let dest_path = Path::new(dest).join(file_name);
    fs::rename(src_path, &dest_path).map_err(|e| e.to_string())
}

pub fn copy_item(src: &str, dest: &str) -> Result<(), String> {
    let src_path = Path::new(src);
    let file_name = src_path.file_name()
        .ok_or_else(|| "Invalid source path".to_string())?;
    let dest_path = Path::new(dest).join(file_name);
    if src_path.is_dir() {
        copy_dir_recursive(src_path, &dest_path).map_err(|e| e.to_string())
    } else {
        fs::copy(src_path, &dest_path).map(|_| ()).map_err(|e| e.to_string())
    }
}

fn copy_dir_recursive(src: &Path, dest: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dest)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let src_child = entry.path();
        let dest_child = dest.join(entry.file_name());
        if file_type.is_dir() {
            copy_dir_recursive(&src_child, &dest_child)?;
        } else {
            fs::copy(&src_child, &dest_child)?;
        }
    }
    Ok(())
}

pub fn get_home_dir() -> String {
    #[cfg(target_os = "windows")]
    {
        std::env::var("USERPROFILE").unwrap_or_else(|_| "C:\\".to_string())
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::env::var("HOME").unwrap_or_else(|_| "/".to_string())
    }
}
