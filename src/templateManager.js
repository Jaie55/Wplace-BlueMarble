import Template from './Template';
import { base64ToUint8, numberToEncoded } from './utils';

// Clean, single-definition TemplateManager with safe Wrong computation
export default class TemplateManager {
  constructor(name, version, overlay) {
    this.name = name;
    this.version = version;
    this.overlay = overlay;
    this.templatesVersion = '1.0.0';
    this.userID = null;
    this.encodingBase = "!#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[]^_`abcdefghijklmnopqrstuvwxyz{|}~";
    this.tileSize = 1000;
    this.drawMult = 3;

    this.canvasTemplate = null;
    this.canvasTemplateID = 'bm-canvas';
    this.canvasMainID = 'div#map canvas.maplibregl-canvas';
    this.templatesArray = [];
    this.templatesJSON = null;
    this.templatesShouldBeDrawn = true;
    this.tileProgress = new Map();
  }

  getCanvas() {
    if (document.body.contains(this.canvasTemplate)) return this.canvasTemplate;
    document.getElementById(this.canvasTemplateID)?.remove();
    const canvasMain = document.querySelector(this.canvasMainID);
    if (!canvasMain) return null;
    const c = document.createElement('canvas');
    c.id = this.canvasTemplateID; c.className = 'maplibregl-canvas';
    c.style.position = 'absolute'; c.style.top = '0'; c.style.left = '0';
    c.style.height = `${canvasMain.clientHeight * (window.devicePixelRatio || 1)}px`;
    c.style.width = `${canvasMain.clientWidth * (window.devicePixelRatio || 1)}px`;
    c.height = canvasMain.clientHeight * (window.devicePixelRatio || 1);
    c.width = canvasMain.clientWidth * (window.devicePixelRatio || 1);
    c.style.zIndex = '8999'; c.style.pointerEvents = 'none';
    canvasMain.parentElement?.appendChild(c);
    this.canvasTemplate = c; return c;
  }

  async createJSON() {
    return { whoami: this.name.replace(/\s+/g, ''), scriptVersion: this.version, schemaVersion: this.templatesVersion, templates: {} };
  }

  async createTemplate(blob, name, coords) {
  // Ensure templatesJSON object and its templates map exist (defensive: handle legacy/corrupt storage)
  if (!this.templatesJSON) this.templatesJSON = await this.createJSON();
  if (!this.templatesJSON.templates || typeof this.templatesJSON.templates !== 'object') this.templatesJSON.templates = {};
    this.overlay.handleDisplayStatus(`Creando plantilla en ${coords.join(', ')}...`);
    // Compute a unique sortID to avoid collisions when templates are deleted/added.
    // Use the max existing sortID (from runtime array and persisted JSON keys) + 1.
    let newSortID = 0;
    try {
      const runtimeIds = (this.templatesArray || []).map(t => Number(t.sortID || 0)).filter(n => !Number.isNaN(n));
      const persistedIds = Object.keys(this.templatesJSON?.templates || {}).map(k => {
        const p = (k || '').toString().split(' ')[0];
        return Number(p || 0);
      }).filter(n => !Number.isNaN(n));
      const allIds = runtimeIds.concat(persistedIds);
      newSortID = allIds.length ? (Math.max(...allIds) + 1) : 0;
    } catch (_) {
      newSortID = (this.templatesArray && this.templatesArray.length) ? this.templatesArray.length : 0;
    }
    const template = new Template({ displayName: name, sortID: newSortID, authorID: numberToEncoded(this.userID || 0, this.encodingBase), file: blob, coords });
    const { templateTiles, templateTilesBuffers } = await template.createTemplateTiles(this.tileSize);
    template.chunked = templateTiles; template.storageKey = `${template.sortID} ${template.authorID}`;
    try {
      this.templatesJSON.templates[template.storageKey] = { name: template.displayName, coords: coords.join(','), enabled: true, tiles: templateTilesBuffers, palette: template.colorPalette };
    } catch (e) {
      console.warn('Failed to assign new template into templatesJSON.templates', e, this.templatesJSON);
      // Attempt to recover by recreating canonical structure and retry
      this.templatesJSON = await this.createJSON();
      this.templatesJSON.templates[template.storageKey] = { name: template.displayName, coords: coords.join(','), enabled: true, tiles: templateTilesBuffers, palette: template.colorPalette };
    }
  // ensure runtime instance defaults to enabled
  template.enabled = true;
  this.templatesArray.push(template);
    const pixelCountFormatted = new Intl.NumberFormat().format(template.pixelCount);
    this.overlay.handleDisplayStatus(`Plantilla creada en ${coords.join(', ')} — píxeles totales: ${pixelCountFormatted}`);
    try { const colorUI = document.querySelector('#bm-contain-colorfilter'); if (colorUI) colorUI.style.display = ''; window.postMessage({ source: 'blue-marble', bmEvent: 'bm-rebuild-color-list' }, '*'); } catch (_) {}
    await this.storeTemplates();
  }

  async storeTemplates() { if (typeof GM !== 'undefined' && GM.setValue) await GM.setValue('bmTemplates', JSON.stringify(this.templatesJSON)); }

  async deleteTemplate(storageKey) {
    if (!storageKey) return false;
    const idx = this.templatesArray.findIndex(t => t && t.storageKey === storageKey);
    if (idx !== -1) this.templatesArray.splice(idx, 1);
    if (this.templatesJSON && this.templatesJSON.templates && this.templatesJSON.templates[storageKey]) {
      delete this.templatesJSON.templates[storageKey];
      await this.storeTemplates();
    }
    try { window.postMessage({ source: 'blue-marble', bmEvent: 'bm-rebuild-template-list' }, '*'); } catch(_){ }
    return true;
  }
  async disableTemplate() { if (!this.templatesJSON) this.templatesJSON = await this.createJSON(); }
  setTemplatesShouldBeDrawn(v) { this.templatesShouldBeDrawn = !!v; }

  // Draw templates on tile and compute safe stats (no negative Wrong)
  async drawTemplateOnTile(tileBlob, tileCoords) {
    if (!this.templatesShouldBeDrawn) return tileBlob;
    const drawSize = this.tileSize * this.drawMult;
    const padded = tileCoords[0].toString().padStart(4, '0') + ',' + tileCoords[1].toString().padStart(4, '0');
    const templateArray = this.templatesArray.slice().sort((a,b)=> (a.sortID||0)-(b.sortID||0));
    const anyTouches = templateArray.some(t => { if (!t?.chunked) return false; if (t.tilePrefixes && t.tilePrefixes.size) return t.tilePrefixes.has(padded); return Object.keys(t.chunked||{}).some(k=>k.startsWith(padded)); });
    if (!anyTouches) return tileBlob;
    const templatesToDraw = templateArray.map(t=>{ const m = Object.keys(t.chunked||{}).find(k=>k.startsWith(padded)); if (!m) return null; const parts = m.split(','); return { template: t, bitmap: t.chunked[m], pixelCoords: [parts[2],parts[3]] }; }).filter(Boolean);
    const templateCount = templatesToDraw.length;

    let painted = 0, wrong = 0, required = 0;
    const tileBitmap = await createImageBitmap(tileBlob);
    const canvas = new OffscreenCanvas(drawSize, drawSize); const ctx = canvas.getContext('2d'); ctx.imageSmoothingEnabled = false; ctx.clearRect(0,0,drawSize,drawSize); ctx.drawImage(tileBitmap,0,0,drawSize,drawSize);
    let tilePixels = null; try { tilePixels = ctx.getImageData(0,0,drawSize,drawSize).data; } catch(_) {}

    for (const tEntry of templatesToDraw) {
      const tTemplate = tEntry.template;
      const t = { bitmap: tEntry.bitmap, pixelCoords: tEntry.pixelCoords };
      if (!tilePixels) break;
      let tc = null;
      try {
        const w = t.bitmap.width, h = t.bitmap.height; tc = new OffscreenCanvas(w,h); const tctx = tc.getContext('2d',{willReadFrequently:true}); tctx.imageSmoothingEnabled=false; tctx.clearRect(0,0,w,h); tctx.drawImage(t.bitmap,0,0);
        const offX = Number(t.pixelCoords[0])*this.drawMult; const offY = Number(t.pixelCoords[1])*this.drawMult;
        const palette = tTemplate?.colorPalette || {};
        const hasDisabled = Object.values(palette).some(v => v?.enabled === false);
        let tdata = null;
        if (hasDisabled) {
          try {
            const img = tctx.getImageData(0,0,w,h);
            const data = img.data;
            for (let y=0;y<h;y++) for (let x=0;x<w;x++) {
              if ((x % this.drawMult) !== 1 || (y % this.drawMult) !== 1) continue; const idx=(y*w+x)*4; const r=data[idx], g=data[idx+1], b=data[idx+2], a=data[idx+3]; if (a < 1) continue;
              const key = tTemplate.allowedColorsSet && tTemplate.allowedColorsSet.has(`${r},${g},${b}`) ? `${r},${g},${b}` : 'other';
              if (palette[key] && palette[key].enabled === false) {
                data[idx+3] = 0;
              }
            }
            tctx.putImageData(img, 0, 0);
            tdata = img.data;
          } catch (e) { console.warn('color filter failed', e); tdata = tctx.getImageData(0,0,w,h).data; }
        } else {
          tdata = tctx.getImageData(0,0,w,h).data;
        }
        for (let y=0;y<h;y++) for (let x=0;x<w;x++) {
          if ((x%this.drawMult)!==1 || (y%this.drawMult)!==1) continue; const gx=x+offX, gy=y+offY; if (gx<0||gy<0||gx>=drawSize||gy>=drawSize) continue;
          const ti=(y*w+x)*4; const tr=tdata[ti], tg=tdata[ti+1], tb=tdata[ti+2], ta=tdata[ti+3];
          if (ta<64) { try { const active=this.templatesArray?.[0]; const idx=(gy*drawSize+gx)*4; const pr=tilePixels[idx], pg=tilePixels[idx+1], pb=tilePixels[idx+2], pa=tilePixels[idx+3]; const key= active?.allowedColorsSet?.has(`${pr},${pg},${pb}`)?`${pr},${pg},${pb}`:'other'; const isSite = active?.allowedColorsSet? active.allowedColorsSet.has(key):false; if (pa>=64 && isSite) wrong++; } catch(_){} continue; }
          required++; const ri=(gy*drawSize+gx)*4; const rr=tilePixels[ri], rg=tilePixels[ri+1], rb=tilePixels[ri+2], ra=tilePixels[ri+3]; if (ra<64) { } else if (rr===tr && rg===tg && rb===tb) painted++; else wrong++;
        }
      } catch(e){ console.warn('stats failed',e); }
      try { 
        // If we created a temporary canvas (tc) for filtering, draw it; otherwise fall back to original bitmap
        if (typeof tc !== 'undefined' && tc) {
          ctx.drawImage(tc, Number(t.pixelCoords[0]) * this.drawMult, Number(t.pixelCoords[1]) * this.drawMult);
        } else {
          ctx.drawImage(t.bitmap, Number(t.pixelCoords[0]) * this.drawMult, Number(t.pixelCoords[1]) * this.drawMult);
        }
      } catch(e){}
    }

  const totalTemplates = (this.templatesArray || []).length;
  if (templateCount>0) {
      this.tileProgress.set(padded, { painted, required, wrong });
      let aggPainted=0, aggRequired=0, aggWrong=0; for (const s of this.tileProgress.values()) { aggPainted+=s.painted||0; aggRequired+=s.required||0; aggWrong+=s.wrong||0; }
      const totalRequiredTemplates = this.templatesArray.reduce((s,t)=> s + (t.requiredPixelCount||t.pixelCount||0), 0);
      const totalRequired = totalRequiredTemplates>0? totalRequiredTemplates: aggRequired;
      const paintedStr = new Intl.NumberFormat().format(aggPainted);
      const requiredStr = new Intl.NumberFormat().format(totalRequired);
      const missing = Math.max(0, totalRequired - aggPainted);
      const extra = Math.max(0, aggPainted - totalRequired);
      const wrongPlaced = aggWrong || 0;
      const missingStr = new Intl.NumberFormat().format(missing);
      const wrongPlacedStr = new Intl.NumberFormat().format(wrongPlaced);
      const extraStr = new Intl.NumberFormat().format(extra);
  let status = `Mostrando ${templateCount} plantilla${templateCount===1?'':'s'} (de ${totalTemplates} cargada${totalTemplates===1?'':'s'}).`;
  status += `\nPintados ${paintedStr} / ${requiredStr} • Faltan ${missingStr} • Incorrectos ${wrongPlacedStr}`;
      if (extra>0) status += ` • Extra ${extraStr}`;
      this.overlay.handleDisplayStatus(status);
  } else this.overlay.handleDisplayStatus(`Mostrando ${templateCount} plantilla${templateCount===1?'':'s'} (de ${totalTemplates} cargada${totalTemplates===1?'':'s'}).`);

    return await canvas.convertToBlob({ type: 'image/png' });
  }

  importJSON(json) {
  if (!json || (typeof json === 'object' && Object.keys(json).length === 0)) return;
    // Normalize/migrate legacy storage shapes before keeping reference. Older builds
    // used minified property names (for example 'Ot') or stored the templates map
    // at the root — detect those and rewrite into the canonical { templates: {...} }
    let normalized = json;
    try {
      // If already canonical, keep it
      if (!normalized.templates) {
        // Common minified property used in older builds: Ot
        if (normalized.Ot && typeof normalized.Ot === 'object') {
          normalized = Object.assign({}, normalized);
          normalized.templates = normalized.Ot;
        }
        // If the payload looks like the templates map itself (root keys = template keys)
        else {
          const keys = Object.keys(normalized || {});
          const looksLikeTemplates = keys.length > 0 && keys.every(k => {
            const v = normalized[k];
            return v && typeof v === 'object' && (v.tiles || v.coords || v.name || v.palette);
          });
          if (looksLikeTemplates) {
            normalized = { whoami: this.name.replace(/\s+/g,''), scriptVersion: this.version, schemaVersion: this.templatesVersion, templates: normalized };
          }
        }
      }
    } catch (e) { /* ignore normalization errors */ }
  // Keep a reference to the (possibly normalized) templates JSON so UI and persistence code can read/write flags
  try { this.templatesJSON = normalized; } catch(_) {}
  // Defensive: ensure templates map exists
  try { if (!this.templatesJSON.templates || typeof this.templatesJSON.templates !== 'object') this.templatesJSON.templates = {}; } catch(_) {}
    try {
      // Accept current schema when it contains a templates object
      if (json.templates && Object.keys(json.templates).length > 0) {
        this.parseBlueMarble(json);
        return;
      }

      // Backwards/alternate names: some builds used "BlackMarble" or other variants
      const who = (json.whoami || '').toString().toLowerCase();
      if (who.includes('blue') || who.includes('black') || who.includes('marble')) {
        this.parseBlueMarble(json);
        return;
      }

      // If the payload looks like a templates container by shape, try parsing anyway
      if (json && typeof json === 'object') {
        const maybe = Object.keys(json).some(k => k.toLowerCase().includes('templates') || k.toLowerCase().includes('tt')); 
        if (maybe) { this.parseBlueMarble(json); return; }
      }
    } catch (e) {
      console.warn('Template import/migration failed', e);
    }
  }

  async parseBlueMarble(json) {
  if (!json) return;
  // Preserve the templates JSON so runtime UI can sync enabled/selected flags
  try { this.templatesJSON = json; } catch(_) {}
  const templates = json.templates || {};
    for (const k of Object.keys(templates)) {
      try {
        const v = templates[k]; const parts = k.split(' '); const sortID = Number(parts[0])||0; const authorID = parts[1]||'0'; const displayName = v.name || `Template ${sortID||''}`;
        const tiles = v.tiles || {}; const templateTiles = {}; let requiredPixelCount = 0; const paletteMap = new Map();
        for (const tileKey of Object.keys(tiles)) {
          try { const arr = base64ToUint8(tiles[tileKey]); const blob = new Blob([arr], { type: 'image/png' }); const bmp = await createImageBitmap(blob); templateTiles[tileKey]=bmp; try { const w=bmp.width,h=bmp.height; const c=new OffscreenCanvas(w,h); const cx=c.getContext('2d',{willReadFrequently:true}); cx.imageSmoothingEnabled=false; cx.clearRect(0,0,w,h); cx.drawImage(bmp,0,0); const data=cx.getImageData(0,0,w,h).data; for (let y=0;y<h;y++) for (let x=0;x<w;x++) { if ((x%this.drawMult)!==1||(y%this.drawMult)!==1) continue; const idx=(y*w+x)*4; const r=data[idx],g=data[idx+1],b=data[idx+2],a=data[idx+3]; if (a<64) continue; if (r===222&&g===250&&b===206) continue; requiredPixelCount++; const key=`${r},${g},${b}`; paletteMap.set(key,(paletteMap.get(key)||0)+1); } } catch(e){ console.warn('count failed',e); } } catch(e){ console.warn('tile parse failed',e); }
        }
        const t = new Template({ displayName, sortID: sortID || this.templatesArray.length || 0, authorID });
        t.chunked = templateTiles;
        t.requiredPixelCount = requiredPixelCount;
        // Merge persisted enabled flags into the runtime palette so the UI shows the
        // previously-selected colors immediately (avoid showing all colors then disabling)
        const persistedPalette = this.templatesJSON?.templates?.[k]?.palette || {};
        const paletteObj = {};
        for (const [kk, cc] of paletteMap.entries()) {
          try {
            const persistedMeta = persistedPalette?.[kk];
            const enabled = (persistedMeta && typeof persistedMeta.enabled === 'boolean') ? persistedMeta.enabled : true;
            const count = (persistedMeta && typeof persistedMeta.count === 'number') ? persistedMeta.count : cc;
            paletteObj[kk] = { count: count, enabled: enabled };
          } catch (_) {
            paletteObj[kk] = { count: cc, enabled: true };
          }
        }
        t.colorPalette = paletteObj;
        t.storageKey = k;
        // templates should be enabled by default unless persisted explicitly disabled
        try {
          const persisted = this.templatesJSON && this.templatesJSON.templates && this.templatesJSON.templates[k];
          t.enabled = (persisted && typeof persisted.enabled !== 'undefined') ? !!persisted.enabled : true;
          // ensure persisted JSON has the enabled flag for future reads
          if (this.templatesJSON && this.templatesJSON.templates) this.templatesJSON.templates[k].enabled = !!t.enabled;
        } catch(_) { t.enabled = true; }
        this.templatesArray.push(t);
      } catch(e){ console.warn('template import failed',e); }
    }
    try { const colorUI = document.querySelector('#bm-contain-colorfilter'); if (colorUI) colorUI.style.display=''; window.postMessage({ source:'blue-marble', bmEvent:'bm-rebuild-color-list' }, '*'); } catch(_){ }
  try { window.postMessage({ source: 'blue-marble', bmEvent: 'bm-rebuild-template-list' }, '*'); } catch(_){}
  }

  // Placeholder for OSU import
  parseOSU() {}

  /**
   * Export a single template (by storageKey) as a compact string that can be imported elsewhere.
   * The format is a base64-encoded JSON string containing the template entry (name, coords, tiles, palette)
   * This is intentionally simple and self-contained so users can copy/paste between clients.
   * @param {string} storageKey
   * @returns {string|null} base64 string or null on error
   */
  exportTemplateAsString(storageKey) {
    try {
      if (!storageKey || !this.templatesJSON || !this.templatesJSON.templates) return null;
      const entry = this.templatesJSON.templates[storageKey];
      if (!entry) return null;
      // Build a minimal container preserving schema metadata
      const payload = { whoami: this.name.replace(/\s+/g, ''), scriptVersion: this.version, schemaVersion: this.templatesVersion, templates: {} };
      payload.templates[storageKey] = entry;
      const json = JSON.stringify(payload);
      // Encode as base64 so the string is safe to copy/paste
      try { return btoa(unescape(encodeURIComponent(json))); } catch (e) { return btoa(json); }
    } catch (e) { console.warn('exportTemplateAsString failed', e); return null; }
  }

  /**
   * Import a template from a base64 string previously produced by exportTemplateAsString.
   * Accepts either a raw JSON object, a base64 string, or a raw JSON string.
   * Returns true on success.
   */
  importTemplateFromString(str) {
    if (!str) return false;
    try {
      let obj = null;
      // If looks like base64 (only base64 chars and no whitespace), try decode
      const maybeBase64 = typeof str === 'string' && /^[A-Za-z0-9+/=\s]+$/.test(str.trim());
      if (maybeBase64) {
        try {
          const decoded = atob(str.trim());
          try { obj = JSON.parse(decodeURIComponent(escape(decoded))); } catch (_) { obj = JSON.parse(decoded); }
        } catch (e) { /* not base64 */ }
      }
      if (!obj) {
        if (typeof str === 'object') obj = str;
        else obj = JSON.parse(str);
      }
      if (!obj) return false;
      // Delegate to existing importer which normalizes/migrates shapes
      this.importJSON(obj);
      // Persist to storage after import
      try { this.storeTemplates(); } catch (_) {}
      return true;
    } catch (e) { console.warn('importTemplateFromString failed', e); return false; }
  }
}

