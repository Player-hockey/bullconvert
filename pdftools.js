'use strict';

/* =====================================================================
   BullConvert — инструменты PDF (работают прямо в браузере, без сервера):
   объединение, страницы (удалить/повернуть/переставить/извлечь/разделить),
   редактор (текст, картинка/подпись, маркер), настоящее скрытие данных
   и редактирование документов перед конвертацией.
   Использует функции app.js: loadLib, getPdfJs, renderPdfPage, download …
   ===================================================================== */

async function getPdfLib() { await loadLib('pdflib'); return window.PDFLib; }

const readBytes = async (file) => new Uint8Array(await file.arrayBuffer());
const pdfBlob = (bytes) => new Blob([bytes], { type: 'application/pdf' });

async function openPdfJs(bytes) {
  const pdfjs = await getPdfJs();
  try {
    // pdf.js забирает буфер себе — отдаём копию, оригинал нужен pdf-lib
    return await pdfjs.getDocument({ data: bytes.slice(), ...PDFJS_OPTS() }).promise;
  } catch (e) {
    if (e && e.name === 'PasswordException') throw new Error('PDF защищён паролем — сначала снимите защиту.');
    throw new Error('Не удалось открыть PDF (файл повреждён?).');
  }
}

async function loadPdfLibDoc(bytes) {
  const { PDFDocument } = await getPdfLib();
  try { return await PDFDocument.load(bytes); }
  catch (e) {
    if (/encrypt/i.test(e.message)) throw new Error('PDF защищён паролем — сначала снимите защиту.');
    throw new Error('Не удалось прочитать PDF: ' + e.message);
  }
}

// Кириллический шрифт для текста в PDF: Roboto из pdfmake + fontkit
let cyrFontBytes = null;
async function embedCyrFont(pdfDoc) {
  await loadLib('fontkit');
  pdfDoc.registerFontkit(window.fontkit);
  if (!cyrFontBytes) {
    await loadLib('pdfmake');
    await loadLib('pdfmakeFonts');
    const vfs = window.pdfMake.vfs || (window.pdfMake.virtualfs && window.pdfMake.virtualfs.storage) || {};
    const b64 = vfs['Roboto-Regular.ttf'];
    if (!b64) throw new Error('Не найден шрифт для кириллицы.');
    cyrFontBytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  }
  // шрифт целиком: «урезание» (subset) в @cantoo/pdf-lib с этим fontkit падает
  return pdfDoc.embedFont(cyrFontBytes, { subset: false });
}

const dataUrlBytes = (u) => Uint8Array.from(atob(u.split(',')[1]), (c) => c.charCodeAt(0));
const hexToRgb = (hex) => {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
};

/** Картинка любого формата → PNG/JPEG для pdf-lib */
async function imageForPdf(file) {
  let src = file;
  const ext = extOf(file.name || '');
  if (ext === 'heic' || ext === 'heif') src = await imageSource(file, ext);
  const { img, url } = await loadImage(src);
  try {
    const c = document.createElement('canvas');
    c.width = img.naturalWidth || 800; c.height = img.naturalHeight || 600;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return { jpg: dataUrlBytes(c.toDataURL('image/jpeg', 0.92)), w: c.width, h: c.height };
  } finally { URL.revokeObjectURL(url); }
}

function parseRanges(text, max) {
  const groups = [];
  for (const part of text.split(/[,;]+/).map((s) => s.trim()).filter(Boolean)) {
    const m = part.match(/^(\d+)\s*(?:[-–—]\s*(\d+))?$/);
    if (!m) throw new Error(`Не понимаю «${part}». Пример: 1-3, 5, 7-9`);
    let a = +m[1], b = m[2] ? +m[2] : a;
    if (a > b) [a, b] = [b, a];
    if (a < 1 || b > max) throw new Error(`Страницы «${part}» нет: в документе ${max} стр.`);
    groups.push(Array.from({ length: b - a + 1 }, (_, i) => a + i));
  }
  if (!groups.length) throw new Error('Укажите страницы, например: 1-3, 5');
  return groups;
}

async function zipBlobs(files) {
  await loadLib('jszip');
  const zip = new JSZip();
  for (const f of files) zip.file(f.name, f.blob);
  return zip.generateAsync({ type: 'blob' });
}

/* ============================ Окно инструментов ============================ */

const T = { tab: 'merge', merge: [], pages: null, edit: null, redact: null, compress: null, stamp: null, protect: null, collage: [], form: null, compare: { a: null, b: null } };

function openTools(tab = 'merge', file = null) {
  const dlg = $('toolsDlg');
  if (!dlg.open) dlg.showModal();
  switchTab(tab);
  if (file) loadToolFile(tab, file);
}

function switchTab(tab) {
  T.tab = tab;
  document.querySelectorAll('#toolsDlg .tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  ({
    merge: renderMerge, pages: renderPages, edit: () => renderViewerTab('edit'), redact: () => renderViewerTab('redact'),
    compress: renderCompress, stamp: renderStamp, protect: renderProtect, collage: renderCollage,
    form: () => renderForm(), compare: () => renderCompare(), scan: () => renderScanTool(),
  })[tab]();
}

function toolMsg(text, kind = '') {
  const el = $('toolMsg');
  if (!el) return;
  el.className = 'tool-msg ' + kind;
  el.textContent = text;
}

function filePickerHtml(id, accept, multiple, label) {
  return `<label class="tool-pick"><input type="file" id="${id}" accept="${accept}" ${multiple ? 'multiple' : ''} hidden>
    <span class="btn primary">${label}</span><span class="muted"> или перетащите файл сюда</span></label>`;
}

function bindDrop(el, onFiles) {
  el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('over'); });
  el.addEventListener('dragleave', () => el.classList.remove('over'));
  el.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); el.classList.remove('over'); if (e.dataTransfer.files.length) onFiles([...e.dataTransfer.files]); });
}

async function loadToolFile(tab, file) {
  try {
    if (tab === 'merge') { T.merge.push(file); renderMerge(); return; }
    if (tab === 'collage') { T.collage.push(file); renderCollage(); return; }
    if (tab === 'scan') { T.scan.push(file); renderScanTool(); return; }
    const bytes = await readBytes(file);
    // эти вкладки работают с байтами PDF напрямую (в том числе с запароленными)
    if (tab === 'compress' || tab === 'stamp' || tab === 'protect' || tab === 'form') {
      T[tab] = { name: file.name, base: baseOf(file.name), bytes };
      switchTab(tab);
      return;
    }
    toolMsg('Открываю PDF…');
    const doc = await openPdfJs(bytes);
    const st = { name: file.name, base: baseOf(file.name), bytes, doc, total: doc.numPages };
    if (tab === 'pages') {
      st.items = Array.from({ length: doc.numPages }, (_, i) => ({ n: i + 1, rot: 0, sel: false }));
      T.pages = st;
      renderPages();
    } else {
      st.pageNum = 1; st.objs = []; st.marks = [];
      T[tab] = st;
      renderViewerTab(tab);
    }
    toolMsg('');
  } catch (e) { toolMsg(e.message, 'err'); }
}

/* ---------------------------- Объединить ---------------------------- */

function renderMerge() {
  const body = $('toolBody');
  const rows = T.merge.map((f, i) => `<li class="m-row" draggable="true" data-i="${i}">
      <span class="badge ${extOf(f.name) === 'pdf' ? 'doc' : mergeIsImage(f) ? 'image' : 'data'}">${escapeHtml(extOf(f.name) || '?')}</span>
      <span class="m-name">${escapeHtml(f.name)}</span><span class="muted">${formatSize(f.size)}</span>
      <span class="m-btns"><button class="btn sm" data-a="up" data-i="${i}" ${i ? '' : 'disabled'}>↑</button>
      <button class="btn sm" data-a="down" data-i="${i}" ${i < T.merge.length - 1 ? '' : 'disabled'}>↓</button>
      <button class="btn sm ghost" data-a="del" data-i="${i}">✕</button></span></li>`).join('');
  body.innerHTML = `<p class="muted">Соберите в один PDF что угодно: PDF, фото (JPG, PNG, HEIC…), Word (DOCX, DOC), Excel, презентации, тексты, книги. Каждый файл сначала переводится в PDF. Порядок меняется стрелками или перетаскиванием.</p>
    <div class="tool-drop" id="mergeDrop">${filePickerHtml('mergePick', '', true, '+ Добавить файлы')}</div>
    <ol class="m-list" id="mergeList">${rows}</ol>
    <label class="chk"><input type="checkbox" id="mergeA4"> Картинки — на страницы A4 (иначе страница по размеру картинки)</label>
    <div class="tool-actions"><button class="btn primary" id="mergeGo" ${T.merge.length > 1 ? '' : 'disabled'}>Объединить и скачать</button>
    <button class="btn ghost" id="mergeSort" ${T.merge.length > 1 ? '' : 'disabled'} title="Например, листы чертежей: Лист 1, Лист 2, … Лист 10">По имени ↓</button>
    <button class="btn ghost" id="mergeClear" ${T.merge.length ? '' : 'disabled'}>Очистить</button></div>
    <div class="tool-msg" id="toolMsg"></div>`;
  $('mergePick').onchange = (e) => { T.merge.push(...e.target.files); renderMerge(); };
  bindDrop($('mergeDrop'), (fs) => { T.merge.push(...fs); renderMerge(); });
  $('mergeClear').onclick = () => { T.merge = []; renderMerge(); };
  // естественный порядок: «Лист 2» раньше «Лист 10»
  $('mergeSort').onclick = () => { T.merge.sort((a, b) => a.name.localeCompare(b.name, 'ru', { numeric: true, sensitivity: 'base' })); renderMerge(); };
  body.querySelectorAll('.m-btns button').forEach((b) => b.onclick = () => {
    const i = +b.dataset.i, m = T.merge;
    if (b.dataset.a === 'del') m.splice(i, 1);
    else { const j = b.dataset.a === 'up' ? i - 1 : i + 1; [m[i], m[j]] = [m[j], m[i]]; }
    renderMerge();
  });
  let dragI = null;
  body.querySelectorAll('.m-row').forEach((li) => {
    li.ondragstart = () => { dragI = +li.dataset.i; };
    li.ondragover = (e) => e.preventDefault();
    li.ondrop = (e) => { e.preventDefault(); const to = +li.dataset.i; if (dragI === null || dragI === to) return; const [x] = T.merge.splice(dragI, 1); T.merge.splice(to, 0, x); renderMerge(); };
  });
  $('mergeGo').onclick = mergeFiles;
}

// картинки (кроме SVG/TIFF — их сначала переводим конвертером) кладутся на страницу напрямую
const mergeIsImage = (f) => ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'heic', 'heif', 'avif'].includes(extOf(f.name)) || (/^image\/(jpeg|png|webp|gif|bmp|heic|heif|avif)$/.test(f.type) && !extOf(f.name));

async function mergeFiles() {
  const btn = $('mergeGo');
  btn.disabled = true;
  try {
    const { PDFDocument } = await getPdfLib();
    const out = await PDFDocument.create();
    const a4 = $('mergeA4').checked;
    for (let i = 0; i < T.merge.length; i++) {
      const f = T.merge[i];
      toolMsg(`Добавляю ${i + 1} из ${T.merge.length}: ${f.name}`);
      if (extOf(f.name) === 'pdf' || f.type === 'application/pdf') {
        const src = await loadPdfLibDoc(await readBytes(f));
        (await out.copyPages(src, src.getPageIndices())).forEach((p) => out.addPage(p));
      } else if (!mergeIsImage(f)) {
        // документ, таблица, презентация, книга… → сначала в PDF тем же конвертером
        const pdf = await convertFileTo(f, 'pdf', (s) => toolMsg(`${i + 1} из ${T.merge.length}: ${f.name} — ${s}`));
        const src = await loadPdfLibDoc(new Uint8Array(await pdf.arrayBuffer()));
        (await out.copyPages(src, src.getPageIndices())).forEach((p) => out.addPage(p));
      } else {
        const im = await imageForPdf(f);
        const img = await out.embedJpg(im.jpg);
        if (a4) {
          const [W, H] = im.w > im.h ? [842, 595] : [595, 842];
          const k = Math.min((W - 40) / im.w, (H - 40) / im.h);
          out.addPage([W, H]).drawImage(img, { x: (W - im.w * k) / 2, y: (H - im.h * k) / 2, width: im.w * k, height: im.h * k });
        } else {
          const w = im.w * 0.75, h = im.h * 0.75;
          out.addPage([w, h]).drawImage(img, { x: 0, y: 0, width: w, height: h });
        }
      }
    }
    out.setProducer('BullConvert'); out.setCreator('BullConvert');
    const blob = pdfBlob(await out.save());
    download({ blob, name: 'объединённый.pdf' });
    toolMsg(`Готово: ${out.getPageCount()} стр., ${formatSize(blob.size)}`, 'ok');
  } catch (e) { toolMsg(e.message, 'err'); }
  finally { btn.disabled = false; }
}

/* ------------------- Страницы: удалить / повернуть / разделить ------------------- */

function renderPages() {
  const body = $('toolBody');
  const st = T.pages;
  if (!st) {
    body.innerHTML = `<p class="muted">Удаляйте ненужные страницы, поворачивайте, меняйте порядок, извлекайте выбранные и делите PDF на части.</p>
      <div class="tool-drop" id="pagesDrop">${filePickerHtml('pagesPick', '.pdf,application/pdf', false, 'Открыть PDF')}</div><div class="tool-msg" id="toolMsg"></div>`;
    $('pagesPick').onchange = (e) => e.target.files[0] && loadToolFile('pages', e.target.files[0]);
    bindDrop($('pagesDrop'), (fs) => loadToolFile('pages', fs[0]));
    return;
  }
  const selN = st.items.filter((i) => i.sel).length;
  body.innerHTML = `<div class="tool-bar">
      <b class="t-name" title="${escapeHtml(st.name)}">${escapeHtml(st.name)}</b><span class="muted">${st.items.length} стр.${selN ? ` · выбрано ${selN}` : ''}</span>
      <span class="sp"></span>
      <button class="btn sm" data-p="all">Выбрать все</button><button class="btn sm" data-p="none">Снять выбор</button>
      <button class="btn sm" data-p="rotL" ${selN ? '' : 'disabled'}>⟲</button><button class="btn sm" data-p="rotR" ${selN ? '' : 'disabled'}>⟳</button>
      <button class="btn sm danger" data-p="del" ${selN ? '' : 'disabled'}>Удалить выбранные</button>
      <button class="btn sm" data-p="extract" ${selN ? '' : 'disabled'}>Извлечь выбранные в PDF</button>
      <button class="btn sm ghost" data-p="close">Другой файл</button>
    </div>
    <div class="thumbs" id="thumbs"></div>
    <div class="tool-split">
      <b>Разделить:</b>
      <select id="splitMode"><option value="each">каждую страницу в отдельный PDF</option><option value="ranges">по диапазонам…</option><option value="every">каждые N страниц</option></select>
      <input id="splitArg" placeholder="1-3, 4-6, 7" hidden>
      <button class="btn" id="splitGo">Разделить (ZIP)</button>
      <span class="sp"></span>
      <button class="btn primary" id="pagesSave">Сохранить PDF</button>
    </div>
    <div class="tool-msg" id="toolMsg"></div>`;

  const thumbs = $('thumbs');
  st.items.forEach((it, idx) => {
    const d = document.createElement('div');
    d.className = 'thumb' + (it.sel ? ' sel' : '');
    d.draggable = true;
    d.innerHTML = `<div class="th-img"></div><div class="th-foot"><span>${idx + 1}</span>
      <span><button class="th-b" data-r="-90" title="Повернуть влево">⟲</button><button class="th-b" data-r="90" title="Повернуть вправо">⟳</button><button class="th-b" data-x="1" title="Удалить">✕</button></span></div>`;
    const holder = d.querySelector('.th-img');
    if (it.canvas) holder.appendChild(it.canvas);
    else holder.innerHTML = '<span class="muted">…</span>';
    if (it.canvas) it.canvas.style.transform = `rotate(${it.rot}deg)`;
    d.onclick = (e) => {
      const b = e.target.closest('.th-b');
      if (b) {
        if (b.dataset.x) st.items.splice(idx, 1);
        else it.rot = (it.rot + +b.dataset.r + 360) % 360;
      } else it.sel = !it.sel;
      renderPages();
    };
    d.ondragstart = () => { st.dragIdx = idx; };
    d.ondragover = (e) => e.preventDefault();
    d.ondrop = (e) => { e.preventDefault(); if (st.dragIdx == null || st.dragIdx === idx) return; const [x] = st.items.splice(st.dragIdx, 1); st.items.splice(idx, 0, x); st.dragIdx = null; renderPages(); };
    thumbs.appendChild(d);
  });
  renderMissingThumbs(st);

  $('toolBody').querySelectorAll('[data-p]').forEach((b) => b.onclick = async () => {
    const sel = st.items.filter((i) => i.sel);
    switch (b.dataset.p) {
      case 'all': st.items.forEach((i) => { i.sel = true; }); break;
      case 'none': st.items.forEach((i) => { i.sel = false; }); break;
      case 'rotL': sel.forEach((i) => { i.rot = (i.rot + 270) % 360; }); break;
      case 'rotR': sel.forEach((i) => { i.rot = (i.rot + 90) % 360; }); break;
      case 'del':
        if (sel.length === st.items.length) { toolMsg('Нельзя удалить все страницы.', 'err'); return; }
        st.items = st.items.filter((i) => !i.sel); break;
      case 'extract': {
        const blob = await buildPdf(st, sel);
        download({ blob, name: `${st.base}_стр.pdf` });
        toolMsg(`Извлечено ${sel.length} стр.`, 'ok');
        return;
      }
      case 'close': T.pages = null; break;
    }
    renderPages();
  });
  $('splitMode').onchange = (e) => {
    const a = $('splitArg');
    a.hidden = e.target.value === 'each';
    a.placeholder = e.target.value === 'every' ? 'N, например 2' : '1-3, 4-6, 7';
  };
  $('splitGo').onclick = () => splitPdf(st);
  $('pagesSave').onclick = async () => {
    try {
      const blob = await buildPdf(st, st.items);
      download({ blob, name: `${st.base}_изменён.pdf` });
      toolMsg(`Сохранено: ${st.items.length} стр., ${formatSize(blob.size)}`, 'ok');
    } catch (e) { toolMsg(e.message, 'err'); }
  };
}

async function renderMissingThumbs(st) {
  if (st.rendering) return;
  st.rendering = true;
  try {
    for (const it of st.items) {
      if (T.pages !== st) return;
      if (it.canvas) continue;
      const page = await st.doc.getPage(it.n);
      it.canvas = await renderPdfPage(page, 220);
      it.canvas.className = 'th-canvas';
      it.canvas.style.transform = `rotate(${it.rot}deg)`;
      const idx = st.items.indexOf(it);
      const holder = document.querySelectorAll('#thumbs .th-img')[idx];
      if (holder) { holder.innerHTML = ''; holder.appendChild(it.canvas); }
    }
  } finally { st.rendering = false; }
}

async function buildPdf(st, items) {
  const { degrees } = await getPdfLib();
  const src = await loadPdfLibDoc(st.bytes);
  const { PDFDocument } = window.PDFLib;
  const out = await PDFDocument.create();
  const pages = await out.copyPages(src, items.map((i) => i.n - 1));
  pages.forEach((p, k) => {
    const rot = items[k].rot;
    if (rot) p.setRotation(degrees((p.getRotation().angle + rot) % 360));
    out.addPage(p);
  });
  out.setProducer('BullConvert');
  return pdfBlob(await out.save());
}

async function splitPdf(st) {
  try {
    const mode = $('splitMode').value;
    const arg = $('splitArg').value.trim();
    const N = st.items.length;
    let groups;
    if (mode === 'each') groups = st.items.map((_, i) => [i + 1]);
    else if (mode === 'every') {
      const n = parseInt(arg, 10);
      if (!(n > 0)) throw new Error('Укажите число страниц в каждой части.');
      groups = [];
      for (let i = 1; i <= N; i += n) groups.push(Array.from({ length: Math.min(n, N - i + 1) }, (_, k) => i + k));
    } else groups = parseRanges(arg, N);
    const files = [];
    for (let g = 0; g < groups.length; g++) {
      toolMsg(`Часть ${g + 1} из ${groups.length}…`);
      const part = groups[g];
      const label = part.length === 1 ? part[0] : `${part[0]}-${part[part.length - 1]}`;
      files.push({ name: `${st.base}_${label}.pdf`, blob: await buildPdf(st, part.map((p) => st.items[p - 1])) });
    }
    if (files.length === 1) download(files[0]);
    else download({ blob: await zipBlobs(files), name: `${st.base}_части.zip` });
    toolMsg(`Готово: ${files.length} файл(ов)`, 'ok');
  } catch (e) { toolMsg(e.message, 'err'); }
}

/* ------------------- Просмотр страницы (для редактора и скрытия) ------------------- */

function renderViewerTab(kind) {
  const body = $('toolBody');
  const st = T[kind];
  const intro = kind === 'edit'
    ? 'Добавляйте текст (по-русски), картинки и подпись, выделяйте маркером. Объекты можно двигать мышью или пальцем.'
    : 'Выделите области или найдите слова — они будут <b>удалены из файла</b>, а не просто закрашены: страница пересобирается без скрытого текста. Также удаляются метаданные, комментарии и вложения.';
  if (!st) {
    body.innerHTML = `<p class="muted">${intro}</p>
      <div class="tool-drop" id="vDrop">${filePickerHtml('vPick', '.pdf,application/pdf', false, 'Открыть PDF')}</div><div class="tool-msg" id="toolMsg"></div>`;
    $('vPick').onchange = (e) => e.target.files[0] && loadToolFile(kind, e.target.files[0]);
    bindDrop($('vDrop'), (fs) => loadToolFile(kind, fs[0]));
    return;
  }
  const tools = kind === 'edit'
    ? `<span class="seg"><button class="btn sm tool-t active" data-tool="move" title="Двигать объекты">✋</button>
         <button class="btn sm tool-t" data-tool="text">T Текст</button>
         <button class="btn sm tool-t" data-tool="image">🖼 Картинка / подпись</button>
         <button class="btn sm" id="sigDraw" title="Нарисовать подпись мышью или пальцем">✍ Нарисовать подпись</button>
         <button class="btn sm tool-t" data-tool="hl">🖍 Маркер</button></span>
       <label class="mini">Размер <input type="number" id="tSize" min="6" max="96" value="14"></label>
       <label class="mini">Цвет <input type="color" id="tColor" value="#1b1f24"></label>
       <input type="file" id="imgPick" accept="image/*,.heic,.heif" hidden>`
    : `<span class="muted">Выделяйте мышью/пальцем</span>
       <input id="rSearch" placeholder="Найти и скрыть: слово, номер, e-mail…">
       <button class="btn sm" id="rFind">Найти</button>
       <label class="chk"><input type="checkbox" id="rClean" checked> удалить метаданные, комментарии, вложения</label>`;
  const count = kind === 'edit' ? st.objs.length : st.marks.length;
  body.innerHTML = `<div class="tool-bar"><b class="t-name" title="${escapeHtml(st.name)}">${escapeHtml(st.name)}</b>
      <span class="sp"></span>${tools}</div>
    <div class="pv-nav"><button class="btn sm" id="pvPrev">‹</button><span id="pvNum">стр. ${st.pageNum} из ${st.total}</span><button class="btn sm" id="pvNext">›</button>
      <span class="muted" id="pvCount">${kind === 'edit' ? 'объектов' : 'скрытых областей'}: ${count}</span>
      <span class="sp"></span><button class="btn sm ghost" id="pvClose">Другой файл</button>
      <button class="btn primary" id="pvSave">${kind === 'edit' ? 'Сохранить PDF' : 'Скрыть и скачать'}</button></div>
    <div class="pv-wrap"><div class="pv" id="pv"><canvas id="pvCanvas"></canvas><div class="pv-layer" id="pvLayer"></div></div></div>
    <div class="tool-msg" id="toolMsg"></div>`;

  st.tool = st.tool || 'move';
  if (kind === 'edit') {
    body.querySelectorAll('.tool-t').forEach((b) => {
      b.classList.toggle('active', b.dataset.tool === st.tool);
      b.onclick = () => {
        if (b.dataset.tool === 'image') { $('imgPick').click(); return; }
        st.tool = b.dataset.tool;
        body.querySelectorAll('.tool-t').forEach((x) => x.classList.toggle('active', x === b));
      };
    });
    $('sigDraw').onclick = async () => {
      const sig = await drawSignature();
      if (!sig) return;
      st.pendingImage = sig;
      st.tool = 'image';
      body.querySelectorAll('.tool-t').forEach((x) => x.classList.toggle('active', x.dataset.tool === 'image'));
      toolMsg('Нажмите на страницу, куда поставить подпись. Потом её можно двигать.');
    };
    $('imgPick').onchange = async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        const im = await imageForPdf(f);
        // подпись на белом фоне: делаем белый прозрачным, чтобы не было «плашки»
        st.pendingImage = await whiteToTransparent(im);
        st.tool = 'image';
        body.querySelectorAll('.tool-t').forEach((x) => x.classList.toggle('active', x.dataset.tool === 'image'));
        toolMsg('Нажмите на страницу, куда поставить картинку.');
      } catch (er) { toolMsg(er.message, 'err'); }
      e.target.value = '';
    };
  } else {
    $('rFind').onclick = () => findAndMark(st);
    $('rSearch').onkeydown = (e) => { if (e.key === 'Enter') findAndMark(st); };
  }
  $('pvPrev').onclick = () => { if (st.pageNum > 1) { st.pageNum--; renderViewerTab(kind); } };
  $('pvNext').onclick = () => { if (st.pageNum < st.total) { st.pageNum++; renderViewerTab(kind); } };
  $('pvClose').onclick = () => { T[kind] = null; renderViewerTab(kind); };
  $('pvSave').onclick = () => (kind === 'edit' ? saveEdits(st) : applyRedaction(st));
  drawViewerPage(kind, st);
}

async function whiteToTransparent(im) {
  const img = await imageFromUrl('data:image/jpeg;base64,' + bytesToBase64(im.jpg));
  const c = document.createElement('canvas');
  c.width = im.w; c.height = im.h;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, c.width, c.height);
  let light = 0;
  for (let i = 0; i < d.data.length; i += 4) if (d.data[i] > 235 && d.data[i + 1] > 235 && d.data[i + 2] > 235) light++;
  // только если картинка в основном белая (скан подписи/печати) — фото не трогаем
  if (light / (d.data.length / 4) > 0.6) {
    for (let i = 0; i < d.data.length; i += 4) {
      const m = Math.min(d.data[i], d.data[i + 1], d.data[i + 2]);
      if (m > 225) d.data[i + 3] = Math.max(0, 255 - (m - 225) * 8.5);
    }
    ctx.putImageData(d, 0, 0);
  }
  return { url: c.toDataURL('image/png'), w: c.width, h: c.height };
}

async function drawViewerPage(kind, st) {
  const page = await st.doc.getPage(st.pageNum);
  const vp1 = page.getViewport({ scale: 1 });
  st.vp1 = vp1;
  const pv = $('pv');
  if (!pv) return;
  const maxW = Math.min(pv.parentElement.clientWidth - 24, 980); // без горизонтальной прокрутки
  const cssW = Math.max(280, maxW);
  const scale = cssW / vp1.width;
  const vp = page.getViewport({ scale: scale * (window.devicePixelRatio || 1) });
  const canvas = $('pvCanvas');
  canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
  canvas.style.width = cssW + 'px'; canvas.style.height = (vp1.height * scale) + 'px';
  pv.style.width = cssW + 'px'; pv.style.height = (vp1.height * scale) + 'px';
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp, intent: 'print' }).promise;
  st.cssScale = scale;
  renderLayer(kind, st);
  bindLayer(kind, st);
}

const pct = (v) => (v * 100).toFixed(3) + '%';

function renderLayer(kind, st) {
  const layer = $('pvLayer');
  if (!layer) return;
  layer.innerHTML = '';
  const list = kind === 'edit' ? st.objs : st.marks;
  for (const o of list) {
    if (o.page !== st.pageNum) continue;
    const el = document.createElement('div');
    el.style.left = pct(o.x); el.style.top = pct(o.y);
    if (kind === 'redact') {
      el.className = 'pv-mark';
      el.style.width = pct(o.w); el.style.height = pct(o.h);
    } else if (o.type === 'text') {
      el.className = 'pv-obj pv-text';
      el.style.fontSize = (o.size * st.cssScale) + 'px';
      el.style.color = o.color;
      const t = document.createElement('div');
      t.className = 'pv-text-in';
      t.contentEditable = 'true';
      t.textContent = o.text;
      t.oninput = () => { o.text = t.innerText.replace(/\n$/, ''); };
      el.appendChild(t);
      const h = document.createElement('span');
      h.className = 'pv-handle'; h.textContent = '⠿'; h.title = 'Перетащить';
      el.appendChild(h);
    } else {
      el.className = 'pv-obj ' + (o.type === 'image' ? 'pv-img' : 'pv-hl');
      el.style.width = pct(o.w); el.style.height = pct(o.h);
      if (o.type === 'image') { const i = document.createElement('img'); i.src = o.url; i.draggable = false; el.appendChild(i); }
      const r = document.createElement('span'); r.className = 'pv-resize'; el.appendChild(r);
    }
    const x = document.createElement('button');
    x.className = 'pv-del'; x.textContent = '✕'; x.title = 'Удалить';
    x.onpointerdown = (e) => e.stopPropagation();
    x.onclick = (e) => { e.stopPropagation(); list.splice(list.indexOf(o), 1); renderLayer(kind, st); updateCount(kind, st); };
    el.appendChild(x);
    el._obj = o;
    layer.appendChild(el);
  }
}

function updateCount(kind, st) {
  const c = $('pvCount');
  if (c) c.textContent = `${kind === 'edit' ? 'объектов' : 'скрытых областей'}: ${(kind === 'edit' ? st.objs : st.marks).length}`;
}

function bindLayer(kind, st) {
  const layer = $('pvLayer');
  const rel = (e) => {
    const r = layer.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  let drag = null;

  layer.onpointerdown = (e) => {
    const p = rel(e);
    const objEl = e.target.closest('.pv-obj, .pv-mark');
    if (objEl && objEl._obj) {
      const o = objEl._obj;
      if (e.target.classList.contains('pv-text-in')) return; // редактирование текста
      drag = { mode: e.target.classList.contains('pv-resize') ? 'resize' : 'move', o, start: p, orig: { ...o }, el: objEl };
      layer.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }
    if (kind === 'redact' || st.tool === 'hl') {
      const o = kind === 'redact' ? { page: st.pageNum, x: p.x, y: p.y, w: 0, h: 0 } : { type: 'hl', page: st.pageNum, x: p.x, y: p.y, w: 0, h: 0 };
      (kind === 'redact' ? st.marks : st.objs).push(o);
      drag = { mode: 'draw', o, start: p };
      renderLayer(kind, st);
      layer.setPointerCapture(e.pointerId);
      e.preventDefault();
    } else if (st.tool === 'text') {
      const size = +$('tSize').value || 14;
      const o = { type: 'text', page: st.pageNum, x: p.x, y: p.y, text: 'Текст', size, color: $('tColor').value };
      st.objs.push(o);
      renderLayer(kind, st); updateCount(kind, st);
      const els = layer.querySelectorAll('.pv-text-in');
      const t = els[els.length - 1];
      t.focus();
      document.getSelection().selectAllChildren(t);
      st.tool = 'move';
      document.querySelectorAll('.tool-t').forEach((x) => x.classList.toggle('active', x.dataset.tool === 'move'));
    } else if (st.tool === 'image' && st.pendingImage) {
      const im = st.pendingImage;
      const w = 0.3;
      const h = w * (im.h / im.w) * (st.vp1.width / st.vp1.height);
      st.objs.push({ type: 'image', page: st.pageNum, x: Math.min(p.x, 1 - w), y: Math.min(p.y, 1 - h), w, h, url: im.url, iw: im.w, ih: im.h });
      st.pendingImage = null; st.tool = 'move';
      document.querySelectorAll('.tool-t').forEach((x) => x.classList.toggle('active', x.dataset.tool === 'move'));
      renderLayer(kind, st); updateCount(kind, st); toolMsg('');
    }
  };

  layer.onpointermove = (e) => {
    if (!drag) return;
    const p = rel(e);
    const o = drag.o;
    if (drag.mode === 'draw') {
      o.x = Math.min(drag.start.x, p.x); o.y = Math.min(drag.start.y, p.y);
      o.w = Math.abs(p.x - drag.start.x); o.h = Math.abs(p.y - drag.start.y);
    } else if (drag.mode === 'move') {
      o.x = Math.min(Math.max(0, drag.orig.x + p.x - drag.start.x), 1 - (o.w || 0.02));
      o.y = Math.min(Math.max(0, drag.orig.y + p.y - drag.start.y), 1 - (o.h || 0.02));
    } else if (drag.mode === 'resize') {
      o.w = Math.max(0.02, drag.orig.w + p.x - drag.start.x);
      o.h = o.type === 'image' ? o.w * (o.ih / o.iw) * (st.vp1.width / st.vp1.height) : Math.max(0.01, drag.orig.h + p.y - drag.start.y);
    }
    const el = drag.el || [...layer.children].find((c) => c._obj === o);
    if (el) {
      el.style.left = pct(o.x); el.style.top = pct(o.y);
      if (o.w !== undefined) { el.style.width = pct(o.w); el.style.height = pct(o.h); }
    }
  };

  layer.onpointerup = () => {
    if (!drag) return;
    const o = drag.o;
    if (drag.mode === 'draw' && (o.w < 0.005 || o.h < 0.003)) {
      const list = kind === 'redact' ? st.marks : st.objs;
      list.splice(list.indexOf(o), 1);
    }
    drag = null;
    renderLayer(kind, st);
    updateCount(kind, st);
  };
}

/* ------------------------------ Редактор: сохранить ------------------------------ */

async function saveEdits(st) {
  const btn = $('pvSave');
  btn.disabled = true;
  try {
    const { rgb } = await getPdfLib();
    const pdf = await loadPdfLibDoc(st.bytes);
    const needFont = st.objs.some((o) => o.type === 'text' && o.text.trim());
    const font = needFont ? await embedCyrFont(pdf) : null;
    for (const o of st.objs) {
      const vp = (await st.doc.getPage(o.page)).getViewport({ scale: 1 });
      const page = pdf.getPage(o.page - 1);
      const P = (fx, fy) => vp.convertToPdfPoint(fx * vp.width, fy * vp.height);
      if (o.type === 'text') {
        if (!o.text.trim()) continue;
        const [x, yTop] = P(o.x, o.y);
        const [r, g, b] = hexToRgb(o.color);
        o.text.split('\n').forEach((line, i) => {
          page.drawText(line, { x: x + 3 * (o.size / 14), y: yTop - o.size * (0.95 + i * 1.25) - 2, size: o.size, font, color: rgb(r, g, b) });
        });
      } else {
        const [x0, y0] = P(o.x, o.y);
        const [x1, y1] = P(o.x + o.w, o.y + o.h);
        const box = { x: Math.min(x0, x1), y: Math.min(y0, y1), width: Math.abs(x1 - x0), height: Math.abs(y1 - y0) };
        if (o.type === 'image') page.drawImage(await pdf.embedPng(dataUrlBytes(o.url)), box);
        else page.drawRectangle({ ...box, color: rgb(1, 0.9, 0.2), opacity: 0.4 });
      }
    }
    pdf.setProducer('BullConvert');
    const blob = pdfBlob(await pdf.save());
    download({ blob, name: `${st.base}_изменён.pdf` });
    toolMsg(`Сохранено (${formatSize(blob.size)}). Объектов добавлено: ${st.objs.length}.`, 'ok');
  } catch (e) { toolMsg(e.message, 'err'); }
  finally { btn.disabled = false; }
}

/* -------------------- Скрытие данных: найти, удалить, проверить -------------------- */

async function findAndMark(st) {
  const q = $('rSearch').value.trim();
  if (!q) return;
  const ql = q.toLocaleLowerCase('ru');
  const pdfjs = await getPdfJs();
  let found = 0;
  st.terms = [...new Set([...(st.terms || []), q])];
  for (let p = 1; p <= st.total; p++) {
    toolMsg(`Поиск: страница ${p} из ${st.total}…`);
    const page = await st.doc.getPage(p);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    for (const it of tc.items) {
      const s = it.str || '';
      const low = s.toLocaleLowerCase('ru');
      let i = low.indexOf(ql);
      if (i < 0) continue;
      const tx = pdfjs.Util.transform(vp.transform, it.transform);
      const fh = Math.hypot(tx[2], tx[3]) || 10;
      const w = (it.width || s.length * fh * 0.5) * vp.scale;
      while (i >= 0) {
        const x0 = tx[4] + w * (i / s.length), x1 = tx[4] + w * ((i + q.length) / s.length);
        const pad = fh * 0.15;
        st.marks.push({ page: p, x: (x0 - pad) / vp.width, y: (tx[5] - fh - pad) / vp.height, w: (x1 - x0 + 2 * pad) / vp.width, h: (fh * 1.3 + 2 * pad) / vp.height });
        found++;
        i = low.indexOf(ql, i + ql.length);
      }
    }
  }
  const firstPage = st.marks.find((m) => m.page >= 1);
  if (found && firstPage && !st.marks.some((m) => m.page === st.pageNum)) st.pageNum = firstPage.page;
  renderViewerTab('redact');
  const pagesWith = [...new Set(st.marks.map((m) => m.page))].join(', ');
  toolMsg(found ? `Найдено и отмечено: ${found} (стр. ${pagesWith}). Проверьте отметки и нажмите «Скрыть и скачать».` : `«${q}» не найдено как текст. Если это скан — выделите область вручную.`, found ? 'ok' : 'err');
}

async function applyRedaction(st) {
  if (!st.marks.length) { toolMsg('Сначала выделите области или найдите текст.', 'err'); return; }
  const btn = $('pvSave');
  btn.disabled = true;
  try {
    const { PDFDocument, PDFName } = await getPdfLib();
    const src = await loadPdfLibDoc(st.bytes);
    const out = await PDFDocument.create(); // новый документ: старые метаданные, вложения, скрипты, закладки не переносятся
    const clean = $('rClean').checked;
    const byPage = {};
    st.marks.forEach((m) => { (byPage[m.page] = byPage[m.page] || []).push(m); });
    const flattened = [];
    for (let p = 1; p <= st.total; p++) {
      toolMsg(`Страница ${p} из ${st.total}…`);
      const marks = byPage[p];
      if (!marks) {
        const [cp] = await out.copyPages(src, [p - 1]);
        if (clean) ['Annots', 'AA'].forEach((k) => cp.node.delete(PDFName.of(k)));
        out.addPage(cp);
        continue;
      }
      // Страница со скрытием пересобирается из изображения: текст, шрифты и всё,
      // что было под чёрными прямоугольниками, в файл НЕ попадает
      const page = await st.doc.getPage(p);
      const vp1 = page.getViewport({ scale: 1 });
      const canvas = await renderPdfPage(page, vp1.width * (200 / 72));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#000';
      for (const m of marks) ctx.fillRect(Math.floor(m.x * canvas.width) - 1, Math.floor(m.y * canvas.height) - 1, Math.ceil(m.w * canvas.width) + 2, Math.ceil(m.h * canvas.height) + 2);
      const img = await out.embedJpg(dataUrlBytes(canvas.toDataURL('image/jpeg', 0.9)));
      out.addPage([vp1.width, vp1.height]).drawImage(img, { x: 0, y: 0, width: vp1.width, height: vp1.height });
      canvas.width = canvas.height = 0;
      flattened.push(p);
    }
    out.setTitle(''); out.setAuthor(''); out.setSubject(''); out.setKeywords([]);
    out.setProducer('BullConvert'); out.setCreator('BullConvert');
    const bytes = await out.save();

    // Проверка: ищем скрытые слова в готовом файле
    toolMsg('Проверяю результат…');
    const check = await openPdfJs(bytes);
    let all = '';
    for (let p = 1; p <= check.numPages; p++) all += (await (await check.getPage(p)).getTextContent()).items.map((i) => i.str).join(' ') + '\n';
    all = all.toLocaleLowerCase('ru');
    const leaked = (st.terms || []).filter((t) => all.includes(t.toLocaleLowerCase('ru')));
    download({ blob: pdfBlob(bytes), name: `${st.base}_скрыто.pdf` });
    if (leaked.length) toolMsg(`⚠ В файле остались совпадения: ${leaked.join(', ')} (возможно, слово разбито в PDF на части). Отметьте их вручную и повторите.`, 'err');
    else toolMsg(`✓ Готово. Страницы со скрытием (${flattened.join(', ')}) пересобраны — скрытого текста в файле нет${(st.terms || []).length ? ', проверка поиском пройдена' : ''}. ${clean ? 'Метаданные, комментарии и вложения удалены.' : ''}`, 'ok');
  } catch (e) { toolMsg(e.message, 'err'); }
  finally { btn.disabled = false; }
}

/* ------------------------------------ Сжать PDF ------------------------------------ */

function pdfFileTab(tab, intro, bodyHtml) {
  const st = T[tab];
  if (!st) {
    $('toolBody').innerHTML = `<p class="muted">${intro}</p>
      <div class="tool-drop" id="fDrop">${filePickerHtml('fPick', '.pdf,application/pdf', false, 'Открыть PDF')}</div><div class="tool-msg" id="toolMsg"></div>`;
    $('fPick').onchange = (e) => e.target.files[0] && loadToolFile(tab, e.target.files[0]);
    bindDrop($('fDrop'), (fs) => loadToolFile(tab, fs[0]));
    return false;
  }
  $('toolBody').innerHTML = `<div class="tool-bar"><b class="t-name" title="${escapeHtml(st.name)}">${escapeHtml(st.name)}</b>
      <span class="muted">${formatSize(st.bytes.length)}</span><span class="sp"></span><button class="btn sm ghost" id="fClose">Другой файл</button></div>
    ${bodyHtml}<div class="tool-msg" id="toolMsg"></div>`;
  $('fClose').onclick = () => { T[tab] = null; switchTab(tab); };
  return true;
}

function renderCompress() {
  if (!pdfFileTab('compress', 'Уменьшает размер PDF — для почты, госуслуг и мессенджеров. Обычный режим пережимает картинки внутри и <b>сохраняет текст</b>.', `
    <div class="opt-grid">
      <label class="radio"><input type="radio" name="cLevel" value="light"> <b>Слабое</b> — почти без потери качества</label>
      <label class="radio"><input type="radio" name="cLevel" value="medium" checked> <b>Среднее</b> — рекомендуется</label>
      <label class="radio"><input type="radio" name="cLevel" value="strong"> <b>Сильное</b> — максимум для картинок, текст сохраняется</label>
      <label class="radio"><input type="radio" name="cLevel" value="raster"> <b>Предельное</b> — страницы становятся картинками (текст перестаёт выделяться); для сканов</label>
    </div>
    <div class="tool-actions"><button class="btn primary" id="cGo">Сжать и скачать</button></div>`)) return;
  $('cGo').onclick = () => compressPdf(T.compress, document.querySelector('input[name=cLevel]:checked').value);
}

async function compressPdf(st, level) {
  const btn = $('cGo');
  btn.disabled = true;
  try {
    const before = st.bytes.length;
    let out;
    if (level === 'raster') {
      const doc = await openPdfJs(st.bytes);
      const pdf = await createImagePdf();
      for (let p = 1; p <= doc.numPages; p++) {
        toolMsg(`Страница ${p} из ${doc.numPages}…`);
        const page = await doc.getPage(p);
        const vp = page.getViewport({ scale: 1 });
        const c = await renderPdfPage(page, vp.width * (110 / 72));
        pdf.add(c, 0.55, vp.width);
        c.width = c.height = 0;
      }
      out = new Uint8Array(await pdf.blob().arrayBuffer());
    } else {
      const L = { light: { q: 0.82, max: 2600 }, medium: { q: 0.68, max: 1900 }, strong: { q: 0.5, max: 1300 } }[level];
      const { PDFName, PDFRawStream, PDFArray, PDFNumber } = await getPdfLib();
      const pdf = await loadPdfLibDoc(st.bytes);
      const N = (n) => PDFName.of(n);
      const objs = pdf.context.enumerateIndirectObjects();
      let done = 0, images = 0;
      for (const [ref, obj] of objs) {
        if (!(obj instanceof PDFRawStream) || obj.dict.get(N('Subtype')) !== N('Image')) continue;
        const f = obj.dict.get(N('Filter'));
        const isJpeg = f === N('DCTDecode') || (f instanceof PDFArray && f.size() === 1 && f.get(0) === N('DCTDecode'));
        if (!isJpeg) continue;
        images++;
        let bmp;
        try { bmp = await createImageBitmap(new Blob([obj.contents], { type: 'image/jpeg' })); } catch { continue; }
        const k = Math.min(1, L.max / Math.max(bmp.width, bmp.height));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k));
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(bmp, 0, 0, c.width, c.height);
        const jpg = dataUrlBytes(c.toDataURL('image/jpeg', L.q));
        if (jpg.length >= obj.contents.length * 0.95) continue; // и так компактно
        const dict = obj.dict;
        dict.set(N('Width'), PDFNumber.of(c.width));
        dict.set(N('Height'), PDFNumber.of(c.height));
        dict.set(N('ColorSpace'), N('DeviceRGB'));
        dict.set(N('BitsPerComponent'), PDFNumber.of(8));
        dict.set(N('Filter'), N('DCTDecode'));
        dict.delete(N('Decode'));
        dict.delete(N('DecodeParms'));
        pdf.context.assign(ref, PDFRawStream.of(dict, jpg));
        done++;
        toolMsg(`Картинок пережато: ${done}…`);
      }
      pdf.setProducer('BullConvert');
      out = await pdf.save({ useObjectStreams: true });
      if (!images) toolMsg('Картинок в PDF нет — сжимаю только структуру файла.');
    }
    if (out.length >= before) {
      toolMsg(`Файл уже оптимален: сжатие не уменьшило его (${formatSize(before)}).${level !== 'raster' ? ' Для сканов попробуйте «Предельное».' : ''}`, 'err');
      return;
    }
    download({ blob: pdfBlob(out), name: `${st.base}_сжатый.pdf` });
    toolMsg(`Готово: ${formatSize(before)} → ${formatSize(out.length)} (−${Math.round((1 - out.length / before) * 100)}%)`, 'ok');
  } catch (e) { toolMsg(e.message, 'err'); }
  finally { btn.disabled = false; }
}

/* ------------------------------- Номера страниц и водяной знак ------------------------------- */

function renderStamp() {
  if (!pdfFileTab('stamp', 'Добавьте номера страниц и/или водяной знак — надпись («Копия», «Черновик», название компании) или картинку-логотип.', `
    <div class="opt-cols">
      <fieldset><legend><label><input type="checkbox" id="nOn" checked> Номера страниц</label></legend>
        <label class="mini">Вид <select id="nFmt"><option value="{n}">1</option><option value="Стр. {n}">Стр. 1</option><option value="{n} / {total}">1 / 10</option><option value="Страница {n} из {total}">Страница 1 из 10</option></select></label>
        <label class="mini">Место <select id="nPos"><option value="bc">внизу по центру</option><option value="br">внизу справа</option><option value="bl">внизу слева</option><option value="tc">вверху по центру</option><option value="tr">вверху справа</option></select></label>
        <label class="mini">Начать с <input type="number" id="nStart" value="1" min="0"></label>
        <label class="mini">Пропустить первых <input type="number" id="nSkip" value="0" min="0"> стр.</label>
        <label class="mini">Размер <input type="number" id="nSize" value="10" min="6" max="40"></label>
      </fieldset>
      <fieldset><legend><label><input type="checkbox" id="wOn"> Водяной знак</label></legend>
        <label class="mini">Текст <input id="wText" value="КОПИЯ"></label>
        <label class="mini">Размер <input type="number" id="wSize" value="60" min="10" max="200"></label>
        <label class="mini">Цвет <input type="color" id="wColor" value="#c92a2a"></label>
        <label class="mini">Прозрачность <input type="range" id="wOpacity" min="5" max="80" value="20"></label>
        <label class="mini">Наклон <select id="wAngle"><option value="45">по диагонали</option><option value="0">горизонтально</option></select></label>
        <label class="mini">или картинка <input type="file" id="wImg" accept="image/*"></label>
      </fieldset>
    </div>
    <div class="tool-actions"><button class="btn primary" id="sGo">Применить и скачать</button></div>`)) return;
  $('sGo').onclick = () => stampPdf(T.stamp);
}

async function stampPdf(st) {
  const btn = $('sGo');
  btn.disabled = true;
  try {
    const { rgb, degrees } = await getPdfLib();
    const pdf = await loadPdfLibDoc(st.bytes);
    const font = await embedCyrFont(pdf);
    const pages = pdf.getPages();
    const total = pages.length;
    const numOn = $('nOn').checked, wmOn = $('wOn').checked;
    if (!numOn && !wmOn) throw new Error('Включите номера страниц или водяной знак.');
    let wmImg = null;
    const imgFile = $('wImg').files[0];
    if (wmOn && imgFile) {
      const im = await whiteToTransparent(await imageForPdf(imgFile));
      wmImg = { img: await pdf.embedPng(dataUrlBytes(im.url)), w: im.w, h: im.h };
    }
    const fmt = $('nFmt').value, pos = $('nPos').value, start = +$('nStart').value || 1, skip = +$('nSkip').value || 0, nSize = +$('nSize').value || 10;
    const wText = $('wText').value.trim(), wSize = +$('wSize').value || 60, wOpacity = (+$('wOpacity').value || 20) / 100, wAngle = +$('wAngle').value;
    const [wr, wg, wb] = hexToRgb($('wColor').value);
    pages.forEach((page, i) => {
      const { width, height } = page.getSize();
      if (numOn && i >= skip) {
        const n = start + i - skip;
        const t = fmt.replace('{n}', n).replace('{total}', start + total - skip - 1);
        const tw = font.widthOfTextAtSize(t, nSize);
        const x = pos.endsWith('c') ? (width - tw) / 2 : pos.endsWith('r') ? width - tw - 36 : 36;
        const y = pos.startsWith('b') ? 22 : height - 22 - nSize;
        page.drawText(t, { x, y, size: nSize, font, color: rgb(0.25, 0.25, 0.25) });
      }
      if (wmOn) {
        if (wmImg) {
          const k = Math.min(width * 0.6 / wmImg.w, height * 0.6 / wmImg.h);
          const w = wmImg.w * k, h = wmImg.h * k;
          page.drawImage(wmImg.img, { x: (width - w) / 2, y: (height - h) / 2, width: w, height: h, opacity: wOpacity });
        } else if (wText) {
          const tw = font.widthOfTextAtSize(wText, wSize);
          const a = wAngle * Math.PI / 180;
          // центр надписи — в центре страницы (с учётом поворота)
          const x = width / 2 - (tw / 2) * Math.cos(a) + (wSize / 3) * Math.sin(a);
          const y = height / 2 - (tw / 2) * Math.sin(a) - (wSize / 3) * Math.cos(a);
          page.drawText(wText, { x, y, size: wSize, font, color: rgb(wr, wg, wb), opacity: wOpacity, rotate: degrees(wAngle) });
        }
      }
    });
    pdf.setProducer('BullConvert');
    const blob = pdfBlob(await pdf.save());
    download({ blob, name: `${st.base}_${wmOn ? 'знак' : 'номера'}.pdf` });
    toolMsg(`Готово: ${total} стр., ${formatSize(blob.size)}`, 'ok');
  } catch (e) { toolMsg(e.message, 'err'); }
  finally { btn.disabled = false; }
}

/* ------------------------------------ Пароль на PDF ------------------------------------ */

function renderProtect() {
  if (!pdfFileTab('protect', 'Поставьте пароль на открытие PDF (шифрование AES-256) или снимите пароль, если вы его знаете.', `
    <div class="opt-cols">
      <fieldset><legend>Поставить пароль</legend>
        <label class="mini">Пароль <input type="password" id="pNew" autocomplete="new-password"></label>
        <label class="mini">Ещё раз <input type="password" id="pNew2" autocomplete="new-password"></label>
        <label class="chk"><input type="checkbox" id="pNoPrint"> запретить печать</label>
        <label class="chk"><input type="checkbox" id="pNoCopy"> запретить копирование текста</label>
        <button class="btn primary" id="pSet">Зашифровать и скачать</button>
      </fieldset>
      <fieldset><legend>Снять пароль</legend>
        <label class="mini">Текущий пароль <input type="password" id="pOld" autocomplete="current-password"></label>
        <button class="btn" id="pRemove">Снять пароль и скачать</button>
      </fieldset>
    </div>`)) return;
  const st = T.protect;
  $('pSet').onclick = async () => {
    try {
      const pw = $('pNew').value;
      if (!pw) throw new Error('Введите пароль.');
      if (pw !== $('pNew2').value) throw new Error('Пароли не совпадают.');
      const pdf = await loadPdfLibDoc(st.bytes);
      pdf.encrypt({
        userPassword: pw,
        ownerPassword: pw + ':' + (crypto.randomUUID ? crypto.randomUUID() : Date.now()),
        permissions: { printing: $('pNoPrint').checked ? undefined : 'highResolution', copying: !$('pNoCopy').checked, modifying: false, annotating: true, fillingForms: true, contentAccessibility: true, documentAssembly: false },
      });
      const blob = pdfBlob(await pdf.save());
      download({ blob, name: `${st.base}_защищён.pdf` });
      $('pNew').value = $('pNew2').value = '';
      toolMsg('Готово: PDF зашифрован (AES-256). Без пароля его не открыть — не забудьте пароль.', 'ok');
    } catch (e) { toolMsg(e.message, 'err'); }
  };
  $('pRemove').onclick = async () => {
    try {
      const { PDFDocument } = await getPdfLib();
      let pdf;
      try { pdf = await PDFDocument.load(st.bytes, { password: $('pOld').value }); }
      catch { throw new Error('Неверный пароль (или файл повреждён).'); }
      const blob = pdfBlob(await pdf.save());
      download({ blob, name: `${st.base}_без_пароля.pdf` });
      $('pOld').value = '';
      toolMsg('Готово: пароль снят.', 'ok');
    } catch (e) { toolMsg(e.message, 'err'); }
  };
}

/* ------------------------------------ Склеить фото ------------------------------------ */

function renderCollage() {
  const body = $('toolBody');
  const rows = T.collage.map((f, i) => `<li class="m-row"><span class="badge image">${escapeHtml(extOf(f.name) || '?')}</span>
      <span class="m-name">${escapeHtml(f.name)}</span><span class="m-btns">
      <button class="btn sm" data-a="up" data-i="${i}" ${i ? '' : 'disabled'}>↑</button>
      <button class="btn sm" data-a="down" data-i="${i}" ${i < T.collage.length - 1 ? '' : 'disabled'}>↓</button>
      <button class="btn sm ghost" data-a="del" data-i="${i}">✕</button></span></li>`).join('');
  body.innerHTML = `<p class="muted">Склейте несколько фото или скриншотов в одну картинку: столбиком, в ряд или сеткой.</p>
    <div class="tool-drop" id="cgDrop">${filePickerHtml('cgPick', 'image/*,.heic,.heif,.tif,.tiff', true, '+ Добавить фото')}</div>
    <ol class="m-list">${rows}</ol>
    <div class="opt-row">
      <label class="mini">Как <select id="cgLayout"><option value="v">столбиком</option><option value="h">в ряд</option><option value="g">сеткой</option></select></label>
      <label class="mini">Колонок <input type="number" id="cgCols" value="2" min="2" max="8"></label>
      <label class="mini">Отступ, px <input type="number" id="cgGap" value="10" min="0" max="100"></label>
      <label class="mini">Фон <input type="color" id="cgBg" value="#ffffff"></label>
      <label class="mini">Формат <select id="cgFmt"><option value="jpg">JPG</option><option value="png">PNG</option></select></label>
    </div>
    <div class="tool-actions"><button class="btn primary" id="cgGo" ${T.collage.length > 1 ? '' : 'disabled'}>Склеить и скачать</button>
      <button class="btn ghost" id="cgClear" ${T.collage.length ? '' : 'disabled'}>Очистить</button></div>
    <div class="tool-msg" id="toolMsg"></div>`;
  $('cgPick').onchange = (e) => { T.collage.push(...e.target.files); renderCollage(); };
  bindDrop($('cgDrop'), (fs) => { T.collage.push(...fs); renderCollage(); });
  $('cgClear').onclick = () => { T.collage = []; renderCollage(); };
  body.querySelectorAll('.m-btns button').forEach((b) => b.onclick = () => {
    const i = +b.dataset.i, m = T.collage;
    if (b.dataset.a === 'del') m.splice(i, 1);
    else { const j = b.dataset.a === 'up' ? i - 1 : i + 1; [m[i], m[j]] = [m[j], m[i]]; }
    renderCollage();
  });
  $('cgGo').onclick = makeCollage;
}

async function makeCollage() {
  const btn = $('cgGo');
  btn.disabled = true;
  try {
    const layout = $('cgLayout').value, gap = +$('cgGap').value || 0, bg = $('cgBg').value, fmt = $('cgFmt').value;
    const cols = layout === 'g' ? Math.max(2, +$('cgCols').value || 2) : layout === 'h' ? T.collage.length : 1;
    const imgs = [];
    for (const f of T.collage) {
      toolMsg(`Загружаю ${imgs.length + 1} из ${T.collage.length}…`);
      const { img, url } = await loadImage(await imageSource(f, extOf(f.name)));
      imgs.push({ img, url, w: img.naturalWidth, h: img.naturalHeight });
    }
    // ширина ячейки (столбик/сетка) или высота ряда (в ряд) — по самому маленькому снимку, но не больше 1600/800 px
    let W, H, cells = [];
    if (layout === 'h') {
      const rowH = Math.min(1200, Math.min(...imgs.map((i) => i.h)));
      let x = gap;
      for (const i of imgs) { const w = Math.round(i.w * rowH / i.h); cells.push({ i, x, y: gap, w, h: rowH }); x += w + gap; }
      W = x; H = rowH + gap * 2;
    } else {
      const cellW = Math.min(layout === 'v' ? 1600 : 800, Math.min(...imgs.map((i) => i.w)));
      let y = gap;
      for (let r = 0; r < imgs.length; r += cols) {
        const row = imgs.slice(r, r + cols).map((i) => ({ i, w: cellW, h: Math.round(i.h * cellW / i.w) }));
        const rowH = Math.max(...row.map((c) => c.h));
        row.forEach((c, k) => cells.push({ ...c, x: gap + k * (cellW + gap), y: y + Math.round((rowH - c.h) / 2) }));
        y += rowH + gap;
      }
      W = gap + cols * (cellW + gap); H = y;
    }
    if (W * H > 60e6) throw new Error('Слишком большая картинка получается — уменьшите число фото или выберите «сеткой».');
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    ctx.imageSmoothingQuality = 'high';
    for (const cell of cells) ctx.drawImage(cell.i.img, cell.x, cell.y, cell.w, cell.h);
    imgs.forEach((i) => URL.revokeObjectURL(i.url));
    const blob = await canvasToBlob(c, MIME[fmt], 0.9);
    download({ blob, name: `коллаж.${fmt}` });
    toolMsg(`Готово: ${W}×${H} px, ${formatSize(blob.size)}`, 'ok');
  } catch (e) { toolMsg(e.message, 'err'); }
  finally { btn.disabled = false; }
}

/* ===================== Редактирование документа перед конвертацией ===================== */

async function openDocEditor(item) {
  const dlg = $('editDlg');
  const area = $('editArea');
  $('editTitle').textContent = item.file.name;
  area.innerHTML = '<p class="muted">Загрузка документа…</p>';
  area.contentEditable = 'false';
  dlg.showModal();
  try {
    const html = item.editedHtml ?? await docToHtml(item.file, item.ext, () => {}, (s) => { area.innerHTML = `<p class="muted">${escapeHtml(s)}</p>`; });
    area.innerHTML = html;
    area.contentEditable = 'true';
  } catch (e) {
    area.innerHTML = `<p class="err">${escapeHtml(e.message)}</p>`;
    return;
  }
  $('editSave').onclick = () => {
    item.editedHtml = area.innerHTML;
    item.status = 'idle'; item.result = null;
    dlg.close();
    refreshRow(item); updateToolbar();
  };
  $('editReset').onclick = () => {
    delete item.editedHtml;
    item.status = 'idle'; item.result = null;
    dlg.close();
    refreshRow(item); updateToolbar();
  };
}

document.querySelectorAll('#editDlg [data-cmd]').forEach((b) => {
  b.onmousedown = (e) => e.preventDefault(); // не терять выделение в тексте
  b.onclick = () => {
    const [cmd, val] = b.dataset.cmd.split(':');
    document.execCommand(cmd, false, val || null);
    $('editArea').focus();
  };
});

/* ================================ Привязка к странице ================================ */

$('toolsBtn').onclick = () => openTools(T.tab);
// «Всё в один PDF» из списка файлов: открываем объединение с файлами списка в том же порядке
$('mergeAll').onclick = () => {
  T.merge = items.filter((i) => i.cat && i.cat !== 'archive').map((i) => (i.editedImage ? new File([i.editedImage], `${i.outBase}.png`, { type: 'image/png' }) : i.file));
  openTools('merge');
};
document.querySelectorAll('#toolsDlg .tab').forEach((b) => b.onclick = () => switchTab(b.dataset.tab));
window.addEventListener('resize', () => {
  if (!$('toolsDlg').open) return;
  if ((T.tab === 'edit' || T.tab === 'redact') && T[T.tab]) drawViewerPage(T.tab, T[T.tab]);
});
