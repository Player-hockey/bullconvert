'use strict';

/* =====================================================================
   BullConvert — дополнительные функции:
   редактор фото (обрезка, поворот, размер, сжатие до N КБ, удаление фона),
   обрезка аудио/видео, «Поделиться», история конвертаций, упаковка в ZIP.
   Использует функции app.js: loadImage, imageSource, canvasToBlob, download …
   ===================================================================== */

/* -------------------------- Удаление фона с фото -------------------------- */

const BG_LIB = 'https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.5.8/+esm';
let bgModule = null;

async function removeBackground(blob, onStatus = () => {}, onProgress = () => {}) {
  if (!bgModule) {
    onStatus('Загрузка нейросети для удаления фона (один раз, ≈40 МБ)…');
    try { bgModule = await import(BG_LIB); }
    catch { throw new Error('Не удалось загрузить модуль удаления фона. Проверьте интернет.'); }
  }
  return bgModule.removeBackground(blob, {
    model: 'isnet_quint8',
    output: { format: 'image/png' },
    progress: (key, cur, total) => {
      if (key.startsWith('fetch')) { onStatus(`Загрузка нейросети: ${Math.round(cur / total * 100)}%`); onProgress(cur / total * 0.7); }
      else { onStatus('Удаляю фон…'); onProgress(0.7 + (cur / total) * 0.3); }
    },
  });
}

/* ------------------------------ Редактор фото ------------------------------ */

const IE = {}; // состояние редактора

async function openImageEditor(item) {
  const dlg = $('imgDlg');
  $('imgTitle').textContent = item.file.name;
  $('imgInfo').textContent = 'Загрузка…';
  dlg.showModal();
  try {
    const src = item.editedImage ? item.editedImage : await imageSource(item.file, canon(item.ext));
    const { img, url } = await loadImage(src);
    Object.assign(IE, { item, img, url, rot: 0, flip: false, crop: null });
    $('imgW').value = '';
    $('imgKB').value = item.maxKB || '';
    drawImageEditor();
  } catch (e) { $('imgInfo').textContent = e.message; }
}

/** Холст с поворотом/отражением (без обрезки) — в полном разрешении */
function ieTransformed() {
  const { img, rot, flip } = IE;
  const w = img.naturalWidth, h = img.naturalHeight;
  const c = document.createElement('canvas');
  const side = rot % 180 !== 0;
  c.width = side ? h : w; c.height = side ? w : h;
  const ctx = c.getContext('2d');
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate(rot * Math.PI / 180);
  if (flip) ctx.scale(-1, 1);
  ctx.drawImage(img, -w / 2, -h / 2);
  return c;
}

function drawImageEditor() {
  const full = ieTransformed();
  IE.full = full;
  const stage = $('imgStage');
  const maxW = Math.min(stage.parentElement.clientWidth - 8, 900), maxH = Math.max(240, window.innerHeight - 330);
  const k = Math.min(1, maxW / full.width, maxH / full.height);
  const c = $('imgCanvas');
  c.width = Math.round(full.width * k); c.height = Math.round(full.height * k);
  c.getContext('2d').drawImage(full, 0, 0, c.width, c.height);
  stage.style.width = c.width + 'px'; stage.style.height = c.height + 'px';
  showCrop();
  updateImgInfo();
}

function showCrop() {
  const el = $('imgCrop');
  const r = IE.crop;
  el.hidden = !r;
  if (!r) return;
  Object.assign(el.style, { left: r.x * 100 + '%', top: r.y * 100 + '%', width: r.w * 100 + '%', height: r.h * 100 + '%' });
}

function updateImgInfo() {
  const f = IE.full;
  const r = IE.crop || { w: 1, h: 1 };
  let w = Math.round(f.width * r.w), h = Math.round(f.height * r.h);
  const tw = parseInt($('imgW').value, 10);
  if (tw > 0 && tw < w) { h = Math.round(h * tw / w); w = tw; }
  $('imgInfo').textContent = `Итог: ${w} × ${h} px${IE.bgRemoved ? ' · фон удалён' : ''}`;
}

// выделение области обрезки мышью или пальцем
(function bindCrop() {
  const stage = $('imgStage');
  let start = null;
  const rel = (e) => { const r = stage.getBoundingClientRect(); return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) }; };
  stage.onpointerdown = (e) => { start = rel(e); IE.crop = null; showCrop(); stage.setPointerCapture(e.pointerId); e.preventDefault(); };
  stage.onpointermove = (e) => {
    if (!start) return;
    const p = rel(e);
    IE.crop = { x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), w: Math.abs(p.x - start.x), h: Math.abs(p.y - start.y) };
    showCrop();
  };
  stage.onpointerup = () => {
    start = null;
    if (IE.crop && (IE.crop.w < 0.02 || IE.crop.h < 0.02)) IE.crop = null;
    showCrop(); updateImgInfo();
  };
})();

$('imgRotL').onclick = () => { IE.rot = (IE.rot + 270) % 360; IE.crop = null; drawImageEditor(); };
$('imgRotR').onclick = () => { IE.rot = (IE.rot + 90) % 360; IE.crop = null; drawImageEditor(); };
$('imgFlip').onclick = () => { IE.flip = !IE.flip; IE.crop = null; drawImageEditor(); };
$('imgCropReset').onclick = () => { IE.crop = null; showCrop(); updateImgInfo(); };
$('imgW').oninput = updateImgInfo;

/** Итоговое изображение редактора (обрезка + размер) */
function ieResult() {
  const f = IE.full;
  const r = IE.crop || { x: 0, y: 0, w: 1, h: 1 };
  const sx = Math.round(f.width * r.x), sy = Math.round(f.height * r.y);
  let w = Math.max(1, Math.round(f.width * r.w)), h = Math.max(1, Math.round(f.height * r.h));
  const sw = w, sh = h;
  const tw = parseInt($('imgW').value, 10);
  if (tw > 0 && tw < w) { h = Math.round(h * tw / w); w = tw; }
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(f, sx, sy, sw, sh, 0, 0, w, h);
  return c;
}

$('imgBg').onclick = async () => {
  const btn = $('imgBg');
  btn.disabled = true;
  try {
    const blob = await removeBackground(await canvasToBlob(ieResult(), 'image/png'), (s) => { $('imgInfo').textContent = s; });
    URL.revokeObjectURL(IE.url);
    const { img, url } = await loadImage(blob);
    Object.assign(IE, { img, url, rot: 0, flip: false, crop: null, bgRemoved: true });
    $('imgW').value = '';
    drawImageEditor();
  } catch (e) { $('imgInfo').textContent = e.message; }
  finally { btn.disabled = false; }
};

$('imgSave').onclick = async () => {
  const item = IE.item;
  item.editedImage = await canvasToBlob(ieResult(), 'image/png');
  const kb = parseInt($('imgKB').value, 10);
  item.maxKB = kb > 0 ? kb : null;
  item.status = 'idle'; item.result = null;
  $('imgDlg').close();
  refreshRow(item); updateToolbar();
};

$('imgReset').onclick = () => {
  const item = IE.item;
  delete item.editedImage;
  item.maxKB = null;
  item.status = 'idle'; item.result = null;
  $('imgDlg').close();
  refreshRow(item); updateToolbar();
};

$('imgDlg').addEventListener('close', () => { if (IE.url) URL.revokeObjectURL(IE.url); IE.url = null; });

/* --------------------------- Обрезка аудио и видео --------------------------- */

function fmtTime(sec) {
  if (sec == null || !isFinite(sec)) return '';
  const m = Math.floor(sec / 60), s = sec - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${(Math.round(s * 10) / 10).toString().replace(/\.0$/, '')}`;
}

function parseTime(text) {
  const t = String(text || '').trim().replace(',', '.');
  if (!t) return null;
  const parts = t.split(':').map(Number);
  if (parts.some((n) => isNaN(n) || n < 0)) throw new Error(`Не понимаю время «${text}». Пример: 1:25 или 0:07.5`);
  return parts.reduce((a, n) => a * 60 + n, 0);
}

let trimItem = null, trimUrl = null;

function openTrim(item) {
  trimItem = item;
  const isVideo = VIDEO_EXT.includes(item.ext);
  $('mediaTitle').textContent = item.file.name;
  if (trimUrl) URL.revokeObjectURL(trimUrl);
  trimUrl = URL.createObjectURL(item.file);
  $('mediaPlayer').innerHTML = isVideo ? `<video controls playsinline src="${trimUrl}"></video>` : `<audio controls src="${trimUrl}"></audio>`;
  $('trimStart').value = item.trim ? fmtTime(item.trim.start) : '';
  $('trimEnd').value = item.trim && item.trim.end ? fmtTime(item.trim.end) : '';
  $('trimMsg').textContent = '';
  $('mediaDlg').showModal();
}

const trimPlayer = () => $('mediaPlayer').querySelector('video, audio');
$('trimSetStart').onclick = () => { const p = trimPlayer(); if (p) $('trimStart').value = fmtTime(p.currentTime); };
$('trimSetEnd').onclick = () => { const p = trimPlayer(); if (p) $('trimEnd').value = fmtTime(p.currentTime); };
$('trimSave').onclick = () => {
  try {
    const start = parseTime($('trimStart').value) || 0;
    const end = parseTime($('trimEnd').value);
    if (end != null && end <= start) throw new Error('Конец должен быть позже начала.');
    trimItem.trim = start || end != null ? { start, end } : null;
    trimItem.status = 'idle'; trimItem.result = null;
    $('mediaDlg').close();
    refreshRow(trimItem); updateToolbar();
  } catch (e) { $('trimMsg').className = 'tool-msg err'; $('trimMsg').textContent = e.message; }
};
$('trimReset').onclick = () => {
  trimItem.trim = null;
  trimItem.status = 'idle'; trimItem.result = null;
  $('mediaDlg').close();
  refreshRow(trimItem); updateToolbar();
};
$('mediaDlg').addEventListener('close', () => { const p = trimPlayer(); if (p) p.pause(); });

/* ------------------------------- Поделиться ------------------------------- */

function canShareFiles() {
  try { return !!(navigator.canShare && navigator.canShare({ files: [new File([''], 'x.txt', { type: 'text/plain' })] })); }
  catch { return false; }
}

async function shareResult(result) {
  if (!result) return;
  const file = new File([result.blob], result.name, { type: result.blob.type || 'application/octet-stream' });
  try {
    if (!navigator.canShare || !navigator.canShare({ files: [file] })) throw new Error('unsupported');
    await navigator.share({ files: [file], title: result.name });
  } catch (e) {
    if (e && e.name === 'AbortError') return; // пользователь закрыл меню
    download(result); // этот тип файла нельзя передать — просто скачиваем
  }
}

/* ---------------------------- История конвертаций ---------------------------- */

const HIST_LIMIT = 50, HIST_MAX_BYTES = 300 * 1024 * 1024, HIST_MAX_FILE = 100 * 1024 * 1024;

function histDb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('bullconvert', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('history', { keyPath: 'id', autoIncrement: true });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function histTx(mode, fn) {
  const db = await histDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('history', mode);
    const out = fn(tx.objectStore('history'));
    tx.oncomplete = () => { db.close(); resolve(out && out.result !== undefined ? out.result : out); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

async function histAll() {
  const list = await histTx('readonly', (s) => s.getAll());
  return (list || []).sort((a, b) => b.id - a.id);
}

async function addHistory(result) {
  if (!window.indexedDB || !result || result.blob.size > HIST_MAX_FILE) return;
  await histTx('readwrite', (s) => s.add({ name: result.name, size: result.blob.size, type: result.blob.type, date: Date.now(), blob: result.blob }));
  // старые записи — прочь, если превышен лимит по числу или объёму
  const all = await histAll();
  let total = 0;
  const drop = [];
  all.forEach((h, i) => { total += h.size; if (i >= HIST_LIMIT || total > HIST_MAX_BYTES) drop.push(h.id); });
  if (drop.length) await histTx('readwrite', (s) => drop.forEach((id) => s.delete(id)));
}

async function renderHistory() {
  const box = $('historyList');
  let all;
  try { all = await histAll(); } catch { box.innerHTML = '<p class="muted">История недоступна в этом режиме браузера.</p>'; return; }
  if (!all.length) { box.innerHTML = '<p class="muted">Пока пусто — здесь появятся сконвертированные файлы.</p>'; return; }
  const share = canShareFiles();
  box.innerHTML = '<ul class="hist">' + all.map((h) => `<li>
      <div class="h-info"><b>${escapeHtml(h.name)}</b><span class="muted">${formatSize(h.size)} · ${new Date(h.date).toLocaleString()}</span></div>
      <div class="h-btns"><button class="btn sm ok" data-h="dl" data-id="${h.id}">Скачать</button>
      ${share ? `<button class="btn sm" data-h="share" data-id="${h.id}">📤</button>` : ''}
      <button class="btn sm ghost" data-h="del" data-id="${h.id}" title="Удалить">✕</button></div></li>`).join('') + '</ul>';
  box.querySelectorAll('button[data-h]').forEach((b) => b.onclick = async () => {
    const h = all.find((x) => x.id === +b.dataset.id);
    if (!h) return;
    if (b.dataset.h === 'dl') download({ blob: h.blob, name: h.name });
    else if (b.dataset.h === 'share') shareResult({ blob: h.blob, name: h.name });
    else { await histTx('readwrite', (s) => s.delete(h.id)); renderHistory(); }
  });
}

$('historyBtn').onclick = () => { $('historyDlg').showModal(); renderHistory(); };
$('historyClear').onclick = async () => {
  if (!confirm('Удалить всю историю конвертаций с этого устройства?')) return;
  await histTx('readwrite', (s) => s.clear());
  renderHistory();
};

/* ------------------------- Упаковать исходные файлы в ZIP ------------------------- */

$('zipSrc').onclick = async () => {
  if (!items.length) return;
  await loadLib('jszip');
  const zip = new JSZip();
  const used = new Set();
  for (const it of items) {
    let name = it.path ? `${it.path}/${it.file.name}` : it.file.name, n = 1;
    while (used.has(name)) name = (it.path ? `${it.path}/` : '') + `${baseOf(it.file.name)} (${n++}).${extOf(it.file.name)}`;
    used.add(name);
    zip.file(name, it.file);
  }
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  download({ blob, name: 'файлы.zip' });
};
