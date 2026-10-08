/**
 * StreamGrab Extension - Background Service Worker
 * Proxies API requests to bypass browser Mixed-Content / CORS / Brave Shields,
 * and manages file downloads via chrome.downloads API.
 */

chrome.runtime.onInstalled.addListener(() => {
  console.log('[StreamGrab Background] Extension installed/updated.');
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

// Central Message Dispatcher
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // 1. Proxy API Request (bypass Mixed-Content and Brave localhost blocking)
  if (request.action === 'apiFetch') {
    handleApiFetch(request.serverUrl, request.endpoint, request.method, request.body, sendResponse);
    return true; // Keep message channel open for async response
  }

  // 2. Browser file download
  if (request.action === 'downloadFile') {
    handleBrowserDownload(request.url, request.filename, sendResponse);
    return true;
  }

  // 3. Test server connection
  if (request.action === 'testServer') {
    testServerConnection(request.serverUrl, sendResponse);
    return true;
  }
});

/**
 * Handle API Fetch requests on behalf of content scripts and popup.
 * Because this runs in the extension background worker with host permissions,
 * it is not restricted by page CSP or HTTPS-to-HTTP mixed content policies.
 */
async function handleApiFetch(serverUrl, endpoint, method = 'GET', body = null, sendResponse) {
  const base = (serverUrl || 'http://127.0.0.1:5000').replace(/\/+$/, '');
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const fullUrl = `${base}${cleanEndpoint}`;

  try {
    const fetchOptions = {
      method: method.toUpperCase(),
      headers: {
        'Accept': 'application/json, text/plain, */*'
      }
    };

    if (body && ['POST', 'PUT', 'PATCH'].includes(fetchOptions.method)) {
      fetchOptions.headers['Content-Type'] = 'application/json';
      fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
    }

    const controller = new AbortController();
    const timeoutTimer = setTimeout(() => controller.abort(), 20000);
    fetchOptions.signal = controller.signal;

    const res = await fetch(fullUrl, fetchOptions);
    clearTimeout(timeoutTimer);

    const contentType = res.headers.get('content-type') || '';
    let responseData = null;
    if (contentType.includes('application/json')) {
      responseData = await res.json();
    } else {
      responseData = await res.text();
    }

    sendResponse({
      success: res.ok,
      status: res.status,
      data: responseData
    });
  } catch (err) {
    console.warn(`[StreamGrab Background] API request failed (${fullUrl}):`, err.message);
    sendResponse({
      success: false,
      status: 0,
      error: err.name === 'AbortError' ? 'Request timed out' : err.message
    });
  }
}

/**
 * Trigger browser file download via chrome.downloads API.
 */
function handleBrowserDownload(fileUrl, filename, sendResponse) {
  if (!chrome.downloads) {
    sendResponse({ success: false, error: 'chrome.downloads API is unavailable' });
    return;
  }

  const cleanFilename = (filename || 'streamgrab_media')
    .replace(/[<>:"/\\|?*]+/g, '_')
    .trim();

  chrome.downloads.download({
    url: fileUrl,
    filename: cleanFilename,
    conflictAction: 'uniquify',
    saveAs: false
  }, (downloadId) => {
    if (chrome.runtime.lastError) {
      console.error('[StreamGrab Background] Download error:', chrome.runtime.lastError.message);
      sendResponse({ success: false, error: chrome.runtime.lastError.message });
      return;
    }

    saveRecentDownloadRecord(cleanFilename, fileUrl);

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

/**
 * Test health of configured server.
 */
async function testServerConnection(serverUrl, sendResponse) {
  const url = (serverUrl || 'http://127.0.0.1:5000').replace(/\/+$/, '');
  try {
    const res = await fetch(`${url}/api/health`, { method: 'GET' });
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

/**
 * Store download history in chrome.storage.local.
 */
function saveRecentDownloadRecord(filename, url) {
  chrome.storage.local.get({ recentDownloads: [] }, (data) => {
    const list = data.recentDownloads || [];
    list.unshift({
      filename: filename,
      url: url,
      timestamp: Date.now()
    });
    chrome.storage.local.set({ recentDownloads: list.slice(0, 30) });
  });
}
