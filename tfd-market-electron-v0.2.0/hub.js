// hub.js
// Client-side logic for the TFD Market helper dashboard. Handles
// tab creation, form submission and integration with the main process
// via the exposed marketHelperAPI in preload.js.

document.addEventListener('DOMContentLoaded', () => {
  const tabBar = document.getElementById('tab-bar');
  const viewContainer = document.getElementById('view-container');
  // Reference the search form embedded in the sidebar
  const searchForm = document.getElementById('search-form');

  // Keep track of open tabs. Keys are tab ids ("dashboard" or numeric search ids).
  const tabs = {};

  /**
   * Switch to a given tab ID. Hides other views and marks the tab
   * element as active.
   * @param {string|number} tabId
   */
  function showTab(tabId) {
    // Show the selected view and hide others. Use inline display
    // properties to ensure that only the active tab's view is visible.
    Array.from(viewContainer.children).forEach(view => {
      const isActive = view.id === String(tabId) || view.id === `view-${tabId}`;
      if (isActive) {
        view.classList.add('active');
        // Use flex layout for the active view so the header and iframe stack
        view.style.display = 'flex';
      } else {
        view.classList.remove('active');
        view.style.display = 'none';
      }
    });
    // Activate the corresponding tab button
    Array.from(tabBar.children).forEach(tab => {
      if (tab.dataset.tab === String(tabId)) {
        tab.classList.add('active');
      } else {
        tab.classList.remove('active');
      }
    });
  }

  /**
   * Create a new tab and associated view for a search.
   * @param {number} searchId
   * @param {string} title
   */
  function createSearchTab(searchId, title, moduleType) {
    const idStr = String(searchId);
    // Create tab element
    const tabEl = document.createElement('div');
    tabEl.classList.add('tab');
    tabEl.dataset.tab = idStr;
    const labelSpan = document.createElement('span');
    labelSpan.textContent = title || `Search ${idStr}`;
    labelSpan.style.flex = '1';
    tabEl.appendChild(labelSpan);
    const closeSpan = document.createElement('span');
    closeSpan.textContent = '✕';
    closeSpan.classList.add('close');
    tabEl.appendChild(closeSpan);
    // Click handler to switch tabs
    tabEl.addEventListener('click', (e) => {
      // Avoid triggering tab click when clicking on close icon
      if (e.target === closeSpan) return;
      showTab(idStr);
    });
    // Double click to rename
    labelSpan.addEventListener('dblclick', () => {
      const input = document.createElement('input');
      input.type = 'text';
      input.value = labelSpan.textContent;
      input.classList.add('rename');
      tabEl.replaceChild(input, labelSpan);
      input.focus();
      const finishRename = () => {
        const newName = input.value.trim() || labelSpan.textContent;
        labelSpan.textContent = newName;
        tabEl.replaceChild(labelSpan, input);
      };
      input.addEventListener('blur', finishRename);
      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') {
          finishRename();
        }
      });
    });
    // Close search handler: stop search and remove the tab
    closeSpan.addEventListener('click', (e) => {
      e.stopPropagation();
      // Inform main process to stop this search
      window.marketHelperAPI.stopSearch(searchId);
      // Remove the tab locally
      removeSearchTab(searchId);
    });
    // Append tab
    tabBar.appendChild(tabEl);
    // Create view container
    const view = document.createElement('div');
    view.id = `view-${idStr}`;
    view.classList.add('view');
    // Header section with stop button
    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.alignItems = 'center';
    header.style.justifyContent = 'space-between';
    const h2 = document.createElement('h2');
    h2.textContent = title || `Search ${idStr}`;
    header.appendChild(h2);
    // Debug toggle button
    const debugBtn = document.createElement('button');
    debugBtn.textContent = 'Debug';
    debugBtn.classList.add('search-btn');
    debugBtn.dataset.debug = 'off';
    debugBtn.style.marginLeft = '10px';
    debugBtn.addEventListener('click', () => {
      // Toggle debug state via preload API
      window.marketHelperAPI.toggleTabDebug(searchId);
      // Toggle button label state locally
      if (debugBtn.dataset.debug === 'off') {
        debugBtn.dataset.debug = 'on';
        debugBtn.textContent = 'Hide';
      } else {
        debugBtn.dataset.debug = 'off';
        debugBtn.textContent = 'Debug';
      }
    });
    header.appendChild(debugBtn);
    // Create a wrapper for status indicator, status text, optional retry controls and stop button.
    // The wrapper uses flexbox to lay out its children horizontally. A relative
    // position allows us to position error messages absolutely above the
    // controls without affecting the overall flow.
    const statusWrapper = document.createElement('div');
    statusWrapper.style.display = 'flex';
    statusWrapper.style.alignItems = 'center';
    statusWrapper.style.gap = '8px';
    statusWrapper.style.position = 'relative';
    // Retry message (appears above the status when errors occur). Hidden by default.
    const retryMsg = document.createElement('span');
    retryMsg.classList.add('retry-message');
    retryMsg.style.position = 'absolute';
    retryMsg.style.left = '0';
    retryMsg.style.top = '-1.2rem';
    retryMsg.style.display = 'none';
    statusWrapper.appendChild(retryMsg);
    // Retry button (hidden until an error occurs). When shown, it appears
    // to the left of the status indicator and text.
    const retryBtn = document.createElement('button');
    retryBtn.textContent = 'Retry';
    retryBtn.classList.add('retry-btn');
    retryBtn.style.display = 'none';
    // Attach click handler that resets the status and triggers a retry. We
    // reference the current tab entry via the tabs object so that
    // the proper UI elements are updated, rather than relying on a
    // closure variable that may be undefined.
    retryBtn.addEventListener('click', () => {
      const currentEntry = tabs[String(searchId)];
      if (!currentEntry) return;
      // Hide message and button
      if (currentEntry.retryMsg) currentEntry.retryMsg.style.display = 'none';
      if (currentEntry.retryBtn) currentEntry.retryBtn.style.display = 'none';
      // Reset status classes
      if (currentEntry.statusEl) {
        currentEntry.statusEl.classList.remove('status-error', 'status-finished', 'status-running', 'status-stopped');
        currentEntry.statusEl.classList.add('status-sending');
      }
      if (currentEntry.statusText) {
        currentEntry.statusText.classList.remove('status-error-text', 'status-finished-text', 'status-running-text', 'status-stopped-text');
        currentEntry.statusText.classList.add('status-sending-text');
        currentEntry.statusText.textContent = 'Sending request';
      }
      if (currentEntry.stopBtn) {
        currentEntry.stopBtn.disabled = false;
      }
      // Trigger a retry via the preload API
      window.marketHelperAPI.retrySearch(searchId);
    });
    statusWrapper.appendChild(retryBtn);
    // Status indicator: shows coloured dot reflecting current state.
    const statusEl = document.createElement('span');
    statusEl.classList.add('status-indicator', 'status-sending');
    statusWrapper.appendChild(statusEl);
    // Status text: shows human‑readable message for current state.
    const statusText = document.createElement('span');
    statusText.classList.add('status-text', 'status-sending-text');
    statusText.textContent = 'Sending request';
    statusWrapper.appendChild(statusText);
    // Stop button to abort the search.
    const stopBtn = document.createElement('button');
    stopBtn.textContent = 'Stop';
    stopBtn.classList.add('search-btn');
    stopBtn.addEventListener('click', () => {
      window.marketHelperAPI.stopSearch(searchId);
    });
    statusWrapper.appendChild(stopBtn);
    header.appendChild(statusWrapper);
    view.appendChild(header);
    // Create an iframe to host the market helper view. This iframe
    // loads a local copy of market_helper.html and renders the
    // modules using the original extension UI. We set the view to
    // flex so that the header stays at the top and the iframe fills
    // the remaining space.
    // Do not set display here; showTab will control whether the view is shown.
    view.style.flexDirection = 'column';
    view.style.height = '100%';
    // Create the iframe and set its source. It will receive module
    // data via postMessage when the search completes.
    const iframe = document.createElement('iframe');
    iframe.src = 'market_helper.html';
    iframe.style.flex = '1 1 auto';
    iframe.style.width = '100%';
    iframe.style.border = 'none';
    view.appendChild(iframe);
    viewContainer.appendChild(view);
    // Store references for this tab, including the status element and text
    // Note: retryContainer is no longer used; retryMsg and retryBtn are handled directly.
    tabs[idStr] = { tabEl, viewEl: view, iframe, statusEl, statusText, stopBtn, moduleType, retryMsg, retryBtn };
    // When the iframe loads, initialize an empty view so the
    // user sees the extension UI rather than a blank page. Send an
    // empty dataset to the iframe so the helper renders its template.
    // When the iframe loads, initialize an empty view so the user sees
    // the extension UI rather than a blank page. Pass along the moduleType
    // so the helper can immediately render the correct ancestor/trigger layout.
    iframe.addEventListener('load', () => {
      try {
        iframe.contentWindow.postMessage({ type: 'marketData', data: [], moduleType }, '*');
      } catch (err) {
        console.error(err);
      }
    });
    // Show the newly created tab
    showTab(idStr);
  }

  /**
   * Remove a search tab and its view. Used when a search is stopped.
   * @param {number} searchId
   */
  function removeSearchTab(searchId) {
    const idStr = String(searchId);
    const entry = tabs[idStr];
    if (!entry) return;
    entry.tabEl.remove();
    entry.viewEl.remove();
    delete tabs[idStr];
    // Return to dashboard if no tabs remain
    showTab('dashboard');
  }

  // The search form resides in the sidebar. Submitting it will create a new search tab. There is no separate dashboard navigation.

  // Global debug button: open or close the debug console
  const globalDebugBtn = document.getElementById('global-debug-btn');
  if (globalDebugBtn) {
    globalDebugBtn.addEventListener('click', () => {
      window.marketHelperAPI.toggleGlobalDebug();
    });
  }

  // Handle search form submission
  searchForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const formData = new FormData(searchForm);
    const filters = {};
    formData.forEach((value, key) => {
      filters[key] = value;
    });
    // Start new search via preload API
    window.marketHelperAPI.startSearch(filters).then(({ searchId }) => {
      const title = filters.moduleName ? `${filters.moduleName} (${filters.moduleType})` : `Search ${searchId}`;
      createSearchTab(searchId, title, filters.moduleType);
    });
  });

  // Receive updates from the main process and populate the tables.
  window.marketHelperAPI.onSearchUpdated(({ searchId, data, finished, error }) => {
    const idStr = String(searchId);
    const entry = tabs[idStr];
    if (!entry) return;
    // Always update the iframe if there is data and no error. If an error
    // occurred, we do not send data to the iframe because we cannot trust
    // its structure; instead the status indicator will show an error.
    if (!error && entry.iframe && entry.iframe.contentWindow) {
      const mt = entry.moduleType;
      entry.iframe.contentWindow.postMessage({ type: 'marketData', data, moduleType: mt }, '*');
    }
    // Determine number of items returned for status display
    const count = Array.isArray(data) ? data.length : 0;
    // If an error occurred, show a failure status, disable the stop button
    // and reveal the retry UI with an appropriate message. We do not
    // update the iframe in this case since we cannot trust the data.
    if (error) {
      // Disable stop button
      if (entry.stopBtn) entry.stopBtn.disabled = true;
      // Set indicator to error
      if (entry.statusEl) {
        entry.statusEl.classList.remove('status-running');
        entry.statusEl.classList.remove('status-finished');
        entry.statusEl.classList.remove('status-sending');
        entry.statusEl.classList.remove('status-stopped');
        entry.statusEl.classList.add('status-error');
      }
      // Set text to indicate failure
      if (entry.statusText) {
        entry.statusText.classList.remove('status-running-text');
        entry.statusText.classList.remove('status-finished-text');
        entry.statusText.classList.remove('status-sending-text');
        entry.statusText.classList.remove('status-stopped-text');
        entry.statusText.classList.add('status-error-text');
        entry.statusText.textContent = 'Failed';
      }
      // Show the retry button and message. Position message above the status bar.
      if (entry.retryMsg) {
        // Determine message based on error type
        if (error === 'timeout') {
          entry.retryMsg.textContent = 'No items were found within 30 seconds.';
        } else {
          entry.retryMsg.textContent = 'An error occurred while fetching results.';
        }
        entry.retryMsg.style.display = 'block';
      }
      if (entry.retryBtn) {
        entry.retryBtn.style.display = 'inline-block';
      }
      return;
    }
    if (!finished) {
      // Hide retry message and button if currently visible
      if (entry.retryMsg) entry.retryMsg.style.display = 'none';
      if (entry.retryBtn) entry.retryBtn.style.display = 'none';
      // Update status to running if it was previously sending or error
      if (entry.statusEl) {
        entry.statusEl.classList.remove('status-sending');
        entry.statusEl.classList.remove('status-stopped');
        entry.statusEl.classList.remove('status-finished');
        entry.statusEl.classList.remove('status-error');
        entry.statusEl.classList.add('status-running');
      }
      if (entry.statusText) {
        entry.statusText.classList.remove('status-sending-text');
        entry.statusText.classList.remove('status-stopped-text');
        entry.statusText.classList.remove('status-finished-text');
        entry.statusText.classList.remove('status-error-text');
        entry.statusText.classList.add('status-running-text');
        entry.statusText.textContent = `In progress (${count})`;
      }
    } else {
      // When the search has finished, update status indicator/text and disable the stop button
      if (entry.retryMsg) entry.retryMsg.style.display = 'none';
      if (entry.retryBtn) entry.retryBtn.style.display = 'none';
      if (entry.stopBtn) entry.stopBtn.disabled = true;
      if (entry.statusEl) {
        entry.statusEl.classList.remove('status-running');
        entry.statusEl.classList.remove('status-stopped');
        entry.statusEl.classList.remove('status-sending');
        entry.statusEl.classList.remove('status-error');
        entry.statusEl.classList.add('status-finished');
      }
      if (entry.statusText) {
        entry.statusText.classList.remove('status-running-text');
        entry.statusText.classList.remove('status-stopped-text');
        entry.statusText.classList.remove('status-sending-text');
        entry.statusText.classList.remove('status-error-text');
        entry.statusText.classList.add('status-finished-text');
        entry.statusText.textContent = `Complete (${count})`;
      }
    }
  });

  // Handle progress notifications from the main process. These events
  // inform the UI about intermediate steps (entering name, setting
  // platform, waiting for results) so the status indicator can show
  // appropriate messages. Each progress event includes a stage
  // identifier. We map these stages to human‑friendly messages.
  window.marketHelperAPI.onSearchProgress(({ searchId, stage }) => {
    const idStr = String(searchId);
    const entry = tabs[idStr];
    if (!entry) return;
    // Hide any retry UI when progress updates arrive
    if (entry.retryMsg) entry.retryMsg.style.display = 'none';
    if (entry.retryBtn) entry.retryBtn.style.display = 'none';
    // Determine message based on stage
    let msg = '';
    if (stage === 'enterName') msg = 'Entering module name';
    else if (stage === 'setPlatform') msg = 'Setting platform';
    else if (stage === 'waiting') msg = 'Waiting for website';
    else msg = 'Working';
    // Update status indicator and text using sending (blue) styles
    if (entry.statusEl) {
      entry.statusEl.classList.remove('status-running');
      entry.statusEl.classList.remove('status-finished');
      entry.statusEl.classList.remove('status-stopped');
      entry.statusEl.classList.remove('status-error');
      entry.statusEl.classList.add('status-sending');
    }
    if (entry.statusText) {
      entry.statusText.classList.remove('status-running-text');
      entry.statusText.classList.remove('status-finished-text');
      entry.statusText.classList.remove('status-stopped-text');
      entry.statusText.classList.remove('status-error-text');
      entry.statusText.classList.add('status-sending-text');
      entry.statusText.textContent = msg;
    }
  });

  // When a search is stopped, remove its tab
  window.marketHelperAPI.onSearchStopped(({ searchId }) => {
    const idStr = String(searchId);
    const entry = tabs[idStr];
    if (entry) {
      // Update status indicator/text to stopped and disable stop button
      if (entry.stopBtn) entry.stopBtn.disabled = true;
      if (entry.statusEl) {
        entry.statusEl.classList.remove('status-running', 'status-finished', 'status-sending', 'status-error');
        entry.statusEl.classList.add('status-stopped');
      }
      if (entry.statusText) {
        entry.statusText.classList.remove('status-running-text', 'status-finished-text', 'status-sending-text', 'status-error-text');
        entry.statusText.classList.add('status-stopped-text');
        entry.statusText.textContent = 'Aborted';
      }
    }
  });

  // Initialize tabs object for dashboard
  tabs['dashboard'] = {
    tabEl: tabBar.querySelector('[data-tab="dashboard"]'),
    viewEl: document.getElementById('dashboard')
  };
});