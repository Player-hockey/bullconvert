'use strict';

/* =====================================================================
   BullConvert — дополнительные форматы.
   Запись: ODT (OpenDocument), RTF, ODS/XLS (таблицы).
   Чтение: субтитры SRT/VTT, письма EML, презентации ODP.
   Всё работает в браузере, без сервера.
   ===================================================================== */

/* ---------------------------- HTML → ODT ---------------------------- */

async function htmlToOdt(html) {
  await loadLib('jszip');
  const root = document.createElement('div');
  root.innerHTML = html;
  const images = await prepareImages(root);
  const blocks = collectBlocks(root);
  const textStyles = new Map(); // сочетание оформления → имя стиля
  const tStyle = (r) => {
    const key = ['b', 'i', 'u', 's', 'va', 'mono'].map((k) => (r[k] ? (k === 'va' ? r.va : k) : '')).join('|');
    if (key === '|||||') return '';
    if (!textStyles.has(key)) textStyles.set(key, { name: 'T' + (textStyles.size + 1), r });
    return textStyles.get(key).name;
  };
  const span = (r) => {
    if (r.br) return '<text:line-break/>';
    if (r.img) return odtImage(images[r.img]);
    const t = escapeXml(r.text || '').replace(/ {2,}/g, (m) => ` <text:s text:c="${m.length - 1}"/>`).replace(/\t/g, '<text:tab/>');
    const st = tStyle(r);
    return st ? `<text:span text:style-name="${st}">${t}</text:span>` : t;
  };
  const pStyle = (b) => {
    const al = { center: 'C', right: 'R', justify: 'J' }[b.align] || '';
    const ind = b.indent >= 0 ? 'I' + Math.min(b.indent + 1, 6) : '';
    return b.mono ? 'Code' : al || ind ? `P${al}${ind}` : 'Standard';
  };
  let pageBreakNext = false;
  const para = (b) => {
    const runs = [...b.runs];
    while (runs.length && runs[runs.length - 1].br) runs.pop();
    const body = runs.map(span).join('');
    let st = b.style ? 'Heading_20_' + b.style.slice(-1) : pStyle(b);
    if (pageBreakNext) { st = 'Break'; pageBreakNext = false; }
    if (b.style) return `<text:h text:style-name="${st}" text:outline-level="${b.style.slice(-1)}">${body}</text:h>`;
    return `<text:p text:style-name="${st}">${body}</text:p>`;
  };
  let tableN = 0;
  const table = (rows) => {
    tableN++;
    const grid = [];
    rows.forEach((r, ri) => {
      grid[ri] = grid[ri] || [];
      let c = 0;
      for (const cell of r) {
        while (grid[ri][c]) c++;
        for (let dr = 0; dr < cell.rowspan; dr++) for (let dc = 0; dc < cell.colspan; dc++) {
          grid[ri + dr] = grid[ri + dr] || [];
          grid[ri + dr][c + dc] = dr || dc ? { cover: true } : { cell };
        }
        c += cell.colspan;
      }
    });
    const cols = Math.max(1, ...grid.map((r) => r.length));
    const cellXml = (g) => {
      if (!g) return '<table:table-cell table:style-name="Cell"><text:p/></table:table-cell>';
      if (g.cover) return '<table:covered-table-cell/>';
      const c = g.cell;
      const paras = [[]];
      for (const r of c.runs) { if (r.br) paras.push([]); else paras[paras.length - 1].push(c.th && !r.img ? { ...r, b: true } : r); }
      const st = c.th ? 'PC' : pStyle({ align: c.align });
      const ps = paras.filter((p, i) => p.length || i === 0).map((p) => `<text:p text:style-name="${st}">${p.map(span).join('')}</text:p>`).join('');
      const sp = (c.colspan > 1 ? ` table:number-columns-spanned="${c.colspan}"` : '') + (c.rowspan > 1 ? ` table:number-rows-spanned="${c.rowspan}"` : '');
      return `<table:table-cell table:style-name="Cell" office:value-type="string"${sp}>${ps}</table:table-cell>`;
    };
    return `<table:table table:name="Таблица${tableN}" table:style-name="Tbl"><table:table-column table:number-columns-repeated="${cols}"/>` +
      grid.map((r) => `<table:table-row>${Array.from({ length: cols }, (_, i) => cellXml(r[i])).join('')}</table:table-row>`).join('') +
      '</table:table>';
  };
  const body = blocks.map((b) => {
    if (b.pageBreak) { pageBreakNext = true; return ''; }
    if (b.table) return table(b.table);
    return para(b);
  }).join('');

  const tsXml = [...textStyles.values()].map(({ name, r }) => `<style:style style:name="${name}" style:family="text"><style:text-properties` +
    (r.b ? ' fo:font-weight="bold" style:font-weight-asian="bold" style:font-weight-complex="bold"' : '') +
    (r.i ? ' fo:font-style="italic" style:font-style-asian="italic" style:font-style-complex="italic"' : '') +
    (r.u ? ' style:text-underline-style="solid" style:text-underline-width="auto" style:text-underline-color="font-color"' : '') +
    (r.s ? ' style:text-line-through-style="solid"' : '') +
    (r.va === 'superscript' ? ' style:text-position="super 58%"' : r.va === 'subscript' ? ' style:text-position="sub 58%"' : '') +
    (r.mono ? ' style:font-name="Courier New"' : '') + '/></style:style>').join('');
  const pAuto = [];
  for (const al of ['', 'C', 'R', 'J']) for (let i = 0; i <= 6; i++) {
    if (!al && !i) continue;
    const fo = { C: 'center', R: 'end', J: 'justify' }[al];
    pAuto.push(`<style:style style:name="P${al}${i ? 'I' + i : ''}" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties${fo ? ` fo:text-align="${fo}"` : ''}${i ? ` fo:margin-left="${(i * 0.63).toFixed(2)}cm"` : ''}/></style:style>`);
  }
  const NS = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" ' +
    'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" ' +
    'xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" ' +
    'xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" office:version="1.3"';
  const fonts = '<office:font-face-decls><style:font-face style:name="Times New Roman" svg:font-family="\'Times New Roman\'" style:font-family-generic="roman"/>' +
    '<style:font-face style:name="Courier New" svg:font-family="\'Courier New\'" style:font-family-generic="modern" style:font-pitch="fixed"/></office:font-face-decls>';
  const content = `<?xml version="1.0" encoding="UTF-8"?><office:document-content ${NS}>${fonts}<office:automatic-styles>${tsXml}${pAuto.join('')}` +
    '<style:style style:name="Break" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:break-before="page"/></style:style>' +
    '<style:style style:name="Tbl" style:family="table"><style:table-properties style:width="17cm" table:align="margins" fo:margin-bottom="0.2cm"/></style:style>' +
    '<style:style style:name="Cell" style:family="table-cell"><style:table-cell-properties fo:padding="0.1cm" fo:border="0.5pt solid #808080"/></style:style>' +
    '<style:style style:name="Img" style:family="graphic"><style:graphic-properties style:wrap="none" style:vertical-pos="top" style:vertical-rel="baseline"/></style:style>' +
    `</office:automatic-styles><office:body><office:text>${body || '<text:p/>'}</office:text></office:body></office:document-content>`;
  const heading = (n, sz) => `<style:style style:name="Heading_20_${n}" style:display-name="Heading ${n}" style:family="paragraph" style:parent-style-name="Standard" style:next-style-name="Standard" style:default-outline-level="${n}">` +
    `<style:paragraph-properties fo:margin-top="0.42cm" fo:margin-bottom="0.21cm" fo:keep-with-next="always"/><style:text-properties fo:font-size="${sz}pt" fo:font-weight="bold"/></style:style>`;
  const styles = `<?xml version="1.0" encoding="UTF-8"?><office:document-styles ${NS}>${fonts}<office:styles>` +
    '<style:default-style style:family="paragraph"><style:text-properties style:font-name="Times New Roman" fo:font-size="12pt" fo:language="ru" fo:country="RU"/></style:default-style>' +
    '<style:style style:name="Standard" style:family="paragraph"><style:paragraph-properties fo:margin-bottom="0.21cm" fo:line-height="115%"/></style:style>' +
    '<style:style style:name="Code" style:family="paragraph" style:parent-style-name="Standard"><style:text-properties style:font-name="Courier New" fo:font-size="10pt"/></style:style>' +
    heading(1, 18) + heading(2, 15) + heading(3, 13) +
    '</office:styles><office:automatic-styles><style:page-layout style:name="PM1"><style:page-layout-properties fo:page-width="21cm" fo:page-height="29.7cm" ' +
    'fo:margin-top="2cm" fo:margin-bottom="2cm" fo:margin-left="2.5cm" fo:margin-right="1.5cm"/></style:page-layout></office:automatic-styles>' +
    '<office:master-styles><style:master-page style:name="Standard" style:page-layout-name="PM1"/></office:master-styles></office:document-styles>';
  const zip = new JSZip();
  zip.file('mimetype', 'application/vnd.oasis.opendocument.text', { compression: 'STORE' });
  zip.file('content.xml', content);
  zip.file('styles.xml', styles);
  zip.file('meta.xml', `<?xml version="1.0" encoding="UTF-8"?><office:document-meta ${NS} xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0"><office:meta><meta:generator>BullConvert</meta:generator></office:meta></office:document-meta>`);
  const man = ['<manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text" manifest:version="1.3"/>',
    '<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>', '<manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/>',
    '<manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/>'];
  for (const im of Object.values(images)) {
    zip.file(`Pictures/${im.id}.${im.ext === 'png' ? 'png' : 'jpg'}`, im.b64, { base64: true });
    man.push(`<manifest:file-entry manifest:full-path="Pictures/${im.id}.${im.ext === 'png' ? 'png' : 'jpg'}" manifest:media-type="image/${im.ext}"/>`);
  }
  zip.file('META-INF/manifest.xml', `<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3">${man.join('')}</manifest:manifest>`);
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.oasis.opendocument.text', compression: 'DEFLATE' });
}

function odtImage(im) {
  if (!im) return '';
  const k = Math.min(1, 620 / im.w); // не шире полосы набора
  const w = (im.w * k * 2.54 / 96).toFixed(2), h = (im.h * k * 2.54 / 96).toFixed(2);
  return `<draw:frame draw:style-name="Img" text:anchor-type="as-char" svg:width="${w}cm" svg:height="${h}cm"><draw:image xlink:href="Pictures/${im.id}.${im.ext === 'png' ? 'png' : 'jpg'}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/></draw:frame>`;
}

/* ---------------------------- HTML → RTF ---------------------------- */

const rtfEsc = (s) => String(s).replace(/[\\{}]/g, (c) => '\\' + c).replace(/\t/g, '\\tab ')
  .replace(/[^\x00-\x7f]/g, (c) => { const n = c.charCodeAt(0); return `\\u${n > 32767 ? n - 65536 : n}?`; });

async function htmlToRtf(html) {
  const root = document.createElement('div');
  root.innerHTML = html;
  const images = await prepareImages(root);
  const blocks = collectBlocks(root);
  const hex = (b64) => { const s = atob(b64); let o = ''; for (let i = 0; i < s.length; i++) { o += s.charCodeAt(i).toString(16).padStart(2, '0'); if (i % 64 === 63) o += '\n'; } return o; };
  const run = (r, b) => {
    if (r.br) return '\\line ';
    if (r.img) {
      const im = images[r.img];
      if (!im) return '';
      const k = Math.min(1, 620 / im.w);
      const tw = (v) => Math.round(v * k * 15); // пиксели (96 dpi) → твипы
      return `{\\pict\\${im.ext === 'png' ? 'pngblip' : 'jpegblip'}\\picw${Math.round(im.w)}\\pich${Math.round(im.h)}\\picwgoal${tw(im.w)}\\pichgoal${tw(im.h)}\n${hex(im.b64)}}`;
    }
    const f = (b.mono || r.mono ? '\\f1' : '') + (r.b ? '\\b' : '') + (r.i ? '\\i' : '') + (r.u ? '\\ul' : '') + (r.s ? '\\strike' : '') +
      (r.va === 'superscript' ? '\\super' : r.va === 'subscript' ? '\\sub' : '');
    return f ? `{${f} ${rtfEsc(r.text || '')}}` : rtfEsc(r.text || '');
  };
  const al = (a) => ({ center: '\\qc', right: '\\qr', justify: '\\qj' }[a] || '\\ql');
  const para = (b, inTable = false) => {
    const runs = [...b.runs];
    while (runs.length && runs[runs.length - 1].br) runs.pop();
    const lvl = b.style ? +b.style.slice(-1) : 0;
    const pre = lvl ? `\\s${lvl}\\outlinelevel${lvl - 1}\\b\\fs${[0, 36, 30, 26][lvl]}\\sb240\\sa120\\keepn` : `\\fs24\\sa120`;
    return `\\pard${inTable ? '\\intbl' : ''}\\plain${pre}${al(b.align)}${b.indent >= 0 ? `\\li${360 * (b.indent + 1)}` : ''} ${runs.map((r) => run(r, b)).join('')}${inTable ? '' : '\\par\n'}`;
  };
  const table = (rows) => {
    const grid = [];
    rows.forEach((r, ri) => {
      grid[ri] = grid[ri] || [];
      let c = 0;
      for (const cell of r) {
        while (grid[ri][c]) c++;
        for (let dr = 0; dr < cell.rowspan; dr++) for (let dc = 0; dc < cell.colspan; dc++) {
          grid[ri + dr] = grid[ri + dr] || [];
          grid[ri + dr][c + dc] = { cell, dr, dc };
        }
        c += cell.colspan;
      }
    });
    const cols = Math.max(1, ...grid.map((r) => r.length));
    const W = 9638, cw = Math.floor(W / cols); // ширина полосы набора А4 в твипах
    const brd = '\\clbrdrt\\brdrs\\brdrw10\\clbrdrl\\brdrs\\brdrw10\\clbrdrb\\brdrs\\brdrw10\\clbrdrr\\brdrs\\brdrw10';
    let out = '';
    for (const r of grid) {
      let def = '\\trowd\\trgaph80\\trleft0', cells = '';
      for (let c = 0; c < cols; c++) {
        const g = r[c];
        const vm = g && g.cell.rowspan > 1 ? (g.dr === 0 ? '\\clvmgf' : '\\clvmrg') : '';
        const hm = g && g.cell.colspan > 1 ? (g.dc === 0 ? '\\clmgf' : '\\clmrg') : '';
        def += `${hm}${vm}${brd}\\cellx${cw * (c + 1)}`;
        if (g && g.dr === 0 && g.dc === 0) {
          const runs = g.cell.th ? g.cell.runs.map((x) => (x.img || x.br ? x : { ...x, b: true })) : g.cell.runs;
          cells += para({ runs, align: g.cell.align || (g.cell.th ? 'center' : '') }, true) + '\\cell ';
        } else cells += '\\pard\\intbl\\cell ';
      }
      out += `${def}\n${cells}\\row\n`;
    }
    return out + '\\pard\\par\n';
  };
  const body = blocks.map((b) => (b.pageBreak ? '\\page\n' : b.table ? table(b.table) : para(b))).join('');
  const head = '{\\rtf1\\ansi\\ansicpg1251\\deff0\\uc1{\\fonttbl{\\f0\\froman\\fcharset204 Times New Roman;}{\\f1\\fmodern\\fcharset204 Courier New;}}' +
    '{\\stylesheet{\\s0 Normal;}{\\s1\\b\\fs36 heading 1;}{\\s2\\b\\fs30 heading 2;}{\\s3\\b\\fs26 heading 3;}}' +
    '\\paperw11906\\paperh16838\\margl1417\\margr850\\margt1134\\margb1134\\viewkind4\n';
  return new Blob([head + body + '}'], { type: 'application/rtf' });
}

/* ---------------------------- Субтитры SRT / VTT ---------------------------- */

const subTime = (s) => {
  const m = String(s).trim().replace(',', '.').match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?$/);
  if (!m) return NaN;
  return (+(m[1] || 0)) * 3600 + (+m[2]) * 60 + (+m[3]) + (+(m[4] || '0').padEnd(3, '0')) / 1000;
};
const fmtSubTime = (t, sep) => {
  const ms = Math.round(t * 1000);
  const p = (n, l = 2) => String(n).padStart(l, '0');
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)}${sep}${p(ms % 1000, 3)}`;
};

/** Разбор SRT и WebVTT: [{ start, end, text }] */
function parseSubtitles(text) {
  const cues = [];
  const blocks = text.replace(/\r\n?/g, '\n').replace(/^\uFEFF/, '').split(/\n{2,}/);
  for (const blk of blocks) {
    const lines = blk.split('\n').filter((l) => l.trim() !== '');
    const ti = lines.findIndex((l) => l.includes('-->'));
    if (ti < 0) continue;
    const [a, b] = lines[ti].split('-->');
    const start = subTime(a), end = subTime(String(b).trim().split(/\s+/)[0]);
    if (isNaN(start) || isNaN(end)) continue;
    const body = lines.slice(ti + 1).join('\n');
    if (body) cues.push({ start, end, text: body });
  }
  if (!cues.length) throw new Error('В файле не найдено ни одного субтитра (строки вида «00:00:01,000 --> 00:00:03,000»).');
  return cues;
}

const stripSubTags = (s) => s.replace(/<[^>]+>/g, '').replace(/\{\\[^}]*\}/g, '');

async function convertSubtitles(file, target) {
  const cues = parseSubtitles(await readText(file));
  if (target === 'srt') {
    return new Blob([cues.map((c, i) => `${i + 1}\n${fmtSubTime(c.start, ',')} --> ${fmtSubTime(c.end, ',')}\n${stripSubTags(c.text).trim()}\n`).join('\n')], { type: 'application/x-subrip;charset=utf-8' });
  }
  if (target === 'vtt') {
    return new Blob(['WEBVTT\n\n' + cues.map((c) => `${fmtSubTime(c.start, '.')} --> ${fmtSubTime(c.end, '.')}\n${c.text.trim()}\n`).join('\n')], { type: 'text/vtt;charset=utf-8' });
  }
  return null;
}

/** Субтитры как документ: время и реплики (для PDF, Word, HTML) */
async function subtitlesToHtml(file) {
  const cues = parseSubtitles(await readText(file));
  return `<h1>${escapeHtml(baseOf(file.name))}</h1>` + cues.map((c) =>
    `<p><b>${fmtSubTime(c.start, ',').slice(0, 8)}</b> ${escapeHtml(stripSubTags(c.text)).replace(/\n/g, '<br>')}</p>`).join('\n');
}

/* ---------------------------- Письма EML ---------------------------- */

function decodeWords(s) {
  // =?utf-8?B?...?= и =?windows-1251?Q?...?= в заголовках
  return String(s || '').replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=(\s+(?==\?))?/g, (_, cs, enc, data) => {
    try {
      const bytes = enc.toUpperCase() === 'B' ? Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
        : qpBytes(data.replace(/_/g, ' '));
      return new TextDecoder(cs.toLowerCase()).decode(bytes);
    } catch { return data; }
  });
}

function qpBytes(s) {
  const out = [];
  s = s.replace(/=\r?\n/g, '');
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(s.substr(i + 1, 2))) { out.push(parseInt(s.substr(i + 1, 2), 16)); i += 2; }
    else out.push(s.charCodeAt(i) & 0xff);
  }
  return new Uint8Array(out);
}

function parseMime(raw) {
  const sep = raw.search(/\r?\n\r?\n/);
  const headText = sep < 0 ? raw : raw.slice(0, sep);
  const body = sep < 0 ? '' : raw.slice(sep).replace(/^\r?\n\r?\n/, '');
  const headers = {};
  for (const line of headText.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i > 0) { const k = line.slice(0, i).trim().toLowerCase(); headers[k] = headers[k] ? headers[k] + ', ' + line.slice(i + 1).trim() : line.slice(i + 1).trim(); }
  }
  const ct = headers['content-type'] || 'text/plain';
  const param = (h, name) => { const m = String(h || '').match(new RegExp(`${name}\\*?=(?:"([^"]*)"|([^;\\s]*))`, 'i')); return m ? (m[1] ?? m[2]) : ''; };
  const part = { headers, type: ct.split(';')[0].trim().toLowerCase(), charset: param(ct, 'charset') || 'utf-8', parts: [],
    name: decodeWords(param(headers['content-disposition'], 'filename') || param(ct, 'name')), cid: (headers['content-id'] || '').replace(/[<>]/g, ''),
    attachment: /^attachment/i.test(headers['content-disposition'] || '') };
  if (part.type.startsWith('multipart/')) {
    const b = param(ct, 'boundary');
    if (b) {
      const chunks = body.split(new RegExp(`\\r?\\n?--${b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:--)?[ \\t]*\\r?\\n?`));
      for (const c of chunks.slice(1)) if (c.trim()) part.parts.push(parseMime(c));
    }
  } else {
    const enc = (headers['content-transfer-encoding'] || '').toLowerCase();
    let bytes;
    if (enc === 'base64') { try { bytes = Uint8Array.from(atob(body.replace(/[^A-Za-z0-9+/=]/g, '')), (c) => c.charCodeAt(0)); } catch { bytes = new Uint8Array(0); } }
    else if (enc === 'quoted-printable') bytes = qpBytes(body);
    else bytes = Uint8Array.from(body, (c) => c.charCodeAt(0) & 0xff);
    part.bytes = bytes;
  }
  return part;
}

async function emlToHtml(file) {
  // латиница-1: каждый байт → символ, чтобы потом правильно раскодировать части в их кодировках
  const raw = new TextDecoder('latin1').decode(new Uint8Array(await file.arrayBuffer()));
  const msg = parseMime(raw);
  const all = [];
  (function flat(p) { if (p.parts.length) p.parts.forEach(flat); else all.push(p); })(msg);
  const text = (p) => { try { return new TextDecoder(p.charset.toLowerCase()).decode(p.bytes); } catch { return new TextDecoder('utf-8').decode(p.bytes); } };
  const htmlPart = all.find((p) => p.type === 'text/html' && !p.attachment);
  const plainPart = all.find((p) => p.type === 'text/plain' && !p.attachment);
  let body;
  if (htmlPart) {
    const doc = new DOMParser().parseFromString(text(htmlPart), 'text/html');
    doc.querySelectorAll('script, style, link, meta, iframe, object').forEach((n) => n.remove());
    // встроенные картинки письма (cid:) → data:
    for (const img of doc.querySelectorAll('img[src^="cid:"]')) {
      const p = all.find((x) => x.cid && x.cid === img.getAttribute('src').slice(4));
      if (p && p.bytes) img.setAttribute('src', `data:${p.type};base64,${btoa(Array.from(p.bytes, (b) => String.fromCharCode(b)).join(''))}`);
      else img.remove();
    }
    doc.querySelectorAll('img:not([src^="data:"])').forEach((n) => n.remove()); // внешние картинки (слежка) не грузим
    body = doc.body.innerHTML;
  } else if (plainPart) body = textToHtml(text(plainPart));
  else body = '<p>(письмо без текста)</p>';
  const h = msg.headers;
  const row = (k, v) => (v ? `<tr><th align="left">${k}</th><td>${escapeHtml(decodeWords(v))}</td></tr>` : '');
  const files = all.filter((p) => p.attachment || (p.name && !p.cid && !p.type.startsWith('text/')));
  const date = h.date && !isNaN(new Date(h.date)) ? new Date(h.date).toLocaleString('ru-RU') : h.date;
  return `<h1>${escapeHtml(decodeWords(h.subject || '(без темы)'))}</h1><table>${row('От', h.from)}${row('Кому', h.to)}${row('Копия', h.cc)}${row('Дата', date)}</table>` +
    (files.length ? `<p><b>Вложения:</b> ${files.map((p) => escapeHtml(p.name || 'файл') + ` (${Math.round((p.bytes ? p.bytes.length : 0) / 1024)} КБ)`).join(', ')}</p>` : '') +
    `<p>&nbsp;</p>${body}`;
}

/** Вложения письма отдельными файлами (ZIP) */
async function emlAttachments(file) {
  const raw = new TextDecoder('latin1').decode(new Uint8Array(await file.arrayBuffer()));
  const all = [];
  (function flat(p) { if (p.parts.length) p.parts.forEach(flat); else all.push(p); })(parseMime(raw));
  const files = all.filter((p) => p.bytes && (p.attachment || (p.name && !p.type.startsWith('text/'))));
  if (!files.length) throw new Error('В письме нет вложений.');
  await loadLib('jszip');
  const zip = new JSZip();
  const used = new Set();
  files.forEach((p, i) => {
    let n = (p.name || `вложение-${i + 1}`).replace(/[\\/:*?"<>|]/g, '_');
    while (used.has(n)) n = n.replace(/(\.[^.]*)?$/, `-${i + 1}$1`);
    used.add(n); zip.file(n, p.bytes);
  });
  return { blob: await zip.generateAsync({ type: 'blob' }), ext: 'zip', note: `вложений: ${files.length}` };
}

/* ---------------------------- Презентации ODP ---------------------------- */

async function odpToHtml(file) {
  await loadLib('jszip');
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const cx = zip.file('content.xml');
  if (!cx) throw new Error('Это не презентация OpenDocument (нет content.xml).');
  const doc = new DOMParser().parseFromString(await cx.async('string'), 'application/xml');
  const pages = [...doc.getElementsByTagNameNS('*', 'page')];
  const out = [];
  const paraText = (p) => {
    let s = '';
    for (const n of p.childNodes) {
      if (n.nodeType === 3) s += n.textContent;
      else if (n.localName === 's') s += ' '.repeat(+n.getAttribute('text:c') || 1);
      else if (n.localName === 'tab') s += '\t';
      else if (n.localName === 'line-break') s += '\n';
      else s += paraText(n);
    }
    return s;
  };
  for (let i = 0; i < pages.length; i++) {
    const pg = pages[i];
    if (pg.closest && pg.closest('notes')) continue;
    let title = '';
    const body = [];
    for (const frame of pg.getElementsByTagNameNS('*', 'frame')) {
      if (frame.parentNode && frame.parentNode.localName === 'notes') continue;
      const cls = frame.getAttribute('presentation:class') || '';
      const img = frame.getElementsByTagNameNS('*', 'image')[0];
      const box = frame.getElementsByTagNameNS('*', 'text-box')[0];
      if (box) {
        const ps = [...box.getElementsByTagNameNS('*', 'p'), ...box.getElementsByTagNameNS('*', 'h')].map((p) => paraText(p).trim()).filter(Boolean);
        if (cls === 'title' && !title) { title = ps.join(' '); continue; }
        const inList = box.getElementsByTagNameNS('*', 'list').length > 0;
        body.push(inList ? `<ul>${ps.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}</ul>` : ps.map((t) => `<p>${escapeHtml(t).replace(/\n/g, '<br>')}</p>`).join(''));
      } else if (img) {
        const href = img.getAttribute('xlink:href') || '';
        const f = zip.file(href.replace(/^\.\//, ''));
        if (f && /\.(png|jpe?g|gif|svg|bmp|webp)$/i.test(href)) {
          const type = { svg: 'image/svg+xml', jpg: 'image/jpeg', jpeg: 'image/jpeg' }[href.split('.').pop().toLowerCase()] || 'image/' + href.split('.').pop().toLowerCase();
          body.push(`<p><img src="data:${type};base64,${await f.async('base64')}"></p>`);
        }
      }
      // таблица на слайде
      const tbl = frame.getElementsByTagNameNS('*', 'table')[0];
      if (tbl) {
        const rows = [...tbl.getElementsByTagNameNS('*', 'table-row')].map((r) => `<tr>${[...r.getElementsByTagNameNS('*', 'table-cell')].map((c) => `<td>${escapeHtml(paraText(c).trim())}</td>`).join('')}</tr>`);
        body.push(`<table border="1">${rows.join('')}</table>`);
      }
    }
    out.push(`<h2>Слайд ${out.length + 1}${title ? '. ' + escapeHtml(title) : ''}</h2>\n${body.join('\n')}`);
  }
  if (!out.length) throw new Error('В презентации нет слайдов.');
  return out.join('\n<hr class="page">\n');
}

/* ---------------------------- Таблицы: ODS / XLS ---------------------------- */

/** Таблица Excel/OpenDocument → другая таблица целиком (формулы, объединения, листы сохраняются) */
async function spreadsheetToSpreadsheet(file, target) {
  await loadLib('xlsx');
  const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array', cellFormula: true, cellStyles: true, cellDates: true });
  const bookType = { xlsx: 'xlsx', ods: 'ods', xls: 'biff8' }[target];
  const types = { xlsx: MIME.xlsx, ods: 'application/vnd.oasis.opendocument.spreadsheet', xls: 'application/vnd.ms-excel' };
  return new Blob([XLSX.write(wb, { type: 'array', bookType, compression: true })], { type: types[target] });
}

/* ---------------------------- Быстрый PDF для больших текстов и таблиц ---------------------------- */
// Универсальная вёрстка (pdfmake) на десятках тысяч абзацев работает минутами и «замораживает» страницу.
// Для больших файлов PDF собирается напрямую через jsPDF (без сложного шейпинга текста) — секунды вместо минут.

async function fastPdf(landscape = false) {
  await loadLib('jspdf');
  await loadLib('pdfmake'); await loadLib('pdfmakeFonts'); // шрифт Roboto с кириллицей
  const vfs = window.pdfMake.vfs || (window.pdfMake.virtualfs && window.pdfMake.virtualfs.storage) || {};
  const pdf = new window.jspdf.jsPDF({ unit: 'pt', format: 'a4', orientation: landscape ? 'l' : 'p', compress: true });
  if (vfs['Roboto-Regular.ttf']) {
    pdf.addFileToVFS('Roboto-Regular.ttf', vfs['Roboto-Regular.ttf']);
    pdf.addFont('Roboto-Regular.ttf', 'Roboto', 'normal');
    if (vfs['Roboto-Medium.ttf']) { pdf.addFileToVFS('Roboto-Medium.ttf', vfs['Roboto-Medium.ttf']); pdf.addFont('Roboto-Medium.ttf', 'Roboto', 'bold'); }
    pdf.setFont('Roboto', 'normal');
  }
  pdf.setProperties({ creator: 'BullConvert' });
  return pdf;
}

async function textToPdfFast(text, title, onStatus = () => {}) {
  const pdf = await fastPdf();
  pdf.setProperties({ title });
  const size = 10.5, lh = 1.35, M = 50, W = pdf.internal.pageSize.getWidth(), H = pdf.internal.pageSize.getHeight();
  pdf.setFontSize(size);
  onStatus('Разбивка текста на строки…');
  await tick();
  const src = text.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n');
  const lines = [];
  // переносим кусками, чтобы страница не «замирала»
  for (let i = 0; i < src.length; i += 2000) {
    lines.push(...pdf.splitTextToSize(src.slice(i, i + 2000).join('\n'), W - 2 * M));
    onStatus(`Разбивка текста: ${Math.min(i + 2000, src.length)} из ${src.length} строк…`);
    await tick();
  }
  const per = Math.max(1, Math.floor((H - 2 * M) / (size * lh)));
  for (let i = 0; i < lines.length; i += per) {
    if (i) pdf.addPage();
    pdf.text(lines.slice(i, i + per), M, M + size, { lineHeightFactor: lh });
    if ((i / per) % 100 === 0) { onStatus(`Создание PDF: страница ${i / per + 1} из ${Math.ceil(lines.length / per)}…`); await tick(); }
  }
  return pdf.output('blob');
}

/** Большая таблица → PDF: колонки по ширине содержимого, сетка, шапка повторяется на каждой странице */
async function tableToPdfFast(sheets, title, onStatus = () => {}) {
  const wide = Math.max(...sheets.map((s) => columnsOf(s.rows).length));
  const pdf = await fastPdf(wide > 5);
  pdf.setProperties({ title });
  const W = pdf.internal.pageSize.getWidth(), H = pdf.internal.pageSize.getHeight(), M = 30;
  const size = wide > 9 ? 6.5 : wide > 6 ? 7.5 : 8.5, pad = 3, rh = size * 1.6;
  pdf.setFontSize(size); pdf.setLineWidth(0.4); pdf.setDrawColor(150);
  const str = (v) => (v == null ? '' : String(v).replace(/\s+/g, ' '));
  const tw = (t) => pdf.getTextWidth(t);
  let first = true;
  for (const s of sheets) {
    const cols = columnsOf(s.rows);
    if (!cols.length || !s.rows.length) continue;
    const sample = s.rows.slice(0, 2000);
    const want = cols.map((c) => Math.min(220, Math.max(tw(str(c)), ...sample.map((r) => tw(str(r[c])))) + 2 * pad));
    const k = Math.min(1, (W - 2 * M) / want.reduce((a, b) => a + b, 0));
    const cw = want.map((w) => w * k), tableW = cw.reduce((a, b) => a + b, 0);
    const clip = (t, w) => { if (tw(t) <= w - 2 * pad) return t; let lo = 0, hi = t.length; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (tw(t.slice(0, m) + '…') <= w - 2 * pad) lo = m; else hi = m - 1; } return t.slice(0, lo) + '…'; };
    let y;
    const row = (vals, head) => {
      if (head) { pdf.setFillColor(235, 237, 245); pdf.rect(M, y, tableW, rh, 'F'); }
      let x = M;
      vals.forEach((v, i) => {
        const t = clip(str(v), cw[i]);
        if (t) pdf.text(t, x + pad, y + rh / 2 + size * 0.35);
        x += cw[i];
      });
      // сетка: горизонтальная линия под строкой и вертикальные между колонками
      pdf.line(M, y + rh, M + tableW, y + rh);
      x = M; for (let i = 0; i <= cw.length; i++) { pdf.line(x, y, x, y + rh); x += cw[i] || 0; }
      y += rh;
    };
    const newPage = (withTitle) => {
      if (!first) pdf.addPage(); first = false;
      y = M;
      if (withTitle) { pdf.setFontSize(12); pdf.text(sheets.length > 1 ? s.name : title, M, y + 10); pdf.setFontSize(size); y += 20; }
      pdf.line(M, y, M + tableW, y);
      row(cols, true);
    };
    newPage(true);
    for (let i = 0; i < s.rows.length; i++) {
      if (y + rh > H - M) newPage(false);
      row(cols.map((c) => s.rows[i][c]), false);
      if (i % 3000 === 0) { onStatus(`Создание PDF: строка ${i} из ${s.rows.length}…`); await tick(); }
    }
  }
  if (first) throw new Error('В таблице нет данных.');
  return pdf.output('blob');
}
