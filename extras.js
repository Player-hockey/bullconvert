'use strict';

/* =====================================================================
   BullConvert — дополнительные функции:
   редактор фото (обрезка, поворот, размер, сжатие до N КБ, удаление фона),
   обрезка аудио/видео, «Поделиться», история конвертаций, упаковка в ZIP.
   Использует функции app.js: loadImage, imageSource, canvasToBlob, download …
   ===================================================================== */

/* -------------------------- Удаление фона с фото -------------------------- */

const BG_LIB = 'vendor/npm/@imgly/background-removal@1.5.8/_esm.mjs';
let bgModule = null;

async function removeBackground(blob, onStatus = () => {}, onProgress = () => {}) {
  if (!bgModule) {
    onStatus('Загрузка нейросети для удаления фона (один раз, ≈40 МБ)…');
    try { bgModule = await import(new URL(BG_LIB, location.href).href); }
    catch { throw new Error('Не удалось загрузить модуль удаления фона. Обновите страницу.'); }
  }
  return bgModule.removeBackground(blob, {
    model: 'isnet_quint8',
    publicPath: new URL('vendor/imgly/', location.href).href,
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

/**
 * Фото документа → «скан»: оцениваем освещённость бумаги (светлый фон с размытием),
 * делим на неё — тени и неровный свет уходят. mode: 'bw' — чистый чёрно-белый, 'color' — выровненные цвета.
 */
function scanFilter(src, mode) {
  const w = src.width, h = src.height;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
  g.drawImage(src, 0, 0);
  const im = g.getImageData(0, 0, w, h), d = im.data;
  // уменьшенная карта яркости
  const sw = Math.max(8, Math.round(w / 24)), sh = Math.max(8, Math.round(h / 24));
  const s = document.createElement('canvas');
  s.width = sw; s.height = sh;
  const sg = s.getContext('2d', { willReadFrequently: true });
  sg.drawImage(c, 0, 0, sw, sh);
  const sd = sg.getImageData(0, 0, sw, sh).data;
  // карты фона: яркость (ч/б) или каждый цвет отдельно (тогда желтоватая бумага становится белой)
  const chans = mode === 'bw' ? [[0.299, 0.587, 0.114]] : [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const maps = chans.map(([a, b, cc]) => { const m = new Float32Array(sw * sh); for (let i = 0; i < sw * sh; i++) m[i] = sd[i * 4] * a + sd[i * 4 + 1] * b + sd[i * 4 + 2] * cc; return m; });
  // фон = максимум по окрестности (бумага светлее текста), затем сглаживание
  const pass = (src, fn, r) => {
    const out = new Float32Array(src.length);
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
      let acc = fn === 'max' ? 0 : 0, n = 0;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const xx = Math.min(sw - 1, Math.max(0, x + dx)), yy = Math.min(sh - 1, Math.max(0, y + dy));
        const v = src[yy * sw + xx];
        if (fn === 'max') acc = Math.max(acc, v); else { acc += v; n++; }
      }
      out[y * sw + x] = fn === 'max' ? acc : acc / n;
    }
    return out;
  };
  const bgMaps = maps.map((m) => pass(pass(m, 'max', 2), 'avg', 2));
  const bgAt = (x, y, L = bgMaps[0]) => {
    const fx = Math.min(sw - 1.001, Math.max(0, x / w * sw - 0.5)), fy = Math.min(sh - 1.001, Math.max(0, y / h * sh - 0.5));
    const x0 = Math.floor(fx), y0 = Math.floor(fy), ax = fx - x0, ay = fy - y0;
    const a = L[y0 * sw + x0], b = L[y0 * sw + x0 + 1], cc = L[(y0 + 1) * sw + x0], dd = L[(y0 + 1) * sw + x0 + 1];
    return Math.max(30, (a * (1 - ax) + b * ax) * (1 - ay) + (cc * (1 - ax) + dd * ax) * ay);
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    if (mode === 'bw') {
      const bg = bgAt(x, y);
      const ratio = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) / bg;
      // мягкий порог: текст чёрный, бумага белая, края букв сглажены
      const t = Math.min(1, Math.max(0, (ratio - 0.62) / 0.26));
      const v = Math.round(255 * t * t * (3 - 2 * t));
      d[i] = d[i + 1] = d[i + 2] = v;
    } else {
      for (let k = 0; k < 3; k++) {
        const v = d[i + k] / bgAt(x, y, bgMaps[k]) * 255;
        d[i + k] = Math.max(0, Math.min(255, (v - 20) * 1.1)); // немного контраста
      }
    }
  }
  g.putImageData(im, 0, 0);
  return c;
}

async function applyScanFilter(mode) {
  const btns = [$('imgScan'), $('imgLight')];
  btns.forEach((b) => (b.disabled = true));
  $('imgInfo').textContent = 'Обработка…';
  try {
    await new Promise((r) => setTimeout(r, 30)); // дать надписи обновиться
    const out = scanFilter(ieResult(), mode);
    URL.revokeObjectURL(IE.url);
    const { img, url } = await loadImage(await canvasToBlob(out, 'image/png'));
    Object.assign(IE, { img, url, rot: 0, flip: false, crop: null });
    $('imgW').value = '';
    drawImageEditor();
  } catch (e) { $('imgInfo').textContent = e.message; }
  finally { btns.forEach((b) => (b.disabled = false)); }
}
$('imgScan').onclick = () => applyScanFilter('bw');
$('imgLight').onclick = () => applyScanFilter('color');

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

const HIST_LIMIT = 100;
/** Объём истории подстраивается под свободное место браузера: до четверти квоты, но не больше 2 ГБ */
async function histLimits() {
  let bytes = 300 * 1048576;
  try { const q = (await navigator.storage.estimate()).quota; if (q) bytes = Math.max(bytes, Math.min(2048 * 1048576, q / 4)); } catch { /* нет оценки */ }
  return { total: bytes, file: bytes / 2 };
}

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
  if (!window.indexedDB || !result) return;
  const lim = await histLimits();
  if (result.blob.size > lim.file) return;
  await histTx('readwrite', (s) => s.add({ name: result.name, size: result.blob.size, type: result.blob.type, date: Date.now(), blob: result.blob }));
  // старые записи — прочь, если превышен лимит по числу или объёму
  const all = await histAll();
  let total = 0;
  const drop = [];
  all.forEach((h, i) => { total += h.size; if (i >= HIST_LIMIT || total > lim.total) drop.push(h.id); });
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

/* ------------------------------ Шаблон имени ------------------------------ */

(() => {
  const el = $('nameTpl');
  if (!el) return;
  try { el.value = localStorage.getItem('bcNameTpl') || ''; } catch { /* приватный режим */ }
  el.oninput = () => { try { localStorage.setItem('bcNameTpl', el.value.trim()); } catch { /* приватный режим */ } };
})();

/* ------------------------------ Перевод документов ------------------------------ */

/**
 * Перевод текста документа встроенным переводчиком браузера (Chrome на компьютере, без отправки текста в интернет).
 * Русский ↔ английский; другие языки — на русский. Оформление (заголовки, таблицы, жирный) сохраняется.
 * Результат хранится как «изменённый текст» — дальше его можно сохранить в любом формате.
 */
async function translateItem(item) {
  const say = (t) => { item.el.meta.textContent = t; };
  if (!('Translator' in self)) {
    say('⚠ Этот браузер не умеет переводить сам. Нужен Google Chrome 138+ на компьютере (перевод идёт на устройстве, без интернета).');
    return;
  }
  // уже переведено — вернуть оригинал
  if (item.translated) {
    item.editedHtml = item.htmlBeforeTranslate ?? null;
    if (item.editedHtml == null) delete item.editedHtml;
    delete item.translated; delete item.htmlBeforeTranslate;
    item.status = 'idle'; item.result = null;
    refreshRow(item); updateToolbar();
    return;
  }
  item.status = 'work';
  item.workText = 'Перевод: подготовка…';
  refreshRow(item);
  setProgress(item, null);
  try {
    const html = item.editedHtml ?? await docToHtml(item.file, item.ext, (p) => setProgress(item, p * 0.2), (s) => say(s));
    const root = document.createElement('div');
    root.innerHTML = html;
    // язык: детектор браузера, иначе по доле кириллицы
    const sample = root.textContent.slice(0, 2000);
    let src = /[а-яё]/i.test(sample) && (sample.match(/[а-яё]/gi) || []).length > (sample.match(/[a-z]/gi) || []).length ? 'ru' : 'en';
    // ожидание с пределом: встроенные модели браузера могут долго скачиваться
    const limit = (pr, ms, msg) => Promise.race([pr, new Promise((_, rej) => setTimeout(() => rej(new Error(msg)), ms))]);
    try {
      // детектор языка — только если его модель уже есть (иначе хватает простой проверки по буквам)
      if ('LanguageDetector' in self && await limit(LanguageDetector.availability(), 3000, 'timeout') === 'available') {
        const det = await limit(LanguageDetector.create(), 5000, 'timeout');
        const r = await limit(det.detect(sample), 5000, 'timeout');
        if (r && r[0] && r[0].confidence > 0.5) src = r[0].detectedLanguage;
      }
    } catch { /* детектор недоступен — оставляем простую проверку */ }
    const dst = src === 'ru' ? 'en' : 'ru';
    const avail = await limit(Translator.availability({ sourceLanguage: src, targetLanguage: dst }), 10000, 'Переводчик браузера не отвечает — перевод работает в Google Chrome 138+ на компьютере.');
    if (avail === 'unavailable') throw new Error(`Перевод ${src} → ${dst} недоступен в этом браузере.`);
    if (avail !== 'available') say('Загрузка словаря для перевода (один раз)…');
    // словарь скачивается один раз; если загрузка не пошла за 30 с — сообщаем, а не ждём бесконечно
    let started = avail === 'available';
    const tr = await limit(Translator.create({
      sourceLanguage: src, targetLanguage: dst,
      monitor(m) { m.addEventListener('downloadprogress', (e) => { started = true; say(`Загрузка словаря: ${Math.round(e.loaded * 100)}%`); setProgress(item, e.loaded * 0.2); }); },
    }), 30000, 'Браузер не загрузил словарь для перевода. Нажмите «Перевести» ещё раз (нужен интернет один раз) или обновите Chrome.')
      .catch(async (e) => { if (started) return Translator.create({ sourceLanguage: src, targetLanguage: dst }); throw e; });
    // переводим по абзацам: у абзаца без внутреннего оформления — целиком (так точнее), иначе по кускам текста
    const blocks = [...root.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6, td, th, caption, figcaption, blockquote, dt, dd')]
      .filter((b) => !b.querySelector('p, li, h1, h2, h3, h4, h5, h6, td, th, table, ul, ol') && b.textContent.trim());
    let done = 0;
    for (const b of blocks) {
      const formatted = b.querySelector('b, strong, i, em, u, sup, sub, a, span, img, br, math');
      if (!formatted) b.textContent = await tr.translate(b.textContent);
      else {
        const walker = document.createTreeWalker(b, NodeFilter.SHOW_TEXT);
        const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
        for (const n of nodes) if (n.textContent.trim() && !n.parentElement.closest('math')) {
          const lead = n.textContent.match(/^\s*/)[0], tail = n.textContent.match(/\s*$/)[0];
          n.textContent = lead + await tr.translate(n.textContent.trim()) + tail;
        }
      }
      done++;
      if (done % 3 === 0) { say(`Перевод: ${done} из ${blocks.length}…`); setProgress(item, 0.2 + 0.8 * done / blocks.length); }
    }
    tr.destroy && tr.destroy();
    item.htmlBeforeTranslate = item.editedHtml ?? null;
    item.editedHtml = root.innerHTML;
    item.translated = `${src}→${dst}`;
    item.status = 'idle'; item.result = null;
  } catch (e) {
    item.status = 'error';
    item.error = 'Перевод: ' + (e && e.message ? e.message : e);
  }
  refreshRow(item); updateToolbar();
}

/* ------------------------------ Согласие с Политикой конфиденциальности ------------------------------ */

// редакция Политики: при её изменении согласие запрашивается заново
const CONSENT_VERSION = '2026-11-20.2'; // ред. 2: подсчёт посещений
function hasConsent() {
  try { const c = JSON.parse(localStorage.getItem('bcConsent') || 'null'); return !!c && c.v === CONSENT_VERSION; } catch { return false; }
}
(() => {
  const dlg = $('consentDlg');
  if (!dlg || hasConsent() || TEST_MODE) return;
  const chk = $('consentChk'), yes = $('consentYes');
  chk.onchange = () => { yes.disabled = !chk.checked; };
  // без согласия окно не закрывается (в том числе клавишей Esc)
  dlg.addEventListener('cancel', (e) => e.preventDefault());
  dlg.addEventListener('keydown', (e) => { if (e.key === 'Escape') e.preventDefault(); });
  // браузер всё же закрыл окно (Esc, жест «назад») — открываем снова, пока нет согласия
  dlg.addEventListener('close', () => { if (!hasConsent()) setTimeout(() => { if (!dlg.open) dlg.showModal(); }, 0); });
  yes.onclick = () => {
    try { localStorage.setItem('bcConsent', JSON.stringify({ v: CONSENT_VERSION, at: new Date().toISOString() })); } catch { /* приватный режим: согласие действует до закрытия вкладки */ }
    dlg.close();
    if (typeof statsStart === 'function') statsStart();
  };
  $('consentNo').onclick = () => { $('consentMsg').textContent = 'Без согласия использование BullConvert невозможно. Вы можете закрыть страницу.'; };
  dlg.showModal();
})();

/* ------------------------------ Статистика (видит только администратор) ------------------------------ */

/**
 * Подсчёт посещений и конвертаций — только после согласия с Политикой.
 * Публичный сайт: GoatCounter (без cookie, IP не сохраняется). BullConvert на компьютере владельца:
 * свой счётчик на сервере (только общие числа за день). Содержимое и имена файлов не передаются.
 */
const STATS = {
  server: !location.hostname.endsWith('github.io') && location.protocol.startsWith('http') && !['localhost', '127.0.0.1', 'bullconvert.localhost'].includes(location.hostname),
  gc: location.hostname.endsWith('github.io') && typeof SITE_CONFIG !== 'undefined' && !!SITE_CONFIG.goatcounter,
  started: false,
};
function statsStart() {
  if (STATS.started || !hasConsent() || TEST_MODE) return;
  STATS.started = true;
  if (STATS.gc) {
    const s = document.createElement('script');
    s.async = true;
    s.src = 'vendor/goatcounter/count.js';
    s.dataset.goatcounter = `https://${SITE_CONFIG.goatcounter}.goatcounter.com/count`;
    document.head.appendChild(s);
  }
  if (STATS.server) fetch('/api/stat?e=visit', { method: 'POST', keepalive: true }).catch(() => {});
}
/** Конвертация в формат target (передаётся только сам формат) */
function statsConvert(target) {
  if (!STATS.started) return;
  const t = String(target || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10);
  if (STATS.gc && window.goatcounter && window.goatcounter.count) {
    try { window.goatcounter.count({ path: `convert-${t}`, title: `Конвертация в ${t.toUpperCase()}`, event: true }); } catch { /* счётчик недоступен */ }
  }
  if (STATS.server) fetch(`/api/stat?e=convert&t=${encodeURIComponent(t)}`, { method: 'POST', keepalive: true }).catch(() => {});
}
statsStart();
