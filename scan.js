'use strict';

/* BullConvert — фото документов: поиск листа на снимке, выпрямление перспективы,
   «Скан документов» — несколько фото в один PDF (выровнять, чёрно-белый, распознать текст). */

/** Углы листа на фото: [TL, TR, BR, BL] в пикселях холста, или null, если лист не найден */
function detectSheet(canvas) {
  const W0 = canvas.width, H0 = canvas.height;
  const k = Math.min(1, 640 / Math.max(W0, H0));
  const w = Math.max(8, Math.round(W0 * k)), h = Math.max(8, Math.round(H0 * k));
  const s = document.createElement('canvas');
  s.width = w; s.height = h;
  const g = s.getContext('2d', { willReadFrequently: true });
  g.filter = 'blur(2px)';
  g.drawImage(canvas, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data;
  const gray = new Uint8Array(w * h);
  const hist = new Uint32Array(256);
  for (let i = 0, j = 0; j < gray.length; i += 4, j++) { const v = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0; gray[j] = v; hist[v]++; }
  // порог Оцу: бумага светлее фона
  let sum = 0; for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0, wB = 0, best = 0, thr = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (!wB) continue;
    const wF = gray.length - wB; if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF, between = wB * wF * (mB - mF) ** 2;
    if (between > best) { best = between; thr = t; }
  }
  // самая большая светлая область
  const lab = new Int32Array(w * h).fill(-1);
  let bestId = -1, bestSize = 0, id = 0;
  const stack = [];
  for (let p = 0; p < gray.length; p++) {
    if (gray[p] <= thr || lab[p] !== -1) continue;
    let size = 0;
    stack.push(p); lab[p] = id;
    while (stack.length) {
      const q = stack.pop(); size++;
      const x = q % w, y = (q - x) / w;
      for (const n of [x > 0 ? q - 1 : -1, x < w - 1 ? q + 1 : -1, y > 0 ? q - w : -1, y < h - 1 ? q + w : -1]) {
        if (n >= 0 && lab[n] === -1 && gray[n] > thr) { lab[n] = id; stack.push(n); }
      }
    }
    if (size > bestSize) { bestSize = size; bestId = id; }
    id++;
  }
  const area = bestSize / (w * h);
  if (bestId < 0 || area < 0.15 || area > 0.97) return null; // листа не видно или он и так на всё фото
  // углы — крайние точки области по диагоналям
  let tl = null, tr = null, br = null, bl = null;
  for (let p = 0; p < lab.length; p++) {
    if (lab[p] !== bestId) continue;
    const x = p % w, y = (p - x) / w;
    if (!tl || x + y < tl.x + tl.y) tl = { x, y };
    if (!br || x + y > br.x + br.y) br = { x, y };
    if (!tr || x - y > tr.x - tr.y) tr = { x, y };
    if (!bl || x - y < bl.x - bl.y) bl = { x, y };
  }
  return [tl, tr, br, bl].map((c) => ({ x: (c.x + 0.5) / k, y: (c.y + 0.5) / k }));
}

/** Выпрямление: четырёхугольник на фото → прямоугольный лист (перспективное преобразование) */
function warpSheet(src, quad) {
  const [tl, tr, br, bl] = quad;
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  let W = Math.round(Math.max(dist(tl, tr), dist(bl, br))), H = Math.round(Math.max(dist(tl, bl), dist(tr, br)));
  const lim = 3000 / Math.max(W, H);
  if (lim < 1) { W = Math.round(W * lim); H = Math.round(H * lim); }
  // гомография из прямоугольника назначения в четырёхугольник исходника
  const solve = (A, b) => {
    const n = b.length;
    for (let i = 0; i < n; i++) {
      let m = i; for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[m][i])) m = r;
      [A[i], A[m]] = [A[m], A[i]]; [b[i], b[m]] = [b[m], b[i]];
      for (let r = i + 1; r < n; r++) { const f = A[r][i] / A[i][i]; for (let c = i; c < n; c++) A[r][c] -= f * A[i][c]; b[r] -= f * b[i]; }
    }
    const x = Array(n).fill(0);
    for (let i = n - 1; i >= 0; i--) { let v = b[i]; for (let c = i + 1; c < n; c++) v -= A[i][c] * x[c]; x[i] = v / A[i][i]; }
    return x;
  };
  const dst = [[0, 0], [W, 0], [W, H], [0, H]], srcP = [tl, tr, br, bl];
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = dst[i], { x: u, y: v } = srcP[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  const [a0, a1, a2, b0, b1, b2, c0, c1] = solve(A, b);
  const sw = src.width, sh = src.height;
  const sd = src.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, sw, sh).data;
  const out = document.createElement('canvas');
  out.width = W; out.height = H;
  const og = out.getContext('2d');
  const od = og.createImageData(W, H);
  const o = od.data;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const den = c0 * x + c1 * y + 1;
    const u = (a0 * x + a1 * y + a2) / den, v = (b0 * x + b1 * y + b2) / den;
    const x0 = Math.floor(u), y0 = Math.floor(v);
    const i = (y * W + x) * 4;
    if (x0 < 0 || y0 < 0 || x0 >= sw - 1 || y0 >= sh - 1) { o[i] = o[i + 1] = o[i + 2] = 255; o[i + 3] = 255; continue; }
    const fx = u - x0, fy = v - y0;
    const p00 = (y0 * sw + x0) * 4, p10 = p00 + 4, p01 = p00 + sw * 4, p11 = p01 + 4;
    for (let c = 0; c < 3; c++) o[i + c] = (sd[p00 + c] * (1 - fx) + sd[p10 + c] * fx) * (1 - fy) + (sd[p01 + c] * (1 - fx) + sd[p11 + c] * fx) * fy;
    o[i + 3] = 255;
  }
  og.putImageData(od, 0, 0);
  return out;
}

/* ---------------- в фоторедакторе: найти лист, поправить углы, выпрямить ---------------- */

function showSheetCorners(quad) {
  const stage = $('imgStage');
  stage.querySelectorAll('.sheet-ui').forEach((e) => e.remove());
  if (!quad) return;
  const f = IE.full;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'sheet-ui sheet-lines');
  svg.setAttribute('viewBox', `0 0 ${f.width} ${f.height}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
  svg.appendChild(poly);
  stage.appendChild(svg);
  const draw = () => poly.setAttribute('points', IE.sheet.map((p) => `${p.x},${p.y}`).join(' '));
  draw();
  IE.sheet.forEach((p, n) => {
    const h = document.createElement('div');
    h.className = 'sheet-ui sheet-corner';
    const place = () => { h.style.left = (p.x / f.width * 100) + '%'; h.style.top = (p.y / f.height * 100) + '%'; };
    place();
    h.onpointerdown = (e) => {
      e.stopPropagation(); e.preventDefault();
      h.setPointerCapture(e.pointerId);
      h.onpointermove = (ev) => {
        const r = stage.getBoundingClientRect();
        IE.sheet[n] = { x: Math.min(f.width, Math.max(0, (ev.clientX - r.left) / r.width * f.width)), y: Math.min(f.height, Math.max(0, (ev.clientY - r.top) / r.height * f.height)) };
        p = IE.sheet[n]; place(); draw();
      };
      h.onpointerup = () => { h.onpointermove = null; };
    };
    stage.appendChild(h);
  });
}

async function sheetButton() {
  const btn = $('imgSheet');
  if (!IE.sheet) {
    // первый шаг: найти лист и показать углы
    const quad = detectSheet(IE.full);
    const f = IE.full;
    const m = Math.min(f.width, f.height) * 0.05;
    IE.sheet = quad || [{ x: m, y: m }, { x: f.width - m, y: m }, { x: f.width - m, y: f.height - m }, { x: m, y: f.height - m }];
    IE.crop = null; showCrop();
    showSheetCorners(IE.sheet);
    btn.textContent = '✔ Выпрямить лист';
    $('imgInfo').textContent = quad ? 'Лист найден — поправьте углы, если нужно, и нажмите «Выпрямить лист».' : 'Лист не найден автоматически — перетащите углы на края листа.';
    return;
  }
  btn.disabled = true;
  $('imgInfo').textContent = 'Выпрямляю…';
  try {
    await new Promise((r) => setTimeout(r, 20));
    const out = warpSheet(IE.full, IE.sheet);
    URL.revokeObjectURL(IE.url);
    const { img, url } = await loadImage(await canvasToBlob(out, 'image/png'));
    Object.assign(IE, { img, url, rot: 0, flip: false, crop: null, sheet: null });
    showSheetCorners(null);
    drawImageEditor();
  } catch (e) { $('imgInfo').textContent = e.message; }
  finally { btn.disabled = false; btn.textContent = '📐 Выровнять лист'; }
}
$('imgSheet').onclick = sheetButton;
// при закрытии редактора или новом снимке — сбросить углы
$('imgDlg').addEventListener('close', () => { IE.sheet = null; showSheetCorners(null); $('imgSheet').textContent = '📐 Выровнять лист'; });

/* ---------------- «Скан документов»: несколько фото → один PDF ---------------- */

T.scan = T.scan || [];

function renderScanTool() {
  const body = $('toolBody');
  const rows = T.scan.map((f, i) => `<li class="m-row" draggable="true" data-i="${i}">
      <span class="badge image">${escapeHtml(extOf(f.name) || '?')}</span>
      <span class="m-name">${escapeHtml(f.name)}</span><span class="muted">${formatSize(f.size)}</span>
      <span class="m-btns"><button class="btn sm" data-a="up" data-i="${i}" ${i ? '' : 'disabled'}>↑</button>
      <button class="btn sm" data-a="down" data-i="${i}" ${i < T.scan.length - 1 ? '' : 'disabled'}>↓</button>
      <button class="btn sm ghost" data-a="del" data-i="${i}">✕</button></span></li>`).join('');
  body.innerHTML = `<p class="muted">Сфотографируйте страницы на телефон — получите один аккуратный PDF: лист находится и выпрямляется, тени убираются, текст распознаётся (можно искать и копировать).</p>
    <div class="tool-drop" id="scanDrop">${filePickerHtml('scanPick', 'image/*,.heic,.heif', true, '+ Добавить фото')}</div>
    <ol class="m-list" id="scanList">${rows}</ol>
    <div class="opt-grid">
      <label class="chk"><input type="checkbox" id="scanCrop" checked> найти и выпрямить лист</label>
      <label class="chk"><input type="checkbox" id="scanBw" checked> чёрно-белый скан (без теней)</label>
      <label class="chk"><input type="checkbox" id="scanOcr" checked> распознать текст (PDF с поиском)</label>
    </div>
    <div class="tool-actions"><button class="btn primary" id="scanGo" ${T.scan.length ? '' : 'disabled'}>Собрать PDF</button>
      <button class="btn ghost" id="scanClear" ${T.scan.length ? '' : 'disabled'}>Очистить</button></div>
    <div class="tool-msg" id="toolMsg"></div>`;
  $('scanPick').onchange = (e) => { T.scan.push(...e.target.files); renderScanTool(); };
  bindDrop($('scanDrop'), (fs) => { T.scan.push(...fs); renderScanTool(); });
  $('scanClear').onclick = () => { T.scan = []; renderScanTool(); };
  body.querySelectorAll('.m-btns button').forEach((b) => b.onclick = () => {
    const i = +b.dataset.i, m = T.scan;
    if (b.dataset.a === 'del') m.splice(i, 1);
    else { const j = b.dataset.a === 'up' ? i - 1 : i + 1; [m[i], m[j]] = [m[j], m[i]]; }
    renderScanTool();
  });
  $('scanGo').onclick = () => scanToPdf({ crop: $('scanCrop').checked, bw: $('scanBw').checked, ocr: $('scanOcr').checked });
}

async function scanToPdf(opt) {
  const btn = $('scanGo');
  btn.disabled = true;
  try {
    const { PDFDocument } = await getPdfLib();
    const out = await PDFDocument.create();
    const font = opt.ocr ? await embedCyrFont(out) : null;
    const worker = opt.ocr ? await getOcrWorker() : null;
    for (let i = 0; i < T.scan.length; i++) {
      const f = T.scan[i];
      toolMsg(`Страница ${i + 1} из ${T.scan.length}: подготовка…`);
      const { img, url } = await loadImage(await imageSource(f, canon(extOf(f.name)) || 'jpg'));
      let c = document.createElement('canvas');
      // слишком большие фото уменьшаем: 2500 точек достаточно для чёткого скана A4
      const kk = Math.min(1, 2500 / Math.max(img.naturalWidth, img.naturalHeight));
      c.width = Math.round(img.naturalWidth * kk); c.height = Math.round(img.naturalHeight * kk);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      if (opt.crop) { const q = detectSheet(c); if (q) c = warpSheet(c, q); }
      if (opt.bw) c = scanFilter(c, 'bw');
      // лист A4: ширина 595 pt, высота — по пропорциям снимка
      if (opt.ocr) toolMsg(`Страница ${i + 1} из ${T.scan.length}: распознавание текста…`);
      await addScanPage(out, font, c, worker, null);
      c.width = c.height = 0;
    }
    out.setProducer('BullConvert');
    const blob = pdfBlob(await out.save());
    download({ blob, name: 'скан.pdf' });
    toolMsg(`Готово: ${out.getPageCount()} стр., ${formatSize(blob.size)}`, 'ok');
  } catch (e) { toolMsg(e.message, 'err'); }
  finally { btn.disabled = false; }
}
