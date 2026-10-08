/**
 * StreamGrab - YouTube Downloader Content Script
 * Teleports dropdown to document.body (prevents YouTube container overflow clipping)
 * and proxies all API requests via background.js (bypasses Brave Shields & Mixed-Content).
 */

(() => {
  'use strict';

  // Constants & Server Endpoints
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

  // Selected state
  let selectedFormat = 'audio';
  let selectedQuality = '320';

  // Global Dropdown DOM element (attached to document.body)
  let globalDropdown = null;
  let globalToast = null;

  // ---------------------------------------------------------------------------
  // 1. Storage & Preferences
  // ---------------------------------------------------------------------------
  function loadConfig() {
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

        updateButtonLabels();
        checkServerHealth();
      });

      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'sync') {
          if (changes.serverUrl) currentServerUrl = changes.serverUrl.newValue.replace(/\/+$/, '');
          if (changes.mp3OnlyMode !== undefined) isMp3OnlyMode = !!changes.mp3OnlyMode.newValue;
          if (changes.defaultFormat) defaultFormat = changes.defaultFormat.newValue;
          if (changes.defaultAudioQuality) defaultAudioQuality = changes.defaultAudioQuality.newValue;
          if (changes.defaultVideoQuality) defaultVideoQuality = changes.defaultVideoQuality.newValue;

          selectedFormat = isMp3OnlyMode ? 'audio' : defaultFormat;
          selectedQuality = selectedFormat === 'audio' ? defaultAudioQuality : defaultVideoQuality;

          updateButtonLabels();
          renderQualityGrid();
          checkServerHealth();
        }
      });
    } else {
      checkServerHealth();
    }
  }

  // ---------------------------------------------------------------------------
  // 2. Background API Proxy (Bypasses Brave Shields & Mixed-Content)
  // ---------------------------------------------------------------------------
  function callBackend(endpoint, method = 'GET', body = null) {
    return new Promise((resolve) => {
      if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
        resolve({ success: false, error: 'Extension runtime unavailable' });
        return;
      }

      chrome.runtime.sendMessage({
        action: 'apiFetch',
        serverUrl: currentServerUrl,
        endpoint: endpoint,
        method: method,
        body: body
      }, (res) => {
        if (chrome.runtime.lastError) {
          resolve({ success: false, error: chrome.runtime.lastError.message });
        } else {
          resolve(res || { success: false, error: 'No response from background service worker' });
        }
      });
    });
  }

  // Check backend server health
  async function checkServerHealth() {
    const res = await callBackend('/api/health');
    if (res && res.success && res.data && res.data.status === 'ok') {
      isServerOnline = true;
      updateServerPillUI(true);
      return;
    }

    // Fallback: If local is down and user is on default local, try cloud server
    if (currentServerUrl === DEFAULT_LOCAL_SERVER) {
      const cloudRes = await new Promise((resolve) => {
        chrome.runtime.sendMessage({
          action: 'apiFetch',
          serverUrl: DEFAULT_CLOUD_SERVER,
          endpoint: '/api/health',
          method: 'GET'
        }, resolve);
      });

      if (cloudRes && cloudRes.success && cloudRes.data && cloudRes.data.status === 'ok') {
        currentServerUrl = DEFAULT_CLOUD_SERVER;
        isServerOnline = true;
        updateServerPillUI(true);
        return;
      }
    }

    isServerOnline = false;
    updateServerPillUI(false);
  }

  function updateServerPillUI(online) {
    if (!globalDropdown) return;
    const dot = globalDropdown.querySelector('.sg-yt-server-dot');
    const label = globalDropdown.querySelector('.sg-yt-server-label');
    if (dot && label) {
      if (online) {
        dot.className = 'sg-yt-server-dot';
        const isLocal = currentServerUrl.includes('127.0.0.1') || currentServerUrl.includes('localhost');
        label.textContent = isLocal ? 'Local:5000' : 'Cloud Server';
      } else {
        dot.className = 'sg-yt-server-dot offline';
        label.textContent = 'Server Offline';
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 3. YouTube URL & Video Metadata Extraction
  // ---------------------------------------------------------------------------
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

  function getCurrentVideoTitle() {
    const el = document.querySelector('h1.ytd-watch-metadata yt-formatted-string, #title h1 yt-formatted-string, ytd-watch-metadata #title, h1.title');
    if (el && el.textContent.trim()) {
      return el.textContent.trim();
    }
    return document.title.replace(' - YouTube', '').trim() || 'YouTube Video';
  }

  // ---------------------------------------------------------------------------
  // 4. Dropdown Menu (Teleported to document.body)
  // ---------------------------------------------------------------------------
  function ensureGlobalDropdown() {
    if (globalDropdown && document.body.contains(globalDropdown)) {
      return globalDropdown;
    }

    globalDropdown = document.createElement('div');
    globalDropdown.id = 'sg-yt-dropdown';
    globalDropdown.className = 'sg-yt-dropdown';

    globalDropdown.innerHTML = `
      <div class="sg-yt-dropdown-header">
        <div class="sg-yt-brand-title">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9v-2h2v2zm0-4H9V7h2v5z"/></svg>
          <span>StreamGrab Downloader</span>
        </div>
        <div class="sg-yt-server-pill" id="sg-yt-dropdown-server-pill" title="Click to test server connection">
          <span class="sg-yt-server-dot offline"></span>
          <span class="sg-yt-server-label">Checking...</span>
        </div>
      </div>

      <div class="sg-yt-title-bar" id="sg-yt-title-bar">Loading title...</div>

      <!-- Format Switcher Tabs -->
      <div class="sg-yt-tabs" id="sg-yt-tabs" style="${isMp3OnlyMode ? 'display: none;' : 'display: flex;'}">
        <button type="button" class="sg-yt-tab ${selectedFormat === 'audio' ? 'active' : ''}" data-fmt="audio">🎵 MP3 Audio</button>
        <button type="button" class="sg-yt-tab ${selectedFormat === 'video' ? 'active' : ''}" data-fmt="video">🎬 MP4 Video</button>
      </div>

      <!-- Quality Selection Grid -->
      <div class="sg-yt-quality-section">
        <div class="sg-yt-section-label" id="sg-yt-quality-label">
          ${selectedFormat === 'audio' ? 'Select Audio Quality (MP3)' : 'Select Video Quality (MP4)'}
        </div>
        <div class="sg-yt-quality-grid" id="sg-yt-quality-grid"></div>
      </div>

      <!-- 1-Click Fast Action -->
      <button type="button" class="sg-yt-instant-btn" id="sg-yt-instant-mp3">
        ⚡ 1-Click Fast MP3 (320k)
      </button>

      <!-- Main Download CTA Button -->
      <button type="button" class="sg-yt-cta-btn" id="sg-yt-download-cta">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z"/></svg>
        <span id="sg-yt-cta-text">Download MP3 (320k)</span>
      </button>

      <!-- Live Progress Display -->
      <div class="sg-yt-progress-box" id="sg-yt-progress-box">
        <div class="sg-yt-progress-status-row">
          <span class="sg-yt-status-label" id="sg-yt-status-text">Ready</span>
          <span class="sg-yt-status-meta" id="sg-yt-status-meta">0%</span>
        </div>
        <div class="sg-yt-progress-track">
          <div class="sg-yt-progress-fill" id="sg-yt-progress-fill"></div>
        </div>
      </div>
    `;

    document.body.appendChild(globalDropdown);
    bindDropdownEvents();
    renderQualityGrid();
    return globalDropdown;
  }

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
    if (!globalDropdown) return;
    const grid = globalDropdown.querySelector('#sg-yt-quality-grid');
    const label = globalDropdown.querySelector('#sg-yt-quality-label');
    const tabsBox = globalDropdown.querySelector('#sg-yt-tabs');
    if (!grid) return;

    if (tabsBox) {
      tabsBox.style.display = isMp3OnlyMode ? 'none' : 'flex';
    }

    grid.innerHTML = '';
    const list = selectedFormat === 'audio' ? AUDIO_QUALITIES : VIDEO_QUALITIES;

    if (label) {
      label.textContent = selectedFormat === 'audio' ? 'Select Audio Quality (MP3)' : 'Select Video Quality (MP4)';
    }

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
        updateButtonLabels();
      });
      grid.appendChild(btn);
    });

    updateCtaText();
  }

  function updateCtaText() {
    if (!globalDropdown) return;
    const ctaText = globalDropdown.querySelector('#sg-yt-cta-text');
    if (!ctaText) return;
    if (selectedFormat === 'audio') {
      ctaText.textContent = `Download MP3 (${selectedQuality}k)`;
    } else {
      ctaText.textContent = `Download Video (${selectedQuality}p)`;
    }
  }

  function bindDropdownEvents() {
    if (!globalDropdown) return;

    // Prevent clicks inside dropdown from propagating to document
    globalDropdown.addEventListener('pointerdown', (e) => e.stopPropagation());
    globalDropdown.addEventListener('click', (e) => e.stopPropagation());

    // Format Tabs
    const tabs = globalDropdown.querySelectorAll('.sg-yt-tab');
    tabs.forEach(tab => {
      tab.addEventListener('click', (e) => {
        e.stopPropagation();
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        selectedFormat = tab.dataset.fmt;
        selectedQuality = selectedFormat === 'audio' ? defaultAudioQuality : defaultVideoQuality;
        renderQualityGrid();
        updateButtonLabels();
      });
    });

    // 1-Click Fast MP3
    const instantMp3Btn = globalDropdown.querySelector('#sg-yt-instant-mp3');
    if (instantMp3Btn) {
      instantMp3Btn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeDropdown();
        startDownload('audio', '320');
      });
    }

    // Main Download CTA
    const ctaBtn = globalDropdown.querySelector('#sg-yt-download-cta');
    if (ctaBtn) {
      ctaBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeDropdown();
        startDownload(selectedFormat, selectedQuality);
      });
    }

    // Server pill click: re-test
    const pill = globalDropdown.querySelector('#sg-yt-dropdown-server-pill');
    if (pill) {
      pill.addEventListener('click', (e) => {
        e.stopPropagation();
        checkServerHealth();
      });
    }
  }

  function toggleDropdown() {
    if (!globalDropdown) ensureGlobalDropdown();
    if (globalDropdown.classList.contains('sg-show')) {
      closeDropdown();
    } else {
      openDropdown();
    }
  }

  function openDropdown() {
    ensureGlobalDropdown();
    const arrowBtn = document.getElementById('sg-yt-arrow-btn') || document.getElementById('sg-yt-main-btn');
    if (!arrowBtn) return;

    // Update Title & Server
    const titleBar = globalDropdown.querySelector('#sg-yt-title-bar');
    if (titleBar) titleBar.textContent = getCurrentVideoTitle();
    checkServerHealth();
    renderQualityGrid();

    // Position fixed directly below the arrow button
    const rect = arrowBtn.getBoundingClientRect();
    const dropdownWidth = 320;

    let left = rect.right - dropdownWidth;
    if (left < 16) left = 16;
    if (left + dropdownWidth > window.innerWidth - 16) {
      left = window.innerWidth - dropdownWidth - 16;
    }

    let top = rect.bottom + 8;
    if (top + 420 > window.innerHeight && rect.top > 420) {
      top = rect.top - 420 - 8;
    }

    globalDropdown.style.top = `${top}px`;
    globalDropdown.style.left = `${left}px`;
    globalDropdown.classList.add('sg-show');

    if (arrowBtn.classList.contains('sg-yt-arrow-btn')) {
      arrowBtn.classList.add('sg-open');
    }
  }

  function closeDropdown() {
    if (globalDropdown) {
      globalDropdown.classList.remove('sg-show');
    }
    const arrowBtn = document.getElementById('sg-yt-arrow-btn');
    if (arrowBtn) {
      arrowBtn.classList.remove('sg-open');
    }
  }

  // Global listeners for outside click and window repositioning
  document.addEventListener('pointerdown', (e) => {
    if (!globalDropdown || !globalDropdown.classList.contains('sg-show')) return;
    const wrap = document.getElementById('sg-yt-btn-wrap');
    if (globalDropdown.contains(e.target) || (wrap && wrap.contains(e.target))) {
      return;
    }
    closeDropdown();
  });

  window.addEventListener('scroll', () => {
    if (globalDropdown && globalDropdown.classList.contains('sg-show')) {
      const arrowBtn = document.getElementById('sg-yt-arrow-btn') || document.getElementById('sg-yt-main-btn');
      if (arrowBtn) {
        const rect = arrowBtn.getBoundingClientRect();
        globalDropdown.style.top = `${rect.bottom + 8}px`;
      }
    }
  }, { passive: true });

  window.addEventListener('resize', () => {
    if (globalDropdown && globalDropdown.classList.contains('sg-show')) {
      closeDropdown();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && globalDropdown && globalDropdown.classList.contains('sg-show')) {
      closeDropdown();
    }
  });

  // ---------------------------------------------------------------------------
  // 5. In-Page Button Injection (Split Pill Layout)
  // ---------------------------------------------------------------------------
  function updateButtonLabels() {
    const mainBtn = document.getElementById('sg-yt-main-btn');
    const label = document.getElementById('sg-yt-btn-label');
    if (!label) return;

    if (isMp3OnlyMode) {
      label.textContent = `⚡ MP3 (${selectedQuality}k)`;
    } else {
      label.textContent = selectedFormat === 'audio'
        ? `⚡ MP3 (${selectedQuality}k)`
        : `🎬 MP4 (${selectedQuality}p)`;
    }
  }

  function injectStreamGrabButton() {
    const vid = getVideoIdFromUrl();
    if (!vid) {
      removeInjectedUI();
      return;
    }

    currentVideoId = vid;

    const existingWrap = document.getElementById('sg-yt-btn-wrap');
    if (existingWrap) {
      if (existingWrap.dataset.videoId === vid) {
        return; // Already present for this video
      }
      existingWrap.remove();
    }

    // Find YouTube Action Bar Container
    const selectors = [
      '#actions #actions-inner #top-level-buttons-computed',
      '#actions-inner #top-level-buttons-computed',
      'ytd-watch-metadata #actions ytd-menu-renderer',
      '#above-the-fold #top-row #actions',
      '#top-level-buttons',
      '#owner #subscribe-button'
    ];

    let container = null;
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        container = el;
        break;
      }
    }

    if (!container) {
      setTimeout(injectStreamGrabButton, 600);
      ensureFloatingPill(vid);
      return;
    }

    // Build Split Pill Element
    const wrap = document.createElement('div');
    wrap.className = 'sg-yt-btn-wrap';
    wrap.id = 'sg-yt-btn-wrap';
    wrap.dataset.videoId = vid;

    const buttonLabel = selectedFormat === 'audio'
      ? `⚡ MP3 (${selectedQuality}k)`
      : `🎬 MP4 (${selectedQuality}p)`;

    wrap.innerHTML = `
      <div class="sg-yt-btn-group">
        <button type="button" class="sg-yt-btn sg-yt-main-btn" id="sg-yt-main-btn" title="1-Click Instant Download">
          <span class="sg-yt-btn-icon">
            <svg viewBox="0 0 24 24"><path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z"/></svg>
          </span>
          <span class="sg-yt-btn-text" id="sg-yt-btn-label">${buttonLabel}</span>
        </button>
        <button type="button" class="sg-yt-btn sg-yt-arrow-btn" id="sg-yt-arrow-btn" title="Choose Quality & Format Options">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><polyline points="6 9 12 15 18 9"></polyline></svg>
        </button>
      </div>
    `;

    // Insert as first item in action bar
    if (container.firstChild) {
      container.insertBefore(wrap, container.firstChild);
    } else {
      container.appendChild(wrap);
    }

    // Bind In-Page Button Events
    const mainBtn = wrap.querySelector('#sg-yt-main-btn');
    const arrowBtn = wrap.querySelector('#sg-yt-arrow-btn');

    // 1-Click download on main button
    mainBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      startDownload(selectedFormat, selectedQuality);
    });

    // Options menu on arrow button
    arrowBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleDropdown();
    });

    ensureGlobalDropdown();
    removeFloatingPill();
  }

  // Floating Pill fallback (e.g. for Shorts)
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
    closeDropdown();
  }

  // ---------------------------------------------------------------------------
  // 6. Download Execution & Real-Time Polling
  // ---------------------------------------------------------------------------
  async function startDownload(format, quality) {
    const vid = currentVideoId || getVideoIdFromUrl();
    if (!vid) {
      showToast('No active YouTube video found.', 'error');
      return;
    }

    const videoUrl = `https://www.youtube.com/watch?v=${vid}`;
    const mainBtn = document.getElementById('sg-yt-main-btn');
    const label = document.getElementById('sg-yt-btn-label');
    const originalLabel = label ? label.textContent : 'Download';

    // UI feedback
    if (mainBtn) mainBtn.disabled = true;
    if (label) label.textContent = '⏳ Connecting...';

    updateDropdownProgress('Connecting to StreamGrab backend...', 5);
    showToast(`Starting ${format.toUpperCase()} (${quality}) download...`, 'info');

    try {
      const res = await callBackend('/api/download', 'POST', {
        urls: [videoUrl],
        type: format,
        quality: quality
      });

      if (!res || !res.success || !res.data || !res.data.success) {
        const errorMsg = (res && res.data && res.data.error) || (res && res.error) || 'Server is offline or unreachable';
        throw new Error(errorMsg);
      }

      let jobId = null;
      if (res && res.data) {
        if (Array.isArray(res.data.jobs) && res.data.jobs.length > 0) {
          jobId = res.data.jobs[0].job_id || res.data.jobs[0].id;
        } else if (Array.isArray(res.data.job_ids) && res.data.job_ids.length > 0) {
          jobId = res.data.job_ids[0];
        } else if (res.data.job_id) {
          jobId = res.data.job_id;
        } else if (res.data.id) {
          jobId = res.data.id;
        }
      }

      if (!jobId) {
        console.error('[StreamGrab] /api/download response structure:', res);
        throw new Error('Server did not return a valid download job ID');
      }

      activeJobId = jobId;
      pollJobStatus(jobId, originalLabel);

    } catch (err) {
      console.error('[StreamGrab] Download launch error:', err);
      if (mainBtn) mainBtn.disabled = false;
      if (label) label.textContent = originalLabel;
      updateDropdownProgress('Download failed: ' + err.message, 0, true);
      showToast(`Download failed: ${err.message}`, 'error', 5000);
    }
  }

  function pollJobStatus(jobId, originalLabel) {
    if (statusPollTimer) clearInterval(statusPollTimer);

    const mainBtn = document.getElementById('sg-yt-main-btn');
    const label = document.getElementById('sg-yt-btn-label');

    statusPollTimer = setInterval(async () => {
      const res = await callBackend(`/api/status/${jobId}`);
      if (!res || !res.success || !res.data) {
        return;
      }

      // Supports both direct object or nested in .job
      const job = res.data.job || res.data;
      if (!job || !job.status) return;

      const status = job.status;
      const progress = typeof job.progress === 'number' ? job.progress : (typeof job.percent === 'number' ? job.percent : 0);

      if (status === 'waiting') {
        if (label) label.textContent = '⏳ Queued...';
        updateDropdownProgress('Queued on server...', 5);
      } else if (status === 'fetching' || status === 'extracting') {
        if (label) label.textContent = '🔍 Analyzing...';
        updateDropdownProgress('Analyzing YouTube video streams...', 15);
      } else if (status === 'downloading') {
        const p = Math.max(10, Math.min(95, Math.round(progress)));
        if (label) label.textContent = `⬇ ${p}%`;
        const speed = job.speed ? ` • ${job.speed}` : '';
        const eta = job.eta ? ` • ETA ${job.eta}` : '';
        updateDropdownProgress(`Downloading: ${p}%${speed}${eta}`, p);
      } else if (status === 'converting') {
        if (label) label.textContent = '🎵 Converting...';
        updateDropdownProgress('Converting audio format with FFmpeg...', 96);
      } else if (status === 'completed') {
        clearInterval(statusPollTimer);
        statusPollTimer = null;

        if (label) label.textContent = '✅ Saved!';
        updateDropdownProgress('Download complete! Saving file...', 100);

        const filename = job.filename || `${currentVideoId || 'media'}.mp3`;
        const fileUrl = `${currentServerUrl}/api/file/${encodeURIComponent(filename)}`;

        chrome.runtime.sendMessage({
          action: 'downloadFile',
          url: fileUrl,
          filename: filename
        }, (dRes) => {
          showToast(`🎉 ${filename} saved to Downloads folder!`, 'success', 5000);
        });

        setTimeout(() => {
          if (mainBtn) mainBtn.disabled = false;
          updateButtonLabels();
          resetDropdownProgress();
        }, 3500);

      } else if (status === 'failed' || status === 'error') {
        clearInterval(statusPollTimer);
        statusPollTimer = null;
        if (mainBtn) mainBtn.disabled = false;
        if (label) label.textContent = originalLabel;
        const msg = job.error || 'Download failed on server';
        updateDropdownProgress(msg, 0, true);
        showToast(`Download failed: ${msg}`, 'error', 5000);
      }
    }, 800);
  }

  function updateDropdownProgress(text, percent, isError = false) {
    if (!globalDropdown) return;
    const box = globalDropdown.querySelector('#sg-yt-progress-box');
    const statusText = globalDropdown.querySelector('#sg-yt-status-text');
    const statusMeta = globalDropdown.querySelector('#sg-yt-status-meta');
    const fill = globalDropdown.querySelector('#sg-yt-progress-fill');
    if (!box) return;

    box.classList.add('active');
    if (statusText) statusText.textContent = text;
    if (statusMeta) statusMeta.textContent = isError ? 'Error' : `${percent}%`;
    if (fill) {
      fill.style.width = `${percent}%`;
      fill.className = isError ? 'sg-yt-progress-fill error' : 'sg-yt-progress-fill';
    }
  }

  function resetDropdownProgress() {
    if (!globalDropdown) return;
    const box = globalDropdown.querySelector('#sg-yt-progress-box');
    if (box) box.classList.remove('active');
  }

  // ---------------------------------------------------------------------------
  // 7. Floating Toast Alerts
  // ---------------------------------------------------------------------------
  function showToast(message, type = 'info', duration = 3500) {
    if (!globalToast) {
      globalToast = document.createElement('div');
      globalToast.id = 'sg-yt-toast';
      globalToast.className = 'sg-yt-toast';
      document.body.appendChild(globalToast);
    }

    globalToast.textContent = message;
    globalToast.className = `sg-yt-toast sg-yt-toast-${type} show`;

    clearTimeout(globalToast._timer);
    globalToast._timer = setTimeout(() => {
      globalToast.classList.remove('show');
    }, duration);
  }

  // ---------------------------------------------------------------------------
  // 8. Lifecycle & YouTube SPA Navigation Observers
  // ---------------------------------------------------------------------------
  function init() {
    loadConfig();

    // Initial check
    setTimeout(injectStreamGrabButton, 1000);

    // YouTube SPA Page Navigations
    window.addEventListener('yt-navigate-finish', () => {
      setTimeout(injectStreamGrabButton, 500);
    });

    window.addEventListener('yt-page-data-updated', () => {
      setTimeout(injectStreamGrabButton, 500);
    });

    window.addEventListener('popstate', () => {
      setTimeout(injectStreamGrabButton, 500);
    });

    // Fallback periodic check to ensure button isn't removed by YouTube DOM rewrites
    setInterval(() => {
      const vid = getVideoIdFromUrl();
      if (vid && !document.getElementById('sg-yt-btn-wrap')) {
        injectStreamGrabButton();
      }
    }, 1500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
