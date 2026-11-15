'use strict';

/* =====================================================================
   BullConvert — конвертер файлов.
   Почти всё работает прямо в браузере; часть форматов
   обрабатывает локальный сервер (serve.ps1).
   Библиотеки подгружаются с CDN только когда нужны.
   ===================================================================== */

const CDN = {
  xlsx:        'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
  yaml:        'https://cdn.jsdelivr.net/npm/js-yaml@4.1.0/dist/js-yaml.min.js',
  marked:      'https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js',
  turndown:    'https://cdn.jsdelivr.net/npm/turndown@7.1.3/dist/turndown.js',
  mammoth:     'https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js',
  pdfjs:       'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js',
  pdfjsWorker: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js',
  html2pdf:    'https://cdn.jsdelivr.net/npm/html2pdf.js@0.10.1/dist/html2pdf.bundle.min.js',
  pdfmake:     'https://cdn.jsdelivr.net/npm/pdfmake@0.2.10/build/pdfmake.min.js',
  pdfmakeFonts:'https://cdn.jsdelivr.net/npm/pdfmake@0.2.10/build/vfs_fonts.js',
  htmlToPdfmake:'https://cdn.jsdelivr.net/npm/html-to-pdfmake@2.5.13/browser.js',
  jspdf:       'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js',
  jszip:       'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js',
  lame:        'https://cdn.jsdelivr.net/npm/lamejs@1.2.1/lame.min.js',
  tesseract:   'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js',
  heic2any:    'https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js',
  djvu:        'https://djvu.js.org/assets/dist/djvu.js',
  qrcode:      'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js',
  pdflib:      'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js',
  fontkit:     'https://cdn.jsdelivr.net/npm/@pdf-lib/fontkit@1.1.1/dist/fontkit.umd.min.js',
};

const libPromises = {};
function loadLib(name) {
  if (!libPromises[name]) {
    libPromises[name] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = CDN[name];
      s.onload = resolve;
      s.onerror = () => {
        delete libPromises[name];
        s.remove();
        reject(new Error(`Не удалось загрузить библиотеку «${name}». Проверьте подключение к интернету.`));
      };
      document.head.appendChild(s);
    });
  }
  return libPromises[name];
}

/* ---------------------------- Форматы ---------------------------- */

const CAD_2D = ['cdw', 'frw'];
const CAD_SPEC = ['spw', 'kdw'];
const CAD_ACAD = ['dwg', 'dxf'];
const CAD_3D = ['m3d', 'a3d', 't3d'];
const VIDEO_EXT = ['mp4', 'webm', 'mov', 'mkv'];
const ARCHIVES = ['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz'];

const CATEGORIES = {
  image:   { label: 'Фото',    in: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'ico', 'svg', 'avif', 'heic', 'heif'] },
  data:    { label: 'Данные',  in: ['csv', 'tsv', 'json', 'xlsx', 'xls', 'ods', 'xml', 'yaml', 'yml'] },
  doc:     { label: 'Док',     in: ['txt', 'md', 'markdown', 'html', 'htm', 'docx', 'pdf', 'djvu', 'djv', 'epub', 'fb2', 'mobi', 'azw', 'azw3', 'prc'] },
  media:   { label: 'Медиа',   in: ['mp3', 'wav', 'ogg', 'oga', 'opus', 'm4a', 'aac', 'flac', 'webm', 'mp4', 'mov', 'mkv'] },
  cad:     { label: 'CAD',     in: [...CAD_2D, ...CAD_SPEC, ...CAD_ACAD, ...CAD_3D] },
  archive: { label: 'Архив',   in: ARCHIVES },
};

const SAME = { jpeg: 'jpg', yml: 'yaml', htm: 'html', markdown: 'md', oga: 'ogg', djv: 'djvu', heif: 'heic', azw: 'mobi', azw3: 'mobi', prc: 'mobi' };
const canon = (e) => SAME[e] || e;

function targetsFor(cat, ext) {
  const not = (list) => list.filter((t) => t !== canon(ext));
  switch (cat) {
    case 'image': return not(['png', 'jpg', 'webp', 'pdf', 'bmp', 'ico']);
    case 'data':  return not(['xlsx', 'csv', 'tsv', 'json', 'yaml', 'xml', 'html', 'md']);
    case 'doc':
      if (ext === 'pdf') return ['docx', 'txt', 'md', 'html', 'epub', 'fb2', 'png', 'jpg'];
      if (canon(ext) === 'djvu') return ['pdf', 'png', 'jpg', 'docx', 'txt', 'md', 'html', 'epub', 'fb2'];
      return not(['pdf', 'docx', 'epub', 'fb2', 'html', 'md', 'txt']);
    case 'media': return not(['mp3', 'wav', ...(VIDEO_EXT.includes(ext) ? ['webm'] : [])]);
    case 'cad':
      if (CAD_2D.includes(ext)) return ['pdf', 'dwg', 'dxf', 'png', 'jpg'];
      if (CAD_SPEC.includes(ext)) return ['pdf'];
      if (ext === 'dwg') return ['pdf', 'dxf', 'cdw', 'png', 'jpg'];
      if (ext === 'dxf') return ['pdf', 'dwg', 'cdw', 'png', 'jpg'];
      if (CAD_3D.includes(ext)) return ['step', 'stl', 'igs', 'png', 'jpg', 'pdf'];
      return [];
    default: return [];
  }
}

const MIME = {
  png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', bmp: 'image/bmp', ico: 'image/x-icon',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv;charset=utf-8', tsv: 'text/tab-separated-values;charset=utf-8',
  json: 'application/json;charset=utf-8', yaml: 'text/yaml;charset=utf-8', xml: 'application/xml;charset=utf-8',
  html: 'text/html;charset=utf-8', md: 'text/markdown;charset=utf-8', txt: 'text/plain;charset=utf-8',
  pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  epub: 'application/epub+zip', fb2: 'application/x-fictionbook+xml', zip: 'application/zip',
  mp3: 'audio/mpeg', wav: 'audio/wav', webm: 'video/webm',
  dwg: 'image/vnd.dwg', dxf: 'image/vnd.dxf', cdw: 'application/octet-stream',
  step: 'model/step', stl: 'model/stl', igs: 'model/iges',
};

const extOf = (name) => (name.includes('.') ? name.split('.').pop().toLowerCase() : '');
const baseOf = (name) => (name.includes('.') ? name.slice(0, name.lastIndexOf('.')) : name);
// Чертежи КОМПАС/DWG и архивы RAR/7Z обрабатывает только сервер на компьютере владельца.
// Пока BullConvert открыт не на нём (публичный сайт, телефон, другой компьютер),
// эти форматы считаются неподдерживаемыми и нигде не упоминаются.
let pcFeatures = false;
const catOf = (ext) => {
  const c = Object.keys(CATEGORIES).find((k) => CATEGORIES[k].in.includes(ext)) || null;
  if (!pcFeatures && (c === 'cad' || (c === 'archive' && ext !== 'zip'))) return null;
  return c;
};

function formatSize(n) {
  if (n < 1024) return n + ' Б';
  if (n < 1024 ** 2) return (n / 1024).toFixed(1) + ' КБ';
  if (n < 1024 ** 3) return (n / 1024 ** 2).toFixed(1) + ' МБ';
  return (n / 1024 ** 3).toFixed(2) + ' ГБ';
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const escapeXml = (s) => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const tick = () => new Promise((r) => setTimeout(r, 0));

function bytesToBase64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Текст в любой кодировке: BOM, объявленная кодировка, UTF-8, иначе Windows-1251 (старые русские файлы). */
function decodeText(input) {
  const u8 = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (u8[0] === 0xEF && u8[1] === 0xBB && u8[2] === 0xBF) return new TextDecoder('utf-8').decode(u8.subarray(3));
  if (u8[0] === 0xFF && u8[1] === 0xFE) return new TextDecoder('utf-16le').decode(u8.subarray(2));
  if (u8[0] === 0xFE && u8[1] === 0xFF) return new TextDecoder('utf-16be').decode(u8.subarray(2));
  const head = new TextDecoder('windows-1252').decode(u8.subarray(0, 1024));
  const m = head.match(/encoding=["']([\w-]+)["']|<meta[^>]+charset=["']?([\w-]+)/i);
  if (m) {
    const enc = (m[1] || m[2]).toLowerCase();
    if (enc !== 'utf-8' && enc !== 'utf8') { try { return new TextDecoder(enc).decode(u8); } catch { /* неизвестная кодировка */ } }
  }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(u8); }
  catch { return new TextDecoder('windows-1251').decode(u8); }
}
const readText = async (file) => decodeText(new Uint8Array(await file.arrayBuffer()));

function getOptions() {
  const mw = parseInt(document.getElementById('maxWidth').value, 10);
  return {
    quality: parseInt(document.getElementById('quality').value, 10) / 100,
    maxWidth: mw > 0 ? mw : null,
    bitrate: parseInt(document.getElementById('bitrate').value, 10),
  };
}

/* ================== Определение формата по содержимому ================== */

async function sniffZip(file) {
  await loadLib('jszip');
  let zip;
  try { zip = await JSZip.loadAsync(file); } catch { return null; }
  const has = (n) => zip.file(n) !== null;
  if (has('FileInfo') && has('Contents')) {
    // файл КОМПАС-3D (v17+): внутри записан тип документа
    const t = new TextDecoder('utf-16be').decode(await zip.file('FileInfo').async('uint8array'));
    // FileType — код типа документа КОМПАС; FileTypeName бывает служебным (например, Kompas.tdem_slave)
    const byCode = { 1: 'cdw', 2: 'frw', 3: 'spw', 4: 'm3d', 5: 'a3d', 6: 'kdw', 7: 't3d' };
    const code = t.match(/^FileType=(\d+)/m);
    if (code && byCode[code[1]]) return byCode[code[1]];
    const m = t.match(/FileTypeName=Kompas\.(\w+)/i);
    return m && catOf(m[1].toLowerCase()) === 'cad' ? m[1].toLowerCase() : 'cdw';
  }
  if (has('word/document.xml')) return 'docx';
  if (has('xl/workbook.xml')) return 'xlsx';
  if (has('mimetype')) {
    const mt = (await zip.file('mimetype').async('string')).trim();
    if (mt === 'application/epub+zip') return 'epub';
    if (mt === 'application/vnd.oasis.opendocument.spreadsheet') return 'ods';
  }
  return 'zip';
}

async function sniff(file) {
  const h = new Uint8Array(await file.slice(0, 4096).arrayBuffer());
  const s = (o, n) => String.fromCharCode(...h.subarray(o, o + n));
  if (h[0] === 0x89 && s(1, 3) === 'PNG') return 'png';
  if (h[0] === 0xFF && h[1] === 0xD8 && h[2] === 0xFF) return 'jpg';
  if (s(0, 4) === 'GIF8') return 'gif';
  if (s(0, 4) === 'RIFF' && s(8, 4) === 'WEBP') return 'webp';
  if (s(0, 4) === 'RIFF' && s(8, 4) === 'WAVE') return 'wav';
  if (s(0, 4) === '%PDF') return 'pdf';
  if (s(0, 8) === 'AT&TFORM') return 'djvu';
  if (s(0, 4) === 'Rar!') return 'rar';
  if (h[0] === 0x37 && h[1] === 0x7A && h[2] === 0xBC && h[3] === 0xAF) return '7z';
  if (h[0] === 0x1F && h[1] === 0x8B) return 'gz';
  if (s(0, 3) === 'BZh') return 'bz2';
  if (s(257, 5) === 'ustar') return 'tar';
  if (s(0, 4) === 'AC10') return 'dwg';           // AutoCAD (в т.ч. его резервные копии .bak)
  if (s(60, 8) === 'BOOKMOBI') return 'mobi';
  if (s(0, 4) === 'OggS') return 'ogg';
  if (s(0, 4) === 'fLaC') return 'flac';
  if (s(0, 3) === 'ID3') return 'mp3';
  if (s(4, 4) === 'ftyp') {
    const brand = s(8, 4);
    if (/heic|heix|hevc|mif1|msf1/.test(brand)) return 'heic';
    if (/M4A/.test(brand)) return 'm4a';
    if (/qt/.test(brand)) return 'mov';
    return 'mp4';
  }
  if (h[0] === 0x1A && h[1] === 0x45 && h[2] === 0xDF && h[3] === 0xA3) return 'webm';
  if (s(0, 2) === 'BM') return 'bmp';
  if (s(0, 2) === 'PK') return sniffZip(file);
  const text = decodeText(h);
  if (/<FictionBook/i.test(text)) return 'fb2';
  if (/<svg[\s>]/i.test(text) && !/<html/i.test(text)) return 'svg';
  if (/<!doctype html|<html[\s>]/i.test(text)) return 'html';
  if (/^\s*<\?xml/.test(text)) return 'xml';
  if (/^\s*[[{]/.test(text)) { try { JSON.parse(await readText(file)); return 'json'; } catch { /* не JSON */ } }
  if (h[0] === 0xFF && (h[1] & 0xE0) === 0xE0) return 'mp3';
  if (!/[\u0000-\u0008\u000E-\u001A]/.test(text)) return 'txt';
  return null;
}

/* ========================== ИЗОБРАЖЕНИЯ ========================== */

async function imageSource(file, ext) {
  if (ext === 'heic' || ext === 'heif') {
    await loadLib('heic2any');
    let out;
    try { out = await heic2any({ blob: file, toType: 'image/png' }); }
    catch { throw new Error('Не удалось прочитать HEIC-фото.'); }
    return Array.isArray(out) ? out[0] : out;
  }
  return file;
}

// onload, а не img.decode(): decode() зависает, пока вкладка в фоне
function imageFromUrl(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Браузер не смог открыть это изображение.'));
    img.src = src;
  });
}

async function loadImage(blob) {
  const url = URL.createObjectURL(blob);
  try { return { img: await imageFromUrl(url), url }; }
  catch (e) { URL.revokeObjectURL(url); throw e; }
}

async function convertImage(file, ext, target, opts) {
  const { img, url } = await loadImage(await imageSource(file, ext));
  try {
    let w = img.naturalWidth || 1024;
    let h = img.naturalHeight || 1024;
    if (opts.maxWidth && w > opts.maxWidth) { h = Math.round(h * opts.maxWidth / w); w = opts.maxWidth; }

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    if (target === 'ico') {
      const size = Math.min(256, Math.max(w, h));
      const k = size / Math.max(w, h);
      canvas.width = canvas.height = size;
      const dw = Math.round(w * k), dh = Math.round(h * k);
      ctx.drawImage(img, (size - dw) / 2, (size - dh) / 2, dw, dh);
      return encodeICO(await canvasToBlob(canvas, 'image/png'), size);
    }

    canvas.width = w; canvas.height = h;
    if (target === 'jpg' || target === 'bmp' || target === 'pdf') {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, w, h);
    }
    ctx.drawImage(img, 0, 0, w, h);

    if (target === 'bmp') return encodeBMP(ctx, w, h);
    if (target === 'pdf') {
      const pdf = await createImagePdf();
      pdf.add(canvas, opts.quality);
      return pdf.blob();
    }
    return canvasToBlob(canvas, MIME[target], opts.quality);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => {
      if (!b) return reject(new Error('Не удалось создать изображение.'));
      if (b.type !== type) return reject(new Error(`Этот браузер не умеет сохранять ${type}.`));
      resolve(b);
    }, type, quality);
  });
}

function encodeBMP(ctx, w, h) {
  const px = ctx.getImageData(0, 0, w, h).data;
  const rowSize = Math.ceil((w * 3) / 4) * 4;
  const size = 54 + rowSize * h;
  const buf = new ArrayBuffer(size);
  const v = new DataView(buf);
  v.setUint8(0, 0x42); v.setUint8(1, 0x4d);
  v.setUint32(2, size, true);
  v.setUint32(10, 54, true);
  v.setUint32(14, 40, true);
  v.setInt32(18, w, true);
  v.setInt32(22, h, true);
  v.setUint16(26, 1, true);
  v.setUint16(28, 24, true);
  v.setUint32(34, rowSize * h, true);
  v.setInt32(38, 2835, true); v.setInt32(42, 2835, true);
  const out = new Uint8Array(buf);
  for (let y = 0; y < h; y++) {
    let o = 54 + (h - 1 - y) * rowSize;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      out[o++] = px[i + 2]; out[o++] = px[i + 1]; out[o++] = px[i];
    }
  }
  return new Blob([buf], { type: MIME.bmp });
}

async function encodeICO(pngBlob, size) {
  const png = new Uint8Array(await pngBlob.arrayBuffer());
  const buf = new ArrayBuffer(22 + png.length);
  const v = new DataView(buf);
  v.setUint16(0, 0, true); v.setUint16(2, 1, true); v.setUint16(4, 1, true);
  v.setUint8(6, size >= 256 ? 0 : size);
  v.setUint8(7, size >= 256 ? 0 : size);
  v.setUint16(10, 1, true);
  v.setUint16(12, 32, true);
  v.setUint32(14, png.length, true);
  v.setUint32(18, 22, true);
  new Uint8Array(buf).set(png, 22);
  return new Blob([buf], { type: MIME.ico });
}

/** PDF из картинок: каждая картинка — отдельная страница своего размера. */
async function createImagePdf() {
  await loadLib('jspdf');
  const { jsPDF } = window.jspdf;
  let pdf = null;
  return {
    add(canvas, quality = 0.9, pageWidthPt = null) {
      const k = pageWidthPt ? pageWidthPt / canvas.width : 0.75; // по умолчанию px → pt (96 dpi)
      const w = canvas.width * k, h = canvas.height * k;
      const orientation = w > h ? 'l' : 'p';
      if (!pdf) pdf = new jsPDF({ orientation, unit: 'pt', format: [w, h], compress: true });
      else pdf.addPage([w, h], orientation);
      pdf.addImage(canvas.toDataURL('image/jpeg', quality), 'JPEG', 0, 0, w, h, undefined, 'FAST');
    },
    blob() {
      if (!pdf) throw new Error('Нет страниц для PDF.');
      return pdf.output('blob');
    },
  };
}

async function toPngDataUrl(src) {
  const img = await imageFromUrl(src);
  const c = document.createElement('canvas');
  c.width = img.naturalWidth || 600; c.height = img.naturalHeight || 400;
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/png');
}

/* ============================ ДАННЫЕ ============================ */

function detectDelimiter(text) {
  const line = text.split(/\r?\n/, 1)[0] || '';
  const counts = { ',': 0, ';': 0, '\t': 0, '|': 0 };
  let inQ = false;
  for (const ch of line) {
    if (ch === '"') inQ = !inQ;
    else if (!inQ && ch in counts) counts[ch]++;
  }
  const [best, n] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return n > 0 ? best : ',';
}

function parseCSV(text, delim) {
  text = text.replace(/^﻿/, '');
  const rows = [];
  let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false;
      } else field += c;
    } else if (c === '"') inQ = true;
    else if (c === delim) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const data = rows.filter((r) => r.some((x) => x !== ''));
  if (!data.length) return [];
  const header = data[0].map((h, i) => h.trim() || `Колонка${i + 1}`);
  return data.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

function flatten(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[k] = v !== null && typeof v === 'object' ? JSON.stringify(v) : v;
  return out;
}

function toRows(raw) {
  if (Array.isArray(raw)) {
    return raw.map((x) => (x !== null && typeof x === 'object' && !Array.isArray(x) ? flatten(x) : { value: Array.isArray(x) ? JSON.stringify(x) : x }));
  }
  if (raw !== null && typeof raw === 'object') {
    const keys = Object.keys(raw);
    if (keys.length === 1 && Array.isArray(raw[keys[0]])) return toRows(raw[keys[0]]);
    return [flatten(raw)];
  }
  return [{ value: raw }];
}

function parseXML(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Некорректный XML.');
  const root = doc.documentElement;
  const kids = [...root.children];
  const rowFromEl = (el) => {
    const r = {};
    for (const a of el.attributes) r['@' + a.name] = a.value;
    for (const c of el.children) r[c.tagName] = c.textContent.trim();
    if (!el.children.length && !el.attributes.length) r.value = el.textContent.trim();
    return r;
  };
  if (kids.length && kids.every((k) => k.children.length || k.attributes.length)) return kids.map(rowFromEl);
  return [rowFromEl(root)];
}

/** Таблица(ы): { sheets: [{ name, rows }], raw } — у книг Excel листов может быть несколько. */
async function parseData(file, ext) {
  if (['xlsx', 'xls', 'ods'].includes(ext)) {
    await loadLib('xlsx');
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true, dateNF: 'dd.mm.yyyy' });
    const sheets = wb.SheetNames.map((name) => ({
      name,
      rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: '', raw: false, dateNF: 'dd.mm.yyyy' }),
    }));
    const filled = sheets.filter((s) => s.rows.length);
    const raw = filled.length > 1 ? Object.fromEntries(filled.map((s) => [s.name, s.rows])) : (filled[0] || sheets[0]).rows;
    return { sheets, raw };
  }
  const one = await parseFlatData(file, ext);
  return { sheets: [{ name: 'Лист1', rows: one.rows }], raw: one.raw };
}

async function parseFlatData(file, ext) {
  const text = await readText(file);
  if (ext === 'csv' || ext === 'tsv') {
    const rows = parseCSV(text, ext === 'tsv' ? '\t' : detectDelimiter(text));
    return { rows, raw: rows };
  }
  if (ext === 'json') {
    let raw;
    try { raw = JSON.parse(text.replace(/^﻿/, '')); } catch (e) { throw new Error('Некорректный JSON: ' + e.message); }
    return { raw, rows: toRows(raw) };
  }
  if (ext === 'yaml' || ext === 'yml') {
    await loadLib('yaml');
    const raw = jsyaml.load(text);
    return { raw, rows: toRows(raw) };
  }
  if (ext === 'xml') {
    const rows = parseXML(text);
    return { rows, raw: rows };
  }
  throw new Error('Неизвестный формат данных.');
}

function columnsOf(rows) {
  const cols = [];
  const seen = new Set();
  for (const r of rows) for (const k of Object.keys(r)) if (!seen.has(k)) { seen.add(k); cols.push(k); }
  return cols;
}

function toDelimited(rows, d) {
  const cols = columnsOf(rows);
  const cell = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /["\r\n]/.test(s) || s.includes(d) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [cols.map(cell).join(d), ...rows.map((r) => cols.map((c) => cell(r[c])).join(d))].join('\r\n');
}

function xmlTag(name) {
  let t = String(name).replace(/[^\p{L}\p{N}_.-]/gu, '_');
  if (!/^[\p{L}_]/u.test(t)) t = '_' + t;
  return t;
}

function xmlRows(rows, indent) {
  const cols = columnsOf(rows);
  return rows.map((r) =>
    `${indent}<row>\n` + cols.map((c) => `${indent}  <${xmlTag(c)}>${escapeXml(r[c] ?? '')}</${xmlTag(c)}>`).join('\n') + `\n${indent}</row>`
  ).join('\n');
}

function htmlTable(rows) {
  const cols = columnsOf(rows);
  return '<table>\n<thead><tr>' + cols.map((c) => `<th>${escapeHtml(c)}</th>`).join('') + '</tr></thead>\n<tbody>\n' +
    rows.map((r) => '<tr>' + cols.map((c) => `<td>${escapeHtml(r[c] ?? '')}</td>`).join('') + '</tr>').join('\n') +
    '\n</tbody>\n</table>';
}

function mdTable(rows) {
  const cols = columnsOf(rows);
  const esc = (v) => String(v ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
  return `| ${cols.map(esc).join(' | ')} |\n| ${cols.map(() => '---').join(' | ')} |\n` +
    rows.map((r) => `| ${cols.map((c) => esc(r[c])).join(' | ')} |`).join('\n') + '\n';
}

async function convertData(file, ext, target) {
  const { sheets, raw } = await parseData(file, ext);
  const filled = sheets.filter((s) => s.rows.length);
  const many = filled.length > 1;
  const list = filled.length ? filled : sheets.slice(0, 1);
  let text;
  switch (target) {
    case 'json': text = JSON.stringify(raw, null, 2); break;
    case 'yaml': await loadLib('yaml'); text = jsyaml.dump(raw, { lineWidth: -1 }); break;
    case 'csv': case 'tsv': {
      const make = (rows) => (target === 'csv' ? '﻿' + toDelimited(rows, ',') : toDelimited(rows, '\t'));
      if (!many) { text = make(list[0].rows); break; }
      // CSV не умеет листы — каждый лист отдельным файлом в ZIP
      await loadLib('jszip');
      const zip = new JSZip();
      for (const s of list) zip.file(`${s.name.replace(/[\\/:*?"<>|]/g, '_')}.${target}`, make(s.rows));
      return { blob: await zip.generateAsync({ type: 'blob' }), ext: 'zip', note: `${list.length} листа(ов) в ZIP` };
    }
    case 'xml':
      text = '<?xml version="1.0" encoding="UTF-8"?>\n' + (many
        ? '<workbook>\n' + list.map((s) => `  <sheet name="${escapeXml(s.name)}">\n${xmlRows(s.rows, '    ')}\n  </sheet>`).join('\n') + '\n</workbook>\n'
        : '<rows>\n' + xmlRows(list[0].rows, '  ') + '\n</rows>\n');
      break;
    case 'html':
      text = htmlPage(baseOf(file.name), list.map((s) => (many ? `<h2>${escapeHtml(s.name)}</h2>\n` : '') + htmlTable(s.rows)).join('\n'));
      break;
    case 'md':
      text = list.map((s) => (many ? `## ${s.name}\n\n` : '') + mdTable(s.rows)).join('\n');
      break;
    case 'xlsx': {
      await loadLib('xlsx');
      const wb = XLSX.utils.book_new();
      for (const s of sheets) {
        const name = s.name.replace(/[\\/?*[\]:]/g, '_').slice(0, 31) || 'Лист';
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(s.rows, { header: columnsOf(s.rows) }), name);
      }
      return new Blob([XLSX.write(wb, { type: 'array', bookType: 'xlsx' })], { type: MIME.xlsx });
    }
  }
  return new Blob([text], { type: MIME[target] });
}

/* ============================= OCR ============================= */

let ocrWorkerPromise = null;
let ocrLogger = null;
function getOcrWorker() {
  if (!ocrWorkerPromise) {
    ocrWorkerPromise = (async () => {
      await loadLib('tesseract');
      return Tesseract.createWorker(['rus', 'eng'], 1, { logger: (m) => ocrLogger && ocrLogger(m) });
    })().catch((e) => {
      ocrWorkerPromise = null;
      throw new Error('Не удалось запустить распознавание текста: ' + (e.message || e));
    });
  }
  return ocrWorkerPromise;
}

async function ocrCanvas(canvas, onStatus, onFraction) {
  if (!ocrWorkerPromise) onStatus('Загрузка модуля распознавания текста (один раз, ~20 МБ)…');
  const worker = await getOcrWorker();
  ocrLogger = (m) => { if (m.status === 'recognizing text') onFraction(m.progress); };
  try {
    const { data } = await worker.recognize(canvas);
    return data.text;
  } finally {
    ocrLogger = null;
  }
}

/* ======================= Страницы PDF и DjVu ======================= */

async function getPdfJs() {
  await loadLib('pdfjs');
  if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
    const code = await (await fetch(CDN.pdfjsWorker)).text();
    pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
  }
  return pdfjsLib;
}

async function renderPdfPage(page, targetWidth) {
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: Math.min(4, targetWidth / base.width) });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // intent 'print' — без requestAnimationFrame, иначе в фоновой вкладке отрисовка замирает
  await page.render({ canvasContext: ctx, viewport, intent: 'print' }).promise;
  return canvas;
}

/** Перебор страниц PDF: { index, total, canvas(), text } */
async function* pdfPages(file, width = 1700) {
  const pdfjs = await getPdfJs();
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    let text = '';
    for (const it of content.items) text += it.str + (it.hasEOL ? '\n' : '');
    yield { index: p, total: pdf.numPages, text, canvas: () => renderPdfPage(page, width) };
  }
}

function djvuPageText(page) {
  let text = '';
  try { text = page.getText() || ''; } catch { return ''; }
  text = text.replace(/\u0000/g, '');
  try {
    // собираем текст по строкам (зоны типа 5), а не по отдельным словам
    const lines = [];
    const walk = (z) => {
      if (z.type === 5) lines.push(text.substr(z.textStart, z.textLength).replace(/\s+/g, ' ').trim());
      else (z.children || []).forEach(walk);
    };
    const zone = page.getPageTextZone();
    if (zone) walk(zone);
    if (lines.length) return lines.filter(Boolean).join('\n');
  } catch { /* нет разметки зон — используем сырой текст */ }
  return text;
}

async function* djvuPages(file) {
  await loadLib('djvu');
  let doc;
  try { doc = new DjVu.Document(await file.arrayBuffer()); }
  catch { throw new Error('Не удалось открыть DjVu (файл повреждён или это не DjVu).'); }
  const total = doc.getPagesQuantity();
  for (let p = 1; p <= total; p++) {
    const page = await doc.getPage(p);
    const text = djvuPageText(page);
    const canvas = () => {
      const img = page.getImageData();
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      c.getContext('2d').putImageData(img, 0, 0);
      return c;
    };
    yield { index: p, total, text, canvas, release: () => { try { page.reset(); } catch { /* ignore */ } } };
  }
}

const pagesOf = (file, ext) => (ext === 'pdf' ? pdfPages(file) : djvuPages(file));

/** Страницы → картинки (одна страница — один файл, несколько — ZIP). */
async function pagesToImages(file, ext, target, opts, onProgress, onStatus) {
  const type = MIME[target];
  const files = [];
  for await (const pg of pagesOf(file, ext)) {
    onStatus(`Страница ${pg.index} из ${pg.total}…`);
    const c = await pg.canvas();
    if (target === 'jpg') { // JPG без прозрачности
      const ctx = c.getContext('2d');
      ctx.globalCompositeOperation = 'destination-over';
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, c.width, c.height);
    }
    files.push({ index: pg.index, total: pg.total, blob: await canvasToBlob(c, type, opts.quality) });
    c.width = c.height = 0;
    if (pg.release) pg.release();
    onProgress(pg.index / pg.total);
  }
  if (files.length === 1) return files[0].blob;
  await loadLib('jszip');
  const zip = new JSZip();
  const pad = String(files.length).length;
  const base = baseOf(file.name);
  for (const f of files) zip.file(`${base}_стр${String(f.index).padStart(pad, '0')}.${target}`, f.blob);
  return { blob: await zip.generateAsync({ type: 'blob' }), ext: 'zip', note: `${files.length} стр. в ZIP` };
}

/** DjVu → PDF: страницы как изображения (внешний вид сохраняется полностью). */
async function pagesToPdf(file, ext, opts, onProgress, onStatus) {
  const pdf = await createImagePdf();
  for await (const pg of pagesOf(file, ext)) {
    onStatus(`Страница ${pg.index} из ${pg.total}…`);
    let c = await pg.canvas();
    if (c.width > 1700) { // ~200 dpi для A4: чётко, но PDF не раздувается
      const k = 1700 / c.width;
      const s = document.createElement('canvas');
      s.width = 1700; s.height = Math.round(c.height * k);
      const sctx = s.getContext('2d');
      sctx.imageSmoothingQuality = 'high';
      sctx.drawImage(c, 0, 0, s.width, s.height);
      c.width = c.height = 0;
      c = s;
    }
    pdf.add(c, Math.min(opts.quality, 0.75), c.width / 1700 * 595); // ширина страницы ≈ A4
    c.width = c.height = 0;
    if (pg.release) pg.release();
    onProgress(pg.index / pg.total * 0.95);
    await tick();
  }
  return pdf.blob();
}

/** Текст всех страниц; страницы без текстового слоя (сканы) распознаются OCR. */
async function pagesToHtml(file, ext, onProgress, onStatus) {
  const pages = [];
  let ocrCount = 0;
  for await (const pg of pagesOf(file, ext)) {
    let text = pg.text;
    if (text.replace(/\s/g, '').length < 10) {
      ocrCount++;
      onStatus(`Распознавание текста: страница ${pg.index} из ${pg.total}…`);
      const c = await pg.canvas();
      text = await ocrCanvas(c, onStatus, (f) => onProgress(((pg.index - 1) + f) / pg.total * 0.9));
      c.width = c.height = 0;
    } else {
      onStatus(`Чтение: страница ${pg.index} из ${pg.total}…`);
    }
    if (pg.release) pg.release();
    pages.push(textToHtml(text));
    onProgress(pg.index / pg.total * 0.9);
  }
  if (!pages.join('').replace(/<[^>]+>/g, '').trim()) throw new Error('Текст не найден — даже распознавание ничего не нашло.');
  if (ocrCount) onStatus(`Распознано страниц: ${ocrCount} из ${pages.length}. Сохранение…`);
  return pages.join('\n<hr>\n');
}

/* =========================== ЭЛЕКТРОННЫЕ КНИГИ =========================== */

function resolvePath(base, rel) {
  rel = decodeURIComponent(rel.split('#')[0]);
  if (rel.startsWith('/')) return rel.slice(1);
  const parts = base ? base.split('/').filter(Boolean) : [];
  for (const seg of rel.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg && seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}
const dirOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const IMG_MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp' };

async function zipDataUrl(zip, path) {
  const f = zip.file(path);
  if (!f) return null;
  return `data:${IMG_MIME[extOf(path)] || 'application/octet-stream'};base64,${await f.async('base64')}`;
}

async function epubToHtml(file) {
  await loadLib('jszip');
  const zip = await JSZip.loadAsync(file);
  const cont = zip.file('META-INF/container.xml');
  if (!cont) throw new Error('Повреждённый EPUB: нет container.xml.');
  const xml = (s) => new DOMParser().parseFromString(s, 'application/xml');
  const opfPath = xml(await cont.async('string')).getElementsByTagName('rootfile')[0]?.getAttribute('full-path');
  if (!opfPath || !zip.file(opfPath)) throw new Error('Повреждённый EPUB: не найдено описание книги.');
  const opf = xml(await zip.file(opfPath).async('string'));
  if (opf.getElementsByTagName('encryption').length || zip.file('META-INF/encryption.xml')) {
    const enc = zip.file('META-INF/encryption.xml') && await zip.file('META-INF/encryption.xml').async('string');
    if (enc && /EncryptedData/.test(enc) && !/obfuscation/i.test(enc)) throw new Error('Книга защищена DRM — конвертировать нельзя.');
  }
  const base = dirOf(opfPath);
  const manifest = {};
  for (const it of opf.getElementsByTagName('item')) manifest[it.getAttribute('id')] = { href: it.getAttribute('href'), type: it.getAttribute('media-type') || '' };

  const parts = [];
  for (const ref of opf.getElementsByTagName('itemref')) {
    const it = manifest[ref.getAttribute('idref')];
    if (!it || !/html/.test(it.type)) continue;
    const path = resolvePath(base, it.href);
    const f = zip.file(path);
    if (!f) continue;
    const src = await f.async('string');
    let doc = new DOMParser().parseFromString(src, 'application/xhtml+xml');
    if (doc.getElementsByTagName('parsererror').length) doc = new DOMParser().parseFromString(src, 'text/html');
    const body = doc.getElementsByTagName('body')[0];
    if (!body) continue;
    const dir = dirOf(path);
    for (const img of [...body.getElementsByTagName('img')]) {
      const s = img.getAttribute('src');
      if (s && !s.startsWith('data:')) {
        const d = await zipDataUrl(zip, resolvePath(dir, s));
        if (d) img.setAttribute('src', d); else img.remove();
      }
    }
    for (const im of [...body.getElementsByTagName('image')]) { // <svg><image xlink:href>
      let href = '';
      for (const a of im.attributes) if (a.localName === 'href') href = a.value;
      const d = href && await zipDataUrl(zip, resolvePath(dir, href));
      const holder = im.closest('svg') || im;
      if (d) { const img = doc.createElementNS('http://www.w3.org/1999/xhtml', 'img'); img.setAttribute('src', d); holder.replaceWith(img); }
      else holder.remove();
    }
    for (const n of [...body.querySelectorAll('script, style, link')]) n.remove();
    parts.push(body.innerHTML);
  }
  if (!parts.length) throw new Error('В EPUB не найден текст.');
  return parts.join('\n<hr>\n');
}

function fb2ToHtml(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('Повреждённый FB2 (ошибка в XML).');
  const bin = {};
  for (const b of doc.getElementsByTagNameNS('*', 'binary')) {
    bin[b.getAttribute('id')] = `data:${b.getAttribute('content-type') || 'image/jpeg'};base64,${b.textContent.replace(/\s+/g, '')}`;
  }
  const hrefOf = (el) => { for (const a of el.attributes) if (a.localName === 'href') return a.value.replace(/^#/, ''); return ''; };
  const imgTag = (el) => (bin[hrefOf(el)] ? `<img src="${bin[hrefOf(el)]}">` : '');

  const inline = (node) => [...node.childNodes].map((n) => {
    if (n.nodeType === 3) return escapeHtml(n.textContent);
    if (n.nodeType !== 1) return '';
    const inner = () => inline(n);
    switch (n.localName) {
      case 'strong': return `<strong>${inner()}</strong>`;
      case 'emphasis': return `<em>${inner()}</em>`;
      case 'strikethrough': return `<s>${inner()}</s>`;
      case 'sup': return `<sup>${inner()}</sup>`;
      case 'sub': return `<sub>${inner()}</sub>`;
      case 'code': return `<code>${inner()}</code>`;
      case 'image': return imgTag(n);
      default: return inner();
    }
  }).join('');

  const block = (node, depth) => [...node.children].map((n) => {
    const h = (lv, s) => `<h${Math.min(lv, 6)}>${s}</h${Math.min(lv, 6)}>`;
    switch (n.localName) {
      case 'section': return block(n, depth + 1);
      case 'title': {
        const ps = [...n.children].filter((c) => c.localName === 'p').map(inline);
        return h(depth + 1, ps.length ? ps.join(' ') : inline(n));
      }
      case 'subtitle': return h(depth + 2, inline(n));
      case 'p': return `<p>${inline(n)}</p>`;
      case 'empty-line': return '<br>';
      case 'image': return `<p>${imgTag(n)}</p>`;
      case 'epigraph': case 'cite': case 'annotation': return `<blockquote>${block(n, depth)}</blockquote>`;
      case 'text-author': case 'date': return `<p><em>${inline(n)}</em></p>`;
      case 'poem': return `<div>${block(n, depth)}</div>`;
      case 'stanza': return `<p>${[...n.children].filter((v) => v.localName === 'v').map(inline).join('<br>')}</p>`;
      case 'v': return `<p>${inline(n)}</p>`;
      case 'table': return `<table>${[...n.children].map((tr) => `<tr>${[...tr.children].map((td) => {
        const t = td.localName === 'th' ? 'th' : 'td';
        return `<${t}>${inline(td)}</${t}>`;
      }).join('')}</tr>`).join('')}</table>`;
      default: return block(n, depth);
    }
  }).join('\n');

  const parts = [];
  const bookTitle = doc.getElementsByTagNameNS('*', 'book-title')[0];
  const bodies = [...doc.getElementsByTagNameNS('*', 'body')];
  if (!bodies.length) throw new Error('В FB2 нет текста книги.');
  bodies.forEach((b, i) => {
    const hasTitle = [...b.children].some((c) => c.localName === 'title');
    if (i === 0 && bookTitle && !hasTitle) parts.push(`<h1>${escapeHtml(bookTitle.textContent.trim())}</h1>`);
    parts.push(block(b, 0));
  });
  return parts.join('\n<hr>\n');
}

/* ---- MOBI / AZW / PRC (PalmDOC) ---- */

function mobiTrailingSize(data, flags) {
  let num = 0;
  const size = data.length;
  for (let f = flags >> 1; f; f >>= 1) {
    if (f & 1) {
      let pos = size - num, result = 0, bitpos = 0;
      while (pos > 0) {
        const v = data[pos - 1];
        result |= (v & 0x7F) << bitpos;
        bitpos += 7; pos--;
        if ((v & 0x80) || bitpos >= 28) break;
      }
      num += result;
    }
  }
  if (flags & 1) num += (data[size - num - 1] & 0x3) + 1;
  return Math.min(num, size);
}

function palmDecompress(src) {
  const out = new Uint8Array(src.length * 9);
  let o = 0, i = 0;
  while (i < src.length) {
    const c = src[i++];
    if (c === 0 || (c >= 0x09 && c <= 0x7F)) out[o++] = c;
    else if (c <= 0x08) { for (let k = 0; k < c && i < src.length; k++) out[o++] = src[i++]; }
    else if (c >= 0xC0) { out[o++] = 0x20; out[o++] = c ^ 0x80; }
    else {
      const v = (c << 8) | src[i++];
      const dist = (v >> 3) & 0x7FF, len = (v & 7) + 3;
      for (let k = 0; k < len; k++) { out[o] = out[o - dist]; o++; }
    }
  }
  return out.subarray(0, o);
}

function imageMimeOf(u8) {
  if (u8[0] === 0xFF && u8[1] === 0xD8) return 'image/jpeg';
  if (u8[0] === 0x89 && u8[1] === 0x50) return 'image/png';
  if (u8[0] === 0x47 && u8[1] === 0x49) return 'image/gif';
  if (u8[0] === 0x42 && u8[1] === 0x4D) return 'image/bmp';
  return null;
}

async function mobiToHtml(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  const dv = new DataView(buf.buffer);
  const type = String.fromCharCode(...buf.subarray(60, 68));
  if (type !== 'BOOKMOBI' && type !== 'TEXtREAd') throw new Error('Это не книга MOBI/PRC.');
  const n = dv.getUint16(76);
  const offs = [];
  for (let i = 0; i < n; i++) offs.push(dv.getUint32(78 + i * 8));
  offs.push(buf.length);
  const rec = (i) => (i >= 0 && i < n ? buf.subarray(offs[i], offs[i + 1]) : null);
  const r0 = rec(0);
  const d0 = new DataView(r0.buffer, r0.byteOffset, r0.byteLength);
  const compression = d0.getUint16(0);
  const textRecords = d0.getUint16(8);
  if (d0.getUint16(12)) throw new Error('Книга защищена DRM — конвертировать нельзя.');
  if (compression === 17480) throw new Error('Этот MOBI сжат методом HUFF/CDIC — такой вариант не поддерживается.');
  let encoding = 'windows-1252', extraFlags = 0, firstImage = -1;
  if (r0.length > 20 && String.fromCharCode(...r0.subarray(16, 20)) === 'MOBI') {
    const hlen = d0.getUint32(20);
    encoding = d0.getUint32(28) === 65001 ? 'utf-8' : 'windows-1252';
    if (hlen >= 0xE4 && r0.length >= 0xF4) extraFlags = d0.getUint16(0xF2);
    if (r0.length >= 0x70) firstImage = d0.getUint32(0x6C);
  }
  const chunks = [];
  let total = 0;
  for (let i = 1; i <= textRecords && i < n; i++) {
    let r = rec(i);
    r = r.subarray(0, r.length - mobiTrailingSize(r, extraFlags));
    const t = compression === 2 ? palmDecompress(r) : r;
    chunks.push(t); total += t.length;
  }
  const all = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { all.set(c, o); o += c.length; }
  let html = new TextDecoder(encoding).decode(all);
  if (firstImage > 0 && firstImage < n) {
    html = html.replace(/<img\b[^>]*?recindex=["']?(\d+)["']?[^>]*>/gi, (m, idx) => {
      const r = rec(firstImage + parseInt(idx, 10) - 1);
      const mime = r && imageMimeOf(r);
      return mime ? `<img src="data:${mime};base64,${bytesToBase64(r)}">` : '';
    });
  }
  html = html.replace(/<mbp:pagebreak\s*\/?>/gi, '<hr>').replace(/<\/?mbp:[^>]*>/gi, '');
  if (!/<(p|div|br|h\d)\b/i.test(html)) return textToHtml(html); // старые PRC — простой текст
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script, style').forEach((x) => x.remove());
  return doc.body.innerHTML;
}

/* =========================== ДОКУМЕНТЫ =========================== */

function htmlPage(title, body) {
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
body { max-width: 800px; margin: 40px auto; padding: 0 16px; font: 16px/1.6 system-ui, sans-serif; color: #222; }
table { border-collapse: collapse; } td, th { border: 1px solid #ccc; padding: 4px 8px; } th { background: #f3f3f3; }
img { max-width: 100%; } pre { background: #f5f5f5; padding: 10px; overflow: auto; }
</style>
</head>
<body>
${body}
</body>
</html>
`;
}

function textToHtml(text) {
  return text.replace(/\r\n?/g, '\n').split(/\n\s*\n/).filter((p) => p.trim())
    .map((p) => `<p>${escapeHtml(p.trim()).replace(/\n/g, '<br>')}</p>`).join('\n');
}

async function docToHtml(file, ext, onProgress, onStatus) {
  switch (canon(ext)) {
    case 'txt': return textToHtml(await readText(file));
    case 'md':
      await loadLib('marked');
      return marked.parse(await readText(file));
    case 'html': {
      const doc = new DOMParser().parseFromString(await readText(file), 'text/html');
      doc.querySelectorAll('script, style, link, meta, noscript').forEach((n) => n.remove());
      return doc.body.innerHTML;
    }
    case 'docx': {
      await loadLib('mammoth');
      return (await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() })).value;
    }
    case 'pdf': case 'djvu': return pagesToHtml(file, canon(ext), onProgress, onStatus);
    case 'epub': return epubToHtml(file);
    case 'fb2': return fb2ToHtml(await readText(file));
    case 'mobi': return mobiToHtml(file);
  }
  throw new Error('Неизвестный формат документа.');
}

function htmlToText(html) {
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;left:-99999px;top:0;width:800px;white-space:normal';
  el.innerHTML = html.replace(/<img\b[^>]*>/gi, '');
  document.body.appendChild(el);
  const text = el.innerText;
  el.remove();
  return text.replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

/* ---- HTML → PDF: настоящий текстовый PDF (pdfmake), запасной вариант — картинкой ---- */

async function htmlToPdf(html, title) {
  try {
    return await htmlToPdfText(html, title);
  } catch (e) {
    console.warn('pdfmake не справился, делаю PDF картинкой:', e);
    return htmlToPdfRaster(html);
  }
}

async function htmlToPdfText(html, title) {
  await loadLib('pdfmake');
  await loadLib('pdfmakeFonts');
  await loadLib('htmlToPdfmake');
  const root = document.createElement('div');
  root.innerHTML = html;
  root.querySelectorAll('script, style, link, meta, iframe, object, video, audio, svg, input, button').forEach((n) => n.remove());
  for (const img of [...root.querySelectorAll('img')]) {
    const s = img.getAttribute('src') || '';
    try {
      if (!/^data:image\/(png|jpe?g);base64,/i.test(s)) {
        if (!/^data:image\//i.test(s)) { img.remove(); continue; }
        img.setAttribute('src', await toPngDataUrl(s));
      }
      ['width', 'height', 'style'].forEach((a) => img.removeAttribute(a));
    } catch { img.remove(); }
  }
  const content = htmlToPdfmake(root.innerHTML, { window });
  const fit = (n) => {
    if (Array.isArray(n)) { n.forEach(fit); return; }
    if (!n || typeof n !== 'object') return;
    if (n.image) { delete n.width; delete n.height; n.fit = [515, 700]; }
    for (const v of Object.values(n)) if (v && typeof v === 'object') fit(v);
  };
  fit(content);
  const dd = {
    info: { title },
    pageSize: 'A4',
    pageMargins: [40, 40, 40, 40],
    content,
    defaultStyle: { font: 'Roboto', fontSize: 11, lineHeight: 1.25 },
  };
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('pdfmake timeout')), 120000);
    try {
      pdfMake.createPdf(dd).getBlob((b) => { clearTimeout(timer); resolve(b); });
    } catch (e) { clearTimeout(timer); reject(e); }
  });
}

async function htmlToPdfRaster(html) {
  await loadLib('html2pdf');
  const el = document.createElement('div');
  el.style.cssText = 'width:680px;padding:0;color:#111;background:#fff;font:14px/1.55 Arial, sans-serif';
  el.innerHTML = `<style>
    img{max-width:100%} table{border-collapse:collapse} td,th{border:1px solid #bbb;padding:3px 6px}
    h1,h2,h3{page-break-after:avoid} pre{white-space:pre-wrap;background:#f4f4f4;padding:8px}
    p,li,tr,img{page-break-inside:avoid}</style>` + html;
  return html2pdf().set({
    margin: [15, 15, 15, 15],
    image: { type: 'jpeg', quality: 0.95 },
    html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
    pagebreak: { mode: ['css', 'legacy'] },
  }).from(el).outputPdf('blob');
}

/* ---- HTML → блоки (для DOCX и FB2) ---- */

const BLOCK_CONTAINERS = new Set(['div', 'section', 'article', 'main', 'header', 'footer', 'nav', 'aside', 'ul', 'ol', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'body', 'figure', 'blockquote']);
const BLOCK_TAGS = new Set([...BLOCK_CONTAINERS, 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'pre', 'td', 'th', 'hr']);

function runsOf(node, fmt = { b: false, i: false, u: false }) {
  const runs = [];
  for (const n of node.childNodes) {
    if (n.nodeType === 3) {
      const t = n.textContent.replace(/\s+/g, ' ');
      if (t) runs.push({ text: t, ...fmt });
    } else if (n.nodeType === 1) {
      const tag = n.tagName.toLowerCase();
      if (tag === 'br') { runs.push({ br: true }); continue; }
      if (tag === 'img') { if (n.dataset.bc) runs.push({ img: n.dataset.bc }); continue; }
      const f = { ...fmt };
      if (tag === 'b' || tag === 'strong') f.b = true;
      if (tag === 'i' || tag === 'em') f.i = true;
      if (tag === 'u') f.u = true;
      runs.push(...runsOf(n, f));
      if (tag === 'li' || tag === 'p') runs.push({ br: true });
    }
  }
  return runs;
}

function collectBlocks(root) {
  const blocks = [];
  const walk = (node, listDepth) => {
    for (const n of node.childNodes) {
      if (n.nodeType === 3) {
        if (n.textContent.trim()) blocks.push({ runs: [{ text: n.textContent.trim() }] });
        continue;
      }
      if (n.nodeType !== 1) continue;
      const tag = n.tagName.toLowerCase();
      if (/^h[1-6]$/.test(tag)) blocks.push({ style: 'Heading' + Math.min(+tag[1], 3), runs: runsOf(n) });
      else if (tag === 'li') {
        const inline = document.createElement('div');
        for (const c of n.childNodes) if (!(c.nodeType === 1 && ['ul', 'ol'].includes(c.tagName.toLowerCase()))) inline.appendChild(c.cloneNode(true));
        const marker = n.parentElement && n.parentElement.tagName.toLowerCase() === 'ol'
          ? ([...n.parentElement.children].indexOf(n) + 1) + '. ' : '• ';
        blocks.push({ indent: listDepth, runs: [{ text: marker }, ...runsOf(inline)] });
        for (const c of n.children) if (['ul', 'ol'].includes(c.tagName.toLowerCase())) walk(c, listDepth + 1);
      } else if (tag === 'pre') {
        const lines = n.textContent.replace(/\n$/, '').split('\n');
        blocks.push({ mono: true, runs: lines.flatMap((l, i) => (i ? [{ br: true }, { text: l }] : [{ text: l }])) });
      } else if (tag === 'table') {
        const rows = [...n.rows].map((tr) => [...tr.cells].map((td) => ({ runs: runsOf(td), th: td.tagName === 'TH' })));
        if (rows.length) blocks.push({ table: rows });
      } else if (tag === 'img') {
        if (n.dataset.bc) blocks.push({ runs: [{ img: n.dataset.bc }] });
      } else if (tag === 'hr') blocks.push({ pageBreak: true });
      else if (tag === 'ul' || tag === 'ol') walk(n, listDepth + 1);
      else if (BLOCK_CONTAINERS.has(tag) && [...n.children].some((c) => BLOCK_TAGS.has(c.tagName.toLowerCase()))) walk(n, listDepth);
      else if (n.textContent.trim() || n.querySelector('img')) blocks.push({ runs: runsOf(n) });
    }
  };
  walk(root, -1);
  return blocks;
}

/* ---- HTML → DOCX ---- */

/**
 * Картинки в HTML → список для вложения в DOCX/FB2. Каждой <img> ставится data-bc=id.
 * Только PNG/JPEG (остальное перекодируется в PNG), с размерами в пикселях.
 */
async function prepareImages(root) {
  const images = {};
  let n = 0;
  for (const img of [...root.querySelectorAll('img')]) {
    let src = img.getAttribute('src') || '';
    try {
      if (!/^data:image\//i.test(src)) { img.remove(); continue; }
      if (!/^data:image\/(png|jpe?g);base64,/i.test(src)) src = await toPngDataUrl(src);
      const el = await imageFromUrl(src);
      const m = src.match(/^data:image\/(png|jpe?g);base64,(.*)$/i);
      const id = 'img' + (++n);
      images[id] = { id, ext: m[1].toLowerCase() === 'png' ? 'png' : 'jpeg', b64: m[2], w: el.naturalWidth || 300, h: el.naturalHeight || 200 };
      img.dataset.bc = id;
    } catch { img.remove(); }
  }
  return images;
}

function docxRun(r, b, ctx) {
  if (r.br) return '<w:r><w:br/></w:r>';
  if (r.img) {
    const im = ctx.images[r.img];
    if (!im) return '';
    const k = Math.min(1, 620 / im.w);               // не шире полосы набора (~16 см)
    const cx = Math.round(im.w * k * 9525), cy = Math.round(im.h * k * 9525);
    const n = Object.keys(ctx.images).indexOf(r.img) + 1;
    return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${n}" name="Рисунок ${n}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${n}" name="${im.id}.${im.ext}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId_${im.id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
  }
  const rpr = (r.b ? '<w:b/>' : '') + (r.i ? '<w:i/>' : '') + (r.u ? '<w:u w:val="single"/>' : '') +
    (b.mono ? '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/>' : '');
  return `<w:r>${rpr ? `<w:rPr>${rpr}</w:rPr>` : ''}<w:t xml:space="preserve">${escapeXml(r.text)}</w:t></w:r>`;
}

function docxTable(rows, ctx) {
  const cols = Math.max(...rows.map((r) => r.length));
  const border = (s) => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="808080"/>`;
  const cellXml = (c) => {
    // абзацы внутри ячейки разделены переводами строки
    const paras = [[]];
    for (const r of (c ? c.runs : [])) { if (r.br) paras.push([]); else paras[paras.length - 1].push(c.th && !r.img ? { ...r, b: true } : r); }
    const ps = paras.filter((p, i) => p.length || i === 0).map((p) => `<w:p>${p.map((r) => docxRun(r, {}, ctx)).join('')}</w:p>`).join('');
    return `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>${ps || '<w:p/>'}</w:tc>`;
  };
  return `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(border).join('')}</w:tblBorders><w:tblCellMar><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr>` +
    `<w:tblGrid>${'<w:gridCol/>'.repeat(cols)}</w:tblGrid>` +
    rows.map((r) => `<w:tr>${Array.from({ length: cols }, (_, i) => cellXml(r[i])).join('')}</w:tr>`).join('') +
    '</w:tbl><w:p/>';
}

function blockToXml(b, ctx) {
  if (b.pageBreak) return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
  if (b.table) return docxTable(b.table, ctx);
  const runs = [...b.runs];
  while (runs.length && runs[runs.length - 1].br) runs.pop();
  const ppr = [];
  if (b.style) ppr.push(`<w:pStyle w:val="${b.style}"/>`);
  if (b.indent >= 0) ppr.push(`<w:ind w:left="${360 * (b.indent + 1)}"/>`);
  return `<w:p>${ppr.length ? `<w:pPr>${ppr.join('')}</w:pPr>` : ''}${runs.map((r) => docxRun(r, b, ctx)).join('')}</w:p>`;
}

async function htmlToDocx(html) {
  await loadLib('jszip');
  const root = document.createElement('div');
  root.innerHTML = html;
  const images = await prepareImages(root);
  const ctx = { images };
  const body = collectBlocks(root).map((b) => blockToXml(b, ctx)).join('\n');
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"';
  const zip = new JSZip();
  for (const im of Object.values(images)) zip.file(`word/media/${im.id}.${im.ext}`, im.b64, { base64: true });
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="png" ContentType="image/png"/>
<Default Extension="jpeg" ContentType="image/jpeg"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);
  zip.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
${Object.values(images).map((im) => `<Relationship Id="rId_${im.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${im.id}.${im.ext}"/>`).join('\n')}
</Relationships>`);
  const heading = (n, sz) => `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="${n - 1}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${sz}"/></w:rPr></w:style>`;
  zip.file('word/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles ${W}>
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri" w:eastAsia="Calibri"/><w:sz w:val="22"/><w:lang w:val="ru-RU"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
${heading(1, 32)}${heading(2, 28)}${heading(3, 24)}
</w:styles>`);
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${W}><w:body>
${body || '<w:p/>'}
<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="850" w:bottom="1134" w:left="1701" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>
</w:body></w:document>`);
  return zip.generateAsync({ type: 'blob', mimeType: MIME.docx });
}

/* ---- HTML → EPUB ---- */

async function htmlToEpub(html, title) {
  await loadLib('jszip');
  const root = document.createElement('div');
  root.innerHTML = html;
  root.querySelectorAll('script, style, link, meta, iframe, object').forEach((n) => n.remove());

  const images = [];
  for (const img of [...root.querySelectorAll('img')]) {
    const m = (img.getAttribute('src') || '').match(/^data:(image\/[\w+.-]+);base64,(.*)$/);
    if (!m) { img.remove(); continue; }
    const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'image/webp': 'webp' }[m[1]] || 'img';
    const name = `images/img${images.length + 1}.${ext}`;
    images.push({ name, mime: m[1], data: m[2] });
    for (const a of [...img.attributes]) img.removeAttribute(a.name);
    img.setAttribute('src', '../' + name);
    img.setAttribute('alt', '');
  }

  // главы: новая глава на каждом H1/H2 и на разрыве страницы
  const chapters = [];
  let cur = null;
  const start = (t) => { cur = { title: t, nodes: [] }; chapters.push(cur); };
  for (const node of [...root.childNodes]) {
    if (node.nodeType === 1 && /^H[12]$/.test(node.tagName)) {
      if (!cur || cur.nodes.length) start(node.textContent.trim()); else cur.title = node.textContent.trim();
    } else if (node.nodeType === 1 && node.tagName === 'HR') {
      if (cur && cur.nodes.length) start(null);
      continue;
    }
    if (!cur) start(null);
    cur.nodes.push(node);
  }
  if (!chapters.length) start(title);
  chapters.forEach((c, i) => { c.title = c.title || (i === 0 ? title : `Часть ${i + 1}`); });

  const ser = new XMLSerializer();
  const xhtml = (t, body) => `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="ru" lang="ru">
<head><meta charset="utf-8"/><title>${escapeXml(t)}</title><link rel="stylesheet" type="text/css" href="../style.css"/></head>
<body>
${body}
</body>
</html>`;
  const uid = (crypto.randomUUID && crypto.randomUUID()) || String(Date.now());

  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`);
  zip.file('OEBPS/style.css', 'body{font-family:serif;line-height:1.5;margin:0 4%}img{max-width:100%}h1,h2,h3{line-height:1.2}table{border-collapse:collapse}td,th{border:1px solid #999;padding:2px 6px}');
  chapters.forEach((c, i) => {
    const body = c.nodes.map((n) => (n.nodeType === 3 ? escapeXml(n.textContent) : n.nodeType === 1 ? ser.serializeToString(n) : '')).join('\n');
    zip.file(`OEBPS/text/ch${i + 1}.xhtml`, xhtml(c.title, body));
  });
  for (const im of images) zip.file('OEBPS/' + im.name, im.data, { base64: true });

  const navItems = chapters.map((c, i) => `<li><a href="text/ch${i + 1}.xhtml">${escapeXml(c.title)}</a></li>`).join('\n');
  zip.file('OEBPS/nav.xhtml', `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="ru" lang="ru">
<head><meta charset="utf-8"/><title>Оглавление</title></head>
<body><nav epub:type="toc" id="toc"><h1>Оглавление</h1><ol>
${navItems}
</ol></nav></body></html>`);
  zip.file('OEBPS/toc.ncx', `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
<head><meta name="dtb:uid" content="urn:uuid:${uid}"/></head>
<docTitle><text>${escapeXml(title)}</text></docTitle>
<navMap>
${chapters.map((c, i) => `<navPoint id="np${i + 1}" playOrder="${i + 1}"><navLabel><text>${escapeXml(c.title)}</text></navLabel><content src="text/ch${i + 1}.xhtml"/></navPoint>`).join('\n')}
</navMap>
</ncx>`);
  const modified = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  zip.file('OEBPS/content.opf', `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" xml:lang="ru">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="uid">urn:uuid:${uid}</dc:identifier>
<dc:title>${escapeXml(title)}</dc:title>
<dc:language>ru</dc:language>
<meta property="dcterms:modified">${modified}</meta>
</metadata>
<manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
<item id="css" href="style.css" media-type="text/css"/>
${chapters.map((c, i) => `<item id="ch${i + 1}" href="text/ch${i + 1}.xhtml" media-type="application/xhtml+xml"/>`).join('\n')}
${images.map((im, i) => `<item id="img${i + 1}" href="${im.name}" media-type="${im.mime}"/>`).join('\n')}
</manifest>
<spine toc="ncx">
${chapters.map((c, i) => `<itemref idref="ch${i + 1}"/>`).join('\n')}
</spine>
</package>`);
  return zip.generateAsync({ type: 'blob', mimeType: MIME.epub });
}

/* ---- HTML → FB2 ---- */

async function htmlToFb2(html, title) {
  const root = document.createElement('div');
  root.innerHTML = html;
  const images = await prepareImages(root);
  const blocks = collectBlocks(root);
  // строки: '<p>…</p>' или '<image l:href="#id"/>' (картинка в FB2 — отдельный блок)
  const paras = (runs) => {
    const out = [];
    let cur = '';
    const flush = () => { if (cur.trim()) out.push(`<p>${cur.trim()}</p>`); cur = ''; };
    for (const r of runs) {
      if (r.br) { flush(); continue; }
      if (r.img) { flush(); if (images[r.img]) out.push(`<image l:href="#${r.img}"/>`); continue; }
      let t = escapeXml(r.text);
      if (r.b) t = `<strong>${t}</strong>`;
      if (r.i) t = `<emphasis>${t}</emphasis>`;
      cur += t;
    }
    flush();
    return out;
  };
  const inline = (runs) => paras(runs).filter((p) => p.startsWith('<p>')).map((p) => p.slice(3, -4)).join(' ');
  const sections = [];
  let sec = null;
  const open = (t) => { sec = { title: t, body: [] }; sections.push(sec); };
  for (const b of blocks) {
    if (b.pageBreak) continue;
    if (b.style === 'Heading1' || b.style === 'Heading2') { open(`<p>${inline(b.runs)}</p>`); continue; }
    if (!sec) open(null);
    if (b.table) {
      sec.body.push('<table>' + b.table.map((row) => '<tr>' + row.map((c) => {
        const t = c.th ? 'th' : 'td';
        return `<${t}>${inline(c.runs)}</${t}>`;
      }).join('') + '</tr>').join('') + '</table>');
    } else if (b.style === 'Heading3') sec.body.push(`<subtitle>${inline(b.runs)}</subtitle>`);
    else sec.body.push(...paras(b.runs));
  }
  if (!sections.length) open(null);
  const date = new Date().toISOString().slice(0, 10);
  const uid = (crypto.randomUUID && crypto.randomUUID()) || String(Date.now());
  // в FB2 секция должна начинаться с текста, а не с картинки/таблицы — тогда добавляем пустую строку
  const xml = sections.map((s) => `<section>${s.title ? `<title>${s.title}</title>` : ''}\n${s.body.join('\n') || '<empty-line/>'}\n</section>`).join('\n');
  const binaries = Object.values(images).map((im) => `<binary id="${im.id}" content-type="image/${im.ext}">${im.b64}</binary>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
<description>
<title-info><genre>prose</genre><author><first-name></first-name><last-name></last-name></author><book-title>${escapeXml(title)}</book-title><lang>ru</lang></title-info>
<document-info><author><nickname>BullConvert</nickname></author><program-used>BullConvert</program-used><date value="${date}">${date}</date><id>${uid}</id><version>1.0</version></document-info>
</description>
<body>
<title><p>${escapeXml(title)}</p></title>
${xml}
</body>
${binaries}
</FictionBook>
`;
}

async function convertDoc(file, ext, target, opts, onProgress, onStatus, htmlOverride) {
  const c = canon(ext);
  const title = baseOf(file.name);
  if ((c === 'pdf' || c === 'djvu') && (target === 'png' || target === 'jpg')) return pagesToImages(file, c, target, opts, onProgress, onStatus);
  if (c === 'djvu' && target === 'pdf' && !htmlOverride) return pagesToPdf(file, c, opts, onProgress, onStatus);

  // htmlOverride — текст, отредактированный пользователем в конвертере
  const html = htmlOverride ?? await docToHtml(file, ext, onProgress, onStatus);
  switch (target) {
    case 'html': return new Blob([htmlPage(title, html)], { type: MIME.html });
    case 'txt': return new Blob([htmlToText(html)], { type: MIME.txt });
    case 'md': {
      await loadLib('turndown');
      const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' });
      // встроенные (data:) картинки сделали бы .md огромным — пропускаем, ссылки на файлы оставляем
      td.addRule('dataImages', {
        filter: (n) => n.nodeName === 'IMG' && /^data:/i.test(n.getAttribute('src') || ''),
        replacement: () => '',
      });
      // таблицы → таблицы Markdown (первая строка — заголовок)
      td.addRule('tables', {
        filter: 'table',
        replacement: (content, node) => {
          const rows = [...node.rows].map((tr) => [...tr.cells].map((c) =>
            c.textContent.replace(/\s+/g, ' ').trim().replace(/\|/g, '\\|')));
          if (!rows.length) return '';
          const cols = Math.max(...rows.map((r) => r.length));
          const line = (r) => `| ${Array.from({ length: cols }, (_, i) => r[i] || '').join(' | ')} |`;
          return '\n\n' + [line(rows[0]), `| ${Array(cols).fill('---').join(' | ')} |`, ...rows.slice(1).map(line)].join('\n') + '\n\n';
        },
      });
      return new Blob([td.turndown(html)], { type: MIME.md });
    }
    case 'pdf': onStatus('Создание PDF…'); return htmlToPdf(html, title);
    case 'docx': return htmlToDocx(html);
    case 'epub': return htmlToEpub(html, title);
    case 'fb2': return new Blob([await htmlToFb2(html, title)], { type: MIME.fb2 });
  }
  throw new Error('Неизвестный целевой формат.');
}

/* ========================= АУДИО И ВИДЕО ========================= */

async function decodeAudio(file) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();
  try {
    return await ctx.decodeAudioData(await file.arrayBuffer());
  } catch {
    throw new Error('Браузер не смог прочитать звук из этого файла (кодек не поддерживается или нет звуковой дорожки).');
  } finally {
    ctx.close();
  }
}

function floatTo16(f32) {
  const out = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) {
    const s = Math.max(-1, Math.min(1, f32[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

function encodeWAV(buf) {
  const ch = buf.numberOfChannels, rate = buf.sampleRate, len = buf.length;
  const dataSize = len * ch * 2;
  const ab = new ArrayBuffer(44 + dataSize);
  const v = new DataView(ab);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + dataSize, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, dataSize, true);
  const chans = Array.from({ length: ch }, (_, c) => buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < ch; c++) {
      const s = Math.max(-1, Math.min(1, chans[c][i]));
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      o += 2;
    }
  }
  return new Blob([ab], { type: MIME.wav });
}

async function encodeMP3(buf, kbps, onProgress) {
  await loadLib('lame');
  const ch = Math.min(2, buf.numberOfChannels);
  const enc = new lamejs.Mp3Encoder(ch, buf.sampleRate, kbps);
  const L = floatTo16(buf.getChannelData(0));
  const R = ch > 1 ? floatTo16(buf.getChannelData(1)) : null;
  const block = 1152 * 16;
  const parts = [];
  for (let i = 0, n = 0; i < L.length; i += block, n++) {
    const out = ch > 1 ? enc.encodeBuffer(L.subarray(i, i + block), R.subarray(i, i + block)) : enc.encodeBuffer(L.subarray(i, i + block));
    if (out.length) parts.push(new Uint8Array(out));
    if (n % 20 === 0) { onProgress(i / L.length); await tick(); }
  }
  const end = enc.flush();
  if (end.length) parts.push(new Uint8Array(end));
  return new Blob(parts, { type: MIME.mp3 });
}

async function videoToWebm(file, onProgress) {
  if (!window.MediaRecorder) throw new Error('Этот браузер не поддерживает запись видео.');
  const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m));
  if (!mime) throw new Error('Этот браузер не умеет кодировать WEBM.');

  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.src = url;
  video.playsInline = true;
  let actx;
  try {
    await new Promise((res, rej) => {
      video.onloadedmetadata = res;
      video.onerror = () => rej(new Error('Браузер не может воспроизвести это видео (кодек не поддерживается).'));
    });
    actx = new (window.AudioContext || window.webkitAudioContext)();
    const dest = actx.createMediaStreamDestination();
    actx.createMediaElementSource(video).connect(dest);
    const cap = video.captureStream ? video.captureStream() : video.mozCaptureStream();

    await video.play();
    video.pause();
    video.currentTime = 0;
    await new Promise((r) => { video.onseeked = r; });

    const stream = new MediaStream([...cap.getVideoTracks(), ...dest.stream.getAudioTracks()]);
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4_000_000 });
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const done = new Promise((r) => { rec.onstop = r; });

    video.ontimeupdate = () => isFinite(video.duration) && onProgress(video.currentTime / video.duration);
    video.onended = () => rec.state !== 'inactive' && rec.stop();
    rec.start(1000);
    await video.play();
    await done;
    return new Blob(chunks, { type: MIME.webm });
  } finally {
    video.pause();
    URL.revokeObjectURL(url);
    if (actx) actx.close();
  }
}

async function convertMedia(file, ext, target, opts, onProgress) {
  if (target === 'webm') return videoToWebm(file, onProgress);
  const buf = await decodeAudio(file);
  onProgress(0.1);
  if (target === 'wav') return encodeWAV(buf);
  return encodeMP3(buf, opts.bitrate, (p) => onProgress(0.1 + p * 0.9));
}

/* ================== КОМПАС-3D / DWG / DXF (через сервер) ================== */

const SERVER_ERRORS = {
  KOMPAS_NOT_INSTALLED: 'На этом компьютере не установлен КОМПАС-3D — без него файлы КОМПАС конвертировать нельзя.',
  KOMPAS_START_TIMEOUT: 'КОМПАС-3D не запустился за 3 минуты. Попробуйте ещё раз.',
  IMPORT_FAILED: 'КОМПАС не смог прочитать этот DWG/DXF.',
  OPEN_FAILED: 'КОМПАС не смог открыть файл (повреждён или из более новой версии КОМПАС).',
  EXPORT_FAILED: 'КОМПАС не смог сохранить файл в выбранный формат.',
  UNSUPPORTED: 'Для этого типа документа КОМПАС такое преобразование не поддерживает.',
  ARCHIVE_FAILED: 'Не удалось распаковать архив (повреждён или формат не поддерживается).',
  ARCHIVE_ENCRYPTED: 'Архив защищён паролем — распаковать нельзя.',
  BAD_PARAMS: 'Неверный запрос к серверу.',
};

function serverError(text) {
  const code = (text || '').split(':')[0].trim();
  return SERVER_ERRORS[code] || (text ? 'Ошибка: ' + text : 'Неизвестная ошибка сервера.');
}

/* ---- Автоподключение: страница, открытая как файл, ищет сервер и переходит на него ---- */

const SERVER_URLS = ['http://bullconvert.localhost/', 'http://bullconvert.localhost:8765/'];

async function serverAlive(base) {
  // no-cors: ответ не прочитать, но если сервер не запущен — запрос упадёт с ошибкой
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 1500);
  try { await fetch(base + 'api/status?' + Date.now(), { mode: 'no-cors', cache: 'no-store', signal: ctrl.signal }); return true; }
  catch { return false; }
  finally { clearTimeout(t); }
}

async function findServer() {
  for (const u of SERVER_URLS) if (await serverAlive(u)) return u;
  return null;
}

async function autoConnect() {
  if (location.protocol !== 'file:') return;
  const banner = document.createElement('div');
  banner.className = 'banner';
  banner.innerHTML = '<div class="banner-text">Подключение к BullConvert…</div>';
  document.querySelector('.top').after(banner);
  const text = banner.querySelector('.banner-text');

  let url = await findServer();
  if (url) { location.replace(url); return; }

  text.innerHTML = '<b>Сервер BullConvert не запущен.</b> Фото, документы и таблицы работают и так, а для некоторых форматов он нужен.';
  const btn = document.createElement('button');
  btn.className = 'btn primary';
  btn.textContent = 'Запустить BullConvert';
  banner.appendChild(btn);
  btn.onclick = async () => {
    btn.disabled = true;
    text.textContent = 'Запускаю… Если браузер спросит «Открыть BullConvert?» — нажмите «Открыть».';
    location.href = 'bullconvert://start'; // обработчик ставит «Установить ярлык и автозапуск.bat»
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      url = await findServer();
      if (url) { location.replace(url); return; }
    }
    btn.disabled = false;
    text.innerHTML = 'Не получилось запустить автоматически. Откройте ярлык <b>BullConvert</b> на рабочем столе (или start.bat в папке конвертера).';
  };
}

async function serverPost(path, file) {
  if (location.protocol === 'file:') throw new Error('Нужен сервер BullConvert: нажмите «Запустить BullConvert» вверху страницы или откройте ярлык BullConvert на рабочем столе.');
  let r;
  try { r = await fetch(path, { method: 'POST', body: file, headers: { 'Content-Type': 'application/octet-stream' } }); }
  catch { throw new Error('Нет связи с сервером BullConvert. Откройте ярлык BullConvert на рабочем столе и повторите.'); }
  if (r.status === 404 || r.status === 405) {
    throw new Error('Этот формат здесь не поддерживается.');
  }
  if (r.status === 401) throw new Error('Нужно разрешение администратора — обновите страницу и запросите доступ.');
  if (!r.ok) throw new Error(serverError(await r.text()));
  return { data: await r.arrayBuffer(), headers: r.headers };
}

/**
 * Сборки (A3D) и чертежи ссылаются на файлы деталей. Поэтому вместе с основным файлом
 * отправляем все CAD-файлы из той же папки/архива — КОМПАС найдёт их рядом.
 */
async function convertCad(item, onStatus) {
  const { file, ext, target } = item;
  // детали часто лежат в подпапках (STANDART PARTS\, OTHER\…) или уровнем выше —
  // берём все CAD-файлы из той же корневой папки/архива, сохраняя относительные пути
  const rootOf = (p) => (p || '').split('/')[0];
  const root = rootOf(item.path);
  const rel = (i) => {
    const parts = (i.path || '').split('/').slice(1);
    parts.push(`${i.outBase}.${i.ext}`);
    return parts.join('/');
  };
  const mainName = rel(item);
  const companions = items.filter((i) => i !== item && i.cat === 'cad' && rootOf(i.path) === root && [...CAD_2D, ...CAD_3D].includes(i.ext));
  let body = file;
  let query = `from=${encodeURIComponent(ext)}&to=${encodeURIComponent(target)}`;
  if (companions.length && (CAD_3D.includes(ext) || CAD_2D.includes(ext))) {
    onStatus(`Подготовка: файл + ${companions.length} связанных…`);
    await loadLib('jszip');
    const zip = new JSZip();
    for (const c of companions) zip.file(rel(c), c.file);
    zip.file(mainName, file);
    body = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
    query += `&bundle=1&main=${encodeURIComponent(mainName)}`;
  }
  onStatus('Конвертация через КОМПАС-3D… (первый запуск КОМПАС занимает до минуты)');
  const { data, headers } = await serverPost(`/api/cad?${query}`, body);
  const missing = parseInt(headers.get('X-BC-Missing') || '0', 10);
  const blob = new Blob([data], { type: MIME[target] || 'application/octet-stream' });
  if (missing > 0) {
    return { blob, ext: target, warn: `⚠ не найдено деталей сборки: ${missing}. Добавьте папку или архив со сборкой целиком` };
  }
  return blob;
}

/* ============================ АРХИВЫ ============================ */

/** Распаковка: ZIP — в браузере, остальное — встроенным tar Windows через сервер. Возвращает [{file, path}]. */
async function extractArchive(file, ext) {
  await loadLib('jszip');
  let zip;
  // имена в старых ZIP из Windows записаны в DOS-кодировке (CP866), в новых — в UTF-8
  const decodeFileName = (bytes) => {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { return new TextDecoder('ibm866').decode(bytes); }
  };
  const data = ext === 'zip' ? file : (await serverPost(`/api/extract?from=${encodeURIComponent(ext)}`, file)).data;
  zip = await JSZip.loadAsync(data, { decodeFileName });
  const out = [];
  for (const entry of Object.values(zip.files)) {
    const entryName = entry.name.replace(/\\/g, '/');
    if (entry.dir || /(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db)/.test(entryName)) continue;
    const blob = await entry.async('blob');
    const name = entryName.split('/').pop();
    out.push({ file: new File([blob], name, { lastModified: entry.date ? entry.date.getTime() : Date.now() }), path: dirOf(entryName) });
  }
  return out;
}

/* ============================== UI ============================== */

const items = [];
let uid = 0;
const $ = (id) => document.getElementById(id);
const list = $('list');

/** entries: File[] или [{file, path}] */
async function addFiles(entries, parentPath = '', depth = 0) {
  for (const e of entries) {
    const file = e instanceof File ? e : e.file;
    let path = e instanceof File ? (e.webkitRelativePath ? dirOf(e.webkitRelativePath) : '') : (e.path || '');
    if (parentPath) path = path ? `${parentPath}/${path}` : parentPath;

    const item = { id: ++uid, file, path, depth, status: 'idle', result: null };
    items.push(item);
    list.appendChild(buildRow(item));
    await identify(item);
    rebuildTargets(item);
    refreshRow(item);
    if (item.cat === 'archive') unpack(item);
  }
  updateToolbar();
}

/** Определение формата: по расширению, а для .bak, файлов без расширения и неизвестных — по содержимому. */
async function identify(item) {
  const name = item.file.name;
  let ext = extOf(name);
  item.outBase = baseOf(name);
  item.detected = false;
  if (ext === 'bak') {
    const inner = extOf(baseOf(name)); // «Чертёж.cdw.bak»
    if (catOf(inner)) { ext = inner; item.outBase = baseOf(baseOf(name)); item.detected = true; }
  }
  if (!catOf(ext)) {
    const sniffed = await sniff(item.file).catch(() => null);
    if (sniffed && catOf(sniffed)) {
      if (extOf(name) === 'bak' && extOf(item.outBase) === sniffed) item.outBase = baseOf(item.outBase);
      ext = sniffed; item.detected = true;
    }
  }
  item.ext = ext;
  item.cat = catOf(ext);
  item.targets = item.cat ? targetsFor(item.cat, ext) : [];
  item.target = item.targets[0] || null;
}

async function unpack(item) {
  if (item.depth >= 3) { item.status = 'error'; item.error = 'Слишком глубокая вложенность архивов.'; refreshRow(item); return; }
  item.status = 'work';
  item.workText = 'Распаковка…';
  refreshRow(item);
  setProgress(item, null);
  try {
    const entries = await extractArchive(item.file, canon(item.ext));
    if (!entries.length) throw new Error('Архив пуст.');
    removeItem(item, true);
    const base = item.path ? `${item.path}/${item.outBase}` : item.outBase;
    await addFiles(entries, base, item.depth + 1);
  } catch (e) {
    console.error(e);
    item.status = 'error';
    item.error = e.message || String(e);
    refreshRow(item);
  }
  updateToolbar();
}

function buildRow(item) {
  const li = document.createElement('li');
  li.className = 'row';

  const badge = document.createElement('span');
  badge.className = 'badge';

  const info = document.createElement('div');
  info.className = 'info';
  const name = document.createElement('div');
  name.className = 'name';
  const shown = item.path ? `${item.path}/${item.file.name}` : item.file.name;
  name.textContent = shown;
  name.title = shown;
  const meta = document.createElement('div');
  meta.className = 'meta';
  const progress = document.createElement('div');
  progress.className = 'progress';
  progress.hidden = true;
  progress.appendChild(document.createElement('i'));
  const links = document.createElement('div');
  links.className = 'row-links';
  links.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b || item.status === 'work') return;
    if (b.dataset.l === 'doc') openDocEditor(item);
    else openTools(b.dataset.l, item.file);
  };
  info.append(name, meta, links, progress);

  const arrow = document.createElement('span');
  arrow.className = 'arrow';
  arrow.textContent = '→';

  const target = document.createElement('select');
  target.className = 'target';
  target.onchange = () => { item.target = target.value; item.status = 'idle'; item.result = null; refreshRow(item); updateToolbar(); };

  const action = document.createElement('button');
  action.className = 'btn action';
  action.onclick = () => (item.result ? download(item.result) : convertItem(item));

  const remove = document.createElement('button');
  remove.className = 'remove';
  remove.title = 'Убрать';
  remove.textContent = '×';
  remove.onclick = () => { if (item.status !== 'work') { removeItem(item); updateToolbar(); } };

  li.append(badge, info, arrow, target, action, remove);
  item.el = { li, badge, meta, links, progress, bar: progress.firstChild, action, target, remove };
  refreshRow(item);
  return li;
}

function rebuildTargets(item) {
  const sel = item.el.target;
  sel.innerHTML = '';
  if (item.targets.length) for (const t of item.targets) sel.add(new Option(t.toUpperCase(), t));
  else sel.add(new Option('—', ''));
  if (item.target) sel.value = item.target;
}

function removeItem(item, keepDom = false) {
  const i = items.indexOf(item);
  if (i >= 0) items.splice(i, 1);
  item.el.li.remove();
}

function refreshRow(item) {
  const { badge, meta, progress, action, target } = item.el;
  badge.className = 'badge ' + (item.cat || '');
  badge.textContent = item.ext || '?';
  meta.className = 'meta';
  progress.hidden = item.status !== 'work';
  target.disabled = item.status === 'work' || !item.targets || !item.targets.length;
  target.hidden = item.cat === 'archive';
  item.el.li.querySelector('.arrow').hidden = item.cat === 'archive';
  action.disabled = false;
  action.className = 'btn action';
  const size = formatSize(item.file.size);
  const kind = item.cat ? CATEGORIES[item.cat].label : '';
  const detected = (item.detected ? ` · определён как ${item.ext.toUpperCase()}` : '') + (item.editedHtml != null ? ' · ✏ изменён' : '');

  // быстрые действия: редактирование документа и инструменты PDF
  const L = [];
  if (item.cat === 'doc' && item.ext) L.push(['doc', '✏ Редактировать текст']);
  if (item.ext === 'pdf') L.push(['pages', '🛠 Страницы'], ['edit', '✍ Вставить текст/подпись'], ['redact', '⬛ Скрыть данные']);
  const sig = L.map((x) => x[0]).join();
  if (item.el.links.dataset.sig !== sig) {
    item.el.links.dataset.sig = sig;
    item.el.links.innerHTML = L.map(([k, t]) => `<button class="link-btn" data-l="${k}">${t}</button>`).join('');
  }

  if (item.ext === undefined) {
    meta.textContent = `${size} · определение формата…`;
    action.textContent = '…';
    action.disabled = true;
  } else if (item.status === 'work') {
    meta.textContent = item.workText || 'Конвертация…';
    action.textContent = '…';
    action.disabled = true;
  } else if (item.status === 'error') {
    meta.textContent = 'Ошибка: ' + item.error;
    meta.classList.add('err');
    action.textContent = 'Ещё раз';
    action.disabled = item.cat === 'archive' ? false : !item.cat;
    if (item.cat === 'archive') action.onclick = () => unpack(item);
  } else if (!item.cat) {
    meta.textContent = `${size} · формат не поддерживается`;
    meta.classList.add('err');
    action.textContent = 'Нет';
    action.disabled = true;
  } else if (item.status === 'done') {
    meta.textContent = `Готово · ${formatSize(item.result.blob.size)}${item.result.note ? ' · ' + item.result.note : ''}${item.result.warn ? ' · ' + item.result.warn : ''}`;
    meta.classList.add(item.result.warn ? 'warn' : 'ok');
    action.textContent = 'Скачать';
    action.classList.add('ok');
  } else {
    meta.textContent = `${size} · ${kind}${detected}`;
    action.textContent = 'Конвертировать';
    action.classList.add('primary');
  }
}

function setProgress(item, p) {
  const { progress, bar } = item.el;
  if (p == null) { progress.classList.add('indet'); bar.style.width = ''; }
  else { progress.classList.remove('indet'); bar.style.width = Math.round(Math.min(1, p) * 100) + '%'; }
}

async function convertItem(item) {
  if (!item.cat || !item.target || item.status === 'work' || item.cat === 'archive') return;
  item.status = 'work';
  item.workText = item.target === 'webm' ? 'Запись видео в реальном времени — не закрывайте вкладку…' : 'Конвертация…';
  refreshRow(item);
  setProgress(item, null);
  const onProgress = (p) => setProgress(item, p);
  const onStatus = (text) => { item.workText = text; item.el.meta.textContent = text; };
  const opts = getOptions();
  const { file, ext, target } = item;
  try {
    let res;
    switch (item.cat) {
      case 'image': res = await convertImage(file, canon(ext), target, opts); break;
      case 'data':  res = await convertData(file, ext, target); break;
      case 'doc':   res = await convertDoc(file, ext, target, opts, onProgress, onStatus, item.editedHtml); break;
      case 'media': res = await convertMedia(file, ext, target, opts, onProgress); break;
      case 'cad':   res = await convertCad(item, onStatus); break;
    }
    const blob = res instanceof Blob ? res : res.blob;
    const outExt = res instanceof Blob ? target : res.ext;
    item.result = { blob, name: `${item.outBase}.${outExt}`, path: item.path, note: res.note, warn: res.warn };
    item.status = 'done';
  } catch (e) {
    console.error(e);
    item.status = 'error';
    item.error = e && e.message ? e.message : String(e);
  }
  refreshRow(item);
  updateToolbar();
}

function download({ blob, name }) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
}

function updateToolbar() {
  $('toolbar').hidden = items.length === 0;
  const done = items.filter((i) => i.status === 'done');
  $('count').textContent = `Файлов: ${items.length}` + (done.length ? ` · готово: ${done.length}` : '');
  $('zipAll').disabled = done.length === 0;
  $('convertAll').disabled = !items.some((i) => i.cat && i.cat !== 'archive' && i.status !== 'done' && i.status !== 'work');
  updateBulk();
}

/* ---- «Формат для всех» ---- */

function updateBulk() {
  const sel = $('bulkTarget');
  const counts = {};
  for (const i of items) if (i.cat && i.cat !== 'archive' && i.status !== 'work') for (const t of i.targets) counts[t] = (counts[t] || 0) + 1;
  const prev = sel.value;
  sel.innerHTML = '';
  sel.add(new Option('Формат для всех…', ''));
  for (const t of Object.keys(counts).sort((a, b) => counts[b] - counts[a])) sel.add(new Option(`${t.toUpperCase()} (${counts[t]})`, t));
  sel.value = counts[prev] ? prev : '';
  sel.hidden = Object.keys(counts).length === 0;
}

$('bulkTarget').onchange = (e) => {
  const t = e.target.value;
  if (!t) return;
  for (const i of items) {
    if (i.status === 'work' || !i.targets || !i.targets.includes(t) || i.target === t) continue;
    i.target = t; i.el.target.value = t; i.status = 'idle'; i.result = null;
    refreshRow(i);
  }
  updateToolbar();
};

/* ---- события ---- */

const drop = $('drop');
const picker = $('picker');
const folderPicker = $('folderPicker');
picker.onchange = () => { addFiles([...picker.files]); picker.value = ''; };
folderPicker.onchange = () => { addFiles([...folderPicker.files]); folderPicker.value = ''; };
$('pickFolder').onclick = (e) => { e.preventDefault(); e.stopPropagation(); folderPicker.click(); };
drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); picker.click(); } });
['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', async (e) => {
  // папки: обходим вложенные файлы с сохранением структуры
  const roots = [...e.dataTransfer.items].map((i) => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
  if (!roots.length) { addFiles([...e.dataTransfer.files]); return; }
  const out = [];
  const walk = async (entry, prefix) => {
    if (entry.isFile) {
      const f = await new Promise((res, rej) => entry.file(res, rej));
      out.push({ file: f, path: prefix });
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      const dir = prefix ? `${prefix}/${entry.name}` : entry.name;
      for (;;) {
        const batch = await new Promise((res, rej) => reader.readEntries(res, rej));
        if (!batch.length) break;
        for (const child of batch) await walk(child, dir);
      }
    }
  };
  for (const r of roots) await walk(r, '');
  addFiles(out);
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

$('quality').oninput = (e) => { $('qualityVal').textContent = e.target.value; };

$('convertAll').onclick = async () => {
  for (const item of [...items]) {
    if (item.cat && item.cat !== 'archive' && item.status !== 'done' && item.status !== 'work') await convertItem(item);
  }
};

$('clearAll').onclick = () => {
  for (const item of [...items]) if (item.status !== 'work') removeItem(item);
  updateToolbar();
};

$('zipAll').onclick = async () => {
  const done = items.filter((i) => i.status === 'done');
  if (done.length === 1) return download(done[0].result);
  await loadLib('jszip');
  const zip = new JSZip();
  const used = new Set();
  for (const { result } of done) {
    const full = (p, n) => (p ? `${p}/${n}` : n);
    let name = full(result.path, result.name), n = 1;
    while (used.has(name)) name = full(result.path, `${baseOf(result.name)} (${n++}).${extOf(result.name)}`);
    used.add(name);
    zip.file(name, result.blob);
  }
  download({ blob: await zip.generateAsync({ type: 'blob' }), name: 'bullconvert.zip' });
};

/* ================= Приложение (PWA) и другие устройства ================= */

const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isAndroid = /Android/i.test(navigator.userAgent);
const onThisPC = ['localhost', '127.0.0.1', 'bullconvert.localhost'].includes(location.hostname);

if ('serviceWorker' in navigator && window.isSecureContext && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Service worker:', e));
}

// Файлы, открытые через «Открыть с помощью → BullConvert» в установленном приложении
if ('launchQueue' in window) {
  window.launchQueue.setConsumer(async (params) => {
    if (params.files && params.files.length) addFiles(await Promise.all(params.files.map((h) => h.getFile())));
  });
}

let deferredInstall = null;
function updateInstallButton() {
  // Кнопка есть, если браузер умеет ставить сам, а на iPhone/по сети — с инструкцией
  $('installBtn').hidden = isStandalone() || location.protocol === 'file:' || !(deferredInstall || isIOS || !window.isSecureContext);
}
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall = e; updateInstallButton(); });
window.addEventListener('appinstalled', () => { deferredInstall = null; updateInstallButton(); });
updateInstallButton();

function openDialog(title, html) {
  const dlg = $('devicesDlg');
  dlg.querySelector('h2').textContent = title;
  $('devicesBody').innerHTML = html;
  if (!dlg.open) dlg.showModal();
}

function installHelpHtml() {
  if (isIOS) {
    return `<ol class="steps"><li>Откройте эту страницу в <b>Safari</b>.</li>
      <li>Нажмите <b>«Поделиться»</b> <span class="kbd">⎋↑</span> внизу экрана.</li>
      <li>Выберите <b>«На экран „Домой“»</b> → <b>«Добавить»</b>.</li></ol>
      <p class="muted">На экране появится значок BullConvert с быком — он открывается как отдельное приложение.</p>`;
  }
  if (isAndroid) {
    return `<ol class="steps"><li>Откройте меню браузера <span class="kbd">⋮</span> (Chrome — справа вверху).</li>
      <li>Выберите <b>«Добавить на главный экран»</b> (или «Установить приложение»).</li>
      <li>Подтвердите — значок BullConvert появится на рабочем столе телефона.</li></ol>`;
  }
  return `<ol class="steps"><li>В Chrome или Edge откройте меню <span class="kbd">⋮</span> / <span class="kbd">…</span>.</li>
    <li>Выберите <b>«Установить BullConvert»</b> (в Edge: «Приложения → Установить этот сайт как приложение»).</li></ol>`;
}

$('installBtn').onclick = async () => {
  if (deferredInstall) {
    deferredInstall.prompt();
    await deferredInstall.userChoice;
    deferredInstall = null;
    updateInstallButton();
    return;
  }
  openDialog('Установить BullConvert', installHelpHtml());
};

async function qrSvg(text) {
  try {
    await loadLib('qrcode');
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    return qr.createSvgTag({ cellSize: 5, margin: 2, scalable: true });
  } catch { return ''; }
}

$('devicesBtn').onclick = async () => {
  openDialog('BullConvert на других устройствах', '<p>Проверяю…</p>');
  if (location.protocol === 'file:') {
    $('devicesBody').innerHTML = '<p>Сначала запустите BullConvert (кнопка вверху страницы или ярлык на рабочем столе).</p>';
    return;
  }
  let st = null;
  try { st = await (await fetch('/api/status', { cache: 'no-store' })).json(); } catch { /* сервер недоступен */ }

  if (!st) {
    // публичный сайт (GitHub Pages): сервера BullConvert нет, всё работает на самом устройстве
    $('devicesBody').innerHTML = `<p>✅ Этот сайт работает прямо на вашем устройстве — файлы никуда не загружаются.</p>
      <p class="muted">Установите его как приложение и нажмите в «Настройках» «Подготовить к работе без интернета» — дальше конвертер работает даже в самолёте.</p>
      <h3>Значок на экран</h3>${installHelpHtml()}
      <h3>Поделиться</h3><div class="qr-list"><div class="qr-card">${await qrSvg(location.origin + location.pathname)}<a href="${escapeHtml(location.origin + location.pathname)}">${escapeHtml(location.origin + location.pathname)}</a></div></div>`;
    return;
  }
  if (!onThisPC) {
    const how = location.protocol === 'https:' ? 'через интернет (защищённое соединение)' : 'по домашней сети';
    $('devicesBody').innerHTML = `<p>✅ Вы подключены к компьютеру с BullConvert ${how}.</p>
      <p class="muted">Фото, документы, книги и таблицы конвертируются прямо на этом устройстве.</p>
      <h3>Значок на экран</h3>${installHelpHtml()}`;
    return;
  }
  if (!st || !st.lan) {
    $('devicesBody').innerHTML = `<p>Сейчас BullConvert доступен только на этом компьютере.</p>
      <p>Чтобы открыть его с телефона, планшета или другого компьютера <b>в той же сети Wi-Fi</b>:</p>
      <ol class="steps"><li>В папке конвертера запустите <b>«Включить доступ с других устройств.bat»</b>.</li>
      <li>Если Windows спросит про брандмауэр — разрешите доступ <b>для частных сетей</b>.</li>
      <li>Откройте это окно снова — здесь появятся адрес и QR-код.</li></ol>
      <p class="muted">Из интернета доступа не будет — только из вашей домашней сети. Выключить: «Выключить доступ с других устройств.bat».</p>`;
    return;
  }
  const urls = (st.addresses || []).map((ip) => `http://${ip}${st.port && st.port !== 80 ? ':' + st.port : ''}/`);
  if (!urls.length) {
    $('devicesBody').innerHTML = '<p>Доступ по сети включён, но компьютер не подключён ни к одной сети.</p>';
    return;
  }
  const blocks = [];
  for (const u of urls) blocks.push(`<div class="qr-card">${await qrSvg(u)}<a href="${u}" target="_blank" rel="noopener">${u}</a></div>`);
  $('devicesBody').innerHTML = `<p>Наведите камеру телефона на QR-код или введите адрес в браузере на устройстве <b>в той же сети Wi-Fi</b>:</p>
    <div class="qr-list">${blocks.join('')}</div>
    <h3>Значок на экран телефона</h3>
    <p class="muted"><b>iPhone:</b> Safari → «Поделиться» → «На экран „Домой“». <b>Android:</b> Chrome → меню ⋮ → «Добавить на главный экран».</p>
    <p class="muted">Компьютер должен быть включён, а BullConvert — запущен (он стартует вместе с Windows).</p>`;
};

/* ---- Работа без интернета: заранее скачать все модули в кэш приложения ---- */

async function prepareOffline() {
  const out = $('offlineMsg');
  const btn = $('offlineBtn');
  btn.disabled = true;
  const sw = 'serviceWorker' in navigator && navigator.serviceWorker.controller;
  try {
    const names = Object.keys(CDN).filter((k) => k !== 'pdfjsWorker');
    for (let i = 0; i < names.length; i++) {
      out.textContent = `Скачиваю модули: ${i + 1} из ${names.length}…`;
      try { if (names[i] === 'pdfjs') await getPdfJs(); else await loadLib(names[i]); } catch { /* модуль не критичен */ }
    }
    out.textContent = 'Скачиваю распознавание текста (≈20 МБ, один раз)…';
    await getOcrWorker();
    try { localStorage.setItem('bcOffline', new Date().toISOString()); } catch { /* приватный режим */ }
    out.textContent = sw
      ? '✓ Готово: BullConvert работает без интернета (фото, PDF, документы, книги, таблицы, аудио, распознавание).'
      : '✓ Модули загружены. Чтобы работать без интернета, установите приложение с сайта (кнопка «Установить приложение»).';
  } catch (e) {
    out.textContent = 'Не удалось скачать всё: ' + e.message;
  } finally { btn.disabled = false; }
}
$('offlineBtn').onclick = prepareOffline;
try { if (localStorage.getItem('bcOffline')) $('offlineMsg').textContent = '✓ Подготовлено к работе без интернета.'; } catch { /* нет доступа */ }

/* ---- Администратор: кнопка и счётчик новых запросов доступа (только на этом компьютере) ---- */

async function pollAdmin() {
  try {
    const r = await fetch('/api/admin/state', { headers: { 'X-BC-Admin': '1' }, cache: 'no-store' });
    if (!r.ok) return;
    const s = await r.json();
    $('adminBtn').hidden = false;
    const b = $('adminBadge');
    b.hidden = !s.pending;
    b.textContent = s.pending || '';
    $('adminBtn').title = s.pending ? `Ждут разрешения: ${s.pending}` : 'Доступ через интернет';
  } catch { /* сервер недоступен */ }
}
if (onThisPC && location.protocol.startsWith('http')) { pollAdmin(); setInterval(pollAdmin, 10000); }

// Возможности компьютера владельца (КОМПАС/DWG, RAR/7Z) включаются только когда
// BullConvert открыт на этом компьютере и его сервер отвечает
(async () => {
  if (!onThisPC || !location.protocol.startsWith('http')) return;
  try {
    const st = await (await fetch('/api/status', { cache: 'no-store' })).json();
    if (!st.server) return;
    pcFeatures = true;
    document.body.classList.add('pc');
    // файлы, добавленные до ответа сервера, определяем заново
    for (const it of items) {
      if (it.cat || it.status === 'work') continue;
      await identify(it); rebuildTargets(it); refreshRow(it);
      if (it.cat === 'archive') unpack(it);
    }
    updateToolbar();
  } catch { /* сервера нет — только браузерные форматы */ }
})();

autoConnect();
