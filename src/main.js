/** @file The main file. Everything in the userscript is executed from here. */

import Overlay from "./Overlay.js";
import Observers from "./observers.js";
import TemplateManager from "./templateManager.js";
import ApiManager from "./apiManager.js";
import { consoleLog, selectAllCoordinateInputs } from "./utils.js";

// Imports the CSS file from dist folder on github
const cssOverlay = GM_getResourceText("CSS-BM-File");
GM_addStyle(cssOverlay);
// Runtime fix: ensure coordinate badge #bm-h uses white background and black text
try{
  const _bm_coord_style = document.createElement('style');
  _bm_coord_style.id = 'bm-coord-fix';
  _bm_coord_style.textContent = `
    /* High-specificity rule to force white background for the coords badge */
    html body #bm-h, #bm-overlay #bm-h, #bm-A #bm-h {
      background: #FFFFFF !important;
      color: #000000 !important;
      padding: .25ch .6ch !important;
      border-radius: 6px !important;
      border: 1px solid rgba(0,0,0,0.06) !important;
      box-shadow: none !important;
    }
  `;
  (document.head || document.documentElement).appendChild(_bm_coord_style);
}catch(e){}

// Imports the Roboto Mono font family
var stylesheetLink = document.createElement('link');
stylesheetLink.href = 'https://fonts.googleapis.com/css2?family=Roboto+Mono:ital,wght@0,100..700;1,100..700&display=swap';
stylesheetLink.rel = 'preload';
stylesheetLink.as = 'style';
stylesheetLink.onload = function () {
  this.onload = null;
  this.rel = 'stylesheet';
};
document.head?.appendChild(stylesheetLink);

// Import Google Material Symbols Rounded for icons (load full family so any icon like moved_location works)
var materialSymbolsLink = document.createElement('link');
materialSymbolsLink.href = 'https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap';
materialSymbolsLink.rel = 'stylesheet';
document.head?.appendChild(materialSymbolsLink);

// Small helper style for the material icon
const _bm_mat_style = document.createElement('style');
_bm_mat_style.textContent = `
.material-symbols-rounded {
  font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24;
}
`;
document.head?.appendChild(_bm_mat_style);

// Compact view style: visually limit color list height (~3 rows) but keep inner list scrollable
const _bm_compact_style = document.createElement('style');
_bm_compact_style.textContent = `
#bm-contain-colorfilter.bm-color-compact, #bm-colorfilter-list.bm-color-compact {
  max-height: 84px !important; /* roughly 3 rows of items */
  overflow: hidden !important; /* hide overflow of the container itself */
}
#bm-colorfilter-list.bm-color-compact {
  max-height: 84px !important;
  overflow: auto !important; /* keep internal scrollbar for full content */
}
`;
document.head?.appendChild(_bm_compact_style);

// Hide some top3/minimize icon buttons by default via CSS; removed later when templates exist
// Note: do NOT hide the `.bm-1k` class (the minimize/maximize toggle) so the button remains visible.
const _bm_hide_top3_style = document.createElement('style');
_bm_hide_top3_style.id = 'bm-hide-top3';
_bm_hide_top3_style.textContent = `
.bm-top3-icon, #bm-button-colors-top3, #bm-V {
  display: none !important;
  visibility: hidden !important;
}
/* Hide empty container inside the color list to avoid an empty padded box */
#bm-9 > div:empty {
  display: none !important;
  visibility: hidden !important;
}
`;
document.head?.appendChild(_bm_hide_top3_style);

// Force the bm-W button to always be visible and sized like other header action buttons.
// This ensures the arrow_drop_down is present even when no templates exist.
const _bm_force_w_style = document.createElement('style');
_bm_force_w_style.id = 'bm-force-w';
_bm_force_w_style.textContent = `
/* Always show the top3/minimize icon (bm-W) and make it consistent with other header buttons */
#bm-W, #bm-k #bm-W, .bm-1q #bm-W {
  display: flex !important;
  visibility: visible !important;
  align-items: center !important;
  justify-content: center !important;
  width: 36px !important;
  height: 36px !important;
  min-width: 36px !important;
  padding: 4px !important;
  box-sizing: border-box !important;
}
`;
document.head?.appendChild(_bm_force_w_style);

// Script metadata (fallbacks for bundling/runtime where metadata file isn't executed)
const name = 'Black Marble';
const version = '0.85.2';

/** Injects code into the client (page) so it runs outside the userscript sandbox.
 * This is required to spy on page fetch() calls and forward JSON/image payloads
 * back to the userscript via window.postMessage.
 */
function inject(callback) {
  const script = document.createElement('script');
  script.setAttribute('bm-name', name);
  script.setAttribute('bm-cStyle', 'color: cornflowerblue;');
  script.textContent = `(${callback})();`;
  document.documentElement?.appendChild(script);
  script.remove();
}

// Inject the page-context fetch spy. Keeps logging minimal and forwards messages
// with source: 'blue-marble' so the userscript can react to pixel/tile messages.
inject(() => {
  const script = document.currentScript;
  const name = script?.getAttribute('bm-name') || 'Blue Marble';
  const consoleStyle = script?.getAttribute('bm-cStyle') || '';
  const fetchedBlobQueue = new Map();

  // Signal that the page-spy was installed (visible in page console)
  try { console.log(`%c${name}%c: page fetch spy installed`, consoleStyle, ''); } catch (e) {}

  window.addEventListener('message', (event) => {
    const { source, endpoint, blobID, blobData, blink } = event.data;
    // Only handle messages from our script that carry blobID/blobData (image replies)
    if ((source == 'blue-marble') && !!blobID && !!blobData && !endpoint) {
      const callback = fetchedBlobQueue.get(blobID);
      if (typeof callback === 'function') {
        callback(blobData);
      } else {
        console.warn(`%c${name}%c: Attempted to retrieve a blob (%s) from queue, but the blobID was not a function! Skipping...`, consoleStyle, '', blobID);
      }
      fetchedBlobQueue.delete(blobID);
    }
  });

  const originalFetch = window.fetch;
  window.fetch = async function(...args) {
    const response = await originalFetch.apply(this, args);
    const cloned = response.clone();
    const endpointName = ((args[0] instanceof Request) ? args[0]?.url : args[0]) || 'ignore';
    const contentType = cloned.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
      // forward JSON responses
      try { console.log(`%c${name}%c: Sending JSON message about endpoint "${endpointName}"`, consoleStyle, ''); } catch (e) {}
      cloned.json().then(jsonData => {
        window.postMessage({ source: 'blue-marble', endpoint: endpointName, jsonData }, '*');
      }).catch(() => {});
    } else if (contentType.includes('image/') && (!endpointName.includes('openfreemap') && !endpointName.includes('maps'))) {
      const blink = Date.now();
      const blob = await cloned.blob();
      try { console.log(`%c${name}%c: Sending IMAGE message about endpoint "${endpointName}"`, consoleStyle, ''); } catch (e) {}
      return new Promise((resolve) => {
        const blobUUID = crypto.randomUUID();
        fetchedBlobQueue.set(blobUUID, (blobProcessed) => {
          resolve(new Response(blobProcessed, { headers: cloned.headers, status: cloned.status, statusText: cloned.statusText }));
        });
        window.postMessage({ source: 'blue-marble', endpoint: endpointName, blobID: blobUUID, blobData: blob, blink }, '*');
      }).catch(() => response);
    }

    return response;
  };
});

// CONSTRUCTORS
// Instantiate Observers only if it's available to avoid ReferenceError during bundling/order issues
let observers = null;
if (typeof Observers !== 'undefined') {
  observers = new Observers(); // Constructs a new Observers object
}
const overlayMain = new Overlay(name, version); // Constructs a new Overlay object for the main overlay
const overlayTabTemplate = new Overlay(name, version); // Constructs a Overlay object for the template tab
const templateManager = new TemplateManager(name, version, overlayMain); // Constructs a new TemplateManager object
const apiManager = new ApiManager(templateManager); // Constructs a new ApiManager object

overlayMain.setApiManager(apiManager); // Sets the API manager

const storageTemplates = JSON.parse(GM_getValue('bmTemplates', '{}')) || {};
console.log(storageTemplates);
// Defer heavy template parsing so page load isn't blocked. Use requestIdleCallback when available.
try {
  if (storageTemplates && Object.keys(storageTemplates).length) {
    const doImport = () => { try { templateManager.importJSON(storageTemplates); } catch(e){ console.warn('Deferred template import failed', e); } };
    if (typeof requestIdleCallback !== 'undefined') {
      try { requestIdleCallback(doImport, { timeout: 2000 }); } catch(_) { setTimeout(doImport, 0); }
    } else {
      setTimeout(doImport, 0);
    }
  }
} catch (e) { /* ignore */ }

// Ensure template list/indicator initializes even if templates are imported asynchronously
// Some imports (very large template sets) happen async and may post messages before
// the rebuild listener is attached. Poll briefly and force a rebuild once templates exist.
(function ensureTemplateIndicatorInit() {
  try {
    let attempts = 0;
    const maxAttempts = 60; // ~6s of polling
    const interval = 100; // ms
    const id = setInterval(() => {
      attempts++;
      try {
        const cnt = (templateManager.templatesArray || []).length || 0;
        if (cnt > 0 || attempts >= maxAttempts) {
          try { if (typeof window.buildTemplatePresetList === 'function') window.buildTemplatePresetList(); } catch(_){}
          try { window.postMessage({ source: 'blue-marble', bmEvent: 'bm-rebuild-template-list' }, '*'); } catch(_){}
          clearInterval(id);
        }
      } catch(_) {
        if (attempts >= maxAttempts) clearInterval(id);
      }
    }, interval);
  } catch(_) { /* noop */ }
})();

const userSettings = JSON.parse(GM_getValue('bmUserSettings', '{}')); // Loads the user settings
console.log(userSettings);
console.log(Object.keys(userSettings).length);
if (Object.keys(userSettings).length == 0) {
  const uuid = crypto.randomUUID(); // Generates a random UUID
  console.log(uuid);
  GM.setValue('bmUserSettings', JSON.stringify({
    'uuid': uuid,
    'telemetry': 0
  }));
}
setInterval(() => apiManager.sendHeartbeat(version), 1000 * 60 * 30); // Sends a heartbeat every 30 minutes

console.log(`Telemetry is ${!(userSettings?.telemetry == undefined)}`);
if ((userSettings?.telemetry == undefined) || (userSettings?.telemetry > 1)) { // Increment 1 to retrigger telemetry notice
  const telemetryOverlay = new Overlay(name, version);
  telemetryOverlay.setApiManager(apiManager); // Sets the API manager for the telemetry overlay
  buildTelemetryOverlay(telemetryOverlay); // Notifies the user about telemetry
}

buildOverlayMain(); // Builds the main overlay

// Ensure template list and indicator are initialized shortly after overlay build
try {
  setTimeout(() => {
    try {
      // Prefer direct call if available, otherwise postMessage to trigger rebuild
      if (typeof window.buildTemplatePresetList === 'function') {
        try { window.buildTemplatePresetList(); } catch(_) {}
      }
      try { window.postMessage({ source: 'blue-marble', bmEvent: 'bm-rebuild-template-list' }, '*'); } catch(_) {}
    } catch(_) {}
  }, 60);
} catch(_) {}

// Global helper to update both the new and legacy template indicators
function updateTemplateIndicators() {
  try {
    const total = (templateManager.templatesArray || []).length || Object.keys(templateManager.templatesJSON?.templates || {}).length || 0;
    const active = (templateManager.templatesArray || []).filter(t => t && t.enabled !== false).length || Object.values(templateManager.templatesJSON?.templates || {}).filter(t => t && t.enabled !== false).length || 0;
    const txt = `Plantillas: ${total} (${active} activas)`;
    try { const el = document.querySelector('#bm-templates-indicator'); if (el) el.textContent = txt; } catch(_){}
    try { const el2 = document.querySelector('#bm-V'); if (el2) el2.textContent = txt; } catch(_){}
  } catch(_){}
}

// Listen for rebuild requests from template manager and update indicators immediately
window.addEventListener('message', (ev) => {
  try {
    if (ev?.data?.bmEvent === 'bm-rebuild-template-list') {
      try { updateTemplateIndicators(); } catch(_){}
    }
  } catch(_){}
});

// Cleanup: aggressively remove legacy empty container `#bm-9` and any quick reinserts.
try {
  const removeIfEmpty = (el) => { try { if (el && el.childElementCount === 0) el.remove(); } catch(_) {} };
  const legacy = document.getElementById('bm-9');
  removeIfEmpty(legacy);
  // Watch briefly for any reinserts (some builder runs re-create nodes asynchronously)
  const obs = new MutationObserver((mutations, observer) => {
    try {
      const found = document.getElementById('bm-9');
      if (found) removeIfEmpty(found);
    } catch(_) {}
  });
  obs.observe(document.body, { childList: true, subtree: true });
  setTimeout(() => { try { obs.disconnect(); } catch(_) {} }, 2000);
} catch (_) {}

overlayMain.handleDrag('#bm-overlay', '#bm-bar-drag'); // Creates dragging capability on the drag bar for dragging the overlay
// Runtime: ensure header action buttons have consistent sizing by copying from the convert button
setTimeout(() => {
  try {
    const source = document.querySelector('#bm-button-convert') || document.querySelector('#bm-m') || document.querySelector('.bm-help[title="Template Color Converter"]');
    if (!source) return;
    const cs = getComputedStyle(source);
    // Only accept absolute pixel sizes for width/minWidth to avoid copying percentages/auto from layout
    const normalizePx = (s, fallback) => {
      try {
        if (!s || typeof s !== 'string') return fallback;
        s = s.trim();
        if (/^\d+px$/.test(s)) return s;
        // sometimes getComputedStyle returns values like '0px' or 'auto' or '100%'; accept only px
        const m = s.match(/(\d+(?:\.\d+)?)px/);
        if (m) return `${m[1]}px`;
      } catch (_) {}
      return fallback;
    };
    const sizeProps = {
      width: normalizePx(cs.width, ''),
      height: normalizePx(cs.height, '40px'),
      padding: cs.padding || '6px',
      minWidth: normalizePx(cs.minWidth || cs.width, '40px'),
      boxSizing: cs.boxSizing || 'border-box'
    };
    ['#bm-q', '#bm-Y', '#bm-button-coords', '#bm-button-colors-lock'].forEach(sel => {
      document.querySelectorAll(sel).forEach(el => {
        try {
          if (sizeProps.width) el.style.width = sizeProps.width;
          el.style.height = sizeProps.height;
          el.style.padding = sizeProps.padding;
          if (sizeProps.minWidth) el.style.minWidth = sizeProps.minWidth;
          el.style.boxSizing = sizeProps.boxSizing;
          el.style.display = el.style.display || 'flex';
        } catch(_) { }
      });
    });

    const selectors = ['#bm-q', '#bm-Y', '#bm-button-coords', '#bm-button-colors-lock', '.bm-1q', '#bm-W', '#bm-1S', '#bm-1T', '#bm-1U'];
    selectors.forEach(sel => {
      document.querySelectorAll(sel).forEach(el => {
        try {
          // Temporary debug flag: add a data attribute so we can see enforcement in DOM/console
          try { el.setAttribute('data-bm-enforced', '1'); } catch(_) {}

          el.style.setProperty('display', 'flex', 'important');
          el.style.setProperty('visibility', 'visible', 'important');
          if (sizeProps.width) el.style.setProperty('width', sizeProps.width, 'important');
          el.style.setProperty('height', sizeProps.height, 'important');
          el.style.setProperty('min-width', sizeProps.minWidth, 'important');
          el.style.setProperty('padding', sizeProps.padding, 'important');
          el.style.setProperty('box-sizing', sizeProps.boxSizing, 'important');
          // apply additional visual properties to match appearance
          try { if (sizeProps.fontSize) el.style.setProperty('font-size', sizeProps.fontSize, 'important'); } catch(_) {}
          try { if (sizeProps.lineHeight) el.style.setProperty('line-height', sizeProps.lineHeight, 'important'); } catch(_) {}
          try { if (sizeProps.border) el.style.setProperty('border', sizeProps.border, 'important'); } catch(_) {}
          try { if (sizeProps.borderRadius) el.style.setProperty('border-radius', sizeProps.borderRadius, 'important'); } catch(_) {}
          el.style.setProperty('align-items', 'center', 'important');
          el.style.setProperty('justify-content', 'center', 'important');
        } catch (e) { /* ignore element-level failures */ }
      });
    });
    // Ensure #bm-W exactly matches the coords button (#bm-q) sizing
    try {
      const sourceQ = document.querySelector('#bm-q') || document.querySelector('#bm-button-coords');
      let w = '36px', h = '36px', p = '4px', m = '36px', fs = '20px', lh = '1';
      if (sourceQ) {
        try {
          const csq = getComputedStyle(sourceQ);
          const pickPx = s => (s && /\d+px/.test(s)) ? s.match(/(\d+(?:\.\d+)?)px/)[0] : null;
          w = pickPx(csq.width) || pickPx(csq.minWidth) || w;
          h = pickPx(csq.height) || h;
          p = csq.padding || p;
          m = pickPx(csq.minWidth) || m;
          fs = csq.fontSize || fs;
          lh = csq.lineHeight || lh;
        } catch(_){}
      }
      document.querySelectorAll('#bm-W, #bm-button-colors-top3').forEach(el => {
        try {
          el.style.setProperty('width', w, 'important');
          el.style.setProperty('height', h, 'important');
          el.style.setProperty('min-width', m, 'important');
          el.style.setProperty('padding', p, 'important');
          el.style.setProperty('box-sizing', 'border-box', 'important');
          el.style.setProperty('font-size', fs, 'important');
          el.style.setProperty('line-height', lh, 'important');
          el.style.setProperty('display', 'inline-flex', 'important');
          el.style.setProperty('align-items', 'center', 'important');
          el.style.setProperty('justify-content', 'center', 'important');
        } catch(_){}
      });
    } catch(_){}
  } catch (e) { /* ignore */ }
}, 50);

    // Ensure we have an idempotent function to enforce header button sizing and placement
    // Reentrancy guard to prevent MutationObserver <-> style writes causing infinite loops
    let _bmSizerApplying = false;

    function enforceHeaderButtonSizingPersistent() {
      if (_bmSizerApplying) return;
      _bmSizerApplying = true;
      try {
        const source = document.querySelector('#bm-button-convert') || document.querySelector('#bm-m') || document.querySelector('.bm-help[title="Template Color Converter"]') || document.querySelector('#bm-m');
        const cs = source ? getComputedStyle(source) : null;
        const pickPx = s => (s && /\d+px/.test(s)) ? s.match(/(\d+(?:\.\d+)?)px/)[0] : null;
        const sizeProps = {
          width: pickPx(cs?.width) || '',
          height: pickPx(cs?.height) || '40px',
          padding: cs?.padding || '6px',
          minWidth: pickPx(cs?.minWidth || cs?.width) || '40px',
          boxSizing: cs?.boxSizing || 'border-box',
          fontSize: cs?.fontSize || '',
          lineHeight: cs?.lineHeight || '',
          border: cs?.border || '',
          borderRadius: cs?.borderRadius || '',
          transition: cs?.transition || '',
          willChange: cs?.willChange || '',
          transformOrigin: cs?.transformOrigin || ''
        };

  const selectors = ['#bm-q', '#bm-Y', '#bm-button-coords', '#bm-button-colors-lock', '.bm-1q', '#bm-W', '#bm-1S', '#bm-1T', '#bm-1U'];
        selectors.forEach(sel => {
          document.querySelectorAll(sel).forEach(el => {
            try {
              el.style.setProperty('display', 'flex', 'important');
              el.style.setProperty('visibility', 'visible', 'important');
              if (sizeProps.width) el.style.setProperty('width', sizeProps.width, 'important');
              el.style.setProperty('height', sizeProps.height, 'important');
              el.style.setProperty('min-width', sizeProps.minWidth, 'important');
              el.style.setProperty('padding', sizeProps.padding, 'important');
              el.style.setProperty('box-sizing', sizeProps.boxSizing, 'important');
                try { if (sizeProps.transition) el.style.setProperty('transition', sizeProps.transition, 'important'); } catch(_) {}
                try { if (sizeProps.willChange) el.style.setProperty('will-change', sizeProps.willChange, 'important'); } catch(_) {}
                try { if (sizeProps.transformOrigin) el.style.setProperty('transform-origin', sizeProps.transformOrigin, 'important'); } catch(_) {}
              try { if (sizeProps.fontSize) el.style.setProperty('font-size', sizeProps.fontSize, 'important'); } catch(_) {}
              try { if (sizeProps.lineHeight) el.style.setProperty('line-height', sizeProps.lineHeight, 'important'); } catch(_) {}
              try { if (sizeProps.border) el.style.setProperty('border', sizeProps.border, 'important'); } catch(_) {}
              try { if (sizeProps.borderRadius) el.style.setProperty('border-radius', sizeProps.borderRadius, 'important'); } catch(_) {}
              el.style.setProperty('align-items', 'center', 'important');
              el.style.setProperty('justify-content', 'center', 'important');
              // Remove any translateX or transform nudges which cause visual differences
              try { el.style.setProperty('transform', 'none', 'important'); } catch(_) {}
              try { el.style.setProperty('vertical-align', 'middle', 'important'); } catch(_) {}
              // Ensure font-size/line-height parity if sizeProps provide them
              try { if (sizeProps.fontSize) el.style.setProperty('font-size', sizeProps.fontSize, 'important'); } catch(_) {}
              try { if (sizeProps.lineHeight) el.style.setProperty('line-height', sizeProps.lineHeight, 'important'); } catch(_) {}
            } catch (e) { /* ignore element-level failures */ }
          });
        });

        // Ensure the minimize/top3 button is inside the header container (#bm-k)
        const container = document.querySelector('#bm-k');
        const bLeft = document.querySelector('#bm-W') || document.querySelector('#bm-1S') || document.querySelector('.bm-1q') || document.querySelector('#bm-button-colors-top3');
        const bMid  = document.querySelector('#bm-q')  || document.querySelector('#bm-1W') || document.querySelector('#bm-button-coords');
        const bRight = document.querySelector('#bm-X') || document.querySelector('#bm-1X') || document.querySelector('#bm-button-colors-lock');
        if (container && bLeft && bMid) {
          try { if (bLeft.parentElement !== container) container.insertBefore(bLeft, bMid); } catch (_) { try { if (bLeft.parentElement !== container) container.appendChild(bLeft); } catch(_){} }
        }
        if (container && bRight && bMid) {
          try { if (bRight.parentElement !== container) container.insertBefore(bRight, bMid.nextSibling); } catch(_) { try { if (bRight.parentElement !== container) container.appendChild(bRight); } catch(_){} }
        }
        // If we have the coords button, copy its computed styles exactly to the left and right buttons
        try {
          if (bMid) {
            const csMid = getComputedStyle(bMid);
            const pickPx = s => (s && /\d+px/.test(s)) ? s.match(/(\d+(?:\.\d+)?)px/)[0] : null;
            const exact = {
              width: pickPx(csMid.width) || pickPx(csMid.minWidth) || sizeProps.width || '',
              height: pickPx(csMid.height) || sizeProps.height || '',
              minWidth: pickPx(csMid.minWidth) || sizeProps.minWidth || '',
              padding: csMid.padding || sizeProps.padding || '',
              boxSizing: csMid.boxSizing || sizeProps.boxSizing || 'border-box',
              fontSize: csMid.fontSize || sizeProps.fontSize || '',
              lineHeight: csMid.lineHeight || sizeProps.lineHeight || '',
              transition: csMid.transition || sizeProps.transition || '',
              transform: csMid.transform || '',
              transformOrigin: csMid.transformOrigin || sizeProps.transformOrigin || '',
              verticalAlign: csMid.verticalAlign || 'middle',
              display: csMid.display || 'inline-flex',
              border: csMid.border || sizeProps.border || '',
              borderRadius: csMid.borderRadius || sizeProps.borderRadius || ''
            };
            const targets = [bLeft, bRight];
            targets.forEach(el => {
              if (!el) return;
              try {
                if (exact.width) el.style.setProperty('width', exact.width, 'important');
                if (exact.height) el.style.setProperty('height', exact.height, 'important');
                if (exact.minWidth) el.style.setProperty('min-width', exact.minWidth, 'important');
                if (exact.padding) el.style.setProperty('padding', exact.padding, 'important');
                el.style.setProperty('box-sizing', exact.boxSizing, 'important');
                if (exact.fontSize) el.style.setProperty('font-size', exact.fontSize, 'important');
                if (exact.lineHeight) el.style.setProperty('line-height', exact.lineHeight, 'important');
                if (exact.transition) el.style.setProperty('transition', exact.transition, 'important');
                if (exact.transform) el.style.setProperty('transform', exact.transform, 'important');
                if (exact.transformOrigin) el.style.setProperty('transform-origin', exact.transformOrigin, 'important');
                if (exact.verticalAlign) el.style.setProperty('vertical-align', exact.verticalAlign, 'important');
                if (exact.display) el.style.setProperty('display', exact.display, 'important');
                if (exact.border) el.style.setProperty('border', exact.border, 'important');
                if (exact.borderRadius) el.style.setProperty('border-radius', exact.borderRadius, 'important');
                el.style.setProperty('align-items', 'center', 'important');
                el.style.setProperty('justify-content', 'center', 'important');
                el.style.setProperty('margin', '0px', 'important');
              } catch(_){}
            });
            // Ensure coords button itself keeps these properties too (in case of overrides)
            try {
              if (exact.width) bMid.style.setProperty('width', exact.width, 'important');
              if (exact.height) bMid.style.setProperty('height', exact.height, 'important');
              if (exact.transition) bMid.style.setProperty('transition', exact.transition, 'important');
              if (exact.transform) bMid.style.setProperty('transform', exact.transform, 'important');
            } catch(_){}
          }
        } catch(_){}
        if (container && container.style && container.style.setProperty) container.style.setProperty('gap', '2px', 'important');
      } catch (e) { /* ignore */ }

      // Clear the reentrancy guard at the end of this microtask so the MutationObserver
      // can run again later but won't re-enter while we're actively applying styles.
      try { setTimeout(() => { _bmSizerApplying = false; }, 0); } catch (_) { _bmSizerApplying = false; }
    }

    // Run immediately, observe DOM changes and run a short interval to catch late overrides.
    try {
      enforceHeaderButtonSizingPersistent();
      const bmSizerObserver = new MutationObserver(() => { if (!_bmSizerApplying) enforceHeaderButtonSizingPersistent(); });
      bmSizerObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
      // Run frequent re-applies for the first 10 seconds, then leave the observer active.
  // Reduce frequency to lower CPU use; 500ms was too aggressive on some pages
  const bmSizerInterval = setInterval(() => { if (!_bmSizerApplying) enforceHeaderButtonSizingPersistent(); }, 2000);
      setTimeout(() => { try { clearInterval(bmSizerInterval); } catch (e) {} }, 10000);
    } catch (e) { /* ignore */ }

apiManager.spontaneousResponseListener(overlayMain); // Reads spontaneous fetch responces

observeBlack(); // Observes the black palette color

consoleLog(`%c${name}%c (${version}) userscript has loaded!`, 'color: cornflowerblue;', '');

/** Observe the black color, and add the "Move" button.
 * @since 0.66.3
 */
function observeBlack() {
  const observer = new MutationObserver((mutations, observer) => {

    const black = document.querySelector('#color-1'); // Attempt to retrieve the black color element for anchoring

    if (!black) {return;} // Black color does not exist yet. Kills iteself

    let move = document.querySelector('#bm-button-move'); // Tries to find the move button

    // If the move button does not exist, we make a new one
    if (!move) {
      move = document.createElement('button');
      move.id = 'bm-button-move';
  move.textContent = 'Mover ↑';
      move.className = 'btn btn-soft';
      move.onclick = function() {
        const roundedBox = this.parentNode.parentNode.parentNode.parentNode; // Obtains the rounded box
        const shouldMoveUp = (this.textContent == 'Move ↑');
        roundedBox.parentNode.className = roundedBox.parentNode.className.replace(shouldMoveUp ? 'bottom' : 'top', shouldMoveUp ? 'top' : 'bottom'); // Moves the rounded box to the top
        roundedBox.style.borderTopLeftRadius = shouldMoveUp ? '0px' : 'var(--radius-box)';
        roundedBox.style.borderTopRightRadius = shouldMoveUp ? '0px' : 'var(--radius-box)';
        roundedBox.style.borderBottomLeftRadius = shouldMoveUp ? 'var(--radius-box)' : '0px';
        roundedBox.style.borderBottomRightRadius = shouldMoveUp ? 'var(--radius-box)' : '0px';
        this.textContent = shouldMoveUp ? 'Move ↓' : 'Move ↑';
      }

      // Attempts to find the "Paint Pixel" element for anchoring
      const paintPixel = black.parentNode.parentNode.parentNode.parentNode.querySelector('h2');

      paintPixel.parentNode?.appendChild(move); // Adds the move button
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

/** Deploys the overlay to the page with minimize/maximize functionality.
 * Creates a responsive overlay UI that can toggle between full-featured and minimized states.
 * 
 * Parent/child relationships in the DOM structure below are indicated by indentation.
 * @since 0.58.3
 */
function buildOverlayMain() {
  let isMinimized = false; // Overlay state tracker (false = maximized, true = minimized)
  // Load last saved coordinates (if any)
  // Load and normalize last saved coordinates (support legacy/minified keys)
  let savedCoords = {};
  const loadSavedCoords = () => {
    try {
      const raw = JSON.parse(GM_getValue('bmCoords', '{}')) || {};
      const pick = (s) => {
        if (!s) return { tx: undefined, ty: undefined, px: undefined, py: undefined };
        return {
          tx: s.tx ?? s.Ut ?? s.ut ?? undefined,
          ty: s.ty ?? s.Ht ?? s.ht ?? undefined,
          px: s.px ?? s.px ?? undefined,
          py: s.py ?? s.Kt ?? s.kt ?? undefined
        };
      };
      return pick(raw);
    } catch (_) { return {}; }
  };
  savedCoords = loadSavedCoords();
  const persistCoords = () => {
    try {
      // Prefer canonical inputs if present, otherwise fallback to minified inputs
      const getVal = (idA, idB) => document.querySelector(idA)?.value ?? document.querySelector(idB)?.value ?? '';
      const tx = Number(getVal('#bm-input-tx', '#bm-v') || '');
      const ty = Number(getVal('#bm-input-ty', '#bm-w') || '');
      const px = Number(getVal('#bm-input-px', '#bm-x') || '');
      const py = Number(getVal('#bm-input-py', '#bm-y') || '');
      // Persist both the current canonical keys and legacy/minified variants so older builds
      // or minified consumers can still read the saved coords.
      const data = {
        // canonical
        tx, ty, px, py,
        // legacy/minified keys observed in older builds / dist (keep unique keys)
        Ut: tx, Ht: ty, Kt: py,
        // lowercase variants (just in case)
        ut: tx, ht: ty, kt: py
      };
      GM.setValue('bmCoords', JSON.stringify(data));
    } catch (_) {}
  };
  
  overlayMain.addDiv({'id': 'bm-overlay', 'style': 'top: 10px; right: 75px;'})
    .addDiv({'id': 'bm-contain-header'})
      .addDiv({'id': 'bm-bar-drag'}).buildElement()
  .addImg({'alt': 'Black Marble Icon - Click to minimize/maximize', 'src': 'https://i.imgur.com/qP3QpF9.png', 'style': 'cursor: pointer;'}, 
        (instance, img) => {
          /** Click event handler for overlay minimize/maximize functionality.
           * 
           * Toggles between two distinct UI states:
           * 1. MINIMIZED STATE (60×76px):
           *    - Shows only the Black Marble icon and drag bar
           *    - Hides all input fields, buttons, and status information
           *    - Applies fixed dimensions for consistent appearance
           *    - Repositions icon with 3px right offset for visual centering
           * 
           * 2. MAXIMIZED STATE (responsive):
           *    - Restores full functionality with all UI elements
           *    - Removes fixed dimensions to allow responsive behavior
           *    - Resets icon positioning to default alignment
           *    - Shows success message when returning to maximized state
           * 
           * @param {Event} event - The click event object (implicit)
           */
          img.addEventListener('click', () => {
            isMinimized = !isMinimized; // Toggle the current state

            const overlay = document.querySelector('#bm-overlay');
            const header = document.querySelector('#bm-contain-header');
            const dragBar = document.querySelector('#bm-bar-drag');
            const coordsContainer = document.querySelector('#bm-contain-coords');
            const coordsButton = document.querySelector('#bm-button-coords');
            const createButton = document.querySelector('#bm-button-create');
            const enableButton = document.querySelector('#bm-button-enable');
            const disableButton = document.querySelector('#bm-button-disable');
            const coordInputs = document.querySelectorAll('#bm-contain-coords input');
            
            // Save original dimensions before minimizing, and restore them when maximizing
            try {
              if (overlay) {
                const cs = getComputedStyle(overlay);
                if (isMinimized) {
                  // About to minimize: persist current dimensions (inline or computed) on data-* attrs
                  overlay.dataset.bmOrigWidth = overlay.style.width || cs.width || '';
                  overlay.dataset.bmOrigMaxWidth = overlay.style.maxWidth || cs.maxWidth || '';
                  overlay.dataset.bmOrigMinWidth = overlay.style.minWidth || cs.minWidth || '';
                  overlay.dataset.bmOrigPadding = overlay.style.padding || cs.padding || '';
                  overlay.dataset.bmOrigHeight = overlay.style.height || cs.height || '';
                } else {
                  // About to maximize: restore previously saved values if available
                  if (typeof overlay.dataset.bmOrigWidth !== 'undefined') overlay.style.width = overlay.dataset.bmOrigWidth || '';
                  else overlay.style.width = '';
                  if (typeof overlay.dataset.bmOrigMaxWidth !== 'undefined') overlay.style.maxWidth = overlay.dataset.bmOrigMaxWidth || '';
                  else overlay.style.maxWidth = '';
                  if (typeof overlay.dataset.bmOrigMinWidth !== 'undefined') overlay.style.minWidth = overlay.dataset.bmOrigMinWidth || '';
                  else overlay.style.minWidth = '';
                  if (typeof overlay.dataset.bmOrigPadding !== 'undefined') overlay.style.padding = overlay.dataset.bmOrigPadding || '';
                  else overlay.style.padding = '';
                  if (typeof overlay.dataset.bmOrigHeight !== 'undefined') overlay.style.height = overlay.dataset.bmOrigHeight || '';
                  else overlay.style.height = '';
                  // clear saved values
                  try { delete overlay.dataset.bmOrigWidth; delete overlay.dataset.bmOrigMaxWidth; delete overlay.dataset.bmOrigMinWidth; delete overlay.dataset.bmOrigPadding; delete overlay.dataset.bmOrigHeight; } catch(_) {}
                }
              }
            } catch(_) {}
            
            // Define elements that should be hidden/shown during state transitions
            // Each element is documented with its purpose for maintainability
            const elementsToToggle = [
              '#bm-overlay h1',                    // Main title "Black Marble"
              '#bm-contain-userinfo',              // User information section (username, droplets, level)
              '#bm-overlay hr',                    // Visual separator lines
              '#bm-contain-automation > *:not(#bm-contain-coords)', // Automation section excluding coordinates
              '#bm-input-file-template',           // Template file upload interface
              '#bm-contain-buttons-action',        // Action buttons container
              `#${instance.outputStatusId}`,       // Status log textarea for user feedback
              '#bm-contain-colorfilter'            // Color filter UI
            ];
            
            // Apply visibility changes to all toggleable elements
            elementsToToggle.forEach(selector => {
              const elements = document.querySelectorAll(selector);
              elements.forEach(element => {
                element.style.display = isMinimized ? 'none' : '';
              });
            });
            // Handle coordinate container and button visibility based on state
            if (isMinimized) {
              // ==================== MINIMIZED STATE CONFIGURATION ====================
              // In minimized state, we hide ALL interactive elements except the icon and drag bar
              // This creates a clean, unobtrusive interface that maintains only essential functionality
              
              // Hide coordinate input container completely
              if (coordsContainer) {
                coordsContainer.style.display = 'none';
              }
              
              // Hide coordinate button (pin icon)
              if (coordsButton) {
                coordsButton.style.display = 'none';
              }
              
              // Hide create template button
              if (createButton) {
                createButton.style.display = 'none';
              }

              // Hide enable templates button
              if (enableButton) {
                enableButton.style.display = 'none';
              }

              // Hide disable templates button
              if (disableButton) {
                disableButton.style.display = 'none';
              }
              
              // Hide all coordinate input fields individually (failsafe)
              coordInputs.forEach(input => {
                input.style.display = 'none';
              });
              // Ensure the top3 button shows collapsed state (arrow down)
              try {
                const top3 = document.querySelector('#bm-W') || document.querySelector('#bm-button-colors-top3');
                const icon = top3?.querySelector('.material-symbols-rounded');
                if (top3) top3.dataset.active = '0';
                if (icon) { icon.textContent = 'arrow_drop_down'; try { icon.style.transform = 'none'; } catch(_) {} }
              } catch(_){}
              // Additionally hide template indicator, header action buttons and lock/button variants
              try {
                const toHide = [
                  '#bm-templates-indicator', '#bm-T',
                  '#bm-W', '#bm-button-colors-top3',
                  '#bm-q', '#bm-button-coords',
                  '#bm-X', '#bm-button-colors-lock'
                ];
                toHide.forEach(sel => {
                  document.querySelectorAll(sel).forEach(el => {
                    try { el.style.display = 'none'; el.style.visibility = 'hidden'; } catch(_) {}
                  });
                });
              } catch(_) {}
              // Hide color filter UI when overlay is minimized to avoid heavy DOM work
              try {
                setTimeout(() => {
                  const cf = document.querySelector('#bm-contain-colorfilter');
                  if (cf) cf.style.display = 'none';
                }, 0);
              } catch(_){}
              
              // Apply fixed dimensions for consistent minimized appearance
              // These dimensions were chosen to accommodate the icon while remaining compact
              overlay.style.width = '60px';    // Fixed width for consistency
              overlay.style.height = '76px';   // Fixed height (60px + 16px for better proportions)
              // Avoid forcing max/min width which can cause a narrower restored layout; rely on saved values
              overlay.style.padding = '8px';    // Comfortable padding around icon
              
              // Apply icon positioning for better visual centering in minimized state
              // The 3px offset compensates for visual weight distribution
              img.style.marginLeft = '3px';
              
              // Configure header layout for minimized state
              header.style.textAlign = 'center';
              header.style.margin = '0';
              header.style.marginBottom = '0';
              
              // Ensure drag bar remains visible and properly spaced
              if (dragBar) {
                dragBar.style.display = '';
                dragBar.style.marginBottom = '0.25em';
              }

              // Hide everything inside the overlay except the icon and the drag bar
              try {
                const ov = overlay;
                if (ov) {
                  // Build set of elements to preserve: img and dragBar and their ancestors up to overlay
                  const preserve = new Set();
                  let node = img;
                  while (node && node !== ov) { preserve.add(node); node = node.parentElement; }
                  node = dragBar;
                  while (node && node !== ov) { preserve.add(node); node = node.parentElement; }
                  preserve.add(ov);

                  ov.querySelectorAll('*').forEach(el => {
                    try {
                      if (!preserve.has(el)) { el.style.display = 'none'; el.style.visibility = 'hidden'; }
                    } catch(_) {}
                  });
                }
              } catch(_) {}
            } else {
              // ==================== MAXIMIZED STATE RESTORATION ====================
              // In maximized state, we restore all elements to their default functionality
              // This involves clearing all style overrides applied during minimization
              
              // Restore coordinate container to default state
              if (coordsContainer) {
                coordsContainer.style.display = '';           // Show container
                coordsContainer.style.flexDirection = '';     // Reset flex layout
                coordsContainer.style.justifyContent = '';    // Reset alignment
                coordsContainer.style.alignItems = '';        // Reset alignment
                coordsContainer.style.gap = '';               // Reset spacing
                coordsContainer.style.textAlign = '';         // Reset text alignment
                coordsContainer.style.margin = '';            // Reset margins
              }
              
              // Restore coordinate button visibility
              if (coordsButton) {
                coordsButton.style.display = '';
              }
              
              // Restore create button visibility and reset positioning
              if (createButton) {
                createButton.style.display = '';
                createButton.style.marginTop = '';
              }

              // Restore enable button visibility and reset positioning
              if (enableButton) {
                enableButton.style.display = '';
                enableButton.style.marginTop = '';
              }

              // Restore disable button visibility and reset positioning
              if (disableButton) {
                disableButton.style.display = '';
                disableButton.style.marginTop = '';
              }
              
              // Restore all coordinate input fields
              coordInputs.forEach(input => {
                input.style.display = '';
              });
              // Ensure the top3 button shows expanded state (arrow up)
              try {
                const top3 = document.querySelector('#bm-W') || document.querySelector('#bm-button-colors-top3');
                const icon = top3?.querySelector('.material-symbols-rounded');
                if (top3) top3.dataset.active = '1';
                if (icon) { icon.textContent = 'arrow_drop_up'; try { icon.style.transform = 'none'; } catch(_) {} }
              } catch(_){}
              // Restore visibility for template indicator and header action buttons
              try {
                const toShow = [
                  '#bm-templates-indicator', '#bm-T',
                  '#bm-W', '#bm-button-colors-top3',
                  '#bm-q', '#bm-button-coords',
                  '#bm-X', '#bm-button-colors-lock'
                ];
                toShow.forEach(sel => {
                  document.querySelectorAll(sel).forEach(el => {
                    try { el.style.display = ''; el.style.visibility = ''; } catch(_) {}
                  });
                });
              } catch(_) {}
              // Show color filter UI when maximized if templates exist, schedule async to avoid blocking
              try {
                setTimeout(() => {
                  try {
                    const cf = document.querySelector('#bm-contain-colorfilter');
                    if (!cf) return;
                    if (templateManager.templatesArray?.length > 0) {
                      cf.style.display = '';
                    }
                  } catch(_){}
                }, 0);
              } catch(_){}
              
              // Reset icon positioning to default (remove minimized state offset)
              img.style.marginLeft = '';
              
              // Restore overlay to responsive dimensions
              overlay.style.padding = '10px';
              
              // Reset header styling to defaults
              header.style.textAlign = '';
              header.style.margin = '';
              header.style.marginBottom = '';
              
              // Reset drag bar spacing
              if (dragBar) {
                dragBar.style.marginBottom = '0.5em';
              }
              
              // Remove all fixed dimensions to allow responsive behavior
              // This ensures the overlay can adapt to content changes
              overlay.style.width = '';
              overlay.style.height = '';

              // Extra cleanup: some elements receive inline enforced properties elsewhere
              // Ensure header buttons, enable/disable buttons and the color list are restored
              try {
                // Reset specific header/action buttons so font-size and transforms do not remain large
                const btnSelectors = ['#bm-q', '#bm-W', '#bm-X', '#bm-button-coords', '#bm-button-colors-top3', '#bm-button-colors-lock', '#bm-3', '#bm-0'];
                btnSelectors.forEach(sel => {
                  document.querySelectorAll(sel).forEach(el => {
                    try {
                      // Remove layout/visual inline properties that may have been applied with !important
                      el.style.removeProperty('transform');
                      el.style.removeProperty('width');
                      el.style.removeProperty('height');
                      el.style.removeProperty('min-width');
                      el.style.removeProperty('padding');
                      el.style.removeProperty('font-size');
                      el.style.removeProperty('line-height');
                      el.style.removeProperty('margin');
                      el.style.removeProperty('display');
                      el.style.removeProperty('visibility');
                      // clear box-sizing if set inline
                      try { el.style.boxSizing = ''; } catch(_){}
                    } catch(_){}
                  });
                });

                // Restore color filter container/list sizing behavior
                const cf = document.querySelector('#bm-contain-colorfilter');
                if (cf) {
                  cf.style.display = '';
                  try { cf.style.removeProperty('max-width'); } catch(_){}
                  try { cf.style.removeProperty('overflow'); } catch(_){}
                  const list = document.querySelector('#bm-colorfilter-list');
                  if (list) {
                    try { list.style.removeProperty('max-height'); } catch(_){}
                    try { list.style.removeProperty('overflow'); } catch(_){}
                    try { list.style.width = ''; } catch(_){}
                  }
                }

                // Ensure the header gap is the normal value
                const container = document.querySelector('#bm-k');
                if (container && container.style && container.style.setProperty) container.style.setProperty('gap', '2px', 'important');

                // Re-run the header sizing enforcer shortly after restore so it can compute from
                // the current layout (this will not re-enter due to the reentrancy guard)
                setTimeout(() => { try { enforceHeaderButtonSizingPersistent(); } catch(_){} }, 20);
              } catch(_){}
              // Restore visibility for all overlay descendants (clear inline display/visibility)
              try {
                const ov = overlay;
                if (ov) {
                  ov.querySelectorAll('*').forEach(el => {
                    try {
                      // Clear visibility/display
                      el.style.removeProperty('display');
                      el.style.removeProperty('visibility');
                      // Remove commonly set inline layout properties that can force narrow layouts
                      ['width','height','min-width','max-width','padding','box-sizing','font-size','line-height','border','border-left','border-right','border-top','border-bottom','border-radius','margin','margin-left','margin-right','transform','align-items','justify-content','minHeight','maxHeight'].forEach(prop => {
                        try { el.style.removeProperty(prop); } catch(_) {}
                      });
                      // Remove enforcement marker so size enforcer can recompute if needed
                      try { el.removeAttribute && el.removeAttribute('data-bm-enforced'); } catch(_) {}
                    } catch(_) {}
                  });
                }
              } catch(_) {}
            }
            
            // ==================== ACCESSIBILITY AND USER FEEDBACK ====================
            // Update accessibility information for screen readers and tooltips
            
            // Update alt text to reflect current state for screen readers and tooltips
            img.alt = isMinimized ? 
              'Black Marble Icon - Minimized (Click to maximize)' : 
              'Black Marble Icon - Maximized (Click to minimize)';
            
            // No status message needed - state change is visually obvious to users
          });
        }
      ).buildElement()
      .addHeader(1, {'textContent': name}).buildElement()
    .buildElement()

  // Template counter indicator (Plantillas: N (M activas))
  .addDiv({'id': 'bm-templates-indicator', 'style': 'margin-top: 4px; font-size: 12px; color: var(--bm-accent);', 'textContent': 'Plantillas: 0 (0 activas)'}).buildElement()
  .addInput({'type': 'hidden', 'id': 'bm-active-template', 'value': ''}).buildElement()

    .addHr().buildElement()

    .addDiv({'id': 'bm-contain-userinfo'})
  .addP({'id': 'bm-user-name', 'textContent': 'Usuario: -'}).buildElement()
  .addP({'id': 'bm-user-droplets', 'textContent': 'Gotas: -'}).buildElement()
  .addP({'id': 'bm-user-nextlevel', 'textContent': 'Siguiente nivel en -'}).buildElement()
    .buildElement()

    .addHr().buildElement()

    .addDiv({'id': 'bm-contain-automation'})
      // .addCheckbox({'id': 'bm-input-stealth', 'textContent': 'Stealth', 'checked': true}).buildElement()
      // .addButtonHelp({'title': 'Waits for the website to make requests, instead of sending requests.'}).buildElement()
      // .addBr().buildElement()
      // .addCheckbox({'id': 'bm-input-possessed', 'textContent': 'Possessed', 'checked': true}).buildElement()
      // .addButtonHelp({'title': 'Controls the website as if it were possessed.'}).buildElement()
      // .addBr().buildElement()
      .addDiv({'id': 'bm-contain-coords'})
        // Top3 icon is hidden by default until a template exists
  .addButton({'id': 'bm-button-colors-top3', 'className': 'bm-top3-icon bm-action-btn', 'style': 'margin-right: 6px; display:flex;'}, (instance, button) => {
            // top3 button placed left of coords button; icon remains constant
            button.dataset.active = '0'; 
            // Ensure consistent size even if CSS is minified or overridden
            try {
              button.style.width = '40px'; button.style.height = '40px'; button.style.padding = '6px';
              button.style.minWidth = '40px'; button.style.boxSizing = 'border-box';
              if (button.style.setProperty) {
                button.style.setProperty('width','40px','important');
                button.style.setProperty('height','40px','important');
                button.style.setProperty('padding','6px','important');
                button.style.setProperty('min-width','40px','important');
                button.style.setProperty('box-sizing','border-box','important');
                button.style.setProperty('display','flex','important');
                button.style.setProperty('visibility','visible','important');
              }
              // keep this button visible (only affect the button itself)
            } catch(_){ }
            const icon = document.createElement('span');
            icon.className = 'material-symbols-rounded';
            // NOTE: invert default meaning so icons match expected open/close semantics
            icon.textContent = 'arrow_drop_up';
            icon.style.fontSize = '20px';
            // allow rotation/animation on the icon itself
            icon.style.display = 'inline-block';
            icon.style.transition = 'transform 180ms ease, opacity 120ms ease';
            button.appendChild(icon);
            button.addEventListener('click', () => {
              const oldActive = button.dataset.active === '1';
              button.dataset.active = oldActive ? '0' : '1';
              const newActive = button.dataset.active === '1';
              const listEl = document.querySelector('#bm-colorfilter-list');
              if (listEl) {
                if (newActive) { listEl.classList.add('bm-color-compact'); } else { listEl.classList.remove('bm-color-compact'); }
              }
              // invert icon mapping: when active (compact/hidden) show arrow_drop_down, otherwise arrow_drop_up
              try { icon.textContent = newActive ? 'arrow_drop_down' : 'arrow_drop_up'; } catch(_) {}
            });
        }).buildElement()
          .addButton({'id': 'bm-button-coords', 'className': 'bm-help bm-coords-icon bm-action-btn', 'style': 'margin-top: 0; display:flex;'},
            (instance, button) => { button.innerHTML = '<span class="material-symbols-rounded">moved_location</span>'; 
              try {
                button.style.width = '40px';
                button.style.height = '40px';
                button.style.padding = '6px';
                if (button.style.setProperty) {
                  button.style.setProperty('width','40px','important');
                  button.style.setProperty('height','40px','important');
                  button.style.setProperty('padding','6px','important');
                  button.style.setProperty('min-width','40px','important');
                  button.style.setProperty('box-sizing','border-box','important');
                }
              } catch(_){ }
                        // Make coords button tolerant of different coord formats (string, typed array)
                        button.style.minWidth = '40px'; button.style.boxSizing = 'border-box'; 
                button.onclick = () => {
                  const api = instance.apiManager;

                  // Helper: normalize coords into a plain Number[]
                  const normalize = (c) => {
                    // If it's already an array-like
                    if (Array.isArray(c) || (typeof c === 'object' && typeof c.length === 'number')) {
                      try { return Array.from(c).map(Number).filter(n => !Number.isNaN(n)); } catch (_) { /* fallthrough */ }
                    }
                    // If it's a string like "x,y,z,w" or "x y z w"
                    if (typeof c === 'string') {
                      const parts = c.split(/[ ,]+/).map(s => s.trim()).filter(Boolean).map(Number).filter(n => !Number.isNaN(n));
                      return parts.length ? parts : null;
                    }
                    // If it's an object with named properties (tx/ty/px/py) or numeric keys
                    if (typeof c === 'object') {
                      const byName = ['tx','ty','px','py'].map(k => (k in c) ? Number(c[k]) : undefined).filter(v => typeof v !== 'undefined' && !Number.isNaN(v));
                      if (byName.length === 4) return byName;
                      // numeric keys
                      const numeric = [];
                      for (let i = 0; i < 4; i++) {
                        if (i in c) numeric.push(Number(c[i]));
                      }
                      if (numeric.length) return numeric.filter(n => !Number.isNaN(n));
                      // fallback: if object has coords or coord string
                      if (c.coords) return normalize(c.coords);
                      if (c.toString && typeof c.toString === 'function') {
                        const maybe = String(c.toString());
                        if (maybe && /[, ]/.test(maybe)) return normalize(maybe);
                      }
                    }
                    return null;
                  };
                  let coords = normalize(api?.coordsTilePixel) || [];
                  // If partial, try to pull missing values from templateCoordsTilePixel
                  const tcoords = normalize(api?.templateCoordsTilePixel) || [];
                  for (let i = 0; i < 4; i++) {
                    if (typeof coords[i] === 'undefined' || Number.isNaN(Number(coords[i]))) {
                      if (typeof tcoords[i] !== 'undefined' && tcoords[i] !== null && tcoords[i] !== '') coords[i] = Number(tcoords[i]);
                    }
                  }

                  // As last resort, pull from saved coords persisted in GM storage
                  try {
                    const savedRaw = JSON.parse(GM_getValue('bmCoords', '{}')) || {};
                    // Accept several known shapes that have appeared in different builds:
                    // - { tx, ty, px, py }
                    // - { Ut, Ht, px, Kt } (minified/legacy)
                    // - lowercase variants
                    const pick = (s) => {
                      if (!s) return [undefined, undefined, undefined, undefined];
                      const sets = [
                        [s.tx, s.ty, s.px, s.py],
                        [s.Ut, s.Ht, s.px, s.Kt],
                        [s.ut, s.ht, s.px, s.kt],
                        [s.Ut, s.Ht, s.px, s.Kt]
                      ];
                      for (const arr of sets) {
                        if (arr && arr.some(v => typeof v !== 'undefined' && v !== null && v !== '')) {
                          return arr.map(v => (typeof v !== 'undefined' && v !== null && v !== '') ? Number(v) : undefined);
                        }
                      }
                      return [undefined, undefined, undefined, undefined];
                    };
                    const sArr = pick(savedRaw);
                    for (let i = 0; i < 4; i++) {
                      if (typeof coords[i] === 'undefined' || Number.isNaN(Number(coords[i]))) {
                        if (typeof sArr[i] !== 'undefined' && sArr[i] !== null && sArr[i] !== '') coords[i] = Number(sArr[i]);
                      }
                    }
                  } catch (_) {}

                  // Final validation: ensure we have 4 numeric values
                  const missing = !coords || coords.length < 4 || coords.slice(0,4).some(v => typeof v === 'undefined' || Number.isNaN(Number(v)));
                  if (missing) {
                    // If we have *no* numeric candidates at all, keep failing
                    const anyNumeric = Array.isArray(coords) && coords.some(v => typeof v !== 'undefined' && v !== null && !Number.isNaN(Number(v)));
                    if (!anyNumeric) {
                      try {
                        const apiCoords = normalize(api?.coordsTilePixel);
                        const tplCoords = normalize(api?.templateCoordsTilePixel);
                        let saved = {};
                        try { saved = JSON.parse(GM_getValue('bmCoords', '{}')) || {}; } catch(_){ }
                        const savedArr = [saved.tx, saved.ty, saved.px, saved.py].map(v => (typeof v !== 'undefined' && v !== null && v !== '') ? Number(v) : null);
                        console.warn('Black Marble: coords button failed to assemble 4 values (no numeric candidates)', { coords, apiCoords, tplCoords, savedArr });
                      } catch (_) {}
                      instance.handleDisplayError('Coordinates are malformed! Did you try clicking on the canvas first?');
                      return;
                    }
                    // Otherwise, pad missing values with 0 as a safe fallback and continue
                    try {
                      console.warn('Black Marble: coords incomplete, padding missing values with 0', { coords });
                      instance.handleDisplayStatus('Coords partially sourced; missing values padded with 0');
                    } catch (_) {}
                    // Ensure coords becomes an array of length 4 with numeric entries
                    coords = (coords || []).slice(0,4).map(v => (typeof v === 'undefined' || v === null || Number.isNaN(Number(v))) ? 0 : Number(v));
                    while (coords.length < 4) coords.push(0);
                  }

                  // Coerce to numbers and take first 4
                  coords = coords.slice(0,4).map(v => Number(v));

                  // Update canonical inputs
                  instance.updateInnerHTML('bm-input-tx', (coords[0] ?? ''));
                  instance.updateInnerHTML('bm-input-ty', (coords[1] ?? ''));
                  instance.updateInnerHTML('bm-input-px', (coords[2] ?? ''));
                  instance.updateInnerHTML('bm-input-py', (coords[3] ?? ''));
                  // Also update legacy/minified inputs if present (#bm-v/#bm-w/#bm-x/#bm-y)
                  try { const a=document.querySelector('#bm-input-tx'); if (a) a.value = coords[0]; } catch(_){}
                  try { const a=document.querySelector('#bm-input-ty'); if (a) a.value = coords[1]; } catch(_){}
                  try { const a=document.querySelector('#bm-input-px'); if (a) a.value = coords[2]; } catch(_){}
                  try { const a=document.querySelector('#bm-input-py'); if (a) a.value = coords[3]; } catch(_){}
                  try { const a=document.querySelector('#bm-v'); if (a) a.value = coords[0]; } catch(_){}
                  try { const a=document.querySelector('#bm-w'); if (a) a.value = coords[1]; } catch(_){}
                  try { const a=document.querySelector('#bm-x'); if (a) a.value = coords[2]; } catch(_){}
                  try { const a=document.querySelector('#bm-y'); if (a) a.value = coords[3]; } catch(_){}
                  persistCoords();
        }
      }).buildElement()

          // Lock button: toggles color-lock behavior (lock_open / lock)
          .addButton({'id': 'bm-button-colors-lock', 'className': 'bm-lock-icon bm-action-btn', 'style': 'margin-left: 6px; display:flex;'}, (instance, button) => {
            button.dataset.locked = '0';
            button.title = 'Lock painting to selected colors';
            // add visible icon so toggling works even after minification
            try {
              const icon = document.createElement('span');
              icon.className = 'material-symbols-rounded';
              icon.textContent = 'lock_open';
              icon.style.fontSize = '18px';
              icon.style.display = 'inline-block';
              // no transition for lock icon (user requested no animation)
              icon.style.transition = 'none';
              button.appendChild(icon);
              // ensure consistent inline sizing
              button.style.width = '40px';
              button.style.height = '40px';
              button.style.padding = '6px';
              button.style.minWidth = '40px';
              button.style.boxSizing = 'border-box';
              if (button.style.setProperty) {
                button.style.setProperty('width','40px','important');
                button.style.setProperty('height','40px','important');
                button.style.setProperty('padding','6px','important');
                button.style.setProperty('min-width','40px','important');
                button.style.setProperty('box-sizing','border-box','important');
              }
            } catch(_){ }
            // Restore persisted lock state (if available) and ensure icon sync across legacy selectors
            (async () => {
              try {
                if (typeof GM !== 'undefined' && typeof GM.getValue === 'function') {
                  const val = await GM.getValue('bmLocked');
                  const locked = !!val;
                  button.dataset.locked = locked ? '1' : '0';
                  try { icon.textContent = locked ? 'lock' : 'lock_open'; } catch(_){}
                }
              } catch(_){}
              // ensure any legacy variants reflect the same state
              try {
                const sync = () => {
                  const knobs = document.querySelectorAll('#bm-button-colors-lock, #bm-_, .bm-lock-icon');
                  knobs.forEach(k => {
                    try {
                      k.dataset.locked = button.dataset.locked || '0';
                      const ie = k.querySelector && k.querySelector('.material-symbols-rounded');
                      if (ie) try { ie.textContent = (k.dataset.locked === '1') ? 'lock' : 'lock_open'; } catch(_){}
                    } catch(_){}
                  });
                };
                sync();
                // minor delay to catch dynamically-created legacy buttons
                setTimeout(sync, 120);
              } catch(_){}
            })();

            button.addEventListener('click', () => {
              const oldLocked = button.dataset.locked === '1';
              button.dataset.locked = oldLocked ? '0' : '1';
              const newLocked = button.dataset.locked === '1';
              const iconEl = button.querySelector('.material-symbols-rounded');
              if (iconEl) {
                try { iconEl.textContent = newLocked ? 'lock' : 'lock_open'; } catch(_) {}
                try { iconEl.style.transform = 'none'; } catch(_) {}
              }
              // Persist and sync across any legacy/minified button variants
              try {
                if (typeof GM !== 'undefined' && typeof GM.setValue === 'function') {
                  try { GM.setValue('bmLocked', newLocked); } catch(_){}
                }
              } catch(_){}
              try {
                const knobs = document.querySelectorAll('#bm-button-colors-lock, #bm-_, .bm-lock-icon');
                knobs.forEach(k => {
                  try {
                    k.dataset.locked = button.dataset.locked;
                    const ie = k.querySelector && k.querySelector('.material-symbols-rounded');
                    if (ie) try { ie.textContent = (k.dataset.locked === '1') ? 'lock' : 'lock_open'; } catch(_){}
                  } catch(_){}
                });
              } catch(_){}
            });
          }).buildElement()
  .addInput({'type': 'number', 'id': 'bm-input-tx', 'placeholder': 'Tl X', 'min': 0, 'max': 2047, 'step': 1, 'required': true, 'value': (savedCoords.tx ?? '')}, (instance, input) => {
            // Tighten spacing between header action buttons slightly (closer but not touching)
            try {
              setTimeout(() => {
                try {
                  const container = document.querySelector('#bm-k');
                  if (container && container.style && container.style.setProperty) container.style.setProperty('gap', '1px', 'important');

                  // Try multiple selectors (canonical + minified + fallback) so we don't miss any variant
                  const bLeft = document.querySelector('#bm-W') || document.querySelector('#bm-1S') || document.querySelector('.bm-1q') || document.querySelector('#bm-button-colors-top3');
                  const bMid = document.querySelector('#bm-q') || document.querySelector('#bm-1W') || document.querySelector('#bm-button-coords');
                  const bRight = document.querySelector('#bm-X') || document.querySelector('#bm-1X') || document.querySelector('#bm-button-colors-lock');

                  const forceButton = (el, tx) => {
                    if (!el || !el.style || !el.style.setProperty) return;
                    // Ensure visible and consistent across selector variants
                    el.style.setProperty('display', 'flex', 'important');
                    el.style.setProperty('visibility', 'visible', 'important');
                    el.style.setProperty('margin', '0px', 'important');
                    el.style.setProperty('padding', '6px', 'important');
                    el.style.setProperty('width', '34px', 'important');
                    el.style.setProperty('height', '34px', 'important');
                    el.style.setProperty('min-width', '34px', 'important');
                    el.style.setProperty('box-sizing', 'border-box', 'important');
                    el.style.setProperty('transform', 'translateX(' + tx + 'px)', 'important');
                    el.style.setProperty('vertical-align', 'middle', 'important');
                  };

                  forceButton(bLeft, -6);
                  forceButton(bMid, -3);
                  forceButton(bRight, -1);
                } catch(_){}}
              , 60);
            } catch(_){}
          
          //if a paste happens on tx, split and format it into other coordinates if possible
          input.addEventListener("paste", (event) => {
            let splitText = (event.clipboardData || window.clipboardData).getData("text").split(" ").filter(n => n).map(Number).filter(n => !isNaN(n)); //split and filter all Non Numbers

            if (splitText.length !== 4 ) { // If we don't have 4 clean coordinates, end the function.
              return;
            }

            let coords = selectAllCoordinateInputs(document); 

            for (let i = 0; i < coords.length; i++) { 
              coords[i].value = splitText[i]; //add the split vales
            }

            event.preventDefault(); //prevent the pasting of the original paste that would overide the split value
          })
          const handler = () => persistCoords();
          input.addEventListener('input', handler);
          input.addEventListener('change', handler);
        }).buildElement()
  .addInput({'type': 'number', 'id': 'bm-input-ty', 'placeholder': 'Tl Y', 'min': 0, 'max': 2047, 'step': 1, 'required': true, 'value': (savedCoords.ty ?? '')}, (instance, input) => {
          const handler = () => persistCoords();
          input.addEventListener('input', handler);
          input.addEventListener('change', handler);
        }).buildElement()
  .addInput({'type': 'number', 'id': 'bm-input-px', 'placeholder': 'Px X', 'min': 0, 'max': 2047, 'step': 1, 'required': true, 'value': (savedCoords.px ?? '')}, (instance, input) => {
          const handler = () => persistCoords();
          input.addEventListener('input', handler);
          input.addEventListener('change', handler);
        }).buildElement()
  .addInput({'type': 'number', 'id': 'bm-input-py', 'placeholder': 'Px Y', 'min': 0, 'max': 2047, 'step': 1, 'required': true, 'value': (savedCoords.py ?? '')}, (instance, input) => {
          const handler = () => persistCoords();
          input.addEventListener('input', handler);
          input.addEventListener('change', handler);
        }).buildElement()
      .buildElement()

  // Color filter UI
  .addDiv({'id': 'bm-contain-colorfilter', 'style': 'max-height: 140px; overflow: auto; border: 1px solid rgba(255,255,255,0.1); padding: 4px; border-radius: 4px; display: none;'} )
          // (Top3 toggle moved into the coords container to avoid duplicate IDs)
        .buildElement()
    // Insert enable/disable all color buttons
    .addDiv({'style': 'display: flex; gap: 6px; margin-bottom: 6px;'})
  .addButton({'id': 'bm-button-colors-enable-all', 'textContent': 'Activar colores', 'className': 'bm-small-action bm-action-btn', 'style': 'font-size: 12px; padding:6px 12px; display: inline-flex; align-items: center; justify-content: center; height: 48px; min-width: 140px; box-sizing: border-box;'}, (instance, button) => {
            button.onclick = () => {
                try {
                  // Find active template (prefer explicit active input, then runtime selected, then persisted)
                  const activeKey = document.querySelector('#bm-active-template')?.value;
                  const templates = templateManager.templatesArray || [];
                  let active = null;
                  if (activeKey) active = templates.find(x => x && x.storageKey === activeKey) || null;
                  if (!active) active = templates.find(x => x && x.selected) || null;
                  if (!active) {
                    const persisted = templateManager.templatesJSON?.templates || {};
                    const selKey = Object.keys(persisted).find(k => persisted[k] && persisted[k].selected);
                    if (selKey) active = templates.find(x => x && x.storageKey === selKey) || null;
                  }
                  if (!active) { instance.handleDisplayError('No hay plantilla seleccionada'); return; }

                  // Enable all colors only for the active template
                  if (active.colorPalette) {
                    Object.values(active.colorPalette).forEach(c => { if (c) c.enabled = true; });
                    try {
                      if (templateManager.templatesJSON?.templates && active.storageKey) {
                        templateManager.templatesJSON.templates[active.storageKey] = templateManager.templatesJSON.templates[active.storageKey] || {};
                        templateManager.templatesJSON.templates[active.storageKey].palette = active.colorPalette;
                        GM.setValue('bmTemplates', JSON.stringify(templateManager.templatesJSON));
                      }
                    } catch(_){}
                  } else {
                    // runtime missing palette: try to enable persisted palette
                    try {
                      if (templateManager.templatesJSON?.templates && active.storageKey && templateManager.templatesJSON.templates[active.storageKey]?.palette) {
                        Object.values(templateManager.templatesJSON.templates[active.storageKey].palette).forEach(c => { if (c) c.enabled = true; });
                        GM.setValue('bmTemplates', JSON.stringify(templateManager.templatesJSON));
                      }
                    } catch(_){}
                  }

                  try { buildColorFilterList(); } catch(_){}
                  instance.handleDisplayStatus('Colores habilitados (plantilla seleccionada)');
                  console.log('BM: enable-all applied to active template', active?.storageKey || '(unknown)');
                } catch (e) { console.error('BM enable-all error', e); }
              };
          }).buildElement()
  .addButton({'id': 'bm-button-colors-disable-all', 'textContent': 'Desactivar colores', 'className': 'bm-small-action bm-action-btn', 'style': 'font-size: 12px; padding:6px 12px; display: inline-flex; align-items: center; justify-content: center; height: 48px; min-width: 140px; box-sizing: border-box;'}, (instance, button) => {
            button.onclick = () => {
              try {
                // Find active template (prefer explicit active input, then runtime selected, then persisted)
                const activeKey = document.querySelector('#bm-active-template')?.value;
                const templates = templateManager.templatesArray || [];
                let active = null;
                if (activeKey) active = templates.find(x => x && x.storageKey === activeKey) || null;
                if (!active) active = templates.find(x => x && x.selected) || null;
                if (!active) {
                  const persisted = templateManager.templatesJSON?.templates || {};
                  const selKey = Object.keys(persisted).find(k => persisted[k] && persisted[k].selected);
                  if (selKey) active = templates.find(x => x && x.storageKey === selKey) || null;
                }
                if (!active) { instance.handleDisplayError('No hay plantilla seleccionada'); return; }

                // Disable all colors only for the active template
                if (active.colorPalette) {
                  Object.values(active.colorPalette).forEach(c => { if (c) c.enabled = false; });
                  try {
                    if (templateManager.templatesJSON?.templates && active.storageKey) {
                      templateManager.templatesJSON.templates[active.storageKey] = templateManager.templatesJSON.templates[active.storageKey] || {};
                      templateManager.templatesJSON.templates[active.storageKey].palette = active.colorPalette;
                      GM.setValue('bmTemplates', JSON.stringify(templateManager.templatesJSON));
                    }
                  } catch(_){}
                } else {
                  // runtime missing palette: try to disable persisted palette
                  try {
                    if (templateManager.templatesJSON?.templates && active.storageKey && templateManager.templatesJSON.templates[active.storageKey]?.palette) {
                      Object.values(templateManager.templatesJSON.templates[active.storageKey].palette).forEach(c => { if (c) c.enabled = false; });
                      GM.setValue('bmTemplates', JSON.stringify(templateManager.templatesJSON));
                    }
                  } catch(_){}
                }

                try { buildColorFilterList(); } catch(_){ }
                instance.handleDisplayStatus('Colores desactivados (plantilla seleccionada)');
                console.log('BM: disable-all applied to active template', active?.storageKey || '(unknown)');
              } catch (e) { console.error('BM disable-all error', e); }
            };
          }).buildElement()
        .buildElement()
  .addDiv({'id': 'bm-colorfilter-list'}).buildElement()
  .buildElement()
  // Replace individual template buttons with a single 'Gestionar plantillas' control
  .addDiv({'id': 'bm-manage-templates', 'style': 'margin-top:6px; display:block;'} )
    .addButton({'id': 'bm-button-manage-templates', 'textContent': 'Gestionar plantillas', 'className': 'bm-small-action bm-manage-fullwidth', 'style': 'display: flex; width: 100%; box-sizing: border-box; padding: 8px 10px; align-items: center; justify-content: center; margin: 0;'}, (instance, btn) => {
      // Create a hidden panel that will hold upload + presets list
      let panel = null;
      const ensurePanel = () => {
        if (panel) return panel;
        panel = document.createElement('div');
        panel.id = 'bm-manage-templates-panel';
        panel.style.display = 'none';
        panel.style.marginTop = '8px';
        panel.style.maxHeight = '320px';
        panel.style.overflow = 'auto';
        panel.style.border = '1px solid rgba(255,255,255,0.06)';
        panel.style.padding = '8px';

        // Upload control inside panel
        const uploadWrapper = document.createElement('div');
        uploadWrapper.style.display = 'flex';
        uploadWrapper.style.gap = '8px';
        uploadWrapper.style.alignItems = 'center';

  const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.id = 'bm-input-file-template';
  fileInput.multiple = true;
        fileInput.accept = 'image/png, image/jpeg, image/webp, image/bmp, image/gif';
        fileInput.style.display = 'inline-block';

  // Staged files will be kept here until coordinates are valid and upload is confirmed
  let stagedFiles = [];

  const uploadBtn = document.createElement('button');
  uploadBtn.className = 'btn btn-soft';
  uploadBtn.title = 'Seleccionar plantilla';
  uploadBtn.innerHTML = '<span class="material-symbols-rounded">upload_file</span>';
        try {
          // Make upload button share width with confirm button and avoid overflowing modal
          uploadBtn.style.setProperty('display', 'inline-flex', 'important');
          uploadBtn.style.setProperty('visibility', 'visible', 'important');
          uploadBtn.style.setProperty('flex', '1 1 0', 'important');
          uploadBtn.style.setProperty('min-width', '0', 'important');
          uploadBtn.style.setProperty('box-sizing', 'border-box', 'important');
          uploadBtn.style.setProperty('padding', '6px 12px', 'important');
          uploadBtn.style.setProperty('font-size', '12px', 'important');
          uploadBtn.style.setProperty('height', '40px', 'important');
          uploadBtn.style.setProperty('align-items', 'center', 'important');
          uploadBtn.style.setProperty('justify-content', 'center', 'important');
          // Truncate long filenames with ellipsis
          uploadBtn.style.setProperty('white-space', 'nowrap', 'important');
          uploadBtn.style.setProperty('overflow', 'hidden', 'important');
          uploadBtn.style.setProperty('text-overflow', 'ellipsis', 'important');
        } catch(_){}
        // helper to perform upload processing
  const doUploadFiles = async () => {
          try {
            const coordTlX = document.querySelector('#bm-input-tx');
            const coordTlY = document.querySelector('#bm-input-ty');
            const coordPxX = document.querySelector('#bm-input-px');
            const coordPxY = document.querySelector('#bm-input-py');
            if (!coordTlX?.checkValidity() || !coordTlY?.checkValidity() || !coordPxX?.checkValidity() || !coordPxY?.checkValidity()) {
              return instance.handleDisplayError('Coordinates are malformed! Select valid coordinates before creating the template.');
            }
            const files = stagedFiles || [];
            if (!files.length) { return instance.handleDisplayError('No file staged! Use the file picker first.'); }
            let created = 0;
            // Await template creation promises so UI rebuild runs after templates exist in runtime
            for (const file of files) {
              try {
                await templateManager.createTemplate(file, file.name.replace(/\.[^/.]+$/, ''), [Number(coordTlX.value), Number(coordTlY.value), Number(coordPxX.value), Number(coordPxY.value)]);
                created++;
              } catch(e) { console.error('Failed to create template for', file, e); }
            }
            if (created) {
              instance.handleDisplayStatus(`Creada(s) ${created} plantilla(s)`);
              // clear staged files and input
              stagedFiles = [];
              try { fileInput.value = ''; } catch(_) {}
              uploadBtn.title = 'Seleccionar plantilla';
              // Ask for an immediate UI rebuild so new templates appear while panel is open
              try { window.postMessage({ source: 'blue-marble', bmEvent: 'bm-rebuild-template-list' }, '*'); } catch(_) {}
              try { if (typeof window.buildTemplatePresetList === 'function') window.buildTemplatePresetList(); } catch(_){}
              try { if (typeof window.buildColorFilterList === 'function') window.buildColorFilterList(); } catch(_){}
              // Scroll presets list to bottom so new entries are visible
              try { setTimeout(() => { const presets = document.getElementById('bm-presets-list'); if (presets) { presets.scrollTop = presets.scrollHeight; } }, 80); } catch(_){}
              // Some template creation operations may be asynchronous; rebuild again shortly after
              try { setTimeout(() => { try { if (typeof window.buildTemplatePresetList === 'function') window.buildTemplatePresetList(); if (typeof window.buildColorFilterList === 'function') window.buildColorFilterList(); const presets = document.getElementById('bm-presets-list'); if (presets) presets.scrollTop = presets.scrollHeight; } catch(_){} }, 350); } catch(_){}
            } else {
              instance.handleDisplayError('No se creó ninguna plantilla');
            }
          } catch (e) { console.error('Failed to upload template', e); instance.handleDisplayError('Error al subir plantilla'); }
        };

        // Main upload button opens the file picker. The actual upload is confirmed with a separate 'Subir' button.
        uploadBtn.onclick = () => { try { fileInput.click(); } catch(e) { console.error(e); } };

        // Confirm-upload button (initially hidden) to create templates from staged files
        const confirmUploadBtn = document.createElement('button');
        confirmUploadBtn.className = 'btn btn-soft bm-confirm-upload';
        confirmUploadBtn.textContent = 'Subir';
        confirmUploadBtn.style.display = 'none';
        confirmUploadBtn.style.marginLeft = '6px';
        try {
          // Make confirm button share width with upload button and avoid overflowing modal
          confirmUploadBtn.style.setProperty('display', 'inline-flex', 'important');
          confirmUploadBtn.style.setProperty('visibility', 'visible', 'important');
          confirmUploadBtn.style.setProperty('flex', '1 1 0', 'important');
          confirmUploadBtn.style.setProperty('min-width', '0', 'important');
          confirmUploadBtn.style.setProperty('box-sizing', 'border-box', 'important');
          confirmUploadBtn.style.setProperty('padding', '6px 12px', 'important');
          confirmUploadBtn.style.setProperty('font-size', '12px', 'important');
          confirmUploadBtn.style.setProperty('height', '40px', 'important');
          confirmUploadBtn.style.setProperty('align-items', 'center', 'important');
          confirmUploadBtn.style.setProperty('justify-content', 'center', 'important');
        } catch(_){}
        confirmUploadBtn.addEventListener('click', () => { try { doUploadFiles(); } catch(_){} });

        // When files are selected, keep them staged and update the upload button label and show confirm button
        fileInput.addEventListener('change', () => {
          try {
            stagedFiles = Array.from(fileInput.files || []);
            if (stagedFiles.length) {
              // show first filename (without extension) as the upload button label
              const baseName = stagedFiles[0].name.replace(/\.[^/.]+$/, '');
              const label = (stagedFiles.length > 1) ? `${baseName} (+${stagedFiles.length - 1})` : baseName;
              // set text and tooltip; tooltip shows full names count
              uploadBtn.textContent = label;
              uploadBtn.title = `${stagedFiles.length} archivo(s) seleccionados`;
              confirmUploadBtn.style.display = '';
              // ensure ellipsis behavior in case of long names
              try {
                uploadBtn.style.setProperty('white-space', 'nowrap', 'important');
                uploadBtn.style.setProperty('overflow', 'hidden', 'important');
                uploadBtn.style.setProperty('text-overflow', 'ellipsis', 'important');
              } catch(_){}
            } else {
              uploadBtn.innerHTML = '<span class="material-symbols-rounded">upload_file</span>';
              uploadBtn.title = 'Seleccionar archivo(s)';
              confirmUploadBtn.style.display = 'none';
              try {
                uploadBtn.style.removeProperty('white-space');
                uploadBtn.style.removeProperty('overflow');
                uploadBtn.style.removeProperty('text-overflow');
              } catch(_){}
            }
          } catch(_){ }
        });

        uploadWrapper.appendChild(fileInput);
        uploadWrapper.appendChild(uploadBtn);
        uploadWrapper.appendChild(confirmUploadBtn);
        panel.appendChild(uploadWrapper);

        // Add the presets container which will be populated by buildTemplatePresetList()
        const presets = document.createElement('div');
        presets.id = 'bm-presets-list';
        presets.style.marginTop = '12px';
        presets.style.display = 'block';
        presets.style.maxHeight = '220px';
        presets.style.overflow = 'auto';
        panel.appendChild(presets);

        // If any stray #bm-presets-list exists elsewhere in the DOM (from older builds),
        // move its content into our panel's presets container and remove the stray node.
        try {
          const existing = Array.from(document.querySelectorAll('#bm-presets-list'));
          existing.forEach(el => {
            if (el === presets) return;
            // move child nodes
            while (el.firstChild) {
              presets.appendChild(el.firstChild);
            }
            // remove the old container
            el.remove();
          });
        } catch (_) {}

        btn.parentElement?.insertBefore(panel, btn.nextSibling);
        return panel;
      };

      btn.addEventListener('click', () => {
        const p = ensurePanel();
        p.style.display = (p.style.display === 'none') ? '' : 'none';
        // Request a rebuild so the presets list is current
        try { window.postMessage({ source: 'blue-marble', bmEvent: 'bm-rebuild-template-list' }, '*'); } catch(_) {}
      });
    }).buildElement()
  .buildElement()
  .addTextarea({'id': overlayMain.outputStatusId, 'placeholder': `Estado: Inactivo...\nVersión: ${version}`, 'readOnly': true}).buildElement()
      .addDiv({'id': 'bm-contain-buttons-action'})
        .addDiv()
          // .addButton({'id': 'bm-button-teleport', 'className': 'bm-help', 'textContent': '✈'}).buildElement()
          // .addButton({'id': 'bm-button-favorite', 'className': 'bm-help', 'innerHTML': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><polygon points="10,2 12,7.5 18,7.5 13.5,11.5 15.5,18 10,14 4.5,18 6.5,11.5 2,7.5 8,7.5" fill="white"></polygon></svg>'}).buildElement()
          // .addButton({'id': 'bm-button-templates', 'className': 'bm-help', 'innerHTML': '🖌'}).buildElement()
          .addButton({'id': 'bm-button-convert', 'className': 'bm-help bm-small-icon', 'innerHTML': '<span class="material-symbols-rounded">palette</span>', 'title': 'Template Color Converter'}, 
            (instance, button) => {
            button.addEventListener('click', () => {
              window.open('https://pepoafonso.github.io/color_converter_wplace/', '_blank', 'noopener noreferrer');
            });
          }).buildElement()
          // Button: collapse/expand the status textarea (open/close panel icons) with persisted state
          .addButton({'id': 'bm-button-toggle-output', 'className': 'bm-help', 'innerHTML': '<span class="material-symbols-rounded">bottom_panel_close</span>', 'title': 'Mostrar/ocultar área de estado'},
            (instance, button) => {
              // Initialize dataset
              button.dataset.active = '0';
              // Resolve canonical textarea
              const resolveTextarea = () => document.querySelector('#bm-o') || document.querySelector(`#${instance.outputStatusId}`) || document.querySelector('#bm-output-status');

              // Apply a persisted preference if present
              try {
                if (typeof GM !== 'undefined' && typeof GM.getValue === 'function') {
                  GM.getValue('bmOutputVisible').then(val => {
                    try {
                      const textarea = resolveTextarea();
                      const visible = !!val; // truthy -> visible
                      if (textarea) {
                          if (visible) {
                          textarea.style.display = '';
                          textarea.dataset.bmHidden = '0';
                          textarea.readOnly = true;
                          try { textarea.disabled = false; } catch(_) {}
                          textarea.style.opacity = '0.9';
                          button.dataset.active = '1';
                          button.title = 'Ocultar área de estado';
                          try { button.innerHTML = '<span class="material-symbols-rounded">bottom_panel_open</span>'; } catch(_){ }
                        } else {
                          textarea.style.display = 'none';
                          textarea.dataset.bmHidden = '1';
                          textarea.readOnly = true;
                          try { textarea.disabled = true; } catch(_) {}
                          textarea.style.opacity = '0.7';
                          button.dataset.active = '0';
                          button.title = 'Mostrar área de estado';
                          try { button.innerHTML = '<span class="material-symbols-rounded">bottom_panel_close</span>'; } catch(_){ }
                        }
                      }
                    } catch(_){}
                  }).catch(()=>{});
                }
              } catch(_){}

              button.addEventListener('click', () => {
                try {
                  const textarea = resolveTextarea();
                  if (!textarea) { try { instance.handleDisplayError('No se encontró el área de estado'); } catch(_){}; return; }
                  const isHidden = textarea.style.display === 'none' || textarea.hidden || textarea.dataset.bmHidden === '1';
                    if (isHidden) {
                    // Show and keep readOnly
                    textarea.style.display = '';
                    textarea.dataset.bmHidden = '0';
                    textarea.readOnly = true;
                    try { textarea.disabled = false; } catch(_) {}
                    textarea.style.opacity = '0.9';
                    button.dataset.active = '1';
                    button.title = 'Ocultar área de estado';
                    try { button.innerHTML = '<span class="material-symbols-rounded">bottom_panel_open</span>'; } catch(_) {}
                    try { if (typeof GM !== 'undefined' && typeof GM.setValue === 'function') GM.setValue('bmOutputVisible', true); } catch(_){}
                    try { instance.handleDisplayStatus('Área de estado mostrada (solo lectura)'); } catch(_){}
                  } else {
                    // Hide and enforce readOnly/disabled
                    textarea.style.display = 'none';
                    textarea.dataset.bmHidden = '1';
                    textarea.readOnly = true;
                    try { textarea.disabled = true; } catch(_) {}
                    textarea.style.opacity = '0.7';
                    button.dataset.active = '0';
                    button.title = 'Mostrar área de estado';
                    try { button.innerHTML = '<span class="material-symbols-rounded">bottom_panel_close</span>'; } catch(_) {}
                    try { if (typeof GM !== 'undefined' && typeof GM.setValue === 'function') GM.setValue('bmOutputVisible', false); } catch(_){}
                    try { instance.handleDisplayStatus('Área de estado ocultada'); } catch(_){}
                  }
                } catch (e) { try { instance.handleDisplayError('Error alternando área de estado'); } catch(_){} }
              });
            }).buildElement()
          // .addButton({'id': 'bm-button-website', 'className': 'bm-help', 'textContent': 'Sitio oficial', 'title': 'Official Black Marble Website'}, 
          //   (instance, button) => {
          //   button.addEventListener('click', () => {
          //     window.open('https://bluemarble.lol/', '_blank', 'noopener noreferrer');
          //   });
          // }).buildElement()
        .buildElement()
          .addSmall({'textContent': 'Creado por SwingTheVine • mod. Jaie55', 'style': 'margin-top: auto; font-size: 9px;'}).buildElement()
      .buildElement()
    .buildElement()
  .buildOverlay(document.body);

    // Runtime fix: ensure legacy container #bm-1p and its buttons are compact to avoid horizontal scrollbar
    try {
      setTimeout(() => {
        const container = document.getElementById('bm-1p');
        if (!container) { return; }
        // Force the container's child rows to wrap
        Array.from(container.querySelectorAll(':scope > div')).forEach(d => {
          try {
            d.style.setProperty('display','flex','important');
            d.style.setProperty('flex-wrap','wrap','important');
            d.style.setProperty('gap','6px','important');
            d.style.setProperty('align-items','center','important');
          } catch(e){}
        });

        // Compact soft buttons inside the container
        const canonEnable = document.getElementById('bm-button-colors-enable-all');
        const canonDisable = document.getElementById('bm-button-colors-disable-all');
        const copyStyles = (src, dest) => {
          try {
            const cs = window.getComputedStyle(src);
            // pick a small set of sizing props to copy
            ['padding','font-size','height','min-width','max-width','line-height','box-sizing'].forEach(p => {
              const v = cs.getPropertyValue(p);
              if (v) dest.style.setProperty(p, v, 'important');
            });
            dest.style.setProperty('white-space','nowrap','important');
            dest.style.setProperty('overflow','hidden','important');
            dest.style.setProperty('text-overflow','ellipsis','important');
          } catch(e){}
        };

        const softButtons = Array.from(container.querySelectorAll('.btn.btn-soft'));
        if ((canonEnable || canonDisable) && softButtons.length > 0) {
          // apply canonical styles to left/right buttons where possible
          softButtons.forEach((b, idx) => {
            try {
              if (idx === 0 && canonEnable) copyStyles(canonEnable, b);
              else if (idx === 1 && canonDisable) copyStyles(canonDisable, b);
              else {
                // fallback default compact
                b.style.setProperty('padding','3px 6px','important');
                b.style.setProperty('font-size','11px','important');
                b.style.setProperty('height','34px','important');
                b.style.setProperty('min-width','40px','important');
                b.style.setProperty('max-width','88px','important');
                b.style.setProperty('white-space','nowrap','important');
                b.style.setProperty('overflow','hidden','important');
                b.style.setProperty('text-overflow','ellipsis','important');
                b.style.setProperty('box-sizing','border-box','important');
              }
            } catch(e){}
          });
        } else {
          // no canonical buttons found; fallback to default compact
          softButtons.forEach(b => {
            try {
              b.style.setProperty('padding','3px 6px','important');
              b.style.setProperty('font-size','11px','important');
              b.style.setProperty('height','34px','important');
              b.style.setProperty('min-width','40px','important');
              b.style.setProperty('max-width','88px','important');
              b.style.setProperty('white-space','nowrap','important');
              b.style.setProperty('overflow','hidden','important');
              b.style.setProperty('text-overflow','ellipsis','important');
              b.style.setProperty('box-sizing','border-box','important');
            } catch(e){}
          });
        }
      }, 120);
    } catch(e){}

  // After building overlay, sync canonical inputs to legacy/minified ids if they exist
  try {
    const syn = () => {
      const t = document.querySelector('#bm-input-tx')?.value ?? document.querySelector('#bm-v')?.value;
      const y = document.querySelector('#bm-input-ty')?.value ?? document.querySelector('#bm-w')?.value;
      const px = document.querySelector('#bm-input-px')?.value ?? document.querySelector('#bm-x')?.value;
      const py = document.querySelector('#bm-input-py')?.value ?? document.querySelector('#bm-y')?.value;
      if (document.querySelector('#bm-v')) document.querySelector('#bm-v').value = t ?? '';
      if (document.querySelector('#bm-w')) document.querySelector('#bm-w').value = y ?? '';
      if (document.querySelector('#bm-x')) document.querySelector('#bm-x').value = px ?? '';
      if (document.querySelector('#bm-y')) document.querySelector('#bm-y').value = py ?? '';
    };
    setTimeout(syn, 50);
  } catch (_) {}

  // Post-build: ensure color list is collapsed (compact) by default.
  // We do this outside the overlay builder to avoid reliance on builder chaining
  // methods that minify unpredictably (previously produced a runtime '.ie is not a function').
  try {
    setTimeout(() => {
      try {
        const cf = document.querySelector('#bm-contain-colorfilter');
        const list = document.querySelector('#bm-colorfilter-list');
        if (cf && !cf.classList.contains('bm-color-compact')) cf.classList.add('bm-color-compact');
        if (list && !list.classList.contains('bm-color-compact')) list.classList.add('bm-color-compact');
        // Ensure the top3/minimize button reflects the compact-by-default state
        try {
          const top3Btn = document.querySelector('#bm-button-colors-top3') || document.querySelector('#bm-W');
          if (top3Btn) {
            top3Btn.dataset.active = '1';
            // adjust icon text if present (mapping inverted: active -> arrow_drop_down)
            const icon = top3Btn.querySelector('.material-symbols-rounded');
            if (icon) icon.textContent = 'arrow_drop_down';
          }
        } catch(_) {}
        // Inject a guaranteed visible drag indicator inside the drag bar (#bm-z)
        try {
          const drag = document.querySelector('#bm-z') || document.querySelector('#bm-bar-drag');
          if (drag && !drag.querySelector('#bm-drag-indicator')) {
            const ind = document.createElement('div');
            ind.id = 'bm-drag-indicator';
            // Inline styles to guarantee visibility and use accent fallback
            ind.style.pointerEvents = 'none';
            ind.style.position = 'absolute';
            ind.style.left = '50%';
            ind.style.top = '50%';
            ind.style.transform = 'translate(-50%, -50%)';
            ind.style.width = '46%';
            ind.style.height = '6px';
            ind.style.borderRadius = '4px';
            ind.style.background = 'linear-gradient(90deg, var(--bm-accent, #FA4E49), rgba(250,78,73,0.9))';
            ind.style.boxShadow = '0 1px 0 rgba(0,0,0,0.45) inset, 0 0 10px rgba(250,78,73,0.06)';
            ind.style.zIndex = '2';
            drag.style.position = drag.style.position || 'relative';
            drag.appendChild(ind);
          }
        } catch(_) {}
      } catch (_) {}
    }, 0);
  } catch (_) {}

  // Runtime fix: ensure the "Gestionar plantillas" control sits directly after the
  // color filter list and retains full-width styling even if host CSS overrides it.
  try {
    setTimeout(() => {
      try {
        const manage = document.getElementById('bm-manage-templates');
        const colorList = document.getElementById('bm-colorfilter-list');
        const bmC = document.getElementById('bm-c');
        // Prefer to insert after #bm-c if it exists; otherwise place after color list
        if (manage) {
          if (bmC && bmC.parentElement && manage.parentElement !== bmC.parentElement) {
            bmC.parentElement.insertBefore(manage, bmC.nextSibling);
          } else if (colorList && colorList.parentElement && manage.parentElement !== colorList.parentElement) {
            colorList.parentElement.insertBefore(manage, colorList.nextSibling);
          }
          // Ensure container displays as block and does not overlap previous buttons
          try { manage.style.setProperty('display','block','important'); } catch(_){}
          try { manage.style.setProperty('width','100%','important'); } catch(_){}
          try { manage.style.setProperty('box-sizing','border-box','important'); } catch(_){}
          try { manage.style.setProperty('margin-top','8px','important'); } catch(_){}
          try { manage.style.setProperty('clear','both','important'); } catch(_){}
          try { manage.style.setProperty('z-index','1','important'); } catch(_){}
        }
        // Enforce button styling inline to overcome external overrides
        const btn = document.getElementById('bm-button-manage-templates');
        if (btn) {
          btn.classList.add('bm-manage-fullwidth');
          try { btn.style.setProperty('display','flex','important'); } catch(_){}
          // Visual parity with other template buttons: keep a constrained width and center it
          try { btn.style.setProperty('width','88%','important'); } catch(_){}
          try { btn.style.setProperty('max-width','420px','important'); } catch(_){}
          try { btn.style.setProperty('margin','0 auto','important'); } catch(_){}
          try { btn.style.setProperty('box-sizing','border-box','important'); } catch(_){}
          try { btn.style.setProperty('padding','8px 10px','important'); } catch(_){}
          try { btn.style.setProperty('margin-top','6px','important'); } catch(_){}
          // Remove aggressive inline color/background/border so hover/focus CSS rules apply
          try { btn.style.removeProperty('background'); } catch(_){}
          try { btn.style.removeProperty('color'); } catch(_){}
          try { btn.style.removeProperty('border'); } catch(_){}
          try { btn.style.setProperty('position','relative','important'); } catch(_){}
          try { btn.style.removeProperty('transform'); } catch(_){}
        }
      } catch(_){}
    }, 60);
  } catch(_){}

  // ------- Helper: Build the color filter list -------
  window.buildColorFilterList = function buildColorFilterList() {
  const listContainer = document.querySelector('#bm-colorfilter-list');
  // Determine selected template key: prefer explicit active template, then previous select
  const activeKey = document.querySelector('#bm-active-template')?.value;
  const selectedKey = activeKey || document.querySelector('#bm-presets-select')?.value;
  const t = templateManager.templatesArray?.find(tm => tm.storageKey === selectedKey) || templateManager.templatesArray?.[0];
    // Fallback: if runtime template instance has empty colorPalette, try to read persisted palette
    try {
      if (t && (!t.colorPalette || Object.keys(t.colorPalette).length === 0)) {
        const persisted = templateManager.templatesJSON?.templates?.[t.storageKey]?.palette;
        if (persisted && Object.keys(persisted).length > 0) {
          t.colorPalette = persisted;
        }
      }
    } catch(_) {}
    // If a persisted palette exists, merge enabled flags into runtime palette so checkbox state persists
    try {
      const persistedPalette = templateManager.templatesJSON?.templates?.[t?.storageKey]?.palette;
      if (persistedPalette && t) {
        t.colorPalette = t.colorPalette || {};
        for (const [k, v] of Object.entries(persistedPalette)) {
          try {
            // ensure runtime entry exists and merge enabled/count
            const runt = t.colorPalette[k] || {};
            t.colorPalette[k] = { count: (runt.count || v.count || 0), enabled: (typeof v.enabled === 'boolean' ? v.enabled : (typeof runt.enabled === 'boolean' ? runt.enabled : true)) };
          } catch(_){}
        }
      }
    } catch(_){}
    if (!listContainer || !t?.colorPalette) {
      if (listContainer) { listContainer.innerHTML = '<small>No hay colores de plantilla para mostrar.</small>'; }
      return;
    }

    listContainer.innerHTML = '';
    try {
      listContainer.style.setProperty('width', '100%', 'important');
      listContainer.style.setProperty('box-sizing', 'border-box', 'important');
      const colorUI = document.querySelector('#bm-contain-colorfilter');
      if (colorUI) { colorUI.style.setProperty('width', '100%', 'important'); colorUI.style.setProperty('box-sizing', 'border-box', 'important'); }
      const colorList = document.querySelector('#bm-colorfilter-list');
      if (colorList) { colorList.style.setProperty('width', '100%', 'important'); colorList.style.setProperty('box-sizing', 'border-box', 'important'); }
    } catch(_){}
    const entries = Object.entries(t.colorPalette)
      .sort((a,b) => b[1].count - a[1].count); // sort by frequency desc

  // Determine if minimize mode is active (button toggles it)
  const minBtn = document.querySelector('#bm-button-colors-minimize');
  const minimizeMode = minBtn && minBtn.dataset && minBtn.dataset.active === '1';

    for (const [rgb, meta] of entries) {
      let row = document.createElement('div');
  row.style.display = 'flex';
  row.style.flexWrap = 'wrap';
  row.style.alignItems = 'center';
  row.style.gap = '8px';
  row.style.margin = '4px 0';

      let swatch = document.createElement('div');
      swatch.style.width = '14px';
      swatch.style.height = '14px';
      swatch.style.border = '1px solid rgba(255,255,255,0.5)';

      let label = document.createElement('span');
      label.style.fontSize = '12px';
      let labelText = `${meta.count.toLocaleString()}`;

      // Special handling for "other" and "transparent"
      if (rgb === 'other') {
        swatch.style.background = '#888'; // Neutral color for "Other"
        labelText = `Other • ${labelText}`;
      } else if (rgb === '#deface') {
        swatch.style.background = '#deface';
        labelText = `Transparent • ${labelText}`;
      } else {
        const [r, g, b] = rgb.split(',').map(Number);
        swatch.style.background = `rgb(${r},${g},${b})`;
        try {
            const selectedKey = document.querySelector('#bm-presets-select')?.value;
            const tObj = templateManager.templatesArray?.find(tm => tm.storageKey === selectedKey) || templateManager.templatesArray?.[0];
            const tMeta = tObj?.rgbToMeta?.get(rgb);
            if (tMeta && typeof tMeta.id === 'number') {
              const displayName = tMeta?.name || `rgb(${r},${g},${b})`;
              const starLeft = tMeta.premium ? '★ ' : '';
              labelText = `#${tMeta.id} ${starLeft}${displayName} • ${labelText}`;
            }
          } catch (ignored) {}
      }
      label.textContent = labelText;

  // 'Volver' button removed per request - no-op here

  const toggle = document.createElement('input');
  toggle.type = 'checkbox';
  toggle.checked = !!meta.enabled;
  // expose the rgb value on the checkbox for lock logic
  try { toggle.dataset.rgb = rgb; } catch(_){}
      toggle.addEventListener('change', () => {
          meta.enabled = toggle.checked;
          overlayMain.handleDisplayStatus(`${toggle.checked ? 'Enabled' : 'Disabled'} ${rgb}`);
          try {
            const selectedKey = document.querySelector('#bm-presets-select')?.value || document.querySelector('#bm-active-template')?.value;
            const tObj = templateManager.templatesArray?.find(tm => tm.storageKey === selectedKey) || templateManager.templatesArray?.[0];
            if (tObj) {
              // Ensure palette object exists on the template instance (meta is a reference)
              tObj.colorPalette = tObj.colorPalette || {};
              // Persist change and ensure templatesJSON mirrors in-memory state
              (async () => {
                try {
                  if (!templateManager.templatesJSON) templateManager.templatesJSON = await templateManager.createJSON();
                  templateManager.templatesJSON.templates[tObj.storageKey] = templateManager.templatesJSON.templates[tObj.storageKey] || { name: tObj.displayName || '', coords: (tObj.coords||[]).join(','), enabled: true, tiles: {}, palette: tObj.colorPalette };
                  templateManager.templatesJSON.templates[tObj.storageKey].palette = tObj.colorPalette;
                  try { await GM.setValue('bmTemplates', JSON.stringify(templateManager.templatesJSON)); } catch(_) {}
                  // Notify other parts (and rebuilt UI) that palette changed
                  window.postMessage({ source: 'blue-marble', bmEvent: 'bm-rebuild-color-list' }, '*');
                } catch (_) {}
              })();
            }
          } catch (_) {}
      });

  row.appendChild(toggle);
  row.appendChild(swatch);
  row.appendChild(label);
  listContainer.appendChild(row);
  // We no longer truncate the DOM list to 3 rows; the compact view is visual only via CSS
    }
  };

  // Listen for template creation/import completion to (re)build palette list
  window.addEventListener('message', (event) => {
    if (event?.data?.bmEvent === 'bm-rebuild-color-list') {
      try {
        const colorUI = document.querySelector('#bm-contain-colorfilter');
        if (colorUI) {
          try { colorUI.style.display = ''; } catch(_){}
        }
        // schedule rebuild slightly later to ensure template objects are initialized
        setTimeout(() => { try { if (typeof buildColorFilterList === 'function') buildColorFilterList(); } catch(_){} }, 50);
      } catch (_) {}
    }
  });

  // If a template was already loaded from storage, show the color UI and build list
    setTimeout(() => {
    try {
      if (templateManager.templatesArray?.length > 0) {
        const colorUI = document.querySelector('#bm-contain-colorfilter');
        if (colorUI) { colorUI.style.display = ''; }
  // Unhide any top3/minimize icon buttons now that templates exist
    try { document.querySelectorAll('.bm-top3-icon, #bm-button-colors-top3, #bm-button-colors-top3').forEach(b => b.style.display = 'flex'); } catch(_){ }
          // Runtime fix: ensure minimize/maximize toggle is visible across canonical and minified selectors
          try {
            // Inject a runtime style that forces visibility for known button selectors
            if (!document.getElementById('bm-runtime-fixes')) {
              const fix = document.createElement('style');
              fix.id = 'bm-runtime-fixes';
              fix.textContent = `
  /* Force show minimize/maximize buttons (canonical + minified selectors) */
  .bm-1k, #bm-U, #bm-1y, .bm-top3-icon, #bm-button-colors-top3, #bm-V,
  #bm-k #bm-W, #bm-k #bm-q, #bm-k #bm-Y {
    display: flex !important;
    visibility: visible !important;
    align-items: center !important;
    justify-content: center !important;
  }

  /* Equalize action buttons inside the header/container */
  #bm-k button, #bm-k .bm-action-btn, .bm-top3-icon, #bm-button-coords, #bm-button-colors-lock, #bm-button-colors-top3,
  #bm-k #bm-W button, #bm-k #bm-q button, #bm-k #bm-Y button {
    width: 36px !important;
    height: 36px !important;
    min-width: 36px !important;
    padding: 4px !important;
    box-sizing: border-box !important;
    display: inline-flex !important;
    align-items: center !important;
    justify-content: center !important;
  }

  /* Make overlay/modal wider so coords inputs fit */
  #bm-A, #bm-k, .bm-overlay, #bm-overlay {
    max-width: 520px !important;
    width: 100% !important;
  }

  /* Coordinate inputs: cap width and prevent overflow */
  #bm-v, #bm-w, #bm-x, #bm-y,
  #bm-input-tx, #bm-input-ty, #bm-input-px, #bm-input-py {
    max-width: 140px !important;
    width: 140px !important;
    box-sizing: border-box !important;
    overflow: hidden !important;
    white-space: nowrap !important;
    text-overflow: ellipsis !important;
  }

  /* Neutralize host accent/background on header buttons inside #bm-6 */
  #bm-6 button, #bm-6 .material-symbols-rounded, #bm-6 .btn {
    background: transparent !important;
    background-image: none !important;
    background-color: transparent !important;
    border: 0 !important;
    border-color: transparent !important;
    box-shadow: none !important;
    -webkit-box-shadow: none !important;
    outline: none !important;
    filter: none !important;
    color: inherit !important;
  }
  #bm-6 button::before, #bm-6 button::after, #bm-6 .material-symbols-rounded::before, #bm-6 .material-symbols-rounded::after {
    content: none !important;
    background: transparent !important;
    box-shadow: none !important;
    border: 0 !important;
    height: 0 !important;
    width: 0 !important;
  }

  /* Prevent the header buttons/containers from stretching */
  #bm-k > div, #bm-k .bm-group, #bm-contain-coords {
    display: flex !important;
    gap: 6px !important;
    align-items: center !important;
    flex-wrap: nowrap !important;
  }

  /* Reduce spacing only between the three small header buttons (minified and canonical ids)
     Bring bm-W, bm-q, bm-Y slightly closer without affecting other groups */
  #bm-k #bm-W, #bm-k #bm-q, #bm-k #bm-Y,
  html body #bm-W, html body #bm-q, html body #bm-Y {
    margin-right: 2px !important; /* small pull-in */
  }
  /* Remove extra right margin on the last of the three to avoid layout shift */
  #bm-k #bm-Y, html body #bm-Y {
    margin-right: 0px !important;
  }

  /* Ensure material symbol icons render at a stable size */
  .material-symbols-rounded {
    font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24 !important;
    font-size: 20px !important;
    line-height: 1 !important;
  }

  /* Hide empty container inside the color list (canonical + minified selectors) */
  #bm-9 > div:empty, #bm-1z > div:empty {
    display: none !important;
    visibility: hidden !important;
  }
  `;
              document.head?.appendChild(fix);
            }
            // Enforce inline styles as a robust fallback: reapply directly on elements
            try {
              const enforceInlineStyles = () => {
                try {
                  const btnSelectors = ['#bm-W', '#bm-q', '#bm-Y', '.bm-top3-icon', '#bm-button-colors-top3', '#bm-button-coords', '#bm-button-colors-lock'];
                  btnSelectors.forEach(sel => {
                    document.querySelectorAll(sel).forEach(el => {
                      try {
                        el.style.setProperty('display', 'flex', 'important');
                        el.style.setProperty('visibility', 'visible', 'important');
                        el.style.setProperty('width', '36px', 'important');
                        el.style.setProperty('height', '36px', 'important');
                        el.style.setProperty('min-width', '36px', 'important');
                        el.style.setProperty('padding', '4px', 'important');
                        el.style.setProperty('box-sizing', 'border-box', 'important');
                        el.style.setProperty('align-items', 'center', 'important');
                        el.style.setProperty('justify-content', 'center', 'important');
                      } catch (_) {}
                    });
                  });

                  const inputSelectors = ['#bm-v', '#bm-w', '#bm-x', '#bm-y', '#bm-input-tx', '#bm-input-ty', '#bm-input-px', '#bm-input-py'];
                  inputSelectors.forEach(sel => {
                    document.querySelectorAll(sel).forEach(inp => {
                      try {
                        inp.style.setProperty('max-width', '140px', 'important');
                        inp.style.setProperty('width', '140px', 'important');
                        inp.style.setProperty('box-sizing', 'border-box', 'important');
                        inp.style.setProperty('overflow', 'hidden', 'important');
                      } catch (_) {}
                    });
                  });

                  const container = document.querySelector('#bm-k') || document.querySelector('#bm-1Q') || document.querySelector('#bm-k');
                  if (container) {
                    try {
                      container.style.setProperty('display', 'flex', 'important');
                      container.style.setProperty('gap', '6px', 'important');
                      container.style.setProperty('align-items', 'center', 'important');
                      container.style.setProperty('flex-wrap', 'nowrap', 'important');
                    } catch (_) {}
                  }
                } catch (_) {}
              };

              // Run immediately and re-run on short-lived mutations (pages may alter DOM after us)
              try { enforceInlineStyles(); } catch(_) {}
              const mo = new MutationObserver(() => { try { enforceInlineStyles(); } catch(_) {} });
              mo.observe(document.body, { childList: true, subtree: true });
              // Stop observing after 4 seconds to avoid long-lived overhead
              setTimeout(() => { try { mo.disconnect(); } catch(_) {} }, 4000);
            } catch (_) {}
            // Also programmatically set inline styles as a fallback for elements that may be toggled by JS
            document.querySelectorAll('.bm-1k, #bm-U, #bm-1y, .bm-top3-icon, #bm-button-colors-top3, #bm-V').forEach(b => {
              try { b.style.display = 'flex'; b.style.visibility = 'visible'; } catch(_){}
            });

          // Runtime enforcement: clear any accent/background on known header icon buttons
          try {
            setTimeout(() => {
              ['#bm-m', '#bm-S', '#bm-button-convert', '#bm-button-toggle-output'].forEach(sel => {
                try {
                  const el = document.querySelector(sel);
                  if (!el) return;
                  el.style.setProperty('background', 'transparent', 'important');
                  el.style.setProperty('background-color', 'transparent', 'important');
                  el.style.setProperty('border', '0', 'important');
                  el.style.setProperty('box-shadow', 'none', 'important');
                  el.style.setProperty('outline', 'none', 'important');
                } catch(_){}
              });
            }, 40);
          } catch(_){}

          // Strong runtime enforcer: reapplies inline styles and watches for DOM/style changes
          (function enforceNoAccentButtonsRuntime(){
            const selectors = ['#bm-m', '#bm-S', '#bm-button-convert', '#bm-button-toggle-output'];
            function applyAll() {
              try {
                selectors.forEach(sel => {
                  try {
                    const el = document.querySelector(sel);
                    if (!el) return;
                    // aggressive inline styles
                    el.style.setProperty('background', 'transparent', 'important');
                    el.style.setProperty('background-color', 'transparent', 'important');
                    el.style.setProperty('background-image', 'none', 'important');
                    el.style.setProperty('border', '0 solid transparent', 'important');
                    el.style.setProperty('border-color', 'transparent', 'important');
                    el.style.setProperty('box-shadow', 'none', 'important');
                    el.style.setProperty('-webkit-box-shadow', 'none', 'important');
                    el.style.setProperty('outline', 'none', 'important');
                    el.style.setProperty('filter', 'none', 'important');
                    el.style.setProperty('padding', el.style.padding || '4px', 'important');
                    // inner icon
                    const icon = el.querySelector && el.querySelector('.material-symbols-rounded');
                    if (icon) {
                      try { icon.style.setProperty('background', 'transparent', 'important'); } catch(_) {}
                      try { icon.style.setProperty('box-shadow', 'none', 'important'); } catch(_) {}
                      try { icon.style.setProperty('color', 'inherit', 'important'); } catch(_) {}
                    }
                  } catch(_){}
                });
              } catch(_){}
            }

            // Initial apply and periodic reapply for a short period
            try { applyAll(); } catch(_){}
            let reapplies = 0;
            const reapInt = setInterval(() => { try { applyAll(); reapplies++; if (reapplies > 60) clearInterval(reapInt); } catch(_){} }, 200);

            // Observe DOM for attribute/style changes that might reintroduce accents
            try {
              const mo = new MutationObserver(muts => { try { applyAll(); } catch(_){} });
              mo.observe(document.body, { attributes: true, subtree: true, childList: true, attributeFilter: ['class','style'] });
              // stop observer after 20s to avoid perf cost
              setTimeout(() => { try { mo.disconnect(); } catch(_){} }, 20000);
            } catch(_){}
          })();

          // Inject a high-specificity stylesheet targeting buttons inside #bm-6 (and their pseudo-elements)
          (function injectNoAccentStyles(){
            try {
              const id = 'bm-no-accent-buttons-style';
              if (document.getElementById(id)) return;
              const css = `
                /* Target buttons inside the header div #bm-6 explicitly */
                #bm-6 #bm-m,
                #bm-6 #bm-S,
                #bm-6 #bm-button-convert,
                #bm-6 #bm-button-toggle-output {
                  background: transparent !important;
                  background-image: none !important;
                  background-color: transparent !important;
                  border: 0 !important;
                  border-color: transparent !important;
                  box-shadow: none !important;
                  -webkit-box-shadow: none !important;
                  outline: none !important;
                  filter: none !important;
                }
                /* Also neutralize pseudo-elements which host sites sometimes use to draw accents */
                #bm-6 #bm-m::before,
                #bm-6 #bm-m::after,
                #bm-6 #bm-S::before,
                #bm-6 #bm-S::after,
                #bm-6 #bm-button-convert::before,
                #bm-6 #bm-button-convert::after,
                #bm-6 #bm-button-toggle-output::before,
                #bm-6 #bm-button-toggle-output::after {
                  background: transparent !important;
                  background-image: none !important;
                  box-shadow: none !important;
                  border: 0 !important;
                  outline: none !important;
                  content: none !important;
                  height: 0 !important;
                  width: 0 !important;
                }
              `;
              const style = document.createElement('style');
              style.id = id;
              style.textContent = css;
              (document.head || document.documentElement).appendChild(style);
            } catch(_){}
          })();

            // Ensure #bm-W specifically is visible and matches the size of the convert button (#bm-m)
            try {
              const src = document.querySelector('#bm-button-convert') || document.querySelector('#bm-m') || document.querySelector('.bm-D[title="Template Color Converter"]') || document.querySelector('.bm-D');
              let size = { width: '40px', height: '40px', padding: '6px', minWidth: '40px', boxSizing: 'border-box' };
              if (src) {
                try {
                  const cs = getComputedStyle(src);
                  size = {
                    width: cs.width || '40px',
                    height: cs.height || '40px',
                    padding: cs.padding || '6px',
                    minWidth: cs.minWidth || cs.width || '40px',
                    boxSizing: cs.boxSizing || 'border-box'
                  };
                } catch (_) {}
              }
              document.querySelectorAll('#bm-W').forEach(el => {
                try {
                  el.style.setProperty('display', 'flex', 'important');
                  el.style.setProperty('visibility', 'visible', 'important');
                  el.style.setProperty('width', size.width, 'important');
                  el.style.setProperty('height', size.height, 'important');
                  el.style.setProperty('min-width', size.minWidth, 'important');
                  el.style.setProperty('padding', size.padding, 'important');
                  el.style.setProperty('box-sizing', size.boxSizing, 'important');
                  el.style.setProperty('align-items', 'center', 'important');
                  el.style.setProperty('justify-content', 'center', 'important');
                } catch (_) {}
              });
            } catch (_) {}
          } catch(_){}

          buildColorFilterList();
    try { window.buildTemplatePresetList(); } catch (_) {}
      }
    } catch (_) {}
  }, 0);

    // --------- Lock painting logic: allow painting only on selected template colors when locked ---------
    (function(){
  // Debug flag: set `window._bm_debugLock = true` in the page console to enable detailed logs
  try { if (typeof window._bm_debugLock === 'undefined') window._bm_debugLock = false; } catch(_){}
      let spaceDown = false;
      // Throttle cache to avoid repeated expensive getImageData calls during pointermove
      let _bm_lastCheck = { t: 0, x: -9999, y: -9999, res: true };
      window.addEventListener('keydown', (e) => { if (e.code === 'Space') spaceDown = true; }, true);
      window.addEventListener('keyup', (e) => { if (e.code === 'Space') spaceDown = false; }, true);

      // short-term cache for selected colors to avoid expensive DOM reads on high-frequency events
      let _bm_selectedCache = { t: 0, vals: [] };
      function getSelectedRGBs() {
        const now = Date.now();
        if (now - _bm_selectedCache.t < 150 && _bm_selectedCache.vals && _bm_selectedCache.vals.length) return _bm_selectedCache.vals.slice();
        const list = document.querySelectorAll('#bm-colorfilter-list input[type="checkbox"]');
        const selected = [];
        list.forEach(cb => { try { if (cb.checked && cb.dataset && cb.dataset.rgb) selected.push(cb.dataset.rgb); } catch(_){} });
        // If UI checkboxes haven't been built yet (startup delay), fallback to in-memory or persisted palette
        if (!selected.length) {
          try {
            const activeKey = document.querySelector('#bm-active-template')?.value || document.querySelector('#bm-presets-select')?.value;
            // Prefer runtime Template instance palette if available
            let t = null;
            if (templateManager && Array.isArray(templateManager.templatesArray) && templateManager.templatesArray.length > 0) {
              t = templateManager.templatesArray.find(tm => tm.storageKey === activeKey) || templateManager.templatesArray[0];
            }
            if (t && t.colorPalette) {
              for (const [rgb, meta] of Object.entries(t.colorPalette)) {
                try { if (!meta || typeof meta.enabled === 'undefined' || meta.enabled) selected.push(rgb); } catch(_){}
              }
            } else if (templateManager && templateManager.templatesJSON && templateManager.templatesJSON.templates && activeKey && templateManager.templatesJSON.templates[activeKey]) {
              const persisted = templateManager.templatesJSON.templates[activeKey];
              const pal = persisted.palette || {};
              for (const rgb of Object.keys(pal)) {
                try { const meta = pal[rgb]; if (!meta || typeof meta.enabled === 'undefined' || meta.enabled) selected.push(rgb); } catch(_){}
              }
            }
          } catch(_){}
        }
  _bm_selectedCache.t = Date.now();
  _bm_selectedCache.vals = selected.slice();
  _bm_selectedCache.t = Date.now();
  _bm_selectedCache.vals = selected.slice();
  try { if (window._bm_debugLock) console.debug('BM_DEBUG selectedRGBs', selected.slice()); } catch(_){}
  return selected;
      }

      function pointIsAllowedOnCanvas(evt) {
        const selected = getSelectedRGBs();
  try { if (window._bm_debugLock) console.debug('BM_DEBUG pointIsAllowedOnCanvas enter', {x: evt.clientX, y: evt.clientY, selected}); } catch(_){}
        if (!selected || !selected.length) return true; // no lock semantics if none selected
        try {
          // throttle: if recently checked nearby coordinates, reuse result
          const now = Date.now();
          const px = Math.round(evt.clientX);
          const py = Math.round(evt.clientY);
          const dt = now - (_bm_lastCheck.t || 0);
          const dist = Math.hypot(px - _bm_lastCheck.x, py - _bm_lastCheck.y);
          // Only reuse cached *positive* results. Do not reuse cached negatives because
          // a single blocked sample should not prevent subsequent allowed moves nearby.
          if (dt < 60 && dist < 6 && _bm_lastCheck.res === true) {
            try { if (window._bm_debugLock) console.debug('BM_DEBUG cache reuse positive', _bm_lastCheck); } catch(_){}
            return true;
          }
        } catch (e) { /* ignore throttle errors */ }
        // Strict mode: sample template canvas only. If template canvas missing or pixel transparent => BLOCK.
        try {
          const tcanvas = templateManager.getCanvas();
          if (!tcanvas) {
            // Template overlay not ready: block painting under strict lock
            _bm_lastCheck = { t: Date.now(), x: Math.round(evt.clientX), y: Math.round(evt.clientY), res: false };
            return false;
          }
          const rectT = tcanvas.getBoundingClientRect();
          const scaleT = tcanvas.width / rectT.width;
          const tx = Math.floor((evt.clientX - rectT.left) * scaleT);
          const ty = Math.floor((evt.clientY - rectT.top) * scaleT);
          const tctx = tcanvas.getContext('2d');
          if (!tctx) {
            _bm_lastCheck = { t: Date.now(), x: Math.round(evt.clientX), y: Math.round(evt.clientY), res: false };
            return false;
          }
          try {
            const dm = Number(templateManager.drawMult) || 3;
            const offset = 1;
            const sx = Math.max(0, Math.floor((tx - offset) / dm) * dm + offset);
            const sy = Math.max(0, Math.floor((ty - offset) / dm) * dm + offset);
            const td = tctx.getImageData(sx, sy, 1, 1).data;
            const alpha = td[3];
            if (alpha < 64) {
              // Template transparent at this point -> block
              _bm_lastCheck = { t: Date.now(), x: Math.round(evt.clientX), y: Math.round(evt.clientY), res: false };
              return false;
            }
            const trgb = `${td[0]},${td[1]},${td[2]}`;
            // Determine template palette keys for 'other' logic
            let paletteKeys = [];
            try {
              const activeKey = document.querySelector('#bm-active-template')?.value || document.querySelector('#bm-presets-select')?.value;
              let tObj = null;
              if (templateManager && Array.isArray(templateManager.templatesArray) && templateManager.templatesArray.length > 0) {
                tObj = templateManager.templatesArray.find(tm => tm.storageKey === activeKey) || templateManager.templatesArray[0];
              }
              if (tObj && tObj.colorPalette) paletteKeys = Object.keys(tObj.colorPalette || {});
            } catch(_){}
            const inSelected = selected.includes(trgb);
            const isOtherAllowed = selected.includes('other') && !paletteKeys.includes(trgb);
            const allowed = inSelected || isOtherAllowed;
            _bm_lastCheck = { t: Date.now(), x: Math.round(evt.clientX), y: Math.round(evt.clientY), res: !!allowed };
            try { if (window._bm_debugLock) console.debug('BM_DEBUG sampled', {tx,ty,sx,sy,trgb,alpha,allowed,selected,paletteKeys}); } catch(_){}
            return !!allowed;
          } catch (e) {
            // If getImageData fails for security or readiness reasons, block
            _bm_lastCheck = { t: Date.now(), x: Math.round(evt.clientX), y: Math.round(evt.clientY), res: false };
            return false;
          }
        } catch (e) {
          _bm_lastCheck = { t: Date.now(), x: Math.round(evt.clientX), y: Math.round(evt.clientY), res: false };
          try { if (window._bm_debugLock) console.debug('BM_DEBUG sample error', e); } catch(_){}
          return false;
        }
      }

      function interceptCanvasEvents(canvas) {
        if (!canvas) return;
        // Stroke-scoped handlers: compute permission on pointerdown and reuse during move to avoid heavy per-event sampling
        let _bm_strokeAllowed = null;
        let _bm_activePointerId = null;

        const findLockedButton = () => {
          try {
            const lockSelectors = ['#bm-button-colors-lock', '#bm-_', '.bm-lock-icon'];
            const lockBtns = Array.from(document.querySelectorAll(lockSelectors.join(','))).filter(Boolean);
            return lockBtns.find(b => b && b.dataset && b.dataset.locked === '1');
          } catch(_) { return null; }
        };

        const onPointerDown = function(evt) {
          try {
            const lockBtn = findLockedButton();
            if (!lockBtn) return; // not locked
            if (!spaceDown) return; // only enforce when painting via space
            _bm_activePointerId = (evt.pointerId !== undefined) ? evt.pointerId : null;
            // decide once for this stroke
            const allowed = pointIsAllowedOnCanvas(evt);
            try { if (window._bm_debugLock) console.debug('BM_DEBUG pointerdown', {id: evt.pointerId, x: evt.clientX, y: evt.clientY, allowed}); } catch(_){}
            _bm_strokeAllowed = !!allowed;
            if (!allowed) {
              evt.stopImmediatePropagation(); evt.preventDefault();
              try { overlayMain.handleDisplayStatus('Blocked paint: not a selected template color'); } catch(_){}
              return false;
            }
          } catch(_){}
        };

        const onPointerMove = function(evt) {
          try {
            const lockBtn = findLockedButton();
            if (!lockBtn) return; // not locked
            if (!spaceDown) return;
            // If pointerId was set from a previous pointerdown, ensure we honor same pointer
            if (_bm_activePointerId !== null && evt.pointerId !== undefined && evt.pointerId !== _bm_activePointerId) return;
            // Decide per-move, using pointIsAllowedOnCanvas which has its own short-term cache (_bm_lastCheck)
            const allowed = pointIsAllowedOnCanvas(evt);
            try { if (window._bm_debugLock) console.debug('BM_DEBUG pointermove', {id: evt.pointerId, x: evt.clientX, y: evt.clientY, allowed}); } catch(_){}
            if (!allowed) {
              evt.stopImmediatePropagation(); evt.preventDefault();
              try { overlayMain.handleDisplayStatus('Blocked paint: not a selected template color'); } catch(_){}
              return false;
            }
            // allowed -> do nothing and let page handlers run
          } catch(_){}
        };

        const onPointerUp = function(evt) {
          try { _bm_strokeAllowed = null; _bm_activePointerId = null; } catch(_){}
        };

        // Use capture to intercept before page handlers
        canvas.addEventListener('pointerdown', onPointerDown, true);
        canvas.addEventListener('pointermove', onPointerMove, true);
        canvas.addEventListener('pointerup', onPointerUp, true);
        canvas.addEventListener('pointercancel', onPointerUp, true);
        // legacy mouse events fallback
        canvas.addEventListener('mousedown', onPointerDown, true);
        canvas.addEventListener('mousemove', onPointerMove, true);
        canvas.addEventListener('mouseup', onPointerUp, true);
      }

      // Attach to existing canvas and observe for new canvases
      // Debounced attach to avoid rapid repeated observer callbacks
      let _bm_attachDebounce = null;
      let _bm_canvasAttached = false;
      function attachToCanvasWhenReady() {
        if (_bm_canvasAttached) return; // already attached
        try {
          const canvas = document.querySelector('div#map canvas.maplibregl-canvas') || document.querySelector('canvas.maplibregl-canvas') || document.querySelector('canvas');
          if (canvas) {
            interceptCanvasEvents(canvas);
            _bm_canvasAttached = true;
            // disconnect observer once attached
            try { if (mo) mo.disconnect(); } catch(_){}
            return;
          }
        } catch(_){}
      }
      attachToCanvasWhenReady();
      const mo = new MutationObserver(() => {
        clearTimeout(_bm_attachDebounce);
        _bm_attachDebounce = setTimeout(() => { try { attachToCanvasWhenReady(); } catch(_){} }, 150);
      });
      mo.observe(document.body, { childList: true, subtree: true });
    })();
}

// Modal for editing template coordinates
function createTemplateEditModal() {
  // If modal already exists, return
  if (document.querySelector('#bm-modal-template-edit')) { return; }
  const modal = document.createElement('div');
  modal.id = 'bm-modal-template-edit';
  modal.style.display = 'none';
  modal.className = 'bm-modal';

  const content = document.createElement('div');
  content.className = 'bm-modal-content';

  const header = document.createElement('h3');
  header.textContent = 'Editar posición de plantilla';
  content.appendChild(header);

  const form = document.createElement('div');
  form.className = 'bm-modal-form';

  ['Tl X','Tl Y','Px X','Px Y'].forEach((label, idx) => {
    const row = document.createElement('div'); row.style.display = 'flex'; row.style.gap = '6px'; row.style.marginBottom = '6px';
    const lab = document.createElement('label'); lab.textContent = label; lab.style.width = '60px';
    const input = document.createElement('input'); input.type = 'number'; input.id = `bm-modal-input-${idx}`; input.style.flex = '1';
    row.appendChild(lab); row.appendChild(input); form.appendChild(row);
  });

  const btnRow = document.createElement('div'); btnRow.style.display = 'flex'; btnRow.style.gap = '8px'; btnRow.style.marginTop = '8px';
  const btnSave = document.createElement('button'); btnSave.className = 'btn btn-soft'; btnSave.textContent = 'Guardar';
  const btnCancel = document.createElement('button'); btnCancel.className = 'btn btn-soft'; btnCancel.textContent = 'Cancelar';
  btnRow.appendChild(btnSave); btnRow.appendChild(btnCancel);

  content.appendChild(form); content.appendChild(btnRow); modal.appendChild(content); document.body.appendChild(modal);

  let activeStorageKey = null;

  btnCancel.addEventListener('click', () => { modal.style.display = 'none'; activeStorageKey = null; });
  btnSave.addEventListener('click', () => {
    try {
      const vals = [0,1,2,3].map(i => Number(document.querySelector(`#bm-modal-input-${i}`).value || 0));
      if (vals.some(v => isNaN(v))) { alert('Coordenadas inválidas'); return; }
      if (activeStorageKey && templateManager.templatesJSON?.templates && templateManager.templatesJSON.templates[activeStorageKey]) {
        templateManager.templatesJSON.templates[activeStorageKey].coords = vals.join(',');
        GM.setValue('bmTemplates', JSON.stringify(templateManager.templatesJSON));
        window.postMessage({ source: 'blue-marble', bmEvent: 'bm-rebuild-template-list' }, '*');
        overlayMain.handleDisplayStatus(`Coords actualizadas: ${vals.join(',')}`);
      }
    } catch (e) { overlayMain.handleDisplayError('Error guardando coordenadas'); }
    modal.style.display = 'none'; activeStorageKey = null;
  });

  // Expose open function
  window.openEditTemplateModal = function(storageKey) {
    createTemplateEditModal();
    activeStorageKey = storageKey;
    const t = templateManager.templatesJSON?.templates?.[storageKey];
    const coords = (t?.coords || '').split(',').map(s => Number(s) || 0);
    for (let i = 0; i < 4; i++) { document.querySelector(`#bm-modal-input-${i}`).value = coords[i] || 0; }
    modal.style.display = 'flex';
  }
}

// Ensure modal exists on startup
setTimeout(() => { try { createTemplateEditModal(); } catch (_) {} }, 200);

  // Helper: Build template presets list (multiple templates)
  window.buildTemplatePresetList = function buildTemplatePresetList() {
    // Support both source id (#bm-presets-list) and legacy/minified id (#bm-1r).
    let listContainer = document.querySelector('#bm-presets-list') || document.querySelector('#bm-1r');
    if (!listContainer) {
      // Try to create the container under a known parent if possible (#bm-g is the color list wrapper).
      const parent = document.querySelector('#bm-g') || document.querySelector('#bm-9') || document.querySelector('#bm-P');
      if (parent) {
        listContainer = document.createElement('div');
        listContainer.id = 'bm-presets-list';
        listContainer.style.marginTop = '12px';
        // create visible by default and use important to override host CSS
        listContainer.style.setProperty('display', 'block', 'important');
        listContainer.style.maxHeight = '220px';
        listContainer.style.overflow = 'auto';
        parent.appendChild(listContainer);
      } else {
        return;
      }
    }
    listContainer.innerHTML = '';
    const templates = templateManager.templatesArray || [];
    // Diagnostic: log when builder runs
    try { console.log('BM: buildTemplatePresetList called', { templates: (templates||[]).length, containerId: listContainer.id, computedDisplay: getComputedStyle(listContainer).display }); } catch(_){}
    // If we have templates, ensure the container is visible (fix: sometimes it remains display:none)
    if (templates.length) {
      try { listContainer.style.setProperty('display', 'block', 'important'); } catch(_){ try { listContainer.style.display = ''; } catch(_){} }
    }
    if (!templates.length) {
      try { listContainer.style.setProperty('display', 'none', 'important'); } catch(_) { listContainer.style.display = 'none'; }
      // update counter (both new and legacy indicator ids)
      const indicator = document.querySelector('#bm-templates-indicator');
      const legacy = document.querySelector('#bm-V');
      const txt = `Plantillas: 0 (0 activas)`;
      try { if (indicator) { indicator.textContent = txt; } } catch(_){ }
      try { if (legacy) { legacy.textContent = txt; } } catch(_){ }
      return;
    }

    // Sync persisted `selected` flags into runtime templates but do NOT auto-select a template.
    // Users should be able to view all templates; selection remains optional and is used
    // only when the user explicitly selects a template (e.g., to populate color filters).
    try {
      const persisted = templateManager.templatesJSON?.templates || {};
      templates.forEach(t => {
        try {
          if (persisted[t.storageKey] && typeof persisted[t.storageKey].selected !== 'undefined') {
            t.selected = !!persisted[t.storageKey].selected;
          }
        } catch(_) {}
      });
      // Do not force any template to be selected by default.
    } catch(_) {}
    // After syncing persisted selected flags, if there is a persisted selected template
    // expose it via the canonical active input so the color list can default to it.
    try {
      const activeKeyInput = document.querySelector('#bm-active-template');
      const persistedTemplates = templateManager.templatesJSON?.templates || {};
      const selectedKey = Object.keys(persistedTemplates).find(k => persistedTemplates[k] && persistedTemplates[k].selected);
      if (selectedKey && activeKeyInput) {
        try { activeKeyInput.value = selectedKey; } catch(_){}
        try { const cf = document.querySelector('#bm-contain-colorfilter'); if (cf) cf.style.display = ''; } catch(_){}
        try { if (typeof buildColorFilterList === 'function') buildColorFilterList(); } catch(_){}
      }
    } catch(_) {}

  const list = document.createElement('div');
  list.id = 'bm-presets-expanded';
  list.style.display = 'flex';
  list.style.flexDirection = 'column';
  list.style.gap = '6px';
  list.style.marginTop = '6px';
  listContainer.appendChild(list);

    // Global template actions: activate all / deactivate all
    const actionsRow = document.createElement('div');
    actionsRow.style.display = 'flex';
    actionsRow.style.gap = '6px';
    actionsRow.style.marginTop = '8px';

    const btnEnableAll = document.createElement('button');
    btnEnableAll.className = 'btn btn-soft';
    btnEnableAll.textContent = 'Activar todas';
    try {
      // make the two action buttons share the row equally
      btnEnableAll.style.setProperty('display','inline-flex','important');
      btnEnableAll.style.setProperty('flex','1 1 0','important');
      btnEnableAll.style.setProperty('min-width','0','important');
      btnEnableAll.style.setProperty('box-sizing','border-box','important');
      btnEnableAll.style.setProperty('padding','6px 12px','important');
      btnEnableAll.style.setProperty('font-size','12px','important');
      btnEnableAll.style.setProperty('height','40px','important');
      btnEnableAll.style.removeProperty('width');
      btnEnableAll.style.removeProperty('max-width');
    } catch(_){}
    btnEnableAll.addEventListener('click', () => {
      templates.forEach(t => { t.enabled = true; try { if (templateManager.templatesJSON?.templates && t.storageKey) { templateManager.templatesJSON.templates[t.storageKey].enabled = true; } } catch(_){} });
      try { GM.setValue('bmTemplates', JSON.stringify(templateManager.templatesJSON)); } catch(_){ }
      // Notify UI to rebuild template lists and redraw
      window.postMessage({ source: 'blue-marble', bmEvent: 'bm-rebuild-template-list' }, '*');
      overlayMain.handleDisplayStatus('Activadas todas las plantillas');
    });

    const btnDisableAll = document.createElement('button');
    btnDisableAll.className = 'btn btn-soft';
    btnDisableAll.textContent = 'Desactivar todas';
    try {
      // make the two action buttons share the row equally
      btnDisableAll.style.setProperty('display','inline-flex','important');
      btnDisableAll.style.setProperty('flex','1 1 0','important');
      btnDisableAll.style.setProperty('min-width','0','important');
      btnDisableAll.style.setProperty('box-sizing','border-box','important');
      btnDisableAll.style.setProperty('padding','6px 12px','important');
      btnDisableAll.style.setProperty('font-size','12px','important');
      btnDisableAll.style.setProperty('height','40px','important');
      btnDisableAll.style.removeProperty('width');
      btnDisableAll.style.removeProperty('max-width');
    } catch(_){}
    btnDisableAll.addEventListener('click', () => {
      try {
        // Find active template
        const activeKey = document.querySelector('#bm-active-template')?.value;
        const templates = templateManager.templatesArray || [];
        let active = null;
        if (activeKey) active = templates.find(x => x && x.storageKey === activeKey) || null;
        if (!active) active = templates.find(x => x && x.selected) || null;
        if (!active) {
          const persisted = templateManager.templatesJSON?.templates || {};
          const selKey = Object.keys(persisted).find(k => persisted[k] && persisted[k].selected);
          if (selKey) active = templates.find(x => x && x.storageKey === selKey) || null;
        }
        if (!active) { overlayMain.handleDisplayError('No hay plantilla seleccionada'); return; }

        // Disable all colors only for the active template
        if (active.colorPalette) {
          Object.values(active.colorPalette).forEach(c => { if (c) c.enabled = false; });
          try {
            if (templateManager.templatesJSON?.templates && active.storageKey) {
              templateManager.templatesJSON.templates[active.storageKey] = templateManager.templatesJSON.templates[active.storageKey] || {};
              templateManager.templatesJSON.templates[active.storageKey].palette = active.colorPalette;
              GM.setValue('bmTemplates', JSON.stringify(templateManager.templatesJSON));
            }
          } catch(_){}
        } else {
          try {
            if (templateManager.templatesJSON?.templates && active.storageKey && templateManager.templatesJSON.templates[active.storageKey]?.palette) {
              Object.values(templateManager.templatesJSON.templates[active.storageKey].palette).forEach(c => { if (c) c.enabled = false; });
              GM.setValue('bmTemplates', JSON.stringify(templateManager.templatesJSON));
            }
          } catch(_){}
        }

        try { buildColorFilterList(); } catch(_){}
        overlayMain.handleDisplayStatus('Colores desactivados (plantilla seleccionada)');
        console.log('BM: disable-all applied to active template', active?.storageKey || '(unknown)');
      } catch (e) { console.error('BM disable-all error', e); }
    });

    actionsRow.appendChild(btnEnableAll);
    actionsRow.appendChild(btnDisableAll);
    listContainer.appendChild(actionsRow);

  // Build per-template rows inside expanded list
  templates.forEach(t => {
      // If persisted JSON has an enabled flag, sync it to the runtime instance
      try {
        const stored = templateManager.templatesJSON?.templates?.[t.storageKey];
        if (stored && typeof stored.enabled !== 'undefined') {
          t.enabled = !!stored.enabled;
        }
      } catch (_) {}
      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.style.justifyContent = 'space-between';
      row.style.gap = '8px';
      row.style.marginTop = '6px';

  const left = document.createElement('div');
  left.style.display = 'flex';
  left.style.alignItems = 'center';
  left.style.gap = '8px';
  left.style.flex = '1 1 0';
  left.style.minWidth = '0';

      const toggle = document.createElement('input');
      toggle.type = 'checkbox';
      toggle.checked = !!t.enabled;
      toggle.addEventListener('change', () => {
        t.enabled = toggle.checked;
        // persist to templatesJSON and notify other UI pieces
        try {
          if (templateManager.templatesJSON?.templates && t.storageKey) {
            templateManager.templatesJSON.templates[t.storageKey].enabled = !!t.enabled;
            GM.setValue('bmTemplates', JSON.stringify(templateManager.templatesJSON));
            // Notify color list and template list consumers to rebuild
            window.postMessage({ source: 'blue-marble', bmEvent: 'bm-rebuild-color-list' }, '*');
            window.postMessage({ source: 'blue-marble', bmEvent: 'bm-rebuild-template-list' }, '*');
          }
        } catch (_) {}
        overlayMain.handleDisplayStatus(`${toggle.checked ? 'Enabled' : 'Disabled'} ${t.displayName}`);
      });

  const label = document.createElement('span');
  label.style.fontSize = '12px';
  // ensure label truncates instead of pushing layout
  label.style.flex = '1 1 0';
  label.style.minWidth = '0';
  label.style.overflow = 'hidden';
  label.style.textOverflow = 'ellipsis';
  label.style.whiteSpace = 'nowrap';
  label.textContent = t.displayName || t.storageKey;

      left.appendChild(toggle);
      left.appendChild(label);

  row.appendChild(left);

  // Right container holds action buttons (select + delete) and is content-sized
  const right = document.createElement('div');
  right.style.display = 'flex';
  right.style.gap = '6px';
  right.style.alignItems = 'center';
  right.style.flex = '0 0 auto';

  // Add a 'Seleccionar' button to choose this template (persist single selection)
  const selectBtn = document.createElement('button');
  selectBtn.className = 'btn btn-soft bm-select-icon';
  // Use material symbol icon instead of text
  selectBtn.innerHTML = '<span class="material-symbols-rounded">radio_button_unchecked</span>';
  // Make the select button compact
  // size/styling moved to CSS (.bm-select-icon)
  try {
    selectBtn.style.setProperty('display','inline-flex','important');
    selectBtn.style.setProperty('flex','0 0 auto','important');
    selectBtn.style.setProperty('width','auto','important');
    selectBtn.style.setProperty('max-width','40px','important');
    selectBtn.style.setProperty('min-width','34px','important');
    selectBtn.style.setProperty('height','30px','important');
    selectBtn.style.setProperty('padding','4px','important');
    selectBtn.style.setProperty('margin','0','important');
    selectBtn.style.setProperty('box-sizing','border-box','important');
  } catch(_){}
      selectBtn.addEventListener('click', () => {
        try {
          const isAlreadySelected = !!(t.selected || (templateManager.templatesJSON?.templates?.[t.storageKey] && templateManager.templatesJSON.templates[t.storageKey].selected));
          if (isAlreadySelected) {
            // If clicked while already selected, keep selection but ensure color list is visible
            try { const colorUI = document.querySelector('#bm-contain-colorfilter'); if (colorUI) colorUI.style.display = ''; } catch(_){}
            try { if (typeof buildColorFilterList === 'function') buildColorFilterList(); } catch(_){}
            return; // do not deselect — one must always be selected
          }

          // Select this template (clear others)
          Object.values(templateManager.templatesJSON?.templates || {}).forEach(p => { if (p) p.selected = false; });
          if (t.storageKey && templateManager.templatesJSON?.templates && templateManager.templatesJSON.templates[t.storageKey]) {
            templateManager.templatesJSON.templates[t.storageKey].selected = true;
            GM.setValue('bmTemplates', JSON.stringify(templateManager.templatesJSON));
          }
          (templateManager.templatesArray || []).forEach(x => x.selected = (x.storageKey === t.storageKey));

          // Ensure active input and color UI update
          try { const activeInput = document.querySelector('#bm-active-template'); if (activeInput) activeInput.value = t.storageKey; } catch(_){}
          try { const colorUI = document.querySelector('#bm-contain-colorfilter'); if (colorUI) colorUI.style.display = ''; } catch(_){}
          try { if (typeof buildColorFilterList === 'function') buildColorFilterList(); } catch(_){}

          // Visual updates: set radio icons and highlight this
          try {
            const allBtns = document.querySelectorAll('#bm-presets-list .bm-select-icon');
            allBtns.forEach(b => {
              try {
                const icon = b.querySelector('.material-symbols-rounded');
                if (icon) {
                  icon.textContent = 'radio_button_unchecked';
                  try { icon.style.setProperty('color', '', 'important'); } catch(_){}
                }
                // clear visual selection using inline important to override page styles
                try { b.style.setProperty('background', 'transparent', 'important'); } catch(_){}
                try { b.style.removeProperty('box-shadow'); } catch(_){}
              } catch(_){}
            });
            const icon = selectBtn.querySelector('.material-symbols-rounded');
            if (icon) {
              icon.textContent = 'radio_button_checked';
              try { icon.style.setProperty('color', '#0078d7', 'important'); } catch(_){}
            }
            try { selectBtn.style.setProperty('background', 'rgba(0,120,215,0.14)', 'important'); } catch(_){}
            try { selectBtn.style.setProperty('box-shadow', 'inset 0 0 0 1px rgba(0,0,0,0.08)', 'important'); } catch(_){}
          } catch(_){ }

          try { window.postMessage({ source: 'blue-marble', bmEvent: 'bm-rebuild-template-list' }, '*'); } catch(_){}
        } catch (_) {}
      });
      // Visual hint if already selected
      if (t.selected || (templateManager.templatesJSON?.templates?.[t.storageKey] && templateManager.templatesJSON.templates[t.storageKey].selected)) {
        try { selectBtn.style.setProperty('background', 'rgba(0,120,215,0.14)', 'important'); } catch(_){}
        try { selectBtn.style.setProperty('box-shadow', 'inset 0 0 0 1px rgba(0,0,0,0.08)', 'important'); } catch(_){}
        try { const icon = selectBtn.querySelector('.material-symbols-rounded'); if (icon) { icon.textContent = 'radio_button_checked'; icon.style.setProperty('color', '#0078d7', 'important'); } } catch(_){}
      }

  // Only a single delete icon is shown per template row (no 'Ocultar' / 'Abrir' buttons)
  const del = document.createElement('button');
  // Use soft button style so size matches the select button and host CSS doesn't force a large danger button
  del.className = 'btn btn-soft bm-preset-delete';
  del.title = 'Eliminar plantilla';
  del.innerHTML = '<span class="material-symbols-rounded">delete</span>';
  // Match visual size of select button
  // size/styling moved to CSS (.bm-preset-delete)
  try {
    del.style.setProperty('display','inline-flex','important');
    del.style.setProperty('flex','0 0 auto','important');
    del.style.setProperty('width','auto','important');
    del.style.setProperty('max-width','40px','important');
    del.style.setProperty('min-width','34px','important');
    del.style.setProperty('height','30px','important');
    del.style.setProperty('padding','4px','important');
    del.style.setProperty('margin','0','important');
    del.style.setProperty('box-sizing','border-box','important');
  } catch(_){}

  right.appendChild(selectBtn);
  right.appendChild(del);

  row.appendChild(right);
      del.addEventListener('click', async () => {
        if (!confirm(`Eliminar plantilla "${t.displayName || t.storageKey}"? Esta acción no se puede deshacer.`)) { return; }
        try {
          await templateManager.deleteTemplate(t.storageKey);
          overlayMain.handleDisplayStatus(`Plantilla eliminada: ${t.displayName}`);
        } catch (e) { overlayMain.handleDisplayError('Error eliminando plantilla'); }
      });

  // del is already appended into the 'right' container; do not append twice.

      listContainer.appendChild(row);
    });
    // Update template counter after building the list
    try {
      // Compute totals robustly: prefer runtime array but fallback to persisted JSON when
      // runtime templates may not be fully initialized yet.
      const persisted = templateManager.templatesJSON?.templates || {};
      const total = (templates && templates.length) || Object.keys(persisted).length || 0;
      const active = (templates && templates.filter(x => x && x.enabled !== false).length) || Object.values(persisted).filter(t => t && t.enabled !== false).length || 0;
      const txt = `Plantillas: ${total} (${active} activas)`;
      try { const indicator = document.querySelector('#bm-templates-indicator'); if (indicator) indicator.textContent = txt; } catch(_){ }
      try { const legacy = document.querySelector('#bm-V'); if (legacy) legacy.textContent = txt; } catch(_){ }
    } catch (_) {}
  };

  // Listen for template list rebuild event
  window.addEventListener('message', (event) => {
    if (event?.data?.bmEvent === 'bm-rebuild-template-list') {
      try { window.buildTemplatePresetList(); } catch (_) {}
    }
  });

function buildTelemetryOverlay(overlay) {
  overlay.addDiv({'id': 'bm-overlay-telemetry', style: 'top: 0px; left: 0px; width: 100vw; max-width: 100vw; height: 100vh; max-height: 100vh; z-index: 9999;'})
    .addDiv({'id': 'bm-contain-all-telemetry', style: 'display: flex; flex-direction: column; align-items: center;'})
      .addDiv({'id': 'bm-contain-header-telemetry', style: 'margin-top: 10%;'})
  .addHeader(1, {'textContent': `${name} Telemetría`}).buildElement()
      .buildElement()

      .addDiv({'id': 'bm-contain-telemetry', style: 'max-width: 50%; overflow-y: auto; max-height: 80vh;'})
        .addHr().buildElement()
        .addBr().buildElement()
        .addDiv({'style': 'width: fit-content; margin: auto; text-align: center;'})
  .addButton({'id': 'bm-button-telemetry-more', 'textContent': 'Más información'}, (instance, button) => {
          button.onclick = () => {
            window.open('https://github.com/Jaie55/Wplace-TelemetryServer#telemetry-data', '_blank', 'noopener noreferrer');
          }
        }).buildElement()
        .buildElement()
        .addBr().buildElement()
        .addDiv({style: 'width: fit-content; margin: auto; text-align: center;'})
          .addButton({'id': 'bm-button-telemetry-enable', 'textContent': 'Activar telemetría', 'style': 'margin-right: 2ch;'}, (instance, button) => {
            button.onclick = () => {
              const userSettings = JSON.parse(GM_getValue('bmUserSettings', '{}'));
              userSettings.telemetry = 1;
              GM.setValue('bmUserSettings', JSON.stringify(userSettings));
              const element = document.getElementById('bm-overlay-telemetry');
              if (element) {
                element.style.display = 'none';
              }
            }
          }).buildElement()
          .addButton({'id': 'bm-button-telemetry-disable', 'textContent': 'Desactivar telemetría'}, (instance, button) => {
            button.onclick = () => {
              const userSettings = JSON.parse(GM_getValue('bmUserSettings', '{}'));
              userSettings.telemetry = 0;
              GM.setValue('bmUserSettings', JSON.stringify(userSettings));
              const element = document.getElementById('bm-overlay-telemetry');
              if (element) {
                element.style.display = 'none';
              }
            }
          }).buildElement()
        .buildElement()
        .addBr().buildElement()
  .addP({'textContent': 'Recopilamos datos de telemetría anónimos como tu navegador, sistema operativo y versión del script para mejorar la experiencia. Los datos no se comparten a nivel personal ni se venden. Puedes desactivar esto pulsando el botón "Desactivar telemetría". Gracias por apoyar Black Marble.'}).buildElement()
        .addP({'textContent': 'Puedes desactivar la telemetría pulsando el botón "Desactivar telemetría" abajo.'}).buildElement()
      .buildElement()
    .buildElement()
  .buildOverlay(document.body);
}

function buildOverlayTabTemplate() {
  overlayTabTemplate.addDiv({'id': 'bm-tab-template', 'style': 'top: 20%; left: 10%;'})
      .addDiv()
        .addDiv({'className': 'bm-dragbar'}).buildElement()
        .addButton({'className': 'bm-button-minimize', 'textContent': '↑'},
          (instance, button) => {
            button.onclick = () => {
              let isMinimized = false;
              if (button.textContent == '↑') {
                button.textContent = '↓';
              } else {
                button.textContent = '↑';
                isMinimized = true;
              }

              
            }
          }
        ).buildElement()
      .buildElement()
    .buildElement()
  .buildOverlay();
}

// (duplicate bottom block removed — initial declarations and setup are at the top of the file)
