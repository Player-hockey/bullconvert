/* BullConvert — старые форматы Office (DOC, PPT) и вёрстка слайдов PPTX прямо в браузере, без Microsoft Office.
   Контейнер старых файлов (OLE/CFB) читает уже подключаемая библиотека SheetJS (XLSX.CFB). */

/* ======================= Контейнер OLE (CFB) ======================= */

async function readCfb(file) {
  await loadLib('xlsx');
  const u8 = new Uint8Array(await file.arrayBuffer());
  try { return XLSX.CFB.read(u8, { type: 'array' }); } catch { return null; }
}

function cfbStream(cfb, name) {
  let e = null;
  try { e = XLSX.CFB.find(cfb, name); } catch { /* нет такого потока */ }
  if (!e || !e.content || !e.content.length) return null;
  return e.content instanceof Uint8Array ? e.content : Uint8Array.from(e.content);
}

const dvOf = (u8) => new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
const CP1252 = new TextDecoder('windows-1252').decode(Uint8Array.from({ length: 256 }, (_, i) => i)).split('');

function u8ToBase64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Картинка (PNG/JPEG) из записи OfficeArt: ищем начало файла сразу за заголовком записи */
function blipDataUrl(u8, from, to) {
  for (let i = from; i < Math.min(to - 4, from + 80); i++) {
    if (u8[i] === 0x89 && u8[i + 1] === 0x50 && u8[i + 2] === 0x4E && u8[i + 3] === 0x47) return 'data:image/png;base64,' + u8ToBase64(u8.subarray(i, to));
    if (u8[i] === 0xFF && u8[i + 1] === 0xD8 && u8[i + 2] === 0xFF) return 'data:image/jpeg;base64,' + u8ToBase64(u8.subarray(i, to));
  }
  return null;
}

/** Все картинки PNG/JPEG в области байтов (записи OfficeArt 0xF01D/0xF01E/0xF02A) */
function blipsIn(u8, from, to) {
  const dv = dvOf(u8), out = [];
  for (let i = from; i + 8 <= to; i++) {
    const t = dv.getUint16(i + 2, true);
    if ((t === 0xF01D || t === 0xF01E || t === 0xF02A) && (dv.getUint16(i, true) & 0xF) === 0) {
      const len = dv.getUint32(i + 4, true);
      const end = i + 8 + len;
      if (len < 32 || end > to) continue;
      const url = blipDataUrl(u8, i + 8, end);
      if (url) { out.push(url); i = end - 1; }
    }
  }
  return out;
}

/**
 * Векторная картинка (WMF/EMF — формулы, схемы) из записи OfficeArt по смещению записи.
 * Возвращает { ext, data, compressed } — данные распаковываются позже (pako), рисуются metafileToPng.
 */
function metaBlipAt(u8, i) {
  if (i + 8 > u8.length) return null;
  const dv = dvOf(u8);
  const type = dv.getUint16(i + 2, true), inst = dv.getUint16(i, true) >> 4, len = dv.getUint32(i + 4, true);
  if (type !== 0xF01A && type !== 0xF01B) return null;
  const end = Math.min(u8.length, i + 8 + len);
  const p = i + 8 + ((inst === 0x3D5 || inst === 0x217) ? 32 : 16);
  if (p + 34 > end) return null;
  return { ext: type === 0xF01A ? 'emf' : 'wmf', data: u8.subarray(p + 34, end), compressed: u8[p + 32] === 0 };
}
function metaBlipsIn(u8, from, to) {
  const dv = dvOf(u8);
  for (let i = from; i + 8 <= to; i++) {
    const t = dv.getUint16(i + 2, true);
    if ((t === 0xF01A || t === 0xF01B) && (dv.getUint16(i, true) & 0xF) === 0) { const m = metaBlipAt(u8, i); if (m) return m; }
  }
  return null;
}
async function metaToUrl(m) {
  try {
    let bytes = m.data;
    if (m.compressed) { await loadLib('pako'); bytes = pako.inflate(bytes); }
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    return typeof metafileToPng === 'function' ? await metafileToPng(buf, m.ext) : null;
  } catch { return null; }
}

/* ============================ Word 97–2003 ============================ */

/** Свойства из списка sprm (абзац/символы) — только нужные нам */
function parsePrls(u8, p, end) {
  const dv = dvOf(u8), out = {};
  while (p + 2 <= end) {
    const sprm = dv.getUint16(p, true); p += 2;
    let size;
    switch (sprm >> 13) {
      case 0: case 1: size = 1; break;
      case 2: case 4: case 5: size = 2; break;
      case 3: size = 4; break;
      case 7: size = 3; break;
      default: size = (sprm === 0xD608 || sprm === 0xD606) ? dv.getUint16(p, true) + 1 : u8[p] + 1;
    }
    if (p + size > end) break;
    const v = size === 1 ? u8[p] : size === 2 ? dv.getUint16(p, true) : size === 4 ? dv.getUint32(p, true) : 0;
    switch (sprm) {
      case 0x2416: case 0x244B: out.inTable = v; break;      // абзац в таблице
      case 0x2417: case 0x244C: out.ttp = v; break;          // конец строки таблицы
      case 0x6649: out.itap = v; break;                      // глубина таблицы
      case 0x460B: out.ilfo = v; break;                      // элемент списка
      case 0x2403: case 0x2461: out.jc = v; break;           // выравнивание
      case 0x0835: out.b = v; break;
      case 0x0836: out.i = v; break;
      case 0x2A3E: out.u = v; break;
      case 0x6A03: out.pic = v; break;                       // где лежит картинка (поток Data)
      case 0x0855: out.spec = v; break;
    }
    p += size;
  }
  return out;
}

async function wordDocToHtml(cfb, onStatus) {
  const wd = cfbStream(cfb, 'WordDocument');
  if (!wd || wd.length < 0x200) throw new Error('Повреждённый документ Word.');
  const dv = dvOf(wd);
  if (dv.getUint16(0, true) !== 0xA5EC) throw new Error('Повреждённый документ Word.');
  const nFib = dv.getUint16(2, true);
  const flags = dv.getUint16(0x0A, true);
  if (flags & 0x0100) throw new Error('Документ Word защищён паролем — снимите пароль и повторите.');

  // Word 6.0/95: текст лежит одним куском в кодировке Windows
  if (nFib < 0xC1) {
    const fcMin = dv.getUint32(0x18, true), fcMac = dv.getUint32(0x1C, true);
    const text = new TextDecoder('windows-1251').decode(wd.subarray(fcMin, Math.min(fcMac, wd.length)));
    return text.split(/[\r\x07]/).map((t) => t.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').trim()).filter(Boolean)
      .map((t) => `<p>${escapeHtml(t)}</p>`).join('\n');
  }

  const table = cfbStream(cfb, (flags & 0x0200) ? '1Table' : '0Table');
  if (!table) throw new Error('Повреждённый документ Word: нет таблицы свойств.');
  const tv = dvOf(table);
  const fl = (i) => [dv.getUint32(154 + i * 8, true), dv.getUint32(158 + i * 8, true)];
  const ccpText = dv.getInt32(76, true);

  // таблица кусков текста (piece table)
  const [fcClx, lcbClx] = fl(33);
  let pieces = null;
  for (let p = fcClx; p < fcClx + lcbClx && p < table.length;) {
    if (table[p] === 1) { p += 3 + tv.getInt16(p + 1, true); continue; }
    if (table[p] === 2) {
      const lcb = tv.getUint32(p + 1, true), s = p + 5, n = (lcb - 4) / 12;
      pieces = [];
      for (let i = 0; i < n; i++) {
        const cpS = tv.getUint32(s + i * 4, true), cpE = tv.getUint32(s + (i + 1) * 4, true);
        const raw = tv.getUint32(s + (n + 1) * 4 + i * 8 + 2, true);
        const compressed = !!(raw & 0x40000000);
        const fc = raw & 0x3FFFFFFF;
        pieces.push({ cpS, cpE, compressed, fc: compressed ? fc / 2 : fc });
      }
    }
    break;
  }
  if (!pieces) throw new Error('Повреждённый документ Word: не найден текст.');

  // свойства абзацев и символов (FKP-страницы)
  const fkpRuns = ([fcPlc, lcbPlc], isPap) => {
    const runs = [];
    if (!lcbPlc || fcPlc + lcbPlc > table.length) return runs;
    const n = (lcbPlc - 4) / 8;
    for (let i = 0; i < n; i++) {
      const o = (tv.getUint32(fcPlc + (n + 1) * 4 + i * 4, true) & 0x3FFFFF) * 512;
      if (o + 512 > wd.length) continue;
      const crun = wd[o + 511];
      for (let k = 0; k < crun; k++) {
        const a = dv.getUint32(o + k * 4, true), b = dv.getUint32(o + (k + 1) * 4, true);
        const boff = isPap ? wd[o + (crun + 1) * 4 + k * 13] : wd[o + (crun + 1) * 4 + k];
        let props = {};
        if (boff) {
          let q = o + boff * 2;
          try {
            if (isPap) {
              let cb = wd[q++], size;
              if (cb) size = 2 * cb - 1; else { cb = wd[q++]; size = 2 * cb; }
              props = parsePrls(wd, q + 2, Math.min(q + size, o + 511));
              props.istd = dv.getUint16(q, true);
            } else {
              props = parsePrls(wd, q + 1, Math.min(q + 1 + wd[q], o + 511));
            }
          } catch { props = {}; }
        }
        runs.push({ a, b, props });
      }
    }
    return runs.sort((x, y) => x.a - y.a);
  };
  const papRuns = fkpRuns(fl(13), true);
  const chpRuns = fkpRuns(fl(12), false);
  const find = (runs, fc) => {
    let lo = 0, hi = runs.length - 1;
    while (lo <= hi) {
      const m = (lo + hi) >> 1;
      if (fc < runs[m].a) hi = m - 1; else if (fc >= runs[m].b) lo = m + 1; else return runs[m].props;
    }
    return {};
  };
  const on = (v) => v === 1 || v === 0x81;

  // поток Data — встроенные картинки
  const data = cfbStream(cfb, 'Data');
  const picAt = (off) => {
    if (!data || off == null || off + 4 > data.length) return null;
    const lcb = dvOf(data).getUint32(off, true);
    const to = Math.min(data.length, off + lcb);
    const urls = blipsIn(data, off, to);
    // нет PNG/JPEG — ищем векторную картинку (формулы редактора формул хранятся как WMF)
    return urls[0] || metaBlipsIn(data, off, to);
  };

  // «плавающие» рисунки (символ 0x08): позиция → номер фигуры → картинка в хранилище OfficeArt
  const floating = new Map();
  try {
    const [fcSpa, lcbSpa] = fl(40);
    const [fcDgg, lcbDgg] = fl(50);
    if (lcbSpa && lcbDgg && fcDgg + lcbDgg <= table.length) {
      const n = (lcbSpa - 4) / 30;
      const spidAt = new Map();
      for (let i = 0; i < n; i++) spidAt.set(tv.getUint32(fcSpa + i * 4, true), tv.getUint32(fcSpa + (n + 1) * 4 + i * 26, true));
      const bse = [], pibOf = new Map();
      const walkArt = (from, to) => {
        for (let o = from; o + 8 <= to;) {
          const vi = tv.getUint16(o, true), type = tv.getUint16(o + 2, true), len = tv.getUint32(o + 4, true);
          const end = o + 8 + len;
          if (end > to) break;
          if (type === 0xF007) bse.push(tv.getUint32(o + 36, true));
          else if (type === 0xF004) {
            let spid = 0, pib = 0;
            for (let q = o + 8; q + 8 <= end;) {
              const t2 = tv.getUint16(q + 2, true), l2 = tv.getUint32(q + 4, true);
              if (t2 === 0xF00A) spid = tv.getUint32(q + 8, true);
              if (t2 === 0xF00B) {
                const cnt = tv.getUint16(q, true) >> 4;
                for (let k = 0, r = q + 8; k < cnt && r + 6 <= q + 8 + l2; k++, r += 6) if ((tv.getUint16(r, true) & 0x3FFF) === 0x0104) pib = tv.getUint32(r + 2, true);
              }
              q += 8 + l2;
            }
            if (spid && pib) pibOf.set(spid, pib);
          } else if ((vi & 0xF) === 0xF) walkArt(o + 8, end);
          o = end;
        }
      };
      walkArt(fcDgg, fcDgg + lcbDgg);
      for (const [cp, spid] of spidAt) {
        const off = bse[(pibOf.get(spid) || 0) - 1];
        if (off == null || off + 8 > wd.length) continue;
        const url = blipDataUrl(wd, off + 8, Math.min(wd.length, off + 8 + dv.getUint32(off + 4, true))) || metaBlipAt(wd, off);
        if (url) floating.set(cp, url);
      }
    }
  } catch { /* без плавающих рисунков */ }

  // символы → абзацы
  const paras = [];
  let runs = [], fields = [];
  const visible = () => fields.every((f) => f === 'res');
  const push = (text, chp) => {
    const fmt = { b: on(chp.b), i: on(chp.i), u: !!chp.u && chp.u !== 0x80 };
    const last = runs[runs.length - 1];
    if (last && !last.img && !last.meta && last.b === fmt.b && last.i === fmt.i && last.u === fmt.u) last.text += text;
    else runs.push({ text, ...fmt });
  };
  for (const pc of pieces) {
    if (pc.cpS >= ccpText) break;
    const end = Math.min(pc.cpE, ccpText);
    for (let cp = pc.cpS; cp < end; cp++) {
      const k = cp - pc.cpS;
      const fc = pc.compressed ? pc.fc + k : pc.fc + 2 * k;
      if (fc + (pc.compressed ? 1 : 2) > wd.length) break;
      const ch = pc.compressed ? CP1252[wd[fc]] : String.fromCharCode(dv.getUint16(fc, true));
      switch (ch) {
        case '\x13': fields.push('code'); continue;
        case '\x14': if (fields.length) fields[fields.length - 1] = 'res'; continue;
        case '\x15': fields.pop(); continue;
      }
      if (ch === '\r' || ch === '\x07' || ch === '\x0c') {
        paras.push({ runs, end: ch, pap: find(papRuns, fc) });
        runs = [];
        continue;
      }
      if (!visible()) continue;
      const chp = find(chpRuns, fc);
      if (ch === '\x01' || ch === '\x08') {
        const url = ch === '\x01' ? picAt(chp.pic) : floating.get(cp);
        if (typeof url === 'string') runs.push({ img: url }); // остальное — привязки объектов, их картинка обычно стоит рядом
        else if (url) runs.push({ img: null, meta: url });   // WMF/EMF — нарисуем после разбора текста
        continue;
      }
      if (ch === '\x0b') { push('\n', chp); continue; }
      if (ch === '\t') { push(' ', chp); continue; }
      if (ch === '\x1e') { push('-', chp); continue; }
      if (ch < ' ' || ch === '\x1f') continue;
      push(ch, chp);
    }
  }
  if (runs.length) paras.push({ runs, end: '\r', pap: {} });

  // векторные картинки (WMF/EMF) рисуем после разбора: это асинхронно
  const metaRuns = paras.flatMap((p) => p.runs.filter((r) => r.meta));
  if (metaRuns.length) {
    if (onStatus) onStatus(`Рисунки и формулы: ${metaRuns.length}…`);
    for (const r of metaRuns) r.img = await metaToUrl(r.meta);
  }

  const runsHtml = (rs) => rs.map((r) => {
    if (r.meta && !r.img) return '';
    if (r.img) return `<img src="${r.img}">`;
    let h = escapeHtml(r.text).replace(/\n/g, '<br>');
    if (r.u) h = `<u>${h}</u>`;
    if (r.i) h = `<i>${h}</i>`;
    if (r.b) h = `<b>${h}</b>`;
    return h;
  }).join('');
  const hasContent = (rs) => rs.some((r) => r.img || (r.text && r.text.trim()));

  // если свойства абзацев не прочитались — таблицы угадываем по символам ячеек
  const papKnown = papRuns.length > 0;
  const out = [];
  let tableRows = null, row = [], cell = [], list = false;
  const closeList = () => { if (list) { out.push('</ul>'); list = false; } };
  const closeTable = () => {
    if (!tableRows) return;
    if (cell.length) { row.push(cell.join('<br>')); cell = []; }
    if (row.length) { tableRows.push(row); row = []; }
    out.push('<table>' + tableRows.map((r) => '<tr>' + r.map((c) => `<td>${c}</td>`).join('') + '</tr>').join('') + '</table>');
    tableRows = null;
  };
  for (let i = 0; i < paras.length; i++) {
    const p = paras[i], pap = p.pap;
    const inT = papKnown ? !!(pap.inTable || pap.itap) : p.end === '\x07';
    const ttp = papKnown ? !!pap.ttp : (p.end === '\x07' && !hasContent(p.runs) && i > 0 && paras[i - 1].end === '\x07');
    if (inT) {
      closeList();
      if (!tableRows) tableRows = [];
      if (ttp) { if (cell.length) { row.push(cell.join('<br>')); cell = []; } tableRows.push(row); row = []; continue; }
      cell.push(runsHtml(p.runs));
      if (p.end === '\x07') { row.push(cell.join('<br>')); cell = []; }
      continue;
    }
    closeTable();
    if (!hasContent(p.runs)) { closeList(); continue; }
    const body = runsHtml(p.runs);
    const istd = pap.istd || 0;
    if (istd >= 1 && istd <= 9) { closeList(); const h = Math.min(istd, 6); out.push(`<h${h}>${body}</h${h}>`); continue; }
    if (pap.ilfo) { if (!list) { out.push('<ul>'); list = true; } out.push(`<li>${body}</li>`); continue; }
    closeList();
    const align = { 1: 'center', 2: 'right', 3: 'justify' }[pap.jc];
    out.push(align ? `<p style="text-align:${align}">${body}</p>` : `<p>${body}</p>`);
  }
  closeTable(); closeList();
  if (!out.length) throw new Error('В документе не найден текст.');
  return out.join('\n');
}

/* ========================= PowerPoint 97–2003 ========================= */

function pptToHtml(cfb, onStatus) {
  const s = cfbStream(cfb, 'PowerPoint Document');
  if (!s) throw new Error('Повреждённая презентация PowerPoint.');
  const dv = dvOf(s);
  const rec = (o) => {
    const vi = dv.getUint16(o, true);
    return { ver: vi & 0xF, inst: vi >> 4, type: dv.getUint16(o + 2, true), len: dv.getUint32(o + 4, true), o };
  };
  const walk = (from, to, cb) => {
    for (let o = from; o + 8 <= to;) {
      const r = rec(o);
      const end = o + 8 + r.len;
      if (end > to || end <= o) break;
      if (cb(r) !== false && r.ver === 0xF) walk(o + 8, end, cb);
      o = end;
    }
  };
  const textOf = (r) => r.type === 0x0FA0
    ? new TextDecoder('utf-16le').decode(s.subarray(r.o + 8, r.o + 8 + r.len))
    : String.fromCharCode(...s.subarray(r.o + 8, r.o + 8 + r.len));

  // карта «номер объекта → смещение» (учитывает быстрые сохранения)
  const persist = {};
  let docRef = 0;
  const cu = cfbStream(cfb, 'Current User');
  if (cu && cu.length >= 20) {
    const cdv = dvOf(cu);
    if (cdv.getUint32(12, true) === 0xF3D1C4DF) throw new Error('Презентация защищена паролем — снимите пароль и повторите.');
    let edit = cdv.getUint32(16, true);
    const seen = new Set();
    while (edit && !seen.has(edit) && edit + 28 <= s.length) {
      seen.add(edit);
      if (rec(edit).type !== 0x0FF5) break;
      if (!docRef) docRef = dv.getUint32(edit + 24, true);
      const pd = dv.getUint32(edit + 20, true);
      if (pd + 8 > s.length) break;
      const r = rec(pd);
      for (let q = pd + 8; q < pd + 8 + r.len && q + 4 <= s.length;) {
        const v = dv.getUint32(q, true); q += 4;
        const id = v & 0xFFFFF, c = v >>> 20;
        for (let k = 0; k < c; k++, q += 4) if (!((id + k) in persist) && q + 4 <= s.length) persist[id + k] = dv.getUint32(q, true);
      }
      edit = dv.getUint32(edit + 16, true);
    }
  }

  // документ: список слайдов (с текстом заголовков/тела) и хранилище картинок
  let docOff = persist[docRef];
  if (docOff == null || docOff + 8 > s.length || rec(docOff).type !== 0x03E8) {
    docOff = -1;
    walk(0, s.length, (r) => { if (r.type === 0x03E8 && docOff < 0) { docOff = r.o; } return false; });
  }
  if (docOff < 0) throw new Error('Повреждённая презентация PowerPoint: не найден список слайдов.');
  const docRec = rec(docOff);
  const slides = [];
  const blipOffsets = [];
  walk(docOff + 8, docOff + 8 + docRec.len, (r) => {
    if (r.type === 0x0FF0) {
      if (r.inst !== 0) return false; // мастер-слайды и заметки не нужны
      let cur = null, ttype = 1;
      walk(r.o + 8, r.o + 8 + r.len, (a) => {
        if (a.type === 0x03F3) { cur = { ref: dv.getUint32(a.o + 8, true), texts: [], pics: [] }; slides.push(cur); }
        else if (a.type === 0x0F9F) ttype = dv.getUint32(a.o + 8, true);
        else if ((a.type === 0x0FA0 || a.type === 0x0FA8) && cur) cur.texts.push({ type: ttype, text: textOf(a) });
      });
      return false;
    }
    if (r.type === 0xF007) { blipOffsets.push(dv.getUint32(r.o + 36, true)); return false; }
  });
  if (!slides.length) throw new Error('В презентации нет слайдов.');

  const picsStream = cfbStream(cfb, 'Pictures');
  const picCache = {};
  const picture = (pib) => {
    if (!picsStream || !pib || pib > blipOffsets.length) return null;
    if (pib in picCache) return picCache[pib];
    const off = blipOffsets[pib - 1];
    let url = null;
    if (off + 8 <= picsStream.length) {
      const len = dvOf(picsStream).getUint32(off + 4, true);
      url = blipDataUrl(picsStream, off + 8, Math.min(picsStream.length, off + 8 + len));
    }
    return (picCache[pib] = url);
  };

  // текст и картинки из рисунка каждого слайда
  for (const sl of slides) {
    const off = persist[sl.ref];
    if (off == null || off + 8 > s.length) continue;
    const r = rec(off);
    if (r.type !== 0x03EE) continue;
    let ttype = 4;
    walk(off + 8, off + 8 + r.len, (a) => {
      if (a.type === 0x0F9F) ttype = dv.getUint32(a.o + 8, true);
      else if (a.type === 0x0FA0 || a.type === 0x0FA8) sl.texts.push({ type: ttype, text: textOf(a) });
      else if (a.type === 0xF00B) {
        for (let k = 0, q = a.o + 8; k < a.inst && q + 6 <= a.o + 8 + a.len; k++, q += 6) {
          if ((dv.getUint16(q, true) & 0x3FFF) === 0x0104) { const url = picture(dv.getUint32(q + 2, true)); if (url) sl.pics.push(url); }
        }
      }
    });
  }

  onStatus && onStatus(`Слайдов: ${slides.length}`);
  const parts = slides.map((sl, k) => {
    const seen = new Set();
    let title = '';
    const body = [];
    for (const t of sl.texts) {
      const clean = t.text.replace(/[\x00-\x08\x0e-\x1f]/g, '').replace(/\x0b/g, '\n');
      const key = clean.trim();
      if (!key || key === '*' || seen.has(key)) continue;
      seen.add(key);
      if ((t.type === 0 || t.type === 6) && !title) { title = key.replace(/\s*\n\s*/g, ' '); continue; }
      const lines = clean.split('\r').map((x) => x.trim()).filter(Boolean);
      const esc = (x) => escapeHtml(x).replace(/\n/g, '<br>');
      if (lines.length > 1 && (t.type === 1 || t.type === 5 || t.type === 7 || t.type === 8)) body.push('<ul>' + lines.map((x) => `<li>${esc(x)}</li>`).join('') + '</ul>');
      else body.push(lines.map((x) => `<p>${esc(x)}</p>`).join(''));
    }
    for (const url of [...new Set(sl.pics)]) body.push(`<p><img src="${url}"></p>`);
    return `<h2>Слайд ${k + 1}${title ? '. ' + escapeHtml(title) : ''}</h2>\n${body.join('\n')}`;
  });
  return parts.join('\n<hr>\n');
}

/** DOC/DOT/PPT/PPS → HTML. Учитываем «переименованные» файлы: RTF, HTML или DOCX с расширением .doc */
async function legacyOfficeToHtml(file, ext, onProgress, onStatus) {
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const sig = String.fromCharCode(...head);
  if (sig.startsWith('{\\rtf')) return docToHtml(file, 'rtf', onProgress, onStatus);
  if (sig.startsWith('PK')) {
    const real = await sniffZip(file);
    if (real === 'docx' || real === 'pptx' || real === 'odt') return docToHtml(file, real, onProgress, onStatus);
    throw new Error('Файл не похож на документ Office.');
  }
  if (!(head[0] === 0xD0 && head[1] === 0xCF && head[2] === 0x11 && head[3] === 0xE0)) {
    const text = await readText(file);
    if (/<html|<body|<p[\s>]|<div[\s>]/i.test(text)) return docToHtml(file, 'html', onProgress, onStatus);
    if (!/[\u0000-\u0008\u000E-\u001A]/.test(text.slice(0, 4000))) return textToHtml(text);
    throw new Error('Файл не похож на документ Office.');
  }
  onStatus && onStatus('Чтение старого формата Office…');
  const cfb = await readCfb(file);
  if (!cfb) throw new Error('Повреждённый файл Office.');
  if (cfbStream(cfb, 'EncryptedPackage')) throw new Error('Файл защищён паролем — снимите пароль и повторите.');
  if (cfbStream(cfb, 'WordDocument')) return wordDocToHtml(cfb, onStatus);
  if (cfbStream(cfb, 'PowerPoint Document')) return pptToHtml(cfb, onStatus);
  if (cfbStream(cfb, 'Workbook') || cfbStream(cfb, 'Book')) throw new Error('Это таблица Excel — переименуйте файл в .xls и добавьте снова.');
  throw new Error('Файл не похож на документ Word или PowerPoint.');
}

/* ===================== PPTX → картинки слайдов (вёрстка) ===================== */

const WING_BULLETS = { '§': '■', 'Ø': '➢', 'ü': '✔', 'q': '❑', 'v': '❖', 'n': '■', 'l': '●', 'Ü': '➢', 'è': '➔', 'à': '➔', 'o': '□', 'p': '■', 'w': '◆', 'u': '◆', '®': '➔', '·': '•' };
const PRST_COLORS = { black: '000000', white: 'FFFFFF', red: 'FF0000', green: '008000', blue: '0000FF', yellow: 'FFFF00', gray: '808080', grey: '808080', darkGray: 'A9A9A9', lightGray: 'D3D3D3', orange: 'FFA500', navy: '000080' };

/**
 * Рисует слайды PPTX на холстах. onSlide(canvas, index, total, widthPt) вызывается для каждого слайда.
 * Возвращает { slides, skipped: { charts, images } } — что нарисовать не удалось.
 */
async function renderPptx(file, width, onSlide, onStatus) {
  await loadLib('jszip');
  const zip = await JSZip.loadAsync(file);
  const parse = (str) => new DOMParser().parseFromString(str, 'application/xml');
  const xmlCache = new Map(), relCache = new Map(), imgCache = new Map(), themeCache = new Map();
  const xml = async (p) => {
    if (!xmlCache.has(p)) { const f = zip.file(p); xmlCache.set(p, f ? parse(await f.async('string')) : null); }
    return xmlCache.get(p);
  };
  const rels = async (p) => {
    if (relCache.has(p)) return relCache.get(p);
    const dir = dirOf(p), d = await xml(`${dir ? dir + '/' : ''}_rels/${p.split('/').pop()}.rels`);
    const m = {};
    if (d) for (const r of d.getElementsByTagNameNS('*', 'Relationship')) {
      m[r.getAttribute('Id')] = { target: r.getAttribute('TargetMode') === 'External' ? null : resolvePath(dir, r.getAttribute('Target') || ''), type: r.getAttribute('Type') || '' };
    }
    relCache.set(p, m);
    return m;
  };
  const relOfType = (m, t) => Object.values(m).find((r) => r.target && r.type.endsWith('/' + t)) || null;
  const K = (el, n) => { if (!el) return null; for (const c of el.children) if (c.localName === n) return c; return null; };
  const KS = (el, n) => (el ? [...el.children].filter((c) => c.localName === n) : []);
  const Q = (el, ...ns) => ns.reduce((e, n) => K(e, n), el);
  const A = (el, n, d = null) => { if (!el) return d; const v = el.getAttribute(n); return v == null ? d : v; };
  const AN = (el, n, d = 0) => { const v = A(el, n); if (v == null || v === '') return d; const x = Number(v); return Number.isFinite(x) ? x : d; };
  const AL = (el, local) => { if (!el) return ''; for (const a of el.attributes) if (a.localName === local) return a.value; return ''; };
  const part = async (p) => (p ? { path: p, doc: await xml(p), rels: await rels(p) } : null);

  const pres = await xml('ppt/presentation.xml');
  if (!pres) throw new Error('Повреждённый PPTX: нет описания презентации.');
  const root = pres.documentElement;
  const sz = K(root, 'sldSz');
  const CX = AN(sz, 'cx', 9144000), CY = AN(sz, 'cy', 6858000);
  const W = width, H = Math.round(width * CY / CX), S = W / CX;
  const presRels = await rels('ppt/presentation.xml');
  const relId = (el) => { for (const a of el.attributes) if (a.localName === 'id' && /relationships/.test(a.namespaceURI || '')) return a.value; return ''; };
  const slidePaths = KS(K(root, 'sldIdLst'), 'sldId').map((sl) => presRels[relId(sl)]?.target).filter(Boolean);
  if (!slidePaths.length) throw new Error('В презентации нет слайдов.');
  const defaultTS = K(root, 'defaultTextStyle');
  const skipped = { charts: 0, images: 0 };

  /* ---- тема: цвета, шрифты, стили заливок ---- */
  const themeOf = async (master) => {
    const key = master ? master.path : '';
    if (themeCache.has(key)) return themeCache.get(key);
    const t = { colors: {}, major: 'Calibri Light', minor: 'Calibri', fills: [], lines: [], bgFills: [], txDef: null, part: null };
    const tr = master && relOfType(master.rels, 'theme');
    const d = tr && await xml(tr.target);
    if (d) {
      t.part = await part(tr.target); // картинки стилей темы ссылаются на её собственные связи
      const cs = d.getElementsByTagNameNS('*', 'clrScheme')[0];
      for (const c of cs ? cs.children : []) {
        const v = c.firstElementChild;
        t.colors[c.localName] = !v ? '000000' : v.localName === 'srgbClr' ? A(v, 'val', '000000') : (A(v, 'lastClr') || (A(v, 'val') === 'window' ? 'FFFFFF' : '000000'));
      }
      const fs = d.getElementsByTagNameNS('*', 'fontScheme')[0];
      t.major = A(Q(fs, 'majorFont', 'latin'), 'typeface') || t.major;
      t.minor = A(Q(fs, 'minorFont', 'latin'), 'typeface') || t.minor;
      const fm = d.getElementsByTagNameNS('*', 'fmtScheme')[0];
      t.fills = [...(K(fm, 'fillStyleLst')?.children || [])];
      t.lines = [...(K(fm, 'lnStyleLst')?.children || [])];
      t.bgFills = [...(K(fm, 'bgFillStyleLst')?.children || [])];
      t.txDef = Q(d.getElementsByTagNameNS('*', 'objectDefaults')[0], 'txDef');
    }
    themeCache.set(key, t);
    return t;
  };

  /* ---- цвета ---- */
  const rgbOf = (hex) => { const n = parseInt((hex || '000000').slice(0, 6), 16) || 0; return { r: n >> 16 & 255, g: n >> 8 & 255, b: n & 255, a: 1 }; };
  const css = (c) => `rgba(${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)},${c.a})`;
  const toHsl = ({ r, g, b }) => {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
    if (mx === mn) return [0, 0, l];
    const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h / 6, s, l];
  };
  const fromHsl = ([h, s, l], a) => {
    if (!s) return { r: l * 255, g: l * 255, b: l * 255, a };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    const f = (t) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
    return { r: f(h + 1 / 3) * 255, g: f(h) * 255, b: f(h - 1 / 3) * 255, a };
  };
  const mods = (base, el) => {
    let c = { ...base };
    for (const m of el.children) {
      const v = AN(m, 'val', 100000) / 100000;
      switch (m.localName) {
        case 'alpha': c.a = v; break;
        case 'lumMod': { const h = toHsl(c); h[2] *= v; c = fromHsl(h, c.a); break; }
        case 'lumOff': { const h = toHsl(c); h[2] = Math.min(1, Math.max(0, h[2] + v)); c = fromHsl(h, c.a); break; }
        case 'satMod': { const h = toHsl(c); h[1] = Math.min(1, h[1] * v); c = fromHsl(h, c.a); break; }
        case 'hueMod': { const h = toHsl(c); h[0] = (h[0] * v) % 1; c = fromHsl(h, c.a); break; }
        case 'tint': c = { r: c.r * v + 255 * (1 - v), g: c.g * v + 255 * (1 - v), b: c.b * v + 255 * (1 - v), a: c.a }; break;
        case 'shade': c = { r: c.r * v, g: c.g * v, b: c.b * v, a: c.a }; break;
      }
    }
    return c;
  };
  /** цвет из элемента, внутри которого лежит srgbClr/schemeClr/…; ph — цвет для phClr */
  const color = (el, C, ph = null) => {
    if (!el) return null;
    const c = [...el.children].find((x) => /^(srgbClr|schemeClr|sysClr|prstClr|scrgbClr|hslClr)$/.test(x.localName));
    if (!c) return null;
    let base;
    switch (c.localName) {
      case 'srgbClr': base = rgbOf(A(c, 'val')); break;
      case 'sysClr': base = rgbOf(A(c, 'lastClr') || (A(c, 'val') === 'window' ? 'FFFFFF' : '000000')); break;
      case 'prstClr': base = rgbOf(PRST_COLORS[A(c, 'val')] || '000000'); break;
      case 'scrgbClr': base = { r: AN(c, 'r') / 1e5 * 255, g: AN(c, 'g') / 1e5 * 255, b: AN(c, 'b') / 1e5 * 255, a: 1 }; break;
      case 'hslClr': base = fromHsl([AN(c, 'hue') / 21600000, AN(c, 'sat') / 1e5, AN(c, 'lum') / 1e5], 1); break;
      case 'schemeClr': {
        const v = A(c, 'val');
        if (v === 'phClr') { if (!ph) return null; base = ph; break; }
        base = rgbOf(C.theme.colors[C.map[v] || v] || '000000');
        break;
      }
    }
    return mods(base, c);
  };

  /* ---- заливки, картинки, контуры ---- */
  const fillOf = (pr) => {
    for (const c of pr ? pr.children : []) {
      if (c.localName === 'noFill') return 'none';
      if (/^(solidFill|gradFill|blipFill|pattFill)$/.test(c.localName)) return c;
    }
    return null;
  };
  const loadImage = async (blob) => {
    try { if (!/svg/.test(blob.type)) return await createImageBitmap(blob); } catch { /* ниже — через <img> */ }
    return imageFromUrl(URL.createObjectURL(blob));
  };
  const image = async (pt, blipFill) => {
    const blip = K(blipFill, 'blip');
    const r = blip && pt.rels[AL(blip, 'embed')];
    if (!r || !r.target) return null;
    if (imgCache.has(r.target)) return imgCache.get(r.target);
    let img = null;
    const f = zip.file(r.target);
    const ext = extOf(r.target);
    if (f && IMG_MIME[ext]) {
      try { img = await loadImage(new Blob([await f.async('arraybuffer')], { type: IMG_MIME[ext] })); } catch { img = null; }
    }
    if (!img) skipped.images++;
    imgCache.set(r.target, img);
    return img;
  };
  const drawImg = (g, img, bf, x, y, w, h, C = null, ph = null) => {
    const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    const sr = K(bf, 'srcRect');
    const l = AN(sr, 'l') / 1e5, t = AN(sr, 't') / 1e5, r = AN(sr, 'r') / 1e5, b = AN(sr, 'b') / 1e5;
    let sw = iw * (1 - l - r), sh = ih * (1 - t - b), sx = iw * l, sy = ih * t;
    if (!(sw > 0 && sh > 0)) { sx = 0; sy = 0; sw = iw; sh = ih; }
    // «двухтоновая» картинка (фоны тем): яркость пикселя → между двумя цветами темы
    const duo = C && K(K(bf, 'blip'), 'duotone');
    const cols = duo ? [...duo.children].map((c) => color({ children: [c] }, C, ph)).filter(Boolean) : [];
    if (cols.length === 2 && w >= 1 && h >= 1) {
      const cw = Math.min(2400, Math.ceil(w)), ch = Math.min(2400, Math.ceil(h));
      const off = document.createElement('canvas'); off.width = cw; off.height = ch;
      const og = off.getContext('2d');
      og.drawImage(img, sx, sy, sw, sh, 0, 0, cw, ch);
      const im = og.getImageData(0, 0, cw, ch), d = im.data;
      const [a, z] = cols;
      for (let i = 0; i < d.length; i += 4) {
        const L = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) / 255;
        d[i] = a.r + (z.r - a.r) * L; d[i + 1] = a.g + (z.g - a.g) * L; d[i + 2] = a.b + (z.b - a.b) * L;
      }
      og.putImageData(im, 0, 0);
      g.drawImage(off, x, y, w, h);
      return;
    }
    g.drawImage(img, sx, sy, sw, sh, x, y, w, h);
  };
  const paint = async (g, f, C, pt, ph, x, y, w, h) => {
    if (!f || f === 'none') return;
    switch (f.localName) {
      case 'solidFill': { const c = color(f, C, ph); if (c) { g.fillStyle = css(c); g.fill(); } return; }
      case 'gradFill': {
        const gs = KS(K(f, 'gsLst'), 'gs').map((st) => ({ pos: AN(st, 'pos') / 1e5, c: color(st, C, ph) })).filter((st) => st.c);
        if (!gs.length) return;
        const cx = x + w / 2, cy = y + h / 2;
        let gr;
        if (K(f, 'path')) gr = g.createRadialGradient(cx, cy, 0, cx, cy, Math.hypot(w, h) / 2);
        else {
          const ang = AN(K(f, 'lin'), 'ang') / 60000 * Math.PI / 180, dx = Math.cos(ang), dy = Math.sin(ang);
          const L = (Math.abs(w * dx) + Math.abs(h * dy)) / 2;
          gr = g.createLinearGradient(cx - dx * L, cy - dy * L, cx + dx * L, cy + dy * L);
        }
        gs.sort((a, b) => a.pos - b.pos).forEach((st) => gr.addColorStop(Math.min(1, Math.max(0, st.pos)), css(st.c)));
        g.fillStyle = gr; g.fill(); return;
      }
      case 'pattFill': { const c = color(K(f, 'fgClr'), C, ph); if (c) { g.fillStyle = css({ ...c, a: c.a * 0.5 }); g.fill(); } return; }
      case 'blipFill': {
        const img = await image(pt, f);
        if (img) { g.save(); g.clip(); drawImg(g, img, f, x, y, w, h, C, ph); g.restore(); }
      }
    }
  };
  const themeFill = (ref, C) => {
    const idx = AN(ref, 'idx');
    const ph = color(ref, C);
    const f = idx >= 1001 ? C.theme.bgFills[idx - 1001] : idx > 0 ? C.theme.fills[idx - 1] : null;
    return f ? { f, ph, pt: C.theme.part } : null;
  };
  const lineOf = (spPr, style, C) => {
    const ln = K(spPr, 'ln');
    const ref = K(style, 'lnRef');
    const tl = ref && AN(ref, 'idx') > 0 ? C.theme.lines[AN(ref, 'idx') - 1] : null;
    if (ln && K(ln, 'noFill')) return null;
    let c = ln ? color(K(ln, 'solidFill'), C) || color(K(K(K(ln, 'gradFill'), 'gsLst'), 'gs'), C) : null;
    if (!c && !ln?.children.length && tl && !K(tl, 'noFill')) c = color(K(tl, 'solidFill'), C, color(ref, C));
    if (!c) return null;
    const w = AN(ln, 'w', AN(tl, 'w', 9525));
    const dash = A(K(ln, 'prstDash'), 'val');
    return { c, w: Math.max(1, w * S), dash: dash && dash !== 'solid' ? [4, 3] : null };
  };

  /* ---- геометрия фигур ---- */
  const geomPath = (g, spPr, x, y, w, h, extEmu) => {
    g.beginPath();
    const cg = K(spPr, 'custGeom');
    if (cg) {
      const paths = KS(K(cg, 'pathLst'), 'path');
      let ok = paths.length > 0;
      for (const p of paths) {
        const kx = w / (AN(p, 'w') || extEmu.cx || 1), ky = h / (AN(p, 'h') || extEmu.cy || 1);
        let cx0 = x, cy0 = y;
        const pt = (e) => { const X = Number(A(e, 'x')), Y = Number(A(e, 'y')); if (!Number.isFinite(X) || !Number.isFinite(Y)) { ok = false; return [x, y]; } return [x + X * kx, y + Y * ky]; };
        for (const c of p.children) {
          const pts = KS(c, 'pt').map(pt);
          switch (c.localName) {
            case 'moveTo': g.moveTo(...pts[0]); [cx0, cy0] = pts[0]; break;
            case 'lnTo': g.lineTo(...pts[0]); [cx0, cy0] = pts[0]; break;
            case 'cubicBezTo': if (pts.length === 3) { g.bezierCurveTo(...pts[0], ...pts[1], ...pts[2]); [cx0, cy0] = pts[2]; } break;
            case 'quadBezTo': if (pts.length === 2) { g.quadraticCurveTo(...pts[0], ...pts[1]); [cx0, cy0] = pts[1]; } break;
            case 'arcTo': {
              const rx = AN(c, 'wR') * kx, ry = AN(c, 'hR') * ky;
              const st = AN(c, 'stAng') / 60000 * Math.PI / 180, sw = AN(c, 'swAng') / 60000 * Math.PI / 180;
              const ecx = cx0 - rx * Math.cos(st), ecy = cy0 - ry * Math.sin(st);
              if (rx > 0 && ry > 0) g.ellipse(ecx, ecy, rx, ry, 0, st, st + sw, sw < 0);
              cx0 = ecx + rx * Math.cos(st + sw); cy0 = ecy + ry * Math.sin(st + sw);
              break;
            }
            case 'close': g.closePath(); break;
          }
        }
      }
      if (ok) return 'shape';
      g.beginPath();
    }
    const pg = K(spPr, 'prstGeom');
    const prst = A(pg, 'prst', 'rect');
    const av = {};
    for (const gd of KS(K(pg, 'avLst'), 'gd')) { const m = /val\s+(-?\d+)/.exec(A(gd, 'fmla', '')); if (m) av[A(gd, 'name')] = +m[1]; }
    const poly = (pts) => { g.moveTo(x + pts[0][0] * w, y + pts[0][1] * h); for (const p of pts.slice(1)) g.lineTo(x + p[0] * w, y + p[1] * h); g.closePath(); };
    const m = Math.min(Math.abs(w), Math.abs(h));
    switch (prst) {
      case 'ellipse': case 'flowChartConnector': g.ellipse(x + w / 2, y + h / 2, Math.abs(w / 2), Math.abs(h / 2), 0, 0, Math.PI * 2); break;
      case 'roundRect': case 'flowChartAlternateProcess': {
        const r = m * (av.adj ?? 16667) / 100000;
        if (g.roundRect) g.roundRect(x, y, w, h, r); else g.rect(x, y, w, h);
        break;
      }
      case 'line': case 'straightConnector1': case 'bentConnector2': case 'bentConnector3': case 'curvedConnector3':
        g.moveTo(x, y); g.lineTo(x + w, y + h); return 'line';
      case 'triangle': { const a = (av.adj ?? 50000) / 1e5; poly([[a, 0], [1, 1], [0, 1]]); break; }
      case 'rtTriangle': poly([[0, 0], [1, 1], [0, 1]]); break;
      case 'diamond': case 'flowChartDecision': poly([[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]]); break;
      case 'parallelogram': case 'flowChartInputOutput': poly([[0.25, 0], [1, 0], [0.75, 1], [0, 1]]); break;
      case 'trapezoid': poly([[0.25, 0], [0.75, 0], [1, 1], [0, 1]]); break;
      case 'pentagon': case 'homePlate': poly([[0, 0], [0.8, 0], [1, 0.5], [0.8, 1], [0, 1]]); break;
      case 'chevron': poly([[0, 0], [0.8, 0], [1, 0.5], [0.8, 1], [0, 1], [0.2, 0.5]]); break;
      case 'hexagon': poly([[0.25, 0], [0.75, 0], [1, 0.5], [0.75, 1], [0.25, 1], [0, 0.5]]); break;
      case 'octagon': poly([[0.29, 0], [0.71, 0], [1, 0.29], [1, 0.71], [0.71, 1], [0.29, 1], [0, 0.71], [0, 0.29]]); break;
      case 'rightArrow': poly([[0, 0.25], [0.7, 0.25], [0.7, 0], [1, 0.5], [0.7, 1], [0.7, 0.75], [0, 0.75]]); break;
      case 'leftArrow': poly([[1, 0.25], [0.3, 0.25], [0.3, 0], [0, 0.5], [0.3, 1], [0.3, 0.75], [1, 0.75]]); break;
      case 'upArrow': poly([[0.25, 1], [0.25, 0.3], [0, 0.3], [0.5, 0], [1, 0.3], [0.75, 0.3], [0.75, 1]]); break;
      case 'downArrow': poly([[0.25, 0], [0.25, 0.7], [0, 0.7], [0.5, 1], [1, 0.7], [0.75, 0.7], [0.75, 0]]); break;
      case 'star5': {
        for (let i = 0; i < 10; i++) {
          const r = i % 2 ? 0.19 : 0.5, a = -Math.PI / 2 + i * Math.PI / 5;
          const px = x + w * (0.5 + r * Math.cos(a)), py = y + h * (0.5 + r * Math.sin(a) * 1.05 + 0.03);
          if (i) g.lineTo(px, py); else g.moveTo(px, py);
        }
        g.closePath(); break;
      }
      default: g.rect(x, y, w, h);
    }
    return 'shape';
  };

  /* ---- текст ---- */
  const fontFace = (tf, C, fallback) => {
    if (!tf) return fallback;
    if (/^\+mj/.test(tf)) return C.theme.major;
    if (/^\+mn/.test(tf)) return C.theme.minor;
    return tf;
  };
  const autoNum = (scheme, n) => {
    const roman = (k) => { let r = ''; for (const [v, s] of [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]) while (k >= v) { r += s; k -= v; } return r; };
    const alpha = (k) => String.fromCharCode(96 + ((k - 1) % 26) + 1);
    let core = String(n);
    if (/^alphaLc/.test(scheme)) core = alpha(n);
    else if (/^alphaUc/.test(scheme)) core = alpha(n).toUpperCase();
    else if (/^romanLc/.test(scheme)) core = roman(n).toLowerCase();
    else if (/^romanUc/.test(scheme)) core = roman(n);
    if (/ParenBoth$/.test(scheme)) return `(${core})`;
    if (/ParenR$/.test(scheme)) return `${core})`;
    if (/Plain$/.test(scheme)) return core;
    return `${core}.`;
  };

  /**
   * Текст фигуры. o: { box, chain (lstStyle по приоритету), bodyPrs, C, color (цвет по умолчанию), measure (только высота), bold }
   */
  const drawText = (g, txBody, o) => {
    const { box, C } = o;
    const own = K(txBody, 'bodyPr');
    const bp = (n, d) => { for (const b of [own, ...(o.bodyPrs || [])]) { const v = A(b, n); if (v != null) return v; } return d; };
    const lIns = +bp('lIns', o.ins?.[0] ?? 91440) * S, tIns = +bp('tIns', o.ins?.[1] ?? 45720) * S;
    const rIns = +bp('rIns', o.ins?.[2] ?? 91440) * S, bIns = +bp('bIns', o.ins?.[3] ?? 45720) * S;
    const anchor = o.anchor || bp('anchor', 't');
    const wrap = bp('wrap', 'square') !== 'none';
    const fa = K(own, 'normAutofit');
    const fontScale = fa ? AN(fa, 'fontScale', 100000) / 1e5 : 1;
    const lnRed = fa ? AN(fa, 'lnSpcReduction', 0) / 1e5 : 0;
    const bx = box.x + lIns, by = box.y + tIns, bw = Math.max(4, box.w - lIns - rIns), bh = box.h - tIns - bIns;

    const lines = [];
    let y = 0, first = true;
    const counters = {};
    for (const p of KS(txBody, 'p')) {
      const pPr = K(p, 'pPr');
      const L = AN(pPr, 'lvl', 0) + 1;
      const chainP = [pPr, ...o.chain.map((l) => K(l, `lvl${L}pPr`))];
      const pAttr = (n, d) => { for (const e of chainP) { const v = A(e, n); if (v != null) return v; } return d; };
      const pKid = (...names) => { for (const e of chainP) { if (!e) continue; for (const c of e.children) if (names.includes(c.localName)) return c; } return null; };
      const defs = chainP.map((e) => K(e, 'defRPr')).filter(Boolean);
      const rp = (rPr, n, d) => { const v = A(rPr, n); if (v != null) return v; for (const e of defs) { const v2 = A(e, n); if (v2 != null) return v2; } return d; };
      // свой цвет текста и стиль самой фигуры важнее общих настроек презентации
      const strong = [K(pPr, 'defRPr'), K(o.chain[0] && K(o.chain[0], `lvl${L}pPr`), 'defRPr')].filter(Boolean);
      const rFill = (rPr) => {
        const pick = (e) => {
          const sf = K(e, 'solidFill'); if (sf) return color(sf, C);
          const gf = K(e, 'gradFill'); if (gf) return color(K(K(gf, 'gsLst'), 'gs'), C);
          return null;
        };
        for (const e of [rPr, ...strong]) { const c = e && pick(e); if (c) return c; }
        if (o.styleColor) return o.styleColor;
        for (const e of defs) {
          if (!e) continue;
          const sf = K(e, 'solidFill'); if (sf) return color(sf, C);
          const gf = K(e, 'gradFill'); if (gf) return color(K(K(gf, 'gsLst'), 'gs'), C);
        }
        return null;
      };
      const rFont = (rPr) => { for (const e of [rPr, ...defs]) { const tf = A(K(e, 'latin'), 'typeface'); if (tf) return tf; } return null; };
      const mk = (rPr, text) => {
        const pt = rp(rPr, 'sz', 1800) / 100 * fontScale;
        const size = Math.max(1, pt * 12700 * S);
        const b = /^(1|true)$/.test(rp(rPr, 'b', o.bold ? '1' : '0')), it = /^(1|true)$/.test(rp(rPr, 'i', '0'));
        const face = fontFace(rFont(rPr), C, o.titleFont ? C.theme.major : C.theme.minor);
        const caps = rp(rPr, 'cap', 'none') === 'all';
        return {
          text: caps ? text.toUpperCase() : text, size,
          font: `${it ? 'italic ' : ''}${b ? 'bold ' : ''}${size.toFixed(1)}px "${face}", "Calibri", "Arial", sans-serif`,
          color: rFill(rPr) || o.color, u: rp(rPr, 'u', 'none') !== 'none',
        };
      };
      const runs = [];
      for (const c of p.children) {
        if (c.localName === 'r' || c.localName === 'fld') runs.push(mk(K(c, 'rPr'), (K(c, 't')?.textContent || '').replace(/\t/g, '    ')));
        else if (c.localName === 'br') runs.push({ ...mk(K(c, 'rPr'), ''), br: true });
      }
      const endR = mk(K(p, 'endParaRPr'), '');
      const hasText = runs.some((r) => r.text.trim());

      // маркер списка
      let bullet = null;
      const bu = pKid('buNone', 'buChar', 'buAutoNum', 'buBlip');
      if (!bu || bu.localName !== 'buAutoNum') delete counters[L];
      if (hasText && bu && bu.localName !== 'buNone') {
        const base = runs.find((r) => r.text.trim()) || endR;
        const pct = AN(pKid('buSzPct'), 'val', 100000) / 1e5;
        const bface = A(pKid('buFont'), 'typeface') || '';
        let ch = '•';
        if (bu.localName === 'buChar') {
          ch = A(bu, 'char', '•');
          const code = ch.charCodeAt(0);
          if (code >= 0xF000) ch = String.fromCharCode(code - 0xF000);
          if (/Wingdings|Symbol/i.test(bface)) ch = WING_BULLETS[ch] || '•';
        } else if (bu.localName === 'buAutoNum') {
          counters[L] = (counters[L] ?? (AN(bu, 'startAt', 1) - 1)) + 1;
          ch = autoNum(A(bu, 'type', 'arabicPeriod'), counters[L]);
        }
        const size = base.size * pct;
        bullet = { text: ch, size, font: base.font.replace(/[\d.]+px/, `${size.toFixed(1)}px`), color: color(pKid('buClr'), C) || base.color };
      }
      for (const k of Object.keys(counters)) if (+k > L) delete counters[k];

      const marL = +pAttr('marL', 0) * S, indent = +pAttr('indent', 0) * S;
      const algn = pAttr('algn', 'l');
      const firstX = bullet ? marL : Math.max(0, marL + indent);
      const lnSpc = pKid('lnSpc');
      const spcPct = K(lnSpc, 'spcPct'), spcPts = K(lnSpc, 'spcPts');
      const spacing = (el, size) => {
        if (!el) return 0;
        const pts = K(el, 'spcPts'), pct = K(el, 'spcPct');
        if (pts) return AN(pts, 'val') / 100 * 12700 * S;
        if (pct) return AN(pct, 'val') / 1e5 * size * 1.2;
        return 0;
      };

      // разбивка на строки
      const plines = [];
      let line = { items: [], w: 0, size: 0, x0: firstX };
      const avail = (ln) => bw - ln.x0;
      const newLine = () => { plines.push(line); line = { items: [], w: 0, size: 0, x0: marL }; };
      for (const r of runs) {
        if (r.br) { line.size = Math.max(line.size, r.size); newLine(); continue; }
        g.font = r.font;
        for (const tok of r.text.split(/(\s+)/).filter(Boolean)) {
          const space = /^\s+$/.test(tok);
          let tw = g.measureText(tok).width;
          if (wrap && !space && line.items.length && line.w + tw > avail(line)) newLine();
          if (space && !line.items.length && plines.length) continue;
          if (wrap && !space && tw > avail(line)) {
            // слово длиннее строки — режем по буквам
            let chunk = '';
            for (const ch of tok) {
              const cw = g.measureText(chunk + ch).width;
              if (chunk && line.w + cw > avail(line)) { line.items.push({ r, text: chunk, x: line.w }); line.w += g.measureText(chunk).width; line.size = Math.max(line.size, r.size); newLine(); chunk = ch; } else chunk += ch;
            }
            tw = g.measureText(chunk).width;
            line.items.push({ r, text: chunk, x: line.w }); line.w += tw; line.size = Math.max(line.size, r.size);
            continue;
          }
          line.items.push({ r, text: tok, x: line.w }); line.w += tw; line.size = Math.max(line.size, r.size);
        }
      }
      plines.push(line);

      const pSize = Math.max(...plines.map((l) => l.size), 0) || endR.size;
      if (!first) y += spacing(pKid('spcBef'), pSize);
      for (const ln of plines) {
        const size = ln.size || endR.size;
        const lh = spcPts ? AN(spcPts, 'val') / 100 * 12700 * S : size * 1.2 * Math.max(0.5, (spcPct ? AN(spcPct, 'val') / 1e5 : 1) - lnRed);
        // ширина без пробелов в конце строки — для выравнивания
        let tw = ln.w;
        for (let k = ln.items.length - 1; k >= 0 && /^\s+$/.test(ln.items[k].text); k--) tw = ln.items[k].x;
        lines.push({ ...ln, y, lh, size, tw, algn, bullet: ln === plines[0] ? bullet : null, bulletX: marL + indent });
        y += lh;
      }
      y += spacing(pKid('spcAft'), pSize);
      first = false;
    }
    const total = y;
    if (o.measure) return total + tIns + bIns;

    const top = by + (anchor === 'ctr' ? (bh - total) / 2 : anchor === 'b' ? bh - total : 0);
    g.textBaseline = 'alphabetic';
    for (const ln of lines) {
      const av = bw - ln.x0;
      const x0 = bx + ln.x0 + (ln.algn === 'ctr' ? (av - ln.tw) / 2 : ln.algn === 'r' ? av - ln.tw : 0);
      const base = top + ln.y + (ln.lh + ln.size * 0.7) / 2;
      if (ln.bullet) {
        g.font = ln.bullet.font; g.fillStyle = css(ln.bullet.color);
        g.fillText(ln.bullet.text, bx + Math.max(0, ln.bulletX), base);
      }
      for (const it of ln.items) {
        if (/^\s+$/.test(it.text)) continue;
        g.font = it.r.font; g.fillStyle = css(it.r.color);
        g.fillText(it.text, x0 + it.x, base);
        if (it.r.u) { const w = g.measureText(it.text).width; g.fillRect(x0 + it.x, base + it.r.size * 0.1, w, Math.max(1, it.r.size / 16)); }
      }
    }
    return total;
  };
  const hasText = (tx) => !!tx && [...tx.getElementsByTagNameNS('*', 't')].some((t) => t.textContent.trim());

  /* ---- заполнители (placeholder) макета и образца ---- */
  const phOf = (el) => { const nv = [...el.children].find((c) => /^nv/.test(c.localName)); return Q(nv, 'nvPr', 'ph'); };
  const phList = (pt) => (pt && pt.doc ? [...pt.doc.getElementsByTagNameNS('*', 'sp')].filter((sp) => phOf(sp)).map((sp) => ({ sp, type: A(phOf(sp), 'type', 'obj'), idx: A(phOf(sp), 'idx') })) : []);
  const normType = (t) => (t === 'ctrTitle' ? 'title' : t === 'subTitle' || t === 'obj' ? 'body' : t);
  const findPh = (list, type, idx) => {
    if (idx != null) { const m = list.find((p) => p.idx === idx); if (m) return m; }
    return list.find((p) => normType(p.type) === normType(type)) || null;
  };
  const styleFor = (master, type) => {
    const ts = Q(master?.doc?.documentElement, 'txStyles');
    const t = normType(type);
    return K(ts, t === 'title' ? 'titleStyle' : ['dt', 'ftr', 'sldNum', 'hdr'].includes(t) ? 'otherStyle' : 'bodyStyle');
  };

  /* ---- положение фигуры ---- */
  const boxOf = (xfrm, T) => {
    const off = K(xfrm, 'off'), ext = K(xfrm, 'ext');
    return {
      x: T.ox + AN(off, 'x') * T.sx, y: T.oy + AN(off, 'y') * T.sy, w: AN(ext, 'cx') * T.sx, h: AN(ext, 'cy') * T.sy,
      rot: AN(xfrm, 'rot') / 60000 * Math.PI / 180, fh: A(xfrm, 'flipH') === '1', fv: A(xfrm, 'flipV') === '1',
      ext: { cx: AN(ext, 'cx'), cy: AN(ext, 'cy') },
    };
  };
  const place = (g, b, flip) => {
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    g.translate(cx, cy);
    if (b.rot) g.rotate(b.rot);
    if (flip && (b.fh || b.fv)) g.scale(b.fh ? -1 : 1, b.fv ? -1 : 1);
    g.translate(-cx, -cy);
  };

  /* ---- отдельные элементы ---- */
  const drawShape = async (g, el, pt, ctx) => {
    const ph = phOf(el);
    if (ph && !ctx.isSlide) return; // заполнители макета/образца не рисуются
    const C = ctx.C;
    let lay = null, mas = null;
    if (ph) {
      const type = A(ph, 'type', 'obj'), idx = A(ph, 'idx');
      lay = findPh(ctx.layoutPhs, type, idx);
      mas = findPh(ctx.masterPhs, lay ? lay.type : type, null);
    }
    const spPr = K(el, 'spPr');
    const xfrm = K(spPr, 'xfrm') || K(K(lay?.sp, 'spPr'), 'xfrm') || K(K(mas?.sp, 'spPr'), 'xfrm');
    if (!xfrm) return;
    const b = boxOf(xfrm, ctx.T);
    const style = K(el, 'style');
    let fill = fillOf(spPr), fillPh = null;
    if (fill == null && ph) fill = fillOf(K(lay?.sp, 'spPr')) ?? fillOf(K(mas?.sp, 'spPr'));
    let fillPart = pt;
    if (fill == null && style) { const tf = themeFill(K(style, 'fillRef'), C); if (tf) { fill = tf.f; fillPh = tf.ph; fillPart = tf.pt || pt; } }
    const ln = lineOf(spPr, style, C) || (ph ? lineOf(K(lay?.sp, 'spPr'), null, C) : null);
    const geomSrc = (K(spPr, 'prstGeom') || K(spPr, 'custGeom')) ? spPr : (K(lay?.sp, 'spPr') || spPr);

    g.save();
    place(g, b, true);
    const kind = geomPath(g, geomSrc, b.x, b.y, b.w, b.h, b.ext);
    if (kind !== 'line') await paint(g, fill, C, fillPart, fillPh, b.x, b.y, b.w, b.h);
    if (ln) { g.strokeStyle = css(ln.c); g.lineWidth = ln.w; g.setLineDash(ln.dash || []); g.stroke(); g.setLineDash([]); }
    g.restore();

    const tx = K(el, 'txBody');
    if (!hasText(tx)) return;
    const type = ph ? A(ph, 'type', 'obj') : null;
    const fontRefColor = color(K(style, 'fontRef'), C);
    const chain = ph
      ? [K(tx, 'lstStyle'), K(K(lay?.sp, 'txBody'), 'lstStyle'), K(K(mas?.sp, 'txBody'), 'lstStyle'), styleFor(ctx.master, type), defaultTS]
      : [K(tx, 'lstStyle'), K(C.theme.txDef, 'lstStyle'), defaultTS];
    const bodyPrs = ph ? [K(K(lay?.sp, 'txBody'), 'bodyPr'), K(K(mas?.sp, 'txBody'), 'bodyPr')] : [K(C.theme.txDef, 'bodyPr')];
    g.save();
    place(g, b, false);
    drawText(g, tx, {
      box: b, C, chain, bodyPrs,
      color: fontRefColor || rgbOf(C.theme.colors[C.map.tx1 || 'dk1'] || '000000'), styleColor: ph ? null : fontRefColor,
      titleFont: type && normType(type) === 'title',
    });
    g.restore();
  };

  const drawPic = async (g, el, pt, ctx) => {
    const ph = phOf(el);
    if (ph && !ctx.isSlide) return;
    const spPr = K(el, 'spPr');
    let xfrm = K(spPr, 'xfrm');
    if (!xfrm && ph) xfrm = K(K(findPh(ctx.layoutPhs, A(ph, 'type', 'obj'), A(ph, 'idx'))?.sp, 'spPr'), 'xfrm');
    if (!xfrm) return;
    const b = boxOf(xfrm, ctx.T);
    const bf = K(el, 'blipFill');
    const img = await image(pt, bf);
    g.save();
    place(g, b, true);
    if (img) {
      geomPath(g, spPr, b.x, b.y, b.w, b.h, b.ext);
      g.save(); g.clip(); drawImg(g, img, bf, b.x, b.y, b.w, b.h); g.restore();
    }
    const ln = lineOf(spPr, K(el, 'style'), ctx.C);
    if (ln) { geomPath(g, spPr, b.x, b.y, b.w, b.h, b.ext); g.strokeStyle = css(ln.c); g.lineWidth = ln.w; g.stroke(); }
    g.restore();
  };

  const drawTable = async (g, el, tbl, ctx) => {
    const C = ctx.C;
    const b = boxOf(K(el, 'xfrm'), ctx.T);
    const cols = KS(K(tbl, 'tblGrid'), 'gridCol').map((c) => AN(c, 'w') * ctx.T.sx);
    const tblPr = K(tbl, 'tblPr');
    const firstRow = A(tblPr, 'firstRow') === '1', band = A(tblPr, 'bandRow') === '1';
    const accent = rgbOf(C.theme.colors.accent1 || '4472C4');
    const textColor = rgbOf(C.theme.colors[C.map.tx1 || 'dk1'] || '000000');
    const rows = KS(tbl, 'tr');
    let y = b.y;
    g.save();
    place(g, b, false);
    for (let ri = 0; ri < rows.length; ri++) {
      const tr = rows[ri];
      const cells = KS(tr, 'tc');
      // высота строки: не меньше, чем нужно тексту
      let h = AN(tr, 'h') * ctx.T.sy;
      const geo = [];
      for (let ci = 0, k = 0; k < cells.length; k++) {
        const tc = cells[k];
        const span = AN(tc, 'gridSpan', 1);
        const w = cols.slice(ci, ci + span).reduce((a, v) => a + v, 0);
        geo.push({ tc, x: b.x + cols.slice(0, ci).reduce((a, v) => a + v, 0), w, skip: A(tc, 'hMerge') === '1' || A(tc, 'vMerge') === '1' });
        ci += span;
      }
      const head = firstRow && ri === 0;
      const opts = (tc, cb) => {
        const tcPr = K(tc, 'tcPr');
        return {
          box: cb, C, chain: [K(K(tc, 'txBody'), 'lstStyle'), defaultTS], bodyPrs: [],
          ins: [AN(tcPr, 'marL', 91440), AN(tcPr, 'marT', 45720), AN(tcPr, 'marR', 91440), AN(tcPr, 'marB', 45720)],
          anchor: A(tcPr, 'anchor', 't'), color: head ? { r: 255, g: 255, b: 255, a: 1 } : textColor, styleColor: head ? { r: 255, g: 255, b: 255, a: 1 } : null, bold: head,
        };
      };
      for (const c of geo) if (!c.skip && hasText(K(c.tc, 'txBody'))) h = Math.max(h, drawText(g, K(c.tc, 'txBody'), { ...opts(c.tc, { x: c.x, y, w: c.w, h }), measure: true }));
      for (const c of geo) {
        if (c.skip) continue;
        const tcPr = K(c.tc, 'tcPr');
        g.beginPath(); g.rect(c.x, y, c.w, h);
        const f = fillOf(tcPr);
        if (f) await paint(g, f, C, ctx.part, null, c.x, y, c.w, h);
        else if (head) { g.fillStyle = css(accent); g.fill(); }
        else if (band) {
          const k = (ri - (firstRow ? 1 : 0)) % 2 ? 0.2 : 0.4; // светлые полосы цвета темы, как в стиле таблицы PowerPoint
          g.fillStyle = css({ r: 255 - (255 - accent.r) * k, g: 255 - (255 - accent.g) * k, b: 255 - (255 - accent.b) * k, a: 1 }); g.fill();
        }
        g.strokeStyle = 'rgba(255,255,255,0.9)';
        if (!f && !head && !band) g.strokeStyle = 'rgba(0,0,0,0.35)';
        g.lineWidth = Math.max(1, S * 12700);
        g.stroke();
        const tx = K(c.tc, 'txBody');
        if (hasText(tx)) drawText(g, tx, opts(c.tc, { x: c.x, y, w: c.w, h }));
      }
      y += h;
    }
    g.restore();
  };

  const drawFrame = async (g, el, pt, ctx) => {
    const gd = Q(el, 'graphic', 'graphicData');
    const uri = A(gd, 'uri', '');
    const tbl = K(gd, 'tbl');
    if (tbl) { await drawTable(g, el, tbl, { ...ctx, part: pt }); return; }
    if (/diagram/.test(uri)) {
      // SmartArt: PowerPoint сохраняет готовый рисунок в ppt/diagrams/drawingN.xml
      const ids = K(gd, 'relIds');
      const dm = ids && pt.rels[AL(ids, 'dm')];
      const drawingPath = dm && dm.target.replace(/\/data(\d*)\.xml$/, '/drawing$1.xml');
      const dp = drawingPath && zip.file(drawingPath) ? await part(drawingPath) : null;
      const tree = dp && dp.doc.getElementsByTagNameNS('*', 'spTree')[0];
      if (tree) {
        const b = boxOf(K(el, 'xfrm'), ctx.T);
        await drawTree(g, tree, dp, { ...ctx, T: { ox: b.x, oy: b.y, sx: ctx.T.sx, sy: ctx.T.sy }, isSlide: true, layoutPhs: [], masterPhs: [] });
        return;
      }
    }
    if (/chart/.test(uri)) skipped.charts++;
  };

  const drawTree = async (g, tree, pt, ctx) => {
    for (const el of tree.children) {
      switch (el.localName) {
        case 'AlternateContent': { const fb = K(el, 'Fallback') || K(el, 'Choice'); if (fb) await drawTree(g, fb, pt, ctx); break; }
        case 'grpSp': {
          const xf = Q(el, 'grpSpPr', 'xfrm');
          let T = ctx.T;
          if (xf) {
            const off = K(xf, 'off'), ext = K(xf, 'ext'), cho = K(xf, 'chOff'), che = K(xf, 'chExt');
            const kx = AN(che, 'cx') ? AN(ext, 'cx') / AN(che, 'cx') : 1, ky = AN(che, 'cy') ? AN(ext, 'cy') / AN(che, 'cy') : 1;
            const sx = T.sx * kx, sy = T.sy * ky;
            T = { sx, sy, ox: T.ox + T.sx * AN(off, 'x') - AN(cho, 'x') * sx, oy: T.oy + T.sy * AN(off, 'y') - AN(cho, 'y') * sy };
          }
          await drawTree(g, el, pt, { ...ctx, T });
          break;
        }
        case 'sp': case 'cxnSp': await drawShape(g, el, pt, ctx); break;
        case 'pic': await drawPic(g, el, pt, ctx); break;
        case 'graphicFrame': await drawFrame(g, el, pt, ctx); break;
      }
    }
  };

  const drawBg = async (g, parts, C) => {
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
    for (const pt of parts) {
      const bg = Q(pt.doc?.documentElement, 'cSld', 'bg');
      if (!bg) continue;
      g.beginPath(); g.rect(0, 0, W, H);
      const f = fillOf(K(bg, 'bgPr'));
      if (f && f !== 'none') { await paint(g, f, C, pt, null, 0, 0, W, H); return; }
      const ref = K(bg, 'bgRef');
      if (ref) {
        const tf = themeFill(ref, C);
        if (tf) await paint(g, tf.f, C, tf.pt || pt, tf.ph, 0, 0, W, H);
        else { const c = color(ref, C); if (c) { g.fillStyle = css(c); g.fill(); } }
        return;
      }
    }
  };

  /* ---- слайды по очереди ---- */
  const visible = [];
  for (const p of slidePaths) {
    const sl = await part(p);
    if (sl.doc && A(sl.doc.documentElement, 'show') !== '0') visible.push(sl);
  }
  if (!visible.length) throw new Error('Все слайды презентации скрыты.');
  for (let i = 0; i < visible.length; i++) {
    onStatus && onStatus(`Слайд ${i + 1} из ${visible.length}…`);
    const slide = visible[i];
    const layout = await part(relOfType(slide.rels, 'slideLayout')?.target);
    const master = layout && await part(relOfType(layout.rels, 'slideMaster')?.target);
    const theme = await themeOf(master);
    const map = {};
    for (const src of [K(master?.doc?.documentElement, 'clrMap'), Q(layout?.doc?.documentElement, 'clrMapOvr', 'overrideClrMapping'), Q(slide.doc.documentElement, 'clrMapOvr', 'overrideClrMapping')]) {
      if (src) for (const a of src.attributes) map[a.localName] = a.value;
    }
    if (!map.tx1) Object.assign(map, { bg1: 'lt1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2' });
    const C = { theme, map };
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const g = canvas.getContext('2d');
    await drawBg(g, [slide, layout, master].filter((x) => x && x.doc), C);
    const ctx = { C, T: { ox: 0, oy: 0, sx: S, sy: S }, isSlide: false, layoutPhs: phList(layout), masterPhs: phList(master), master };
    const showM = (pt) => !pt || !pt.doc || A(pt.doc.documentElement, 'showMasterSp') !== '0';
    const treeOf = (pt) => pt?.doc?.getElementsByTagNameNS('*', 'spTree')[0];
    if (master && showM(slide) && showM(layout) && treeOf(master)) await drawTree(g, treeOf(master), master, ctx);
    if (layout && showM(slide) && treeOf(layout)) await drawTree(g, treeOf(layout), layout, ctx);
    if (treeOf(slide)) await drawTree(g, treeOf(slide), slide, { ...ctx, isSlide: true });
    await onSlide(canvas, i, visible.length, CX / 12700);
  }
  return { slides: visible.length, skipped };
}

/** PPTX → PDF (по странице на слайд) или JPG (один слайд — картинка, несколько — ZIP) без PowerPoint */
async function slidesConvert(file, target, opts, onProgress, onStatus) {
  const pdf = target === 'pdf' ? await createImagePdf() : null;
  const jpgs = [];
  const q = Math.min(0.95, Math.max(0.6, opts.quality || 0.9));
  const info = await renderPptx(file, 1920, async (canvas, i, n, wPt) => {
    onProgress((i + 1) / n);
    if (pdf) pdf.add(canvas, q, wPt);
    else jpgs.push(await canvasToBlob(canvas, 'image/jpeg', q));
  }, onStatus);
  const miss = [];
  if (info.skipped.charts) miss.push(`диаграмм: ${info.skipped.charts}`);
  if (info.skipped.images) miss.push(`картинок: ${info.skipped.images}`);
  const warn = miss.length ? `⚠ не нарисовано ${miss.join(', ')}` : undefined;
  if (pdf) return { blob: pdf.blob(), ext: 'pdf', warn };
  if (jpgs.length === 1) return { blob: jpgs[0], ext: 'jpg', warn };
  await loadLib('jszip');
  const zip = new JSZip();
  const pad = String(jpgs.length).length;
  jpgs.forEach((b, i) => zip.file(`Слайд ${String(i + 1).padStart(pad, '0')}.jpg`, b));
  return { blob: await zip.generateAsync({ type: 'blob', compression: 'STORE' }), ext: 'zip', note: 'слайды в ZIP', warn };
}
