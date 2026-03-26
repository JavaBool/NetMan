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
  
  // Navigation
  document.querySelectorAll('.nav-btn').forEach(btn => {
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

    socket.onmessage = (event: MessageEvent) => {
      if (typeof event.data === 'string') {
        const data = JSON.parse(event.data);
        if (data.type === 'AuthResult') {
          if (data.success) {
            sessionToken = data.token;
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
                'presentation': 'nav-presentation', // Note: presentation is inside media tab but we can hide the section
                'screenshot': 'btn-screenshot'
              };

              Object.entries(navMap).forEach(([cap, id]) => {
                const el = document.getElementById(id);
                if (el) {
                  el.style.display = caps.includes(cap) ? 'flex' : 'none';
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
      btnScreenshot.textContent = 'Capturing...';
      sendCommand({ type: 'TakeScreenshot' });
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
}
