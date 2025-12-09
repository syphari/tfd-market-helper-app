const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

// Keep track of the main hub window and all running searches.
let mainWindow;
let searchCounter = 1;
const searches = {};

// Array of debug log entries. Each entry contains a timestamp and message.
const debugLogs = [];
// Reference to the global debug window when debug mode is enabled.
let globalDebugWindow = null;

/**
 * Append a message to the debug log. If the global debug window is
 * open, send the updated logs and metrics to it.
 * @param {string} message
 */
function logDebug(message) {
  debugLogs.push({ timestamp: Date.now(), message });
  // If debug window is open, push update
  if (globalDebugWindow && !globalDebugWindow.isDestroyed()) {
    globalDebugWindow.webContents.send('debug-log', {
      logs: debugLogs,
      metrics: getMetrics()
    });
  }
}

/**
 * Compute basic metrics for each active or completed search. Returns an array
 * of objects containing searchId, running status, item count and start/finish times.
 */
function getMetrics() {
  const metrics = [];
  for (const [id, search] of Object.entries(searches)) {
    metrics.push({
      id: Number(id),
      running: search.running,
      items: search.data ? search.data.length : 0,
      startedAt: search.startedAt || null,
      finishedAt: search.finishedAt || null,
      filters: search.filters || {}
    });
  }
  return metrics;
}

/**
 * Create the main application window. This window hosts the hub page
 * where users can configure new searches and switch between tabs.
 */
function createMainWindow() {
  // Create the main browser window. In addition to the usual settings
  // we specify a custom icon so the application shows our bespoke logo
  // in the window frame, taskbar and when packaged as an executable.
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    // Use our generated icon.  Electron will pick the appropriate
    // resolution from the .ico on Windows, or fall back to the PNG
    // when running on Linux/macOS.  The file lives in the assets
    // folder alongside this script.
    // Use the transparent logo files for the main application icon. On Windows
    // use the .ico version, and on Linux/macOS use the PNG version. The
    // transparent background ensures the icon blends nicely with the taskbar.
    icon: path.join(__dirname, 'assets', process.platform === 'win32' ? 'logo_transparent.ico' : 'logo_transparent.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });
  mainWindow.setMenu(null);
  mainWindow.loadFile(path.join(__dirname, 'hub.html'));

  // When the main window is closed we need to ensure that any
  // background work associated with the application is also
  // terminated. Without this handler, hidden BrowserWindow
  // instances created for running searches remain alive and
  // prevent the 'window-all-closed' event from firing. In such
  // cases the Electron process would continue running even
  // though the visible UI has been closed. To avoid lingering
  // processes and potential resource leaks we explicitly close
  // all hidden search windows and the global debug window (if
  // present) when the hub window is closed. Once those windows
  // are destroyed we call app.quit() to force the entire
  // application to exit. This guarantees that no workers or
  // renderer processes survive after the user closes the app.
  mainWindow.on('closed', () => {
    // Destroy all hidden search windows
    for (const entry of Object.values(searches)) {
      if (entry && entry.window && !entry.window.isDestroyed()) {
        try {
          entry.window.destroy();
        } catch (err) {
          // ignore any errors during destruction
        }
      }
    }
    // Destroy the global debug window if it exists
    if (globalDebugWindow && !globalDebugWindow.isDestroyed()) {
      try {
        globalDebugWindow.destroy();
      } catch (err) {
        // ignore errors
      }
    }
    // Ensure the Electron process exits completely
    app.quit();
  });
}

app.whenReady().then(() => {
  createMainWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

// Quit when all windows are closed (except on macOS).
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

/**
 * IPC handler: start a new search. The renderer provides a set of
 * filters; we create a new hidden BrowserWindow for this search,
 * load a fresh copy of the market page and begin scraping. In this
 * stub implementation we simply return an empty dataset and mark
 * the search as finished immediately. Real scraping logic should
 * inject scripts into the hidden window to populate `data`.
 */
ipcMain.handle('start-search', async (event, filters) => {
  const id = searchCounter++;
  const searchWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });
  // Store search metadata immediately. We will load the URL and start
  // scraping asynchronously so that the renderer can create the tab
  // without waiting for the page to finish loading.
  searches[id] = {
    window: searchWindow,
    filters,
    running: true,
    debug: false,
    startedAt: Date.now(),
    finishedAt: null,
    data: []
  };
  // Start loading the market page. Once loaded, kick off scraping.
  searchWindow.loadURL('https://tfd.nexon.com/en/market').then(() => {
    runSearch(id).catch((err) => {
      logDebug(`Search ${id} encountered an error: ${err.message}`);
    });
  }).catch((err) => {
    logDebug(`Search ${id} failed to load the market page: ${err.message}`);
    // If the page fails to load, mark the search as failed and inform the renderer
    const entry = searches[id];
    if (entry) {
      entry.running = false;
      entry.finishedAt = Date.now();
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('search-updated', { searchId: id, data: [], finished: true, error: 'failed to load', moduleType: filters.moduleType });
    }
  });
  return { searchId: id };
});

/**
 * IPC handler: stop an existing search. This closes the hidden
 * BrowserWindow and removes the entry from the search table. The
 * renderer will receive a search-stopped event to update its UI.
 */
ipcMain.handle('stop-search', async (event, searchId) => {
  const entry = searches[searchId];
  if (!entry) return;
  // Mark the search as no longer running and set finish time
  entry.running = false;
  entry.finishedAt = Date.now();
  // Close the hidden window if it exists. We intentionally do not
  // delete the search entry so the results remain available in the tab.
  if (entry.window && !entry.window.isDestroyed()) {
    entry.window.close();
  }
  // Notify renderer that the search has been aborted. We send both a
  // search-updated and a search-stopped event so the UI can update
  // its status and preserve the last known data.
  // Clone data for safe transmission
  const safeData = entry.data ? JSON.parse(JSON.stringify(entry.data)) : [];
  event.sender.send('search-updated', { searchId, data: safeData, finished: true });
  event.sender.send('search-stopped', { searchId });
});

/**
 * IPC handler: retry a search. This handler takes an existing searchId
 * and restarts the scraping process using the same filters. It
 * preserves the tab but discards any previous results. If the
 * hidden window is still open, it will be closed and replaced with
 * a new instance. This allows the user to reattempt a failed search
 * without re‑entering the parameters.
 */
ipcMain.handle('retry-search', async (event, searchId) => {
  const entry = searches[searchId];
  if (!entry) return;
  // Close existing hidden window if still present
  if (entry.window && !entry.window.isDestroyed()) {
    entry.window.close();
  }
  // Create a new hidden window
  const newWin = new BrowserWindow({
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });
  await newWin.loadURL('https://tfd.nexon.com/en/market');
  // Reset search metadata
  entry.window = newWin;
  entry.running = true;
  entry.startedAt = Date.now();
  entry.finishedAt = null;
  entry.data = [];
  // Kick off the scraping logic again
  runSearch(searchId).catch((err) => {
    logDebug(`Search ${searchId} encountered an error on retry: ${err.message}`);
  });
  // Also update the debug metrics and logs
  logDebug(`Search ${searchId} retry initiated`);
});

/**
 * Execute a search within its hidden browser window. This function
 * constructs a script to run in the page context that performs the
 * module search, applies filters, scrolls through lazy-loaded
 * results and extracts relevant information from each item.
 *
 * @param {number} id The search ID
 */
async function runSearch(id) {
  const entry = searches[id];
  if (!entry) return;
  const win = entry.window;
  const filters = entry.filters || {};
  logDebug(`Search ${id} started: ${JSON.stringify(filters)}`);
  try {
    // Set the search filters in the order required by the official site.
    // 1. Select module type (Ancestors or Trigger)
    logDebug(`Search ${id}: selecting module type ${filters.moduleType}`);
    const stepSelectModuleType = `(async () => {
      const filters = ${JSON.stringify(filters)};
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const btn = document.querySelector('div[data-name="moduletype"] .dropdown__button');
      if (btn) {
        btn.click();
        await sleep(200);
        const options = Array.from(document.querySelectorAll('div[data-name="moduletype"] li'));
        const target = options.find(li => li.textContent && li.textContent.toLowerCase().includes(filters.moduleType.toLowerCase()));
        if (target) target.click();
      }
    })();`;
    await win.webContents.executeJavaScript(stepSelectModuleType, true);
    // Wait 8 seconds for the lazy loader to process module type change
    await new Promise(r => setTimeout(r, 8000));

    // 2. Enter the search term into the market search box and press enter or click search button
    logDebug(`Search ${id}: entering search term "${filters.moduleName}"`);
    const stepEnterSearch = `(async () => {
      const filters = ${JSON.stringify(filters)};
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      let input = null;
      for (let i = 0; i < 50; i++) {
        input = document.querySelector('#search__input');
        if (input) break;
        await sleep(200);
      }
      if (input) {
        input.focus();
        // Clear existing value
        input.value = '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.value = filters.moduleName || '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        // Press Enter to trigger search suggestions
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
        // Click the search button as a fallback
        const btn = document.querySelector('.search__btn');
        if (btn) btn.click();
      }
    })();`;
    await win.webContents.executeJavaScript(stepEnterSearch, true);
    // Wait 8 seconds for the initial results to load
    await new Promise(r => setTimeout(r, 8000));

    // Notify the renderer that the module name has been entered. This allows
    // the UI to update the status indicator to reflect that the search
    // query is being processed. Use a dedicated 'search-progress' event.
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('search-progress', { searchId: id, stage: 'enterName' });
    }

    // 3. Select the platform filter (sold on) after results have appeared
    logDebug(`Search ${id}: selecting platform ${filters.platform}`);
    const stepSelectPlatform = `(async () => {
      const filters = ${JSON.stringify(filters)};
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const btn = document.querySelector('div[data-name="platform"] .dropdown__button');
      if (btn) {
        btn.click();
        await sleep(200);
        const options = Array.from(document.querySelectorAll('div[data-name="platform"] li'));
        const target = options.find(li => li.textContent && li.textContent.toLowerCase().includes(filters.platform.toLowerCase()));
        if (target) target.click();
      }
    })();`;
    await win.webContents.executeJavaScript(stepSelectPlatform, true);
    // Wait 8 seconds for the sold-on filter to apply
    await new Promise(r => setTimeout(r, 8000));

    // Notify the renderer that the platform has been selected. The UI
    // can display a status indicating that the platform filter is being
    // applied. We use 'search-progress' for these intermediate states.
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('search-progress', { searchId: id, stage: 'setPlatform' });
    }

    // Inform the UI that we are now waiting for the website to
    // fully process the filter selections before beginning the scroll.
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('search-progress', { searchId: id, stage: 'waiting' });
    }

    // Now iteratively scroll and parse modules to provide incremental updates.
    logDebug(`Search ${id}: running iterative scroll and parse loop`);

    // Record the time at which the scrolling/parsing loop begins. We'll
    // monitor how long the results array remains empty. If no items are
    // discovered within a 30‑second window, we'll abort the search and
    // report a timeout error back to the renderer. This helps catch
    // cases where the site returns no results or the page structure has
    // changed in a way that prevents our parser from finding items.
    const zeroStart = Date.now();
    let zeroTimeoutTriggered = false;

    // JavaScript snippet to parse the currently loaded modules and check loader
    const parseScript = `(() => {
      function parseAncestor(item) {
        const getText = (sel) => {
          const el = item.querySelector(sel);
          return el ? el.textContent.trim() : '';
        };
        const name = getText('.row-wrapper .name') || getText('.module-name');
        const category = 'Ancestors';
        // Socket type may be present on ancestor-info or general item info
        let socketType = getText('.ancestor-info .socket-type') || getText('.item__info .socket-type');
        const requiredRank = getText('.ancestor-info .required-rank span');
        const platform = getText('.seller .platform');
        const rerollCount = getText('.seller .reroll span');
        // Extract seller name and status. The nickname element contains a text
        // node followed by an <i> element for the status. Read only the
        // first text node for the seller name and extract the status from
        // the <i> element. This matches the Chrome extension logic and
        // avoids including status words in the seller name.
        let sellerName = '';
        let sellerStatus = '';
        const nickEl = item.querySelector('.seller .nickname');
        if (nickEl) {
          // Concatenate all text nodes and remove any embedded status words
          let nameText = '';
          nickEl.childNodes.forEach(node => {
            if (node.nodeType === Node.TEXT_NODE) {
              nameText += node.textContent;
            }
          });
          sellerName = nameText.replace(/\b(online|offline)\b/gi, '').trim();
          // Fallback to trimming the entire text content if necessary
          if (!sellerName) {
            sellerName = nickEl.textContent.replace(/\b(online|offline)\b/gi, '').trim();
          }
          const stateEl = nickEl.querySelector('i');
          if (stateEl) {
            sellerStatus = stateEl.textContent.trim();
          }
        }
        const sellerRank = getText('.seller .rank span');
        let price = '';
        const priceEl = item.querySelector('.price');
        if (priceEl) {
          // Some price labels include the word "Caliber" already. Remove it
          // here so the UI can append a single "Caliber" suffix later.
          const rawPrice = priceEl.textContent.trim();
          price = rawPrice.replace(/\bCaliber\b/gi, '').trim();
        }
        const attributes = [];
        const stats = [];
        const optionEls = item.querySelectorAll('.item__details .option');
        optionEls.forEach(opt => {
          const nameEl = opt.querySelector('.option-name');
          const valueEl = opt.querySelector('.option-value');
          if (!nameEl) return;
          const raw = nameEl.textContent.trim();
          const positive = raw.startsWith('(+)');
          const negative = raw.startsWith('(-)');
          let attr = raw;
          if (positive || negative) {
            attr = attr.substring(3).trim();
          }
          attr = attr.split('[')[0].trim();
          if (attr && !attributes.includes(attr)) attributes.push(attr);
          const value = valueEl ? valueEl.textContent.trim() : '';
          stats.push({ raw, positive, negative, value });
        });
        const regDate = getText('.information .date span');
        return { name, category, socketType, requiredRank, price, platform, rerollCount, sellerName, sellerStatus, sellerRank, regDate, attributes, stats };
      }
      function parseTrigger(item) {
        const getText = (sel) => {
          const el = item.querySelector(sel);
          return el ? el.textContent.trim() : '';
        };
        const name = getText('.row-wrapper .name') || getText('.module-name');
        const category = 'Trigger';
        const socketType = '';
        let requiredRank = '';
        const reqSpan = item.querySelector('.item__info .required-mastery-rank span, .item__info .required-rank span');
        if (reqSpan && reqSpan.textContent) requiredRank = reqSpan.textContent.trim();
        const platform = getText('.seller .platform');
        const rerollCount = getText('.seller .reroll span');
        // Extract seller name and status using the same logic as in the
        // ancestor parser: only the first text node contains the name,
        // while an <i> element holds the status. This prevents status
        // strings from appearing in the seller name.
        let sellerName = '';
        let sellerStatus = '';
        const nickEl2 = item.querySelector('.seller .nickname');
        if (nickEl2) {
          let nameText = '';
          nickEl2.childNodes.forEach(node => {
            if (node.nodeType === Node.TEXT_NODE) {
              nameText += node.textContent;
            }
          });
          sellerName = nameText.replace(/\b(online|offline)\b/gi, '').trim();
          if (!sellerName) {
            sellerName = nickEl2.textContent.replace(/\b(online|offline)\b/gi, '').trim();
          }
          const stateEl2 = nickEl2.querySelector('i');
          if (stateEl2) {
            sellerStatus = stateEl2.textContent.trim();
          }
        }
        const sellerRank = getText('.seller .rank span');
        let price = '';
        const priceEl = item.querySelector('.price');
        if (priceEl) {
          const rawPrice = priceEl.textContent.trim();
          price = rawPrice.replace(/\bCaliber\b/gi, '').trim();
        }
        const attributes = [];
        const stats = [];
        const optionEls = item.querySelectorAll('.item__details .option');
        optionEls.forEach(opt => {
          const nameEl = opt.querySelector('.option-name');
          const valueEl = opt.querySelector('.option-value');
          const label = nameEl ? nameEl.textContent.trim() : '';
          const value = valueEl ? valueEl.textContent.trim() : '';
          let attr = label.split('(')[0].trim();
          if (attr && !attributes.includes(attr)) attributes.push(attr);
          stats.push({ raw: label + ' ' + value, positive: false, negative: false, value });
        });
        const regDate = getText('.information .date span');
        return { name, category, socketType, requiredRank, price, platform, rerollCount, sellerName, sellerStatus, sellerRank, regDate, attributes, stats };
      }
      // parse modules and detect loader visibility
      const items = document.querySelectorAll('.items .item');
      const loaderSelector = '[class*="loader"], [class*="loading"], [class*="spinner"]';
      const loaderEl = document.querySelector(loaderSelector);
      const loaderVisible = loaderEl && loaderEl.offsetParent !== null;
      const modules = [];
      items.forEach(item => {
        const typeEl = item.querySelector('.row-wrapper .type');
        const categoryText = typeEl ? typeEl.textContent.trim().toLowerCase() : '';
        const isTrigger = categoryText.includes('trigger');
        const mod = isTrigger ? parseTrigger(item) : parseAncestor(item);
        modules.push(mod);
      });
      // Convert the result to a JSON string to avoid structured clone errors
      return JSON.stringify({ modules, itemCount: items.length, loaderVisible });
    })()`;

    // Dedupe across iterations
    const seen = new Set();
    let deduped = [];
    let lastCount = 0;
    let stable = 0;
    const maxIterations = 60;
    for (let i = 0; i < maxIterations; i++) {
      let parsedResult;
      try {
        const resultStr = await win.webContents.executeJavaScript(parseScript, true);
        parsedResult = JSON.parse(resultStr);
      } catch (err) {
        // If parsing fails, log the error and break the loop
        logDebug(`Search ${id} parse error: ${err.message}`);
        break;
      }
      // If result contains modules, deduplicate and update
      if (parsedResult && parsedResult.modules) {
        for (const mod of parsedResult.modules) {
          const key = `${mod.name}|${mod.price}|${mod.sellerName}`;
          if (!seen.has(key)) {
            seen.add(key);
            deduped.push(mod);
          }
        }
        // Filter by module name if provided (case-insensitive)
        let filtered = deduped;
        const mName = (filters.moduleName || '').trim().toLowerCase();
        if (mName) {
          filtered = deduped.filter(m => m.name && m.name.toLowerCase().includes(mName));
        }
        entry.data = filtered;
        // Clone data to avoid structured clone errors
        const safeDataInc = JSON.parse(JSON.stringify(filtered));
        mainWindow.webContents.send('search-updated', { searchId: id, data: safeDataInc, finished: false, moduleType: filters.moduleType });
      }
      // Check for stability: if the number of items hasn't changed
      const count = parsedResult && parsedResult.itemCount ? parsedResult.itemCount : 0;
      if (count === lastCount) {
        stable++;
      } else {
        stable = 0;
        lastCount = count;
      }
      // If we've seen no new items for several iterations AND the loader is no
      // longer visible, assume we've reached the end and break.
      if (stable >= 3 && !(parsedResult && parsedResult.loaderVisible)) {
        break;
      }
      // If no results have been collected and the zero‑item timeout has
      // expired, abort the search. This prevents endless scrolling
      // when the market returns no matches. We perform this check after
      // processing each batch of modules.
      if (!zeroTimeoutTriggered && deduped.length === 0 && (Date.now() - zeroStart) > 30000) {
        zeroTimeoutTriggered = true;
        // Close the hidden window and mark the search as finished
        entry.running = false;
        entry.finishedAt = Date.now();
        if (entry.window && !entry.window.isDestroyed()) {
          entry.window.close();
        }
        // Send an error update to the renderer indicating a timeout
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('search-updated', { searchId: id, data: [], finished: true, error: 'timeout', moduleType: filters.moduleType });
        }
        logDebug(`Search ${id} timed out with zero results`);
        return;
      }
      // Scroll down to load more items
      await win.webContents.executeJavaScript(`(() => {
        window.scrollTo(0, document.body.scrollHeight);
        const c = document.querySelector('div.items');
        if (c) c.scrollTo(0, c.scrollHeight);
      })()`, true);
      // Wait a bit for new items to load
      await new Promise(r => setTimeout(r, 700));
    }
    // Finalize results
    entry.data = deduped;
    entry.running = false;
    entry.finishedAt = Date.now();
    logDebug(`Search ${id} finished with ${entry.data.length} items`);
    // Send final update with finished true
    if (mainWindow && !mainWindow.isDestroyed()) {
      // Filter final deduped list by module name again to ensure correctness
      let finalResults = deduped;
      const mName = (filters.moduleName || '').trim().toLowerCase();
      if (mName) {
        finalResults = deduped.filter(m => m.name && m.name.toLowerCase().includes(mName));
      }
      // Clone data to avoid structured clone errors
      const safeDataFin = JSON.parse(JSON.stringify(finalResults));
      mainWindow.webContents.send('search-updated', { searchId: id, data: safeDataFin, finished: true, moduleType: filters.moduleType });
    }
  } catch (err) {
    entry.running = false;
    entry.finishedAt = Date.now();
    logDebug(`Search ${id} error: ${err.message}`);
    if (mainWindow && !mainWindow.isDestroyed()) {
      // Include an error flag so the renderer can display a failure status
      mainWindow.webContents.send('search-updated', { searchId: id, data: [], finished: true, error: err.message });
    }
  }
}

/**
 * Toggle debug mode for a specific search. When enabled the hidden
 * BrowserWindow becomes visible and opens dev tools; when disabled
 * it hides the window and closes dev tools. The debug state is
 * stored on the search object.
 */
ipcMain.handle('toggle-tab-debug', async (_event, searchId) => {
  const entry = searches[searchId];
  if (!entry) return;
  entry.debug = !entry.debug;
  if (entry.debug) {
    entry.window.show();
    entry.window.webContents.openDevTools({ mode: 'detach' });
    logDebug(`Debug enabled for search ${searchId}`);
  } else {
    entry.window.hide();
    entry.window.webContents.closeDevTools();
    logDebug(`Debug disabled for search ${searchId}`);
  }
});

/**
 * Toggle the global debug window. When toggled on, a new window is
 * created showing verbose logs and metrics. When toggled off, the
 * window is destroyed. If the window is already open it will be
 * closed.
 */
ipcMain.handle('toggle-global-debug', async () => {
  if (globalDebugWindow && !globalDebugWindow.isDestroyed()) {
    globalDebugWindow.close();
    globalDebugWindow = null;
    logDebug('Global debug window closed');
    return;
  }
  // Create debug window
  globalDebugWindow = new BrowserWindow({
    width: 600,
    height: 700,
    webPreferences: {
      preload: path.join(__dirname, 'debug-preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });
  globalDebugWindow.setMenu(null);
  globalDebugWindow.loadFile(path.join(__dirname, 'debug.html'));
  globalDebugWindow.on('closed', () => {
    globalDebugWindow = null;
    logDebug('Global debug window closed');
  });
  // Send initial data when ready
  globalDebugWindow.webContents.on('did-finish-load', () => {
    globalDebugWindow.webContents.send('debug-log', {
      logs: debugLogs,
      metrics: getMetrics()
    });
  });
  logDebug('Global debug window opened');
});

/**
 * Return the full debug log and current metrics. This handler is used
 * by the debug window to poll for the latest information.
 */
ipcMain.handle('get-debug-info', async () => {
  return {
    logs: debugLogs,
    metrics: getMetrics()
  };
});