// preload.js
// Runs in an isolated context before the renderer. We expose
// functions via the context bridge so that the renderer can
// communicate with the main process without enabling nodeIntegration.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('marketHelperAPI', {
  /**
   * Start a new search with the given filter values. Returns a
   * promise resolving to an object containing the searchId.
   * @param {Object} filters
   */
  startSearch: (filters) => ipcRenderer.invoke('start-search', filters),
  /**
   * Stop an existing search by its ID. Returns a promise.
   * @param {number} searchId
   */
  stopSearch: (searchId) => ipcRenderer.invoke('stop-search', searchId),
  /**
   * Register a callback for search update events. The callback
   * receives an object: { searchId, data, finished }.
   * @param {function} callback
   */
  onSearchUpdated: (callback) => {
    ipcRenderer.on('search-updated', (_event, payload) => callback(payload));
  },
  /**
   * Register a callback for search stopped events.
   * @param {function} callback
   */
  onSearchStopped: (callback) => {
    ipcRenderer.on('search-stopped', (_event, payload) => callback(payload));
  }
  ,
  /**
   * Toggle debug mode for a specific search tab. When enabled the
   * hidden browser window becomes visible and dev tools open. When
   * disabled the window hides and dev tools close.
   */
  toggleTabDebug: (searchId) => ipcRenderer.invoke('toggle-tab-debug', searchId),
  /**
   * Toggle the global debug console. Opens or closes the debug
   * window which displays logs and metrics.
   */
  toggleGlobalDebug: () => ipcRenderer.invoke('toggle-global-debug')
  ,
  /**
   * Retry an existing search by its ID. Reuses the stored filters
   * associated with the search and reruns the scraping logic. Returns
   * a promise.
   * @param {number} searchId
   */
  retrySearch: (searchId) => ipcRenderer.invoke('retry-search', searchId)

  ,
  /**
   * Register a callback for search progress events. The callback
   * receives an object containing the searchId and stage string,
   * indicating the current step (e.g. 'enterName', 'setPlatform',
   * 'waiting').
   * @param {function} callback
   */
  onSearchProgress: (callback) => {
    ipcRenderer.on('search-progress', (_event, payload) => callback(payload));
  }
});