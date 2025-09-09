// Translator module: exports scan/replace utilities and a lifecycle to observe dynamic UI changes.
// This file is extracted from src/main.js to keep translation logic separate.
const REPLACEMENTS = {
  'Paint': 'Pintar',
  'Paint pixel': 'Pintar píxel',
  'Painted by:': 'Pintado por:',
  'Not painted': 'Sin pintar',
  'Move': 'Mover',
  'Favorite': 'Favorito',
  'Location favorited': 'Ubicación marcada como favorita',
  'Share': 'Compartir',
  'Share place': 'Compartir lugar',
  'Copy': 'Copiar',
  'Copied': 'Copiado',
  'Image copied to clipboard': 'Imagen copiada al portapapeles',
  'Image copied': 'Imagen copiada',
  'Download': 'Descargar',
  'Image': 'Imagen',
  'Colors': 'Colores',
  'Eraser': 'Borrador',
  'Report User': 'Denunciar usuario',
  'Select the reason:': 'Selecciona la razón:',
  'Inappropriate content': 'Contenido inapropiado',
  'Hate speech': 'Discurso de odio',
  'Doxxing': 'Divulgación de datos personales',
  'Botting': 'Uso de bots',
  'Griefing': 'Vandalismo',
  'Other': 'Otro',
  'Other reason not listed': 'Otra razón no listada',
  'Otro reason not listed': 'Otra razón no listada',
  '+18, inappropriate link, highly suggestive content, ...': '+18, enlace inapropiado, contenido altamente sugerente, ...',
  'Racism, homophobia, hate groups, ...': 'Racismo, homofobia, grupos de odio, ...',
  'Released other\'s personal information without their consent': 'Divulgó información personal de otra persona sin su consentimiento',
  'Use of software to completely automate painting': 'Uso de software para automatizar completamente el pintado',
  'Messed up artworks for no reason': 'Arruinó obras sin motivo',
  'Extra context on what happened (required)': 'Contexto adicional sobre lo ocurrido (requerido)',
  'Min. characters:': 'Mín. caracteres:',
  'Min. characters': 'Mín. caracteres',
  'Report sent successfully': 'Denuncia enviada correctamente',
  'Report sent successfully.': 'Denuncia enviada correctamente.',
  'report sent successfully': 'Denuncia enviada correctamente',
  'report sent successfully.': 'Denuncia enviada correctamente.',
  'sent successfully': 'enviado correctamente',
  'Sent successfully': 'Enviado correctamente',
  'sent successfully.': 'enviado correctamente.',
  'Cancel': 'Cancelar',
  'Report': 'Denunciar',
  'Leaderboard': 'Clasificación',
  'Regions': 'Regiones',
  'Countries': 'Países',
  'Players': 'Jugadores',
  'Player': 'Jugador',
  'Player:': 'Jugador:',
  'Players:': 'Jugadores:',
  'Alliances': 'Alianzas',
  'Alliance': 'Alianza',
  'Alliance:': 'Alianza:',
  'Today': 'Hoy',
  'Week': 'Semana',
  'Month': 'Mes',
  'All time': 'Todo el tiempo',
  'All-time': 'Todo el tiempo',
  'today': 'Hoy',
  'week': 'Semana',
  'month': 'Mes',
  'all time': 'Todo el tiempo',
  'Country': 'País',
  'Visit': 'Visitar',
  'Pixels painted': 'Píxeles pintados',
  'Pixels painted:': 'Píxeles pintados:',
  'Pixels painted inside the region': 'Píxeles pintados dentro de la región',
  'Pixels painted inside the region:': 'Píxeles pintados dentro de la región:',
  'Members': 'Miembros',
  'Members:': 'Miembros:',
  'Headquarters': 'Sede',
  'Headquarters:': 'Sede:',
  'Region': 'Región',
  'Region:': 'Región:',
};

let uiObserver = null;

const replaceTextInNode = (node) => {
  try {
    if (!node) return;
    if (node.nodeType === Node.TEXT_NODE) {
      let txt = node.textContent || '';
      const trimmed = txt.trim();
      for (const k of Object.keys(REPLACEMENTS)) {
        if (trimmed === k) {
          node.textContent = txt.replace(k, REPLACEMENTS[k]);
          return;
        }
      }
      for (const k of Object.keys(REPLACEMENTS)) {
        try {
          const re = new RegExp('\\b' + k.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&') + '\\b');
          if (re.test(txt)) {
            node.textContent = txt.replace(re, REPLACEMENTS[k]);
            return;
          }
        } catch(_){}
      }
      const low = trimmed.toLowerCase();
      for (const k of Object.keys(REPLACEMENTS)) {
        try {
          if (low === k.toLowerCase()) {
            const ciRe = new RegExp(k, 'i');
            node.textContent = txt.replace(ciRe, REPLACEMENTS[k]);
            return;
          }
        } catch(_){ }
      }
      for (const k of Object.keys(REPLACEMENTS)) {
        try {
          const re = new RegExp('\\b' + k.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&') + '\\b', 'i');
          if (re.test(txt)) {
            node.textContent = txt.replace(re, REPLACEMENTS[k]);
            return;
          }
        } catch(_){ }
      }
      return;
    }

    if (node.nodeType === Node.ELEMENT_NODE) {
      for (const child of Array.from(node.childNodes || [])) {
        if (child.nodeType === Node.TEXT_NODE) replaceTextInNode(child);
      }

      const visibleText = Array.from(node.childNodes || []).filter(n=>n.nodeType===Node.TEXT_NODE).map(n=>n.textContent||'').join('').trim();
      for (const k of Object.keys(REPLACEMENTS)) {
        if (visibleText === k) {
          const firstTextNode = Array.from(node.childNodes || []).find(n=>n.nodeType===Node.TEXT_NODE);
          if (firstTextNode) firstTextNode.textContent = firstTextNode.textContent.replace(k, REPLACEMENTS[k]);
          return;
        }
      }

      try {
        const attrs = ['placeholder','title','alt','value','data-tip','data-placeholder','label'];
        for (const a of attrs) {
          if (node.hasAttribute && node.hasAttribute(a)) {
            let v = node.getAttribute(a) || '';
            const orig = v;
            for (const k of Object.keys(REPLACEMENTS)) {
              try { if ((v || '').trim() === k) { v = REPLACEMENTS[k]; break; } } catch(_){ }
            }
            if (v === orig) {
              for (const k of Object.keys(REPLACEMENTS)) {
                try {
                  const re = new RegExp('\\b' + k.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&') + '\\b');
                  v = v.replace(re, REPLACEMENTS[k]);
                } catch(_){ }
              }
            }
            if (v !== orig) node.setAttribute(a, v);
          }
        }
        if (node.hasAttribute && node.hasAttribute('aria-label')) {
          let v = node.getAttribute('aria-label') || '';
          const orig = v;
          for (const k of Object.keys(REPLACEMENTS)) {
            try { v = v.replace(new RegExp('\\b' + k.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&') + '\\b'), REPLACEMENTS[k]); } catch(_){ }
          }
          if (v !== orig) node.setAttribute('aria-label', v);
        }

        try {
          const t = (node.tagName || '').toUpperCase();
          if (t === 'INPUT' || t === 'TEXTAREA') {
            try {
              let ph = (node.placeholder != null ? node.placeholder : (node.getAttribute && node.getAttribute('placeholder')) ) || '';
              const origPh = ph;
              for (const k of Object.keys(REPLACEMENTS)) {
                try { if ((ph || '').trim() === k) { ph = REPLACEMENTS[k]; break; } } catch(_){ }
              }
              if (ph === origPh) {
                for (const k of Object.keys(REPLACEMENTS)) {
                  try {
                    const re = new RegExp('\\b' + k.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&') + '\\b', 'i');
                    if (re.test(ph)) ph = ph.replace(re, REPLACEMENTS[k]);
                  } catch(_){ }
                }
              }
              if (ph !== origPh) {
                try { node.placeholder = ph; } catch(_){ }
                try { node.setAttribute && node.setAttribute('placeholder', ph); } catch(_){ }
              }
            } catch(_){ }

            try {
              let val = (node.value != null ? node.value : '') || '';
              const origVal = val;
              for (const k of Object.keys(REPLACEMENTS)) {
                try { if ((val || '').trim() === k) { val = REPLACEMENTS[k]; break; } } catch(_){ }
              }
              if (val === origVal) {
                for (const k of Object.keys(REPLACEMENTS)) {
                  try {
                    const re = new RegExp('\\b' + k.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&') + '\\b', 'i');
                    if (re.test(val)) val = val.replace(re, REPLACEMENTS[k]);
                  } catch(_){ }
                }
              }
              if (val !== origVal) {
                try { node.value = val; } catch(_){ }
                try { node.setAttribute && node.setAttribute('value', val); } catch(_){ }
              }
            } catch(_){ }
          }
        } catch(_){ }

        try {
          if (node.tagName && node.tagName.toUpperCase() === 'OPTION') {
            let txt = node.textContent || '';
            const orig = txt;
            for (const k of Object.keys(REPLACEMENTS)) {
              try { if ((txt||'').trim() === k) { txt = txt.replace(new RegExp(k), REPLACEMENTS[k]); break; } } catch(_){ }
            }
            if (txt === orig) {
              for (const k of Object.keys(REPLACEMENTS)) {
                try {
                  const re = new RegExp('\\b' + k.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&') + '\\b', 'i');
                  if (re.test(txt)) { txt = txt.replace(re, REPLACEMENTS[k]); break; }
                } catch(_){ }
              }
            }
            if (txt !== orig) node.textContent = txt;
          }
        } catch(_){ }
      } catch(_){ }
    }
  } catch (e) { /* swallow DOM exceptions */ }
};

const scanAndReplace = (root = document) => {
  try {
    if (!root) return;
    try { replaceTextInNode(root); } catch(_){}
    const selectors = [
      'div.flex.items-center.gap-2', 'button', 'li button', 'ul.dropdown-content button',
      'button.btn', 'button.btn.btn-primary', 'button.btn.btn-soft', 'span',
      'h1','h2','h3','h4','label','textarea','input','p','div','a'
    ];
    const nodes = new Set();
    selectors.forEach(sel => { try { Array.from(root.querySelectorAll(sel)).forEach(n => nodes.add(n)); } catch(_){} });
    try { if (root.nodeType === Node.ELEMENT_NODE) nodes.add(root); } catch(_){}
    nodes.forEach(n => {
      try { replaceTextInNode(n); } catch(_){}
      try {
        if (n.querySelectorAll) {
          for (const ch of Array.from(n.querySelectorAll('*'))) {
            try { replaceTextInNode(ch); } catch(_){}
          }
        }
      } catch(_){}
    });
  } catch (e) { /* ignore */ }
};

const startTranslator = () => {
  try { scanAndReplace(document); } catch(_){ }
  try {
    uiObserver = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.addedNodes && m.addedNodes.length) {
          for (const n of Array.from(m.addedNodes)) {
            if (n.nodeType === Node.TEXT_NODE) replaceTextInNode(n);
            else if (n.nodeType === Node.ELEMENT_NODE) scanAndReplace(n);
          }
        }
        if (m.type === 'characterData' && m.target) replaceTextInNode(m.target);
      }
    });
    try { uiObserver.observe(document.body || document.documentElement, { childList: true, subtree: true, characterData: true }); } catch(_){ }
  } catch (e) { /* defensive */ }
};

const stopTranslator = () => {
  try { if (uiObserver && typeof uiObserver.disconnect === 'function') uiObserver.disconnect(); } catch(_){}
  uiObserver = null;
};

export { replaceTextInNode, scanAndReplace, startTranslator, stopTranslator, REPLACEMENTS };
