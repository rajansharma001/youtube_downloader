/**
 * StreamGrab - YouTube Downloader Content Script
 * Injects native download button & quality selector into YouTube watch pages.
 */

(() => {
  'use strict';

  // Constants & Defaults
  const DEFAULT_LOCAL_SERVER = 'http://127.0.0.1:5000';
  const DEFAULT_CLOUD_SERVER = 'https://youtube-downloader-xs7u.onrender.com';
  
  let currentServerUrl = DEFAULT_LOCAL_SERVER;
  let isMp3OnlyMode = false;
  let defaultFormat = 'audio';
  let defaultAudioQuality = '320';
  let defaultVideoQuality = '720';

  let currentVideoId = '';
  let activeJobId = null;
  let statusPollTimer = null;
  let isServerOnline = false;

  // Selected options in dropdown
  let selectedFormat = 'audio'; // 'audio' or 'video'
  let selectedQuality = '320';

  // Load preferences from storage
  function loadExtensionConfig() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
      chrome.storage.sync.get({
        serverUrl: DEFAULT_LOCAL_SERVER,
        mp3OnlyMode: false,
        defaultFormat: 'audio',
        defaultAudioQuality: '320',
        defaultVideoQuality: '720'
      }, (cfg) => {
        currentServerUrl = (cfg.serverUrl || DEFAULT_LOCAL_SERVER).replace(/\/+$/, '');
        isMp3OnlyMode = !!cfg.mp3OnlyMode;
        defaultFormat = cfg.defaultFormat || 'audio';
        defaultAudioQuality = cfg.defaultAudioQuality || '320';
        defaultVideoQuality = cfg.defaultVideoQuality || '720';

        selectedFormat = isMp3OnlyMode ? 'audio' : defaultFormat;
        selectedQuality = selectedFormat === 'audio' ? defaultAudioQuality : defaultVideoQuality;

        checkServerHealth();
      });
    } else {
      checkServerHealth();
    }
  }

  // Check backend server status
  async function checkServerHealth() {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2500);
      const res = await fetch(`${currentServerUrl}/api/health`, {
        signal: controller.signal,
        mode: 'cors'
      });
      clearTimeout(timeoutId);
      if (res.ok) {
        isServerOnline = true;
        updateServerPillUI(true);
        return;
      }
    } catch (e) {
      // If local fails, try cloud if user was on default local
      if (currentServerUrl === DEFAULT_LOCAL_SERVER) {
        try {
          const resCloud = await fetch(`${DEFAULT_CLOUD_SERVER}/api/health`, { mode: 'cors' });
          if (resCloud.ok) {
            currentServerUrl = DEFAULT_CLOUD_SERVER;
            isServerOnline = true;
            updateServerPillUI(true);
            return;
          }
        } catch (_) {}
      }
    }
    isServerOnline = false;
    updateServerPillUI(false);
  }

  function updateServerPillUI(online) {
    const pill = document.querySelector('.sg-yt-server-pill');
    if (!pill) return;
    const dot = pill.querySelector('.sg-yt-server-dot');
    const label = pill.querySelector('.sg-yt-server-label');
    if (dot && label) {
      if (online) {
        dot.className = 'sg-yt-server-dot';
        const isLocal = currentServerUrl.includes('127.0.0.1') || currentServerUrl.includes('localhost');
        label.textContent = isLocal ? 'Local:5000' : 'Cloud';
      } else {
        dot.className = 'sg-yt-server-dot offline';
        label.textContent = 'Server Offline';
      }
    }
  }

  // Extract YouTube Video ID from URL
  function getVideoIdFromUrl(url) {
    try {
      const u = new URL(url || window.location.href);
      if (u.hostname.includes('youtube.com')) {
        if (u.pathname === '/watch') {
          return u.searchParams.get('v') || '';
        }
        if (u.pathname.startsWith('/shorts/')) {
          return u.pathname.split('/shorts/')[1].split('/')[0] || '';
        }
        if (u.pathname.startsWith('/embed/')) {
          return u.pathname.split('/embed/')[1].split('/')[0] || '';
        }
      }
    } catch (_) {}
    return '';
  }

  // Get current video title from DOM
  function getVideoTitle() {
    const el = document.querySelector('h1.ytd-watch-metadata yt-formatted-string, #title h1, h1.title yt-formatted-string, ytd-reel-player-header-renderer h2');
    return el ? el.textContent.trim() : document.title.replace(' - YouTube', '').trim();
  }

  // Create & Inject StreamGrab UI
  function injectStreamGrabButton() {
    const vid = getVideoIdFromUrl();
    if (!vid) {
      removeInjectedUI();
      return;
    }

    currentVideoId = vid;

    // Check if already injected for this video
    const existing = document.getElementById('sg-yt-btn-wrap');
    if (existing) {
      if (existing.dataset.videoId === vid) {
        return; // Already up to date
      }
      existing.remove();
    }

    // Find YouTube action buttons container
    const targets = [
      '#actions #actions-inner #top-level-buttons-computed',
      'ytd-watch-metadata #actions ytd-menu-renderer',
      '#above-the-fold #top-row #actions',
      '#owner #subscribe-button',
      '#top-level-buttons'
    ];

    let container = null;
    for (const sel of targets) {
      const el = document.querySelector(sel);
      if (el) {
        container = el;
        break;
      }
    }

    if (!container) {
      // Fallback: check again in 500ms or inject floating pill
      setTimeout(injectStreamGrabButton, 600);
      ensureFloatingPill(vid);
      return;
    }

    // Build Native Button Wrapper
    const wrap = document.createElement('div');
    wrap.className = 'sg-yt-btn-wrap';
    wrap.id = 'sg-yt-btn-wrap';
    wrap.dataset.videoId = vid;

    const labelText = isMp3OnlyMode ? 'Download MP3' : 'StreamGrab';
    const badgeText = isMp3OnlyMode ? '320k' : 'MP3 / Video';

    wrap.innerHTML = `
      <button type="button" class="sg-yt-btn" id="sg-yt-trigger" title="Download as MP3 (Audio) or MP4 (Video)">
        <span class="sg-yt-btn-icon">
          <svg viewBox="0 0 24 24"><path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z"/></svg>
        </span>
        <span class="sg-yt-btn-text">${labelText}</span>
        <span class="sg-yt-btn-badge">${badgeText}</span>
        <span class="sg-yt-btn-chevron">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"></polyline></svg>
        </span>
      </button>

      <div class="sg-yt-dropdown" id="sg-yt-dropdown">
        <div class="sg-yt-dropdown-header">
          <div class="sg-yt-brand-title">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9v-2h2v2zm0-4H9V7h2v5z"/></svg>
            <span>StreamGrab Downloader</span>
          </div>
          <div class="sg-yt-server-pill">
            <span class="sg-yt-server-dot ${isServerOnline ? '' : 'offline'}"></span>
            <span class="sg-yt-server-label">${isServerOnline ? 'Connected' : 'Checking...'}</span>
          </div>
        </div>

        <div class="sg-yt-title-bar" id="sg-yt-title-bar" title="Video Title">Loading title...</div>

        <!-- Format Switcher -->
        ${isMp3OnlyMode ? '' : `
          <div class="sg-yt-tabs">
            <button type="button" class="sg-yt-tab ${selectedFormat === 'audio' ? 'active' : ''}" data-fmt="audio">🎵 MP3 Audio</button>
            <button type="button" class="sg-yt-tab ${selectedFormat === 'video' ? 'active' : ''}" data-fmt="video">🎬 MP4 Video</button>
          </div>
        `}

        <!-- Quality Selection -->
        <div class="sg-yt-quality-section">
          <div class="sg-yt-section-label" id="sg-yt-quality-label">${selectedFormat === 'audio' ? 'Select Audio Quality (MP3)' : 'Select Video Quality (MP4)'}</div>
          <div class="sg-yt-quality-grid" id="sg-yt-quality-grid">
            <!-- Populated dynamically -->
          </div>
        </div>

        <!-- Quick 1-Click Action -->
        <button type="button" class="sg-yt-instant-btn" id="sg-yt-instant-mp3">
          ⚡ 1-Click Fast MP3 (320k)
        </button>

        <!-- Main CTA Button -->
        <button type="button" class="sg-yt-cta-btn" id="sg-yt-download-cta">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z"/></svg>
          <span id="sg-yt-cta-text">Download MP3 (320k)</span>
        </button>

        <!-- Progress Box -->
        <div class="sg-yt-progress-box" id="sg-yt-progress-box">
          <div class="sg-yt-progress-status-row">
            <span class="sg-yt-status-label" id="sg-yt-status-text">Starting download...</span>
            <span class="sg-yt-status-meta" id="sg-yt-status-meta">0%</span>
          </div>
          <div class="sg-yt-progress-track">
            <div class="sg-yt-progress-fill" id="sg-yt-progress-fill"></div>
          </div>
        </div>
      </div>
    `;

    // Insert as first item in the action bar
    if (container.firstChild) {
      container.insertBefore(wrap, container.firstChild);
    } else {
      container.appendChild(wrap);
    }

    bindDropdownEvents(wrap);
    renderQualityGrid();
    updateTitleBar();
    removeFloatingPill();
  }

  // Floating Pill for Shorts or Fallback
  function ensureFloatingPill(vid) {
    if (document.getElementById('sg-yt-btn-wrap')) return;
    if (document.getElementById('sg-yt-floating-pill')) return;

    const pill = document.createElement('div');
    pill.className = 'sg-yt-floating-pill';
    pill.id = 'sg-yt-floating-pill';
    pill.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z"/></svg>
      <span>Download MP3</span>
    `;

    pill.addEventListener('click', () => {
      startDownload('audio', '320');
    });

    document.body.appendChild(pill);
  }

  function removeFloatingPill() {
    const pill = document.getElementById('sg-yt-floating-pill');
    if (pill) pill.remove();
  }

  function removeInjectedUI() {
    const wrap = document.getElementById('sg-yt-btn-wrap');
    if (wrap) wrap.remove();
    removeFloatingPill();
  }

  // Quality options data
  const AUDIO_QUALITIES = [
    { id: '320', name: '320 kbps', desc: 'Extreme Audio' },
    { id: '256', name: '256 kbps', desc: 'High Quality' },
    { id: '192', name: '192 kbps', desc: 'Standard CD' },
    { id: '128', name: '128 kbps', desc: 'Compact Size' }
  ];

  const VIDEO_QUALITIES = [
    { id: '1080', name: '1080p FHD', desc: 'Full HD MP4' },
    { id: '720',  name: '720p HD',  desc: 'High Def MP4' },
    { id: '480',  name: '480p SD',  desc: 'Standard MP4' },
    { id: '360',  name: '360p',     desc: 'Data Saver' }
  ];

  function renderQualityGrid() {
    const grid = document.getElementById('sg-yt-quality-grid');
    const label = document.getElementById('sg-yt-quality-label');
    const ctaText = document.getElementById('sg-yt-cta-text');
    if (!grid) return;

    grid.innerHTML = '';
    const list = selectedFormat === 'audio' ? AUDIO_QUALITIES : VIDEO_QUALITIES;
    if (label) {
      label.textContent = selectedFormat === 'audio' ? 'Select Audio Quality (MP3)' : 'Select Video Quality (MP4)';
    }

    // Default selection fallback
    if (!list.some(q => q.id === selectedQuality)) {
      selectedQuality = list[0].id;
    }

    list.forEach(q => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `sg-yt-quality-btn ${q.id === selectedQuality ? 'active' : ''}`;
      btn.innerHTML = `
        <span class="sg-yt-q-name">${q.name}</span>
        <span class="sg-yt-q-desc">${q.desc}</span>
      `;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        selectedQuality = q.id;
        grid.querySelectorAll('.sg-yt-quality-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        updateCtaText();
      });
      grid.appendChild(btn);
    });

    updateCtaText();
  }

  function updateCtaText() {
    const ctaText = document.getElementById('sg-yt-cta-text');
    if (!ctaText) return;
    if (selectedFormat === 'audio') {
      ctaText.textContent = `Download MP3 (${selectedQuality}k)`;
    } else {
      ctaText.textContent = `Download MP4 (${selectedQuality}p)`;
    }
  }

  function updateTitleBar() {
    const titleBar = document.getElementById('sg-yt-title-bar');
    if (titleBar) {
      titleBar.textContent = getVideoTitle() || 'YouTube Video';
    }
  }

  // Bind dropdown & button events
  function bindDropdownEvents(wrap) {
    const trigger = wrap.querySelector('#sg-yt-trigger');
    const dropdown = wrap.querySelector('#sg-yt-dropdown');
    const ctaBtn = wrap.querySelector('#sg-yt-download-cta');
    const instantMp3Btn = wrap.querySelector('#sg-yt-instant-mp3');
    const tabs = wrap.querySelectorAll('.sg-yt-tab');

    // Toggle dropdown
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = wrap.classList.toggle('sg-open');
      if (isOpen) {
        updateTitleBar();
        checkServerHealth();
      }
    });

    // Prevent clicks inside dropdown from closing it
    dropdown.addEventListener('click', (e) => {
      e.stopPropagation();
    });

    // Close when clicking outside
    document.addEventListener('click', (e) => {
      if (!wrap.contains(e.target)) {
        wrap.classList.remove('sg-open');
      }
    });

    // Format tabs click
    tabs.forEach(tab => {
      tab.addEventListener('click', (e) => {
        e.stopPropagation();
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        selectedFormat = tab.dataset.fmt;
        selectedQuality = selectedFormat === 'audio' ? defaultAudioQuality : defaultVideoQuality;
        renderQualityGrid();
      });
    });

    // Instant MP3 button
    if (instantMp3Btn) {
      instantMp3Btn.addEventListener('click', (e) => {
        e.stopPropagation();
        startDownload('audio', '320');
      });
    }

    // Main CTA button
    if (ctaBtn) {
      ctaBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        startDownload(selectedFormat, selectedQuality);
      });
    }
  }

  // Initiate Download Request
  async function startDownload(format, quality) {
    const vid = currentVideoId || getVideoIdFromUrl();
    if (!vid) {
      showToast('No active YouTube video found.', 'error');
      return;
    }

    const videoUrl = `https://www.youtube.com/watch?v=${vid}`;
    const ctaBtn = document.getElementById('sg-yt-download-cta');
    const progBox = document.getElementById('sg-yt-progress-box');
    const statusText = document.getElementById('sg-yt-status-text');
    const statusMeta = document.getElementById('sg-yt-status-meta');
    const fill = document.getElementById('sg-yt-progress-fill');

    if (ctaBtn) ctaBtn.disabled = true;
    if (progBox) progBox.classList.add('active');
    if (statusText) statusText.textContent = 'Connecting to server...';
    if (statusMeta) statusMeta.textContent = '0%';
    if (fill) {
      fill.style.width = '5%';
      fill.className = 'sg-yt-progress-fill';
    }

    showToast(`Starting ${format.toUpperCase()} (${quality}) download...`, 'info');

    try {
      const response = await fetch(`${currentServerUrl}/api/download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        mode: 'cors',
        body: JSON.stringify({
          urls: [videoUrl],
          type: format,
          quality: quality
        })
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `Server responded with ${response.status}`);
      }

      const data = await response.json();
      if (!data.success || !data.jobs || !data.jobs.length) {
        throw new Error(data.error || 'Failed to create download job');
      }

      activeJobId = data.jobs[0].job_id;
      pollJobStatus(activeJobId, format);

    } catch (err) {
      console.error('[StreamGrab] Download initiate error:', err);
      showToast(`Error: ${err.message}. Is server running at ${currentServerUrl}?`, 'error', 6000);
      if (ctaBtn) ctaBtn.disabled = false;
      if (progBox) progBox.classList.remove('active');
    }
  }

  // Poll Job Progress from Server
  function pollJobStatus(jobId, format) {
    if (statusPollTimer) clearInterval(statusPollTimer);

    const ctaBtn = document.getElementById('sg-yt-download-cta');
    const progBox = document.getElementById('sg-yt-progress-box');
    const statusText = document.getElementById('sg-yt-status-text');
    const statusMeta = document.getElementById('sg-yt-status-meta');
    const fill = document.getElementById('sg-yt-progress-fill');

    statusPollTimer = setInterval(async () => {
      try {
        const res = await fetch(`${currentServerUrl}/api/status/${jobId}`, { mode: 'cors' });
        if (!res.ok) return;

        const job = await res.json();
        const progress = job.progress || 0;
        const status = job.status || 'waiting';

        if (fill) fill.style.width = `${Math.max(5, progress)}%`;

        if (status === 'fetching') {
          if (statusText) statusText.textContent = 'Extracting media streams...';
          if (statusMeta) statusMeta.textContent = 'Connecting';
        } else if (status === 'downloading') {
          const speedStr = job.speed ? ` • ${job.speed}` : '';
          const etaStr = job.eta ? ` • ETA ${job.eta}` : '';
          if (statusText) statusText.textContent = `Downloading ${progress}%${speedStr}`;
          if (statusMeta) statusMeta.textContent = etaStr || `${progress}%`;
        } else if (status === 'converting') {
          if (fill) fill.classList.add('converting');
          if (statusText) statusText.textContent = format === 'audio' ? 'Converting to MP3 (FFmpeg)...' : 'Merging video & audio...';
          if (statusMeta) statusMeta.textContent = 'Finishing';
        } else if (status === 'completed') {
          clearInterval(statusPollTimer);
          statusPollTimer = null;

          if (fill) {
            fill.style.width = '100%';
            fill.classList.remove('converting');
          }
          if (statusText) statusText.textContent = 'Done! Saving file...';
          if (statusMeta) statusMeta.textContent = '100%';

          const filename = job.filename;
          const downloadUrl = `${currentServerUrl}/api/file/${encodeURIComponent(filename)}`;

          triggerBrowserDownload(downloadUrl, filename);
          showToast(`🎉 Saved: ${filename}`, 'success', 5000);

          setTimeout(() => {
            if (ctaBtn) ctaBtn.disabled = false;
            if (progBox) progBox.classList.remove('active');
          }, 2500);

        } else if (status === 'failed') {
          clearInterval(statusPollTimer);
          statusPollTimer = null;

          const errMsg = job.error || 'Download failed on server.';
          if (statusText) statusText.textContent = 'Failed';
          if (statusMeta) statusMeta.textContent = 'Error';
          showToast(`Download failed: ${errMsg}`, 'error', 7000);

          setTimeout(() => {
            if (ctaBtn) ctaBtn.disabled = false;
            if (progBox) progBox.classList.remove('active');
          }, 3000);
        }

      } catch (e) {
        console.warn('[StreamGrab] Poll status warning:', e);
      }
    }, 800);
  }

  // Trigger file save to user's computer
  function triggerBrowserDownload(url, filename) {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({
        action: 'downloadFile',
        url: url,
        filename: filename
      }, (resp) => {
        if (chrome.runtime.lastError || !resp || !resp.success) {
          fallbackAnchorDownload(url, filename);
        }
      });
    } else {
      fallbackAnchorDownload(url, filename);
    }
  }

  function fallbackAnchorDownload(url, filename) {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'download';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => a.remove(), 1000);
  }

  // Floating Toast Messages on YouTube
  function showToast(message, type = 'info', duration = 4000) {
    let container = document.getElementById('sg-yt-toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'sg-yt-toast-container';
      container.className = 'sg-yt-toast-container';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `sg-yt-toast ${type}`;
    toast.textContent = message;

    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  // Navigation Observer for YouTube SPA Page Changes
  let lastUrl = window.location.href;

  function handlePageNavigation() {
    const newUrl = window.location.href;
    const newVid = getVideoIdFromUrl(newUrl);

    if (newVid) {
      setTimeout(injectStreamGrabButton, 350);
      setTimeout(injectStreamGrabButton, 1000);
      setTimeout(injectStreamGrabButton, 2200);
    } else {
      removeInjectedUI();
    }
    lastUrl = newUrl;
  }

  // Listen for native YouTube navigation events
  window.addEventListener('yt-navigate-finish', handlePageNavigation);
  window.addEventListener('spfdone', handlePageNavigation);
  window.addEventListener('popstate', handlePageNavigation);

  // Fallback Polling observer for URL changes in SPA
  setInterval(() => {
    if (window.location.href !== lastUrl) {
      handlePageNavigation();
    }
  }, 1000);

  // Initialize
  loadExtensionConfig();
  handlePageNavigation();

})();
