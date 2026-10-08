/**
 * StreamGrab Extension - Popup Logic
 */

document.addEventListener('DOMContentLoaded', () => {
  const serverSelect = document.getElementById('server-select');
  const customGroup = document.getElementById('custom-server-group');
  const customInput = document.getElementById('custom-server-input');
  const btnTestServer = document.getElementById('btn-test-server');
  const healthBadge = document.getElementById('health-badge');
  const healthDot = document.getElementById('health-dot');
  const healthText = document.getElementById('health-text');
  const linkOpenWebapp = document.getElementById('link-open-webapp');

  const toggleMp3Only = document.getElementById('toggle-mp3-only');
  const groupDefaultFormat = document.getElementById('group-default-format');
  const groupVideoQuality = document.getElementById('group-video-quality');
  const defaultFormatSelect = document.getElementById('default-format-select');
  const defaultAudioQuality = document.getElementById('default-audio-quality');
  const defaultVideoQuality = document.getElementById('default-video-quality');

  const btnSaveSettings = document.getElementById('btn-save-settings');
  const saveToast = document.getElementById('save-toast');

  const currentTabSection = document.getElementById('current-tab-section');
  const currentVideoTitle = document.getElementById('current-video-title');
  const btnQuickMp3 = document.getElementById('btn-quick-mp3');
  const btnQuickMp4 = document.getElementById('btn-quick-mp4');

  let activeVideoUrl = '';

  // 1. Load Settings
  chrome.storage.sync.get({
    serverUrl: 'http://127.0.0.1:5000',
    mp3OnlyMode: false,
    defaultFormat: 'audio',
    defaultAudioQuality: '320',
    defaultVideoQuality: '720'
  }, (cfg) => {
    const sUrl = cfg.serverUrl || 'http://127.0.0.1:5000';
    if (sUrl === 'http://127.0.0.1:5000' || sUrl === 'https://youtube-downloader-xs7u.onrender.com') {
      serverSelect.value = sUrl;
      customGroup.style.display = 'none';
    } else {
      serverSelect.value = 'custom';
      customGroup.style.display = 'flex';
      customInput.value = sUrl;
    }

    toggleMp3Only.checked = !!cfg.mp3OnlyMode;
    defaultFormatSelect.value = cfg.defaultFormat || 'audio';
    defaultAudioQuality.value = cfg.defaultAudioQuality || '320';
    defaultVideoQuality.value = cfg.defaultVideoQuality || '720';

    updateMp3OnlyVisibility();
    updateWebappLink(getEffectiveServerUrl());
    testServer(getEffectiveServerUrl());
  });

  // Server selection dropdown change
  serverSelect.addEventListener('change', () => {
    if (serverSelect.value === 'custom') {
      customGroup.style.display = 'flex';
      customInput.focus();
    } else {
      customGroup.style.display = 'none';
    }
    updateWebappLink(getEffectiveServerUrl());
    testServer(getEffectiveServerUrl());
  });

  customInput.addEventListener('input', () => {
    updateWebappLink(getEffectiveServerUrl());
  });

  function getEffectiveServerUrl() {
    if (serverSelect.value === 'custom') {
      return (customInput.value.trim() || 'http://127.0.0.1:5000').replace(/\/+$/, '');
    }
    return serverSelect.value.replace(/\/+$/, '');
  }

  function updateWebappLink(url) {
    if (linkOpenWebapp) {
      linkOpenWebapp.href = url;
    }
  }

  // 2. MP3 Only Mode visibility toggle
  toggleMp3Only.addEventListener('change', () => {
    updateMp3OnlyVisibility();
  });

  function updateMp3OnlyVisibility() {
    const isMp3Only = toggleMp3Only.checked;
    groupDefaultFormat.style.display = isMp3Only ? 'none' : 'flex';
    groupVideoQuality.style.display = isMp3Only ? 'none' : 'flex';
    if (btnQuickMp4) {
      btnQuickMp4.style.display = isMp3Only ? 'none' : 'inline-block';
    }
  }

  // 3. Test Server Connection
  btnTestServer.addEventListener('click', () => {
    testServer(getEffectiveServerUrl());
  });

  async function testServer(url) {
    healthDot.className = 'sg-dot';
    healthText.textContent = 'Pinging...';

    chrome.runtime.sendMessage({
      action: 'apiFetch',
      serverUrl: url,
      endpoint: '/api/health',
      method: 'GET'
    }, (res) => {
      if (res && res.success && res.data && res.data.status === 'ok') {
        healthDot.className = 'sg-dot online';
        healthText.textContent = 'Online';
      } else {
        healthDot.className = 'sg-dot offline';
        healthText.textContent = 'Offline';
      }
    });
  }

  // 4. Save Settings
  btnSaveSettings.addEventListener('click', () => {
    const sUrl = getEffectiveServerUrl();
    const config = {
      serverUrl: sUrl,
      mp3OnlyMode: toggleMp3Only.checked,
      defaultFormat: toggleMp3Only.checked ? 'audio' : defaultFormatSelect.value,
      defaultAudioQuality: defaultAudioQuality.value,
      defaultVideoQuality: defaultVideoQuality.value
    };

    chrome.storage.sync.set(config, () => {
      saveToast.style.display = 'block';
      setTimeout(() => {
        saveToast.style.display = 'none';
      }, 2500);
    });
  });

  // 5. Detect Active YouTube Tab
  if (chrome.tabs && chrome.tabs.query) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs || !tabs.length) return;
      const tab = tabs[0];
      const url = tab.url || '';

      if (url.includes('youtube.com/watch') || url.includes('youtube.com/shorts/')) {
        activeVideoUrl = url;
        currentTabSection.style.display = 'flex';
        currentVideoTitle.textContent = tab.title ? tab.title.replace(' - YouTube', '') : 'YouTube Video';

        btnQuickMp3.addEventListener('click', () => {
          triggerTabDownload('audio', defaultAudioQuality.value);
        });

        btnQuickMp4.addEventListener('click', () => {
          triggerTabDownload('video', defaultVideoQuality.value);
        });
      }
    });
  }

  async function triggerTabDownload(format, quality) {
    if (!activeVideoUrl) return;
    const sUrl = getEffectiveServerUrl();

    btnQuickMp3.disabled = true;
    btnQuickMp4.disabled = true;

    chrome.runtime.sendMessage({
      action: 'apiFetch',
      serverUrl: sUrl,
      endpoint: '/api/download',
      method: 'POST',
      body: {
        urls: [activeVideoUrl],
        type: format,
        quality: quality
      }
    }, (res) => {
      btnQuickMp3.disabled = false;
      btnQuickMp4.disabled = false;

      if (!res || !res.success || !res.data || !res.data.success) {
        const err = (res && res.data && res.data.error) || (res && res.error) || 'Failed to connect to server';
        alert(`Download Error: ${err}\nMake sure backend server is running at ${sUrl}`);
        return;
      }

      const jobId = res.data.job_ids && res.data.job_ids[0];
      alert(`Download started for ${format.toUpperCase()} (${quality})!\nThe file will download automatically once processing completes.`);

      if (jobId) {
        const pollTimer = setInterval(() => {
          chrome.runtime.sendMessage({
            action: 'apiFetch',
            serverUrl: sUrl,
            endpoint: `/api/status/${jobId}`,
            method: 'GET'
          }, (sRes) => {
            if (sRes && sRes.success && sRes.data && sRes.data.job) {
              const job = sRes.data.job;
              if (job.status === 'completed') {
                clearInterval(pollTimer);
                const fileUrl = `${sUrl}/api/file/${encodeURIComponent(job.filename)}`;
                chrome.runtime.sendMessage({
                  action: 'downloadFile',
                  url: fileUrl,
                  filename: job.filename
                });
              } else if (job.status === 'failed' || job.status === 'error') {
                clearInterval(pollTimer);
              }
            }
          });
        }, 1000);
      }
    });
  }
});
