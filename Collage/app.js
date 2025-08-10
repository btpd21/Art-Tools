// UI wiring, ribbon modes, image loading, render/export, and batch.
// Requires collage.js for generateCollage().

const $ = (id) => document.getElementById(id);
const q = (sel, el = document) => el.querySelector(sel);
const qa = (sel, el = document) => Array.from(el.querySelectorAll(sel));

const canvas = $('c');
const ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });

let photos = [];
let rngSeed = null;
let viewScale = 1;

// Ribbon state
const RIBBON_MODE_KEY = 'ribbon:mode';
const RIBBON_LOCK_KEY = 'ribbon:locked';
const PREF_CONTRAST_KEY = 'pref:high-contrast';
const PREF_MOTION_KEY = 'pref:reduced-motion';
const PREF_KEY = 'collage:prefs';

init();

function init() {
  bindRibbon();
  bindUI();
  restorePrefs();
  updateMeta();
}

function getCurrentPrefs() {
  return {
    width: +$('w').value || undefined,
    height: +$('h').value || undefined,
    negSpace: +$('negSpace').value || undefined,
    maxElem: +$('maxElem').value || undefined,
  };
}

function applyPrefs(p) {
  if (!p) return;
  if (p.width) $('w').value = p.width;
  if (p.height) $('h').value = p.height;
  if (p.negSpace != null) $('negSpace').value = p.negSpace;
  if (p.maxElem != null) $('maxElem').value = p.maxElem;
}

function savePrefs() {
  try { localStorage.setItem(PREF_KEY, JSON.stringify(getCurrentPrefs())); }
  catch (e) { console.warn('savePrefs failed', e); }
}
function restorePrefs() {
  try { applyPrefs(JSON.parse(localStorage.getItem(PREF_KEY))); }
  catch {}
}

function bindRibbon() {
  const ribbon = $('ribbon');
  const menuBtn = $('ribbonMenuBtn');
  const menu = $('ribbonMenu');
  const lockToggle = $('lockToggle');
  const lockBadge = $('ribbonLockBadge');

  // Apply persisted mode/lock
  const savedMode = localStorage.getItem(RIBBON_MODE_KEY) || 'show';
  const savedLocked = localStorage.getItem(RIBBON_LOCK_KEY) === 'true';
  ribbon.dataset.mode = savedMode;
  ribbon.dataset.locked = String(savedLocked);
  lockBadge.style.display = savedLocked ? 'inline-flex' : 'none';

  // Reflect radio states
  qa('[role="menuitemradio"]', menu).forEach(btn => {
    btn.setAttribute('aria-checked', String(btn.dataset.mode === savedMode));
    btn.addEventListener('click', () => {
      qa('[role="menuitemradio"]', menu).forEach(b => b.setAttribute('aria-checked', 'false'));
      btn.setAttribute('aria-checked', 'true');
      ribbon.dataset.mode = btn.dataset.mode;
      localStorage.setItem(RIBBON_MODE_KEY, btn.dataset.mode);
      menu.classList.remove('open');
      menuBtn.setAttribute('aria-expanded', 'false');
    });
  });

  // Lock
  lockToggle.setAttribute('aria-checked', String(savedLocked));
  lockToggle.addEventListener('click', () => {
    const now = lockToggle.getAttribute('aria-checked') !== 'true';
    lockToggle.setAttribute('aria-checked', String(now));
    ribbon.dataset.locked = String(now);
    localStorage.setItem(RIBBON_LOCK_KEY, String(now));
    lockBadge.style.display = now ? 'inline-flex' : 'none';
  });

  // Contrast/motion toggles
  const root = document.documentElement;
  const toggleContrast = $('toggleContrast');
  const toggleMotion = $('toggleMotion');

  const savedContrast = localStorage.getItem(PREF_CONTRAST_KEY) === 'true';
  const savedMotion = localStorage.getItem(PREF_MOTION_KEY) === 'true';
  if (savedContrast) root.classList.add('high-contrast');
  root.style.setProperty('--reduced-motion', savedMotion ? '1' : '0');
  toggleContrast.setAttribute('aria-checked', String(savedContrast));
  toggleMotion.setAttribute('aria-checked', String(savedMotion));

  toggleContrast.addEventListener('click', () => {
    const now = toggleContrast.getAttribute('aria-checked') !== 'true';
    toggleContrast.setAttribute('aria-checked', String(now));
    root.classList.toggle('high-contrast', now);
    localStorage.setItem(PREF_CONTRAST_KEY, String(now));
  });
  toggleMotion.addEventListener('click', () => {
    const now = toggleMotion.getAttribute('aria-checked') !== 'true';
    toggleMotion.setAttribute('aria-checked', String(now));
    root.style.setProperty('--reduced-motion', now ? '1' : '0');
    localStorage.setItem(PREF_MOTION_KEY, String(now));
  });

  // Menu open/close
  menuBtn.addEventListener('click', () => {
    const open = !menu.classList.contains('open');
    menu.classList.toggle('open', open);
    menuBtn.setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('click', (e) => {
    if (!menu.contains(e.target) && e.target !== menuBtn) {
      menu.classList.remove('open');
      menuBtn.setAttribute('aria-expanded', 'false');
    }
  });
}

function bindUI() {
  $('file').addEventListener('change', onFiles);
  qa('[data-action]').forEach(btn => btn.addEventListener('click', onAction));

  // Keyboard shortcuts
  window.addEventListener('keydown', (e) => {
    if (e.target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
    if (e.key.toLowerCase() === 'g') run(false);
    if (e.key.toLowerCase() === 's') run(true);
    if (e.key.toLowerCase() === 'e') exportPNG();
    if (e.key.toLowerCase() === 'b') batchExport(10);
  });

  // Fit and 1x
  qa('.canvas-actions .btn').forEach(b => b.addEventListener('click', (e) => {
    const a = e.currentTarget.dataset.action;
    if (a === 'fit') fitCanvas();
    if (a === '1x') setCanvasZoom(1);
  }));

  // Prevent wheel zooming the whole page over canvas; add ctrl/cmd + wheel to zoom
  q('.canvas-wrap').addEventListener('wheel', (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const delta = Math.sign(e.deltaY);
    const factor = delta > 0 ? 1 / 1.1 : 1.1;
    setCanvasZoom(clamp(viewScale * factor, 0.1, 4));
  }, { passive: false });
}

async function onFiles(e) {
  const files = Array.from(e.target.files || []);
  photos = await Promise.all(files.map(loadImage));
  renderThumbs(files);
  renderStatus(`${photos.length} photos`);
}

function renderThumbs(files) {
  const wrap = $('images');
  wrap.innerHTML = '';
  files.forEach((f, i) => {
    const d = document.createElement('div');
    d.className = 'thumb';
    const img = document.createElement('img');
    img.src = URL.createObjectURL(f);
    img.onload = () => URL.revokeObjectURL(img.src);
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = f.name || `Photo ${i+1}`;
    d.appendChild(img);
    d.appendChild(name);
    wrap.appendChild(d);
  });
}

function onAction(e) {
  const a = e.currentTarget.dataset.action;
  if (a === 'generate') run(false);
  if (a === 'shuffle') run(true);
  if (a === 'export') exportPNG();
  if (a === 'exportJSON') exportJSON();
  if (a === 'batch') batchExport(10);
}

// Normalize clamped numeric input: accept any, clamp in code
function getNum(id, min, max, def) {
  const v = +$(id).value;
  if (!Number.isFinite(v)) return def;
  return Math.max(min, Math.min(max, v));
}

function gatherParams(shuffleSeed) {
  const W = +$('w').value, H = +$('h').value;

  const seedIn = $('seed').value ? +$('seed').value : null;
  if (shuffleSeed || seedIn === null) rngSeed = Math.floor(Math.random() * 1e9);
  else rngSeed = seedIn;

  // Normalize 0..100 sliders to meaningful quantities inside generateCollage
  const p = {
    width: W,
    height: H,
    seed: rngSeed,
    dpiLabel: $('dpiLabel').value || '',

    negativeSpacePct: getNum('negSpace', 0, 100, 35),
    maxElementPct: getNum('maxElem', 1, 30, 18),

    tiles: {
      count: getNum('tileCount', 1, 500, 90),
      specialPct: getNum('specialPct', 0, 100, 35),
      rotRangeDeg: getNum('rotRange', 0, 180, 40),
      skewRangeDeg: getNum('skewRange', 0, 60, 10),
      imgRotRangeDeg: getNum('imgRotRange', 0, 180, 15),
      diversity: getNum('diversity', 0, 100, 75),
      minSizeNorm: getNum('tileMin', 0, 100, 2),
      maxSizeNorm: getNum('tileMax', 0, 100, 12),
      allow: {
        rect: $('allowRect').checked,
        scissor: $('allowScissor').checked,
        torn: $('allowTorn').checked,
        ellipse: $('allowEllipse').checked,
        triangle: $('allowTriangle').checked,
        diamond: $('allowDiamond').checked,
        hex: $('allowHex').checked,
      },
      scissorJag: getNum('scissorJag', 0, 100, 45),
      tornRough: getNum('tornRough', 0, 100, 65),
      edgeContrast: getNum('edgeContrast', 0, 100, 35),
      irregular: getNum('irregular', 0, 100, 30),
    },

    strips: {
      count: getNum('stripCount', 0, 20, 2),
      thicknessNorm: getNum('stripThick', 0, 100, 40), // 0..100 → 0..10% of min(W,H)
      opacityPct: getNum('stripOpacity', 0, 100, 86),
      angleMin: getNum('angleMin', 0, 45, 8),
    },

    clusters: {
      count: getNum('clusterCount', 0, 12, 1),
      tilesPer: getNum('clusterTiles', 1, 30, 4),
      opacityPct: getNum('clusterOpacity', 0, 100, 88),
      minSizeNorm: getNum('clusterTileMin', 0, 100, 1.5),
      maxSizeNorm: getNum('clusterTileMax', 0, 100, 6),
      layerRnd: getNum('clusterLayerRnd', 0, 100, 60),
    },

    eggs: {
      count: getNum('eggCount', 0, 10, 0),
      maxSizePct: getNum('eggSize', 1, 40, 12),
    }
  };
  return p;
}

function run(shuffleSeed = false) {
  const p = gatherParams(shuffleSeed);
  if (!photos.length) {
    alert('Please upload photos first.');
    return;
  }
  canvas.width = p.width;
  canvas.height = p.height;

  // Improve resampling quality
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  ctx.clearRect(0,0,canvas.width,canvas.height);

  const result = generateCollage(ctx, photos, p);
  window.__lastLayout = { ...result, params: p };

  renderStatus(`seed ${p.seed} · tiles ${result.stats.tiles} · strips ${result.stats.strips} · clusters ${result.stats.clusters}`);
  updateMeta();
  fitCanvas(); // keep canvas visible

  // persist some prefs
  savePrefs();
}

function exportPNG() {
  const label = (window.__lastLayout?.params?.dpiLabel || '').trim();
  canvas.toBlob((blob) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `collage-${Date.now()}${label ? '-' + sanitizeFilename(label) : ''}.png`;
    a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href), 2500);
  }, 'image/png');
}

function exportJSON() {
  const data = window.__lastLayout || null;
  if (!data) { alert('Generate first'); return; }
  const a = document.createElement('a');
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  a.href = URL.createObjectURL(blob);
  a.download = `collage-${Date.now()}.json`;
  a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href), 2500);
}

function batchExport(n = 10) {
  if (!photos.length) { alert('Upload photos first'); return; }
  const zipName = `collage-batch-${Date.now()}`;
  let i = 0;
  const loop = () => {
    if (i >= n) { renderStatus(`Batch complete: ${n}`); return; }
    run(true);
    canvas.toBlob((blob) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${zipName}-${String(i+1).padStart(2,'0')}.png`;
      a.click();
      setTimeout(()=>URL.revokeObjectURL(a.href), 1500);
      i++;
      setTimeout(loop, 250); // small delay to keep UI responsive
    }, 'image/png');
  };
  renderStatus(`Batch rendering ${n}…`);
  loop();
}

function renderStatus(t) { $('status').textContent = t; }

function updateMeta() {
  const p = window.__lastLayout?.params;
  const el = $('meta');
  if (!p) { el.textContent = 'No render yet.'; return; }
  const dpi = p.dpiLabel ? ` · ${p.dpiLabel}` : '';
  el.textContent = `${p.width}×${p.height}${dpi}`;
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = reject;
    img.src = url;
  });
}

function fitCanvas() {
  const wrap = q('.canvas-wrap');
  const maxW = wrap.clientWidth - 32;
  const maxH = wrap.clientHeight - 32;
  const sx = maxW / canvas.width;
  const sy = maxH / canvas.height;
  const s = Math.max(0.05, Math.min(sx, sy));
  setCanvasZoom(s);
}

function setCanvasZoom(s) {
  viewScale = s;
  canvas.style.width = `${Math.round(canvas.width * s)}px`;
  canvas.style.height = `${Math.round(canvas.height * s)}px`;
  updateMeta();
}

function sanitizeFilename(name) {
  return name.replace(/[^\w-.]+/g, '_').slice(0, 80);
}

function clamp(x, a, b){ return Math.min(b, Math.max(a, x)); }
