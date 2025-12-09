// helper.js
// This script powers the Market Helper UI. It reads module data from
// chrome.storage (as saved by the popup), prepares unique lists of
// categories and attributes, and implements interactive filtering.

(function() {
  let modules = [];
  // Globals for trigger mode filtering and sorting
  let triggerAttrMap = null;
  let triggerFilterValues = {};
  let isTriggerMode = false;
  // Globals for additional filters: required mastery rank (MR), rerolls, status and age
  let mrMinVal = null;
  let mrMaxVal = null;
  let rerollMinVal = null;
  let rerollMaxVal = null;
  let selectedStatuses = [];
  let ageMinVal = null;
  let ageMaxVal = null;
  // Globals for age (hours) filter
  let ageHoursMinVal = null;
  let ageHoursMaxVal = null;
  // Globals for negative attribute filtering
  let negAttributes = [];
  let selectedNegAttrs = [];
  // Seller name filter (text search)
  let sellerFilterVal = '';
  // Module name filter (ancestor mode only)
  let moduleNames = [];
  let selectedModuleNames = [];

  // Map of attribute name to {min, max} across all modules. Used for
  // placeholder values and to constrain user inputs when filtering by
  // attribute values.
  const attrRangeMap = {};
  // Stores per-selected-attribute min/max values entered by the user.
  let selectedAttrRanges = {};
  // In the Electron build we do not automatically read from chrome.storage.
  // The parent frame will supply module data via postMessage and call
  // initializeUI explicitly. When packaged as a Chrome extension this block
  // would populate modules from storage.
  if (typeof chrome !== 'undefined' && chrome.storage) {
    // Skip automatic load; do nothing here.
  }

  function initializeUI(data) {
    // Build list of unique categories, attributes, sockets and platforms
    const categorySet = new Set();
    const attributeSet = new Set();
    const socketSet = new Set();
    const platformSet = new Set();
    data.forEach(mod => {
      if (mod.category) categorySet.add(mod.category);
      if (mod.socketType) socketSet.add(mod.socketType);
      if (mod.platform) platformSet.add(mod.platform);
      (mod.attributes || []).forEach(attr => attributeSet.add(attr));
    });
    const categories = Array.from(categorySet).sort();
    const attributes = Array.from(attributeSet).sort();
    const sockets = Array.from(socketSet).sort();
    const platforms = Array.from(platformSet).sort();

    // Collect unique module names (used for module name filter)
    const moduleSet = new Set();
    data.forEach(mod => {
      if (mod.name) moduleSet.add(mod.name);
    });
    moduleNames = Array.from(moduleSet).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

    // Collect negative attributes and annotate each module with a list of its negative attribute names.
    const negAttrSet = new Set();
    data.forEach(mod => {
      mod.negAttributes = [];
      (mod.stats || []).forEach(stat => {
        if (stat.negative) {
          const raw = stat.raw.trim();
          if (!raw) return;
          const parts = raw.split(/\s+/);
          parts.pop();
          const label = parts.join(' ');
          const attrName = label.split('[')[0].trim();
          if (attrName) {
            mod.negAttributes.push(attrName);
            negAttrSet.add(attrName);
          }
        }
      });
    });
    negAttributes = Array.from(negAttrSet).sort();

    // Build attribute value ranges and per-module attrValues. For each
    // stat, extract numeric values from the value string (e.g., '[37.2~140.3]%'),
    // compute the average of any numbers present, and record the min and max
    // across all modules for each attribute. These will be used to provide
    // placeholders for per-attribute min/max filters in ancestor mode and to
    // filter modules by specific value ranges when the user enters min/max.
    data.forEach(mod => {
      mod.attrValues = {};
      (mod.stats || []).forEach(stat => {
        const raw = (stat.raw || '').trim();
        if (!raw) return;
        // Determine attribute name from raw: remove sign and range part
        const parts = raw.split(/\s+/);
        const lastToken = parts.pop();
        const label = parts.join(' ');
        const attrName = label.replace(/^\(\+\)|^\(\-\)/, '').split('[')[0].trim();
        if (!attrName) return;
        // Determine numeric value: prefer stat.value (actual value) if provided
        let avg = null;
        let valStr = null;
        if (stat.value && stat.value.trim() !== '') {
          valStr = stat.value.trim();
        }
        if (valStr) {
          const match = valStr.match(/-?[0-9]+(?:\.[0-9]+)?/);
          if (match) {
            avg = parseFloat(match[0]);
          }
        }
        // If actual value could not be parsed, fall back to averaging numbers in range token
        if (avg === null || avg === undefined) {
          const matches = lastToken.match(/-?[0-9]+(?:\.[0-9]+)?/g);
          if (matches && matches.length > 0) {
            let sum = 0;
            matches.forEach(n => {
              const f = parseFloat(n);
              if (!isNaN(f)) sum += f;
            });
            avg = sum / matches.length;
          }
        }
        mod.attrValues[attrName] = avg;
        if (!attrRangeMap[attrName]) {
          attrRangeMap[attrName] = { min: avg, max: avg };
        } else {
          const range = attrRangeMap[attrName];
          if (avg !== null && avg !== undefined) {
            if (range.min === null || range.min === undefined || avg < range.min) range.min = avg;
            if (range.max === null || range.max === undefined || avg > range.max) range.max = avg;
          }
        }
      });
    });

    // Detect if all modules are trigger modules. If so, we'll toggle to trigger
    // mode which replaces the attribute search bar with dynamic min/max
    // filters for each item option. We do this early so we can set up the
    // appropriate UI components.
    // Explicitly reference the main attribute search container by ID. Using
    // querySelector('.search-container') could return the wrong element when
    // multiple search containers exist (e.g., negative search, module search).
    const searchContainer = document.getElementById('attributeSearchContainer');
    const triggerFiltersDiv = document.getElementById('triggerFilters');
    const selectedDiv = document.getElementById('selectedAttributes');
    const suggestionsDiv = document.getElementById('attributeSuggestions');
    const sortSelect = document.getElementById('sortSelect');

    // Seller filter input
    const sellerFilterInput = document.getElementById('sellerFilter');

    // Module name filter elements
    const moduleFilterGroup = document.getElementById('moduleFilterGroup');
    const moduleNameSearch = document.getElementById('moduleNameSearch');
    const moduleNameSuggestions = document.getElementById('moduleNameSuggestions');
    const selectedModuleNamesDiv = document.getElementById('selectedModuleNames');
    const clearModuleNamesBtn = document.getElementById('clearModuleNames');
    const moduleNameSearchContainer = document.getElementById('moduleNameSearchContainer');

    // Elements for negative attribute search (appears only in ancestor mode)
    const negSearchContainer = document.getElementById('negSearchContainer');
    const negSearchInput = document.getElementById('negAttributeSearch');
    const negSuggestionsBox = document.getElementById('negAttributeSuggestions');
    const negSelectedDivRef = document.getElementById('negSelectedAttributes');

    // Determine if dataset is exclusively Trigger modules.  If every module
    // contains the word "trigger" in its category, treat the view as a
    // Trigger modules view.  Otherwise assume Ancestor modules.  Trim and
    // lowercase for robustness.
    isTriggerMode = data.length > 0 && data.every(mod => {
      return mod.category && typeof mod.category === 'string' && mod.category.toLowerCase().includes('trigger');
    });

    // If in trigger mode, hide attribute search and selected chips, and build
    // trigger-specific filters. Otherwise, hide trigger filters and ensure the
    // search bar is visible.
    function setupMode() {
      const modeEl = document.getElementById('modeIndicator');
      const modeSideEl = document.getElementById('modeIndicatorSide');
      // Grab MR and reroll filter groups to toggle their visibility based on mode
      const mrGroup = document.getElementById('mrFilterGroup');
      const rerollGroup = document.getElementById('rerollFilterGroup');
      // Grab socket filter group
      const socketGroup = document.getElementById('socketFilterGroup');
      // Clear buttons for search bars
      const clearMainBtnEl = document.getElementById('clearMainSearch');
      const clearNegBtnEl = document.getElementById('clearNegSearch');
      if (isTriggerMode) {
        // Hide the main search row and its selected chips
        const searchRowEl = document.querySelector('.search-row');
        if (searchRowEl) searchRowEl.classList.add('hidden');
        if (selectedDiv) selectedDiv.classList.add('hidden');
        // Hide the negative search row and its selected chips
        const negRowEl = document.getElementById('negSearchRow');
        if (negRowEl) negRowEl.classList.add('hidden');
        if (negSearchContainer) negSearchContainer.classList.add('hidden');
        if (negSelectedDivRef) negSelectedDivRef.classList.add('hidden');
        // Hide clear buttons in trigger mode
        if (clearMainBtnEl) clearMainBtnEl.classList.add('hidden');
        if (clearNegBtnEl) clearNegBtnEl.classList.add('hidden');
        // Show trigger filters
        if (triggerFiltersDiv) {
          triggerFiltersDiv.classList.remove('hidden');
          // Build trigger filters only if not yet built
          buildTriggerFilters(data);
        }
        // Set mode indicators
        if (modeEl) modeEl.textContent = 'Trigger Modules';
        if (modeSideEl) modeSideEl.textContent = 'Trigger Modules';
        // Hide MR, reroll, and socket filter groups in trigger mode
        if (mrGroup) mrGroup.classList.add('hidden');
        if (rerollGroup) rerollGroup.classList.add('hidden');
        if (socketGroup) socketGroup.classList.add('hidden');
        // Hide module name filter group if present
        const moduleGroup = document.getElementById('moduleFilterGroup');
        if (moduleGroup) moduleGroup.classList.add('hidden');
      } else {
        // Show the main search row and its chips
        const searchRowEl = document.querySelector('.search-row');
        if (searchRowEl) searchRowEl.classList.remove('hidden');
        if (selectedDiv) selectedDiv.classList.remove('hidden');
        // Show the negative search row and its chips
        const negRowEl = document.getElementById('negSearchRow');
        if (negRowEl) negRowEl.classList.remove('hidden');
        if (negSearchContainer) negSearchContainer.classList.remove('hidden');
        if (negSelectedDivRef) negSelectedDivRef.classList.remove('hidden');
        // Show clear buttons
        if (clearMainBtnEl) clearMainBtnEl.classList.remove('hidden');
        if (clearNegBtnEl) clearNegBtnEl.classList.remove('hidden');
        // Hide trigger filters
        if (triggerFiltersDiv) {
          triggerFiltersDiv.classList.add('hidden');
          triggerFiltersDiv.innerHTML = '';
        }
        // Set mode indicators
        if (modeEl) modeEl.textContent = 'Ancestor Modules';
        if (modeSideEl) modeSideEl.textContent = 'Ancestor Modules';
        // Show MR, reroll and socket filters
        if (mrGroup) mrGroup.classList.remove('hidden');
        if (rerollGroup) rerollGroup.classList.remove('hidden');
        if (socketGroup) socketGroup.classList.remove('hidden');
        // Show module name filter group if present
        const moduleGroup2 = document.getElementById('moduleFilterGroup');
        if (moduleGroup2) moduleGroup2.classList.remove('hidden');
      }
    }


    // Determine min and max prices across all modules
    const priceNumbers = data
      .map(mod => {
        const num = parseFloat((mod.price || '').replace(/[^0-9.]/g, ''));
        return isNaN(num) ? null : num;
      })
      .filter(num => num !== null);
    const minPrice = priceNumbers.length ? Math.min(...priceNumbers) : null;
    const maxPrice = priceNumbers.length ? Math.max(...priceNumbers) : null;

    // Populate category buttons as filter toggles
    const catContainer = document.getElementById('categoryButtons');
    categories.forEach(cat => {
      const btn = document.createElement('button');
      btn.className = '';
      // Use dataset to track active state
      btn.dataset.active = 'false';
      btn.dataset.value = cat;
      btn.textContent = cat;
      btn.addEventListener('click', () => {
        const isActive = btn.dataset.active === 'true';
        btn.dataset.active = (!isActive).toString();
        btn.classList.toggle('active');
        updateResults();
      });
      catContainer.appendChild(btn);
    });

    // Helper to fetch active categories based on data-active attribute
    function getActiveCategories() {
      return Array.from(catContainer.querySelectorAll('button[data-active="true"]')).map(btn => btn.dataset.value);
    }

    // Set up attribute search and selection
    const searchInput = document.getElementById('attributeSearch');
    const suggestionsBox = document.getElementById('attributeSuggestions');
    const selectedDivRef = document.getElementById('selectedAttributes');
    let selectedAttrs = [];

    /**
     * Render the suggestion dropdown. When the query is empty we show all
     * available attributes (minus any that have already been selected) in
     * alphabetical order. Otherwise we filter the list by the query.
     */
    function renderSuggestions() {
      const query = searchInput.value.trim().toLowerCase();
      suggestionsBox.innerHTML = '';
      // Determine which attributes to display: always filter out already-selected attributes
      const matches = attributes.filter(attr => attr.toLowerCase().includes(query) && !selectedAttrs.includes(attr));
      if (matches.length > 0) {
        suggestionsBox.classList.remove('hidden');
      } else {
        // If the query is empty but no matches (i.e. all attributes selected), hide suggestions
        suggestionsBox.classList.add('hidden');
      }
      // Show up to 100 suggestions. Sorting is preserved from `attributes` array
      matches.slice(0, 100).forEach(attr => {
        const div = document.createElement('div');
        div.className = 'suggestion-item';
        div.textContent = attr;
        // Use mousedown instead of click so the handler runs before the input blur.
        // Prevent propagation to avoid the outside click handler from hiding suggestions prematurely.
        div.addEventListener('mousedown', (e) => {
          e.preventDefault();
          e.stopPropagation();
          selectedAttrs.push(attr);
          // Initialize min/max range for this attribute
          if (!selectedAttrRanges[attr]) selectedAttrRanges[attr] = { min: null, max: null };
          renderSelected();
          searchInput.value = '';
          suggestionsBox.innerHTML = '';
          suggestionsBox.classList.add('hidden');
          updateResults();
          // Blur input so that subsequent clicks retrigger focus and suggestions rendering
          searchInput.blur();
        });
        suggestionsBox.appendChild(div);
      });
    }
    // Show suggestions when the user types
    searchInput.addEventListener('input', renderSuggestions);
    // Also show suggestions when the search box gains focus. This gives users
    // immediate visibility into all available attributes.
    searchInput.addEventListener('focus', () => {
      // Trigger suggestion rendering even if the query is empty
      renderSuggestions();
    });

    // Hide suggestions when focus is lost and no selection is made. Use a
    // timeout to allow click events on suggestion items before hiding.
    searchInput.addEventListener('blur', () => {
      setTimeout(() => {
        suggestionsBox.classList.add('hidden');
      }, 100);
    });

    // NOTE: We rely on the blur event to hide the suggestions.  Removing the
    // global click handler prevents suggestions from disappearing too quickly
    // when interacting with other elements in the top bar.

    // Clear button for main search bar
    const clearMainBtn = document.getElementById('clearMainSearch');
    if (clearMainBtn) {
      clearMainBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        // Reset selected attributes and search input
        selectedAttrs = [];
        // Clear any per-attribute ranges
        selectedAttrRanges = {};
        searchInput.value = '';
        renderSelected();
        suggestionsBox.innerHTML = '';
        suggestionsBox.classList.add('hidden');
        updateResults();
      });
    }

    // Set up negative attribute search.  This appears only in ancestor mode and allows
    // users to exclude results that have selected attributes as negative stats.
    if (negSearchInput) {
      function renderNegSuggestions() {
        const query = negSearchInput.value.trim().toLowerCase();
        negSuggestionsBox.innerHTML = '';
        const matches = negAttributes.filter(attr => attr.toLowerCase().includes(query) && !selectedNegAttrs.includes(attr));
        if (matches.length > 0) {
          negSuggestionsBox.classList.remove('hidden');
        } else {
          negSuggestionsBox.classList.add('hidden');
        }
        matches.slice(0, 100).forEach(attr => {
          const div = document.createElement('div');
          div.className = 'suggestion-item';
          div.textContent = attr;
          // Use mousedown instead of click to ensure the handler runs before the input loses focus.
          // Also stop propagation and prevent default to avoid the global click/blur handlers from
          // hiding the suggestions prematurely.
          div.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            selectedNegAttrs.push(attr);
            renderNegSelected();
            negSearchInput.value = '';
            negSuggestionsBox.innerHTML = '';
            negSuggestionsBox.classList.add('hidden');
            updateResults();
            // Blur the input so that a subsequent click will re-trigger the focus event
            // and reopen suggestions. Without blurring, the input remains focused and
            // clicking again doesn’t fire the focus event.
            negSearchInput.blur();
          });
          negSuggestionsBox.appendChild(div);
        });
      }
      function renderNegSelected() {
        if (!negSelectedDivRef) return;
        negSelectedDivRef.innerHTML = '';
        selectedNegAttrs.forEach(attr => {
          const chip = document.createElement('div');
          chip.className = 'chip';
          const text = document.createElement('span');
          text.textContent = attr;
          const remove = document.createElement('span');
          remove.textContent = '✕';
          remove.addEventListener('click', () => {
            selectedNegAttrs = selectedNegAttrs.filter(a => a !== attr);
            renderNegSelected();
            updateResults();
          });
          chip.appendChild(text);
          chip.appendChild(remove);
          negSelectedDivRef.appendChild(chip);
        });
      }
      negSearchInput.addEventListener('input', renderNegSuggestions);
      negSearchInput.addEventListener('focus', () => {
        renderNegSuggestions();
      });
      negSearchInput.addEventListener('blur', () => {
        setTimeout(() => {
          negSuggestionsBox.classList.add('hidden');
        }, 100);
      });
      // We rely on the blur event to hide negative suggestions.  Do not
      // globally capture clicks to avoid prematurely closing the dropdown.

      // Clear button for negative search bar
      const clearNegBtn = document.getElementById('clearNegSearch');
      if (clearNegBtn) {
        clearNegBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          selectedNegAttrs = [];
          if (negSearchInput) negSearchInput.value = '';
          renderNegSelected();
          negSuggestionsBox.innerHTML = '';
          negSuggestionsBox.classList.add('hidden');
          updateResults();
        });
      }
    }

    // Hook sort select to re-render results when changed
    if (sortSelect) {
      sortSelect.addEventListener('change', () => {
        updateResults();
      });
      // Set default sort to price descending (highest caliber first)
      sortSelect.value = 'priceDesc';
    }

    // Hook seller name filter
    if (sellerFilterInput) {
      sellerFilterInput.addEventListener('input', () => {
        sellerFilterVal = sellerFilterInput.value.trim().toLowerCase();
        updateResults();
      });
    }

    function renderSelected() {
      selectedDivRef.innerHTML = '';
      selectedAttrs.forEach(attr => {
        const chip = document.createElement('div');
        chip.className = 'chip';
        // Text span for attribute name
        const text = document.createElement('span');
        text.className = 'chip-label';
        text.textContent = attr;
        chip.appendChild(text);
        // Create a container for min/max inputs
        const rangeContainer = document.createElement('div');
        rangeContainer.className = 'chip-range';
        // Ensure attr range map exists
        const rangeInfo = attrRangeMap[attr] || {};
        // Create min input
        const minInput = document.createElement('input');
        minInput.type = 'number';
        minInput.step = '0.01';
        minInput.className = 'chip-input';
        // Placeholder shows overall min
        if (rangeInfo.min !== null && rangeInfo.min !== undefined) {
          minInput.placeholder = rangeInfo.min.toFixed(2);
        }
        // Set current value from selectedAttrRanges
        if (selectedAttrRanges[attr] && selectedAttrRanges[attr].min !== null && selectedAttrRanges[attr].min !== undefined) {
          minInput.value = selectedAttrRanges[attr].min;
        }
        minInput.addEventListener('input', () => {
          const val = parseFloat(minInput.value);
          if (!selectedAttrRanges[attr]) selectedAttrRanges[attr] = { min: null, max: null };
          selectedAttrRanges[attr].min = isNaN(val) ? null : val;
          updateResults();
        });
        // Create max input
        const maxInput = document.createElement('input');
        maxInput.type = 'number';
        maxInput.step = '0.01';
        maxInput.className = 'chip-input';
        if (rangeInfo.max !== null && rangeInfo.max !== undefined) {
          maxInput.placeholder = rangeInfo.max.toFixed(2);
        }
        if (selectedAttrRanges[attr] && selectedAttrRanges[attr].max !== null && selectedAttrRanges[attr].max !== undefined) {
          maxInput.value = selectedAttrRanges[attr].max;
        }
        maxInput.addEventListener('input', () => {
          const val = parseFloat(maxInput.value);
          if (!selectedAttrRanges[attr]) selectedAttrRanges[attr] = { min: null, max: null };
          selectedAttrRanges[attr].max = isNaN(val) ? null : val;
          updateResults();
        });
        rangeContainer.appendChild(minInput);
        rangeContainer.appendChild(maxInput);
        chip.appendChild(rangeContainer);
        // Remove button
        const remove = document.createElement('span');
        remove.className = 'chip-remove';
        remove.textContent = '✕';
        remove.addEventListener('click', () => {
          selectedAttrs = selectedAttrs.filter(a => a !== attr);
          // Also remove any range entries
          delete selectedAttrRanges[attr];
          renderSelected();
          updateResults();
        });
        chip.appendChild(remove);
        selectedDivRef.appendChild(chip);
      });
    }

    // Build socket filter checkboxes
    const socketFilterDiv = document.getElementById('socketFilters');
    const selectedSockets = [];
    sockets.forEach(sock => {
      const label = document.createElement('label');
      label.className = 'filter-option';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = sock;
      // Use default checkbox styling; accent colour defined by CSS
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          selectedSockets.push(sock);
        } else {
          const idx = selectedSockets.indexOf(sock);
          if (idx !== -1) selectedSockets.splice(idx, 1);
        }
        updateResults();
      });
      const span = document.createElement('span');
      span.textContent = sock;
      label.appendChild(checkbox);
      label.appendChild(span);
      socketFilterDiv.appendChild(label);
    });

    // Build platform filter checkboxes
    const platformFilterDiv = document.getElementById('platformFilters');
    const selectedPlatforms = [];
    platforms.forEach(plat => {
      const label = document.createElement('label');
      label.className = 'filter-option';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = plat;
      // Use default checkbox styling
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          selectedPlatforms.push(plat);
        } else {
          const idx = selectedPlatforms.indexOf(plat);
          if (idx !== -1) selectedPlatforms.splice(idx, 1);
        }
        updateResults();
      });
      const span = document.createElement('span');
      span.textContent = plat;
      label.appendChild(checkbox);
      label.appendChild(span);
      platformFilterDiv.appendChild(label);
    });

    const cardsContainer = document.getElementById('cardsContainer');
    // Price filter inputs
    const priceMinInput = document.getElementById('priceMin');
    const priceMaxInput = document.getElementById('priceMax');
    let priceMinVal = null;
    let priceMaxVal = null;
    if (priceMinInput && priceMaxInput) {
      // Use generic placeholders and display actual min/max values separately
      priceMinInput.placeholder = 'Min';
      priceMaxInput.placeholder = 'Max';
      // Display min/max price values in price info element
      const priceInfo = document.getElementById('priceRangeInfo');
      if (priceInfo) {
        if (minPrice !== null && maxPrice !== null) {
          priceInfo.textContent = `Min price: ${minPrice}  |  Max price: ${maxPrice}`;
        } else {
          priceInfo.textContent = '';
        }
      }
      priceMinInput.addEventListener('input', () => {
        priceMinVal = priceMinInput.value ? parseFloat(priceMinInput.value) : null;
        updateResults();
      });
      priceMaxInput.addEventListener('input', () => {
        priceMaxVal = priceMaxInput.value ? parseFloat(priceMaxInput.value) : null;
        updateResults();
      });
    }

    // -------- Additional Filters (MR, Rerolls, Status, Age) --------
    // Compute min/max for required mastery rank and rerolls, and build
    // lists of statuses and age days.  We also augment each module with
    // numeric properties for MR, rerolls and age for efficient filtering.
    let mrNumbers = [];
    let rerollNumbers = [];
    const statusSet = new Set();
    let ageNumbers = [];
    // Track age values expressed purely in hours (e.g. "19 hours ago")
    let ageHoursNumbers = [];
    // Helper to convert registration date strings like "4 days ago" or "5 hours ago"
    // into a numeric age in days.  Hours are converted to fractional days.
    function parseAgeToDays(str) {
      if (!str || typeof str !== 'string') return null;
      const lower = str.toLowerCase();
      // Match number and unit (day(s) or hour(s))
      const m = lower.match(/(\d+(?:\.\d+)?)\s*(day|days|hour|hours)/);
      if (m) {
        const val = parseFloat(m[1]);
        const unit = m[2];
        if (unit.startsWith('day')) {
          return val;
        } else if (unit.startsWith('hour')) {
          return val / 24;
        }
      }
      return null;
    }

    // Parse a registration date string and return the age in hours.
    // Supports strings like "3 days ago" or "12 hours ago". If the time
    // is specified in days, this returns 0 since day-based items have no
    // specific hour component. For hour-based strings, it returns the
    // numeric hour count. Returns null for unrecognised formats.
    function parseAgeToHours(str) {
      if (!str || typeof str !== 'string') return null;
      const lower = str.toLowerCase();
      const m = lower.match(/(\d+(?:\.\d+)?)\s*(day|days|hour|hours)/);
      if (m) {
        const val = parseFloat(m[1]);
        const unit = m[2];
        if (unit.startsWith('hour')) {
          return val;
        } else if (unit.startsWith('day')) {
          // Convert days to hours (1 day = 24 hours) so that hour filters
          // correctly exclude day-based entries when a narrow hour range is set.
          return val * 24;
        }
      }
      return null;
    }
    data.forEach(mod => {
      // Required mastery rank (some modules may omit this).  Convert strings to integers when possible.
      let mrVal = null;
      if (mod.requiredRank !== undefined && mod.requiredRank !== null && mod.requiredRank !== '') {
        const parsed = parseInt(mod.requiredRank.toString().replace(/[^0-9]/g, ''), 10);
        if (!isNaN(parsed)) mrVal = parsed;
      }
      mod.__mrVal = mrVal;
      if (mrVal !== null) mrNumbers.push(mrVal);
      // Reroll count: treat '-' or empty as 0
      let rerollVal = null;
      if (mod.rerollCount !== undefined && mod.rerollCount !== null && mod.rerollCount !== '') {
        const cleaned = mod.rerollCount.toString().trim();
        if (cleaned === '-' || cleaned === '') {
          rerollVal = 0;
        } else {
          const parsed = parseInt(cleaned.replace(/[^0-9]/g, ''), 10);
          rerollVal = isNaN(parsed) ? null : parsed;
        }
      }
      mod.__rerollVal = rerollVal;
      if (rerollVal !== null) rerollNumbers.push(rerollVal);
      // Status
      if (mod.sellerStatus) statusSet.add(mod.sellerStatus);
      // Age in days and hours
      const ageDays = parseAgeToDays(mod.regDate);
      mod.__ageDays = ageDays;
      if (ageDays !== null) ageNumbers.push(ageDays);
      const ageHours = parseAgeToHours(mod.regDate);
      mod.__ageHours = ageHours;
      if (ageHours !== null) ageHoursNumbers.push(ageHours);
    });
    const minMR = mrNumbers.length ? Math.min(...mrNumbers) : null;
    const maxMR = mrNumbers.length ? Math.max(...mrNumbers) : null;
    const minRerolls = rerollNumbers.length ? Math.min(...rerollNumbers) : null;
    const maxRerolls = rerollNumbers.length ? Math.max(...rerollNumbers) : null;
    const minAge = ageNumbers.length ? Math.min(...ageNumbers) : null;
    const maxAge = ageNumbers.length ? Math.max(...ageNumbers) : null;
    const minAgeHours = ageHoursNumbers.length ? Math.min(...ageHoursNumbers) : null;
    const maxAgeHours = ageHoursNumbers.length ? Math.max(...ageHoursNumbers) : null;
    // Sort statuses so that 'Online' appears before 'Offline' and maintain alphabetical order for other statuses
    const statuses = Array.from(statusSet).sort((a, b) => {
      const aLower = a.toLowerCase();
      const bLower = b.toLowerCase();
      if (aLower === bLower) return 0;
      if (aLower === 'online') return -1;
      if (bLower === 'online') return 1;
      if (aLower === 'offline') return 1;
      if (bLower === 'offline') return -1;
      return aLower.localeCompare(bLower);
    });

    // Setup MR inputs
    const mrMinInput = document.getElementById('mrMin');
    const mrMaxInput = document.getElementById('mrMax');
    if (mrMinInput && mrMaxInput) {
      mrMinInput.placeholder = minMR !== null ? minMR.toString() : '';
      mrMaxInput.placeholder = maxMR !== null ? maxMR.toString() : '';
      mrMinInput.addEventListener('input', () => {
        const val = parseInt(mrMinInput.value, 10);
        mrMinVal = isNaN(val) ? null : val;
        updateResults();
      });
      mrMaxInput.addEventListener('input', () => {
        const val = parseInt(mrMaxInput.value, 10);
        mrMaxVal = isNaN(val) ? null : val;
        updateResults();
      });
    }
    // Setup rerolls inputs
    const rerMinInput = document.getElementById('rerollMin');
    const rerMaxInput = document.getElementById('rerollMax');
    if (rerMinInput && rerMaxInput) {
      rerMinInput.placeholder = minRerolls !== null ? minRerolls.toString() : '';
      rerMaxInput.placeholder = maxRerolls !== null ? maxRerolls.toString() : '';
      rerMinInput.addEventListener('input', () => {
        const val = parseInt(rerMinInput.value, 10);
        rerollMinVal = isNaN(val) ? null : val;
        updateResults();
      });
      rerMaxInput.addEventListener('input', () => {
        const val = parseInt(rerMaxInput.value, 10);
        rerollMaxVal = isNaN(val) ? null : val;
        updateResults();
      });
    }
    // Setup status checkboxes
    const statusFilterDiv = document.getElementById('statusFilters');
    if (statusFilterDiv) {
      statusFilterDiv.innerHTML = '';
      statuses.forEach(status => {
        const label = document.createElement('label');
        label.className = 'filter-option';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = status;
        checkbox.addEventListener('change', () => {
          if (checkbox.checked) {
            selectedStatuses.push(status);
          } else {
            selectedStatuses = selectedStatuses.filter(s => s !== status);
          }
          updateResults();
        });
        const span = document.createElement('span');
        span.textContent = status;
        label.appendChild(checkbox);
        label.appendChild(span);
        statusFilterDiv.appendChild(label);
      });
    }
    // Setup age inputs (age in days)
    const ageMinInput = document.getElementById('ageMin');
    const ageMaxInput = document.getElementById('ageMax');
    if (ageMinInput && ageMaxInput) {
      ageMinInput.placeholder = minAge !== null ? minAge.toFixed(2) : '';
      ageMaxInput.placeholder = maxAge !== null ? maxAge.toFixed(2) : '';
      ageMinInput.addEventListener('input', () => {
        const val = parseFloat(ageMinInput.value);
        ageMinVal = isNaN(val) ? null : val;
        updateResults();
      });
      ageMaxInput.addEventListener('input', () => {
        const val = parseFloat(ageMaxInput.value);
        ageMaxVal = isNaN(val) ? null : val;
        updateResults();
      });
    }

    // Setup age inputs (age in hours)
    const ageHoursMinInput = document.getElementById('ageHoursMin');
    const ageHoursMaxInput = document.getElementById('ageHoursMax');
    if (ageHoursMinInput && ageHoursMaxInput) {
      ageHoursMinInput.placeholder = minAgeHours !== null ? minAgeHours.toString() : '';
      ageHoursMaxInput.placeholder = maxAgeHours !== null ? maxAgeHours.toString() : '';
      ageHoursMinInput.addEventListener('input', () => {
        const val = parseFloat(ageHoursMinInput.value);
        ageHoursMinVal = isNaN(val) ? null : val;
        updateResults();
      });
      ageHoursMaxInput.addEventListener('input', () => {
        const val = parseFloat(ageHoursMaxInput.value);
        ageHoursMaxVal = isNaN(val) ? null : val;
        updateResults();
      });
    }

    /**
     * Build dynamic min/max filters for trigger modules. This function
     * computes the numeric values for each attribute across all modules and
     * constructs a filter UI with min and max inputs. The values for each
     * module are stored on the module itself under `triggerValues` for
     * later filtering in updateResults().
     */
    function buildTriggerFilters(modulesList) {
      triggerAttrMap = {};
      triggerFilterValues = {};
      // Compute attribute ranges and attach numeric values per module
      modulesList.forEach(mod => {
        mod.triggerValues = {};
        (mod.stats || []).forEach(stat => {
          const raw = (stat.raw || '').trim();
          if (!raw) return;
          const parts = raw.split(/\s+/);
          const valueStr = parts.pop();
          const label = parts.join(' ');
          const attrName = label.split('(')[0].trim();
          // Extract numeric portion of the value string
          const match = valueStr.match(/([0-9]+(?:\.[0-9]+)?)/);
          const numVal = match ? parseFloat(match[1]) : null;
          mod.triggerValues[attrName] = numVal;
          if (!triggerAttrMap[attrName]) {
            triggerAttrMap[attrName] = { min: numVal, max: numVal };
          } else {
            if (numVal !== null) {
              if (triggerAttrMap[attrName].min === null || numVal < triggerAttrMap[attrName].min) triggerAttrMap[attrName].min = numVal;
              if (triggerAttrMap[attrName].max === null || numVal > triggerAttrMap[attrName].max) triggerAttrMap[attrName].max = numVal;
            }
          }
        });
      });
      // Build filter UI
      if (!triggerFiltersDiv) return;
      triggerFiltersDiv.innerHTML = '';
      // Determine attribute order based on first appearance in the dataset. The
      // order array is built by scanning modules in order and recording
      // attributes as they first appear so the filters match the order shown
      // on the cards. If an attribute does not appear, it will not be included.
      const order = [];
      modulesList.forEach(mod => {
        (mod.stats || []).forEach(stat => {
          const raw = (stat.raw || '').trim();
          if (!raw) return;
          const parts = raw.split(/\s+/);
          parts.pop();
          const label = parts.join(' ');
          const attrName = label.split('(')[0].trim();
          if (attrName && !order.includes(attrName)) {
            order.push(attrName);
          }
        });
      });
      order.forEach(attr => {
        const rangeInfo = triggerAttrMap[attr];
        const group = document.createElement('div');
        group.className = 'trigger-filter-group';
        const titleDiv = document.createElement('div');
        titleDiv.className = 'trigger-title';
        titleDiv.textContent = attr;
        group.appendChild(titleDiv);
        const rangeDiv = document.createElement('div');
        rangeDiv.className = 'trigger-range';
        const minInput = document.createElement('input');
        minInput.type = 'number';
        minInput.step = '0.01';
        // Use placeholders to hint overall min and max
        minInput.placeholder = rangeInfo.min !== null && rangeInfo.min !== undefined ? rangeInfo.min.toFixed(2) : '';
        const maxInput = document.createElement('input');
        maxInput.type = 'number';
        maxInput.step = '0.01';
        maxInput.placeholder = rangeInfo.max !== null && rangeInfo.max !== undefined ? rangeInfo.max.toFixed(2) : '';
        // Event handlers update triggerFilterValues and call updateResults
        minInput.addEventListener('input', () => {
          const val = parseFloat(minInput.value);
          if (!triggerFilterValues[attr]) triggerFilterValues[attr] = { min: null, max: null };
          triggerFilterValues[attr].min = isNaN(val) ? null : val;
          updateResults();
        });
        maxInput.addEventListener('input', () => {
          const val = parseFloat(maxInput.value);
          if (!triggerFilterValues[attr]) triggerFilterValues[attr] = { min: null, max: null };
          triggerFilterValues[attr].max = isNaN(val) ? null : val;
          updateResults();
        });
        rangeDiv.appendChild(minInput);
        rangeDiv.appendChild(maxInput);
        group.appendChild(rangeDiv);
        triggerFiltersDiv.appendChild(group);
      });
    }

    // After setting up UI components, render initial module name chips and determine mode
    if (typeof renderSelectedModuleNames === 'function') {
      renderSelectedModuleNames();
    }
    setupMode();

    function updateResults() {
      // Collect active filters
      const activeCats = getActiveCategories();
      cardsContainer.innerHTML = '';
      const filtered = modules.filter(mod => {
        // Category filtering
        const catMatch = activeCats.length === 0 || activeCats.includes(mod.category);
        // Attribute filtering (for ancestor modules).  A module must
        // include each selected attribute and satisfy any per‑attribute
        // min/max filters specified by the user.  The module's
        // attrValues map contains average numeric values for each
        // attribute, computed during initialization.
        let attrMatch = true;
        for (const attr of selectedAttrs) {
          // Ensure the module has this attribute at all
          if (!mod.attributes || !mod.attributes.includes(attr)) {
            attrMatch = false;
            break;
          }
          // Check min/max filters if provided
          const range = selectedAttrRanges[attr] || {};
          const val = mod.attrValues ? mod.attrValues[attr] : null;
          if (range.min !== null && range.min !== undefined && !isNaN(range.min)) {
            // Only apply min filter if a numeric value exists. If val is null, do not exclude.
            if (val !== null && val !== undefined) {
              if (val < range.min) {
                attrMatch = false;
                break;
              }
            }
          }
          if (range.max !== null && range.max !== undefined && !isNaN(range.max)) {
            // Only apply max filter if a numeric value exists. If val is null, do not exclude.
            if (val !== null && val !== undefined) {
              if (val > range.max) {
                attrMatch = false;
                break;
              }
            }
          }
        }
        // Socket filter
        const socketMatch = selectedSockets.length === 0 || selectedSockets.includes(mod.socketType);
        // Platform filter
        const platformMatch = selectedPlatforms.length === 0 || selectedPlatforms.includes(mod.platform);
        // Price filter
        let priceMatch = true;
        const priceNum = parseFloat((mod.price || '').replace(/[^0-9.]/g, ''));
        if (!isNaN(priceNum)) {
          if (priceMinVal !== null && priceNum < priceMinVal) priceMatch = false;
          if (priceMaxVal !== null && priceNum > priceMaxVal) priceMatch = false;
        }
        // Required MR filter (disabled in trigger mode)
        let mrMatch = true;
        if (!isTriggerMode) {
          if (mrMinVal !== null) {
            if (mod.__mrVal === null || mod.__mrVal < mrMinVal) mrMatch = false;
          }
          if (mrMaxVal !== null) {
            if (mod.__mrVal === null || mod.__mrVal > mrMaxVal) mrMatch = false;
          }
        }
        // Reroll filter (disabled in trigger mode)
        let rerollMatch = true;
        if (!isTriggerMode) {
          if (rerollMinVal !== null) {
            if (mod.__rerollVal === null || mod.__rerollVal < rerollMinVal) rerollMatch = false;
          }
          if (rerollMaxVal !== null) {
            if (mod.__rerollVal === null || mod.__rerollVal > rerollMaxVal) rerollMatch = false;
          }
        }
        // Status filter
        let statusMatch = true;
        if (selectedStatuses.length > 0) {
          // Compare case-insensitive
          const currentStatus = mod.sellerStatus ? mod.sellerStatus.toLowerCase() : '';
          statusMatch = selectedStatuses.some(s => s.toLowerCase() === currentStatus);
        }
        // Age filter (in days)
        let ageMatch = true;
        if (ageMinVal !== null) {
          if (mod.__ageDays === null || mod.__ageDays < ageMinVal) ageMatch = false;
        }
        if (ageMaxVal !== null) {
          if (mod.__ageDays === null || mod.__ageDays > ageMaxVal) ageMatch = false;
        }
        // Age filter (in hours)
        let ageHoursMatch = true;
        if (ageHoursMinVal !== null) {
          if (mod.__ageHours === null || mod.__ageHours < ageHoursMinVal) ageHoursMatch = false;
        }
        if (ageHoursMaxVal !== null) {
          if (mod.__ageHours === null || mod.__ageHours > ageHoursMaxVal) ageHoursMatch = false;
        }
        // Seller name filter (case-insensitive contains)
        let sellerMatch = true;
        if (sellerFilterVal) {
          const nm = (mod.sellerName || '').toLowerCase();
          if (!nm.includes(sellerFilterVal)) sellerMatch = false;
        }
        // Trigger attribute min/max filtering when in trigger mode
        let triggerMatch = true;
        if (isTriggerMode && triggerAttrMap) {
          for (const attr in triggerFilterValues) {
            const filters = triggerFilterValues[attr] || {};
            const value = mod.triggerValues ? mod.triggerValues[attr] : null;
            if (filters.min !== null && filters.min !== undefined) {
              if (value === null || value === undefined || value < filters.min) {
                triggerMatch = false;
                break;
              }
            }
            if (filters.max !== null && filters.max !== undefined) {
              if (value === null || value === undefined || value > filters.max) {
                triggerMatch = false;
                break;
              }
            }
          }

    // ---------------- Module Name Filter (Ancestor mode only) ----------------
    // Render module name suggestion dropdown. Shows all module names when query is empty.
    function renderModuleSuggestions() {
      if (!moduleNameSearch || !moduleNameSuggestions) return;
      const query = moduleNameSearch.value.trim().toLowerCase();
      moduleNameSuggestions.innerHTML = '';
      // Filter module names by query and by not already selected
      const matches = moduleNames.filter(name => name.toLowerCase().includes(query) && !selectedModuleNames.includes(name));
      if (matches.length > 0) {
        moduleNameSuggestions.classList.remove('hidden');
      } else {
        moduleNameSuggestions.classList.add('hidden');
      }
      matches.slice(0, 100).forEach(name => {
        const item = document.createElement('div');
        item.className = 'suggestion-item';
        item.textContent = name;
        // Use mousedown to capture selection before blur hides suggestions
        item.addEventListener('mousedown', (e) => {
          e.preventDefault();
          e.stopPropagation();
          selectedModuleNames.push(name);
          renderSelectedModuleNames();
          moduleNameSearch.value = '';
          moduleNameSuggestions.innerHTML = '';
          moduleNameSuggestions.classList.add('hidden');
          updateResults();
          // blur input to allow refocus on next click
          moduleNameSearch.blur();
        });
        moduleNameSuggestions.appendChild(item);
      });
    }

    function renderSelectedModuleNames() {
      if (!selectedModuleNamesDiv) return;
      selectedModuleNamesDiv.innerHTML = '';
      selectedModuleNames.forEach(name => {
        const chip = document.createElement('div');
        chip.className = 'chip';
        const text = document.createElement('span');
        text.textContent = name;
        const remove = document.createElement('span');
        remove.textContent = '✕';
        remove.addEventListener('click', () => {
          selectedModuleNames = selectedModuleNames.filter(n => n !== name);
          renderSelectedModuleNames();
          updateResults();
        });
        chip.appendChild(text);
        chip.appendChild(remove);
        selectedModuleNamesDiv.appendChild(chip);
      });
    }

    // Attach event listeners for module name search input
    if (moduleNameSearch) {
      moduleNameSearch.addEventListener('input', renderModuleSuggestions);
      moduleNameSearch.addEventListener('focus', () => {
        renderModuleSuggestions();
      });
      moduleNameSearch.addEventListener('blur', () => {
        setTimeout(() => {
          if (moduleNameSuggestions) moduleNameSuggestions.classList.add('hidden');
        }, 100);
      });
    }
    // We rely on the blur event of the module name input to hide its
    // suggestions, so we do not need a global click handler. Removing the
    // handler prevents the dropdown from closing prematurely when interacting
    // with other controls in the top bar.
    // Clear button for module names
    if (clearModuleNamesBtn) {
      clearModuleNamesBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        selectedModuleNames = [];
        if (moduleNameSearch) moduleNameSearch.value = '';
        if (moduleNameSuggestions) {
          moduleNameSuggestions.innerHTML = '';
          moduleNameSuggestions.classList.add('hidden');
        }
        renderSelectedModuleNames();
        updateResults();
      });
    }
        }
        // Negative attribute filter: exclude modules that have any selected negative attribute
        let negFilterMatch = true;
        if (selectedNegAttrs.length > 0) {
          for (const attr of selectedNegAttrs) {
            if (mod.negAttributes && mod.negAttributes.includes(attr)) {
              negFilterMatch = false;
              break;
            }
          }
        }
        // Module name filter: only apply in ancestor mode. If any module names are selected, include only those names.
        let moduleMatch = true;
        if (!isTriggerMode && selectedModuleNames.length > 0) {
          moduleMatch = selectedModuleNames.includes(mod.name);
        }
        return catMatch && attrMatch && socketMatch && platformMatch && priceMatch && mrMatch && rerollMatch && statusMatch && ageMatch && ageHoursMatch && triggerMatch && negFilterMatch && sellerMatch && moduleMatch;
      });
      if (filtered.length === 0) {
        const msg = document.createElement('div');
        msg.className = 'no-items';
        msg.textContent = 'No items match your filters.';
        cardsContainer.appendChild(msg);
        return;
      }

      // Apply sorting based on selected option
      if (sortSelect) {
        const sortVal = sortSelect.value;
        filtered.sort((a, b) => {
          function parsePrice(mod) {
            const num = parseFloat((mod.price || '').replace(/[^0-9.]/g, ''));
            return isNaN(num) ? 0 : num;
          }
          if (sortVal === 'priceAsc') {
            return parsePrice(a) - parsePrice(b);
          } else if (sortVal === 'priceDesc') {
            return parsePrice(b) - parsePrice(a);
          } else if (sortVal === 'nameAsc') {
            return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
          } else if (sortVal === 'nameDesc') {
            return b.name.toLowerCase().localeCompare(a.name.toLowerCase());
          }
          return 0;
        });
      }
      // Helper to create info badge displaying a label and value. Supports highlight and copy icon.
      function createInfoBadge(label, value, highlight = false, copy = false) {
        const badge = document.createElement('div');
        badge.className = 'info-badge' + (highlight ? ' highlight' : '');
        // Give the seller badge an extra class so it can flex-grow more to accommodate long names
        if (label.toLowerCase() === 'seller') {
          badge.classList.add('seller-badge');
        }
        const labelSpan = document.createElement('span');
        labelSpan.className = 'info-label';
        labelSpan.textContent = label + ':';
        const valueSpan = document.createElement('span');
        valueSpan.className = 'info-value';
        valueSpan.textContent = value;
        badge.appendChild(labelSpan);
        badge.appendChild(valueSpan);
        if (copy) {
          const copyIcon = document.createElement('span');
          copyIcon.className = 'copy-icon';
          copyIcon.textContent = '📋';
          copyIcon.title = 'Copy to clipboard';
          copyIcon.addEventListener('click', (e) => {
            e.stopPropagation();
            try {
              navigator.clipboard.writeText(value);
              copyIcon.textContent = '✔';
              setTimeout(() => { copyIcon.textContent = '📋'; }, 800);
            } catch (err) {
              console.error('Failed to copy', err);
            }
          });
          badge.appendChild(copyIcon);
        }
        return badge;
      }
      filtered.forEach(mod => {
        // Card wrapper and container
        const wrapper = document.createElement('div');
        wrapper.className = 'card-wrapper';
        const card = document.createElement('div');
        card.className = 'module-card';
        // Header top: title (name) and right info (category + price)
        const headerTop = document.createElement('div');
        headerTop.className = 'header-top';
        const title = document.createElement('h3');
        title.className = 'module-title';
        title.textContent = mod.name;
        headerTop.appendChild(title);
        const headerRight = document.createElement('div');
        headerRight.style.display = 'flex';
        headerRight.style.gap = '10px';
        // Category label
        if (mod.category) {
          const cat = document.createElement('span');
          cat.className = 'category-label';
          cat.textContent = mod.category;
          headerRight.appendChild(cat);
        }
        // Price label with Caliber suffix
        const priceLab = document.createElement('span');
        priceLab.className = 'price-label';
        if (mod.price) {
          // Remove any currency symbol (like $) and append Caliber suffix
          const priceString = mod.price.toString().trim();
          priceLab.textContent = priceString + ' Caliber';
        }
        headerRight.appendChild(priceLab);
        headerTop.appendChild(headerRight);
        card.appendChild(headerTop);
        // Info container with badges
        const infoCont = document.createElement('div');
        infoCont.className = 'info-container';
        // Socket
        if (mod.socketType) infoCont.appendChild(createInfoBadge('Socket', mod.socketType));
        // Platform
        if (mod.platform) infoCont.appendChild(createInfoBadge('Platform', mod.platform));
        // Required mastery rank (highlight)
        if (mod.requiredRank) infoCont.appendChild(createInfoBadge('Required MR', mod.requiredRank, true));
        // Reroll count: hide in trigger mode
        if (!isTriggerMode && mod.rerollCount !== undefined && mod.rerollCount !== null) {
          infoCont.appendChild(createInfoBadge('Rerolls', mod.rerollCount.toString()));
        }
        // Seller mastery rank (highlight if exists)
        if (mod.sellerRank) infoCont.appendChild(createInfoBadge('Seller MR', mod.sellerRank.toString(), true));
        // Seller name with copy icon (highlight)
        if (mod.sellerName) infoCont.appendChild(createInfoBadge('Seller', mod.sellerName, true, true));
        // Status badge with coloured dot and label
        if (mod.sellerStatus) {
          const statusBadge = document.createElement('div');
          statusBadge.className = 'info-badge';
          const statusLabel = document.createElement('span');
          statusLabel.className = 'info-label';
          statusLabel.textContent = 'Status:';
          const dot = document.createElement('span');
          dot.className = 'status-dot ' + ((mod.sellerStatus.toLowerCase() === 'online') ? 'online' : 'offline');
          const statusVal = document.createElement('span');
          statusVal.className = 'info-value';
          statusVal.textContent = mod.sellerStatus;
          statusBadge.appendChild(statusLabel);
          statusBadge.appendChild(dot);
          statusBadge.appendChild(statusVal);
          infoCont.appendChild(statusBadge);
        }
        // Registration date/time (labelled as posted)
        if (mod.regDate) infoCont.appendChild(createInfoBadge('Posted', mod.regDate));
        card.appendChild(infoCont);
        // Stats grid container for 2x2 layout
        const statsDiv = document.createElement('div');
        statsDiv.className = 'stats-grid';
        (mod.stats || []).forEach(stat => {
          const raw = (stat.raw || '').trim();
          if (!raw) return;
          const parts = raw.split(/\s+/);
          const lastToken = parts.pop();
          const label = parts.join(' ');
          const rangeText = lastToken;
          // Determine value: use stat.value if provided; otherwise fall back to range
          const valText = (stat.value !== undefined && stat.value !== null && stat.value !== '') ? stat.value : rangeText;
          const line = document.createElement('div');
          line.className = 'stat-line';
          if (stat.positive) line.classList.add('positive');
          if (stat.negative) line.classList.add('negative');
          const labelSpan = document.createElement('span');
          labelSpan.className = 'stat-label';
          // Include range in the label for ancestor modules if a value is present
          if (stat.value !== undefined && stat.value !== null && stat.value !== '') {
            labelSpan.textContent = label + ' ' + rangeText;
          } else {
            labelSpan.textContent = label;
          }
          const valueSpan = document.createElement('span');
          valueSpan.className = 'stat-value';
          if (stat.positive) valueSpan.classList.add('positive');
          if (stat.negative) valueSpan.classList.add('negative');
          valueSpan.textContent = valText;
          line.appendChild(labelSpan);
          line.appendChild(valueSpan);
          statsDiv.appendChild(line);
        });
        card.appendChild(statsDiv);
        wrapper.appendChild(card);
        cardsContainer.appendChild(wrapper);
      });
    }

    // Initial render
    renderSelected();
    updateResults();
  }

  // Expose initializeUI globally so that the parent frame or
  // other scripts can invoke it directly when running inside
  // Electron. This allows us to bypass chrome.storage and feed
  // the market data manually.
  if (typeof window !== 'undefined') {
    window.initializeUI = initializeUI;
  }
})();