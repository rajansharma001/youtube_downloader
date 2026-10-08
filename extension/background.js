/**
 * StreamGrab Extension - Background Service Worker
 * Handles native file downloads via chrome.downloads API, notifications & settings.
 */

chrome.runtime.onInstalled.addListener(() => {
  console.log('[StreamGrab] Extension installed successfully.');
  // Initialize default configuration
  chrome.storage.sync.get({
    serverUrl: 'http://127.0.0.1:5000',
    mp3OnlyMode: false,
    defaultFormat: 'audio',
    defaultAudioQuality: '320',
    defaultVideoQuality: '720'
  }, (cfg) => {
    chrome.storage.sync.set(cfg);
  });
});

// Message listener from content script and popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'downloadFile') {
    handleBrowserDownload(request.url, request.filename, sendResponse);
    return true; // Keep message channel open for async response
  }

  if (request.action === 'testServer') {
    testServerConnection(request.serverUrl, sendResponse);
    return true;
  }
});

// Trigger browser download via chrome.downloads API
function handleBrowserDownload(fileUrl, filename, sendResponse) {
  if (!chrome.downloads) {
    sendResponse({ success: false, error: 'Downloads API not supported' });
    return;
  }

  // Clean filename to remove invalid filesystem characters
  const cleanFilename = (filename || 'download')
    .replace(/[<>:"/\\|?*]+/g, '_')
    .trim();

  chrome.downloads.download({
    url: fileUrl,
    filename: cleanFilename,
    conflictAction: 'uniquify',
    saveAs: false
  }, (downloadId) => {
    if (chrome.runtime.lastError) {
      console.error('[StreamGrab] chrome.downloads error:', chrome.runtime.lastError.message);
      sendResponse({ success: false, error: chrome.runtime.lastError.message });
      return;
    }

    // Save into recent history
    saveRecentDownloadRecord(cleanFilename, fileUrl);

    // Optional notification
    if (chrome.notifications) {
      try {
        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'icons/icon128.png',
          title: 'StreamGrab Download Saved',
          message: `Saved ${cleanFilename} to Downloads folder.`
        });
      } catch (_) {}
    }

    sendResponse({ success: true, downloadId: downloadId });
  });
}

// Test health of configured server
async function testServerConnection(serverUrl, sendResponse) {
  const url = (serverUrl || 'http://127.0.0.1:5000').replace(/\/+$/, '');
  try {
    const res = await fetch(`${url}/api/health`);
    if (res.ok) {
      const data = await res.json();
      sendResponse({ success: true, data: data });
    } else {
      sendResponse({ success: false, error: `HTTP ${res.status}` });
    }
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

// Store download records in storage
function saveRecentDownloadRecord(filename, url) {
  chrome.storage.local.get({ recentDownloads: [] }, (data) => {
    const list = data.recentDownloads || [];
    list.unshift({
      filename: filename,
      url: url,
      timestamp: Date.now()
    });
    // Keep last 30
    chrome.storage.local.set({ recentDownloads: list.slice(0, 30) });
  });
}
