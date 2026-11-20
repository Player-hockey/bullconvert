'use strict';

/* BullConvert — Excel (XLSX) → PDF «как в Excel»: ширины столбцов, высоты строк, объединения,
   границы, заливка, шрифты, выравнивание, формат чисел, скрытые строки/столбцы, область печати,
   ориентация и масштаб страницы, повтор шапки. */

// стандартная палитра Excel (индексированные цвета 0–63)
const XL_INDEXED = ['000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF', '000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF',
  '800000', '008000', '000080', '808000', '800080', '008080', 'C0C0C0', '808080', '9999FF', '993366', 'FFFFCC', 'CCFFFF', '660066', 'FF8080', '0066CC', 'CCCCFF',
  '000080', 'FF00FF', 'FFFF00', '00FFFF', '800080', '800000', '008080', '0000FF', '00CCFF', 'CCFFFF', 'CCFFCC', 'FFFF99', '99CCFF', 'FF99CC', 'CC99FF', 'FFCC99',
  '3366FF', '33CCCC', '99CC00', 'FFCC00', 'FF9900', 'FF6600', '666699', '969696', '003366', '339966', '003300', '333300', '993300', '993366', '333399', '333333'];

async function xlsxToPdf(file, onStatus) {
  await loadLib('jszip');
  await loadLib('xlsx');
  const buf = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(buf);
  const parse = (s) => new DOMParser().parseFromString(s, 'application/xml');
  const read = async (p) => { const f = zip.file(p); return f ? parse(await f.async('string')) : null; };
  const K = (el, n) => { if (!el) return null; for (const c of el.children) if (c.localName === n) return c; return null; };
  const KS = (el, n) => (el ? [...el.children].filter((c) => c.localName === n) : []);
  const A = (el, n) => { if (!el) return null; for (const a of el.attributes) if (a.localName === n) return a.value; return null; };
  const AN = (el, n, d = null) => { const v = A(el, n); if (v == null || v === '') return d; const x = parseFloat(v); return Number.isFinite(x) ? x : d; };
  const on = (el) => !!el && !/^(0|false)$/i.test(A(el, 'val') || '1');

  const wbx = await read('xl/workbook.xml');
  if (!wbx) throw new Error('Повреждённый XLSX.');
  // значения и их вид (формат чисел, даты) — по правилам Excel, через SheetJS
  const wb = XLSX.read(buf, { type: 'array', cellNF: true, cellText: true, cellDates: false });

  /* ---- тема и цвета ---- */
  const themeColors = [];
  {
    const th = await read('xl/theme/theme1.xml');
    const cs = th && th.getElementsByTagNameNS('*', 'clrScheme')[0];
    if (cs) {
      const get = (n) => { const e = K(cs, n); const v = e && e.firstElementChild; return v ? (A(v, 'val') && v.localName === 'srgbClr' ? A(v, 'val') : A(v, 'lastClr') || '000000') : '000000'; };
      // порядок тем Excel: lt1, dk1, lt2, dk2, accent1–6, hlink, folHlink
      themeColors.push(get('lt1'), get('dk1'), get('lt2'), get('dk2'), get('accent1'), get('accent2'), get('accent3'), get('accent4'), get('accent5'), get('accent6'), get('hlink'), get('folHlink'));
    }
  }
  const tint = (hex, t) => {
    if (!t) return hex;
    const n = parseInt(hex, 16), ch = [n >> 16 & 255, n >> 8 & 255, n & 255].map((c) => Math.round(t < 0 ? c * (1 + t) : c + (255 - c) * t));
    return ch.map((c) => c.toString(16).padStart(2, '0')).join('');
  };
  const colorOf = (el) => {
    if (!el) return null;
    let hex = null;
    const rgb = A(el, 'rgb'), th = A(el, 'theme'), ix = A(el, 'indexed');
    if (rgb) hex = rgb.length === 8 ? rgb.slice(2) : rgb;
    else if (th != null) hex = themeColors[+th] || null;
    else if (ix != null) hex = +ix === 64 ? null : XL_INDEXED[+ix] || null;
    if (!hex) return null;
    return '#' + tint(hex, AN(el, 'tint', 0));
  };

  /* ---- стили ---- */
  const st = await read('xl/styles.xml');
  const sroot = st && st.documentElement;
  const fonts = KS(K(sroot, 'fonts'), 'font').map((f) => ({
    name: A(K(f, 'name'), 'val') || 'Calibri', sz: AN(K(f, 'sz'), 'val', 11),
    b: on(K(f, 'b')), i: on(K(f, 'i')), u: !!K(f, 'u') && A(K(f, 'u'), 'val') !== 'none', s: on(K(f, 'strike')),
    color: colorOf(K(f, 'color')),
  }));
  const fills = KS(K(sroot, 'fills'), 'fill').map((f) => {
    const p = K(f, 'patternFill');
    if (!p || !A(p, 'patternType') || A(p, 'patternType') === 'none') return null;
    return colorOf(K(p, 'fgColor')) || colorOf(K(p, 'bgColor'));
  });
  const BW = { hair: 0.25, thin: 0.5, dotted: 0.5, dashed: 0.5, dashDot: 0.5, dashDotDot: 0.5, medium: 1.2, mediumDashed: 1.2, mediumDashDot: 1.2, mediumDashDotDot: 1.2, slantDashDot: 1.2, thick: 2, double: 1.5 };
  const borders = KS(K(sroot, 'borders'), 'border').map((b) => {
    const side = (n) => { const e = K(b, n) || K(b, n === 'left' ? 'start' : n === 'right' ? 'end' : n); const s = A(e, 'style'); return s && s !== 'none' ? { w: BW[s] || 0.5, color: colorOf(K(e, 'color')) || '#000000' } : null; };
    return { left: side('left'), right: side('right'), top: side('top'), bottom: side('bottom') };
  });
  const xfs = KS(K(sroot, 'cellXfs'), 'xf').map((x) => {
    const al = K(x, 'alignment');
    return { font: fonts[AN(x, 'fontId', 0)] || fonts[0], fill: fills[AN(x, 'fillId', 0)] || null, border: borders[AN(x, 'borderId', 0)] || {},
      h: A(al, 'horizontal'), v: A(al, 'vertical'), wrap: /^(1|true)$/.test(A(al, 'wrapText') || ''), indent: AN(al, 'indent', 0), rot: AN(al, 'textRotation', 0) };
  });
  const defFont = fonts[0] || { name: 'Calibri', sz: 11 };

  /* ---- листы ---- */
  const rels = {};
  {
    const r = await read('xl/_rels/workbook.xml.rels');
    if (r) for (const x of r.getElementsByTagNameNS('*', 'Relationship')) rels[x.getAttribute('Id')] = resolvePath('xl', x.getAttribute('Target'));
  }
  const defined = KS(K(wbx.documentElement, 'definedNames'), 'definedName');
  const sheets = KS(K(wbx.documentElement, 'sheets'), 'sheet').map((s, i) => {
    let rid = ''; for (const a of s.attributes) if (a.localName === 'id' && /relationships/.test(a.namespaceURI || '')) rid = a.value;
    const area = defined.find((d) => A(d, 'name') === '_xlnm.Print_Area' && +A(d, 'localSheetId') === i);
    const titles = defined.find((d) => A(d, 'name') === '_xlnm.Print_Titles' && +A(d, 'localSheetId') === i);
    return { name: A(s, 'name'), hidden: A(s, 'state') && A(s, 'state') !== 'visible', path: rels[rid], area: area && area.textContent, titles: titles && titles.textContent };
  }).filter((s) => !s.hidden && s.path);

  const usedFonts = new Map();
  const useFont = (fam, b, i) => { const k = b && i ? 'bolditalics' : b ? 'bold' : i ? 'italics' : 'normal'; if (!usedFonts.has(fam)) usedFonts.set(fam, new Set()); usedFonts.get(fam).add(k); };
  const content = [];
  let firstOrientation = null, skipped = 0;

  for (let si = 0; si < sheets.length; si++) {
    const sh = sheets[si];
    onStatus && onStatus(`Лист «${sh.name}»…`);
    const sx = await read(sh.path);
    if (!sx) continue;
    const root = sx.documentElement;
    const ws = wb.Sheets[sh.name];
    if (!ws || !ws['!ref']) continue;
    if (K(root, 'drawing')) skipped++;
    // область печати или используемый диапазон
    let range = XLSX.utils.decode_range(ws['!ref']);
    if (sh.area) { try { range = XLSX.utils.decode_range(sh.area.split(',')[0].replace(/^.*!/, '').replace(/\$/g, '')); } catch { /* весь лист */ } }

    // стиль каждой ячейки (индекс s) из XML листа
    const styleAt = {};
    const rowInfo = {};
    for (const row of KS(K(root, 'sheetData'), 'row')) {
      const r = AN(row, 'r', 0) - 1;
      rowInfo[r] = { ht: AN(row, 'ht', null), hidden: A(row, 'hidden') === '1', s: A(row, 'customFormat') === '1' ? AN(row, 's', 0) : null };
      for (const c of KS(row, 'c')) { const s = AN(c, 's', 0); if (s) styleAt[A(c, 'r')] = s; }
    }
    const colInfo = {};
    const fmtPr = K(root, 'sheetFormatPr');
    const defW = AN(fmtPr, 'defaultColWidth', null) ?? (AN(fmtPr, 'baseColWidth', 8) + 0.71);
    const defH = AN(fmtPr, 'defaultRowHeight', 15);
    for (const col of KS(K(root, 'cols'), 'col')) for (let c = AN(col, 'min', 1) - 1; c <= AN(col, 'max', 1) - 1 && c < 16384; c++) colInfo[c] = { w: AN(col, 'width', defW), hidden: A(col, 'hidden') === '1', s: AN(col, 'style', 0) };

    // обрезаем пустые хвосты (без значений, рамок и заливки)
    const has = (r, c) => {
      const a = XLSX.utils.encode_cell({ r, c });
      const cell = ws[a];
      if (cell && cell.v != null && cell.v !== '') return true;
      const x = xfs[styleAt[a] || 0];
      return !!(x && (x.fill || x.border.left || x.border.right || x.border.top || x.border.bottom));
    };
    let r1 = range.e.r, c1 = range.e.c;
    while (r1 > range.s.r && ![...Array(c1 - range.s.c + 1)].some((_, k) => has(r1, range.s.c + k))) r1--;
    while (c1 > range.s.c && ![...Array(r1 - range.s.r + 1)].some((_, k) => has(range.s.r + k, c1))) c1--;
    const rows = [], cols = [];
    for (let r = range.s.r; r <= r1; r++) if (!(rowInfo[r] && rowInfo[r].hidden)) rows.push(r);
    for (let c = range.s.c; c <= c1; c++) if (!(colInfo[c] && colInfo[c].hidden)) cols.push(c);
    if (!rows.length || !cols.length) continue;

    // ширины: символы Excel → pt (как в Excel при шрифте Calibri 11)
    const colW = cols.map((c) => Math.max(2, ((colInfo[c] ? colInfo[c].w : defW) * 7 + 5) * 0.75));
    const rowH = rows.map((r) => (rowInfo[r] && rowInfo[r].ht != null ? rowInfo[r].ht : defH));

    // страница: размер, ориентация, поля, масштаб
    const ps = K(root, 'pageSetup'), pm = K(root, 'pageMargins');
    const fitToPage = A(K(K(root, 'sheetPr'), 'pageSetUpPr'), 'fitToPage') === '1';
    let landscape = A(ps, 'orientation') === 'landscape';
    const paper = AN(ps, 'paperSize', 9) === 8 ? [842, 1191] : [595.28, 841.89];
    const margins = [AN(pm, 'left', 0.7) * 72, AN(pm, 'top', 0.75) * 72, AN(pm, 'right', 0.7) * 72, AN(pm, 'bottom', 0.75) * 72];
    const totalW = colW.reduce((a, b) => a + b, 0);
    const availW = (o) => (o ? paper[1] : paper[0]) - margins[0] - margins[2];
    // широкая таблица на книжном листе, если явно не задано — переворачиваем
    if (!A(ps, 'orientation') && totalW > availW(false) && totalW <= availW(true) * 1.6) landscape = true;
    let k = AN(ps, 'scale', 100) / 100;
    if (fitToPage && AN(ps, 'fitToWidth', 1) >= 1) k = Math.min(1, availW(landscape) / totalW);
    if (totalW * k > availW(landscape)) k = availW(landscape) / totalW; // в PDF всё должно влезать по ширине
    k = Math.max(0.3, k);
    if (firstOrientation == null) firstOrientation = { landscape, paper, margins };

    // объединённые ячейки
    const merges = (ws['!merges'] || []).map((m) => ({ ...m }));
    const mergeAt = {};
    for (const m of merges) mergeAt[XLSX.utils.encode_cell(m.s)] = m;
    const covered = new Set();
    for (const m of merges) for (let r = m.s.r; r <= m.e.r; r++) for (let c = m.s.c; c <= m.e.c; c++) if (r !== m.s.r || c !== m.s.c) covered.add(r + ':' + c);

    const R = rows.length, C = cols.length;
    const ri = new Map(rows.map((r, i) => [r, i])), ci = new Map(cols.map((c, i) => [c, i]));
    // границы: у края ячейки — своя рамка или рамка соседа; видна, если её задал хоть один
    const H = Array.from({ length: R + 1 }, () => Array(C).fill(null));
    const V = Array.from({ length: R }, () => Array(C + 1).fill(null));
    const heavier = (a, b) => (!a ? b : !b ? a : b.w > a.w ? b : a);
    const gridLines = A(K(root, 'printOptions'), 'gridLines') === '1';
    const thin = { w: 0.25, color: '#c8c8c8' };
    const xfAt = (r, c) => xfs[styleAt[XLSX.utils.encode_cell({ r, c })] ?? (rowInfo[r] && rowInfo[r].s) ?? (colInfo[c] && colInfo[c].s) ?? 0] || xfs[0] || { font: defFont, border: {} };
    for (let i = 0; i < R; i++) for (let j = 0; j < C; j++) {
      const r = rows[i], c = cols[j];
      if (covered.has(r + ':' + c)) continue;
      const m = mergeAt[XLSX.utils.encode_cell({ r, c })];
      // объединение: правая/нижняя граница берётся у последней ячейки
      const i2 = m ? Math.max(i, ...rows.map((x, ii) => (x <= m.e.r ? ii : -1))) + 1 : i + 1;
      const j2 = m ? Math.max(j, ...cols.map((x, jj) => (x <= m.e.c ? jj : -1))) + 1 : j + 1;
      const b = xfAt(r, c).border;
      const bEnd = m ? xfAt(m.e.r, m.e.c).border : b;
      for (let jj = j; jj < j2; jj++) { H[i][jj] = heavier(H[i][jj], b.top || (gridLines && thin)); H[i2][jj] = heavier(H[i2][jj], bEnd.bottom || b.bottom || (gridLines && thin)); }
      for (let ii = i; ii < i2; ii++) { V[ii][j] = heavier(V[ii][j], b.left || (gridLines && thin)); V[ii][j2] = heavier(V[ii][j2], bEnd.right || b.right || (gridLines && thin)); }
    }

    // текст без «переноса по словам» в Excel заходит на пустые соседние ячейки справа — повторяем это
    const overflow = {}, overCovered = new Set();
    for (let i = 0; i < R; i++) for (let j = 0; j < C; j++) {
      const r = rows[i], c = cols[j];
      const a = XLSX.utils.encode_cell({ r, c });
      const cell = ws[a];
      if (!cell || cell.t !== 's' || covered.has(r + ':' + c) || mergeAt[a]) continue;
      const x = xfAt(r, c);
      if (x.wrap || (x.h && !['left', 'general'].includes(x.h))) continue;
      const text = cell.w != null ? cell.w : String(cell.v);
      const need = text.length * (x.font || defFont).sz * k * 0.5 + 4;
      let span = 1, have = colW[j] * k;
      while (have < need && j + span < C) {
        const r2 = rows[i], c2 = cols[j + span], a2 = XLSX.utils.encode_cell({ r: r2, c: c2 });
        const nb = ws[a2];
        if ((nb && nb.v != null && nb.v !== '') || covered.has(r2 + ':' + c2) || mergeAt[a2] || V[i][j + span] || xfAt(r2, c2).fill) break;
        have += colW[j + span] * k;
        span++;
      }
      if (span > 1) { overflow[i + ':' + j] = span; for (let s2 = 1; s2 < span; s2++) overCovered.add(i + ':' + (j + s2)); }
    }

    const body = [];
    for (let i = 0; i < R; i++) {
      const out = [];
      for (let j = 0; j < C; j++) {
        const r = rows[i], c = cols[j];
        if (covered.has(r + ':' + c) || overCovered.has(i + ':' + j)) { out.push({}); continue; }
        const a = XLSX.utils.encode_cell({ r, c });
        const cell = ws[a];
        const x = xfAt(r, c);
        const f = x.font || defFont;
        const m = mergeAt[a];
        const cs = m ? cols.filter((cc) => cc >= m.s.c && cc <= m.e.c).length : (overflow[i + ':' + j] || 1);
        const rs = m ? rows.filter((rr) => rr >= m.s.r && rr <= m.e.r).length : 1;
        let text = cell ? (cell.w != null ? cell.w : cell.v != null ? String(cell.v) : '') : '';
        if (cell && cell.t === 'e') text = cell.w || '#ERR';
        const fam = docxPdfFont(f.name);
        useFont(fam, f.b, f.i);
        const isNum = cell && (cell.t === 'n' || cell.t === 'd');
        const h = x.h && x.h !== 'general' ? x.h : isNum ? 'right' : cell && cell.t === 'b' ? 'center' : 'left';
        const node = {
          text: text === '' ? ' ' : text, font: fam, fontSize: Math.max(3, f.sz * k), bold: f.b || undefined, italics: f.i || undefined,
          color: f.color || undefined, decoration: [f.u && 'underline', f.s && 'lineThrough'].filter(Boolean),
          alignment: { center: 'center', centerContinuous: 'center', right: 'right', justify: 'justify', distributed: 'justify' }[h] || 'left',
          border: [!!V[i][j], !!H[i][j], !!V[i][j + cs], !!H[Math.min(R, i + rs)][j]],
          borderColor: [(V[i][j] || {}).color || '#000', (H[i][j] || {}).color || '#000', (V[i][j + cs] || {}).color || '#000', (H[Math.min(R, i + rs)][j] || {}).color || '#000'],
          margin: [2 * k + x.indent * 7 * k, 1 * k, 2 * k, 1 * k],
        };
        if (!node.decoration.length) delete node.decoration;
        if (x.fill) node.fillColor = x.fill;
        if (cs > 1) node.colSpan = cs;
        if (rs > 1) node.rowSpan = rs;
        // вертикальное выравнивание: у Excel по умолчанию — по нижнему краю
        const lines = Math.max(1, String(text).split('\n').length);
        const free = rowH[i] * k - f.sz * k * 1.2 * lines - 2 * k;
        if (rs === 1 && free > 1 && x.v !== 'top') node.margin[1] += x.v === 'center' ? free / 2 : free;
        out.push(node);
      }
      body.push(out);
    }
    const widths = colW.map((w) => w * k);
    // повтор шапки (сквозные строки)
    let headerRows = 0;
    if (sh.titles) { const mt = /\$?(\d+):\$?(\d+)/.exec(sh.titles); if (mt) headerRows = rows.filter((r) => r >= +mt[1] - 1 && r <= +mt[2] - 1).length; }
    const table = {
      table: { widths, heights: rowH.map((hh) => hh * k), body, headerRows: headerRows || undefined, dontBreakRows: true },
      layout: {
        hLineWidth: (ii, node) => { const row = H[ii] || []; const w = row.filter(Boolean).map((b) => b.w); return w.length ? Math.max(...w) : 0.5; },
        vLineWidth: (jj) => { const w = V.map((r) => r[jj]).filter(Boolean).map((b) => b.w); return w.length ? Math.max(...w) : 0.5; },
        paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 0, paddingBottom: () => 0,
      },
    };
    if (content.length) content.push({ text: '', pageBreak: 'after', pageOrientation: landscape ? 'landscape' : 'portrait' });
    // заголовок листа, если листов несколько
    if (sheets.length > 1) { useFont('Arimo', true, false); content.push({ text: sh.name, font: 'Arimo', bold: true, fontSize: 9, color: '#666', margin: [0, 0, 0, 4] }); }
    content.push(table);
  }
  if (!content.length) throw new Error('В книге нет данных для печати.');
  await loadLib('pdfmake');
  await loadLib('pdfmakeFonts');
  await docxLoadFonts(usedFonts, onStatus);
  const o = firstOrientation;
  const dd = {
    pageSize: { width: o.paper[0], height: o.paper[1] }, pageOrientation: o.landscape ? 'landscape' : 'portrait',
    pageMargins: o.margins, content, defaultStyle: { font: docxPdfFont(defFont.name), fontSize: defFont.sz },
    info: { title: baseOf(file.name) },
  };
  onStatus && onStatus('Создание PDF…');
  const blob = await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Вёрстка PDF заняла слишком много времени.')), Math.max(90000, layoutTimeout(file.size * 4)));
    try { pdfMake.createPdf(dd).getBlob((b) => { clearTimeout(t); resolve(b); }); } catch (e) { clearTimeout(t); reject(e); }
  });
  return { blob, skipped };
}
