/** @file The main file. Everything in the userscript is executed from here.
 * @since 0.0.0
 */

import Overlay from './Overlay.js';
import Observers from './observers.js';
import ApiManager from './apiManager.js';
import TemplateManager from './templateManager.js';
import { consoleLog, consoleWarn, selectAllCoordinateInputs } from './utils.js';

const name = GM_info.script.name.toString(); // Name of userscript
const version = GM_info.script.version.toString(); // Version of userscript
const consoleStyle = 'color: cornflowerblue;'; // The styling for the console logs

/** Injects code into the client
 * This code will execute outside of TamperMonkey's sandbox
 * @param {*} callback - The code to execute
 * @since 0.11.15
 */
function inject(callback) {
  // Inject a callback into the page context and execute it as an IIFE.
  // The original build flow injects an overlay builder into the page. We implement
  // a simple injector that serializes the provided callback and runs it in-page.
  try {
    const script = document.createElement('script');
    script.setAttribute('bm-E', name);
    script.setAttribute('bm-B', consoleStyle);
    script.textContent = `(${callback})();`;
    document.documentElement?.appendChild(script);
    script.remove();
  } catch (e) {
    // Fallback: run directly if injection fails (useful for tests)
    try { callback(); } catch (_) { /* swallow */ }
  }

  // ------- Helper: Build the color filter list -------
  window.buildColorFilterList = function buildColorFilterList() {
  const listContainer = document.querySelector('#bm-colorfilter-list');
  // Determine selected template key: prefer explicit active template, then previous select
  const activeKey = document.querySelector('#bm-active-template')?.value;
  const selectedKey = activeKey || document.querySelector('#bm-presets-select')?.value;
  const t = templateManager.templatesArray?.find(tm => tm.storageKey === selectedKey) || templateManager.templatesArray?.[0];
    if (!listContainer || !t?.colorPalette) {
      if (listContainer) { listContainer.innerHTML = '<small>No template colors to display.</small>'; }
      return;
    }

    listContainer.innerHTML = '';
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

  // append a small 'Volver' button at top when list first builds
      // (we add it once before appending colors)
      if (!document.querySelector('#bm-colorfilter-list .bm-back-button')) {
        const backRow = document.createElement('div');
        backRow.style.display = 'flex';
        backRow.style.justifyContent = 'flex-end';
        backRow.style.marginBottom = '6px';
        const backBtn = document.createElement('button');
        backBtn.className = 'btn btn-soft bm-back-button';
        backBtn.textContent = 'Volver';
        backBtn.addEventListener('click', () => {
          // clear active template and rebuild template list
          const act = document.querySelector('#bm-active-template'); if (act) { act.value = ''; }
          try { window.postMessage({ source: 'blue-marble', bmEvent: 'bm-rebuild-template-list' }, '*'); } catch (_) {}
          const colorUI = document.querySelector('#bm-contain-colorfilter'); if (colorUI) { colorUI.style.display = 'none'; }
        });
        backRow.appendChild(backBtn);
        listContainer.appendChild(backRow);
      }

  const toggle = document.createElement('input');
      toggle.type = 'checkbox';
      toggle.checked = !!meta.enabled;
      toggle.addEventListener('change', () => {
        meta.enabled = toggle.checked;
        overlayMain.handleDisplayStatus(`${toggle.checked ? 'Enabled' : 'Disabled'} ${rgb}`);
        try {
          const selectedKey = document.querySelector('#bm-presets-select')?.value;
          const t = templateManager.templatesArray?.find(tm => tm.storageKey === selectedKey) || templateManager.templatesArray?.[0];
          const key = t?.storageKey;
          if (t && key && templateManager.templatesJSON?.templates?.[key]) {
            templateManager.templatesJSON.templates[key].palette = t.colorPalette;
            // persist immediately
            GM.setValue('bmTemplates', JSON.stringify(templateManager.templatesJSON));
          }
        } catch (_) {}
      });

      row.appendChild(toggle);
      row.appendChild(swatch);
      row.appendChild(label);
  listContainer.appendChild(row);
    }
  };

  // Listen for template creation/import completion to (re)build palette list
  window.addEventListener('message', (event) => {
    if (event?.data?.bmEvent === 'bm-rebuild-color-list') {
      try { buildColorFilterList(); } catch (_) {}
    }
  });

  // If a template was already loaded from storage, show the color UI and build list
  setTimeout(() => {
    try {
      if (templateManager.templatesArray?.length > 0) {
        const colorUI = document.querySelector('#bm-contain-colorfilter');
        if (colorUI) { colorUI.style.display = ''; }
        buildColorFilterList();
  try { window.buildTemplatePresetList(); } catch (_) {}
      }
    } catch (_) {}
  }, 0);
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
    const listContainer = document.querySelector('#bm-presets-list');
    if (!listContainer) { return; }
    listContainer.innerHTML = '';
    const templates = templateManager.templatesArray || [];
    if (!templates.length) {
      listContainer.style.display = 'none';
      // update counter
      const indicator = document.querySelector('#bm-templates-indicator');
      if (indicator) { indicator.textContent = `Plantillas: 0 (0 activas)`; }
      return;
    }
    listContainer.style.display = '';

  // Build expanded template list (shows all templates and controls)
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
    btnDisableAll.addEventListener('click', () => {
      templates.forEach(t => { t.enabled = false; try { if (templateManager.templatesJSON?.templates && t.storageKey) { templateManager.templatesJSON.templates[t.storageKey].enabled = false; } } catch(_){} });
      try { GM.setValue('bmTemplates', JSON.stringify(templateManager.templatesJSON)); } catch(_){ }
      // Notify UI to rebuild template lists and redraw
      window.postMessage({ source: 'blue-marble', bmEvent: 'bm-rebuild-template-list' }, '*');
      overlayMain.handleDisplayStatus('Desactivadas todas las plantillas');
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
      label.textContent = t.displayName || t.storageKey;

      left.appendChild(toggle);
      left.appendChild(label);

      row.appendChild(left);

      // Swap show/hide button
      const swap = document.createElement('button');
      swap.className = 'btn btn-soft';
      swap.textContent = t.enabled ? 'Ocultar' : 'Mostrar';
      swap.addEventListener('click', () => {
        t.enabled = !t.enabled;
        try { if (templateManager.templatesJSON?.templates && t.storageKey) { templateManager.templatesJSON.templates[t.storageKey].enabled = !!t.enabled; GM.setValue('bmTemplates', JSON.stringify(templateManager.templatesJSON)); } } catch(_){}
        swap.textContent = t.enabled ? 'Ocultar' : 'Mostrar';
        window.postMessage({ source: 'blue-marble', bmEvent: 'bm-rebuild-template-list' }, '*');
        overlayMain.handleDisplayStatus(`${t.enabled ? 'Mostrando' : 'Ocultando'} ${t.displayName}`);
      });

      row.appendChild(swap);

      // 'Abrir' button to open per-template color management
      const openBtn = document.createElement('button');
      openBtn.className = 'btn btn-soft';
      openBtn.textContent = 'Abrir';
      openBtn.addEventListener('click', () => {
        try {
          const act = document.querySelector('#bm-active-template'); if (act) { act.value = t.storageKey || ''; }
          const colorUI = document.querySelector('#bm-contain-colorfilter'); if (colorUI) { colorUI.style.display = ''; }
          try { window.postMessage({ source: 'blue-marble', bmEvent: 'bm-rebuild-color-list' }, '*'); } catch(_){}
          overlayMain.handleDisplayStatus(`Abriendo plantilla ${t.displayName}`);
        } catch (_) { overlayMain.handleDisplayError('No se pudo abrir la plantilla'); }
      });
      row.appendChild(openBtn);

      // Expandable controls (edit coords / delete)
      const controls = document.createElement('div');
      controls.style.display = 'none';
      controls.style.gap = '6px';

      const btnEdit = document.createElement('button');
      btnEdit.className = 'btn btn-soft';
      btnEdit.textContent = 'Editar posición';
      btnEdit.addEventListener('click', () => {
        try { window.openEditTemplateModal(t.storageKey); } catch (e) { alert('No se pudo abrir el editor'); }
      });

      const btnDel = document.createElement('button');
      btnDel.className = 'btn btn-danger';
      btnDel.textContent = 'Eliminar';
      btnDel.addEventListener('click', async () => {
        if (!confirm(`Eliminar plantilla "${t.displayName || t.storageKey}"? Esta acción no se puede deshacer.`)) { return; }
        try { await templateManager.deleteTemplate(t.storageKey); overlayMain.handleDisplayStatus(`Plantilla eliminada: ${t.displayName}`); } catch (e) { overlayMain.handleDisplayError('Error eliminando plantilla'); }
      });

      controls.appendChild(btnEdit);
      controls.appendChild(btnDel);

      // Toggle controls visibility when label clicked
      label.style.cursor = 'pointer';
      label.addEventListener('click', () => { controls.style.display = controls.style.display === 'none' ? 'flex' : 'none'; });

      row.appendChild(controls);

      // Delete button
      const del = document.createElement('button');
      del.className = 'btn btn-danger';
      del.textContent = 'Eliminar';
      del.addEventListener('click', async () => {
        if (!confirm(`Eliminar plantilla "${t.displayName || t.storageKey}"? Esta acción no se puede deshacer.`)) { return; }
        try {
          await templateManager.deleteTemplate(t.storageKey);
          overlayMain.handleDisplayStatus(`Plantilla eliminada: ${t.displayName}`);
        } catch (e) { overlayMain.handleDisplayError('Error eliminando plantilla'); }
      });

      row.appendChild(del);

      listContainer.appendChild(row);
    });
    // Update template counter after building the list
    try {
      const indicator = document.querySelector('#bm-templates-indicator');
      if (indicator) {
        const total = templates.length;
        const active = templates.filter(x => x && x.enabled !== false).length;
        indicator.textContent = `Plantillas: ${total} (${active} activas)`;
      }
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

// Minimal runtime initialization: create overlay, templateManager and apiManager
// This ensures the UI is actually constructed when the userscript runs.
let overlayMain;
let templateManager;
let apiManager;

function initializeMinimalUI() {
  try {
    // Create primary overlay instance
    overlayMain = new Overlay(name, version);

    // Build a small visible container so users see the UI
    overlayMain
      .addDiv({ id: 'bm-overlay', style: 'position: fixed; top: 10px; right: 10px; z-index: 99999; background: rgba(0,0,0,0.6); color: white; padding: 8px; border-radius: 6px; max-width: 320px;' })
        .addDiv({ id: 'bm-contain-header', style: 'display:flex; align-items:center; gap:8px;' })
          .addHeader(3, { textContent: name }).buildElement()
        .buildElement()
        .addDiv({ id: 'bm-contain-body', style: 'margin-top:6px; font-size:13px;' })
          .addP({ textContent: 'Black Marble UI inicializado.' }).buildElement()
        .buildElement()
      .buildElement()
    .buildOverlay(document.body);

    // Create managers and wire them
    templateManager = new TemplateManager(name, version, overlayMain);
    apiManager = new ApiManager(templateManager);
    overlayMain.setApiManager(apiManager);

    // Expose to window for any inline code expecting globals
    window.overlayMain = overlayMain;
    window.templateManager = templateManager;
    window.apiManager = apiManager;

    console.log(`${name}: Minimal UI initialized`);
  } catch (e) {
    console.error('Failed to initialize minimal UI', e);
  }
}

// Delay initialization slightly to ensure DOM is ready
setTimeout(initializeMinimalUI, 150);
