/**
 * StreamGrab - Frontend Application
 * Fully updated with real SVG icons and Upper Online Video Player + Bottom Download Options.
 * Features:
 * 1. Search & Explore:
 *    - Search any YouTube video or enter direct link
 *    - Click any video to play online in the UPPER PLAYER DECK
 *    - BOTTOM SIDE displays all download options (quality chips, format toggle, CTA)
 * 2. Real SVG vector icons throughout (zero emojis)
 * 3. Batch Downloader (Add video links, checkboxes, quality chips, sticky CTA)
 * 4. Downloads Queue (Active, Completed & Offline Device Library)
 * 5. Offline Download Method & Playback:
 *    - Persistent IndexedDB storage for zero-internet audio & video playback
 *    - Import local phone/PC media files
 *    - PWA Service Worker caching
 * 6. Settings (Download Path, Default Quality, Format, Dark Mode toggle switch)
 */

(function () {
  'use strict';

  // -----------------------------------------------------------
  // Progressive Web App (PWA) Service Worker Registration
  // -----------------------------------------------------------
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(err => {
        console.warn('[SW] Registration failed:', err);
      });
    });
  }

  // -----------------------------------------------------------
  // IndexedDB Client-Side Offline Storage (StreamGrabOfflineDB)
  // -----------------------------------------------------------
  const DB_NAME = 'StreamGrabOfflineDB';
  const DB_VERSION = 1;
  const STORE_NAME = 'offlineMedia';

  function openOfflineDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };
      request.onsuccess = (e) => resolve(e.target.result);
      request.onerror = (e) => reject(e.target.error);
    });
  }

  async function saveMediaToOfflineStorage(record) {
    const db = await openOfflineDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(record);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }

  async function getAllOfflineMedia() {
    const db = await openOfflineDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function isMediaSavedOffline(filename) {
    const all = await getAllOfflineMedia();
    return all.some(item => item.filename === filename);
  }

  async function deleteOfflineMedia(id) {
    const db = await openOfflineDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(id);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }

  async function clearAllOfflineMedia() {
    const db = await openOfflineDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.clear();
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }

  function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  // -----------------------------------------------------------
  // State
  // -----------------------------------------------------------
  const queueJobs = {}; // jobId -> job object
  const batchItems = []; // Array of { id, url, title, thumbnail, duration_str, selectedQuality, selectedType, checked }
  let activeLocalPlayerMedia = null;

  // Settings State
  const QUALITY_OPTIONS = ['Auto 1080p', '720p', '480p', 'MP3 320k', 'MP3 192k'];
  let qualityIndex = 0;

  const FORMAT_OPTIONS = ['MP4', 'MP3'];
  let formatIndex = 0;

  const CONNECTIONS_OPTIONS = ['5', '10', '1', '3'];
  let connectionsIndex = 0;

  // YouTube URL regular expression
  const YOUTUBE_REGEX = /(?:https?:\/\/)?(?:(?:www|m)\.)?(?:youtube\.com\/(?:watch\?(?:[^\s&]*&)*v=|shorts\/|live\/|embed\/|v\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i;

  // -----------------------------------------------------------
  // DOM References
  // -----------------------------------------------------------
  const appBody = document.getElementById('app-body');
  const brandHomeTrigger = document.getElementById('brand-home-trigger');
  const btnUserAvatar = document.getElementById('btn-user-avatar');
  const rowNetworkStatus = document.getElementById('row-network-status');
  const settingsNetworkStatus = document.getElementById('settings-network-status');
  const settingsNetworkDot = document.getElementById('settings-network-dot');
  const btnCookiesHeader = null;
  const cookiesStatusText = null;

  // Navigation
  const navTabs = document.querySelectorAll('.sg-nav-tab');
  const screens = document.querySelectorAll('.sg-screen');
  const navQueueCount = document.getElementById('nav-queue-count');

  // Screen 1: Search & Explore
  const searchInput = document.getElementById('search-input');
  const btnSearchIcon = document.getElementById('btn-search-icon');
  const btnSearchClear = document.getElementById('btn-search-clear');
  const btnMicIcon = document.getElementById('btn-mic-icon');
  const filterChips = document.querySelectorAll('.sg-filter-chip');
  const resultsHeading = document.getElementById('results-heading');
  const resultsCountBadge = document.getElementById('results-count-badge');
  const searchStatusBar = document.getElementById('search-status-bar');
  const searchStatusText = document.getElementById('search-status-text');
  const searchResultsGrid = document.getElementById('search-results-grid');
  const searchEmptyState = document.getElementById('search-empty-state');

  // Direct Online Watch Deck (Upper Video Player + Bottom Download Options)
  const sgWatchDeck = document.getElementById('sg-watch-deck');
  const inlinePlayerContainer = document.getElementById('inline-player-container');
  const deckVideoTitle = document.getElementById('deck-video-title');
  const deckVideoTitleBar = document.getElementById('deck-video-title-bar');
  const deckVideoChannel = document.getElementById('deck-video-channel');
  const deckVideoViews = document.getElementById('deck-video-views');
  const btnCloseDeck = document.getElementById('btn-close-deck');
  const deckQualityChips = document.getElementById('deck-quality-chips');
  const deckFormatToggle = document.getElementById('deck-format-toggle');
  const btnDeckDownload = document.getElementById('btn-deck-download');
  const deckDownloadBtnText = document.getElementById('deck-download-btn-text');
  const btnDeckAddBatch = document.getElementById('btn-deck-add-batch');
  const btnDeckWatchYt = document.getElementById('btn-deck-watch-yt');
  const linkFallbackYt = document.getElementById('link-fallback-yt');
  const btnSwitchBypass = document.getElementById('btn-switch-bypass');
  const deckSourceChips = document.getElementById('deck-source-chips');
  const btnDeckFullscreen = document.getElementById('btn-deck-fullscreen');
  const btnDeckMinimize = document.getElementById('btn-deck-minimize');
  const btnDeckExpandMini = document.getElementById('btn-deck-expand-mini');

  // Main Online Player Custom Controller Deck
  const deckCustomControls = document.getElementById('deck-custom-controls');
  const deckVideoSeeker = document.getElementById('deck-video-seeker');
  const deckVideoCurrentTime = document.getElementById('deck-video-current-time');
  const deckVideoTotalTime = document.getElementById('deck-video-total-time');
  const btnDeckRewind10 = document.getElementById('btn-deck-rewind-10');
  const btnDeckPlayPause = document.getElementById('btn-deck-play-pause');
  const btnDeckForward10 = document.getElementById('btn-deck-forward-10');
  const btnDeckShare = document.getElementById('btn-deck-share');
  const btnDeckShareLink = document.getElementById('btn-deck-share-link');
  const btnDeckPip = document.getElementById('btn-deck-pip');
  const btnDeckResMenu = document.getElementById('btn-deck-res-menu');
  const deckCurrentResLabel = document.getElementById('deck-current-res-label');
  const deckResDropdown = document.getElementById('deck-res-dropdown');

  const btnToggleDownloadDeck = document.getElementById('btn-toggle-download-deck');
  const deckDownloadContent = document.getElementById('deck-download-content');
  const deckDownloadBox = document.getElementById('deck-download-box');
  const deckAccordionHint = document.getElementById('deck-accordion-hint');
  const deckCollapsedQualityBadge = document.getElementById('deck-collapsed-quality-badge');

  const btnLocalPlayerShare = document.getElementById('btn-local-player-share');
  const btnVideoPip = document.getElementById('btn-video-pip');

  let isDeckPlaying = false;
  let deckCurrentSeconds = 0;
  let deckTotalSeconds = 0;
  let deckTicker = null;

  // Custom In-App Alert, Confirm & Toast DOM Elements
  const sgToastContainer = document.getElementById('sg-toast-container');
  const sgCustomAlertModal = document.getElementById('sg-custom-alert-modal');
  const sgAlertTitle = document.getElementById('sg-alert-title');
  const sgAlertMessage = document.getElementById('sg-alert-message');
  const sgAlertBadgeIcon = document.getElementById('sg-alert-badge-icon');
  const btnCustomAlertOk = document.getElementById('btn-custom-alert-ok');
  const btnCustomAlertClose = document.getElementById('btn-custom-alert-close');

  const sgCustomConfirmModal = document.getElementById('sg-custom-confirm-modal');
  const sgConfirmTitle = document.getElementById('sg-confirm-title');
  const sgConfirmMessage = document.getElementById('sg-confirm-message');
  const sgConfirmBadgeIcon = document.getElementById('sg-confirm-badge-icon');
  const btnCustomConfirmCancel = document.getElementById('btn-custom-confirm-cancel');
  const btnCustomConfirmOk = document.getElementById('btn-custom-confirm-ok');
  const btnCustomConfirmClose = document.getElementById('btn-custom-confirm-close');

  let activeDeckVideo = null;
  let currentDeckSource = 'youtube';
  let deckQuality = '1080';
  let deckType = 'video';

  // -----------------------------------------------------------
  // Custom In-App Toast & Dialog System (Replaces browser popups)
  // -----------------------------------------------------------
  function showToast(message, type = 'info', duration = 3500) {
    if (!sgToastContainer) return;
    const toast = document.createElement('div');
    toast.className = `sg-toast ${type}`;

    let iconSvg = '';
    if (type === 'success') {
      iconSvg = '<svg class="sg-toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>';
    } else if (type === 'error') {
      iconSvg = '<svg class="sg-toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>';
    } else if (type === 'warning') {
      iconSvg = '<svg class="sg-toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>';
    } else {
      iconSvg = '<svg class="sg-toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>';
    }

    toast.innerHTML = `
      ${iconSvg}
      <div class="sg-toast-msg">${escapeHtml(message)}</div>
      <button type="button" class="sg-toast-close" title="Dismiss">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    `;

    const closeBtn = toast.querySelector('.sg-toast-close');
    const dismiss = () => {
      toast.style.animation = 'sgToastOut 0.2s cubic-bezier(0.16, 1, 0.3, 1) forwards';
      setTimeout(() => toast.remove(), 200);
    };

    if (closeBtn) closeBtn.addEventListener('click', dismiss);
    sgToastContainer.appendChild(toast);

    if (duration > 0) {
      setTimeout(dismiss, duration);
    }
  }

  function showCustomAlert(title, message, type = 'info') {
    return new Promise((resolve) => {
      if (!sgCustomAlertModal) return resolve();

      if (sgAlertTitle) sgAlertTitle.textContent = title || 'StreamGrab Notice';
      if (sgAlertMessage) sgAlertMessage.textContent = message || '';

      if (sgAlertBadgeIcon) {
        sgAlertBadgeIcon.className = `sg-alert-badge ${type}`;
        if (type === 'error' || type === 'warning') {
          sgAlertBadgeIcon.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>';
        } else if (type === 'success') {
          sgAlertBadgeIcon.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>';
        } else {
          sgAlertBadgeIcon.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>';
        }
      }

      sgCustomAlertModal.style.display = 'flex';

      const cleanup = () => {
        sgCustomAlertModal.style.display = 'none';
        if (btnCustomAlertOk) btnCustomAlertOk.removeEventListener('click', onOk);
        if (btnCustomAlertClose) btnCustomAlertClose.removeEventListener('click', onOk);
        resolve();
      };

      const onOk = () => cleanup();
      if (btnCustomAlertOk) btnCustomAlertOk.addEventListener('click', onOk, { once: true });
      if (btnCustomAlertClose) btnCustomAlertClose.addEventListener('click', onOk, { once: true });
    });
  }

  function showCustomConfirm(title, message, confirmText = 'Confirm', isDestructive = false) {
    return new Promise((resolve) => {
      if (!sgCustomConfirmModal) return resolve(false);

      if (sgConfirmTitle) sgConfirmTitle.textContent = title || 'Please Confirm';
      if (sgConfirmMessage) sgConfirmMessage.textContent = message || '';

      if (btnCustomConfirmOk) {
        btnCustomConfirmOk.textContent = confirmText || 'Confirm';
        if (isDestructive) {
          btnCustomConfirmOk.style.backgroundColor = 'var(--sg-red)';
        } else {
          btnCustomConfirmOk.style.backgroundColor = '';
        }
      }

      sgCustomConfirmModal.style.display = 'flex';

      const cleanup = (result) => {
        sgCustomConfirmModal.style.display = 'none';
        resolve(result);
      };

      const onOk = () => cleanup(true);
      const onCancel = () => cleanup(false);

      if (btnCustomConfirmOk) btnCustomConfirmOk.addEventListener('click', onOk, { once: true });
      if (btnCustomConfirmCancel) btnCustomConfirmCancel.addEventListener('click', onCancel, { once: true });
      if (btnCustomConfirmClose) btnCustomConfirmClose.addEventListener('click', onCancel, { once: true });
    });
  }

  // Fallback: override native window.alert so all unexpected alerts use custom modal
  window.alert = function (msg) {
    showCustomAlert('StreamGrab Notice', String(msg));
  };

  // -----------------------------------------------------------
  // Share Helper (Web Share API + Clipboard Fallback)
  // -----------------------------------------------------------
  async function shareVideo(title, url) {
    if (!url) return;
    if (navigator.share) {
      try {
        await navigator.share({
          title: title || 'StreamGrab Video',
          text: `Check out "${title}" on StreamGrab:`,
          url: url
        });
        return;
      } catch (err) {
        if (err.name === 'AbortError') return;
      }
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(url);
        showToast('Video link copied to clipboard!', 'success', 2800);
      } else {
        showCustomAlert('Share Video', `Video Link:\n${url}`, 'info');
      }
    } catch {
      showCustomAlert('Share Video', `Video Link:\n${url}`, 'info');
    }
  }

  // -----------------------------------------------------------
  // Picture-in-Picture (OS Floating Window over other apps)
  // -----------------------------------------------------------
  let pipWindow = null;

  async function toggleDeckPictureInPicture() {
    if ('documentPictureInPicture' in window) {
      try {
        if (pipWindow) {
          pipWindow.close();
          pipWindow = null;
          return;
        }

        pipWindow = await window.documentPictureInPicture.requestWindow({
          width: 440,
          height: 270
        });

        Array.from(document.styleSheets).forEach(sheet => {
          try {
            if (sheet.href) {
              const link = document.createElement('link');
              link.rel = 'stylesheet';
              link.href = sheet.href;
              pipWindow.document.head.appendChild(link);
            } else if (sheet.cssRules) {
              const style = document.createElement('style');
              for (const rule of sheet.cssRules) {
                style.appendChild(document.createTextNode(rule.cssText));
              }
              pipWindow.document.head.appendChild(style);
            }
          } catch {}
        });

        pipWindow.document.body.style.margin = '0';
        pipWindow.document.body.style.backgroundColor = '#000000';
        pipWindow.document.body.style.overflow = 'hidden';

        const container = document.getElementById('inline-player-container');
        const origParent = container ? container.parentNode : null;
        if (container) {
          pipWindow.document.body.appendChild(container);
        }

        showToast('Floating outside app! Video stays on top when switching to Facebook or other apps.', 'info', 4000);

        pipWindow.addEventListener('pagehide', () => {
          if (origParent && container) {
            origParent.appendChild(container);
          }
          pipWindow = null;
        });

        return;
      } catch (err) {
        console.warn('Document PiP notice:', err);
      }
    }

    enableMiniPlayerMode();
    showToast('Corner mini-player active! (For system-wide floating over Facebook/apps, use Chrome/Edge or download video to use native OS PiP)', 'info', 4500);
  }

  async function toggleNativeVideoPip() {
    if (!sgNativeVideo) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (sgNativeVideo.requestPictureInPicture) {
        await sgNativeVideo.requestPictureInPicture();
        showToast('Floating Picture-in-Picture active! Video stays on top across all apps.', 'info', 3500);
      } else {
        showToast('Picture-in-Picture is not supported on this browser/device.', 'warning', 3000);
      }
    } catch (err) {
      console.warn('Native video PiP error:', err);
      showToast('Could not start Picture-in-Picture: ' + err.message, 'error', 3000);
    }
  }

  // -----------------------------------------------------------
  // YouTube-Style Floating Mini Player Core
  // -----------------------------------------------------------
  function enableMiniPlayerMode() {
    if (!sgWatchDeck || !activeDeckVideo || sgWatchDeck.style.display === 'none') return;
    sgWatchDeck.classList.add('sg-mini-mode');
  }

  function disableMiniPlayerMode() {
    if (!sgWatchDeck) return;
    sgWatchDeck.classList.remove('sg-mini-mode');
    sgWatchDeck.classList.remove('is-positioned');
    sgWatchDeck.classList.remove('is-dragging');
    sgWatchDeck.style.left = '';
    sgWatchDeck.style.top = '';
    sgWatchDeck.style.bottom = '';
    sgWatchDeck.style.right = '';
    if (btnDeckExpandMini) btnDeckExpandMini.style.display = 'none';
    if (btnDeckSizeToggle) btnDeckSizeToggle.style.display = 'none';
    if (btnDeckMinimize) btnDeckMinimize.style.display = 'inline-flex';
    if (btnDeckFullscreen) btnDeckFullscreen.style.display = 'inline-flex';
  }

  // Screen 2: Batch Downloader
  const batchSingleInput = document.getElementById('batch-single-input');
  const btnAddBatchUrl = document.getElementById('btn-add-batch-url');
  const btnPasteClipboard = document.getElementById('btn-paste-clipboard');
  const btnToggleBulkTextarea = document.getElementById('btn-toggle-bulk-textarea');
  const bulkTextareaContainer = document.getElementById('bulk-textarea-container');
  const urlsInput = document.getElementById('urls-input');
  const btnFormat = document.getElementById('btn-format');
  const btnAddBulk = document.getElementById('btn-add-bulk');
  const batchDetectedCount = document.getElementById('batch-detected-count');
  const batchValidationMsg = document.getElementById('batch-validation-msg');
  const batchItemsList = document.getElementById('batch-items-list');
  const batchEmptyPlaceholder = document.getElementById('batch-empty-placeholder');
  const btnClearBatch = document.getElementById('btn-clear-batch');
  const btnStartBatch = document.getElementById('btn-start-batch');
  const batchSelectedCountLabel = document.getElementById('batch-selected-count-label');

  // Screen 3: Downloads
  const tabDownloadsActive = document.getElementById('tab-downloads-active');
  const tabDownloadsCompleted = document.getElementById('tab-downloads-completed');
  const tabDownloadsOffline = document.getElementById('tab-downloads-offline');
  const activeTabCounter = document.getElementById('active-tab-counter');
  const completedTabCounter = document.getElementById('completed-tab-counter');
  const offlineTabCounter = document.getElementById('offline-tab-counter');
  const paneActiveDownloads = document.getElementById('pane-active-downloads');
  const paneCompletedDownloads = document.getElementById('pane-completed-downloads');
  const paneOfflineDownloads = document.getElementById('pane-offline-downloads');
  const activeDownloadsList = document.getElementById('active-downloads-list');
  const completedDownloadsList = document.getElementById('completed-downloads-list');
  const offlineDownloadsList = document.getElementById('offline-downloads-list');
  const activeEmptyState = document.getElementById('active-empty-state');
  const completedEmptyState = document.getElementById('completed-empty-state');
  const offlineEmptyState = document.getElementById('offline-empty-state');
  const btnDownloadAllZip = document.getElementById('btn-download-all-zip');
  const btnClearCompleted = document.getElementById('btn-clear-completed');
  const btnImportLocalFile = document.getElementById('btn-import-local-file');
  const btnClearOffline = document.getElementById('btn-clear-offline');
  const localFilePicker = document.getElementById('local-file-picker');

  // Screen 4: Settings
  const btnChangeDirectory = document.getElementById('btn-change-directory');
  const settingsPathLabel = document.getElementById('settings-path-label');
  const btnCycleQuality = document.getElementById('btn-cycle-quality');
  const settingQualityVal = document.getElementById('setting-quality-val');
  const btnCycleFormat = document.getElementById('btn-cycle-format');
  const settingFormatVal = document.getElementById('setting-format-val');
  const btnCycleConnections = document.getElementById('btn-cycle-connections');
  const settingConnectionsVal = document.getElementById('setting-connections-val');
  const switchDarkMode = document.getElementById('switch-dark-mode');
  const settingsOfflineSize = document.getElementById('settings-offline-size');
  const btnViewOfflineLibrary = document.getElementById('btn-view-offline-library');
  const rowCookies = document.getElementById('row-cookies');
  const settingsCookiesStatus = document.getElementById('settings-cookies-status');
  const rowDiagnostics = document.getElementById('row-diagnostics');
  const settingsPingLabel = document.getElementById('settings-ping-label');
  const rowAbout = document.getElementById('row-about');

  // Screen 5: Bottom Sheet Modal
  const downloadOptionsModal = document.getElementById('download-options-modal');
  const sheetVideoThumb = document.getElementById('sheet-video-thumb');
  const sheetVideoDuration = document.getElementById('sheet-video-duration');
  const sheetVideoTitle = document.getElementById('sheet-video-title');
  const sheetQualityChips = document.getElementById('sheet-quality-chips');
  const sheetFormatToggle = document.getElementById('sheet-format-toggle');
  const sheetSubtitlesToggle = document.getElementById('sheet-subtitles-toggle');
  const btnConfirmDownload = document.getElementById('btn-confirm-download');
  const btnSheetAddBatch = document.getElementById('btn-sheet-add-batch');

  // Custom Media & Music Player Modal
  const localPlayerModal = document.getElementById('local-player-modal');
  const btnCloseLocalPlayer = document.getElementById('btn-close-local-player');
  const btnLocalPlayerClose = document.getElementById('btn-local-player-close');
  const btnLocalPlayerSave = document.getElementById('btn-local-player-save');
  const playerTypeBadge = document.getElementById('player-type-badge');
  const playerTrackCounter = document.getElementById('player-track-counter');

  const sgNativeAudio = document.getElementById('sg-native-audio');
  const sgNativeVideo = document.getElementById('sg-native-video');
  const sgNativeVideoFrame = document.getElementById('sg-native-video-frame');
  const sgCustomAudioDeck = document.getElementById('sg-custom-audio-deck');
  const sgCustomVideoDeck = document.getElementById('sg-custom-video-deck');

  const playerVinylDisc = document.getElementById('player-vinyl-disc');
  const playerArtImg = document.getElementById('player-art-img');
  const playerArtPlaceholder = document.getElementById('player-art-placeholder');
  const playerTrackTitle = document.getElementById('player-track-title');
  const playerTrackArtist = document.getElementById('player-track-artist');
  const playerSeeker = document.getElementById('player-seeker');
  const playerCurrentTime = document.getElementById('player-current-time');
  const playerTotalTime = document.getElementById('player-total-time');

  const btnPlayerShuffle = document.getElementById('btn-player-shuffle');
  const btnPlayerPrev = document.getElementById('btn-player-prev');
  const btnPlayerPlayPause = document.getElementById('btn-player-play-pause');
  const btnPlayerNext = document.getElementById('btn-player-next');
  const btnPlayerRepeat = document.getElementById('btn-player-repeat');

  const btnVideoPrev = document.getElementById('btn-video-prev');
  const btnVideoNext = document.getElementById('btn-video-next');
  const btnVideoFullscreenRotate = document.getElementById('btn-video-fullscreen-rotate');

  // Custom Video Controller Deck Elements (Matching Music Player Layout)
  const playerVideoTitle = document.getElementById('player-video-title');
  const playerVideoMeta = document.getElementById('player-video-meta');
  const videoSeeker = document.getElementById('video-seeker');
  const videoCurrentTime = document.getElementById('video-current-time');
  const videoTotalTime = document.getElementById('video-total-time');
  const btnVideoRewind10 = document.getElementById('btn-video-rewind-10');
  const btnVideoPlayPause = document.getElementById('btn-video-play-pause');
  const btnVideoForward10 = document.getElementById('btn-video-forward-10');

  // Resizable YouTube Mini Player Handle & Size Toggle
  const miniResizeHandle = document.getElementById('mini-resize-handle');
  const btnDeckSizeToggle = document.getElementById('btn-deck-size-toggle');

  // Floating Mini-Player
  const sgMiniPlayer = document.getElementById('sg-mini-player');
  const miniPlayerExpandTrigger = document.getElementById('mini-player-expand-trigger');
  const miniPlayerInfoTrigger = document.getElementById('mini-player-info-trigger');
  const miniVinylDisc = document.getElementById('mini-vinyl-disc');
  const miniArtImg = document.getElementById('mini-art-img');
  const miniArtSvg = document.getElementById('mini-art-svg');
  const miniPlayerTitle = document.getElementById('mini-player-title');
  const miniPlayerArtist = document.getElementById('mini-player-artist');
  const btnMiniPrev = document.getElementById('btn-mini-prev');
  const btnMiniPlayPause = document.getElementById('btn-mini-play-pause');
  const btnMiniNext = document.getElementById('btn-mini-next');
  const btnMiniClose = document.getElementById('btn-mini-close');

  // Storage Modal
  const storageModal = document.getElementById('storage-modal');
  const storageModalPath = document.getElementById('storage-modal-path');
  const storageStatsSummary = document.getElementById('storage-stats-summary');
  const storageFilesList = document.getElementById('storage-files-list');
  const btnRefreshStorage = document.getElementById('btn-refresh-storage');
  const btnCloseStorage = document.getElementById('btn-close-storage');
  const btnCloseStorageBtn = document.getElementById('btn-close-storage-btn');

  // Cookies Modal
  const cookiesModal = document.getElementById('cookies-modal');
  const btnCloseCookies = document.getElementById('btn-close-cookies');
  const btnCancelCookies = document.getElementById('btn-cancel-cookies');
  const cookiesCardStatus = document.getElementById('cookies-card-status');
  const cookiesFileInput = document.getElementById('cookies-file-input');
  const cookiesTextarea = document.getElementById('cookies-textarea');
  const btnSaveCookies = document.getElementById('btn-save-cookies');
  const btnDeleteCookies = document.getElementById('btn-delete-cookies');

  // -----------------------------------------------------------
  // Online / Offline Status Detection (Located in Settings)
  // -----------------------------------------------------------
  function updateNetworkStatus() {
    const isOnline = navigator.onLine;
    if (settingsNetworkStatus) {
      settingsNetworkStatus.textContent = isOnline ? 'Online (Device Connected)' : 'Offline Mode (Device Storage Ready)';
    }
    if (settingsNetworkDot) {
      settingsNetworkDot.className = isOnline ? 'sg-status-dot dot-green' : 'sg-status-dot dot-offline';
    }
  }

  window.addEventListener('online', () => {
    updateNetworkStatus();
    checkServerHealth();
  });

  window.addEventListener('offline', () => {
    updateNetworkStatus();
  });

  updateNetworkStatus();

  if (rowNetworkStatus) {
    rowNetworkStatus.addEventListener('click', () => {
      const isOnline = navigator.onLine;
      if (isOnline) {
        showCustomAlert('Network Status: Online', 'Internet access is active.\nStreaming, downloading, and search are fully operational.', 'success');
      } else {
        showCustomAlert('Network Status: Offline', 'Internet disconnected.\nYou can play all downloaded music and videos from your offline library.', 'warning');
        switchTab('section-queue');
        if (tabDownloadsOffline) tabDownloadsOffline.click();
      }
    });
  }

  // -----------------------------------------------------------
  // Tab Navigation (Search, Batch, Queue, Settings)
  // -----------------------------------------------------------
  function switchTab(targetSectionId) {
    navTabs.forEach(tab => {
      if (tab.dataset.target === targetSectionId) {
        tab.classList.add('active');
      } else {
        tab.classList.remove('active');
      }
    });

    screens.forEach(screen => {
      if (screen.id === targetSectionId) {
        screen.style.display = 'block';
        screen.classList.add('active');
      } else {
        screen.style.display = 'none';
        screen.classList.remove('active');
      }
    });

    // YouTube-style Mini Player: floating corner playback when moving away from Search/Watch
    if (targetSectionId !== 'section-search') {
      if (activeDeckVideo && sgWatchDeck && sgWatchDeck.style.display !== 'none') {
        enableMiniPlayerMode();
      }
    } else {
      if (sgWatchDeck && sgWatchDeck.classList.contains('sg-mini-mode')) {
        disableMiniPlayerMode();
      }
    }

    if (targetSectionId === 'section-queue') {
      renderOfflineDownloadsList();
    }

    if (targetSectionId === 'section-settings') {
      refreshStorageStats();
      checkCookiesStatus();
      renderOfflineDownloadsList();
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  navTabs.forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.target));
  });

  if (brandHomeTrigger) {
    brandHomeTrigger.addEventListener('click', () => switchTab('section-search'));
  }

  if (btnUserAvatar) {
    btnUserAvatar.addEventListener('click', () => switchTab('section-settings'));
  }

  // -----------------------------------------------------------
  // Theme Toggle (Dark Mode Switch matching Screen 4)
  // -----------------------------------------------------------
  function applyTheme(isDark) {
    if (isDark) {
      appBody.classList.remove('theme-light');
      appBody.classList.add('theme-dark');
      switchDarkMode.checked = true;
      localStorage.setItem('streamgrab_theme', 'dark');
    } else {
      appBody.classList.remove('theme-dark');
      appBody.classList.add('theme-light');
      switchDarkMode.checked = false;
      localStorage.setItem('streamgrab_theme', 'light');
    }
  }

  const savedTheme = localStorage.getItem('streamgrab_theme');
  if (savedTheme === 'dark') {
    applyTheme(true);
  } else {
    applyTheme(false);
  }

  switchDarkMode.addEventListener('change', () => {
    applyTheme(switchDarkMode.checked);
  });

  // -----------------------------------------------------------
  // Upper Online Video Player Deck & Bottom Download Options
  // -----------------------------------------------------------
  function loadPlayerSource(source) {
    pauseLocalPlayer();
    if (!activeDeckVideo) return;
    currentDeckSource = source;

    if (deckSourceChips) {
      deckSourceChips.querySelectorAll('.sg-source-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.source === source);
      });
    }

    const vId = activeDeckVideo.id;
    const originParam = encodeURIComponent(window.location.origin);
    const refParam = encodeURIComponent(window.location.href);

    if (source === 'youtube') {
      inlinePlayerContainer.innerHTML = `
        <iframe
          id="sg-inline-iframe"
          src="https://www.youtube.com/embed/${vId}?autoplay=1&enablejsapi=1&origin=${originParam}&widget_referrer=${refParam}&rel=0&playsinline=1&controls=0&disablekb=1&modestbranding=1"
          referrerpolicy="no-referrer-when-downgrade"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowfullscreen
        ></iframe>
      `;
    } else if (source === 'invidious') {
      inlinePlayerContainer.innerHTML = `
        <iframe
          id="sg-inline-iframe"
          src="https://yewtu.be/embed/${vId}?autoplay=1"
          referrerpolicy="no-referrer"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture"
          allowfullscreen
        ></iframe>
      `;
    } else if (source === 'piped') {
      inlinePlayerContainer.innerHTML = `
        <iframe
          id="sg-inline-iframe"
          src="https://piped.video/embed/${vId}"
          referrerpolicy="no-referrer"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture"
          allowfullscreen
        ></iframe>
      `;
    }
  }

  // -----------------------------------------------------------
  // Mutual Exclusivity: Auto-Pause Between Players
  // -----------------------------------------------------------
  function pauseOnlinePlayer() {
    sendIframeCommand('pauseVideo');
    setDeckPlayingUI(false);
  }

  function pauseLocalPlayer() {
    userExplicitlyPaused = true;
    if (sgNativeAudio && !sgNativeAudio.paused) {
      sgNativeAudio.pause();
    }
    if (sgNativeVideo && !sgNativeVideo.paused) {
      sgNativeVideo.pause();
    }
    setPlayingStateUI(false);
    if (sgMiniPlayer) sgMiniPlayer.style.display = 'none';
  }

  function sendIframeCommand(func, args = []) {
    const iframe = document.getElementById('sg-inline-iframe');
    if (iframe && iframe.contentWindow) {
      try {
        iframe.contentWindow.postMessage(JSON.stringify({
          event: 'command',
          func: func,
          args: args
        }), '*');
      } catch {}
    }
  }

  function setDeckPlayingUI(isPlaying) {
    isDeckPlaying = isPlaying;
    const playIcon = btnDeckPlayPause?.querySelector('.sg-deck-icon-play');
    const pauseIcon = btnDeckPlayPause?.querySelector('.sg-deck-icon-pause');
    if (playIcon && pauseIcon) {
      playIcon.style.display = isPlaying ? 'none' : 'block';
      pauseIcon.style.display = isPlaying ? 'block' : 'none';
    }
    if (isPlaying) {
      startDeckTimer();
    } else {
      stopDeckTimer();
    }
  }

  function startDeckTimer() {
    stopDeckTimer();
    deckTicker = setInterval(() => {
      if (!isDeckPlaying) return;
      deckCurrentSeconds += 1;
      if (deckTotalSeconds && deckCurrentSeconds > deckTotalSeconds) {
        deckCurrentSeconds = deckTotalSeconds;
        setDeckPlayingUI(false);
      }
      if (deckVideoCurrentTime) deckVideoCurrentTime.textContent = formatTime(deckCurrentSeconds);
      if (deckVideoSeeker && deckTotalSeconds) deckVideoSeeker.value = (deckCurrentSeconds / deckTotalSeconds) * 100;
    }, 1000);
  }

  function stopDeckTimer() {
    if (deckTicker) {
      clearInterval(deckTicker);
      deckTicker = null;
    }
  }

  function openWatchDeck(video) {
    pauseLocalPlayer();
    activeDeckVideo = video;
    if (!sgWatchDeck) return;
    disableMiniPlayerMode();

    if (deckVideoTitle) deckVideoTitle.textContent = video.title;
    if (deckVideoTitleBar) deckVideoTitleBar.textContent = video.title || 'StreamGrab Player';
    if (deckVideoChannel) deckVideoChannel.textContent = video.uploader || 'YouTube';
    if (deckVideoViews) deckVideoViews.textContent = video.views_str || '';

    // Initialize custom deck timeline matching our music/video player UX
    deckTotalSeconds = video.duration || 0;
    deckCurrentSeconds = 0;
    if (deckVideoTotalTime) deckVideoTotalTime.textContent = formatTime(deckTotalSeconds);
    if (deckVideoCurrentTime) deckVideoCurrentTime.textContent = '00:00';
    if (deckVideoSeeker) deckVideoSeeker.value = 0;
    setDeckPlayingUI(true);

    // Update external YouTube link
    const ytUrl = `https://www.youtube.com/watch?v=${video.id}`;
    if (btnDeckWatchYt) btnDeckWatchYt.href = ytUrl;
    if (linkFallbackYt) linkFallbackYt.href = ytUrl;

    // Load default player (YouTube with referer & origin params)
    loadPlayerSource('youtube');

    // Bottom Side: default quality from global setting
    const globalQ = settingQualityVal ? settingQualityVal.textContent : 'Auto 1080p';
    if (globalQ.includes('720')) deckQuality = '720';
    else if (globalQ.includes('480')) deckQuality = '480';
    else if (globalQ.includes('320')) { deckQuality = '320'; deckType = 'audio'; }
    else deckQuality = '1080';

    updateDeckControlsUI();

    sgWatchDeck.style.display = 'block';
    sgWatchDeck.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function closeWatchDeck() {
    if (!sgWatchDeck) return;
    stopDeckTimer();
    setDeckPlayingUI(false);
    disableMiniPlayerMode();
    sgWatchDeck.style.display = 'none';
    inlinePlayerContainer.innerHTML = '';
    if (deckVideoTitleBar) deckVideoTitleBar.textContent = 'StreamGrab Player';
    activeDeckVideo = null;
  }

  function updateDeckControlsUI() {
    if (!deckQualityChips || !deckFormatToggle) return;

    deckQualityChips.querySelectorAll('.sg-chip').forEach(c => {
      c.classList.toggle('active', c.dataset.quality === deckQuality);
    });

    deckFormatToggle.querySelectorAll('.sg-toggle-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.val === deckType);
    });

    if (deckDownloadBtnText) {
      deckDownloadBtnText.textContent = deckType === 'video'
        ? `Download Video (${deckQuality}p)`
        : `Download Audio (MP3 ${deckQuality}k)`;
    }

    if (deckCollapsedQualityBadge) {
      deckCollapsedQualityBadge.textContent = deckType === 'video'
        ? `${deckQuality}p MP4`
        : `MP3 ${deckQuality}k`;
    }
  }

  if (btnCloseDeck) {
    btnCloseDeck.addEventListener('click', closeWatchDeck);
  }

  // Main Player Custom Control Buttons (Rewind -10s, Play/Pause, Forward +10s, Seeker)
  if (btnDeckPlayPause) {
    btnDeckPlayPause.addEventListener('click', (e) => {
      e.stopPropagation();
      if (isDeckPlaying) {
        sendIframeCommand('pauseVideo');
        setDeckPlayingUI(false);
      } else {
        pauseLocalPlayer();
        sendIframeCommand('playVideo');
        setDeckPlayingUI(true);
      }
    });
  }

  if (btnDeckRewind10) {
    btnDeckRewind10.addEventListener('click', (e) => {
      e.stopPropagation();
      deckCurrentSeconds = Math.max(0, deckCurrentSeconds - 10);
      sendIframeCommand('seekTo', [deckCurrentSeconds, true]);
      if (deckVideoCurrentTime) deckVideoCurrentTime.textContent = formatTime(deckCurrentSeconds);
      if (deckVideoSeeker && deckTotalSeconds) deckVideoSeeker.value = (deckCurrentSeconds / deckTotalSeconds) * 100;
    });
  }

  if (btnDeckForward10) {
    btnDeckForward10.addEventListener('click', (e) => {
      e.stopPropagation();
      deckCurrentSeconds = Math.min(deckTotalSeconds || 9999, deckCurrentSeconds + 10);
      sendIframeCommand('seekTo', [deckCurrentSeconds, true]);
      if (deckVideoCurrentTime) deckVideoCurrentTime.textContent = formatTime(deckCurrentSeconds);
      if (deckVideoSeeker && deckTotalSeconds) deckVideoSeeker.value = (deckCurrentSeconds / deckTotalSeconds) * 100;
    });
  }

  if (deckVideoSeeker) {
    deckVideoSeeker.addEventListener('input', () => {
      if (deckTotalSeconds) {
        deckCurrentSeconds = (deckVideoSeeker.value / 100) * deckTotalSeconds;
        if (deckVideoCurrentTime) deckVideoCurrentTime.textContent = formatTime(deckCurrentSeconds);
        sendIframeCommand('seekTo', [deckCurrentSeconds, true]);
      }
    });
  }

  // Resolution Adjuster Menu (Keeps YouTube controls hidden while giving quality selector)
  if (btnDeckResMenu && deckResDropdown) {
    btnDeckResMenu.addEventListener('click', (e) => {
      e.stopPropagation();
      const isHidden = deckResDropdown.style.display === 'none';
      deckResDropdown.style.display = isHidden ? 'flex' : 'none';
    });

    deckResDropdown.querySelectorAll('.sg-res-option').forEach(opt => {
      opt.addEventListener('click', (e) => {
        e.stopPropagation();
        const res = opt.dataset.res;
        const label = opt.dataset.label || opt.textContent.trim();
        deckResDropdown.querySelectorAll('.sg-res-option').forEach(o => o.classList.remove('active'));
        opt.classList.add('active');
        if (deckCurrentResLabel) deckCurrentResLabel.textContent = label;
        deckResDropdown.style.display = 'none';

        sendIframeCommand('setPlaybackQualityRange', [res, res]);
        sendIframeCommand('setPlaybackQuality', [res]);
        showToast(`Video resolution set to ${label}`, 'info', 2000);
      });
    });

    document.addEventListener('click', (e) => {
      if (!e.target.closest('#deck-res-selector-wrap')) {
        deckResDropdown.style.display = 'none';
      }
    });
  }

  // Collapsible Download Options Section Toggle
  if (btnToggleDownloadDeck && deckDownloadContent) {
    btnToggleDownloadDeck.addEventListener('click', (e) => {
      e.stopPropagation();
      const isHidden = deckDownloadContent.style.display === 'none';
      deckDownloadContent.style.display = isHidden ? 'flex' : 'none';
      if (deckDownloadBox) deckDownloadBox.classList.toggle('is-expanded', isHidden);
      if (deckAccordionHint) {
        deckAccordionHint.textContent = isHidden ? 'Click to hide options' : 'Click to show options';
      }
    });
  }

  // Share Video Action Listeners
  if (btnDeckShare) {
    btnDeckShare.addEventListener('click', (e) => {
      e.stopPropagation();
      if (activeDeckVideo) {
        shareVideo(activeDeckVideo.title, activeDeckVideo.url);
      }
    });
  }

  if (btnDeckShareLink) {
    btnDeckShareLink.addEventListener('click', (e) => {
      e.stopPropagation();
      if (activeDeckVideo) {
        shareVideo(activeDeckVideo.title, activeDeckVideo.url);
      }
    });
  }

  if (btnLocalPlayerShare) {
    btnLocalPlayerShare.addEventListener('click', (e) => {
      e.stopPropagation();
      if (currentPlaylist.length > 0 && currentPlaylist[currentTrackIndex]) {
        const trk = currentPlaylist[currentTrackIndex];
        shareVideo(trk.title, trk.url || window.location.href);
      }
    });
  }

  // Picture-in-Picture Action Listeners
  if (btnDeckPip) {
    btnDeckPip.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleDeckPictureInPicture();
    });
  }

  if (btnVideoPip) {
    btnVideoPip.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleNativeVideoPip();
    });
  }

  // Draggable Mini Player Engine (Mouse, Touch, Pen)
  let isDraggingMini = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let initialLeft = 0;
  let initialTop = 0;
  let hasDragged = false;

  function initMiniPlayerDraggable() {
    if (!sgWatchDeck) return;

    const dragHandles = [
      document.getElementById('mini-drag-handle'),
      document.getElementById('sg-player-deck-header'),
      document.getElementById('deck-drag-title-info')
    ].filter(Boolean);

    dragHandles.forEach(handle => {
      handle.addEventListener('pointerdown', (e) => {
        if (!sgWatchDeck.classList.contains('sg-mini-mode')) return;
        if (e.target.closest('button') || e.target.closest('#mini-resize-handle')) return;

        isDraggingMini = true;
        hasDragged = false;
        dragStartX = e.clientX;
        dragStartY = e.clientY;

        const rect = sgWatchDeck.getBoundingClientRect();
        initialLeft = rect.left;
        initialTop = rect.top;

        sgWatchDeck.classList.add('is-positioned');
        sgWatchDeck.classList.add('is-dragging');
        sgWatchDeck.style.left = `${initialLeft}px`;
        sgWatchDeck.style.top = `${initialTop}px`;
        sgWatchDeck.style.bottom = 'auto';
        sgWatchDeck.style.right = 'auto';

        try {
          handle.setPointerCapture(e.pointerId);
        } catch {}
      });

      handle.addEventListener('pointermove', (e) => {
        if (!isDraggingMini) return;
        const dx = e.clientX - dragStartX;
        const dy = e.clientY - dragStartY;

        if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
          hasDragged = true;
        }

        const rect = sgWatchDeck.getBoundingClientRect();
        const maxLeft = window.innerWidth - rect.width - 6;
        const maxTop = window.innerHeight - rect.height - 6;

        const newLeft = Math.max(6, Math.min(maxLeft, initialLeft + dx));
        const newTop = Math.max(6, Math.min(maxTop, initialTop + dy));

        sgWatchDeck.style.left = `${newLeft}px`;
        sgWatchDeck.style.top = `${newTop}px`;
      });

      const onPointerEnd = (e) => {
        if (!isDraggingMini) return;
        isDraggingMini = false;
        sgWatchDeck.classList.remove('is-dragging');
        try {
          handle.releasePointerCapture(e.pointerId);
        } catch {}
      };

      handle.addEventListener('pointerup', onPointerEnd);
      handle.addEventListener('pointercancel', onPointerEnd);
    });
  }

  initMiniPlayerDraggable();

  // YouTube IFrame postMessage state synchronization
  window.addEventListener('message', (e) => {
    try {
      const data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
      if (data && data.event === 'onStateChange') {
        if (data.info === 1) { // Playing
          pauseLocalPlayer();
          setDeckPlayingUI(true);
        } else if (data.info === 2 || data.info === 0) { // Paused or ended
          setDeckPlayingUI(false);
        }
      }
    } catch {}
  });

  if (btnDeckMinimize) {
    btnDeckMinimize.addEventListener('click', (e) => {
      e.stopPropagation();
      enableMiniPlayerMode();
      showToast('Video docked to corner mini player', 'info', 2200);
    });
  }

  if (btnDeckExpandMini) {
    btnDeckExpandMini.addEventListener('click', (e) => {
      e.stopPropagation();
      disableMiniPlayerMode();
      switchTab('section-search');
      sgWatchDeck.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  if (sgWatchDeck) {
    sgWatchDeck.addEventListener('click', (e) => {
      if (sgWatchDeck.classList.contains('sg-mini-mode')) {
        if (hasDragged) {
          hasDragged = false;
          return;
        }
        if (
          !e.target.closest('#btn-close-deck') &&
          !e.target.closest('#btn-deck-expand-mini') &&
          !e.target.closest('#btn-deck-size-toggle') &&
          !e.target.closest('#btn-deck-share') &&
          !e.target.closest('#btn-deck-pip') &&
          !e.target.closest('#mini-resize-handle') &&
          !e.target.closest('#mini-drag-handle')
        ) {
          disableMiniPlayerMode();
          switchTab('section-search');
          sgWatchDeck.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    });
  }

  // -----------------------------------------------------------
  // YouTube-Style Mini Player Resizable Width Engine
  // -----------------------------------------------------------
  function setMiniPlayerWidth(newWidth) {
    const maxW = Math.min(680, window.innerWidth - 20);
    const clamped = Math.max(250, Math.min(maxW, newWidth));
    if (sgWatchDeck) {
      sgWatchDeck.style.setProperty('--mini-deck-width', `${clamped}px`);
    }
    localStorage.setItem('streamgrab_mini_width', clamped);
    return clamped;
  }

  // Restore saved width if present
  const savedMiniWidth = localStorage.getItem('streamgrab_mini_width');
  if (savedMiniWidth && sgWatchDeck) {
    const w = parseInt(savedMiniWidth, 10);
    if (!isNaN(w) && w >= 250 && w <= 700) {
      sgWatchDeck.style.setProperty('--mini-deck-width', `${w}px`);
    }
  }

  if (miniResizeHandle) {
    let isResizing = false;
    let startX = 0;
    let startWidth = 360;

    const onStartResize = (clientX) => {
      if (!sgWatchDeck || !sgWatchDeck.classList.contains('sg-mini-mode')) return;
      isResizing = true;
      startX = clientX;
      startWidth = sgWatchDeck.getBoundingClientRect().width;
      sgWatchDeck.classList.add('is-resizing');
      document.body.style.userSelect = 'none';
    };

    const onMoveResize = (clientX) => {
      if (!isResizing) return;
      const deltaX = startX - clientX;
      setMiniPlayerWidth(startWidth + deltaX);
    };

    const onEndResize = () => {
      if (!isResizing) return;
      isResizing = false;
      if (sgWatchDeck) sgWatchDeck.classList.remove('is-resizing');
      document.body.style.userSelect = '';
    };

    miniResizeHandle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      onStartResize(e.clientX);
    });

    miniResizeHandle.addEventListener('touchstart', (e) => {
      if (e.touches && e.touches.length > 0) {
        onStartResize(e.touches[0].clientX);
      }
    }, { passive: true });

    window.addEventListener('mousemove', (e) => {
      if (isResizing) onMoveResize(e.clientX);
    });

    window.addEventListener('touchmove', (e) => {
      if (isResizing && e.touches && e.touches.length > 0) {
        onMoveResize(e.touches[0].clientX);
      }
    }, { passive: true });

    window.addEventListener('mouseup', onEndResize);
    window.addEventListener('touchend', onEndResize);
  }

  if (btnDeckSizeToggle) {
    const sizePresets = [280, 360, 480];
    let presetIdx = 1;
    btnDeckSizeToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      presetIdx = (presetIdx + 1) % sizePresets.length;
      const chosen = setMiniPlayerWidth(sizePresets[presetIdx]);
      showToast(`Mini Player: ${chosen}px`, 'info', 1500);
    });
  }

  if (deckSourceChips) {
    deckSourceChips.addEventListener('click', (e) => {
      const btn = e.target.closest('.sg-source-btn');
      if (!btn) return;
      loadPlayerSource(btn.dataset.source);
    });
  }

  if (btnSwitchBypass) {
    btnSwitchBypass.addEventListener('click', () => {
      loadPlayerSource('invidious');
    });
  }

  if (deckQualityChips) {
    deckQualityChips.addEventListener('click', (e) => {
      const chip = e.target.closest('.sg-chip');
      if (!chip) return;

      deckQuality = chip.dataset.quality;
      deckType = chip.dataset.type || (['320', '192'].includes(deckQuality) ? 'audio' : 'video');
      updateDeckControlsUI();
    });
  }

  if (deckFormatToggle) {
    deckFormatToggle.addEventListener('click', (e) => {
      const btn = e.target.closest('.sg-toggle-btn');
      if (!btn) return;

      deckType = btn.dataset.val;
      if (deckType === 'audio' && !['320', '192'].includes(deckQuality)) {
        deckQuality = '320';
      } else if (deckType === 'video' && ['320', '192'].includes(deckQuality)) {
        deckQuality = '1080';
      }
      updateDeckControlsUI();
    });
  }

  if (btnDeckDownload) {
    btnDeckDownload.addEventListener('click', () => {
      if (!activeDeckVideo) return;
      queueDirectDownload([activeDeckVideo.url], deckType, deckQuality, false);

      const origText = deckDownloadBtnText.textContent;
      deckDownloadBtnText.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="sg-btn-svg"><polyline points="20 6 9 17 4 12"></polyline></svg> Starting Download...';
      btnDeckDownload.style.backgroundColor = 'var(--sg-green)';

      setTimeout(() => {
        deckDownloadBtnText.textContent = origText;
        btnDeckDownload.style.backgroundColor = '';
      }, 1800);
    });
  }

  if (btnDeckAddBatch) {
    btnDeckAddBatch.addEventListener('click', () => {
      if (!activeDeckVideo) return;
      addVideoToBatch({
        url: activeDeckVideo.url,
        title: activeDeckVideo.title,
        thumbnail: activeDeckVideo.thumbnail,
        duration_str: activeDeckVideo.duration_str,
        selectedQuality: deckQuality,
        selectedType: deckType
      });
      btnDeckAddBatch.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="sg-btn-svg"><polyline points="20 6 9 17 4 12"></polyline></svg> <span>Added to Batch</span>';
      setTimeout(() => {
        btnDeckAddBatch.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" class="sg-btn-svg"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg> <span>Add to Batch</span>';
      }, 1500);
    });
  }

  // -----------------------------------------------------------
  // Screen 1: Search & Feed (Matching Screen 1)
  // -----------------------------------------------------------
  async function performSearch(query, displayTitle, isInitialFeed = false) {
    const q = (query || searchInput.value || '').trim();
    if (!q) {
      searchInput.focus();
      return;
    }

    if (!navigator.onLine) {
      showToast('You are currently offline. Switching to your saved Offline Library.', 'warning', 3000);
      switchTab('section-queue');
      if (tabDownloadsOffline) tabDownloadsOffline.click();
      return;
    }

    const match = YOUTUBE_REGEX.exec(q);
    if (match) {
      const videoId = match[1];
      const directVideo = {
        id: videoId,
        url: `https://www.youtube.com/watch?v=${videoId}`,
        title: `YouTube Video (${videoId})`,
        thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        duration_str: 'Ready',
        uploader: 'YouTube',
        views_str: ''
      };
      openWatchDeck(directVideo);
      searchInput.value = '';
      btnSearchClear.style.display = 'none';
      return;
    }

    if (!isInitialFeed) {
      searchInput.value = q;
      btnSearchClear.style.display = 'block';
    } else {
      searchInput.value = '';
      btnSearchClear.style.display = 'none';
    }
    searchStatusBar.style.display = 'flex';
    searchStatusText.textContent = `Searching YouTube for "${q}"...`;
    searchResultsGrid.innerHTML = '';
    btnSearchIcon.disabled = true;

    if (resultsHeading) {
      resultsHeading.textContent = displayTitle || (q.length > 20 ? `Results: "${q.slice(0, 20)}..."` : `Results: "${q}"`);
    }

    try {
      const response = await fetch(`/api/search?q=${encodeURIComponent(q)}&limit=14`);
      const data = await response.json();

      searchStatusBar.style.display = 'none';
      btnSearchIcon.disabled = false;

      if (!response.ok || !data.success) {
        searchResultsGrid.innerHTML = `
          <div class="sg-empty-state">
            <p style="color: var(--sg-red); font-weight: 700;">Search error: ${escapeHtml(data.error || 'Failed to search.')}</p>
          </div>
        `;
        return;
      }

      const results = data.results || [];
      if (resultsCountBadge) {
        resultsCountBadge.textContent = `${results.length} Videos`;
      }

      if (results.length === 0) {
        searchResultsGrid.innerHTML = `
          <div class="sg-empty-state">
            <p>No results found for "${escapeHtml(q)}". Try different keywords or paste a link.</p>
          </div>
        `;
        return;
      }

      renderSearchResults(results);

    } catch (err) {
      console.error('Search error:', err);
      searchStatusBar.style.display = 'none';
      btnSearchIcon.disabled = false;
      searchResultsGrid.innerHTML = `
        <div class="sg-empty-state">
          <p style="color: var(--sg-red);">Connection error while searching YouTube. Offline?</p>
        </div>
      `;
    }
  }

  function renderSearchResults(results) {
    searchResultsGrid.innerHTML = '';

    results.forEach(item => {
      const card = document.createElement('div');
      card.className = 'sg-video-card';
      card.setAttribute('role', 'listitem');

      const durHtml = item.duration_str ? `<span class="sg-duration-tag">${item.duration_str}</span>` : '';
      const viewsStr = item.views_str ? item.views_str : '';
      const channelName = item.uploader || 'StreamGrab';

      card.innerHTML = `
        <div class="sg-thumb-wrap" title="Tap to Play Online">
          <img class="sg-thumb-img" src="${escapeHtml(item.thumbnail)}" alt="${escapeHtml(item.title)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.onerror=null; this.src='https://i.ytimg.com/vi/${escapeHtml(item.id)}/hqdefault.jpg';" />
          ${durHtml}
        </div>

        <div class="sg-card-info">
          <h4 class="sg-video-title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</h4>
          
          <div class="sg-channel-row">
            <div class="sg-channel-meta">
              <span class="sg-channel-name" title="${escapeHtml(channelName)}">by ${escapeHtml(channelName)}</span>
              <span class="sg-views-tag">${escapeHtml(viewsStr)}</span>
            </div>
            <div style="display: flex; align-items: center; gap: 4px;">
              <button type="button" class="sg-btn-ghost btn-sm btn-card-share" title="Share Video">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                  <circle cx="18" cy="5" r="3"></circle>
                  <circle cx="6" cy="12" r="3"></circle>
                  <circle cx="18" cy="19" r="3"></circle>
                  <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
                  <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
                </svg>
              </button>
              <button type="button" class="sg-btn-download-icon" title="Watch Online & Download">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.6">
                  <polygon points="5 3 19 12 5 21 5 3" fill="#ffffff"></polygon>
                </svg>
              </button>
            </div>
          </div>
        </div>
      `;

      // Clicking ANY part of the card launches the Upper Video Player + Bottom Download Options!
      const triggerWatch = () => openWatchDeck(item);
      card.querySelector('.sg-thumb-wrap').addEventListener('click', triggerWatch);
      card.querySelector('.sg-video-title').addEventListener('click', triggerWatch);
      card.querySelector('.btn-card-share').addEventListener('click', (e) => {
        e.stopPropagation();
        shareVideo(item.title, item.url);
      });
      card.querySelector('.sg-btn-download-icon').addEventListener('click', (e) => {
        e.stopPropagation();
        triggerWatch();
      });

      searchResultsGrid.appendChild(card);
    });
  }

  // Omnibox events
  btnSearchIcon.addEventListener('click', () => performSearch());
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') performSearch();
  });

  searchInput.addEventListener('input', () => {
    btnSearchClear.style.display = searchInput.value ? 'block' : 'none';
  });

  btnSearchClear.addEventListener('click', () => {
    searchInput.value = '';
    btnSearchClear.style.display = 'none';
    searchInput.focus();
  });

  // -----------------------------------------------------------
  // Working Voice Search (Web Speech API)
  // -----------------------------------------------------------
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognition = null;
  let isListeningVoice = false;

  if (btnMicIcon) {
    if (SpeechRecognition) {
      recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onstart = () => {
        isListeningVoice = true;
        btnMicIcon.classList.add('is-listening');
        btnMicIcon.title = 'Listening... Click to stop';
        if (searchInput) searchInput.placeholder = 'Listening... Speak now';
        showToast('Listening... Speak your search query', 'info', 2500);
      };

      recognition.onresult = (e) => {
        let transcript = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          transcript += e.results[i][0].transcript;
        }
        if (searchInput) searchInput.value = transcript;
        if (btnSearchClear) btnSearchClear.style.display = transcript ? 'block' : 'none';
      };

      recognition.onerror = (e) => {
        isListeningVoice = false;
        btnMicIcon.classList.remove('is-listening');
        if (searchInput) searchInput.placeholder = 'Search YouTube, trending, Japanese, music or paste link...';
        if (e.error === 'not-allowed') {
          showToast('Microphone access was denied. Please allow microphone permission in browser.', 'warning', 3500);
        } else if (e.error === 'no-speech') {
          showToast('No speech detected. Please speak again.', 'info', 2000);
        }
      };

      recognition.onend = () => {
        isListeningVoice = false;
        btnMicIcon.classList.remove('is-listening');
        btnMicIcon.title = 'Voice Search (Click to speak)';
        if (searchInput) {
          searchInput.placeholder = 'Search YouTube, trending, Japanese, music or paste link...';
          const q = searchInput.value.trim();
          if (q) {
            performSearch(q);
          }
        }
      };

      btnMicIcon.addEventListener('click', () => {
        if (isListeningVoice) {
          recognition.stop();
        } else {
          try {
            recognition.start();
          } catch (err) {
            console.warn('SpeechRecognition start error:', err);
          }
        }
      });
    } else {
      btnMicIcon.addEventListener('click', () => {
        showToast('Voice search is not supported in this browser. Please type to search.', 'warning', 3500);
      });
    }
  }

  filterChips.forEach(chip => {
    chip.addEventListener('click', () => {
      filterChips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      performSearch(chip.dataset.query, chip.textContent);
    });
  });

  // -----------------------------------------------------------
  // Screen 2: Batch Downloader (Matching Screen 2)
  // -----------------------------------------------------------
  function addVideoToBatch(item) {
    const exists = batchItems.some(b => b.url === item.url);
    if (!exists) {
      batchItems.push({
        id: `batch_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
        url: item.url,
        title: item.title || item.url,
        thumbnail: item.thumbnail || `https://i.ytimg.com/vi/${extractVideoId(item.url)}/hqdefault.jpg`,
        duration_str: item.duration_str || '00:00',
        selectedQuality: item.selectedQuality || '1080',
        selectedType: item.selectedType || 'video',
        checked: true
      });
    }
    renderBatchItems();
  }

  function extractVideoId(url) {
    const match = YOUTUBE_REGEX.exec(url);
    return match ? match[1] : '';
  }

  function renderBatchItems() {
    batchItemsList.innerHTML = '';

    if (batchItems.length === 0) {
      batchEmptyPlaceholder.style.display = 'block';
      batchDetectedCount.textContent = '0 Links Added';
      batchSelectedCountLabel.textContent = '0 videos selected';
      btnStartBatch.disabled = true;
      btnStartBatch.style.opacity = '0.6';
      return;
    }

    batchEmptyPlaceholder.style.display = 'none';
    btnStartBatch.disabled = false;
    btnStartBatch.style.opacity = '1';

    let selectedCount = 0;

    batchItems.forEach((item, index) => {
      if (item.checked) selectedCount += 1;

      const card = document.createElement('div');
      card.className = 'sg-batch-item-card';

      card.innerHTML = `
        <input type="checkbox" class="sg-batch-check" ${item.checked ? 'checked' : ''} />
        
        <div class="sg-batch-thumb-wrap">
          <img class="sg-batch-thumb" src="${escapeHtml(item.thumbnail)}" alt="Thumb" loading="lazy" referrerpolicy="no-referrer" onerror="this.onerror=null; this.src='https://i.ytimg.com/vi/${escapeHtml(extractVideoId(item.url))}/hqdefault.jpg';" />
          <span class="sg-batch-duration">${escapeHtml(item.duration_str)}</span>
        </div>

        <div class="sg-batch-info">
          <h4 class="sg-batch-title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</h4>
          <div class="sg-item-chips">
            <button type="button" class="sg-mini-chip ${item.selectedQuality === '1080' ? 'active' : ''}" data-q="1080" data-t="video">1080p</button>
            <button type="button" class="sg-mini-chip ${item.selectedQuality === '720' ? 'active' : ''}" data-q="720" data-t="video">720p</button>
            <button type="button" class="sg-mini-chip ${item.selectedQuality === '320' ? 'active' : ''}" data-q="320" data-t="audio">MP3</button>
            <button type="button" class="sg-mini-chip ${item.selectedType === 'video' && item.selectedQuality !== '1080' && item.selectedQuality !== '720' ? 'active' : ''}" data-q="480" data-t="video">MP4</button>
          </div>
        </div>

        <button type="button" class="sg-btn-remove-item" title="Remove video">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      `;

      const checkEl = card.querySelector('.sg-batch-check');
      checkEl.addEventListener('change', () => {
        item.checked = checkEl.checked;
        updateBatchCountSummary();
      });

      const chips = card.querySelectorAll('.sg-mini-chip');
      chips.forEach(chip => {
        chip.addEventListener('click', () => {
          chips.forEach(c => c.classList.remove('active'));
          chip.classList.add('active');
          item.selectedQuality = chip.dataset.q;
          item.selectedType = chip.dataset.t;
        });
      });

      card.querySelector('.sg-btn-remove-item').addEventListener('click', () => {
        batchItems.splice(index, 1);
        renderBatchItems();
      });

      batchItemsList.appendChild(card);
    });

    updateBatchCountSummary();
  }

  function updateBatchCountSummary() {
    const total = batchItems.length;
    const selected = batchItems.filter(i => i.checked).length;
    batchDetectedCount.textContent = `${total} ${total === 1 ? 'Link' : 'Links'} Added`;
    batchSelectedCountLabel.textContent = `${selected} ${selected === 1 ? 'video' : 'videos'} selected`;
  }

  function handleAddSingleBatchUrl() {
    const raw = batchSingleInput.value.trim();
    if (!raw) return;

    const match = YOUTUBE_REGEX.exec(raw);
    if (!match) {
      batchValidationMsg.textContent = 'Please enter a valid YouTube video link.';
      setTimeout(() => { batchValidationMsg.textContent = ''; }, 3000);
      return;
    }

    const vid = match[1];
    addVideoToBatch({
      url: `https://www.youtube.com/watch?v=${vid}`,
      title: `YouTube Video (${vid})`,
      thumbnail: `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`,
      duration_str: '00:00',
      selectedQuality: settingQualityVal.textContent.includes('720') ? '720' : '1080',
      selectedType: settingFormatVal.textContent === 'MP3' ? 'audio' : 'video'
    });

    batchSingleInput.value = '';
    batchValidationMsg.textContent = '';
  }

  btnAddBatchUrl.addEventListener('click', handleAddSingleBatchUrl);
  batchSingleInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleAddSingleBatchUrl();
  });

  btnToggleBulkTextarea.addEventListener('click', () => {
    const isHidden = bulkTextareaContainer.style.display === 'none';
    bulkTextareaContainer.style.display = isHidden ? 'block' : 'none';
    btnToggleBulkTextarea.textContent = isHidden ? '- Hide multi-line box' : '+ Or paste multiple URLs at once';
  });

  btnPasteClipboard.addEventListener('click', async () => {
    try {
      if (!navigator.clipboard || !navigator.clipboard.readText) {
        batchSingleInput.focus();
        return;
      }
      const text = await navigator.clipboard.readText();
      if (!text || !text.trim()) return;

      const lines = extractYouTubeUrls(text);
      if (lines.length > 1) {
        bulkTextareaContainer.style.display = 'block';
        urlsInput.value = lines.join('\n');
        btnToggleBulkTextarea.textContent = '- Hide multi-line box';
      } else if (lines.length === 1) {
        batchSingleInput.value = lines[0];
        handleAddSingleBatchUrl();
      }
    } catch (err) {
      console.warn('Clipboard read error:', err);
    }
  });

  btnAddBulk.addEventListener('click', () => {
    const urls = extractYouTubeUrls(urlsInput.value);
    if (urls.length === 0) {
      batchValidationMsg.textContent = 'No valid URLs found in textarea.';
      return;
    }

    urls.forEach(url => {
      const vid = extractVideoId(url);
      addVideoToBatch({
        url: url,
        title: `YouTube Video (${vid})`,
        thumbnail: `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`,
        duration_str: '00:00',
        selectedQuality: '1080',
        selectedType: 'video'
      });
    });

    urlsInput.value = '';
    bulkTextareaContainer.style.display = 'none';
    btnToggleBulkTextarea.textContent = '+ Or paste multiple URLs at once';
    batchValidationMsg.textContent = '';
  });

  btnClearBatch.addEventListener('click', () => {
    batchItems.length = 0;
    renderBatchItems();
  });

  btnStartBatch.addEventListener('click', async () => {
    const selected = batchItems.filter(i => i.checked);
    if (selected.length === 0) {
      showToast('Please check at least one video to download.', 'warning', 3000);
      return;
    }

    btnStartBatch.disabled = true;
    btnStartBatch.querySelector('.sg-cta-main').textContent = 'Submitting Batch...';

    for (const item of selected) {
      await queueDirectDownload([item.url], item.selectedType, item.selectedQuality, false);
    }

    for (let i = batchItems.length - 1; i >= 0; i--) {
      if (batchItems[i].checked) {
        batchItems.splice(i, 1);
      }
    }

    renderBatchItems();
    btnStartBatch.disabled = false;
    btnStartBatch.querySelector('.sg-cta-main').textContent = 'Start Batch Download';

    switchTab('section-queue');
  });

  function extractYouTubeUrls(rawText) {
    if (!rawText) return [];
    let text = rawText.replace(/(\S)(https?:\/\/)/gi, '$1\n$2');
    text = text.replace(/[,;\t<>"'`()[\]{}]+/g, '\n');
    const lines = text.split('\n');
    const seen = new Set();
    const valid = [];
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      const m = YOUTUBE_REGEX.exec(line);
      if (m) {
        const canonical = `https://www.youtube.com/watch?v=${m[1]}`;
        if (!seen.has(canonical)) {
          seen.add(canonical);
          valid.push(canonical);
        }
      }
    }
    return valid;
  }

  // -----------------------------------------------------------
  // Screen 3: Downloads Queue (Active, Completed & Offline Library)
  // -----------------------------------------------------------
  tabDownloadsActive.addEventListener('click', () => {
    tabDownloadsActive.classList.add('active');
    tabDownloadsCompleted.classList.remove('active');
    tabDownloadsOffline.classList.remove('active');
    paneActiveDownloads.style.display = 'block';
    paneCompletedDownloads.style.display = 'none';
    paneOfflineDownloads.style.display = 'none';
  });

  tabDownloadsCompleted.addEventListener('click', () => {
    tabDownloadsCompleted.classList.add('active');
    tabDownloadsActive.classList.remove('active');
    tabDownloadsOffline.classList.remove('active');
    paneCompletedDownloads.style.display = 'block';
    paneActiveDownloads.style.display = 'none';
    paneOfflineDownloads.style.display = 'none';
  });

  tabDownloadsOffline.addEventListener('click', () => {
    tabDownloadsOffline.classList.add('active');
    tabDownloadsActive.classList.remove('active');
    tabDownloadsCompleted.classList.remove('active');
    paneOfflineDownloads.style.display = 'block';
    paneActiveDownloads.style.display = 'none';
    paneCompletedDownloads.style.display = 'none';
    renderOfflineDownloadsList();
  });

  async function queueDirectDownload(urls, type, quality, switchAfter = true) {
    try {
      const response = await fetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls, type, quality })
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        showToast(data.error || 'Failed to start download.', 'error', 3500);
        return;
      }

      for (const job of data.jobs) {
        const jid = job.job_id;
        const vid = extractVideoId(job.url);
        const thumb = vid ? `https://i.ytimg.com/vi/${vid}/hqdefault.jpg` : '';

        queueJobs[jid] = {
          job_id: jid,
          url: job.url,
          media_type: job.media_type || type,
          quality: job.quality || quality,
          status: 'waiting',
          progress: 0,
          title: job.url,
          thumbnail: thumb,
          filename: null,
          speed: '',
          eta: '',
          error: null,
          timerId: null
        };

        const activeCard = createActiveJobCard(jid, job.url, thumb);
        activeEmptyState.style.display = 'none';
        activeDownloadsList.prepend(activeCard);

        pollJobStatus(jid);
      }

      updateQueueCounters();
      if (switchAfter) {
        switchTab('section-queue');
        tabDownloadsActive.click();
      }

    } catch (err) {
      console.error('Error queuing download:', err);
      showToast('Failed to connect to backend server.', 'error', 3500);
    }
  }

  function createActiveJobCard(jobId, url, thumbnail) {
    const card = document.createElement('div');
    card.className = 'sg-active-card';
    card.id = `active-card-${jobId}`;

    card.innerHTML = `
      <div class="sg-active-thumb-wrap">
        <img class="sg-active-thumb" id="active-thumb-${jobId}" src="${escapeHtml(thumbnail)}" alt="Thumb" />
      </div>

      <div class="sg-active-content">
        <h4 class="sg-active-title" id="active-title-${jobId}" title="${escapeHtml(url)}">${escapeHtml(url)}</h4>
        
        <div class="sg-progress-track">
          <div class="sg-progress-fill" id="active-bar-${jobId}" style="width: 2%;"></div>
        </div>

        <div class="sg-progress-stats">
          <span id="active-percent-${jobId}">Connecting...</span>
          <span id="active-speed-${jobId}">Queued</span>
        </div>
      </div>

      <div class="sg-active-actions">
        <button type="button" class="sg-circle-btn sg-btn-pause" id="btn-pause-${jobId}" title="Pause">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="4" width="4" height="16"></rect>
            <rect x="14" y="4" width="4" height="16"></rect>
          </svg>
        </button>
        <button type="button" class="sg-circle-btn sg-btn-cancel" id="btn-cancel-${jobId}" title="Cancel Download">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
    `;

    card.querySelector(`#btn-cancel-${jobId}`).addEventListener('click', () => {
      const j = queueJobs[jobId];
      if (j && j.timerId) clearTimeout(j.timerId);
      delete queueJobs[jobId];
      card.remove();
      updateQueueCounters();
    });

    return card;
  }

  function createCompletedJobCard(job) {
    const card = document.createElement('div');
    card.className = 'sg-completed-card';
    card.id = `completed-card-${job.job_id}`;

    const isVideo = job.media_type === 'video' || (job.filename && job.filename.endsWith('.mp4'));

    card.innerHTML = `
      <div class="sg-completed-top">
        <div class="sg-active-thumb-wrap">
          <img class="sg-active-thumb" src="${escapeHtml(job.thumbnail)}" alt="Thumb" />
        </div>
        <div class="sg-completed-info">
          <h4 class="sg-completed-title" title="${escapeHtml(job.title)}">${escapeHtml(job.title)}</h4>
        </div>
      </div>

      <div class="sg-completed-actions-row">
        <a class="sg-action-link btn-save-to-device" href="/api/file/${encodeURIComponent(job.filename)}" download="${escapeHtml(job.filename)}" style="color: var(--sg-orange); font-weight: 700;" title="Save file directly to Phone/PC Downloads">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" class="sg-btn-svg">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
          </svg>
          <span>Save to Device</span>
        </a>

        <button type="button" class="sg-action-link btn-save-offline" title="Store in Browser IndexedDB for zero-internet playback">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" class="sg-btn-svg">
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
            <polyline points="17 21 17 13 7 13 7 21"></polyline>
            <polyline points="7 3 7 8 15 8"></polyline>
          </svg>
          <span>Save Offline</span>
        </button>

        <button type="button" class="sg-action-link btn-play-completed" title="Play Media">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" class="sg-btn-svg">
            <polygon points="5 3 19 12 5 21 5 3"></polygon>
          </svg>
          <span>Play</span>
        </button>

        <button type="button" class="sg-action-link text-danger btn-delete-completed" title="Remove from completed list">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" class="sg-btn-svg">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
          <span>Remove</span>
        </button>
      </div>
    `;

    card.dataset.filename = job.filename;
    card.dataset.title = job.title || job.filename;
    card.dataset.isVideo = isVideo ? '1' : '0';

    card.querySelector('.btn-play-completed').addEventListener('click', () => {
      const allCompletedCards = Array.from(completedDownloadsList.querySelectorAll('.sg-completed-card'));
      const playlist = allCompletedCards.map(c => {
        const fname = c.dataset.filename || '';
        const isVid = c.dataset.isVideo === '1' || fname.toLowerCase().endsWith('.mp4');
        return {
          title: c.dataset.title || fname.replace(/\.[^/.]+$/, ''),
          artist: 'Completed Downloads',
          media_type: isVid ? 'video' : 'audio',
          url: `/api/file/${encodeURIComponent(fname)}?stream=1`,
          filename: fname,
          thumbnail: '',
          isOffline: false
        };
      });
      const currentIndex = allCompletedCards.indexOf(card);
      if (playlist.length > 0) {
        openPlaylistPlayer(playlist, Math.max(0, currentIndex));
      } else {
        openLocalPlayer(job.filename, isVideo);
      }
    });

    const btnSaveOffline = card.querySelector('.btn-save-offline');
    btnSaveOffline.addEventListener('click', () => {
      saveCompletedDownloadOfflineToDevice(job, btnSaveOffline);
    });

    isMediaSavedOffline(job.filename).then(saved => {
      if (saved) {
        btnSaveOffline.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="sg-btn-svg"><polyline points="20 6 9 17 4 12"></polyline></svg> <span>Saved Offline</span>';
        btnSaveOffline.disabled = true;
        btnSaveOffline.style.color = 'var(--sg-green)';
      }
    });

    card.querySelector('.btn-delete-completed').addEventListener('click', () => {
      card.remove();
      updateQueueCounters();
    });

    return card;
  }

  function triggerDeviceDownload(filename) {
    if (!filename) return;
    try {
      const a = document.createElement('a');
      a.href = `/api/file/${encodeURIComponent(filename)}`;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (e) {
      console.warn('Auto-save download error:', e);
    }
  }

  async function saveCompletedDownloadOfflineToDevice(job, buttonEl) {
    if (!job.filename) return;

    if (buttonEl) {
      buttonEl.disabled = true;
      buttonEl.textContent = 'Saving...';
    }

    try {
      const res = await fetch(`/api/file/${encodeURIComponent(job.filename)}`);
      if (!res.ok) throw new Error('File download failed from server.');
      const blob = await res.blob();

      const isVideo = job.media_type === 'video' || job.filename.endsWith('.mp4');
      const record = {
        id: `offline_${job.job_id || Date.now()}`,
        filename: job.filename,
        title: job.title || job.filename,
        thumbnail: job.thumbnail || '',
        duration_str: 'Offline',
        media_type: isVideo ? 'video' : 'audio',
        size_bytes: blob.size,
        size_str: formatBytes(blob.size),
        blob: blob,
        saved_at: Date.now()
      };

      await saveMediaToOfflineStorage(record);

      if (buttonEl) {
        buttonEl.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="sg-btn-svg"><polyline points="20 6 9 17 4 12"></polyline></svg> <span>Saved Offline</span>';
        buttonEl.disabled = true;
        buttonEl.style.color = 'var(--sg-green)';
      }

      await renderOfflineDownloadsList();
      showToast(`"${record.title}" is saved to this device offline library!`, 'success', 3500);

    } catch (err) {
      console.error('Offline save error:', err);
      if (buttonEl) {
        buttonEl.disabled = false;
        buttonEl.textContent = 'Save Offline';
      }
      showToast('Failed to save to device offline storage: ' + err.message, 'error', 3500);
    }
  }

  async function pollJobStatus(jobId) {
    const job = queueJobs[jobId];
    if (!job) return;

    try {
      const res = await fetch(`/api/status/${jobId}`);
      if (!res.ok) {
        if (res.status === 404) {
          job.status = 'failed';
          job.error = 'Job not found';
          updateActiveJobUI(job);
        }
        return;
      }

      const data = await res.json();
      Object.assign(job, data);
      updateActiveJobUI(job);

      if (job.status === 'completed') {
        const activeCard = document.getElementById(`active-card-${jobId}`);
        if (activeCard) activeCard.remove();

        completedEmptyState.style.display = 'none';
        const completedCard = createCompletedJobCard(job);
        completedDownloadsList.prepend(completedCard);
        updateQueueCounters();

        // Auto-save to device if user preference is enabled
        if (localStorage.getItem('streamgrab_auto_save_device') !== 'false' && job.filename) {
          triggerDeviceDownload(job.filename);
        }
        return;
      }

      if (['waiting', 'fetching', 'downloading', 'converting'].includes(data.status)) {
        const interval = (data.status === 'waiting') ? 2000 : 1200;
        job.timerId = setTimeout(() => pollJobStatus(jobId), interval);
      }

    } catch (err) {
      console.warn('Poll glitch for', jobId, err);
      job.timerId = setTimeout(() => pollJobStatus(jobId), 3000);
    }
  }

  function updateActiveJobUI(job) {
    const jid = job.job_id;
    const titleEl = document.getElementById(`active-title-${jid}`);
    const barEl = document.getElementById(`active-bar-${jid}`);
    const percentEl = document.getElementById(`active-percent-${jid}`);
    const speedEl = document.getElementById(`active-speed-${jid}`);
    const thumbEl = document.getElementById(`active-thumb-${jid}`);

    if (titleEl && job.title) titleEl.textContent = job.title;
    if (thumbEl && job.thumbnail && thumbEl.src !== job.thumbnail) thumbEl.src = job.thumbnail;

    if (!barEl) return;

    if (job.status === 'downloading') {
      const p = Math.max(2, Math.min(99, job.progress || 2));
      barEl.style.width = `${p}%`;
      percentEl.textContent = `${p}%`;
      speedEl.textContent = job.speed || 'Downloading...';
    } else if (job.status === 'converting') {
      barEl.style.width = '100%';
      percentEl.textContent = '100%';
      speedEl.textContent = job.media_type === 'video' ? 'Merging Video...' : 'Encoding MP3...';
    } else if (job.status === 'failed') {
      barEl.style.backgroundColor = 'var(--sg-red)';
      percentEl.textContent = 'Failed';
      speedEl.textContent = job.error ? job.error.slice(0, 30) : 'Error';
    }
  }

  function updateQueueCounters() {
    const all = Object.values(queueJobs);
    const activeCount = all.filter(j => ['waiting', 'fetching', 'downloading', 'converting'].includes(j.status)).length;
    const completedCards = completedDownloadsList.querySelectorAll('.sg-completed-card').length;

    activeTabCounter.textContent = activeCount;
    completedTabCounter.textContent = completedCards;

    if (activeCount > 0) {
      navQueueCount.textContent = activeCount;
      navQueueCount.style.display = 'inline-block';
      activeEmptyState.style.display = 'none';
    } else {
      navQueueCount.style.display = 'none';
      if (activeDownloadsList.children.length <= 1) {
        activeEmptyState.style.display = 'block';
      }
    }

    if (completedCards > 0) {
      completedEmptyState.style.display = 'none';
      btnDownloadAllZip.style.display = 'inline-flex';
    } else {
      completedEmptyState.style.display = 'block';
      btnDownloadAllZip.style.display = 'none';
    }
  }

  btnClearCompleted.addEventListener('click', () => {
    completedDownloadsList.querySelectorAll('.sg-completed-card').forEach(c => c.remove());
    updateQueueCounters();
  });

  btnDownloadAllZip.addEventListener('click', async () => {
    const completedJobIds = Object.keys(queueJobs).filter(jid => queueJobs[jid].status === 'completed');
    try {
      const res = await fetch('/api/download-zip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_ids: completedJobIds })
      });
      if (!res.ok) {
        showToast('Failed to create ZIP file.', 'error', 3500);
        return;
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `streamgrab_downloads_${Date.now()}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      showToast('Network error downloading ZIP.', 'error', 3500);
    }
  });

  const btnSaveAllOffline = document.getElementById('btn-save-all-offline');
  if (btnSaveAllOffline) {
    btnSaveAllOffline.addEventListener('click', async () => {
      const cards = completedDownloadsList.querySelectorAll('.sg-completed-card');
      if (cards.length === 0) {
        showToast('No completed downloads to save offline.', 'info', 3000);
        return;
      }
      btnSaveAllOffline.disabled = true;
      btnSaveAllOffline.innerHTML = '<span>Saving All...</span>';
      let count = 0;
      for (const card of cards) {
        const btnSaveOffline = card.querySelector('.btn-save-offline');
        if (btnSaveOffline && !btnSaveOffline.disabled) {
          btnSaveOffline.click();
          count++;
          await new Promise(r => setTimeout(r, 400));
        }
      }
      btnSaveAllOffline.disabled = false;
      btnSaveAllOffline.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" class="sg-btn-svg"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg> <span>Save All Offline</span>';
      await renderOfflineDownloadsList();
      showToast(`Saved ${count} completed item(s) to device offline storage!`, 'success', 3500);
    });
  }

  // -----------------------------------------------------------
  // Offline Device Storage Library UI
  // -----------------------------------------------------------
  async function renderOfflineDownloadsList() {
    if (!offlineDownloadsList) return;
    offlineDownloadsList.innerHTML = '';

    const items = await getAllOfflineMedia();
    if (offlineTabCounter) offlineTabCounter.textContent = items.length;

    let totalBytes = 0;
    items.forEach(i => { totalBytes += (i.size_bytes || 0); });
    if (settingsOfflineSize) {
      settingsOfflineSize.textContent = `${items.length} Items - ${formatBytes(totalBytes)}`;
    }

    if (items.length === 0) {
      if (offlineEmptyState) {
        offlineEmptyState.style.display = 'block';
        offlineDownloadsList.appendChild(offlineEmptyState);
      }
      return;
    }

    if (offlineEmptyState) offlineEmptyState.style.display = 'none';

    items.forEach(item => {
      const card = document.createElement('div');
      card.className = 'sg-offline-card';
      const isVideo = item.media_type === 'video';

      const thumbHtml = item.thumbnail
        ? `<img class="sg-active-thumb" src="${escapeHtml(item.thumbnail)}" alt="Thumb" />`
        : `<div class="sg-active-thumb" style="display:flex;align-items:center;justify-content:center;background:#1e293b;color:#ff6422;">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              ${isVideo ? '<polygon points="5 3 19 12 5 21 5 3" fill="currentColor"></polygon>' : '<path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle>'}
            </svg>
          </div>`;

      card.innerHTML = `
        <div class="sg-offline-top">
          <div class="sg-active-thumb-wrap">
            ${thumbHtml}
          </div>
          <div class="sg-offline-info">
            <h4 class="sg-offline-title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</h4>
            <div class="sg-offline-meta">
              <span class="sg-badge-offline">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="sg-btn-svg"><polyline points="20 6 9 17 4 12"></polyline></svg>
                <span>Offline Ready</span>
              </span>
              <span>${item.size_str || ''}</span>
              <span>${isVideo ? 'MP4 Video' : 'MP3 Audio'}</span>
            </div>
          </div>
        </div>

        <div class="sg-offline-actions-row">
          <button type="button" class="sg-action-link btn-play-offline" style="color: var(--sg-orange); font-size: 0.82rem; font-weight: 800;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" class="sg-btn-svg">
              <polygon points="5 3 19 12 5 21 5 3"></polygon>
            </svg>
            <span>Play Offline</span>
          </button>
          <button type="button" class="sg-action-link btn-export-offline" title="Save file to phone/PC filesystem">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" class="sg-btn-svg">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
            <span>Save to Device</span>
          </button>
          <button type="button" class="sg-action-link btn-share-offline" title="Share Media">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" class="sg-btn-svg">
              <circle cx="18" cy="5" r="3"></circle>
              <circle cx="6" cy="12" r="3"></circle>
              <circle cx="18" cy="19" r="3"></circle>
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
              <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
            </svg>
            <span>Share</span>
          </button>
          <button type="button" class="sg-action-link text-danger btn-delete-offline">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" class="sg-btn-svg">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
            <span>Remove</span>
          </button>
        </div>
      `;

      card.querySelector('.btn-play-offline').addEventListener('click', () => {
        playOfflineMediaItem(item);
      });

      card.querySelector('.btn-share-offline').addEventListener('click', () => {
        shareVideo(item.title, item.url || window.location.href);
      });

      card.querySelector('.btn-export-offline').addEventListener('click', () => {
        if (item.blob) {
          const url = URL.createObjectURL(item.blob);
          const a = document.createElement('a');
          a.href = url;
          const ext = item.media_type === 'video' ? '.mp4' : '.mp3';
          const filename = item.filename || (item.title + ext);
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          setTimeout(() => URL.revokeObjectURL(url), 10000);
        }
      });

      card.querySelector('.btn-delete-offline').addEventListener('click', async () => {
        const confirmed = await showCustomConfirm('Remove Offline Media', `Remove "${item.title}" from offline device storage?`, 'Remove', true);
        if (confirmed) {
          await deleteOfflineMedia(item.id);
          await renderOfflineDownloadsList();
          showToast(`"${item.title}" removed from offline storage.`, 'info', 2500);
        }
      });

      offlineDownloadsList.appendChild(card);
    });
  }

  async function playOfflineMediaItem(item) {
    const allOffline = await getAllOfflineMedia();
    const playlist = allOffline.map(it => ({
      title: it.title,
      artist: 'Offline Device Storage',
      media_type: it.media_type,
      blob: it.blob,
      thumbnail: it.thumbnail,
      isOffline: true
    }));
    const startIdx = allOffline.findIndex(it => it.id === item.id);
    openPlaylistPlayer(playlist, Math.max(0, startIdx));
  }

  // Local File Import Button (Pick any MP3 / MP4 already on device)
  if (btnImportLocalFile && localFilePicker) {
    btnImportLocalFile.addEventListener('click', () => localFilePicker.click());

    localFilePicker.addEventListener('change', async (e) => {
      const files = Array.from(e.target.files || []);
      if (files.length === 0) return;

      for (const file of files) {
        const isVideo = file.type.startsWith('video') || file.name.endsWith('.mp4') || file.name.endsWith('.webm');
        const record = {
          id: `local_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
          filename: file.name,
          title: file.name.replace(/\.[^/.]+$/, ''),
          thumbnail: '',
          duration_str: 'Local File',
          media_type: isVideo ? 'video' : 'audio',
          size_bytes: file.size,
          size_str: formatBytes(file.size),
          blob: file,
          saved_at: Date.now()
        };
        await saveMediaToOfflineStorage(record);
      }

      localFilePicker.value = '';
      await renderOfflineDownloadsList();
      showToast(`Imported ${files.length} media file(s) into your Offline Library!`, 'success', 3500);
    });
  }

  // Clear all offline storage button
  if (btnClearOffline) {
    btnClearOffline.addEventListener('click', async () => {
      const confirmed = await showCustomConfirm('Clear Offline Library', 'Clear all offline music and videos stored on this device? This cannot be undone.', 'Clear All', true);
      if (confirmed) {
        await clearAllOfflineMedia();
        await renderOfflineDownloadsList();
        showToast('Offline media library cleared.', 'info', 3000);
      }
    });
  }

  // -----------------------------------------------------------
  // Screen 4: Settings (Matching Screen 4)
  // -----------------------------------------------------------
  const settingsFeedChips = document.getElementById('settings-feed-chips');
  const settingsCustomTopicBox = document.getElementById('settings-custom-topic-box');
  const settingsCustomTopicInput = document.getElementById('settings-custom-topic-input');
  const btnSaveCustomTopic = document.getElementById('btn-save-custom-topic');

  function getFeedPreference() {
    return localStorage.getItem('streamgrab_feed_preference') || 'trending';
  }

  function loadPreferredFeed(isInitial = true) {
    const pref = getFeedPreference();
    const customKeyword = localStorage.getItem('streamgrab_feed_custom_keyword') || '';

    if (settingsFeedChips) {
      settingsFeedChips.querySelectorAll('.sg-chip').forEach(chip => {
        chip.classList.toggle('active', chip.dataset.topic === pref);
      });
    }
    if (settingsCustomTopicBox) {
      settingsCustomTopicBox.style.display = pref === 'custom' ? 'block' : 'none';
      if (settingsCustomTopicInput && customKeyword) {
        settingsCustomTopicInput.value = customKeyword;
      }
    }

    // Sync search page filter chips active state if matching
    if (filterChips && filterChips.length > 0) {
      filterChips.forEach(chip => {
        if (pref === 'trending' && chip.dataset.query === 'trending') chip.classList.add('active');
        else if (pref === 'japanese' && chip.dataset.query.includes('Japanese')) chip.classList.add('active');
        else if (pref === 'tech' && chip.dataset.query.includes('programming')) chip.classList.add('active');
        else if (pref === 'music' && chip.dataset.query.includes('music')) chip.classList.add('active');
        else if (pref === 'gaming' && chip.dataset.query.includes('gaming')) chip.classList.add('active');
        else chip.classList.remove('active');
      });
    }

    if (pref === 'japanese') {
      performSearch('Japanese Learning for Beginners Conversation Culture', 'Japanese Learning & Culture', isInitial);
    } else if (pref === 'tech') {
      performSearch('programming coding technology tutorials', 'Coding & Technology', isInitial);
    } else if (pref === 'music') {
      performSearch('popular anime songs soundtrack music', 'Anime & Music Hits', isInitial);
    } else if (pref === 'gaming') {
      performSearch('trending gaming gameplay highlights', 'Gaming Highlights', isInitial);
    } else if (pref === 'custom' && customKeyword.trim()) {
      performSearch(customKeyword.trim(), `Feed: ${customKeyword.trim()}`, isInitial);
    } else {
      performSearch('trending', 'Trending on YouTube', isInitial);
    }
  }

  if (settingsFeedChips) {
    settingsFeedChips.addEventListener('click', (e) => {
      const chip = e.target.closest('.sg-chip');
      if (!chip) return;
      const topic = chip.dataset.topic;

      settingsFeedChips.querySelectorAll('.sg-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');

      if (topic === 'custom') {
        if (settingsCustomTopicBox) settingsCustomTopicBox.style.display = 'block';
        if (settingsCustomTopicInput) settingsCustomTopicInput.focus();
      } else {
        if (settingsCustomTopicBox) settingsCustomTopicBox.style.display = 'none';
        localStorage.setItem('streamgrab_feed_preference', topic);
        showToast(`Feed preference updated: ${chip.textContent.trim()}`, 'success', 2200);
        loadPreferredFeed();
      }
    });
  }

  if (btnSaveCustomTopic && settingsCustomTopicInput) {
    btnSaveCustomTopic.addEventListener('click', () => {
      const val = settingsCustomTopicInput.value.trim();
      if (!val) {
        showToast('Please type a topic keyword.', 'warning', 2500);
        return;
      }
      localStorage.setItem('streamgrab_feed_preference', 'custom');
      localStorage.setItem('streamgrab_feed_custom_keyword', val);
      showToast(`Custom feed saved: "${val}"`, 'success', 2200);
      loadPreferredFeed();
    });
    settingsCustomTopicInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') btnSaveCustomTopic.click();
    });
  }

  if (btnChangeDirectory) btnChangeDirectory.addEventListener('click', openStorageModal);

  if (btnCycleQuality) {
    btnCycleQuality.addEventListener('click', () => {
      qualityIndex = (qualityIndex + 1) % QUALITY_OPTIONS.length;
      settingQualityVal.textContent = QUALITY_OPTIONS[qualityIndex];
      localStorage.setItem('streamgrab_default_quality', QUALITY_OPTIONS[qualityIndex]);
    });
  }

  const savedQ = localStorage.getItem('streamgrab_default_quality');
  if (savedQ && QUALITY_OPTIONS.includes(savedQ)) {
    if (settingQualityVal) settingQualityVal.textContent = savedQ;
    qualityIndex = QUALITY_OPTIONS.indexOf(savedQ);
  }

  if (btnCycleFormat) {
    btnCycleFormat.addEventListener('click', () => {
      formatIndex = (formatIndex + 1) % FORMAT_OPTIONS.length;
      settingFormatVal.textContent = FORMAT_OPTIONS[formatIndex];
      localStorage.setItem('streamgrab_default_format', FORMAT_OPTIONS[formatIndex]);
    });
  }

  const savedF = localStorage.getItem('streamgrab_default_format');
  if (savedF && FORMAT_OPTIONS.includes(savedF)) {
    if (settingFormatVal) settingFormatVal.textContent = savedF;
    formatIndex = FORMAT_OPTIONS.indexOf(savedF);
  }

  if (btnCycleConnections) {
    btnCycleConnections.addEventListener('click', () => {
      connectionsIndex = (connectionsIndex + 1) % CONNECTIONS_OPTIONS.length;
      settingConnectionsVal.textContent = CONNECTIONS_OPTIONS[connectionsIndex];
    });
  }

  if (btnViewOfflineLibrary) {
    btnViewOfflineLibrary.addEventListener('click', () => {
      switchTab('section-queue');
      if (tabDownloadsOffline) tabDownloadsOffline.click();
    });
  }

  if (rowCookies) rowCookies.addEventListener('click', openCookiesModal);

  if (rowDiagnostics) {
    rowDiagnostics.addEventListener('click', async () => {
      if (settingsPingLabel) settingsPingLabel.textContent = 'Testing latency...';
      const t0 = performance.now();
      try {
        const res = await fetch('/api/health?t=' + Date.now());
        const t1 = performance.now();
        const ms = Math.round(t1 - t0);
        if (res.ok) {
          if (settingsPingLabel) settingsPingLabel.textContent = `Online (${ms} ms)`;
          showCustomAlert('Engine Diagnostics', `Engine Status: Online\nNetwork Latency: ${ms} ms\nFFmpeg Converter: Ready\nDeno JS Runtime: Active\nDevice Offline DB: Ready`, 'success');
        } else {
          if (settingsPingLabel) settingsPingLabel.textContent = 'Error (500)';
          showToast('Server returned status 500.', 'error', 3000);
        }
      } catch {
        if (settingsPingLabel) settingsPingLabel.textContent = 'Offline';
        showCustomAlert('Engine Diagnostics', 'Server backend is unreachable.\nOffline media playback from your device remains fully operational.', 'warning');
      }
    });
  }

  if (rowAbout) {
    rowAbout.addEventListener('click', () => {
      showCustomAlert(
        'About StreamGrab',
        'StreamGrab v2.0 Production\n' +
        'High-Performance YouTube Media Downloader & Offline Player\n\n' +
        'Author & Lead Engineer: Rajan Sharma\n' +
        'Role: Full-Stack Software Engineer\n' +
        'Location: Kathmandu, Bagmati Prov, Nepal\n' +
        'Portfolio: https://www.rajansharma.info.np/\n' +
        'GitHub: https://github.com/rajansharma001/youtube_downloader\n' +
        'Contact: email.rajan001@gmail.com\n\n' +
        '• 100% Free, Standalone & Open-Source\n' +
        '• Zero Data Collection, Zero Telemetry\n' +
        '• IndexedDB Offline Device Storage\n' +
        '• Content Credit: YouTube.com & Respective Creators',
        'info'
      );
    });
  }

  // -----------------------------------------------------------
  // Custom Media Player & Playlist Engine (Music & Video)
  // -----------------------------------------------------------
  let currentPlaylist = [];
  let currentTrackIndex = 0;
  let isShuffle = false;
  let repeatMode = 'none';
  let isMediaPlaying = false;
  let activePlayerMode = 'audio';

  function formatTime(sec) {
    if (!sec || isNaN(sec) || sec < 0) return '00:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
  }

  function openPlaylistPlayer(playlist, startIndex = 0) {
    if (!playlist || playlist.length === 0) return;
    currentPlaylist = playlist;
    currentTrackIndex = Math.max(0, Math.min(startIndex, playlist.length - 1));
    loadAndPlayTrack(currentTrackIndex);
    if (localPlayerModal) {
      localPlayerModal.style.display = 'flex';
      document.body.style.overflow = 'hidden';
    }
    if (sgMiniPlayer) sgMiniPlayer.style.display = 'none';
  }

  let userExplicitlyPaused = false;

  function updateMediaSession(track) {
    if (!('mediaSession' in navigator) || !track) return;
    try {
      const art = track.thumbnail || `https://i.ytimg.com/vi/${extractVideoId(track.url || '')}/hqdefault.jpg`;
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title || 'StreamGrab Media',
        artist: track.artist || (track.isOffline ? 'Offline Media' : 'StreamGrab'),
        album: 'StreamGrab Offline',
        artwork: [
          { src: art, sizes: '96x96', type: 'image/jpeg' },
          { src: art, sizes: '192x192', type: 'image/jpeg' },
          { src: art, sizes: '512x512', type: 'image/jpeg' }
        ]
      });

      navigator.mediaSession.playbackState = 'playing';

      navigator.mediaSession.setActionHandler('play', () => {
        userExplicitlyPaused = false;
        const driver = activePlayerMode === 'video' ? sgNativeVideo : sgNativeAudio;
        if (driver) driver.play().catch(() => {});
      });

      navigator.mediaSession.setActionHandler('pause', () => {
        userExplicitlyPaused = true;
        const driver = activePlayerMode === 'video' ? sgNativeVideo : sgNativeAudio;
        if (driver) driver.pause();
      });

      navigator.mediaSession.setActionHandler('seekbackward', (details) => {
        const offset = details.seekOffset || 10;
        const driver = activePlayerMode === 'video' ? sgNativeVideo : sgNativeAudio;
        if (driver) driver.currentTime = Math.max(0, driver.currentTime - offset);
      });

      navigator.mediaSession.setActionHandler('seekforward', (details) => {
        const offset = details.seekOffset || 10;
        const driver = activePlayerMode === 'video' ? sgNativeVideo : sgNativeAudio;
        if (driver) driver.currentTime = Math.min(driver.duration || 0, driver.currentTime + offset);
      });

      navigator.mediaSession.setActionHandler('previoustrack', () => {
        playPrevTrack();
      });

      navigator.mediaSession.setActionHandler('nexttrack', () => {
        playNextTrack();
      });
    } catch (e) {
      console.warn('MediaSession initialization:', e);
    }
  }

  function loadAndPlayTrack(index) {
    if (index < 0 || index >= currentPlaylist.length) return;
    pauseOnlinePlayer();
    currentTrackIndex = index;
    userExplicitlyPaused = false;
    const track = currentPlaylist[index];
    const isVideo = track.media_type === 'video' || (track.title && track.title.toLowerCase().endsWith('.mp4'));
    activePlayerMode = isVideo ? 'video' : 'audio';

    if (playerTypeBadge) playerTypeBadge.textContent = isVideo ? 'Video' : 'Music';
    if (playerTrackCounter) playerTrackCounter.textContent = `${index + 1} of ${currentPlaylist.length}`;
    if (playerTrackTitle) playerTrackTitle.textContent = track.title || 'Media Track';
    if (playerTrackArtist) playerTrackArtist.textContent = track.artist || (track.isOffline ? 'Offline Media' : 'StreamGrab');

    if (playerVideoTitle) playerVideoTitle.textContent = track.title || 'Video Track';
    if (playerVideoMeta) playerVideoMeta.textContent = track.artist || (track.isOffline ? 'MP4 Video • Offline' : 'MP4 Video • StreamGrab');

    if (track.thumbnail) {
      if (playerArtImg) {
        playerArtImg.referrerPolicy = 'no-referrer';
        playerArtImg.src = track.thumbnail;
        playerArtImg.style.display = 'block';
        playerArtImg.onerror = () => { playerArtImg.style.display = 'none'; if (playerArtPlaceholder) playerArtPlaceholder.style.display = 'flex'; };
      }
      if (playerArtPlaceholder) playerArtPlaceholder.style.display = 'none';
      if (miniArtImg) {
        miniArtImg.referrerPolicy = 'no-referrer';
        miniArtImg.src = track.thumbnail;
        miniArtImg.style.display = 'block';
        miniArtImg.onerror = () => { miniArtImg.style.display = 'none'; if (miniArtSvg) miniArtSvg.style.display = 'block'; };
      }
      if (miniArtSvg) miniArtSvg.style.display = 'none';
    } else {
      if (playerArtImg) playerArtImg.style.display = 'none';
      if (playerArtPlaceholder) playerArtPlaceholder.style.display = 'flex';
      if (miniArtImg) miniArtImg.style.display = 'none';
      if (miniArtSvg) miniArtSvg.style.display = 'block';
    }

    if (miniPlayerTitle) miniPlayerTitle.textContent = track.title || 'Media Track';
    if (miniPlayerArtist) miniPlayerArtist.textContent = track.artist || (track.isOffline ? 'Offline Media' : 'StreamGrab');

    let mediaSrc = track.url;
    if (!mediaSrc && track.blob) {
      mediaSrc = URL.createObjectURL(track.blob);
    } else if (!mediaSrc && track.filename) {
      mediaSrc = `/api/file/${encodeURIComponent(track.filename)}?stream=1`;
    }

    if (btnLocalPlayerSave) {
      btnLocalPlayerSave.href = mediaSrc || '#';
      btnLocalPlayerSave.download = track.title || 'media';
    }

    const btnLocalPlayerSaveOffline = document.getElementById('btn-local-player-save-offline');
    const playerOfflineBtnText = document.getElementById('player-offline-btn-text');
    if (btnLocalPlayerSaveOffline && playerOfflineBtnText) {
      if (track.isOffline || track.blob) {
        playerOfflineBtnText.textContent = 'Saved Offline';
        btnLocalPlayerSaveOffline.disabled = true;
        btnLocalPlayerSaveOffline.style.color = 'var(--sg-green)';
      } else {
        isMediaSavedOffline(track.filename || track.title).then(saved => {
          if (saved) {
            playerOfflineBtnText.textContent = 'Saved Offline';
            btnLocalPlayerSaveOffline.disabled = true;
            btnLocalPlayerSaveOffline.style.color = 'var(--sg-green)';
          } else {
            playerOfflineBtnText.textContent = 'Save Offline';
            btnLocalPlayerSaveOffline.disabled = false;
            btnLocalPlayerSaveOffline.style.color = '';
          }
        });
      }
    }

    // Reset seeker sliders
    if (playerSeeker) playerSeeker.value = 0;
    if (playerCurrentTime) playerCurrentTime.textContent = '00:00';
    if (videoSeeker) videoSeeker.value = 0;
    if (videoCurrentTime) videoCurrentTime.textContent = '00:00';

    if (isVideo) {
      if (sgNativeAudio) { sgNativeAudio.pause(); sgNativeAudio.src = ''; }
      if (sgCustomAudioDeck) sgCustomAudioDeck.style.display = 'none';
      if (sgCustomVideoDeck) sgCustomVideoDeck.style.display = 'block';

      if (sgNativeVideo) {
        sgNativeVideo.src = mediaSrc || '';
        sgNativeVideo.play().catch(() => {});
      }
    } else {
      if (sgNativeVideo) { sgNativeVideo.pause(); sgNativeVideo.src = ''; }
      if (sgCustomVideoDeck) sgCustomVideoDeck.style.display = 'none';
      if (sgCustomAudioDeck) sgCustomAudioDeck.style.display = 'flex';

      if (sgNativeAudio) {
        sgNativeAudio.src = mediaSrc || '';
        sgNativeAudio.play().catch(() => {});
      }
    }

    setPlayingStateUI(true);
    updateMediaSession(track);
  }

  function playNextTrack() {
    if (currentPlaylist.length === 0) return;
    if (isShuffle) {
      const rand = Math.floor(Math.random() * currentPlaylist.length);
      loadAndPlayTrack(rand);
      return;
    }
    if (currentTrackIndex < currentPlaylist.length - 1) {
      loadAndPlayTrack(currentTrackIndex + 1);
    } else if (repeatMode === 'all') {
      loadAndPlayTrack(0);
    } else {
      setPlayingStateUI(false);
    }
  }

  function playPrevTrack() {
    if (currentPlaylist.length === 0) return;
    const driver = activePlayerMode === 'video' ? sgNativeVideo : sgNativeAudio;
    if (driver && driver.currentTime > 3) {
      driver.currentTime = 0;
      return;
    }
    if (currentTrackIndex > 0) {
      loadAndPlayTrack(currentTrackIndex - 1);
    } else if (repeatMode === 'all') {
      loadAndPlayTrack(currentPlaylist.length - 1);
    } else {
      if (driver) driver.currentTime = 0;
    }
  }

  function togglePlayPause() {
    const driver = activePlayerMode === 'video' ? sgNativeVideo : sgNativeAudio;
    if (!driver) return;
    if (driver.paused) {
      pauseOnlinePlayer();
      userExplicitlyPaused = false;
      driver.play().catch(() => {});
    } else {
      userExplicitlyPaused = true;
      driver.pause();
    }
  }

  function setPlayingStateUI(playing) {
    isMediaPlaying = playing;
    if (playerVinylDisc) playerVinylDisc.classList.toggle('is-playing', playing);
    if (miniVinylDisc) miniVinylDisc.classList.toggle('is-playing', playing);

    const iconPlay = btnPlayerPlayPause?.querySelector('.sg-icon-play');
    const iconPause = btnPlayerPlayPause?.querySelector('.sg-icon-pause');
    if (iconPlay && iconPause) {
      iconPlay.style.display = playing ? 'none' : 'block';
      iconPause.style.display = playing ? 'block' : 'none';
    }

    const videoPlay = btnVideoPlayPause?.querySelector('.sg-video-icon-play');
    const videoPause = btnVideoPlayPause?.querySelector('.sg-video-icon-pause');
    if (videoPlay && videoPause) {
      videoPlay.style.display = playing ? 'none' : 'block';
      videoPause.style.display = playing ? 'block' : 'none';
    }

    const miniPlay = btnMiniPlayPause?.querySelector('.sg-mini-icon-play');
    const miniPause = btnMiniPlayPause?.querySelector('.sg-mini-icon-pause');
    if (miniPlay && miniPause) {
      miniPlay.style.display = playing ? 'none' : 'block';
      miniPause.style.display = playing ? 'block' : 'none';
    }

    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
    }
  }

  function onMediaEnded() {
    if (repeatMode === 'one') {
      const driver = activePlayerMode === 'video' ? sgNativeVideo : sgNativeAudio;
      if (driver) { driver.currentTime = 0; driver.play().catch(() => {}); }
    } else {
      playNextTrack();
    }
  }

  // Audio Driver Events
  if (sgNativeAudio) {
    sgNativeAudio.addEventListener('play', () => {
      pauseOnlinePlayer();
      setPlayingStateUI(true);
    });
    sgNativeAudio.addEventListener('pause', () => {
      if (!document.hidden || userExplicitlyPaused) {
        setPlayingStateUI(false);
      }
    });
    sgNativeAudio.addEventListener('ended', onMediaEnded);
    sgNativeAudio.addEventListener('timeupdate', () => {
      if (activePlayerMode === 'audio' && sgNativeAudio.duration) {
        const cur = sgNativeAudio.currentTime;
        const dur = sgNativeAudio.duration;
        if (playerCurrentTime) playerCurrentTime.textContent = formatTime(cur);
        if (playerTotalTime) playerTotalTime.textContent = formatTime(dur);
        if (playerSeeker) playerSeeker.value = (cur / dur) * 100;

        if ('mediaSession' in navigator && navigator.mediaSession.setPositionState) {
          try {
            navigator.mediaSession.setPositionState({
              duration: dur,
              playbackRate: sgNativeAudio.playbackRate || 1,
              position: cur
            });
          } catch {}
        }
      }
    });
  }

  // Video Driver Events (Matching Music Player Timeline Seeker)
  if (sgNativeVideo) {
    sgNativeVideo.addEventListener('play', () => {
      pauseOnlinePlayer();
      setPlayingStateUI(true);
    });
    sgNativeVideo.addEventListener('pause', () => {
      // If paused by mobile OS automatically when screen locks or tab minimizes:
      if (document.hidden && !userExplicitlyPaused && isMediaPlaying) {
        setTimeout(() => {
          if (document.hidden && !userExplicitlyPaused) {
            sgNativeVideo.play().catch(() => {});
          }
        }, 120);
        return;
      }
      setPlayingStateUI(false);
    });
    sgNativeVideo.addEventListener('ended', onMediaEnded);
    sgNativeVideo.addEventListener('loadedmetadata', () => {
      if (videoTotalTime && sgNativeVideo.duration) {
        videoTotalTime.textContent = formatTime(sgNativeVideo.duration);
      }
    });
    sgNativeVideo.addEventListener('timeupdate', () => {
      if (activePlayerMode === 'video' && sgNativeVideo.duration) {
        const cur = sgNativeVideo.currentTime;
        const dur = sgNativeVideo.duration;
        if (videoCurrentTime) videoCurrentTime.textContent = formatTime(cur);
        if (videoTotalTime) videoTotalTime.textContent = formatTime(dur);
        if (videoSeeker) videoSeeker.value = (cur / dur) * 100;

        if ('mediaSession' in navigator && navigator.mediaSession.setPositionState) {
          try {
            navigator.mediaSession.setPositionState({
              duration: dur,
              playbackRate: sgNativeVideo.playbackRate || 1,
              position: cur
            });
          } catch {}
        }
      }
    });
  }

  // Background Playback / Screen Lock Continuation
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      // Screen locked or minimized: Keep active playback going
      const driver = activePlayerMode === 'video' ? sgNativeVideo : sgNativeAudio;
      if (driver && isMediaPlaying && !userExplicitlyPaused && driver.paused) {
        driver.play().catch(() => {});
      }
    }
  });

  // Music Seeker Input
  if (playerSeeker) {
    playerSeeker.addEventListener('input', () => {
      if (activePlayerMode === 'audio' && sgNativeAudio && sgNativeAudio.duration) {
        sgNativeAudio.currentTime = (playerSeeker.value / 100) * sgNativeAudio.duration;
      }
    });
  }

  // Video Seeker Input (Matching Music Player)
  if (videoSeeker) {
    videoSeeker.addEventListener('input', () => {
      if (activePlayerMode === 'video' && sgNativeVideo && sgNativeVideo.duration) {
        sgNativeVideo.currentTime = (videoSeeker.value / 100) * sgNativeVideo.duration;
      }
    });
  }

  // Music Deck Controls
  if (btnPlayerPlayPause) btnPlayerPlayPause.addEventListener('click', togglePlayPause);
  if (btnPlayerPrev) btnPlayerPrev.addEventListener('click', playPrevTrack);
  if (btnPlayerNext) btnPlayerNext.addEventListener('click', playNextTrack);

  // Video Deck Controls (Rewind -10s, Prev, Play/Pause, Next, Forward +10s, Rotate Fullscreen)
  if (btnVideoPlayPause) btnVideoPlayPause.addEventListener('click', togglePlayPause);
  if (btnVideoRewind10) {
    btnVideoRewind10.addEventListener('click', () => {
      if (sgNativeVideo) {
        sgNativeVideo.currentTime = Math.max(0, sgNativeVideo.currentTime - 10);
      }
    });
  }
  if (btnVideoForward10) {
    btnVideoForward10.addEventListener('click', () => {
      if (sgNativeVideo) {
        sgNativeVideo.currentTime = Math.min(sgNativeVideo.duration || 0, sgNativeVideo.currentTime + 10);
      }
    });
  }
  if (btnVideoPrev) btnVideoPrev.addEventListener('click', playPrevTrack);
  if (btnVideoNext) btnVideoNext.addEventListener('click', playNextTrack);

  // Video Frame Click to Play/Pause
  if (sgNativeVideoFrame) {
    sgNativeVideoFrame.addEventListener('click', (e) => {
      if (e.target.closest('#btn-video-fullscreen-rotate')) return;
      togglePlayPause();
    });
  }

  // Rotate & Fullscreen Video
  if (btnVideoFullscreenRotate) {
    btnVideoFullscreenRotate.addEventListener('click', async (e) => {
      e.stopPropagation();
      const targetFrame = sgNativeVideoFrame || sgNativeVideo;
      if (!targetFrame) return;

      try {
        if (!document.fullscreenElement) {
          if (targetFrame.requestFullscreen) {
            await targetFrame.requestFullscreen();
          } else if (targetFrame.webkitRequestFullscreen) {
            await targetFrame.webkitRequestFullscreen();
          }
          if (screen.orientation && screen.orientation.lock) {
            screen.orientation.lock('landscape').catch(() => {});
          }
        } else {
          if (document.exitFullscreen) {
            await document.exitFullscreen();
          }
          if (screen.orientation && screen.orientation.unlock) {
            screen.orientation.unlock();
          }
        }
      } catch (err) {
        console.warn('Orientation/Fullscreen notice:', err);
      }
    });
  }

  if (btnPlayerShuffle) {
    btnPlayerShuffle.addEventListener('click', () => {
      isShuffle = !isShuffle;
      btnPlayerShuffle.classList.toggle('active', isShuffle);
    });
  }

  if (btnPlayerRepeat) {
    btnPlayerRepeat.addEventListener('click', () => {
      if (repeatMode === 'none') {
        repeatMode = 'all';
        btnPlayerRepeat.classList.add('active');
        btnPlayerRepeat.title = 'Repeat: All';
      } else if (repeatMode === 'all') {
        repeatMode = 'one';
        btnPlayerRepeat.classList.add('active');
        btnPlayerRepeat.title = 'Repeat: One';
      } else {
        repeatMode = 'none';
        btnPlayerRepeat.classList.remove('active');
        btnPlayerRepeat.title = 'Repeat: Off';
      }
    });
  }

  function minimizeOrClosePlayer() {
    if (localPlayerModal) localPlayerModal.style.display = 'none';
    document.body.style.overflow = '';
    if (activePlayerMode === 'audio' && isMediaPlaying) {
      if (sgMiniPlayer) sgMiniPlayer.style.display = 'flex';
    } else {
      if (sgMiniPlayer) sgMiniPlayer.style.display = 'none';
    }
  }

  if (btnCloseLocalPlayer) btnCloseLocalPlayer.addEventListener('click', minimizeOrClosePlayer);
  if (btnLocalPlayerClose) btnLocalPlayerClose.addEventListener('click', minimizeOrClosePlayer);
  if (localPlayerModal) {
    localPlayerModal.addEventListener('click', (e) => {
      if (e.target === localPlayerModal) minimizeOrClosePlayer();
    });
  }

  const btnLocalPlayerSaveOffline = document.getElementById('btn-local-player-save-offline');
  const playerOfflineBtnText = document.getElementById('player-offline-btn-text');
  if (btnLocalPlayerSaveOffline) {
    btnLocalPlayerSaveOffline.addEventListener('click', async () => {
      if (currentPlaylist.length === 0) return;
      const track = currentPlaylist[currentTrackIndex];
      if (!track) return;

      if (track.blob || track.isOffline) {
        showToast('This track is already stored in your Device Offline Storage!', 'info', 3000);
        return;
      }

      btnLocalPlayerSaveOffline.disabled = true;
      if (playerOfflineBtnText) playerOfflineBtnText.textContent = 'Saving...';

      try {
        let blob = null;
        if (track.url && track.url.startsWith('blob:')) {
          const res = await fetch(track.url);
          blob = await res.blob();
        } else if (track.filename) {
          const res = await fetch(`/api/file/${encodeURIComponent(track.filename)}`);
          if (!res.ok) throw new Error('File download failed from server.');
          blob = await res.blob();
        } else if (track.url) {
          const res = await fetch(track.url);
          blob = await res.blob();
        }

        if (!blob) throw new Error('Could not access media data.');

        const isVideo = track.media_type === 'video' || (track.filename && track.filename.endsWith('.mp4'));
        const record = {
          id: `offline_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          filename: track.filename || track.title || 'media',
          title: track.title || 'Track',
          thumbnail: track.thumbnail || '',
          duration_str: 'Offline',
          media_type: isVideo ? 'video' : 'audio',
          size_bytes: blob.size,
          size_str: formatBytes(blob.size),
          blob: blob,
          saved_at: Date.now()
        };

        await saveMediaToOfflineStorage(record);
        track.isOffline = true;
        track.blob = blob;

        if (playerOfflineBtnText) playerOfflineBtnText.textContent = 'Saved Offline';
        btnLocalPlayerSaveOffline.style.color = 'var(--sg-green)';
        await renderOfflineDownloadsList();
        showToast(`"${record.title}" saved to device offline storage!`, 'success', 3500);
      } catch (err) {
        console.error('Player save offline error:', err);
        showToast('Could not save to offline storage: ' + err.message, 'error', 3500);
        if (playerOfflineBtnText) playerOfflineBtnText.textContent = 'Save Offline';
        btnLocalPlayerSaveOffline.disabled = false;
      }
    });
  }

  if (miniPlayerExpandTrigger) {
    miniPlayerExpandTrigger.addEventListener('click', () => {
      if (localPlayerModal) {
        localPlayerModal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
      }
      if (sgMiniPlayer) sgMiniPlayer.style.display = 'none';
    });
  }
  if (miniPlayerInfoTrigger) {
    miniPlayerInfoTrigger.addEventListener('click', () => {
      if (localPlayerModal) {
        localPlayerModal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
      }
      if (sgMiniPlayer) sgMiniPlayer.style.display = 'none';
    });
  }
  if (btnMiniPrev) {
    btnMiniPrev.addEventListener('click', (e) => {
      e.stopPropagation();
      playPrevTrack();
    });
  }
  if (btnMiniNext) {
    btnMiniNext.addEventListener('click', (e) => {
      e.stopPropagation();
      playNextTrack();
    });
  }
  if (btnMiniPlayPause) {
    btnMiniPlayPause.addEventListener('click', (e) => {
      e.stopPropagation();
      togglePlayPause();
    });
  }
  if (btnMiniClose) {
    btnMiniClose.addEventListener('click', (e) => {
      e.stopPropagation();
      if (sgNativeAudio) { sgNativeAudio.pause(); sgNativeAudio.src = ''; }
      if (sgMiniPlayer) sgMiniPlayer.style.display = 'none';
      setPlayingStateUI(false);
    });
  }

  async function togglePlayerFullscreen(targetEl) {
    const target = targetEl || document.querySelector('.sg-player-frame');
    if (!target) return;

    if (!document.fullscreenElement && !document.webkitFullscreenElement) {
      if (target.requestFullscreen) {
        await target.requestFullscreen().catch(() => {});
      } else if (target.webkitRequestFullscreen) {
        await target.webkitRequestFullscreen();
      }
      if (screen.orientation && screen.orientation.lock) {
        try {
          await screen.orientation.lock('landscape');
        } catch (e) {
          // Handled if browser doesn't permit orientation lock
        }
      }
    } else {
      if (document.exitFullscreen) {
        await document.exitFullscreen().catch(() => {});
      } else if (document.webkitExitFullscreen) {
        await document.webkitExitFullscreen();
      }
      if (screen.orientation && screen.orientation.unlock) {
        try { screen.orientation.unlock(); } catch (e) {}
      }
    }
  }

  if (btnDeckFullscreen) {
    btnDeckFullscreen.addEventListener('click', () => {
      const frame = document.querySelector('.sg-player-frame');
      togglePlayerFullscreen(frame);
    });
  }

  if (btnVideoFullscreenRotate) {
    btnVideoFullscreenRotate.addEventListener('click', () => {
      const frame = document.getElementById('sg-native-video-frame');
      togglePlayerFullscreen(frame);
    });
  }

  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && screen.orientation && screen.orientation.unlock) {
      try { screen.orientation.unlock(); } catch (e) {}
    }
  });
  document.addEventListener('webkitfullscreenchange', () => {
    if (!document.webkitFullscreenElement && screen.orientation && screen.orientation.unlock) {
      try { screen.orientation.unlock(); } catch (e) {}
    }
  });

  function openLocalPlayer(title, isVideo, directBlobUrl = null, isOffline = false) {
    const item = {
      title: title,
      artist: isOffline ? 'Offline Media' : 'StreamGrab',
      media_type: isVideo ? 'video' : 'audio',
      url: directBlobUrl || `/api/file/${encodeURIComponent(title)}?stream=1`,
      thumbnail: '',
      isOffline: isOffline
    };
    openPlaylistPlayer([item], 0);
  }

  // -----------------------------------------------------------
  // Storage Directory & Device Storage Manager Modal
  // -----------------------------------------------------------
  async function refreshStorageStats() {
    try {
      const offlineItems = await getAllOfflineMedia();
      let offlineBytes = 0;
      offlineItems.forEach(i => { offlineBytes += (i.size_bytes || 0); });

      if (settingsPathLabel) {
        settingsPathLabel.textContent = `Device Offline Storage (${offlineItems.length} items • ${formatBytes(offlineBytes)})`;
      }

      const res = await fetch('/api/downloads/info');
      const data = await res.json();
      if (!res.ok || !data.success) return;

      const count = data.file_count || 0;
      const sizeStr = data.total_size_human || '0 MB';

      if (storageStatsSummary) {
        storageStatsSummary.innerHTML = `
          <div style="margin-bottom: 6px; font-weight: 700; color: var(--text-heading);">Device Offline Storage (IndexedDB): ${offlineItems.length} items (${formatBytes(offlineBytes)})</div>
          <div style="font-size: 0.72rem; color: var(--text-muted); line-height: 1.4;">Server Temp Cache: ${count} buffer files (${sizeStr}) &bull; <em>Auto-purging OS temporary cache. Zero files saved in app source folder.</em></div>
        `;
      }

      renderStorageFiles(data.files || []);
    } catch (err) {
      console.warn('Storage refresh error:', err);
    }
  }

  function renderStorageFiles(files) {
    storageFilesList.innerHTML = '';
    if (files.length === 0) {
      storageFilesList.innerHTML = '<p class="sg-modal-desc">No temporary files in server cache.</p>';
      return;
    }

    files.forEach(f => {
      const row = document.createElement('div');
      row.className = 'sg-storage-row';
      const isVideo = f.name.toLowerCase().endsWith('.mp4');

      row.innerHTML = `
        <span class="sg-storage-name" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</span>
        <span class="sg-storage-size">${escapeHtml(f.size_human)}</span>
        <button type="button" class="sg-btn-ghost btn-sm btn-play-storage">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" class="sg-btn-svg">
            <polygon points="5 3 19 12 5 21 5 3"></polygon>
          </svg>
          <span>Play</span>
        </button>
      `;

      row.querySelector('.btn-play-storage').addEventListener('click', () => {
        closeStorageModal();
        openLocalPlayer(f.name, isVideo);
      });

      storageFilesList.appendChild(row);
    });
  }

  function openStorageModal() {
    refreshStorageStats();
    storageModal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  }

  function closeStorageModal() {
    storageModal.style.display = 'none';
    document.body.style.overflow = '';
  }

  if (btnCloseStorage) btnCloseStorage.addEventListener('click', closeStorageModal);
  if (btnCloseStorageBtn) btnCloseStorageBtn.addEventListener('click', closeStorageModal);
  if (btnRefreshStorage) btnRefreshStorage.addEventListener('click', refreshStorageStats);
  if (storageModal) {
    storageModal.addEventListener('click', (e) => {
      if (e.target === storageModal) closeStorageModal();
    });
  }

  const btnPurgeServerCache = document.getElementById('btn-purge-server-cache');
  if (btnPurgeServerCache) {
    btnPurgeServerCache.addEventListener('click', async () => {
      const confirmed = await showCustomConfirm('Purge Server Cache', 'Purge all temporary processing files from the server cache?', 'Purge Cache', true);
      if (!confirmed) return;
      try {
        btnPurgeServerCache.disabled = true;
        btnPurgeServerCache.textContent = 'Purging...';
        const res = await fetch('/api/cache/clear', { method: 'POST' });
        const data = await res.json();
        showToast(data.message || 'Server temp cache cleared.', 'success', 3000);
        await refreshStorageStats();
      } catch (err) {
        showToast('Failed to clear cache: ' + err.message, 'error', 3500);
      } finally {
        btnPurgeServerCache.disabled = false;
        btnPurgeServerCache.textContent = 'Purge Server Cache';
      }
    });
  }

  // Auto-Save to Device Setting
  const switchAutoSaveDevice = document.getElementById('switch-auto-save-device');
  if (switchAutoSaveDevice) {
    const savedAuto = localStorage.getItem('streamgrab_auto_save_device');
    switchAutoSaveDevice.checked = savedAuto !== 'false';
    switchAutoSaveDevice.addEventListener('change', () => {
      localStorage.setItem('streamgrab_auto_save_device', switchAutoSaveDevice.checked ? 'true' : 'false');
    });
  }

  // Standalone PWA Installation
  let deferredInstallPrompt = null;
  const rowPwaInstall = document.getElementById('row-pwa-install');
  const btnInstallPwa = document.getElementById('btn-install-pwa');

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    if (rowPwaInstall) rowPwaInstall.style.display = 'flex';
  });

  if (btnInstallPwa) {
    btnInstallPwa.addEventListener('click', async () => {
      if (!deferredInstallPrompt) {
        showCustomAlert('Install StreamGrab', 'StreamGrab is ready as a standalone app!\nYou can install directly from your browser menu (Tap three dots > Add to Home screen / Install app).', 'info');
        return;
      }
      deferredInstallPrompt.prompt();
      const { outcome } = await deferredInstallPrompt.userChoice;
      if (outcome === 'accepted') {
        if (rowPwaInstall) rowPwaInstall.style.display = 'none';
      }
      deferredInstallPrompt = null;
    });
  }

  // -----------------------------------------------------------
  // YouTube Cookies Modal
  // -----------------------------------------------------------
  async function checkCookiesStatus() {
    try {
      const res = await fetch('/api/cookies/status');
      const data = await res.json();
      if (data.has_cookies) {
        const kb = (data.size_bytes / 1024).toFixed(1);
        if (cookiesStatusText) cookiesStatusText.textContent = `Active (${kb} KB)`;
        if (cookiesCardStatus) cookiesCardStatus.textContent = `Active (${kb} KB loaded)`;
        if (settingsCookiesStatus) settingsCookiesStatus.textContent = `Active (${kb} KB loaded)`;
        if (btnDeleteCookies) btnDeleteCookies.style.display = 'inline-flex';
      } else {
        if (cookiesStatusText) cookiesStatusText.textContent = `Cookies: None`;
        if (cookiesCardStatus) cookiesCardStatus.textContent = `No cookies loaded (Anonymous)`;
        if (settingsCookiesStatus) settingsCookiesStatus.textContent = `Upload cookies.txt for bot bypass`;
        if (btnDeleteCookies) btnDeleteCookies.style.display = 'none';
      }
    } catch {
      if (cookiesStatusText) cookiesStatusText.textContent = `Cookies: Error`;
    }
  }

  function openCookiesModal() {
    checkCookiesStatus();
    if (cookiesModal) {
      cookiesModal.style.display = 'flex';
      document.body.style.overflow = 'hidden';
    }
  }

  function closeCookiesModal() {
    if (cookiesModal) cookiesModal.style.display = 'none';
    if (cookiesFileInput) cookiesFileInput.value = '';
    if (cookiesTextarea) cookiesTextarea.value = '';
    document.body.style.overflow = '';
  }

  if (btnCloseCookies) btnCloseCookies.addEventListener('click', closeCookiesModal);
  if (btnCancelCookies) btnCancelCookies.addEventListener('click', closeCookiesModal);
  if (cookiesModal) {
    cookiesModal.addEventListener('click', (e) => {
      if (e.target === cookiesModal) closeCookiesModal();
    });
  }

  if (btnSaveCookies) {
    btnSaveCookies.addEventListener('click', async () => {
      btnSaveCookies.disabled = true;
      btnSaveCookies.textContent = 'Saving...';

      try {
        let response;
        if (cookiesFileInput && cookiesFileInput.files.length > 0) {
          const formData = new FormData();
          formData.append('file', cookiesFileInput.files[0]);
          response = await fetch('/api/cookies/upload', {
            method: 'POST',
            body: formData
          });
        } else if (cookiesTextarea) {
          const content = cookiesTextarea.value.trim();
          if (!content) {
            showToast('Please choose a file or paste cookie content.', 'warning', 3000);
            btnSaveCookies.disabled = false;
            btnSaveCookies.textContent = 'Save Cookies';
            return;
          }
          response = await fetch('/api/cookies/upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content })
          });
        }

        if (response) {
          const data = await response.json();
          if (response.ok && data.success) {
            showToast('Cookies saved successfully!', 'success', 3000);
            closeCookiesModal();
            checkCookiesStatus();
          } else {
            showToast(data.error || 'Failed to save cookies.', 'error', 3500);
          }
        }
      } catch {
        showToast('Error connecting to backend.', 'error', 3500);
      } finally {
        btnSaveCookies.disabled = false;
        btnSaveCookies.textContent = 'Save Cookies';
      }
    });
  }

  if (btnDeleteCookies) {
    btnDeleteCookies.addEventListener('click', async () => {
      const confirmed = await showCustomConfirm('Remove Cookies', 'Are you sure you want to remove the cookies file?', 'Remove', true);
      if (!confirmed) return;
      try {
        const res = await fetch('/api/cookies/delete', { method: 'POST' });
        const data = await res.json();
        if (res.ok && data.success) {
          showToast('Cookies removed.', 'info', 3000);
          checkCookiesStatus();
        }
      } catch {
        showToast('Failed to remove cookies.', 'error', 3500);
      }
    });
  }

  // -----------------------------------------------------------
  // Escape Key & Backdrop Click Dismiss for All Modals & Popups
  // -----------------------------------------------------------
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (sgWatchDeck && sgWatchDeck.style.display !== 'none') closeWatchDeck();
      if (downloadOptionsModal && downloadOptionsModal.style.display === 'flex') downloadOptionsModal.style.display = 'none';
      if (localPlayerModal && localPlayerModal.style.display === 'flex') minimizeOrClosePlayer();
      if (storageModal && storageModal.style.display === 'flex') closeStorageModal();
      if (cookiesModal && cookiesModal.style.display === 'flex') closeCookiesModal();
      if (sgCustomAlertModal && sgCustomAlertModal.style.display === 'flex') {
        if (btnCustomAlertOk) btnCustomAlertOk.click(); else sgCustomAlertModal.style.display = 'none';
      }
      if (sgCustomConfirmModal && sgCustomConfirmModal.style.display === 'flex') {
        if (btnCustomConfirmCancel) btnCustomConfirmCancel.click(); else sgCustomConfirmModal.style.display = 'none';
      }
    }
  });

  // Universal click-outside backdrop dismiss for all modals, alerts, and bottom sheet
  const allBackdropModals = [
    downloadOptionsModal,
    localPlayerModal,
    storageModal,
    cookiesModal,
    sgCustomAlertModal,
    sgCustomConfirmModal
  ];

  allBackdropModals.forEach(modal => {
    if (!modal) return;
    modal.addEventListener('click', (e) => {
      // Check if click was directly on the modal backdrop container (outside the card)
      if (e.target === modal) {
        if (modal === localPlayerModal) {
          minimizeOrClosePlayer();
        } else if (modal === storageModal) {
          closeStorageModal();
        } else if (modal === cookiesModal) {
          closeCookiesModal();
        } else if (modal === sgCustomAlertModal) {
          if (btnCustomAlertOk) btnCustomAlertOk.click();
          else modal.style.display = 'none';
        } else if (modal === sgCustomConfirmModal) {
          if (btnCustomConfirmCancel) btnCustomConfirmCancel.click();
          else modal.style.display = 'none';
        } else {
          modal.style.display = 'none';
          document.body.style.overflow = '';
        }
      }
    });
  });

  // -----------------------------------------------------------
  // HTML Escape Helper
  // -----------------------------------------------------------
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // -----------------------------------------------------------
  // Server Health Polling
  // -----------------------------------------------------------
  async function checkServerHealth() {
    try {
      const res = await fetch('/api/health');
      if (res.ok) {
        updateNetworkStatus();
      }
    } catch {
      if (settingsNetworkDot) settingsNetworkDot.className = 'sg-status-dot dot-offline';
      if (settingsNetworkStatus) settingsNetworkStatus.textContent = 'Offline Mode (Device Storage Ready)';
    }
  }

  // -----------------------------------------------------------
  // Initial Boot Sequence
  // -----------------------------------------------------------
  renderBatchItems();
  checkCookiesStatus();
  refreshStorageStats();
  renderOfflineDownloadsList();
  setInterval(checkServerHealth, 20000);

  // Load preferred content feed on boot (Default: Trending, or user preference)
  loadPreferredFeed();

})();
