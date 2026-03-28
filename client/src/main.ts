import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { invoke } from '@tauri-apps/api/core';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
const urlParams = new URLSearchParams(window.location.search);
const mode = urlParams.get('mode');

if (mode === 'remote') {
  initRemoteView();
} else {
  initLauncherView();
}

/** MODERN ALERT SYSTEM **/
function showAlert(message: string, title: string = 'Notification', onOk?: () => void) {
  const modal = document.getElementById('alert-modal')!;
  document.getElementById('alert-title')!.textContent = title;
  document.getElementById('alert-message')!.textContent = message;
  const actions = modal.querySelector('.modal-actions')!;
  actions.innerHTML = '<button id="btn-alert-ok" class="primary-btn flex-1">OK</button>';
  (document.getElementById('btn-alert-ok') as HTMLButtonElement).onclick = () => {
    modal.classList.remove('active');
    if (onOk) onOk();
  };
  modal.classList.add('active');
  console.log(`[ALERT] Showing: ${title} - ${message}`);
}

function showConfirm(message: string, onConfirm: () => void, title: string = 'Confirm Action') {
  const modal = document.getElementById('alert-modal')!;
  document.getElementById('alert-title')!.textContent = title;
  document.getElementById('alert-message')!.textContent = message;
  const actions = modal.querySelector('.modal-actions')!;
  actions.innerHTML = `
    <button id="btn-alert-cancel" class="secondary-btn flex-1">Cancel</button>
    <button id="btn-alert-confirm" class="primary-btn flex-1">Confirm</button>
  `;
  (document.getElementById('btn-alert-cancel') as HTMLButtonElement).onclick = () => modal.classList.remove('active');
  (document.getElementById('btn-alert-confirm') as HTMLButtonElement).onclick = () => {
    modal.classList.remove('active');
    onConfirm();
  };
  modal.classList.add('active');
}

// ==========================================
// LAUNCHER MANAGER (PRISM STYLE)
// ==========================================
function initLauncherView() {
  document.getElementById('launcher-view')?.classList.add('active');
  
  const instanceGrid = document.getElementById('instance-grid')!;
  const addModal = document.getElementById('add-modal')!;
  const connectModal = document.getElementById('connect-modal')!;
  
  // Add Modal Elements
  document.getElementById('btn-add-instance')!.onclick = () => addModal.classList.add('active');
  document.getElementById('btn-cancel-add')!.onclick = () => addModal.classList.remove('active');
  
  // Connect Modal Elements
  document.getElementById('btn-cancel-connect')!.onclick = () => connectModal.classList.remove('active');
  
  interface SavedInstance { id: string; name: string; ip: string; port?: string; }
  
  let activeConnectInstance: SavedInstance | null = null;
  let editingInstanceId: string | null = null;
  
  // Add Modal Entry
  document.getElementById('btn-add-instance')!.onclick = () => {
    editingInstanceId = null;
    document.getElementById('add-modal')!.querySelector('h2')!.textContent = 'Add New Server';
    (document.getElementById('new-inst-name') as HTMLInputElement).value = '';
    (document.getElementById('new-inst-ip') as HTMLInputElement).value = '';
    (document.getElementById('new-inst-port') as HTMLInputElement).value = '8082';
    document.getElementById('btn-delete-inst')!.style.display = 'none';
    addModal.classList.add('active');
  };

  function openEditModal(inst: SavedInstance) {
    editingInstanceId = inst.id;
    document.getElementById('add-modal')!.querySelector('h2')!.textContent = 'Edit Server';
    (document.getElementById('new-inst-name') as HTMLInputElement).value = inst.name;
    (document.getElementById('new-inst-ip') as HTMLInputElement).value = inst.ip;
    (document.getElementById('new-inst-port') as HTMLInputElement).value = inst.port || '8082';
    document.getElementById('btn-delete-inst')!.style.display = 'block';
    addModal.classList.add('active');
  }
  
  function getInstances(): SavedInstance[] {
    const saved = localStorage.getItem('netman_instances');
    return saved ? JSON.parse(saved) : [];
  }
  
  // Handle Add/Edit Save
  document.getElementById('btn-save-inst')!.onclick = () => {
    const name = (document.getElementById('new-inst-name') as HTMLInputElement).value.trim();
    const ip = (document.getElementById('new-inst-ip') as HTMLInputElement).value.trim();
    const port = (document.getElementById('new-inst-port') as HTMLInputElement).value.trim();
    if (!name || !ip || !port) return showAlert('Name, IP, and Port are required', 'Validation Error');
    
    let insts = getInstances();
    if (editingInstanceId) {
      const idx = insts.findIndex(i => i.id === editingInstanceId);
      if (idx >= 0) insts[idx] = { ...insts[idx], name, ip, port };
    } else {
      insts.push({ id: `inst_${Date.now()}`, name, ip, port });
    }
    
    localStorage.setItem('netman_instances', JSON.stringify(insts));
    addModal.classList.remove('active');
    renderInstances();
  };

  // Handle Delete
  document.getElementById('btn-delete-inst')!.onclick = () => {
    if (!editingInstanceId) return;
    showConfirm('Are you sure you want to permanently delete this instance?', () => {
      let insts = getInstances();
      insts = insts.filter(i => i.id !== editingInstanceId);
      localStorage.setItem('netman_instances', JSON.stringify(insts));
      addModal.classList.remove('active');
      renderInstances();
    }, 'Delete Server');
  };

  // Render Grid
  function renderInstances() {
    instanceGrid.innerHTML = '';
    const insts = getInstances();
    insts.forEach(inst => {
      const card = document.createElement('div');
      card.className = 'instance-card';
      card.innerHTML = `
        <button class="card-edit-btn" title="Edit Instance">⚙️</button>
        <div class="inst-icon">
           <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"></rect><rect x="2" y="14" width="20" height="8" rx="2" ry="2"></rect><line x1="6" y1="6" x2="6.01" y2="6"></line><line x1="6" y1="18" x2="6.01" y2="18"></line></svg>
        </div>
        <div class="inst-name">${inst.name}</div>
        <div class="inst-ip">${inst.ip}:${inst.port || '8082'}</div>
      `;
      card.querySelector('.card-edit-btn')!.addEventListener('click', (e) => {
         e.stopPropagation();
         openEditModal(inst);
      });
      card.onclick = () => {
         activeConnectInstance = inst;
         document.getElementById('connect-inst-name')!.textContent = inst.name;
         document.getElementById('connect-inst-ip')!.textContent = `${inst.ip}:${inst.port || '8082'}`;
         // Note: Password field remains empty!
         connectModal.classList.add('active');
      };
      instanceGrid.appendChild(card);
    });
  }

  // Handle Connect Launch
  document.getElementById('btn-launch-inst')!.onclick = async () => {
    if (!activeConnectInstance) return;
    const launchBtn = document.getElementById('btn-launch-inst') as HTMLButtonElement;
    const user = (document.getElementById('connect-user') as HTMLInputElement).value.trim();
    const pass = (document.getElementById('connect-pass') as HTMLInputElement).value.trim();
    
    if (!user || !pass) return showAlert('Please enter credentials to connect.', 'Credentials Missing');
    
    launchBtn.disabled = true;
    launchBtn.textContent = 'Authenticating...';

    const fullIp = `${activeConnectInstance.ip}:${activeConnectInstance.port || '8082'}`;
    
    // PRE-AUTH CHECK
    let preAuthSocket: WebSocket | null = null;
    try {
      preAuthSocket = new WebSocket(`ws://${fullIp}`);
      
      const timeout = setTimeout(() => {
        if (preAuthSocket) preAuthSocket.close();
        showAlert('Connection timed out. Check if server is running.', 'Connection Error');
        launchBtn.disabled = false;
        launchBtn.textContent = 'Connect Instance';
      }, 5000);

      preAuthSocket.onopen = () => {
        preAuthSocket?.send(JSON.stringify({ type: 'Auth', username: user, password: pass }));
      };

      preAuthSocket.onmessage = (event) => {
        clearTimeout(timeout);
        const data = JSON.parse(event.data);
        if (data.type === 'AuthResult') {
          preAuthSocket?.close();
          if (data.success) {
            // AUTH SUCCESS -> PROCEED TO LAUNCH
            if (isMobile) {
              connectModal.classList.remove('active');
              document.getElementById('launcher-view')?.classList.remove('active');
              initRemoteView(fullIp, user, pass, activeConnectInstance?.name);
            } else {
              const url = `index.html?mode=remote&ip=${encodeURIComponent(fullIp)}&user=${encodeURIComponent(user)}&pass=${encodeURIComponent(pass)}&name=${encodeURIComponent(activeConnectInstance?.name || '')}`;
              const webview = new WebviewWindow(`remote-${activeConnectInstance?.id}-${Date.now()}`, {
                url,
                title: `NetMan - ${activeConnectInstance?.name}`,
                width: 450,
                height: 800,
                center: true
              });
              webview.once('tauri://error', (_) => {
                showAlert('Tauri Window Error. Fallback running in-place.', 'Launch Error', () => { window.location.href = url; });
              });
              (document.getElementById('connect-pass') as HTMLInputElement).value = '';
              connectModal.classList.remove('active');
            }
          } else {
            // AUTH FAILURE -> STAY IN LAUNCHER
            showAlert(`Authentication failed: ${data.message}`, 'Auth Error');
          }
          launchBtn.disabled = false;
          launchBtn.textContent = 'Connect Instance';
        }
      };

      preAuthSocket.onerror = () => {
        clearTimeout(timeout);
        showAlert('Failed to connect to server. Check IP and Port.', 'Connection Error');
        launchBtn.disabled = false;
        launchBtn.textContent = 'Connect Instance';
      };

    } catch (_) {
      showAlert('Invalid connection URL or socket error.', 'Error');
      launchBtn.disabled = false;
      launchBtn.textContent = 'Connect Instance';
    }
  };

  renderInstances();
}


// REMOTE CONNECTION (INDIVIDUAL WINDOW OR SPA)
// ==========================================
function initRemoteView(ip_p?: string, user_p?: string, pass_p?: string, name_p?: string) {
  document.getElementById('launcher-view')?.classList.remove('active');
  document.getElementById('remote-view')?.classList.add('active');
  
  const ip = ip_p || urlParams.get('ip')!;
  const user = user_p || urlParams.get('user')!;
  const pass = pass_p || urlParams.get('pass')!;
  const name = name_p || urlParams.get('name') || ip;

  if (isMobile) {
    const backBtn = document.getElementById('btn-back-menu') as HTMLButtonElement;
    backBtn.style.display = 'block';
    backBtn.onclick = () => {
      // socket is in parent scope
      // @ts-ignore
      if (socket) socket.close();
      document.getElementById('remote-view')?.classList.remove('active');
      document.getElementById('launcher-view')?.classList.add('active');
      // Reset state 
      // @ts-ignore
      isTerminalStarted = false;
      // @ts-ignore
      isTerminalV2Started = false;
      
      // Default reset
      document.querySelectorAll('.tab-pane').forEach(t => t.classList.remove('active'));
      document.getElementById('tab-system')?.classList.add('active');
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      document.querySelector('[data-target="tab-system"]')?.classList.add('active');
    };
  }
  
  if (name) {
    document.getElementById('remote-title')!.textContent = `Remote: ${name}`;
    document.title = `NetMan - ${name}`;
  }

  // Logic
  let socket: WebSocket | null = null;
  let sessionToken: string | null = null;
  let isTerminalStarted = false;
  let isTerminalV2Started = false;
  let isDisconnected = false;
  let isUserAdjustingVolume = false;
  let rawProcesses: any[] = [];
  let rawServices: any[] = [];
  let processSortCol = 'cpu';
  let processSortDir: 'asc' | 'desc' = 'desc';
  let serviceSortCol = 'name';
  let serviceSortDir: 'asc' | 'desc' = 'asc';
  let processFilter = 'all';
  let serviceFilter = 'all';
  
  // File Manager State
  let currentFmPath = "";
  let fmFiles: any[] = [];
  let fmSortCol = 'name';
  let fmSortDir: 'asc' | 'desc' = 'asc';
  let fmSearchQuery = '';
  let pickerPath = '';
  let pickerPathHistory: string[] = [];
  let pendingPickerAction: 'move' | 'copy' | null = null;
  let pathHistory: string[] = [];
  let isWindowsHost = false;
  let selectedItems: Set<string> = new Set(); // multi-select state

  interface Settings {
    downloadPath: string;
    askDownloadPath: boolean;
  }

  let appSettings: Settings = {
    downloadPath: '',
    askDownloadPath: true
  };

  function loadSettings() {
    const saved = localStorage.getItem('netman_settings');
    if (saved) {
      try {
        appSettings = { ...appSettings, ...JSON.parse(saved) };
      } catch (e) { console.error('Failed to parse settings', e); }
    }
    // Update UI if elements exist
    const pathInput = document.getElementById('setting-download-path') as HTMLInputElement;
    const askCheck = document.getElementById('setting-ask-download') as HTMLInputElement;
    if (pathInput) pathInput.value = appSettings.downloadPath;
    if (askCheck) askCheck.checked = appSettings.askDownloadPath;
  }

  function saveSettings() {
    const pathInput = document.getElementById('setting-download-path') as HTMLInputElement;
    const askCheck = document.getElementById('setting-ask-download') as HTMLInputElement;
    if (pathInput && askCheck) {
      appSettings.downloadPath = pathInput.value.trim();
      appSettings.askDownloadPath = askCheck.checked;
      localStorage.setItem('netman_settings', JSON.stringify(appSettings));
      showAlert('Settings saved successfully.', 'Success');
    }
  }

  interface TransferInfo {
    id: string;
    name: string;
    progress: number;
    status: 'uploading' | 'downloading' | 'done' | 'error';
    type: 'upload' | 'download';
    error?: string;
    chunks?: Uint8Array[]; // For downloads
    localPath?: string;   // For native downloads
  }
  const activeTransfers: Map<string, TransferInfo> = new Map();

  function renderTransferList() {
    const uploadList = document.getElementById('fm-upload-list');
    const downloadList = document.getElementById('fm-download-list');
    if (!uploadList || !downloadList) return;

    const transfers = Array.from(activeTransfers.values()).reverse();
    const uploads = transfers.filter(t => t.type === 'upload');
    const downloads = transfers.filter(t => t.type === 'download');

    const renderItems = (items: TransferInfo[]) => {
      if (items.length === 0) {
        return `<div class="picker-empty" style="padding: 1rem; font-size: 0.8rem;">No active transfers</div>`;
      }
      return items.map(transfer => `
        <div class="upload-item ${transfer.status}" data-id="${transfer.id}">
          <button class="upload-clear-btn" title="Clear transfer">&times;</button>
          <div class="upload-info">
            <span class="upload-name" title="${transfer.name}">${transfer.name}</span>
            <span class="upload-pct">${transfer.status === 'error' ? 'Error' : transfer.progress + '%'}</span>
          </div>
          <div class="upload-progress-container">
            <div class="upload-progress-bar" style="width: ${transfer.progress}%"></div>
          </div>
          ${transfer.error ? `<div style="font-size:0.7rem; color:var(--danger); margin-top:4px;">${transfer.error}</div>` : ''}
        </div>
      `).join('');
    };

    uploadList.innerHTML = renderItems(uploads);
    downloadList.innerHTML = renderItems(downloads);

    // Wire clear buttons for both
    [uploadList, downloadList].forEach(list => {
      list.querySelectorAll('.upload-clear-btn').forEach(btn => {
        (btn as HTMLElement).onclick = (e: MouseEvent) => {
          const item = (e.target as HTMLElement).closest('.upload-item') as HTMLElement;
          const id = item.dataset.id;
          if (id) {
            activeTransfers.delete(id);
            renderTransferList();
          }
        };
      });
    });
  }

  async function startUpload(file: File) {
    if (!currentFmPath) return showAlert("Please navigate to a folder first.", "Upload Error");
    
    const id = `up_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    const info: TransferInfo = { id, name: file.name, progress: 0, status: 'uploading', type: 'upload' };
    activeTransfers.set(id, info);
    renderTransferList();

    const CHUNK_SIZE = 256 * 1024; // 256KB chunks
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

    try {
      for (let i = 0; i < totalChunks; i++) {
        // If upload was cleared by user manually from UI
        if (!activeTransfers.has(id)) return;

        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, file.size);
        const chunk = file.slice(start, end);

        // Convert chunk to base64
        const buffer = await chunk.arrayBuffer();
        let binary = '';
        const bytes = new Uint8Array(buffer);
        for (let j = 0; j < bytes.byteLength; j++) {
            binary += String.fromCharCode(bytes[j]);
        }
        const base64 = window.btoa(binary);

        sendCommand({
          type: 'UploadChunk',
          id,
          path: joinPath(currentFmPath, file.name),
          data_base64: base64,
          append: i > 0
        });

        // Wait for server acknowledgment
        await new Promise<void>((resolve, reject) => {
          const handler = (e: any) => {
            const data = e.detail;
            if (data.type === 'UploadStatus' && data.id === id) {
              window.removeEventListener('fm_upload_ack', handler);
              if (data.success) {
                info.progress = Math.round(((i + 1) / totalChunks) * 100);
                renderTransferList();
                resolve();
              } else {
                reject(new Error(data.message));
              }
            }
          };
          window.addEventListener('fm_upload_ack', handler);
          // 30s timeout per chunk
          setTimeout(() => {
            window.removeEventListener('fm_upload_ack', handler);
            reject(new Error("Timeout waiting for server acknowledgment"));
          }, 30000);
        });
      }

      info.status = 'done';
      info.progress = 100;
      renderTransferList();
      // Auto-refresh file list after successful upload
      setTimeout(() => sendCommand({ type: 'ListDir', path: currentFmPath }), 500);

    } catch (err: any) {
      console.error('[UPLOAD] Error:', err);
      info.status = 'error';
      info.error = err.message || "Upload failed";
      renderTransferList();
    }
  }

  async function handleDownload(remotePath: string) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    const filename = remotePath.split('\\').pop()?.split('/').pop() || 'downloaded_file';
    
    let localPath = '';
    
    try {
      if (appSettings.askDownloadPath) {
        // Native Save Dialog
        localPath = await invoke('pick_save_path', { defaultName: filename });
      } else {
        // Use default folder
        if (!appSettings.downloadPath) {
          showAlert('Please set a Default Download Path in Settings or enable "Always Ask".', 'Download Path Required');
          // Switch to settings tab automatically?
          document.getElementById('nav-settings')?.click();
          return;
        }
        // Normalize path and join with filename
        const sep = appSettings.downloadPath.includes('\\') ? '\\' : '/';
        localPath = appSettings.downloadPath.endsWith(sep) 
          ? appSettings.downloadPath + filename 
          : appSettings.downloadPath + sep + filename;
      }
    } catch (e) {
      console.log('Download path selection cancelled or failed', e);
      return;
    }

    if (!localPath) return;

    const id = `dl_${Date.now()}`;
    activeTransfers.set(id, {
      id,
      name: filename,
      progress: 0,
      status: 'downloading',
      type: 'download',
      localPath // Store for streaming write
    });

    sendCommand({
      type: 'DownloadRequest',
      id,
      path: remotePath
    });

    renderTransferList();
  }

  // Helper: join two path segments platform-correctly
  function joinPath(base: string, name: string): string {
    if (!base) return name;
    const sep = isWindowsHost ? '\\' : '/';
    const trimmed = base.replace(/[\\/]+$/, '');
    return `${trimmed}${sep}${name}`;
  }
  
  // Navigation
  const navBtns = document.querySelectorAll('.nav-btn');
  console.log(`[CLIENT] Initializing navigation for ${navBtns.length} buttons.`);
  navBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-target');
      if (!targetId) return;

      // Switch active tab
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      document.querySelectorAll('.tab-pane').forEach(tab => tab.classList.remove('active'));
      document.getElementById(targetId)?.classList.add('active');

      // Update title
      const title = document.getElementById('remote-title');
      if (title) title.textContent = btn.textContent?.trim() || 'NetMan Remote';

      // Auto-close sidebar on mobile
      if (window.innerWidth <= 900) {
        document.getElementById('sidebar')?.classList.remove('active');
        document.getElementById('sidebar-overlay')?.classList.remove('active');
      }

      if (targetId === 'tab-screen') {
        sendCommand({ type: 'StartScreenShare' });
      } else {
        sendCommand({ type: 'StopScreenShare' });
      }

      if (targetId === 'tab-terminal' && !isTerminalStarted) {
        sendCommand({ type: 'StartTerminal' });
        isTerminalStarted = true;
      }
      
      if (targetId === 'tab-terminal-v2' && !isTerminalV2Started) {
        sendCommand({ type: 'StartTerminalV2' });
        isTerminalV2Started = true;
        setTimeout(() => fitAddon?.fit(), 50);
      } else if (targetId === 'tab-terminal-v2') {
        setTimeout(() => fitAddon?.fit(), 50);
      }

      if (targetId === 'tab-processes') {
        sendCommand({ type: 'ListProcesses' });
      }
      if (targetId === 'tab-services') {
        sendCommand({ type: 'ListServices' });
      }

      // Special logic for File Manager initial load
      if (targetId === 'tab-files') {
        console.log('[CLIENT] Activating File Manager tab...');
        sendCommand({ type: 'ListDrives' });
        if (!currentFmPath) {
          console.log('[CLIENT] currentFmPath is empty, requesting HOME...');
          // Stagger to avoid dedup guard (50ms window)
          setTimeout(() => sendCommand({ type: 'ListDir', path: "" }), 100);
        }
      }
    });
  });

  // Refresh Buttons
  document.getElementById('btn-refresh-processes')?.addEventListener('click', () => sendCommand({ type: 'ListProcesses' }));
  document.getElementById('btn-refresh-services')?.addEventListener('click', () => sendCommand({ type: 'ListServices' }));

  // Search & Filter Inputs
  document.getElementById('process-search')?.addEventListener('input', (e) => {
    renderProcessList(rawProcesses, (e.target as HTMLInputElement).value.toLowerCase());
  });

  document.getElementById('service-search')?.addEventListener('input', (e) => {
    renderServiceList(rawServices, (e.target as HTMLInputElement).value.toLowerCase());
  });

  document.getElementById('process-filter')?.addEventListener('change', (e) => {
    processFilter = (e.target as HTMLSelectElement).value;
    const search = (document.getElementById('process-search') as HTMLInputElement).value.toLowerCase();
    renderProcessList(rawProcesses, search);
  });

  document.getElementById('service-filter')?.addEventListener('change', (e) => {
    serviceFilter = (e.target as HTMLSelectElement).value;
    const search = (document.getElementById('service-search') as HTMLInputElement).value.toLowerCase();
    renderServiceList(rawServices, search);
  });

  // Sorting Listeners
  document.querySelectorAll('th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.getAttribute('data-sort')!;
      const table = th.getAttribute('data-table')!;
      
      if (table === 'process') {
        if (processSortCol === col) {
          processSortDir = processSortDir === 'asc' ? 'desc' : 'asc';
        } else {
          processSortCol = col;
          processSortDir = 'desc'; // Default to desc for new columns (often more useful)
        }
        const search = (document.getElementById('process-search') as HTMLInputElement).value.toLowerCase();
        renderProcessList(rawProcesses, search);
      } else {
        if (serviceSortCol === col) {
          serviceSortDir = serviceSortDir === 'asc' ? 'desc' : 'asc';
        } else {
          serviceSortCol = col;
          serviceSortDir = 'asc'; // Default to asc for services (alphabetical)
        }
        const search = (document.getElementById('service-search') as HTMLInputElement).value.toLowerCase();
        renderServiceList(rawServices, search);
      }
    });
  });

  // Sidebar Toggles
  const menuToggle = document.getElementById('btn-menu-toggle');
  const closeSidebar = document.getElementById('btn-close-sidebar');
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');

  const toggleSidebar = () => {
    sidebar?.classList.toggle('active');
    overlay?.classList.toggle('active');
  };

  menuToggle?.addEventListener('click', toggleSidebar);
  closeSidebar?.addEventListener('click', toggleSidebar);
  overlay?.addEventListener('click', toggleSidebar);

  // Power Commands Hook
  document.querySelectorAll('.power-btn').forEach(btn => {
    (btn as HTMLElement).onclick = () => {
      const action = (btn as HTMLElement).getAttribute('data-action');
      if (action) {
        showConfirm(`Execute ${action.replace(/_/g, ' ').toUpperCase()} on remote host?`, () => {
            sendCommand({ type: 'PowerAction', action });
        }, 'Remote Power Action');
      }
    };
  });

  let xterm: Terminal | null = null;
  let fitAddon: FitAddon | null = null;

  let lastMessageTimes = new Map<string, number>();

  function sendCommand(msg: any) {
    if (isDisconnected) return;
    if (socket && socket.readyState === WebSocket.OPEN && sessionToken) {
      // Basic rate limiting for identical messages (prevent loops)
      const msgKey = JSON.stringify(msg);
      const now = Date.now();
      if (now - (lastMessageTimes.get(msgKey) || 0) < 50) return;
      lastMessageTimes.set(msgKey, now);

      console.log(`[CLIENT] Sending:`, msg);
      socket.send(JSON.stringify({ token: sessionToken, ...msg }));
    }
  }

  // Auto-connect
  try {
    socket = new WebSocket(`ws://${ip}`);

    socket.onopen = () => {
      socket?.send(JSON.stringify({ type: 'Auth', username: user, password: pass }));
    };

    socket.onmessage = async (event: MessageEvent) => {
      if (typeof event.data === 'string') {
        const data = JSON.parse(event.data);
        if (data.type === 'AuthResult') {
          if (data.success) {
            sessionToken = data.token;
            isWindowsHost = data.os === 'windows';
            // Set dynamic power tab contents based on detected OS
            if (data.os === 'windows') {
              document.getElementById('power-windows')!.style.display = 'flex';
            } else if (data.os === 'linux') {
              document.getElementById('power-linux')!.style.display = 'flex';
            }

            // Apply Server Capabilities
            if (data.capabilities) {
              const caps = data.capabilities as string[];
              const navMap: {[key: string]: string} = {
                'touchpad': 'nav-touchpad',
                'media': 'nav-media',
                'screen_share': 'nav-screen',
                'presentation': 'nav-presentation',
                'screenshot': 'btn-screenshot',
                'file_manager': 'nav-files'
              };

              Object.entries(navMap).forEach(([cap, id]) => {
                const el = document.getElementById(id);
                if (el) {
                  el.style.display = caps.includes(cap) ? (el.tagName === 'BUTTON' ? 'flex' : 'block') : 'none';
                }
              });

              // Also handle the presentation section specifically since it's inside media
              const presSection = document.querySelector('.presentation-section') as HTMLElement;
              if (presSection) {
                presSection.style.display = caps.includes('presentation') ? 'block' : 'none';
              }
            }

            // Activate default tab
            document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-pane').forEach(t => t.classList.remove('active'));
            document.querySelector('[data-target="tab-system"]')?.classList.add('active');
            document.getElementById('tab-system')?.classList.add('active');
          } else {
            // This should rarely happen now due to Pre-Auth check
            showAlert(`Authentication failed: ${data.message}`, 'Auth Error', () => {
                if (isMobile) {
                   (document.getElementById('btn-back-menu') as HTMLButtonElement).click();
                } else {
                   window.close();
                }
            });
          }
        } else if (data.type === 'UploadStatus') {
           // Dispatch event for startUpload handlers
           window.dispatchEvent(new CustomEvent('fm_upload_ack', { detail: data }));
        } else if (data.type === 'DownloadChunk') {
             const info = activeTransfers.get(data.id);
             if (!info) return;

             if (info.localPath) {
               // Stream write to local disk via Tauri
               try {
                 await invoke('append_file_binary', { 
                   path: info.localPath, 
                   dataBase64: data.data_base64 
                 });
                 
                 // Update progress
                 info.progress = Math.min(99, info.progress + 5); // Estimate if server doesn't provide %
                 if (data.is_last) {
                    info.progress = 100;
                    info.status = 'done';
                    showAlert(`Download complete: ${info.name}`, 'Success');
                 }
               } catch (err) {
                 info.status = 'error';
                 info.error = 'Failed to write to disk: ' + err;
               }
             } else {
               // Fallback to legacy Blob accumulation if no localPath (unlikely now)
               if (!info.chunks) info.chunks = [];
               const binaryString = atob(data.data_base64);
               const bytes = new Uint8Array(binaryString.length);
               for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
               info.chunks.push(bytes);

               if (data.is_last) {
                 const blob = new Blob(info.chunks as any[]);
                 const url = URL.createObjectURL(blob);
                 const a = document.createElement('a');
                 a.href = url;
                 a.download = info.name;
                 document.body.appendChild(a);
                 a.click();
                 document.body.removeChild(a);
                 URL.revokeObjectURL(url);

                 info.progress = 100;
                 info.status = 'done';
               } else {
                 info.progress = Math.min(99, Math.floor(info.progress + 5));
               }
             }
             renderTransferList();
        } else if (data.type === 'ProcessList') {
          const search = (document.getElementById('process-search') as HTMLInputElement).value.toLowerCase();
          renderProcessList(data.processes, search);
        } else if (data.type === 'ServiceList') {
          const search = (document.getElementById('service-search') as HTMLInputElement).value.toLowerCase();
          renderServiceList(data.services, search);
        } else if (data.type === 'ScreenFrame') {
          const screenLoading = document.getElementById('screen-loading')!;
          const screenImg = document.getElementById('screen-img') as HTMLImageElement;
          screenLoading.style.display = 'none';
          screenImg.style.display = 'block';
          screenImg.src = `data:image/jpeg;base64,${data.frame_base64}`;
        } else if (data.type === 'TerminalOutput') {
          const terminalOutput = document.getElementById('terminal-output')!;
          if (data.output.includes('\f') || data.output.includes('\x1b[2J') || data.output.includes('\x1bc')) {
             terminalOutput.textContent = '';
             const parsed = data.output.split(/\f|\x1b\[2J|\x1bc/).pop();
             if (parsed) terminalOutput.textContent = parsed;
          } else {
             terminalOutput.textContent += data.output;
          }
          terminalOutput.scrollTop = terminalOutput.scrollHeight;
        } else if (data.type === 'TerminalV2Output') {
          xterm?.write(data.output);
        } else if (data.type === 'TerminalCwd') {
          const cwdEl = document.getElementById('terminal-cwd');
          if (cwdEl) {
            cwdEl.textContent = data.path;
            cwdEl.style.display = 'block';
          }
        } else if (data.type === 'AudioState') {
          console.log(`[CLIENT] Audio State Received: Mute=${data.mute}, Vol=${data.volume}%, Media=${data.media_title}`);
          const volLevel = document.getElementById('vol-level');
          const muteIcon = document.getElementById('mute-icon');
          const volSlider = document.getElementById('vol-slider') as HTMLInputElement;
          const mediaTitle = document.getElementById('media-title');
          const mediaSource = document.getElementById('media-source');
          
          if (volLevel) {
            volLevel.textContent = `${data.volume}%`;
            if (data.mute) volLevel.style.color = '#ff4757';
            else volLevel.style.color = '#2ed573';
          }

          if (volSlider && !isUserAdjustingVolume) {
             volSlider.value = data.volume.toString();
          }

          if (mediaTitle && mediaSource) {
            if (data.media_title) {
              const parts = data.media_title.split(': ');
              mediaSource.textContent = parts[0] || '';
              mediaTitle.textContent = parts[1] || data.media_title;
            } else {
              mediaSource.textContent = '';
              mediaTitle.textContent = 'No Media Playing';
            }
          }
          
          if (muteIcon) {
            if (data.mute) {
               muteIcon.innerHTML = `<path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>`;
            } else {
               muteIcon.innerHTML = `<path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>`;
            }
          }
        } else if (data.type === 'SystemInfo') {
          // Stats
          const avgCpu = Math.round(data.cpu_usage.reduce((a:number, b:number) => a + b, 0) / data.cpu_usage.length);
          document.getElementById('cpu-stat')!.textContent = `${avgCpu}%`;
          document.getElementById('cpu-bar')!.style.width = `${avgCpu}%`;
          document.getElementById('cpu-temp')!.textContent = `Temp: ${data.cpu_temp.toFixed(1)}°C`;

          const ramPct = Math.round((data.ram_used_gb / data.ram_total_gb) * 100);
          document.getElementById('ram-stat')!.textContent = `${data.ram_used_gb.toFixed(1)} / ${data.ram_total_gb.toFixed(1)} GB`;
          document.getElementById('ram-bar')!.style.width = `${ramPct}%`;
          document.getElementById('ram-detail')!.textContent = `${ramPct}% used`;

          document.getElementById('disk-stat')!.textContent = `${data.disk_usage_pct}%`;
          document.getElementById('disk-bar')!.style.width = `${data.disk_usage_pct}%`;

          // Info
          const osName = data.os_name.toLowerCase();
          document.getElementById('hostname-info')!.textContent = data.hostname;
          document.getElementById('local-ip-info')!.textContent = data.local_ip;
          document.getElementById('os-info')!.textContent = `${data.os_name} ${data.os_version}`;
          document.getElementById('net-info')!.textContent = data.network_name;
          
          // Toggle Power Containers based on OS
          const winPower = document.getElementById('power-windows');
          const linuxPower = document.getElementById('power-linux');
          if (osName.includes('windows')) {
            if (winPower) winPower.style.display = 'flex';
            if (linuxPower) linuxPower.style.display = 'none';
          } else {
            if (winPower) winPower.style.display = 'none';
            if (linuxPower) linuxPower.style.display = 'flex';
          }

          const internet = document.getElementById('internet-status')!;
          if (data.internet_online) {
            internet.textContent = 'Connected (Online)';
            internet.classList.add('status-online');
          } else {
            internet.textContent = 'No Internet Access';
            internet.classList.remove('status-online');
          }

          // Network Speeds
          const rxMsg = data.net_rx_kbps > 1024 ? (data.net_rx_kbps / 1024).toFixed(2) + ' MB/s' : data.net_rx_kbps.toFixed(1) + ' KB/s';
          const txMsg = data.net_tx_kbps > 1024 ? (data.net_tx_kbps / 1024).toFixed(2) + ' MB/s' : data.net_tx_kbps.toFixed(1) + ' KB/s';
          document.getElementById('net-rx')!.textContent = rxMsg;
          document.getElementById('net-tx')!.textContent = txMsg;

          // Lists
          const gpuList = document.getElementById('gpu-list')!;
          gpuList.innerHTML = data.gpus.length > 0 ? data.gpus.join('<br>') : 'No GPUs detected';
        } else if (data.type === 'Screenshot') {
          const btn = document.getElementById('btn-screenshot') as HTMLButtonElement;
          btn.disabled = false;
          btn.innerHTML = `
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle; margin-right: 6px;"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>
              Take Screenshot
          `;
          
          const parts = ip.split(':');
          const host = parts[0];
          const port_v = parts[1] || '8082';

          invoke('save_screenshot', {
            name: name,
            ip: host,
            port: port_v,
            imageBase64: data.image_base64
          }).then((path: any) => {
             showAlert(`Screenshot captured and opened!\nFolder: Pictures/NetMan/${name}\nFile: ${path.split(/[\\/]/).pop()}`, 'Screenshot Saved');
          }).catch((err: any) => {
             showAlert(`Failed to save or open screenshot: ${err}`, 'Error');
          });
        } else if (data.type === 'ClipboardContents') {
           const text = data.text;
           navigator.clipboard.writeText(text).then(() => {
              showAlert('Remote clipboard fetched and copied to local!', 'Clipboard Sync');
           }).catch(err => {
              showAlert(`Failed to copy to local clipboard: ${err}`, 'Error');
           });
        } else if (data.type === 'DriveList') {
           console.log('[CLIENT] Received DriveList:', data.drives.length, 'drives');
           renderDriveList(data.drives);
        } else if (data.type === 'DirList') {
           console.log('[CLIENT] Received DirList for:', data.path, 'Items:', data.items.length);
           currentFmPath = data.path;
           const input = document.getElementById('fm-path-input') as HTMLInputElement;
           if (input) input.value = data.path;
           renderFileList(data.items);
         } else if (data.type === 'FolderList') {
           (window as any).renderPickerFolders?.(data.path, data.folders);
         } else if (data.type === 'FileContent') {
           const editor = document.getElementById('modal-file-editor');
           const textarea = document.getElementById('file-editor-textarea') as HTMLTextAreaElement;
           const filename = document.getElementById('editor-filename');
           if (editor && textarea && filename) {
             filename.textContent = `Editing: ${data.path}`;
             textarea.value = data.content;
             editor.classList.add('active');
             (editor as any).currentPath = data.path; // Store for saving
           }
        } else if (data.type === 'Error') {
           showAlert(data.message, 'Server Error');
        } else if (data.type === 'PathValidation') {
           if (!data.is_valid || !data.is_dir) {
              showAlert(`Invalid or missing directory: ${data.path}`, 'Error');
           } else {
              sendCommand({ type: 'ListDir', path: data.path });
           }
        }
      }
    };

    socket.onclose = () => {
      if (sessionToken) {
         isDisconnected = true;
         document.getElementById('remote-view')?.classList.add('disconnected');
         showAlert('Connection to server lost. The dashboard is now in read-only mode.', 'Server Disconnected');
      }
      console.warn('[CLIENT] WebSocket closed.');
    };

    socket.onerror = (error: Event) => {
      console.error('WebSocket Error', error);
      if (!isDisconnected) {
          showAlert('Could not connect to server or connection was reset.', 'Connection Error');
      }
    };
  } catch (err) {
    showAlert(`Invalid WebSocket URI: ws://${ip}`, 'Error');
  }

  let lastMediaKeyTime = 0;
  const MEDIA_DEBOUNCE_MS = 250; 

  // Add Touchpad and Media Logic
  const touchpad = document.getElementById('touchpad')!;
  let isTracking = false;
  let lastX = 0, lastY = 0;

  touchpad.addEventListener('pointerdown', (e) => {
    isTracking = true; lastX = e.clientX; lastY = e.clientY;
    touchpad.setPointerCapture(e.pointerId);
  });

  touchpad.addEventListener('pointermove', (e) => {
    if (!isTracking) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    if (dx !== 0 || dy !== 0) sendCommand({ type: 'MouseMove', dx, dy });
    lastX = e.clientX; lastY = e.clientY;
  });

  touchpad.addEventListener('pointerup', (e) => {
    isTracking = false; touchpad.releasePointerCapture(e.pointerId);
  });

  document.getElementById('btn-left-click')!.onclick = () => sendCommand({ type: 'MouseClick', button: 'left' });
  document.getElementById('btn-right-click')!.onclick = () => sendCommand({ type: 'MouseClick', button: 'right' });

  document.querySelectorAll('.media-key').forEach(btn => {
    (btn as HTMLElement).onpointerdown = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const now = Date.now();
      if (now - lastMediaKeyTime < MEDIA_DEBOUNCE_MS) return;
      
      const key = (btn as HTMLButtonElement).dataset.key;
      if (key) {
        console.log(`[CLIENT] Media KeyPress: ${key}`);
        sendCommand({ type: 'KeyPress', key });
        lastMediaKeyTime = now;
      }
    };
  });

  const volSlider = document.getElementById('vol-slider') as HTMLInputElement;
  if (volSlider) {
    volSlider.onpointerdown = () => { isUserAdjustingVolume = true; };
    volSlider.onpointerup = () => { 
      isUserAdjustingVolume = false; 
    };
    volSlider.oninput = () => {
      isUserAdjustingVolume = true;
      const val = parseInt(volSlider.value);
      console.log(`[CLIENT] Volume Slider Input: ${val}%`);
      sendCommand({ type: 'SetVolume', volume: val });
    };
    // Also handle case where mouse leaves while doc is active
    volSlider.onblur = () => { isUserAdjustingVolume = false; };
  }

  const prevSlide = document.getElementById('btn-prev-slide');
  const nextSlide = document.getElementById('btn-next-slide');
  if (prevSlide) prevSlide.onpointerdown = () => sendCommand({ type: 'KeyPress', key: 'PageUp' });
  if (nextSlide) nextSlide.onpointerdown = () => sendCommand({ type: 'KeyPress', key: 'PageDown' });

  // Screenshot Action
  const btnScreenshot = document.getElementById('btn-screenshot') as HTMLButtonElement;
  if (btnScreenshot) {
    btnScreenshot.onclick = () => {
      if (isDisconnected) return;
      btnScreenshot.disabled = true;
      btnScreenshot.textContent = 'Capture...';
      sendCommand({ type: 'TakeScreenshot' });
    };
  }

  // Clipboard Actions
  const btnFetch = document.getElementById('btn-fetch-clipboard');
  const btnPush = document.getElementById('btn-push-clipboard');

  if (btnFetch) {
    btnFetch.onclick = () => {
      if (isDisconnected) return;
      sendCommand({ type: 'GetClipboard' });
    };
  }

  if (btnPush) {
    btnPush.onclick = async () => {
      if (isDisconnected) return;
      try {
        const text = await navigator.clipboard.readText();
        if (text) {
          sendCommand({ type: 'SetClipboard', text });
          showAlert('Local clipboard pushed to remote host!', 'Clipboard Sync');
        } else {
          showAlert('Local clipboard is empty.', 'Clipboard Sync');
        }
      } catch (err) {
        showAlert(`Failed to read local clipboard: ${err}\nNote: Browser may require focus or permission.`, 'Error');
      }
    };
  }


  window.onkeydown = (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

    // Scoping check: Only send keys if in a remote control tab
    const activeTab = document.querySelector('.nav-btn.active')?.getAttribute('data-target');
    const isControlTab = activeTab === 'tab-screen' || activeTab === 'tab-touchpad';
    if (!isControlTab) return;
    
    // BREAK FEEDBACK LOOP: Ignore keys that should only be triggered by UI buttons
    const blacklist = [
      "AudioVolumeMute", "MediaPlayPause", "MediaTrackNext", "MediaTrackPrevious",
      "AudioVolumeUp", "AudioVolumeDown",
      "PageUp", "PageDown", // Presentation keys
      "Alt", "Control", "Shift", "Meta" // Modifier keys (avoid re-sending during combos)
    ];
    if (blacklist.includes(e.key)) return;

    if (sessionToken && socket?.readyState === WebSocket.OPEN && !isDisconnected) {
      sendCommand({ type: 'KeyPress', key: e.key });
      e.preventDefault();
    }
  };

  // Terminal Logic
  const terminalInput = document.getElementById('terminal-input') as HTMLInputElement;
  terminalInput.onkeydown = (e) => {
    if (isDisconnected) return;
    if (e.key === 'Enter') {
      const val = terminalInput.value;
      
      // Intercept screen clears natively to protect the server's physical console
      if (val.trim() === 'clear' || val.trim() === 'cls') {
        document.getElementById('terminal-output')!.textContent = '';
        terminalInput.value = '';
        return;
      }
      
      sendCommand({ type: 'TerminalInput', input: val + '\n' });
      terminalInput.value = '';
    }
  };

  // Terminal V2 Logic (xterm.js)
  const xtermContainer = document.getElementById('xterm-container');
  if (xtermContainer) {
    xterm = new Terminal({
      theme: { background: '#000000', foreground: '#2ed573' },
      cursorBlink: true,
      fontFamily: "'Consolas', 'Courier New', monospace",
      fontSize: 14,
    });
    fitAddon = new FitAddon();
    xterm.loadAddon(fitAddon);
    xterm.open(xtermContainer);
    
    xterm.onData(data => {
      if (isDisconnected) return;
      sendCommand({ type: 'TerminalV2Input', input: data });
    });

    xterm.onResize(size => {
      sendCommand({ type: 'TerminalV2Resize', rows: size.rows, cols: size.cols });
    });
    
    window.onresize = () => {
      if (document.getElementById('tab-terminal-v2')?.classList.contains('active')) {
        fitAddon?.fit();
      }
    };

    // Initial fit and notice server of size
    setTimeout(() => {
        fitAddon?.fit();
        if (xterm) {
           sendCommand({ type: 'TerminalV2Resize', rows: xterm.rows, cols: xterm.cols });
        }
    }, 100);
  }

  // --- Process & Service Rendering ---
  function renderProcessList(processes: any[], search: string = '') {
    rawProcesses = processes;
    const list = document.getElementById('process-list');
    if (!list) return;

    // 1. Filter
    let filtered = search 
      ? processes.filter(p => p.pid.toString().includes(search) || p.name.toLowerCase().includes(search))
      : processes;

    if (processFilter === 'high-cpu') filtered = filtered.filter(p => p.cpu > 1.0);
    if (processFilter === 'high-mem') filtered = filtered.filter(p => p.mem_mb > 100);

    // 2. Sort
    filtered.sort((a, b) => {
      let vA = a[processSortCol];
      let vB = b[processSortCol];
      if (typeof vA === 'string') {
        vA = vA.toLowerCase();
        vB = vB.toLowerCase();
      }
      if (vA < vB) return processSortDir === 'asc' ? -1 : 1;
      if (vA > vB) return processSortDir === 'asc' ? 1 : -1;
      return 0;
    });

    // 3. Update UI Sort Indicators
    document.querySelectorAll('[data-table="process"]').forEach(th => {
      th.classList.remove('sort-asc', 'sort-desc');
      if (th.getAttribute('data-sort') === processSortCol) {
        th.classList.add(processSortDir === 'asc' ? 'sort-asc' : 'sort-desc');
      }
    });

    list.innerHTML = filtered.map(p => `
      <tr>
        <td>${p.pid}</td>
        <td class="text-truncate" style="max-width: 150px;" title="${p.name}">${p.name}</td>
        <td>${p.cpu.toFixed(1)}%</td>
        <td>${p.mem_mb} MB</td>
        <td><button class="kill-btn" onclick="killProcess(${p.pid})">Kill</button></td>
      </tr>
    `).join('');
  }

  function renderServiceList(services: any[], search: string = '') {
    rawServices = services;
    const list = document.getElementById('service-list');
    if (!list) return;

    // 1. Filter
    let filtered = search
      ? services.filter(s => s.name.toLowerCase().includes(search))
      : services;

    if (serviceFilter === 'running') filtered = filtered.filter(s => s.status.toLowerCase().includes('running'));
    if (serviceFilter === 'stopped') filtered = filtered.filter(s => !s.status.toLowerCase().includes('running'));

    // 2. Sort
    filtered.sort((a, b) => {
      let vA = a[serviceSortCol];
      let vB = b[serviceSortCol];
      if (typeof vA === 'string') {
        vA = vA.toLowerCase();
        vB = vB.toLowerCase();
      }
      if (vA < vB) return serviceSortDir === 'asc' ? -1 : 1;
      if (vA > vB) return serviceSortDir === 'asc' ? 1 : -1;
      return 0;
    });

    // 3. Update UI Sort Indicators
    document.querySelectorAll('[data-table="service"]').forEach(th => {
      th.classList.remove('sort-asc', 'sort-desc');
      if (th.getAttribute('data-sort') === serviceSortCol) {
        th.classList.add(serviceSortDir === 'asc' ? 'sort-asc' : 'sort-desc');
      }
    });

    list.innerHTML = filtered.map(s => {
      const statusClass = s.status.toLowerCase().includes('running') ? 'running' : 'stopped';
      return `
        <tr>
          <td class="text-truncate" style="max-width: 180px;" title="${s.name}">${s.name}</td>
          <td><span class="status-badge ${statusClass}">${s.status}</span></td>
          <td>
            <div class="svc-actions">
              <button class="svc-btn" onclick="toggleService('${s.name}', 'start')">Start</button>
              <button class="svc-btn" onclick="toggleService('${s.name}', 'stop')">Stop</button>
              <button class="svc-btn" onclick="toggleService('${s.name}', 'restart')">Restart</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  // Expose actions to global scope for HTML onclick
  (window as any).killProcess = (pid: number) => {
    showConfirm(`Are you sure you want to kill process ${pid}?`, () => {
      sendCommand({ type: 'KillProcess', pid });
      setTimeout(() => sendCommand({ type: 'ListProcesses' }), 500);
    }, 'Kill Process');
  };

  (window as any).toggleService = (name: string, action: string) => {
    sendCommand({ type: 'ToggleService', name, action });
    setTimeout(() => sendCommand({ type: 'ListServices' }), 1000);
  };

  // --- File Manager Rendering & Logic ---
  const btnFmGo = document.getElementById('btn-fm-go');
  const fmPathInput = document.getElementById('fm-path-input') as HTMLInputElement;
  const btnFmBack = document.getElementById('btn-fm-back');

  if (btnFmGo && fmPathInput) {
    btnFmGo.onclick = () => {
      const val = fmPathInput.value.trim();
      if (val) sendCommand({ type: 'ValidatePath', path: val });
    };
    fmPathInput.onkeydown = (e) => {
      if (e.key === 'Enter') btnFmGo.click();
    };
  }

  if (btnFmBack) {
    btnFmBack.onclick = () => {
      if (pathHistory.length > 1) {
        pathHistory.pop(); // Remove current
        const prev = pathHistory.pop(); // Get previous
        if (prev) navigateTo(prev);
      }
    };
  }

  document.getElementById('btn-fm-home')?.addEventListener('click', () => navigateTo('HOME'));

  document.getElementById('btn-fm-refresh')?.addEventListener('click', () => {
    sendCommand({ type: 'ListDir', path: currentFmPath });
  });

  document.getElementById('btn-fm-go')?.addEventListener('click', () => {
    const input = document.getElementById('fm-path-input') as HTMLInputElement;
    if (input && input.value) navigateTo(input.value);
  });

  document.getElementById('fm-path-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const input = e.target as HTMLInputElement;
      if (input.value) navigateTo(input.value);
    }
  });

  document.getElementById('btn-fm-back')?.addEventListener('click', () => {
    if (pathHistory.length > 1) {
      pathHistory.pop(); // Remove current
      const last = pathHistory.pop(); // Get previous
      if (last !== undefined) navigateTo(last);
    }
  });

  document.getElementById('btn-fm-new-folder')?.addEventListener('click', () => {
    const name = prompt("Enter new folder name:");
    if (name) sendCommand({ type: 'CreateDir', path: joinPath(currentFmPath, name) });
  });

  document.getElementById('btn-fm-new-file')?.addEventListener('click', () => {
    const name = prompt("Enter new file name:");
    if (name) sendCommand({ type: 'CreateFile', path: joinPath(currentFmPath, name) });
  });

  document.getElementById('btn-fm-upload')?.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.onchange = (e: any) => {
      const file = e.target.files[0];
      if (file) {
        startUpload(file);
      }
    };
    input.click();
  });

  // navigateTo must be assigned to window BEFORE renderDriveList is ever called
  function navigateTo(path: string) {
    selectedItems.clear(); // Important: clear selection on any navigation
    if (path === 'HOME') {
      sendCommand({ type: 'ListDir', path: "" });
    } else {
      sendCommand({ type: 'ListDir', path });
    }
  }
  (window as any).navigateTo = navigateTo;

  function renderDriveList(drives: any[]) {
    const list = document.getElementById('fm-drive-list');
    if (!list) { console.warn('[CLIENT] fm-drive-list element not found!'); return; }
    list.innerHTML = drives.map(d => `
      <button class="fm-sidebar-item" data-path="${d.mount_point.replace(/"/g, '&quot;')}">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="6" width="20" height="12" rx="2"></rect><path d="M6 12h.01"></path><path d="M10 12h.01"></path><path d="M14 12h.01"></path></svg>
        ${d.name} (${Math.round(d.total_gb)}GB)
      </button>
    `).join('');
    // Wire clicks via event delegation on the parent
    list.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const btn = target.closest('.fm-sidebar-item') as HTMLElement | null;
      if (btn) {
        const p = btn.dataset.path;
        if (p) navigateTo(p);
      }
    });
    console.log(`[CLIENT] Rendered ${drives.length} drives in sidebar.`);
  }

  function updateSelectionBar() {
    const count = selectedItems.size;
    const bar = document.getElementById('fm-selection-bar');
    const countEl = document.getElementById('fm-sel-count');
    const btnOpen = document.getElementById('btn-sel-open') as HTMLButtonElement;
    const btnRename = document.getElementById('btn-sel-rename') as HTMLButtonElement;
    const btnTrash = document.getElementById('btn-sel-trash') as HTMLButtonElement;
    const btnPerm = document.getElementById('btn-sel-perm') as HTMLButtonElement;
    const btnCopy = document.getElementById('btn-sel-copy') as HTMLButtonElement;
    const btnMove = document.getElementById('btn-sel-move') as HTMLButtonElement;
    const btnDownload = document.getElementById('btn-sel-download') as HTMLButtonElement;
    const selectAll = document.getElementById('fm-select-all') as HTMLInputElement;

    if (bar) bar.classList.toggle('active', count > 0);
    if (countEl) countEl.textContent = `${count} item${count !== 1 ? 's' : ''} selected`;
    if (btnOpen) btnOpen.disabled = count !== 1;
    if (btnRename) {
      btnRename.disabled = count !== 1;
      btnRename.style.display = count === 1 ? 'flex' : 'none';
    }
    if (btnDownload) btnDownload.disabled = count === 0;
    if (btnOpen) btnOpen.disabled = count !== 1;
    
    if (btnCopy) btnCopy.disabled = count === 0;
    if (btnMove) btnMove.disabled = count === 0;
    if (btnTrash) btnTrash.disabled = count === 0;
    if (btnPerm) btnPerm.disabled = count === 0;
    if (selectAll) selectAll.indeterminate = count > 0 && count < fmFiles.length;
    if (selectAll) selectAll.checked = count === fmFiles.length && fmFiles.length > 0;

    // Update row highlight states
    document.querySelectorAll('.fm-row').forEach(row => {
      const rowEl = row as HTMLElement;
      const selected = selectedItems.has(rowEl.dataset.name || '');
      rowEl.classList.toggle('selected', selected);
      const cb = rowEl.querySelector('.fm-check') as HTMLInputElement;
      if (cb) cb.checked = selected;
    });
  }

  function renderFileList(items: any[]) {
    fmFiles = items;
    const list = document.getElementById('fm-file-list');
    if (!list) { console.warn('[CLIENT] fm-file-list not found'); return; }

    // Track history
    if (pathHistory[pathHistory.length - 1] !== currentFmPath) {
      pathHistory.push(currentFmPath);
      if (pathHistory.length > 50) pathHistory.shift();
    }

    // Remove stale selections (items no longer in this dir)
    const names = new Set(items.map(i => i.name));
    selectedItems.forEach(n => { if (!names.has(n)) selectedItems.delete(n); });

    // Sort
    items.sort((a, b) => {
      if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
      let vA: any = a[fmSortCol], vB: any = b[fmSortCol];
      // Numeric sort for size and modified columns
      if (fmSortCol === 'size' || fmSortCol === 'modified') {
        return fmSortDir === 'asc' ? vA - vB : vB - vA;
      }
      if (typeof vA === 'string') { vA = vA.toLowerCase(); vB = vB.toLowerCase(); }
      if (vA < vB) return fmSortDir === 'asc' ? -1 : 1;
      if (vA > vB) return fmSortDir === 'asc' ? 1 : -1;
      return 0;
    });

    // Apply search filter
    const query = fmSearchQuery.toLowerCase();
    const filtered = query ? items.filter(i => i.name.toLowerCase().includes(query)) : items;

    list.innerHTML = filtered.map(item => {
      const isSelected = selectedItems.has(item.name);
      const icon = item.is_dir
        ? `<svg class="file-icon dir-icon" viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>`
        : `<svg class="file-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg>`;
      const sizeStr = item.is_dir ? '--' : (item.size >= 1048576 ? (item.size/1048576).toFixed(1) + ' MB' : (item.size/1024).toFixed(1) + ' KB');
      const dateStr = new Date(item.modified * 1000).toLocaleDateString();
      return `
        <tr class="fm-row${isSelected ? ' selected' : ''}" data-name="${item.name.replace(/"/g, '&quot;')}" data-isdir="${item.is_dir}">
          <td class="check-col"><input type="checkbox" class="fm-check"${isSelected ? ' checked' : ''}></td>
          <td><div class="file-item-name">${icon} <span>${item.name}</span></div></td>
          <td>${sizeStr}</td>
          <td>${dateStr}</td>
        </tr>`;
    }).join('');

    // Click handling: routing based on target cell
    list.onclick = (e) => {
      const target = e.target as HTMLElement;
      const row = target.closest('.fm-row') as HTMLElement | null;
      if (!row) return;

      const name = row.dataset.name || '';
      const isDir = row.dataset.isdir === 'true';
      const isCheckClick = target.closest('.check-col') !== null;

      if (isCheckClick) {
        // Toggle selection
        if (selectedItems.has(name)) selectedItems.delete(name);
        else selectedItems.add(name);
        updateSelectionBar();
      } else {
        // Open/Navigate
        const fullPath = joinPath(currentFmPath, name);
        if (isDir) {
           navigateTo(fullPath);
        } else {
           const ext = name.split('.').pop()?.toLowerCase();
           const textExts = ['txt','log','ini','json','md','js','ts','py','rs','html','css','xml','yaml','toml','sh','bat','env','conf','cfg'];
           if (ext && textExts.includes(ext)) sendCommand({ type: 'ReadFile', path: fullPath });
           else showAlert('Use "Open on Host" for non-text file types.', 'File Manager');
        }
      }
    };

    console.log(`[CLIENT] Rendered ${items.length} items.`);
    updateSelectionBar();
  }

  // Header Sorting
  document.querySelectorAll('.fm-table th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const col = (th as HTMLElement).dataset.sort || 'name';
      if (fmSortCol === col) {
        fmSortDir = (fmSortDir === 'asc' ? 'desc' : 'asc');
      } else {
        fmSortCol = col;
        fmSortDir = 'asc';
      }
      // Update sort icons
      document.querySelectorAll('.fm-table th.sortable').forEach(h => {
        h.classList.remove('sort-asc', 'sort-desc');
        if ((h as HTMLElement).dataset.sort === fmSortCol) {
          h.classList.add(fmSortDir === 'asc' ? 'sort-asc' : 'sort-desc');
        }
      });
      renderFileList(fmFiles);
    });
  });

  // Select-All checkbox
  document.getElementById('fm-select-all')?.addEventListener('change', (e) => {
    const cb = e.target as HTMLInputElement;
    if (cb.checked) fmFiles.forEach(f => selectedItems.add(f.name));
    else selectedItems.clear();
    updateSelectionBar();
  });

  // Selection bar buttons
  document.getElementById('btn-sel-clear')?.addEventListener('click', () => {
    selectedItems.clear(); updateSelectionBar();
  });
  document.getElementById('btn-sel-open')?.addEventListener('click', () => {
    if (selectedItems.size !== 1) return;
    const name = [...selectedItems][0];
    sendCommand({ type: 'OpenFile', path: joinPath(currentFmPath, name) });
  });
  document.getElementById('btn-sel-rename')?.addEventListener('click', () => {
    if (selectedItems.size !== 1) return;
    (window as any).renameItem([...selectedItems][0]);
  });
  document.getElementById('btn-sel-trash')?.addEventListener('click', () => {
    if (selectedItems.size === 0) return;
    const count = selectedItems.size;
    showConfirm(`Move ${count} item${count !== 1 ? 's' : ''} to Trash?`, () => {
      const toDelete = [...selectedItems];
      toDelete.forEach(name => sendCommand({ type: 'DeleteFile', path: joinPath(currentFmPath, name), permanent: false }));
      selectedItems.clear(); updateSelectionBar();
    }, 'Move to Trash');
  });
  document.getElementById('btn-sel-perm')?.addEventListener('click', () => {
    if (selectedItems.size === 0) return;
    const count = selectedItems.size;
    showConfirm(`PERMANENTLY DELETE ${count} item${count !== 1 ? 's' : ''}? This CANNOT be undone!`, () => {
      const toDelete = [...selectedItems];
      toDelete.forEach(name => sendCommand({ type: 'DeleteFile', path: joinPath(currentFmPath, name), permanent: true }));
      selectedItems.clear(); updateSelectionBar();
    }, 'Permanent Delete ⚠️');
  });

  (window as any).renameItem = (name: string) => {
    const modal = document.getElementById('modal-fm-rename');
    const input = document.getElementById('fm-rename-input') as HTMLInputElement;
    const confirmBtn = document.getElementById('btn-fm-rename-confirm');
    if (modal && input && confirmBtn) {
      input.value = name;
      modal.classList.add('active');
      confirmBtn.onclick = () => {
        const newName = input.value;
        if (newName && newName !== name) {
          const oldPath = joinPath(currentFmPath, name);
          const newPath = joinPath(currentFmPath, newName);
          sendCommand({ type: 'RenameFile', old_path: oldPath, new_path: newPath });
        }
        modal.classList.remove('active');
      };
    }
  };

  const btnSaveFile = document.getElementById('btn-editor-save');
  if (btnSaveFile) {
    btnSaveFile.onclick = () => {
      const editor = document.getElementById('modal-file-editor');
      const textarea = document.getElementById('file-editor-textarea') as HTMLTextAreaElement;
      if (editor && textarea && (editor as any).currentPath) {
        sendCommand({ type: 'WriteFile', path: (editor as any).currentPath, content: textarea.value });
        editor.classList.remove('active');
        showAlert('File saved successfully!', 'File Manager');
      }
    };
  }

  (window as any).deleteItem = (name: string, permanent: boolean) => {
    const path = joinPath(currentFmPath, name);
    const opStr = permanent ? "PERMANENTLY DELETE" : "move to TRASH";
    showConfirm(`Are you sure you want to ${opStr} '${name}'?`, () => {
      sendCommand({ type: 'DeleteFile', path, permanent });
    }, "Delete Item");
  };

  (window as any).openOnHost = (name: string) => {
    sendCommand({ type: 'OpenFile', path: joinPath(currentFmPath, name) });
  };

  // Search Input
  document.getElementById('fm-search')?.addEventListener('input', (e) => {
    fmSearchQuery = (e.target as HTMLInputElement).value;
    renderFileList(fmFiles);
  });

  // Move/Copy buttons → open destination picker
  document.getElementById('btn-sel-copy')?.addEventListener('click', () => {
    if (selectedItems.size === 0) return;
    openDestinationPicker('copy');
  });
  document.getElementById('btn-sel-move')?.addEventListener('click', () => {
    if (selectedItems.size === 0) return;
    openDestinationPicker('move');
  });

  document.getElementById('btn-sel-download')?.addEventListener('click', () => {
    const items = [...selectedItems];
    if (items.length === 0) return;
    items.forEach(name => handleDownload(joinPath(currentFmPath, name)));
  });

  // Sort Listeners for FM (single block)
  document.querySelectorAll('.fm-table th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const col = (th as HTMLElement).dataset.sort || 'name';
      if (fmSortCol === col) {
        fmSortDir = (fmSortDir === 'asc' ? 'desc' : 'asc') as 'asc' | 'desc';
      } else {
        fmSortCol = col;
        fmSortDir = 'asc';
      }
      document.querySelectorAll('.fm-table th.sortable').forEach(h => {
        h.classList.remove('sort-asc', 'sort-desc');
        if ((h as HTMLElement).dataset.sort === fmSortCol) {
          h.classList.add(fmSortDir === 'asc' ? 'sort-asc' : 'sort-desc');
        }
      });
      renderFileList(fmFiles);
    });
  });

  // ---- Destination Picker ----
  function pickerNavigateTo(path: string) {
    if (pickerPathHistory[pickerPathHistory.length - 1] !== pickerPath) {
      pickerPathHistory.push(pickerPath);
    }
    pickerPath = path;
    sendCommand({ type: 'ListFolders', path });
  }

  function renderPickerFolders(path: string, folders: string[]) {
    pickerPath = path;
    const pathEl = document.getElementById('picker-current-path');
    const list = document.getElementById('picker-folder-list');
    if (pathEl) pathEl.textContent = path || "This PC";
    if (!list) return;

    if (folders.length === 0) {
      list.innerHTML = `<div class="picker-empty">No sub-folders here</div>`;
      return;
    }
    list.innerHTML = folders.map(name => {
      const isDrive = !path;
      const icon = isDrive 
        ? `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--text-dim)"><rect x="2" y="6" width="20" height="12" rx="2"></rect><path d="M6 12h.01"></path><path d="M10 12h.01"></path><path d="M14 12h.01"></path></svg>`
        : `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>`;
      
      return `
      <div class="picker-folder-item" data-name="${name.replace(/"/g, '&quot;')}">
        ${icon}
        <span>${name}</span>
      </div>`;
    }).join('');

    list.onclick = (e) => {
      const item = (e.target as HTMLElement).closest('.picker-folder-item') as HTMLElement | null;
      if (item) {
        const name = item.dataset.name || '';
        const nextPath = !pickerPath ? name : joinPath(pickerPath, name);
        pickerNavigateTo(nextPath);
      }
    };
  }
  (window as any).renderPickerFolders = renderPickerFolders;

  function openDestinationPicker(action: 'move' | 'copy') {
    pendingPickerAction = action;
    const modal = document.getElementById('modal-fm-picker');
    const title = document.getElementById('picker-title');
    const confirmBtn = document.getElementById('btn-picker-confirm') as HTMLButtonElement;
    if (!modal) return;
    if (title) title.textContent = action === 'move' ? 'Move To...' : 'Copy To...';
    if (confirmBtn) confirmBtn.textContent = action === 'move' ? 'Move Here' : 'Copy Here';
    pickerPath = currentFmPath;
    pickerPathHistory = [];
    sendCommand({ type: 'ListFolders', path: currentFmPath });
    modal.classList.add('active');
  }

  document.getElementById('btn-picker-back')?.addEventListener('click', () => {
    const prev = pickerPathHistory.pop();
    if (prev !== undefined) {
      pickerPath = prev;
      sendCommand({ type: 'ListFolders', path: prev });
    }
  });
  document.getElementById('btn-picker-home')?.addEventListener('click', () => {
    pickerPathHistory = [];
    pickerPath = '';
    sendCommand({ type: 'ListFolders', path: '' });
  });
  document.getElementById('btn-picker-cancel')?.addEventListener('click', () => {
    document.getElementById('modal-fm-picker')?.classList.remove('active');
    pendingPickerAction = null;
  });
  document.getElementById('btn-picker-close')?.addEventListener('click', () => {
    document.getElementById('modal-fm-picker')?.classList.remove('active');
    pendingPickerAction = null;
  });
  document.getElementById('btn-picker-confirm')?.addEventListener('click', () => {
    if (!pendingPickerAction || selectedItems.size === 0) return;
    const action = pendingPickerAction;
    const destPath = pickerPath;
    const items = [...selectedItems];
    const count = items.length;
    const label = action === 'move' ? 'Move' : 'Copy';

    // Close picker modal before showing confirm
    document.getElementById('modal-fm-picker')?.classList.remove('active');

    showConfirm(
      `${label} ${count} item${count !== 1 ? 's' : ''} to "${destPath}"?`,
      () => {
        items.forEach(name => {
          const src = joinPath(currentFmPath, name);
          if (action === 'move') sendCommand({ type: 'MoveFile', src, dest: destPath });
          else sendCommand({ type: 'CopyFile', src, dest: destPath });
        });
        selectedItems.clear();
        updateSelectionBar();
        pendingPickerAction = null;
      },
      `${label} Files`
    );
  });

  // INITIALIZE SETTINGS
  loadSettings();

  document.getElementById('btn-browse-download')!.onclick = async () => {
    try {
      const folder = await invoke('pick_folder') as string;
      if (folder) {
        (document.getElementById('setting-download-path') as HTMLInputElement).value = folder;
      }
    } catch (e) {
      console.log('Folder pick cancelled', e);
    }
  };

  document.getElementById('btn-save-settings')!.onclick = () => saveSettings();
}
