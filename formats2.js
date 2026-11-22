'use strict';

/* =====================================================================
   BullConvert — ещё форматы:
   PSD/TGA, PPTX (слайды-картинки из PDF и фото), контакты VCF, календарь ICS,
   SQL и NDJSON, субтитры ASS/SSA, архивы TAR/GZ в браузере, шрифты TTF/OTF ↔ WOFF.
   ===================================================================== */

/* ---------------------------- PSD (Photoshop) и TGA ---------------------------- */

/** PSD: берём сведённое изображение (то, что Photoshop сохраняет для совместимости) */
async function psdToCanvas(file) {
  const b = new Uint8Array(await file.arrayBuffer());
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (String.fromCharCode(...b.subarray(0, 4)) !== '8BPS') throw new Error('Это не файл Photoshop (PSD).');
  if (dv.getUint16(4) !== 1) throw new Error('Большие документы PSB не поддерживаются — сохраните как PSD.');
  const ch = dv.getUint16(12), h = dv.getUint32(14), w = dv.getUint32(18), depth = dv.getUint16(22), mode = dv.getUint16(24);
  if (![8, 16].includes(depth)) throw new Error(`PSD с глубиной ${depth} бит не поддерживается.`);
  let o = 26;
  for (let s = 0; s < 3; s++) o += 4 + dv.getUint32(o); // цветовая таблица, ресурсы, слои — пропускаем
  const comp = dv.getUint16(o); o += 2;
  const bpc = depth / 8, rowBytes = w * bpc, planes = [];
  const nch = Math.min(ch, mode === 4 ? 5 : 4);
  if (comp === 1) { // PackBits: сначала длины всех строк всех каналов
    const counts = [];
    for (let i = 0; i < h * ch; i++) { counts.push(dv.getUint16(o)); o += 2; }
    for (let c = 0; c < ch; c++) {
      const plane = new Uint8Array(rowBytes * h);
      for (let y = 0; y < h; y++) {
        let p = y * rowBytes;
        const end = o + counts[c * h + y], rowEnd = (y + 1) * rowBytes;
        while (o < end && p < rowEnd) {
          const n = b[o++];
          if (n < 128) { plane.set(b.subarray(o, o + n + 1), p); p += n + 1; o += n + 1; }
          else if (n > 128) { plane.fill(b[o++], p, p + 257 - n); p += 257 - n; }
        }
        o = end;
      }
      if (c < nch) planes.push(plane);
    }
  } else if (comp === 0) {
    for (let c = 0; c < nch; c++) { planes.push(b.subarray(o, o + rowBytes * h)); o += rowBytes * h; }
  } else throw new Error('Этот способ сжатия PSD не поддерживается.');
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const g = canvas.getContext('2d'), img = g.createImageData(w, h), d = img.data;
  const at = (pl, i) => (pl ? pl[i * bpc] : 255); // 16 бит — старший байт
  for (let i = 0; i < w * h; i++) {
    let r, gg, bb, a = 255;
    if (mode === 3) { r = at(planes[0], i); gg = at(planes[1], i); bb = at(planes[2], i); if (planes[3]) a = at(planes[3], i); }
    else if (mode === 4) { const k = at(planes[3], i) / 255; r = at(planes[0], i) * k; gg = at(planes[1], i) * k; bb = at(planes[2], i) * k; if (planes[4]) a = at(planes[4], i); }
    else { r = gg = bb = at(planes[0], i); if (planes[1]) a = at(planes[1], i); }
    d[i * 4] = r; d[i * 4 + 1] = gg; d[i * 4 + 2] = bb; d[i * 4 + 3] = a;
  }
  g.putImageData(img, 0, 0);
  return canvas;
}

async function tgaToCanvas(file) {
  const b = new Uint8Array(await file.arrayBuffer());
  const idLen = b[0], cmType = b[1], type = b[2], w = b[12] | (b[13] << 8), h = b[14] | (b[15] << 8), bpp = b[16], desc = b[17];
  if (![2, 3, 10, 11].includes(type) || cmType || !w || !h) throw new Error('Этот вариант TGA не поддерживается (палитра или неизвестный тип).');
  const px = bpp / 8, n = w * h, raw = new Uint8Array(n * px);
  let o = 18 + idLen;
  if (type === 2 || type === 3) raw.set(b.subarray(o, o + n * px));
  else for (let p = 0; p < n * px && o < b.length;) {
    const hd = b[o++], cnt = (hd & 127) + 1;
    if (hd & 128) { for (let k = 0; k < cnt; k++) { raw.set(b.subarray(o, o + px), p); p += px; } o += px; }
    else { raw.set(b.subarray(o, o + cnt * px), p); p += cnt * px; o += cnt * px; }
  }
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const g = canvas.getContext('2d'), img = g.createImageData(w, h), d = img.data, top = desc & 0x20;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const s = (y * w + x) * px, t = ((top ? y : h - 1 - y) * w + x) * 4;
    if (px === 1) d[t] = d[t + 1] = d[t + 2] = raw[s];
    else if (px === 2) { const v = raw[s] | (raw[s + 1] << 8); d[t] = ((v >> 10) & 31) * 8.2; d[t + 1] = ((v >> 5) & 31) * 8.2; d[t + 2] = (v & 31) * 8.2; }
    else { d[t] = raw[s + 2]; d[t + 1] = raw[s + 1]; d[t + 2] = raw[s]; }
    d[t + 3] = px === 4 ? raw[s + 3] : 255;
  }
  g.putImageData(img, 0, 0);
  return canvas;
}

/* ---------------------------- PPTX из картинок (страницы PDF, фото) ---------------------------- */

/** slides: [{ blob (JPEG/PNG), w, h }] → презентация, каждая картинка по центру слайда */
async function imagesToPptx(slides) {
  if (!slides.length) throw new Error('Нет страниц для презентации.');
  await loadLib('jszip');
  const P = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
  const RT = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships', PT = 'application/vnd.openxmlformats-officedocument.presentationml';
  const X = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const REL = X + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">';
  const cx = 12192000, cy = Math.max(914400, Math.round(cx * slides[0].h / slides[0].w));
  const tree = (inner) => `<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${inner}</p:spTree></p:cSld>`;
  const zip = new JSZip();
  const ct = [], prel = [], ids = [];
  slides.forEach((s, i) => {
    const n = i + 1, ext = s.blob.type === 'image/png' ? 'png' : 'jpeg';
    const k = Math.min(cx / s.w, cy / s.h), w = Math.round(s.w * k), h = Math.round(s.h * k);
    zip.file(`ppt/media/image${n}.${ext}`, s.blob);
    zip.file(`ppt/slides/slide${n}.xml`, `${X}<p:sld ${P}>${tree(`<p:pic><p:nvPicPr><p:cNvPr id="2" name="Страница ${n}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="${Math.round((cx - w) / 2)}" y="${Math.round((cy - h) / 2)}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`)}<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`);
    zip.file(`ppt/slides/_rels/slide${n}.xml.rels`, `${REL}<Relationship Id="rId1" Type="${RT}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="${RT}/image" Target="../media/image${n}.${ext}"/></Relationships>`);
    ct.push(`<Override PartName="/ppt/slides/slide${n}.xml" ContentType="${PT}.slide+xml"/>`);
    prel.push(`<Relationship Id="rIdS${n}" Type="${RT}/slide" Target="slides/slide${n}.xml"/>`);
    ids.push(`<p:sldId id="${255 + n}" r:id="rIdS${n}"/>`);
  });
  const clr = (n, v) => `<a:${n}><a:srgbClr val="${v}"/></a:${n}>`;
  zip.file('[Content_Types].xml', `${X}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/>` +
    `<Override PartName="/ppt/presentation.xml" ContentType="${PT}.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="${PT}.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="${PT}.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>${ct.join('')}</Types>`);
  zip.file('_rels/.rels', `${REL}<Relationship Id="rId1" Type="${RT}/officeDocument" Target="ppt/presentation.xml"/></Relationships>`);
  zip.file('ppt/presentation.xml', `${X}<p:presentation ${P}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rIdM"/></p:sldMasterIdLst><p:sldIdLst>${ids.join('')}</p:sldIdLst><p:sldSz cx="${cx}" cy="${cy}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`);
  zip.file('ppt/_rels/presentation.xml.rels', `${REL}${prel.join('')}<Relationship Id="rIdM" Type="${RT}/slideMaster" Target="slideMasters/slideMaster1.xml"/><Relationship Id="rIdT" Type="${RT}/theme" Target="theme/theme1.xml"/></Relationships>`);
  zip.file('ppt/slideLayouts/slideLayout1.xml', `${X}<p:sldLayout ${P} type="blank">${tree('')}</p:sldLayout>`);
  zip.file('ppt/slideLayouts/_rels/slideLayout1.xml.rels', `${REL}<Relationship Id="rId1" Type="${RT}/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`);
  zip.file('ppt/slideMasters/slideMaster1.xml', `${X}<p:sldMaster ${P}>${tree('')}<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`);
  zip.file('ppt/slideMasters/_rels/slideMaster1.xml.rels', `${REL}<Relationship Id="rId1" Type="${RT}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="${RT}/theme" Target="../theme/theme1.xml"/></Relationships>`);
  zip.file('ppt/theme/theme1.xml', `${X}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="BullConvert"><a:themeElements><a:clrScheme name="BC">${clr('dk1', '000000')}${clr('lt1', 'FFFFFF')}${clr('dk2', '1F2937')}${clr('lt2', 'F3F4F6')}` +
    [1, 2, 3, 4, 5, 6].map((i) => clr('accent' + i, '3B5BDB')).join('') + `${clr('hlink', '3B5BDB')}${clr('folHlink', '7048E8')}</a:clrScheme>` +
    '<a:fontScheme name="BC"><a:majorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>' +
    '<a:fmtScheme name="BC"><a:fillStyleLst><a:noFill/><a:noFill/><a:noFill/></a:fillStyleLst><a:lnStyleLst><a:ln/><a:ln/><a:ln/></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:noFill/><a:noFill/><a:noFill/></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>');
  return zip.generateAsync({ type: 'blob', mimeType: MIME.pptx });
}

/** PDF/DjVu → PPTX: каждая страница — слайд */
async function pagesToPptx(file, ext, opts, onProgress, onStatus) {
  const slides = [];
  const q = Math.min(0.95, Math.max(0.7, opts.quality || 0.9));
  for await (const pg of pagesOf(file, ext)) {
    onStatus(`Страница ${pg.index} из ${pg.total}…`);
    const c = await pg.canvas();
    slides.push({ blob: await canvasToBlob(c, 'image/jpeg', q), w: c.width, h: c.height });
    c.width = c.height = 0;
    if (pg.release) pg.release();
    onProgress(pg.index / pg.total * 0.9);
  }
  return { blob: await imagesToPptx(slides), ext: 'pptx', note: `слайдов: ${slides.length}` };
}

/* ---------------------------- Контакты VCF ---------------------------- */

const vcfUnescape = (s) => String(s).replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');

function parseVcf(text) {
  // перенос длинных строк: следующая строка начинается с пробела; в QUOTED-PRINTABLE — «=» в конце
  const lines = text.replace(/\r\n?/g, '\n').replace(/=\n/g, '').replace(/\n[ \t]/g, '').split('\n');
  const rows = [];
  let cur = null;
  for (const line of lines) {
    if (/^BEGIN:VCARD/i.test(line)) { cur = {}; continue; }
    if (/^END:VCARD/i.test(line)) { if (cur && Object.keys(cur).length) rows.push(cur); cur = null; continue; }
    if (!cur) continue;
    const i = line.indexOf(':');
    if (i < 0) continue;
    const [nameRaw, ...params] = line.slice(0, i).split(';');
    const name = nameRaw.replace(/^item\d+\./i, '').toUpperCase();
    const pstr = params.join(';').toUpperCase();
    let val = line.slice(i + 1);
    if (/QUOTED-PRINTABLE/.test(pstr)) {
      const cs = (pstr.match(/CHARSET=([\w-]+)/) || [])[1] || 'utf-8';
      try { val = new TextDecoder(cs.toLowerCase()).decode(qpBytes(val)); } catch { /* как есть */ }
    }
    const put = (k, v) => { v = vcfUnescape(v).trim(); if (!v) return; let key = k, n = 2; while (cur[key]) key = `${k} ${n++}`; cur[key] = v; };
    const type = (pstr.match(/TYPE=([\w,]+)/) || [])[1] || pstr;
    switch (name) {
      case 'FN': put('Имя', val); break;
      case 'N': { const p = val.split(';'); if (!cur['Имя']) put('Имя', [p[1], p[2], p[0]].filter(Boolean).join(' ')); break; }
      case 'TEL': put(/CELL/.test(type) ? 'Мобильный' : /WORK/.test(type) ? 'Рабочий телефон' : /HOME/.test(type) ? 'Домашний телефон' : 'Телефон', val); break;
      case 'EMAIL': put('Email', val); break;
      case 'ORG': put('Организация', val.split(';').filter(Boolean).join(', ')); break;
      case 'TITLE': put('Должность', val); break;
      case 'ADR': put('Адрес', val.split(';').map(vcfUnescape).filter((x) => x.trim()).join(', ')); break;
      case 'BDAY': put('День рождения', val.replace(/^(\d{4})-?(\d{2})-?(\d{2}).*/, '$3.$2.$1')); break;
      case 'URL': put('Сайт', val); break;
      case 'NOTE': put('Заметка', val); break;
    }
  }
  if (!rows.length) throw new Error('В файле не найдено ни одного контакта (BEGIN:VCARD).');
  return rows;
}

const pickCol = (cols, re) => cols.find((c) => re.test(c));

function rowsToVcf(rows) {
  const cols = columnsOf(rows);
  const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
  const nameC = pickCol(cols, /^(имя|фио|name|full ?name|контакт)$/i) || pickCol(cols, /имя|name|фио/i);
  const telCs = cols.filter((c) => /тел|phone|мобил|mobile|cell/i.test(c));
  const mailCs = cols.filter((c) => /mail|почт/i.test(c));
  const orgC = pickCol(cols, /организ|компан|company|org/i), titleC = pickCol(cols, /должн|title|position/i);
  const adrC = pickCol(cols, /адрес|address/i), noteC = pickCol(cols, /замет|коммент|note/i), bdayC = pickCol(cols, /рожд|birth/i), urlC = pickCol(cols, /сайт|url|web/i);
  if (!nameC && !telCs.length) throw new Error('Для контактов нужна колонка «Имя» или «Телефон».');
  const out = [];
  for (const r of rows) {
    const fn = String((nameC && r[nameC]) ?? '').trim() || String(r[telCs[0]] ?? '').trim();
    if (!fn) continue;
    const v = ['BEGIN:VCARD', 'VERSION:3.0', `FN:${esc(fn)}`, `N:;${esc(fn)};;;`];
    for (const c of telCs) if (r[c]) v.push(`TEL;TYPE=${/мобил|mobile|cell/i.test(c) ? 'CELL' : /рабоч|work/i.test(c) ? 'WORK' : 'VOICE'}:${String(r[c]).trim()}`);
    for (const c of mailCs) if (r[c]) v.push(`EMAIL;TYPE=INTERNET:${String(r[c]).trim()}`);
    if (orgC && r[orgC]) v.push(`ORG:${esc(r[orgC])}`);
    if (titleC && r[titleC]) v.push(`TITLE:${esc(r[titleC])}`);
    if (adrC && r[adrC]) v.push(`ADR:;;${esc(r[adrC])};;;;`);
    if (bdayC && r[bdayC]) { const m = String(r[bdayC]).match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/); v.push(`BDAY:${m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : r[bdayC]}`); }
    if (urlC && r[urlC]) v.push(`URL:${r[urlC]}`);
    if (noteC && r[noteC]) v.push(`NOTE:${esc(r[noteC])}`);
    v.push('END:VCARD');
    out.push(v.join('\r\n'));
  }
  if (!out.length) throw new Error('Не найдено ни одного контакта: колонки «Имя» и «Телефон» пустые.');
  return out.join('\r\n') + '\r\n';
}

/* ---------------------------- Календарь ICS ---------------------------- */

function icsDate(v, allDay) {
  const m = String(v).match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?/);
  if (!m) return v;
  if (!m[4] || allDay) return `${m[3]}.${m[2]}.${m[1]}`;
  const d = m[7] ? new Date(Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0))) : new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5]);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function parseIcs(text) {
  const lines = text.replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const rows = [];
  let ev = null;
  for (const line of lines) {
    if (/^BEGIN:VEVENT/i.test(line)) { ev = {}; continue; }
    if (/^END:VEVENT/i.test(line)) {
      if (ev) rows.push({ 'Начало': ev.start || '', 'Конец': ev.end || '', 'Событие': ev.summary || '', 'Место': ev.location || '', 'Описание': ev.description || '' });
      ev = null; continue;
    }
    if (!ev) continue;
    const i = line.indexOf(':');
    if (i < 0) continue;
    const head = line.slice(0, i).toUpperCase(), val = line.slice(i + 1), allDay = /VALUE=DATE(?!-)/.test(head);
    const key = head.split(';')[0];
    if (key === 'DTSTART') ev.start = icsDate(val, allDay);
    else if (key === 'DTEND') ev.end = icsDate(val, allDay);
    else if (key === 'SUMMARY') ev.summary = vcfUnescape(val);
    else if (key === 'LOCATION') ev.location = vcfUnescape(val);
    else if (key === 'DESCRIPTION') ev.description = vcfUnescape(val);
  }
  if (!rows.length) throw new Error('В календаре не найдено ни одного события (BEGIN:VEVENT).');
  return rows;
}

function rowsToIcs(rows) {
  const cols = columnsOf(rows);
  const startC = pickCol(cols, /^(начало|start|дата|date|когда)/i) || pickCol(cols, /начал|start|дата|date/i);
  const endC = pickCol(cols, /^(конец|end|окончан)/i);
  const sumC = pickCol(cols, /событ|назван|тема|summary|title|subject/i);
  const locC = pickCol(cols, /мест|location|где/i), descC = pickCol(cols, /опис|description|заметк|коммент/i);
  if (!startC || !sumC) throw new Error('Для календаря нужны колонки «Начало» (дата) и «Событие» (название).');
  const p = (n) => String(n).padStart(2, '0');
  const toIcs = (v) => {
    const s = String(v ?? '').trim();
    let m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[ T,]+(\d{1,2}):(\d{2}))?/);
    if (m) return m[4] ? `${m[3]}${p(m[2])}${p(m[1])}T${p(m[4])}${m[5]}00` : `${m[3]}${p(m[2])}${p(m[1])}`;
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
    if (m) return m[4] ? `${m[1]}${m[2]}${m[3]}T${m[4]}${m[5]}00` : `${m[1]}${m[2]}${m[3]}`;
    return null;
  };
  const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const out = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//BullConvert//RU', 'CALSCALE:GREGORIAN'];
  let n = 0;
  rows.forEach((r, i) => {
    const st = toIcs(r[startC]);
    if (!st) return;
    const en = (endC && toIcs(r[endC])) || st;
    out.push('BEGIN:VEVENT', `UID:bc-${stamp}-${i}@bullconvert`, `DTSTAMP:${stamp}`,
      `DTSTART${st.length === 8 ? ';VALUE=DATE' : ''}:${st}`, `DTEND${en.length === 8 ? ';VALUE=DATE' : ''}:${en}`, `SUMMARY:${esc(r[sumC] ?? '')}`);
    if (locC && r[locC]) out.push(`LOCATION:${esc(r[locC])}`);
    if (descC && r[descC]) out.push(`DESCRIPTION:${esc(r[descC])}`);
    out.push('END:VEVENT');
    n++;
  });
  out.push('END:VCALENDAR');
  if (!n) throw new Error('Не удалось прочитать даты: укажите их как 20.11.2026 10:00 или 2026-11-20.');
  return out.join('\r\n') + '\r\n';
}

/* ---------------------------- SQL и NDJSON ---------------------------- */

function rowsToSql(sheets, title) {
  const ident = (s) => '"' + String(s).replace(/"/g, '""') + '"';
  const num = (v) => typeof v === 'number' || /^-?\d+(\.\d+)?$/.test(String(v));
  const lit = (v) => (v === '' || v == null ? 'NULL' : num(v) ? String(v) : "'" + String(v).replace(/'/g, "''") + "'");
  const out = [`-- BullConvert: ${title}`, ''];
  for (const s of sheets) {
    const cols = columnsOf(s.rows);
    if (!cols.length) continue;
    const t = ident((sheets.length > 1 ? s.name : title).replace(/\s+/g, '_').slice(0, 60) || 'data');
    const type = (c) => {
      const vals = s.rows.map((r) => r[c]).filter((v) => v !== '' && v != null);
      if (vals.length && vals.every((v) => /^-?\d+$/.test(String(v)))) return 'INTEGER';
      return vals.length && vals.every(num) ? 'REAL' : 'TEXT';
    };
    out.push(`CREATE TABLE ${t} (`, cols.map((c) => `  ${ident(c)} ${type(c)}`).join(',\n'), ');', '');
    for (let i = 0; i < s.rows.length; i += 500) {
      out.push(`INSERT INTO ${t} (${cols.map(ident).join(', ')}) VALUES`);
      out.push(s.rows.slice(i, i + 500).map((r) => `  (${cols.map((c) => lit(r[c])).join(', ')})`).join(',\n') + ';');
    }
    out.push('');
  }
  return out.join('\n');
}

function parseNdjson(text) {
  const rows = [];
  text.replace(/\r/g, '').split('\n').forEach((l, i) => {
    if (!l.trim()) return;
    let v;
    try { v = JSON.parse(l); } catch { throw new Error(`Ошибка в строке ${i + 1}: это не JSON.`); }
    rows.push(v && typeof v === 'object' && !Array.isArray(v) ? v : { 'значение': v });
  });
  if (!rows.length) throw new Error('Файл пустой: нет ни одной строки JSON.');
  return rows;
}

/* ---------------------------- Субтитры ASS/SSA ---------------------------- */

function parseAss(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let fmt = null, inEvents = false;
  const cues = [];
  for (const l of lines) {
    const t = l.trim();
    if (/^\[events\]/i.test(t)) { inEvents = true; continue; }
    if (/^\[/.test(t)) { inEvents = false; continue; }
    if (!inEvents) continue;
    if (/^format:/i.test(t)) fmt = t.slice(7).split(',').map((s) => s.trim().toLowerCase());
    else if (/^dialogue:/i.test(t) && fmt) {
      const parts = t.slice(9).split(',');
      const f = (k) => (parts[fmt.indexOf(k)] || '').trim();
      const body = parts.slice(fmt.indexOf('text')).join(',').replace(/\{[^}]*\}/g, '').replace(/\\N/gi, '\n').replace(/\\h/g, ' ').trim();
      const start = subTime(f('start')), end = subTime(f('end'));
      if (body && !isNaN(start) && !isNaN(end)) cues.push({ start, end, text: body });
    }
  }
  if (!cues.length) throw new Error('В файле ASS/SSA не найдено ни одной реплики (строки Dialogue).');
  return cues.sort((a, b) => a.start - b.start);
}

/* ---------------------------- Архивы TAR, GZ, TGZ в браузере ---------------------------- */

async function gunzip(blob) {
  if (typeof DecompressionStream !== 'function') throw new Error('Браузер не умеет распаковывать GZ — обновите его.');
  try { return new Uint8Array(await new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()); }
  catch { throw new Error('Архив GZ повреждён.'); }
}

function untar(u8) {
  const out = [];
  const str = (o, n) => { let e = o; while (e < o + n && u8[e]) e++; return new TextDecoder('utf-8').decode(u8.subarray(o, e)); };
  let o = 0, longName = null;
  while (o + 512 <= u8.length) {
    if (u8.subarray(o, o + 512).every((b) => b === 0)) break;
    let name = str(o, 100);
    const size = parseInt(str(o + 124, 12).trim() || '0', 8) || 0, type = String.fromCharCode(u8[o + 156] || 48);
    const prefix = str(o + 345, 155);
    if (prefix && str(o + 257, 5) === 'ustar') name = prefix + '/' + name;
    const data = u8.subarray(o + 512, o + 512 + size);
    if (type === 'L') longName = str(o + 512, size); // длинное имя GNU
    else if (type === '0' || type === '7') {
      const full = (longName || name).replace(/^\.\//, '');
      longName = null;
      if (full && !/(^|\/)(__MACOSX|\.DS_Store)/.test(full)) out.push({ file: new File([data.slice()], full.split('/').pop()), path: dirOf(full) });
    } else if (type !== 'x' && type !== 'g') longName = null;
    o += 512 + Math.ceil(size / 512) * 512;
  }
  return out;
}

async function extractTarGz(file, ext) {
  let u8 = new Uint8Array(await file.arrayBuffer());
  if (u8[0] === 0x1f && u8[1] === 0x8b) u8 = await gunzip(file);
  else if (ext === 'gz' || ext === 'tgz') throw new Error('Архив GZ повреждён (нет подписи gzip).');
  const isTar = u8.length > 262 && String.fromCharCode(...u8.subarray(257, 262)) === 'ustar';
  // внутри .gz может быть не архив, а один сжатый файл
  if (!isTar && ext !== 'tar') return [{ file: new File([u8], baseOf(file.name) || 'файл'), path: '' }];
  return untar(u8);
}

/* ---------------------------- Шрифты TTF/OTF ↔ WOFF ---------------------------- */

async function zlibStream(u8, mode) {
  const s = new Blob([u8]).stream().pipeThrough(mode === 'c' ? new CompressionStream('deflate') : new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

async function sfntToWoff(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const flavor = dv.getUint32(0), n = dv.getUint16(4);
  if (![0x00010000, 0x4F54544F, 0x74727565].includes(flavor)) throw new Error('Это не шрифт TrueType/OpenType.');
  const tables = [];
  for (let i = 0; i < n; i++) {
    const e = 12 + i * 16;
    tables.push({ tag: dv.getUint32(e), sum: dv.getUint32(e + 4), off: dv.getUint32(e + 8), len: dv.getUint32(e + 12) });
  }
  let sfntSize = 12 + 16 * n;
  const datas = [];
  for (const t of tables) {
    const orig = u8.subarray(t.off, t.off + t.len);
    const comp = await zlibStream(orig, 'c');
    datas.push(comp.length < orig.length ? comp : orig);
    sfntSize += (t.len + 3) & ~3;
  }
  let size = 44 + 20 * n;
  const offs = datas.map((d) => { const o = size; size += (d.length + 3) & ~3; return o; });
  const out = new Uint8Array(size), ov = new DataView(out.buffer);
  ov.setUint32(0, 0x774F4646); ov.setUint32(4, flavor); ov.setUint32(8, size); ov.setUint16(12, n); ov.setUint32(16, sfntSize); ov.setUint16(20, 1);
  tables.forEach((t, i) => {
    const e = 44 + i * 20;
    ov.setUint32(e, t.tag); ov.setUint32(e + 4, offs[i]); ov.setUint32(e + 8, datas[i].length); ov.setUint32(e + 12, t.len); ov.setUint32(e + 16, t.sum);
    out.set(datas[i], offs[i]);
  });
  return out;
}

async function woffToSfnt(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (dv.getUint32(0) !== 0x774F4646) throw new Error(dv.getUint32(0) === 0x774F4632 ? 'WOFF2 пока не поддерживается — нужен WOFF, TTF или OTF.' : 'Это не шрифт WOFF.');
  const flavor = dv.getUint32(4), n = dv.getUint16(12);
  const tables = [];
  for (let i = 0; i < n; i++) {
    const e = 44 + i * 20;
    const t = { tag: dv.getUint32(e), off: dv.getUint32(e + 4), comp: dv.getUint32(e + 8), len: dv.getUint32(e + 12), sum: dv.getUint32(e + 16) };
    const raw = u8.subarray(t.off, t.off + t.comp);
    t.data = t.comp < t.len ? await zlibStream(raw, 'd') : raw;
    tables.push(t);
  }
  let size = 12 + 16 * n;
  const offs = tables.map((t) => { const o = size; size += (t.len + 3) & ~3; return o; });
  const out = new Uint8Array(size), ov = new DataView(out.buffer);
  let es = 0;
  while ((1 << (es + 1)) <= n) es++;
  ov.setUint32(0, flavor); ov.setUint16(4, n); ov.setUint16(6, (1 << es) * 16); ov.setUint16(8, es); ov.setUint16(10, n * 16 - (1 << es) * 16);
  tables.forEach((t, i) => {
    const e = 12 + i * 16;
    ov.setUint32(e, t.tag); ov.setUint32(e + 4, t.sum); ov.setUint32(e + 8, offs[i]); ov.setUint32(e + 12, t.len);
    out.set(t.data.subarray(0, t.len), offs[i]);
  });
  return { bytes: out, otf: flavor === 0x4F54544F };
}

/** Лист-образец шрифта: название, алфавиты, цифры, кегли */
async function fontSpecimen(bytes, name) {
  const family = 'bcSpecimen' + Date.now();
  const face = new FontFace(family, bytes);
  try { await face.load(); } catch { throw new Error('Браузер не смог открыть этот шрифт (файл повреждён?).'); }
  document.fonts.add(face);
  const W = 1240, H = 1754, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#3b5bdb'; g.fillRect(0, 0, W, 10);
  g.fillStyle = '#667085'; g.font = '22px system-ui, sans-serif'; g.fillText('Образец шрифта · BullConvert', 80, 80);
  g.fillStyle = '#111'; g.font = `64px "${family}"`; g.fillText(name, 80, 170, W - 160);
  let y = 270;
  for (const t of ['АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ', 'абвгдеёжзийклмнопрстуфхцчшщъыьэюя', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz', '0123456789 !?.,:;«»—()[]{}@#№%&*+=/']) {
    g.font = `40px "${family}"`; g.fillText(t, 80, y, W - 160); y += 64;
  }
  y += 30;
  g.strokeStyle = '#e3e6eb'; g.lineWidth = 2; g.beginPath(); g.moveTo(80, y); g.lineTo(W - 80, y); g.stroke();
  y += 70;
  for (const sz of [12, 16, 20, 28, 36, 48, 64]) {
    g.fillStyle = '#98a1b0'; g.font = '18px system-ui, sans-serif'; g.fillText(sz + ' пт', 80, y);
    g.fillStyle = '#111'; g.font = `${sz * 1.35}px "${family}"`; g.fillText('Съешь же ещё этих мягких французских булок', 170, y, W - 250);
    y += Math.max(54, sz * 1.95);
  }
  document.fonts.delete(face);
  return c;
}

async function convertFont(file, ext, target, opts, onStatus) {
  let u8 = new Uint8Array(await file.arrayBuffer()), otf = ext === 'otf';
  if (ext === 'woff') ({ bytes: u8, otf } = await woffToSfnt(u8));
  if (target === 'woff') return new Blob([await sfntToWoff(u8)], { type: 'font/woff' });
  if (target === 'ttf') return { blob: new Blob([u8], { type: otf ? 'font/otf' : 'font/ttf' }), ext: otf ? 'otf' : 'ttf' };
  onStatus && onStatus('Образец шрифта…');
  const canvas = await fontSpecimen(u8, baseOf(file.name));
  if (target === 'png') return canvasToBlob(canvas, 'image/png');
  const pdf = await createImagePdf();
  pdf.add(canvas, 0.95, 595.28);
  return pdf.blob();
}
