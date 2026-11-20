'use strict';

/* =====================================================================
   BullConvert — конвертер файлов.
   Почти всё работает прямо в браузере; часть форматов
   обрабатывает локальный сервер (serve.ps1).
   Библиотеки лежат в папке vendor/ (свои копии, без чужих серверов)
   и подгружаются только когда нужны.
   ===================================================================== */

// Все библиотеки — свои копии в vendor/ (скачивает tools/vendor.py)
const CDN = {
  xlsx:        'vendor/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
  yaml:        'vendor/npm/js-yaml@4.1.0/dist/js-yaml.min.js',
  marked:      'vendor/npm/marked@12.0.2/marked.min.js',
  turndown:    'vendor/npm/turndown@7.1.3/dist/turndown.js',
  mammoth:     'vendor/npm/mammoth@1.8.0/mammoth.browser.min.js',
  pdfjs:       'vendor/npm/pdfjs-dist@3.11.174/build/pdf.min.js',
  pdfjsWorker: 'vendor/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js',
  html2pdf:    'vendor/npm/html2pdf.js@0.10.1/dist/html2pdf.bundle.min.js',
  pdfmake:     'vendor/npm/pdfmake@0.2.10/build/pdfmake.min.js',
  pdfmakeFonts:'vendor/npm/pdfmake@0.2.10/build/vfs_fonts.js',
  htmlToPdfmake:'vendor/npm/html-to-pdfmake@2.5.13/browser.js',
  jspdf:       'vendor/npm/jspdf@2.5.1/dist/jspdf.umd.min.js',
  jszip:       'vendor/npm/jszip@3.10.1/dist/jszip.min.js',
  lame:        'vendor/npm/lamejs@1.2.1/lame.min.js',
  tesseract:   'vendor/npm/tesseract.js@5.1.1/dist/tesseract.min.js',
  heic2any:    'vendor/npm/heic2any@0.0.4/dist/heic2any.min.js',
  djvu:        'vendor/djvu/djvu.js',
  qrcode:      'vendor/npm/qrcode-generator@1.4.4/qrcode.js',
  // @cantoo/pdf-lib — совместимая версия pdf-lib с поддержкой паролей (AES-256)
  pdflib:      'vendor/npm/@cantoo/pdf-lib@2.9.2/dist/pdf-lib.min.js',
  fontkit:     'vendor/npm/@pdf-lib/fontkit@1.1.1/dist/fontkit.umd.min.js',
  pako:        'vendor/npm/pako@1.0.11/dist/pako.min.js',
  utif:        'vendor/npm/utif@3.1.0/UTIF.js',
  omggif:      'vendor/npm/omggif@1.0.10/omggif.js',
  // векторные картинки Windows (WMF/EMF): формулы и схемы в документах Word
  wmf:         'vendor/npm/rtf.js@3.0.9/dist/WMFJS.bundle.min.js',
  emf:         'vendor/npm/rtf.js@3.0.9/dist/EMFJS.bundle.min.js',
};

/** Полный адрес файла из vendor/ (нужен для воркеров и модулей) */
const vendorUrl = (p) => new URL('vendor/' + p, location.href).href;
// карты кодировок и стандартные шрифты для pdf.js: китайские/японские PDF и PDF без встроенных шрифтов
const PDFJS_OPTS = () => ({ cMapUrl: vendorUrl('npm/pdfjs-dist@3.11.174/cmaps/'), cMapPacked: true,
  standardFontDataUrl: vendorUrl('npm/pdfjs-dist@3.11.174/standard_fonts/') });

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
        reject(new Error(`Не удалось загрузить библиотеку «${name}». Обновите страницу.`));
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
  image:   { label: 'Фото',    in: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'ico', 'svg', 'avif', 'heic', 'heif', 'tif', 'tiff'] },
  data:    { label: 'Данные',  in: ['csv', 'tsv', 'json', 'xlsx', 'xls', 'ods', 'xml', 'yaml', 'yml'] },
  doc:     { label: 'Док',     in: ['txt', 'md', 'markdown', 'html', 'htm', 'docx', 'doc', 'dot', 'rtf', 'odt', 'pptx', 'ppsx', 'ppt', 'pps', 'pdf', 'djvu', 'djv', 'epub', 'fb2', 'mobi', 'azw', 'azw3', 'prc'] },
  media:   { label: 'Медиа',   in: ['mp3', 'wav', 'ogg', 'oga', 'opus', 'm4a', 'aac', 'flac', 'webm', 'mp4', 'mov', 'mkv'] },
  cad:     { label: 'CAD',     in: [...CAD_2D, ...CAD_SPEC, ...CAD_ACAD, ...CAD_3D] },
  archive: { label: 'Архив',   in: ARCHIVES },
};

const SAME = { jpeg: 'jpg', yml: 'yaml', htm: 'html', markdown: 'md', oga: 'ogg', djv: 'djvu', heif: 'heic', azw: 'mobi', azw3: 'mobi', prc: 'mobi', tif: 'tiff', dot: 'doc', pps: 'ppt', ppsx: 'pptx' };
const canon = (e) => SAME[e] || e;

// Запись MP4 умеют Chrome/Edge (новые версии) и Safari; иначе предлагаем WEBM
const MP4_TYPES = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1', 'video/mp4'];
const WEBM_TYPES = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
const recordable = (types) => (window.MediaRecorder && types.find((m) => MediaRecorder.isTypeSupported(m))) || null;

function targetsFor(cat, ext) {
  const not = (list) => list.filter((t) => t !== canon(ext));
  switch (cat) {
    // txt/docx у фото — распознавание текста со снимка
    case 'image': return not(['png', 'jpg', 'webp', 'pdf', 'spdf', 'nobg', 'gif', 'tiff', 'bmp', 'ico', 'txt', 'docx', 'xlsx']);
    case 'data':  return not(['pdf', 'xlsx', 'docx', 'csv', 'tsv', 'json', 'yaml', 'xml', 'html', 'md']);
    case 'doc':
      if (ext === 'pdf') return ['docx', 'gost', 'spdf', 'xlsx', 'txt', 'md', 'html', 'epub', 'fb2', 'png', 'jpg'];
      if (canon(ext) === 'djvu') return ['pdf', 'spdf', 'png', 'jpg', 'docx', 'txt', 'md', 'html', 'epub', 'fb2'];
      // слайды рисуются в браузере; на компьютере владельца с Office — ещё и точно через PowerPoint/Word
      if (canon(ext) === 'pptx') return ['pdf', 'jpg', 'docx', 'txt', 'md', 'html'];
      if (canon(ext) === 'ppt') return ['pdf', ...(pcFeatures && officeAvailable ? ['pptx', 'jpg'] : []), 'docx', 'txt', 'md', 'html'];
      if (canon(ext) === 'doc') return ['pdf', 'docx', 'gost', ...(pcFeatures && officeAvailable ? ['rtf', 'odt'] : []), 'txt', 'html', 'md', 'epub', 'fb2'];
      // «DOCX по ГОСТ» — для документов, которые сдают как отчёт (не для книг)
      return not(['pdf', 'docx', ...(['epub', 'fb2', 'mobi'].includes(canon(ext)) ? [] : ['gost']), 'png', 'jpg', 'epub', 'fb2', 'html', 'md', 'txt']);
    case 'media':
      if (VIDEO_EXT.includes(ext)) return not([...(recordable(MP4_TYPES) ? ['mp4'] : []), 'webm', 'gif', 'mp3', 'wav', 'frames']);
      return not(['mp3', 'wav']);
    case 'cad':
      if (CAD_2D.includes(ext)) return ['pdf', 'dwg', 'dxf', 'png', 'jpg'];
      if (CAD_SPEC.includes(ext)) return ['pdf'];
      if (ext === 'dwg') return ['pdf', 'dxf', 'cdw', 'png', 'jpg'];
      if (ext === 'dxf') return pcFeatures ? ['pdf', 'dwg', 'cdw', 'png', 'jpg', 'svg'] : ['pdf', 'svg', 'png', 'jpg'];
      if (CAD_3D.includes(ext)) return ['step', 'stl', 'igs', 'png', 'jpg', 'pdf'];
      return [];
    default: return [];
  }
}

// Понятные названия особых вариантов в списке форматов
const TARGET_LABELS = {
  nobg: 'PNG без фона',
  frames: 'Кадры JPG (ZIP)',
  spdf: 'PDF с поиском (распознать текст)',
  gost: 'DOCX по ГОСТ (поля, шрифт 14, интервал 1,5)',
};
const targetLabel = (t) => TARGET_LABELS[t] || t.toUpperCase();

const MIME = {
  png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', bmp: 'image/bmp', ico: 'image/x-icon',
  gif: 'image/gif', tiff: 'image/tiff', mp4: 'video/mp4',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv;charset=utf-8', tsv: 'text/tab-separated-values;charset=utf-8',
  json: 'application/json;charset=utf-8', yaml: 'text/yaml;charset=utf-8', xml: 'application/xml;charset=utf-8',
  html: 'text/html;charset=utf-8', md: 'text/markdown;charset=utf-8', txt: 'text/plain;charset=utf-8',
  pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  epub: 'application/epub+zip', fb2: 'application/x-fictionbook+xml', zip: 'application/zip',
  mp3: 'audio/mpeg', wav: 'audio/wav', webm: 'video/webm',
  dwg: 'image/vnd.dwg', dxf: 'image/vnd.dxf', cdw: 'application/octet-stream', svg: 'image/svg+xml',
  step: 'model/step', stl: 'model/stl', igs: 'model/iges',
};

const extOf = (name) => (name.includes('.') ? name.split('.').pop().toLowerCase() : '');
const baseOf = (name) => (name.includes('.') ? name.slice(0, name.lastIndexOf('.')) : name);
// Чертежи КОМПАС/DWG и архивы RAR/7Z обрабатывает только сервер на компьютере владельца.
// Пока BullConvert открыт не на нём (публичный сайт, телефон, другой компьютер),
// эти форматы считаются неподдерживаемыми и нигде не упоминаются.
let pcFeatures = false;
let officeAvailable = false; // на компьютере владельца установлен Microsoft Office
// Режим автоматических проверок (tests/tests.html): только на этом компьютере; Office и статистика отключены,
// чтобы проверялось то же, что работает у посетителей публичного сайта
const TEST_MODE = ['localhost', '127.0.0.1', 'bullconvert.localhost'].includes(location.hostname) && new URLSearchParams(location.search).has('test');
const catOf = (ext) => {
  const c = Object.keys(CATEGORIES).find((k) => CATEGORIES[k].in.includes(ext)) || null;
  // DXF рисуется прямо в браузере — доступен везде; остальные чертежи — только с КОМПАС на компьютере владельца
  if (!pcFeatures && ((c === 'cad' && ext !== 'dxf') || (c === 'archive' && ext !== 'zip'))) return null;
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
/** Время на вёрстку PDF: растёт с объёмом (минута + 20 с на каждый МБ, до 30 минут),
 *  чтобы большие документы успевали собраться, а зависание всё равно ловилось. */
const layoutTimeout = (bytes) => Math.round(Math.min(30 * 60e3, 60e3 + (bytes / 1048576) * 20e3));
// Предел размера холста: Safari/iPhone — 16,7 млн точек, остальные браузеры — больше
const IS_IOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const MAX_CANVAS_AREA = IS_IOS ? 16_000_000 : 120_000_000, MAX_CANVAS_SIDE = IS_IOS ? 4096 * 4 : 32_000;
/** Масштаб, при котором холст w×h (при scale=1) помещается в пределы браузера */
const canvasFit = (w, h, scale) => Math.min(scale, Math.sqrt(MAX_CANVAS_AREA / (w * h)), MAX_CANVAS_SIDE / w, MAX_CANVAS_SIDE / h);

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
  const kb = parseInt(document.getElementById('maxKB').value, 10);
  return {
    quality: parseInt(document.getElementById('quality').value, 10) / 100,
    maxWidth: mw > 0 ? mw : null,
    maxKB: kb > 0 ? kb : null,
    bitrate: parseInt(document.getElementById('bitrate').value, 10),
  };
}

/**
 * Сохранить холст не больше maxKB: подбор качества JPEG/WEBP двоичным поиском,
 * а если не хватает — постепенное уменьшение размеров (для PNG — только уменьшение).
 */
async function canvasToBlobMax(canvas, type, quality, maxKB) {
  if (!maxKB) return canvasToBlob(canvas, type, quality);
  const max = maxKB * 1024;
  let c = canvas;
  for (let step = 0; step < 12; step++) {
    if (type === 'image/png') {
      const b = await canvasToBlob(c, type);
      if (b.size <= max) return b;
    } else {
      let lo = 0.3, hi = Math.min(0.95, quality || 0.92), best = null;
      const top = await canvasToBlob(c, type, hi);
      if (top.size <= max) return top;
      for (let i = 0; i < 7; i++) {
        const q = (lo + hi) / 2;
        const b = await canvasToBlob(c, type, q);
        if (b.size <= max) { best = b; lo = q; } else hi = q;
      }
      if (best) return best;
    }
    if (c.width < 64 || c.height < 64) break;
    const s = document.createElement('canvas');
    s.width = Math.round(c.width * 0.8); s.height = Math.round(c.height * 0.8);
    const ctx = s.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(c, 0, 0, s.width, s.height);
    c = s;
  }
  return canvasToBlob(c, type, 0.3);
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
  if (has('ppt/presentation.xml')) return 'pptx';
  if (has('mimetype')) {
    const mt = (await zip.file('mimetype').async('string')).trim();
    if (mt === 'application/epub+zip') return 'epub';
    if (mt === 'application/vnd.oasis.opendocument.spreadsheet') return 'ods';
    if (mt === 'application/vnd.oasis.opendocument.text') return 'odt';
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
  if (s(0, 4) === 'II*\u0000' || s(0, 4) === 'MM\u0000*') return 'tiff';
  if (s(0, 5) === '{\\rtf') return 'rtf';
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

/** Страницы TIFF (сканы часто многостраничные) → холсты. Браузеры TIFF сами не открывают. */
async function tiffCanvases(file, maxPages = 5000) {
  await loadLib('pako'); // нужен UTIF для сжатия Deflate
  await loadLib('utif');
  const buf = await file.arrayBuffer();
  let ifds;
  try { ifds = UTIF.decode(buf); } catch { throw new Error('Не удалось прочитать TIFF (файл повреждён?).'); }
  const pages = ifds.filter((f) => f.t256 || f.width).slice(0, maxPages);
  const out = [];
  for (const ifd of pages) {
    UTIF.decodeImage(buf, ifd);
    const rgba = UTIF.toRGBA8(ifd);
    const c = document.createElement('canvas');
    c.width = ifd.width; c.height = ifd.height;
    c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.length), ifd.width, ifd.height), 0, 0);
    out.push(c);
  }
  if (!out.length) throw new Error('В TIFF нет изображений.');
  return out;
}

async function imageSource(file, ext) {
  if (ext === 'tiff' || ext === 'tif') {
    const [c] = await tiffCanvases(file, 1);
    return canvasToBlob(c, 'image/png');
  }
  if (ext === 'heic' || ext === 'heif') {
    await loadLib('heic2any');
    let out;
    try { out = await heic2any({ blob: file, toType: 'image/png' }); }
    catch { throw new Error('Не удалось прочитать HEIC-фото.'); }
    return Array.isArray(out) ? out[0] : out;
  }
  // без правильного типа браузер не откроет SVG (файлы из архивов, «без расширения», с телефона)
  const types = { svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', ico: 'image/x-icon', avif: 'image/avif' };
  if (types[ext] && file.type !== types[ext]) return new Blob([file], { type: types[ext] });
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

async function convertImage(file, ext, target, opts, onProgress = () => {}, onStatus = () => {}) {
  // многостраничный TIFF → PDF: все страницы
  if (ext === 'tiff' && target === 'pdf') {
    onStatus('Чтение страниц TIFF…');
    const pages = await tiffCanvases(file);
    const pdf = await createImagePdf();
    pages.forEach((c, i) => { pdf.add(c, opts.quality); onProgress((i + 1) / pages.length); });
    return { blob: pdf.blob(), ext: 'pdf', note: pages.length > 1 ? `${pages.length} стр.` : '' };
  }
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
    if (['jpg', 'bmp', 'pdf', 'txt', 'docx'].includes(target)) {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, w, h);
    }
    ctx.drawImage(img, 0, 0, w, h);

    // фото → текст: распознавание (русский + английский)
    if (target === 'txt' || target === 'docx') {
      // мелкий текст распознаётся лучше на увеличенном снимке
      let src = canvas;
      if (Math.max(w, h) < 1600) {
        const k = 1600 / Math.max(w, h);
        src = document.createElement('canvas');
        src.width = Math.round(w * k); src.height = Math.round(h * k);
        const sctx = src.getContext('2d');
        sctx.imageSmoothingQuality = 'high';
        sctx.drawImage(canvas, 0, 0, src.width, src.height);
      }
      onStatus('Распознавание текста…');
      const text = (await ocrCanvas(src, onStatus, onProgress)).trim();
      if (!text) throw new Error('Текст на изображении не найден.');
      if (target === 'txt') return new Blob([text + '\n'], { type: MIME.txt });
      return htmlToDocx(textToHtml(text));
    }
    if (target === 'gif') return encodeGIF([ctx.getImageData(0, 0, w, h)], w, h, 0);
    if (target === 'tiff') {
      await loadLib('pako'); await loadLib('utif');
      return new Blob([UTIF.encodeImage(ctx.getImageData(0, 0, w, h).data.buffer, w, h)], { type: MIME.tiff });
    }
    if (target === 'bmp') return encodeBMP(ctx, w, h);
    if (target === 'pdf') {
      const pdf = await createImagePdf();
      pdf.add(canvas, opts.quality);
      return pdf.blob();
    }
    // фото без фона: нейросеть прямо в браузере (модель скачивается один раз)
    if (target === 'nobg') {
      const blob = await removeBackground(await canvasToBlob(canvas, 'image/png'), onStatus, onProgress);
      return { blob, ext: 'png', note: 'фон удалён' };
    }
    return canvasToBlobMax(canvas, MIME[target], opts.quality, opts.maxKB);
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

/**
 * GIF из одного или нескольких кадров (ImageData одного размера).
 * Палитра: точная, если цветов ≤ 255, иначе равномерная 6×7×6 (+ дизеринг для одиночной картинки).
 * delayCs — пауза между кадрами в сотых долях секунды.
 */
async function encodeGIF(frames, w, h, delayCs = 0) {
  await loadLib('omggif');
  let hasAlpha = false;
  const exact = new Map();
  let tooMany = false;
  outer: for (const f of frames) {
    const d = f.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 128) { hasAlpha = true; continue; }
      const k = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
      if (!exact.has(k)) { if (exact.size >= 255) { tooMany = true; break outer; } exact.set(k, exact.size); }
    }
  }
  let palette, transparent, index;
  if (!tooMany) {
    palette = [...exact.keys()];
    transparent = palette.length;
    index = (r, g, b) => exact.get((r << 16) | (g << 8) | b);
  } else {
    palette = [];
    for (let r = 0; r < 6; r++) for (let g = 0; g < 7; g++) for (let b = 0; b < 6; b++) {
      palette.push((Math.round(r * 51) << 16) | (Math.round(g * 42.5) << 8) | Math.round(b * 51));
    }
    transparent = 252;
    index = (r, g, b) => Math.round(r / 51) * 42 + Math.round(g / 42.5) * 6 + Math.round(b / 51);
  }
  palette.push(0); // место под прозрачный цвет
  let size = 2;
  while (size < palette.length) size *= 2;
  while (palette.length < size) palette.push(0);

  const dither = tooMany && frames.length === 1;
  const buf = new Uint8Array(Math.ceil(w * h * frames.length * 1.6) + 65536);
  const gw = new GifWriter(buf, w, h, frames.length > 1 ? { loop: 0 } : {});
  for (const f of frames) {
    const d = f.data;
    const px = new Uint8Array(w * h);
    if (dither) {
      // Флойд–Стейнберг: ошибки цвета переносятся на соседей — меньше полос на градиентах
      const err = new Float32Array(w * h * 3);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const p = y * w + x, i = p * 4;
        if (d[i + 3] < 128) { px[p] = transparent; continue; }
        const r = Math.min(255, Math.max(0, d[i] + err[p * 3]));
        const g = Math.min(255, Math.max(0, d[i + 1] + err[p * 3 + 1]));
        const b = Math.min(255, Math.max(0, d[i + 2] + err[p * 3 + 2]));
        const k = index(r, g, b);
        px[p] = k;
        const c = palette[k];
        const er = r - (c >> 16 & 255), eg = g - (c >> 8 & 255), eb = b - (c & 255);
        const spread = (q, f2) => { if (q < 0 || q >= w * h) return; err[q * 3] += er * f2; err[q * 3 + 1] += eg * f2; err[q * 3 + 2] += eb * f2; };
        if (x + 1 < w) spread(p + 1, 7 / 16);
        if (y + 1 < h) { if (x > 0) spread(p + w - 1, 3 / 16); spread(p + w, 5 / 16); if (x + 1 < w) spread(p + w + 1, 1 / 16); }
      }
    } else {
      for (let p = 0, i = 0; p < px.length; p++, i += 4) px[p] = d[i + 3] < 128 ? transparent : index(d[i], d[i + 1], d[i + 2]);
    }
    const o = { palette, delay: delayCs, disposal: 1 };
    if (hasAlpha) o.transparent = transparent;
    gw.addFrame(0, 0, w, h, px, o);
  }
  return new Blob([buf.slice(0, gw.end())], { type: MIME.gif });
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

/** Таблица с одной записью и множеством полей удобнее «вертикально»: Поле | Значение */
function docTable(rows) {
  const cols = columnsOf(rows);
  if (rows.length === 1 && cols.length > 6) {
    return '<table><thead><tr><th>Поле</th><th>Значение</th></tr></thead><tbody>' +
      cols.map((c) => `<tr><td><b>${escapeHtml(c)}</b></td><td>${escapeHtml(rows[0][c] ?? '')}</td></tr>`).join('') + '</tbody></table>';
  }
  return htmlTable(rows);
}

/** XML, который не является списком однотипных записей, показываем деревом (как документ) */
function xmlIsTabular(doc) {
  const kids = [...doc.documentElement.children];
  if (kids.length < 2) return false;
  const tag = kids[0].tagName;
  return kids.every((k) => k.tagName === tag && [...k.children].every((c) => c.children.length === 0));
}

function xmlTreeHtml(el) {
  const attrs = [...el.attributes].map((a) => `<i>${escapeHtml(a.name)}</i>=«${escapeHtml(a.value)}»`).join(', ');
  const kids = [...el.children];
  const text = kids.length ? '' : el.textContent.trim();
  const head = `<b>${escapeHtml(el.tagName)}</b>${attrs ? ` (${attrs})` : ''}${text ? ': ' + escapeHtml(text) : ''}`;
  return `<li>${head}${kids.length ? '<ul>' + kids.map(xmlTreeHtml).join('') + '</ul>' : ''}</li>`;
}

async function convertData(file, ext, target) {
  const { sheets, raw } = await parseData(file, ext);
  const filled = sheets.filter((s) => s.rows.length);
  const many = filled.length > 1;
  const list = filled.length ? filled : sheets.slice(0, 1);
  const title = baseOf(file.name);
  let text;

  // XLSX → PDF: вёрстка как в Excel (ширины, объединения, границы, заливка, шрифты)
  if (ext === 'xlsx' && target === 'pdf' && typeof xlsxToPdf === 'function') {
    try {
      const { blob, skipped } = await xlsxToPdf(file, () => {});
      return skipped ? { blob, ext: 'pdf', warn: '⚠ диаграммы и картинки листа не перенесены' } : blob;
    } catch (e) { console.warn('Вёрстка XLSX не удалась, делаю простую таблицу:', e); }
  }

  // Таблицы, JSON, XML → PDF / Word
  if (target === 'pdf' || target === 'docx') {
    let html, wide = 0;
    const xmlDoc = ext === 'xml' ? new DOMParser().parseFromString(await readText(file), 'application/xml') : null;
    if (xmlDoc && !xmlIsTabular(xmlDoc)) {
      html = `<h1>${escapeHtml(title)}</h1><ul>${xmlTreeHtml(xmlDoc.documentElement)}</ul>`;
    } else {
      html = list.map((s) => {
        wide = Math.max(wide, s.rows.length === 1 ? 2 : columnsOf(s.rows).length);
        return (many ? `<h2>${escapeHtml(s.name)}</h2>` : `<h1>${escapeHtml(title)}</h1>`) + docTable(s.rows);
      }).join('<hr>');
    }
    if (target === 'docx') return htmlToDocx(html);
    // широкие таблицы — альбомный лист и шрифт помельче
    return htmlToPdfText(html, title, { landscape: wide > 5, fontSize: wide > 9 ? 7 : wide > 6 ? 9 : 10 });
  }

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
      return Tesseract.createWorker(['rus', 'eng'], 1, {
        logger: (m) => ocrLogger && ocrLogger(m),
        workerPath: vendorUrl('npm/tesseract.js@5.1.1/dist/worker.min.js'),
        corePath: vendorUrl('npm/tesseract.js-core@5.1.1'),
        langPath: vendorUrl('tessdata'),
      });
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

/**
 * Страница-скан в PDF: картинка на всю страницу, поверх — невидимый распознанный текст на тех же местах.
 * worker = null — без распознавания. size — { width, height } в pt, иначе A4 по ширине.
 */
async function addScanPage(out, font, c, worker, size, onFrac = () => {}) {
  let data = null;
  if (worker) {
    ocrLogger = (m) => { if (m.status === 'recognizing text') onFrac(m.progress); };
    try { ({ data } = await worker.recognize(c, {}, { text: true, blocks: true })); } finally { ocrLogger = null; }
  }
  const wPt = size ? size.width : 595.28, hPt = size ? size.height : wPt * c.height / c.width;
  const k = wPt / c.width;
  const jpg = await out.embedJpg(await (await canvasToBlob(c, 'image/jpeg', 0.85)).arrayBuffer());
  const page = out.addPage([wPt, hPt]);
  page.drawImage(jpg, { x: 0, y: 0, width: wPt, height: hPt });
  if (!data || !font) return page;
  const words = data.words || (data.blocks || []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines.flatMap((l) => l.words)));
  for (const w of words) {
    const t = (w.text || '').trim();
    if (!t || w.confidence < 20) continue;
    const { x0, x1, y0, y1 } = w.bbox;
    const bw = (x1 - x0) * k, bh = (y1 - y0) * k;
    if (bw <= 0 || bh <= 0) continue;
    let sz = bh * 0.95;
    try { const w1 = font.widthOfTextAtSize(t, 1); if (w1 > 0) sz = Math.min(sz * 1.3, bw / w1); } catch { continue; }
    try { page.drawText(t, { x: x0 * k, y: hPt - y1 * k + bh * 0.15, size: Math.max(1, sz), font, opacity: 0 }); } catch { /* символ не из шрифта */ }
  }
  return page;
}

/**
 * «PDF с поиском»: сканы и фото → PDF, в котором текст можно искать, выделять и копировать.
 * Страница — картинка, поверх неё невидимый распознанный текст на тех же местах.
 * У PDF страницы, где текст уже есть, копируются без изменений.
 */
async function searchablePdf(file, ext, onProgress, onStatus) {
  const { PDFDocument } = await getPdfLib();
  const out = await PDFDocument.create();
  const font = await embedCyrFont(out);
  let srcDoc = null;
  if (ext === 'pdf') srcDoc = await loadPdfLibDoc(new Uint8Array(await file.arrayBuffer()));
  // источники страниц: { canvas(), wPt, hPt, keep }
  const pages = [];
  if (ext === 'pdf' || ext === 'djvu') {
    for await (const pg of pagesOf(file, ext)) pages.push(pg);
  } else if (ext === 'tiff') {
    for (const c of await tiffCanvases(file)) pages.push({ canvas: () => c });
  } else {
    const src = await imageSource(file, ext);
    const { img, url } = await loadImage(src);
    const c = document.createElement('canvas');
    // мелкие снимки увеличиваем: распознавание точнее примерно от 1500 точек по ширине
    const k = Math.min(3, Math.max(1, 1600 / Math.max(img.naturalWidth, 1)));
    c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(url);
    pages.push({ canvas: () => c });
  }
  const worker = await getOcrWorker();
  let recognized = 0;
  for (let i = 0; i < pages.length; i++) {
    const pg = pages[i];
    // страница PDF уже с текстом — переносим как есть
    if (srcDoc && pg.text && pg.text.replace(/\s/g, '').length >= 10) {
      const [copy] = await out.copyPages(srcDoc, [i]);
      out.addPage(copy);
      onProgress((i + 1) / pages.length);
      continue;
    }
    onStatus(`Распознавание текста: страница ${i + 1} из ${pages.length}…`);
    const c = await pg.canvas();
    // размер страницы: как у исходного PDF, иначе A4 по ширине картинки
    const size = srcDoc ? srcDoc.getPage(i).getSize() : null;
    await addScanPage(out, font, c, worker, size, (f) => onProgress((i + f) / pages.length));
    recognized++;
    c.width = c.height = 0;
    onProgress((i + 1) / pages.length);
  }
  out.setProducer('BullConvert');
  const bytes = await out.save();
  return { blob: new Blob([bytes], { type: 'application/pdf' }), ext: 'pdf', note: recognized ? `распознано стр.: ${recognized}` : 'текст уже был' };
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
  // большие листы (чертежи А0 и т. п.) уменьшаются ровно настолько, чтобы браузер смог их нарисовать
  const viewport = page.getViewport({ scale: canvasFit(base.width, base.height, Math.min(4, targetWidth / base.width)) });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // intent 'print' — без requestAnimationFrame, иначе в фоновой вкладке отрисовка замирает
  await page.render({ canvasContext: ctx, viewport, intent: 'print' }).promise;
  try { page.cleanup(); } catch { /* освобождаем память страницы */ }
  return canvas;
}

/** Перебор страниц PDF: { index, total, canvas(), text } */
async function* pdfPages(file, width = 1700) {
  const pdfjs = await getPdfJs();
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), ...PDFJS_OPTS() }).promise;
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    let text = '';
    for (const it of content.items) text += it.str + (it.hasEOL ? '\n' : '');
    yield { index: p, total: pdf.numPages, text, content, canvas: () => renderPdfPage(page, width), html: () => pdfPageToHtml(page, content) };
  }
}

/**
 * Страница PDF с текстовым слоем → HTML с настоящей структурой: строки собираются в абзацы
 * (по межстрочным интервалам, отступам и концам строк), крупный текст — заголовки, жирный шрифт,
 * выравнивание по центру, списки, перенос слов, картинки на своих местах.
 */
/**
 * Таблицы с рамками на странице PDF: по линиям (тонкие прямоугольники и отрезки) строим сетку,
 * находим объединённые ячейки и раскладываем текст по ячейкам.
 * items — куски текста { str, x, y (сверху вниз, базовая линия), w, size, bold }.
 * Возвращает { tables: [{ x0, y0, x1, y1, rows: [[{ html, text, colspan, rowspan } | null]] }], rest: items вне таблиц }
 */
function pdfRuledTables(ops, H, items) {
  if (!ops) return { tables: [], rest: items };
  const { hs, vs } = pdfSegments(ops, H);
  return gridTables(hs, vs, items);
}

/** Линии страницы PDF (горизонтальные hs: {y,a,b}, вертикальные vs: {x,a,b}), координаты сверху вниз */
function pdfSegments(ops, H) {
  const OPS = pdfjsLib.OPS;
  const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
  const pt = (m, x, y) => [m[0] * x + m[2] * y + m[4], H - (m[1] * x + m[3] * y + m[5])];
  const hs = [], vs = [];
  const seg = (a, b) => {
    const [x0, y0] = a, [x1, y1] = b;
    if (Math.abs(y1 - y0) < 1.2 && Math.abs(x1 - x0) > 3) hs.push({ y: (y0 + y1) / 2, a: Math.min(x0, x1), b: Math.max(x0, x1) });
    else if (Math.abs(x1 - x0) < 1.2 && Math.abs(y1 - y0) > 3) vs.push({ x: (x0 + x1) / 2, a: Math.min(y0, y1), b: Math.max(y0, y1) });
  };
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  const STROKES = new Set([OPS.stroke, OPS.closeStroke, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);
  const FILLS = new Set([OPS.fill, OPS.eoFill]);
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i], args = ops.argsArray[i];
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() || ctm;
    else if (fn === OPS.transform) ctm = mul(ctm, args);
    else if (fn === OPS.paintFormXObjectBegin) { stack.push(ctm); if (args && args[0]) ctm = mul(ctm, args[0]); }
    else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() || ctm;
    else if (fn === OPS.constructPath) {
      // команда рисования может идти не сразу: перед ней цвет, толщина, прозрачность
      let next = null;
      for (let j = i + 1; j < Math.min(ops.fnArray.length, i + 10); j++) {
        const f = ops.fnArray[j];
        if (STROKES.has(f) || FILLS.has(f) || f === OPS.endPath || f === OPS.constructPath) { next = f; break; }
      }
      const stroked = STROKES.has(next), filled = FILLS.has(next) || STROKES.has(next);
      if (!stroked && !filled) continue;
      const [sub, coords] = args;
      let k = 0, cur = null, start = null;
      for (const op of sub) {
        if (op === OPS.moveTo) { cur = start = pt(ctm, coords[k], coords[k + 1]); k += 2; }
        else if (op === OPS.lineTo) { const p = pt(ctm, coords[k], coords[k + 1]); k += 2; if (cur && stroked) seg(cur, p); cur = p; }
        else if (op === OPS.curveTo) { k += 6; cur = pt(ctm, coords[k - 2], coords[k - 1]); }
        else if (op === OPS.curveTo2 || op === OPS.curveTo3) { k += 4; cur = pt(ctm, coords[k - 2], coords[k - 1]); }
        else if (op === OPS.closePath) { if (cur && start && stroked) seg(cur, start); cur = start; }
        else if (op === OPS.rectangle) {
          const [x, y, w, h] = coords.slice(k, k + 4); k += 4;
          const p0 = pt(ctm, x, y), p1 = pt(ctm, x + w, y + h);
          const X0 = Math.min(p0[0], p1[0]), X1 = Math.max(p0[0], p1[0]), Y0 = Math.min(p0[1], p1[1]), Y1 = Math.max(p0[1], p1[1]);
          if (X1 - X0 <= 3 && Y1 - Y0 > 3) vs.push({ x: (X0 + X1) / 2, a: Y0, b: Y1 });       // тонкий прямоугольник — линия
          else if (Y1 - Y0 <= 3 && X1 - X0 > 3) hs.push({ y: (Y0 + Y1) / 2, a: X0, b: X1 });
          else if (stroked && X1 - X0 > 3 && Y1 - Y0 > 3) { hs.push({ y: Y0, a: X0, b: X1 }, { y: Y1, a: X0, b: X1 }); vs.push({ x: X0, a: Y0, b: Y1 }, { x: X1, a: Y0, b: Y1 }); }
        }
      }
    }
  }
  return { hs, vs };
}

/** Линии таблицы на картинке (скан): длинные тёмные отрезки по строкам и столбцам пикселей. k — пикселей → pt */
function imageSegments(canvas, k) {
  const w = canvas.width, h = canvas.height;
  const d = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  const dark = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) dark[j] = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114 < 140 ? 1 : 0;
  const hs = [], vs = [];
  const minH = Math.max(40, w * 0.06), minV = Math.max(30, h * 0.02);
  for (let y = 0; y < h; y++) {
    let run = 0;
    for (let x = 0; x <= w; x++) {
      // небольшие разрывы (1–2 точки) в линии не считаются концом
      const on = x < w && (dark[y * w + x] || (x + 2 < w && dark[y * w + x + 2] && run > 0));
      if (on) run++;
      else { if (run >= minH) hs.push({ y: y * k, a: (x - run) * k, b: x * k }); run = 0; }
    }
  }
  for (let x = 0; x < w; x++) {
    let run = 0;
    for (let y = 0; y <= h; y++) {
      const on = y < h && (dark[y * w + x] || (y + 2 < h && dark[(y + 2) * w + x] && run > 0));
      if (on) run++;
      else { if (run >= minV) vs.push({ x: x * k, a: (y - run) * k, b: y * k }); run = 0; }
    }
  }
  return { hs, vs };
}

/** Сетка таблиц из линий + раскладка текста по ячейкам (общая часть для PDF и сканов) */
function gridTables(hs, vs, items) {
  const empty = { tables: [], rest: items };
  if (hs.length < 2 || vs.length < 2) return empty;
  // склеиваем отрезки, лежащие на одной линии
  const merge = (list, key) => {
    list.sort((p, q) => p[key] - q[key] || p.a - q.a);
    const out = [];
    for (const s of list) {
      const o = out.find((t) => Math.abs(t[key] - s[key]) < 1.5 && s.a <= t.b + 2 && s.b >= t.a - 2);
      if (o) { o.a = Math.min(o.a, s.a); o.b = Math.max(o.b, s.b); } else out.push({ ...s });
    }
    return out;
  };
  const H2 = merge(hs, 'y'), V2 = merge(vs, 'x');
  // связанные группы линий — отдельные таблицы
  const cross = (h, v) => v.x >= h.a - 2 && v.x <= h.b + 2 && h.y >= v.a - 2 && h.y <= v.b + 2;
  const seenH = new Set(), seenV = new Set();
  const groups = [];
  for (const h0 of H2) {
    if (seenH.has(h0)) continue;
    const g = { h: [], v: [] }, queue = [['h', h0]];
    seenH.add(h0);
    while (queue.length) {
      const [t, s] = queue.pop();
      g[t].push(s);
      if (t === 'h') for (const v of V2) { if (!seenV.has(v) && cross(s, v)) { seenV.add(v); queue.push(['v', v]); } }
      else for (const h of H2) { if (!seenH.has(h) && cross(h, s)) { seenH.add(h); queue.push(['h', h]); } }
    }
    if (g.h.length >= 2 && g.v.length >= 2) groups.push(g);
  }
  const cluster = (vals) => { const s = [...vals].sort((a, b) => a - b), out = []; for (const v of s) if (!out.length || v - out[out.length - 1] > 2.5) out.push(v); return out; };
  const tables = [];
  let rest = items;
  for (const g of groups) {
    const xs = cluster(g.v.map((v) => v.x)), ys = cluster(g.h.map((h) => h.y));
    const R = ys.length - 1, C = xs.length - 1;
    if (R < 1 || C < 1 || R * C < 2 || R > 200 || C > 60) continue; // одна рамка — не таблица
    const covers = (list, key, pos, a, b) => list.some((s) => Math.abs(s[key] - pos) < 2.5 && Math.min(s.b, b) - Math.max(s.a, a) >= (b - a) * 0.6);
    // объединение соседних клеток сетки, если между ними нет линии
    const id = Array.from({ length: R }, (_, r) => Array.from({ length: C }, (_, c) => r * C + c));
    const parent = id.flat();
    const find = (a) => (parent[a] === a ? a : (parent[a] = find(parent[a])));
    const unite = (a, b) => { parent[find(a)] = find(b); };
    for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
      if (c < C - 1 && !covers(g.v, 'x', xs[c + 1], ys[r], ys[r + 1])) unite(id[r][c], id[r][c + 1]);
      if (r < R - 1 && !covers(g.h, 'y', ys[r + 1], xs[c], xs[c + 1])) unite(id[r][c], id[r + 1][c]);
    }
    const box = {};
    for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
      const k = find(id[r][c]);
      const b = box[k] || (box[k] = { r0: r, c0: c, r1: r, c1: c, items: [] });
      b.r0 = Math.min(b.r0, r); b.c0 = Math.min(b.c0, c); b.r1 = Math.max(b.r1, r); b.c1 = Math.max(b.c1, c);
    }
    const x0 = xs[0], x1 = xs[C], y0 = ys[0], y1 = ys[R];
    const unitOf = (x, y) => {
      let c = 0, r = 0;
      while (c < C - 1 && x > xs[c + 1]) c++;
      while (r < R - 1 && y > ys[r + 1]) r++;
      return box[find(id[r][c])];
    };
    const left = [];
    for (const it of rest) {
      const cx = it.x + (it.w || 0) / 2, cy = it.y - it.size * 0.35;
      if (cx > x0 && cx < x1 && cy > y0 && cy < y1) unitOf(cx, cy).items.push(it); else left.push(it);
    }
    // одна строка и ни одного текста внутри — скорее рамка рисунка, а не таблица
    const boxes = Object.values(box);
    if (!boxes.some((b) => b.items.length)) continue;
    rest = left;
    const rows = Array.from({ length: R }, () => Array(C).fill(null));
    for (const b of boxes) {
      // текст ячейки: строки по высоте, внутри строки — по горизонтали
      const its = b.items.sort((p, q) => p.y - q.y || p.x - q.x);
      const lns = [];
      for (const it of its) {
        const ln = lns.find((l) => Math.abs(l.y - it.y) < it.size * 0.5);
        if (ln) ln.items.push(it); else lns.push({ y: it.y, items: [it] });
      }
      const lineText = (l) => {
        let s = '', end = null;
        for (const it of l.items.sort((p, q) => p.x - q.x)) { if (end != null && it.x - end > it.size * 0.2 && !/\s$/.test(s)) s += ' '; s += it.str; end = it.x + it.w; }
        return s.replace(/\s+/g, ' ').trim();
      };
      const texts = lns.map(lineText).filter(Boolean);
      // переносы слов внутри ячейки склеиваем, остальные строки — через пробел (это одна ячейка, а не абзацы)
      let text = '';
      for (const t of texts) text = !text ? t : /[a-zа-яё]-$/i.test(text) && /^[a-zа-яё]/.test(t) ? text.slice(0, -1) + t : text + ' ' + t;
      const bold = b.items.length && b.items.every((it) => it.bold);
      const cs = b.c1 - b.c0 + 1, rs = b.r1 - b.r0 + 1;
      rows[b.r0][b.c0] = { text, html: bold ? `<b>${escapeHtml(text)}</b>` : escapeHtml(text), colspan: cs, rowspan: rs };
      for (let r = b.r0; r <= b.r1; r++) for (let c = b.c0; c <= b.c1; c++) if (r !== b.r0 || c !== b.c0) rows[r][c] = undefined; // занято объединением
    }
    tables.push({ x0, y0, x1, y1, rows });
  }
  return { tables, rest };
}

function pdfTableHtml(t) {
  return '<table>' + t.rows.map((r) => '<tr>' + r.map((c) => (c === undefined ? '' : c === null ? '<td></td>'
    : `<td${c.colspan > 1 ? ` colspan="${c.colspan}"` : ''}${c.rowspan > 1 ? ` rowspan="${c.rowspan}"` : ''}>${c.html}</td>`)).join('') + '</tr>').join('') + '</table>';
}

async function pdfPageToHtml(page, content) {
  const vp = page.getViewport({ scale: 1 });
  const H = vp.height;
  // список операций: из него — положение картинок; заодно pdf.js загружает шрифты (нужны имена для «жирный»)
  let ops = null;
  try { ops = await page.getOperatorList(); } catch { /* без картинок */ }
  const fontInfo = {};
  const isBold = (fn) => {
    if (fn in fontInfo) return fontInfo[fn];
    let b = false;
    try { const f = page.commonObjs.get(fn); b = /bold|black|heavy|semibold|demi/i.test((f && (f.name || f.loadedName)) || '') || !!(f && f.bold); } catch { /* шрифт не загружен */ }
    return (fontInfo[fn] = b);
  };

  // элементы текста → строки
  const els = content.items.filter((it) => it.str && it.str.trim() !== '' || (it.str === ' ')).map((it) => {
    const [a, b, c, d, e, f] = it.transform;
    const size = Math.hypot(c, d) || Math.hypot(a, b) || 10;
    return { str: it.str, x: e, y: H - f, w: it.width, size, bold: isBold(it.fontName), vertical: Math.abs(b) > Math.abs(a) };
  }).filter((e) => !e.vertical);
  // таблицы с рамками забирают свой текст; остальное — обычные абзацы
  let tables = [];
  const allEls = els.slice();
  try { const t = pdfRuledTables(ops, H, allEls); tables = t.tables; els.length = 0; els.push(...t.rest); } catch (e) { console.warn('Таблицы PDF:', e); }
  els.sort((p, q) => p.y - q.y || p.x - q.x);
  const lines = [];
  for (const e of els) {
    // мелкий текст чуть выше/ниже строки (индексы м², H₂O) — часть той же строки
    const ln = lines.find((l) => Math.abs(l.y - e.y) < Math.max(l.size, e.size) * 0.5 && e.x > l.x0 - 2 * e.size);
    if (ln) ln.items.push(e), (ln.size = Math.max(ln.size, e.size));
    else lines.push({ y: e.y, size: e.size, items: [e], x0: e.x });
  }
  for (const l of lines) {
    l.items.sort((p, q) => p.x - q.x);
    l.x0 = l.items[0].x;
    const last = l.items[l.items.length - 1];
    l.x1 = last.x + last.w;
    // базовая линия строки — у самого крупного текста
    const main = l.items.reduce((a, b) => (b.size > a.size ? b : a));
    l.y = main.y;
    // текст строки с пробелами по зазорам между кусками
    l.runs = [];
    let prevEnd = null;
    for (const it of l.items) {
      const small = it.size < l.size * 0.85;
      const va = small && l.y - it.y > l.size * 0.15 ? 'sup' : small && it.y - l.y > l.size * 0.08 ? 'sub' : null;
      let s = it.str;
      if (prevEnd != null && it.x - prevEnd > it.size * 0.2 && !/\s$/.test(l.runs.map((r) => r.t).join('')) && !/^\s/.test(s)) s = ' ' + s;
      const r = l.runs[l.runs.length - 1];
      if (r && r.b === it.bold && r.va === va) r.t += s; else l.runs.push({ t: s, b: it.bold, va });
      prevEnd = it.x + it.w;
    }
    // «математические» буквы (𝜆, 𝑥) есть не во всех шрифтах Word — заменяем обычными
    for (const r of l.runs) r.t = r.t.replace(/[\u{1D400}-\u{1D7FF}]/gu, (ch) => ch.normalize('NFKC'));
    l.text = l.runs.map((r) => r.t).join('').replace(/\s+/g, ' ').trim();
    l.bold = l.runs.every((r) => r.b || !r.t.trim());
  }
  // номера страниц в колонтитулах в текст не берём
  const textLines = lines.filter((l) => l.text && !(/^[-–—\s]*\d{1,4}[-–—\s]*$/.test(l.text) && (l.y > H * 0.9 || l.y < H * 0.08))).sort((p, q) => p.y - q.y);

  // типичные размеры: основной шрифт, межстрочный интервал, поля текста
  const median = (arr) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
  const bodySize = median(textLines.flatMap((l) => Array(Math.min(50, l.text.length)).fill(Math.round(l.size * 2) / 2))) || 11;
  const gaps = [];
  for (let i = 1; i < textLines.length; i++) {
    const g = textLines[i].y - textLines[i - 1].y;
    if (g > 0 && Math.abs(textLines[i].size - bodySize) < 1 && Math.abs(textLines[i - 1].size - bodySize) < 1) gaps.push(g);
  }
  const lineGap = median(gaps) || bodySize * 1.3;
  const left = median(textLines.map((l) => Math.round(l.x0))) || 0;
  const right = Math.max(...textLines.map((l) => l.x1), 0);

  // строки → абзацы
  const headingLike = (l) => l.size >= bodySize * 1.12 || (l.bold && l.text.length < 90);
  const isCentered = (l) => l.x0 > left + l.size * 3 && Math.abs((l.x0 + l.x1) / 2 - (left + right) / 2) < l.size * 1.5;
  const paras = [];
  let cur = null;
  // пункт списка: маркер, «1.», «2)», «а)» (но не «т. д.» и не инициалы)
  const listRe = /^([•●▪■◦○∙·–—*]|\d{1,3}[.)]|[a-zа-яё]\))\s/i;
  for (const l of textLines) {
    const prev = cur && cur.lines[cur.lines.length - 1];
    let br = !cur;
    if (prev) {
      const gap = l.y - prev.y;
      if (gap > lineGap * 1.45 || gap < 0) br = true;                          // увеличенный интервал
      else if (Math.abs(l.size - prev.size) > Math.max(1, prev.size * 0.12)) br = true; // другой размер шрифта
      else if (l.bold !== prev.bold && (l.bold || prev.bold)) br = true;       // жирная строка-заголовок
      else if (listRe.test(l.text)) br = true;                                 // пункт списка
      else if (isCentered(l) !== isCentered(prev)) br = true;                  // другое выравнивание (заголовок → подпись)
      // прошлая строка короткая — абзац кончился (кроме многострочных заголовков: у них все строки короткие)
      else if (prev.x1 < right - prev.size * 4 && !/[,;:\-]$/.test(prev.text) && !(headingLike(prev) && headingLike(l))) br = true;
      else if (l.x0 > left + l.size * 1.2 && Math.abs(prev.x0 - left) < l.size) br = true; // красная строка
    }
    if (br) { cur = { lines: [], size: l.size }; paras.push(cur); }
    cur.lines.push(l);
  }

  const blocks = [];
  for (const p of paras) {
    let html = '';
    for (let i = 0; i < p.lines.length; i++) {
      const l = p.lines[i];
      let part = l.runs.map((r) => {
        let t = escapeHtml(r.t);
        if (r.va) t = `<${r.va}>${t.trim()}</${r.va}>`;
        return r.b && !p.lines.every((x) => x.bold) ? `<b>${t}</b>` : t;
      }).join('').replace(/\s+/g, ' ').trim();
      if (i > 0) {
        // перенос слова: «конвер-» + «тация» → «конвертация»
        if (/[a-zа-яё]-$/i.test(html.replace(/<[^>]+>/g, '')) && /^[a-zа-яё]/.test(l.text)) html = html.replace(/-(<\/b>)?$/, '$1');
        else html += ' ';
      }
      html += part;
    }
    const allBold = p.lines.every((x) => x.bold);
    const x0 = Math.min(...p.lines.map((l) => l.x0)), x1 = Math.max(...p.lines.map((l) => l.x1));
    const centered = x0 > left + p.size * 3 && Math.abs((x0 + x1) / 2 - (left + right) / 2) < p.size * 1.5;
    const ratio = p.size / bodySize;
    const text = p.lines.map((l) => l.text).join(' ');
    let tag = 'p';
    if (ratio >= 1.7) tag = 'h1';
    else if (ratio >= 1.35) tag = 'h2';
    else if ((ratio >= 1.12 || allBold) && text.length < 150 && p.lines.length <= 3) tag = 'h3';
    if (tag === 'h3' && allBold && ratio < 1.12 && !/^[\dIVX]+[.)]?\s|^[А-ЯA-Z]/.test(text)) tag = 'p';
    const body = tag === 'p' && allBold ? `<b>${html}</b>` : html;
    const style = centered ? ' style="text-align:center"' : '';
    if (listRe.test(text) && tag === 'p') blocks.push({ y: p.lines[0].y - p.size, html: `<p class="li"${style}>${body}</p>` });
    else blocks.push({ y: p.lines[0].y - p.size, html: `<${tag}${style}>${body}</${tag}>` });
  }

  for (const t of tables) blocks.push({ y: t.y0, html: pdfTableHtml(t) });

  // картинки: положение по матрице преобразования, вырезаем с отрисованной страницы
  const imgs = [];
  if (ops) {
    const OPS = pdfjsLib.OPS;
    const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
    let ctm = [1, 0, 0, 1, 0, 0];
    const stack = [];
    for (let i = 0; i < ops.fnArray.length; i++) {
      const fn = ops.fnArray[i], args = ops.argsArray[i];
      if (fn === OPS.save) stack.push(ctm);
      else if (fn === OPS.restore) ctm = stack.pop() || ctm;
      else if (fn === OPS.transform) ctm = mul(ctm, args);
      else if (fn === OPS.paintFormXObjectBegin) { stack.push(ctm); if (args && args[0]) ctm = mul(ctm, args[0]); }
      else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() || ctm;
      else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject || fn === OPS.paintJpegXObject) {
        const pts = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([u, v]) => [ctm[0] * u + ctm[2] * v + ctm[4], ctm[1] * u + ctm[3] * v + ctm[5]]);
        const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
        const bx = Math.max(0, Math.min(...xs)), by = Math.max(0, H - Math.max(...ys));
        const bw = Math.min(vp.width, Math.max(...xs)) - bx, bh = Math.min(H, H - Math.min(...ys)) - by;
        if (bw < 24 || bh < 24) continue; // значки и линии
        if (bw * bh > vp.width * H * 0.8 && textLines.length > 3) continue; // фон-скан под распознанным текстом
        if (imgs.some((m) => Math.abs(m.x - bx) < 2 && Math.abs(m.y - by) < 2)) continue;
        if (tables.some((t) => bx >= t.x0 - 2 && bx + bw <= t.x1 + 2 && by >= t.y0 - 2 && by + bh <= t.y1 + 2)) continue; // внутри таблицы
        imgs.push({ x: bx, y: by, w: bw, h: bh });
      }
    }
  }
  if (imgs.length) {
    const scale = 2;
    const c = await renderPdfPage(page, vp.width * scale);
    const k = c.width / vp.width;
    for (const m of imgs) {
      const o = document.createElement('canvas');
      o.width = Math.max(1, Math.round(m.w * k)); o.height = Math.max(1, Math.round(m.h * k));
      o.getContext('2d').drawImage(c, m.x * k, m.y * k, m.w * k, m.h * k, 0, 0, o.width, o.height);
      const url = o.width * o.height > 400000 ? o.toDataURL('image/jpeg', 0.9) : o.toDataURL('image/png');
      blocks.push({ y: m.y, html: `<p style="text-align:center"><img src="${url}" width="${Math.round(m.w * 4 / 3)}" height="${Math.round(m.h * 4 / 3)}"></p>` });
    }
    c.width = c.height = 0;
  }
  blocks.sort((p, q) => p.y - q.y);
  return blocks.map((b) => b.html).join('\n');
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

/**
 * PDF → Excel: таблицы восстанавливаются по положению текста на странице —
 * строки по вертикали, колонки по общим левым краям. Каждая страница — отдельный лист.
 */
async function pdfToXlsx(file, onProgress, onStatus) {
  const pdfjs = await getPdfJs();
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), ...PDFJS_OPTS() }).promise;
  await loadLib('xlsx');
  const wb = XLSX.utils.book_new();
  const toCell = (s) => {
    const t = s.replace(/ /g, ' ').trim();
    // «1 200,50» / «-15.5» / «12%» → число, чтобы в Excel можно было считать
    if (/^-?\d{1,3}([  ]\d{3})*([.,]\d+)?$|^-?\d+([.,]\d+)?$/.test(t)) return Number(t.replace(/[  ]/g, '').replace(',', '.'));
    return t;
  };
  let anyText = false, ocrPages = 0;
  for (let p = 1; p <= pdf.numPages; p++) {
    onStatus(`Таблицы: страница ${p} из ${pdf.numPages}…`);
    const page = await pdf.getPage(p);
    const vp = page.getViewport({ scale: 1 });
    let items = (await page.getTextContent()).items
      .filter((it) => it.str && it.str.trim())
      .map((it) => {
        const tx = pdfjs.Util.transform(vp.transform, it.transform);
        const h = Math.hypot(tx[2], tx[3]) || 10;
        return { s: it.str, x: tx[4], y: tx[5], w: (it.width || it.str.length * h * 0.5) * vp.scale, h };
      });
    // линии таблиц: у PDF — из рисования страницы, у скана — с картинки
    let segs = null;
    if (!items.length) {
      // скан: распознаём слова с их положением
      onStatus(`Распознавание таблицы: страница ${p} из ${pdf.numPages}…`);
      const c = await renderPdfPage(page, 2000);
      const k = vp.width / c.width;
      segs = imageSegments(c, k);
      // линии таблицы стираем: иначе распознавание принимает их за «|», «[» и путает цифры рядом
      const g = c.getContext('2d');
      g.fillStyle = '#fff';
      for (const sgm of segs.hs) g.fillRect(sgm.a / k - 1, sgm.y / k - 2, (sgm.b - sgm.a) / k + 2, 4);
      for (const sgm of segs.vs) g.fillRect(sgm.x / k - 2, sgm.a / k - 1, 4, (sgm.b - sgm.a) / k + 2);
      const worker = await getOcrWorker();
      const { data } = await worker.recognize(c, {}, { text: true, blocks: true });
      const words = data.words || (data.blocks || []).flatMap((b) => b.paragraphs.flatMap((pp) => pp.lines.flatMap((l) => l.words)));
      items = words.filter((w) => w.text && w.text.trim() && w.confidence > 25 && !/^[|{}[\]_\-—–=~.:;,'"`]+$/.test(w.text.trim()))
        .map((w) => ({ s: w.text.trim().replace(/^[|[\]{}]+|[|[\]{}]+$/g, ''), x: w.bbox.x0 * k, y: w.bbox.y1 * k, w: (w.bbox.x1 - w.bbox.x0) * k, h: Math.max(4, (w.bbox.y1 - w.bbox.y0) * k) }))
        .filter((it) => it.s);
      c.width = c.height = 0;
      if (items.length) ocrPages++;
    } else {
      try { segs = pdfSegments(await page.getOperatorList(), vp.height); } catch { segs = null; }
    }
    if (!items.length) continue;
    anyText = true;
    // таблицы с рамками → отдельные листы с объединёнными ячейками
    if (segs) {
      const grid = gridTables(segs.hs, segs.vs, items.map((it) => ({ str: it.s, x: it.x, y: it.y, w: it.w, size: it.h, bold: false })));
      if (grid.tables.length) {
        grid.tables.forEach((t, ti) => {
          const aoa = t.rows.map((r) => r.map((c) => (c ? toCell(c.text) : '')));
          const ws = XLSX.utils.aoa_to_sheet(aoa);
          ws['!merges'] = [];
          t.rows.forEach((r, ri) => r.forEach((c, ci) => { if (c && (c.colspan > 1 || c.rowspan > 1)) ws['!merges'].push({ s: { r: ri, c: ci }, e: { r: ri + c.rowspan - 1, c: ci + c.colspan - 1 } }); }));
          // ширины столбцов по самой длинной строке
          ws['!cols'] = (aoa[0] || []).map((_, ci) => ({ wch: Math.min(60, Math.max(6, ...aoa.map((r) => String(r[ci] ?? '').length))) }));
          XLSX.utils.book_append_sheet(wb, ws, grid.tables.length > 1 ? `Стр. ${p} — табл. ${ti + 1}` : `Стр. ${p}`);
        });
        onProgress(p / pdf.numPages);
        continue;
      }
    }
    // строки: элементы с близкой базовой линией
    items.sort((a, b) => a.y - b.y || a.x - b.x);
    const lines = [];
    for (const it of items) {
      const line = lines[lines.length - 1];
      if (line && Math.abs(line.y - it.y) < Math.min(line.h, it.h) * 0.5) line.items.push(it);
      else lines.push({ y: it.y, h: it.h, items: [it] });
    }
    // ячейки: внутри строки склеиваем соседние куски, если промежуток меньше ~1 символа
    const rows = lines.map((l) => {
      const cells = [];
      for (const it of l.items.sort((a, b) => a.x - b.x)) {
        const last = cells[cells.length - 1];
        if (last && it.x - (last.x + last.w) < it.h * 0.9) { last.s += (it.x - (last.x + last.w) > it.h * 0.15 ? ' ' : '') + it.s; last.w = it.x + it.w - last.x; }
        else cells.push({ ...it });
      }
      return cells;
    });
    // колонки: кластеризуем левые края ячеек всех строк
    const xs = rows.flat().map((c) => c.x).sort((a, b) => a - b);
    const cols = [];
    for (const x of xs) { if (!cols.length || x - cols[cols.length - 1].max > 12) cols.push({ min: x, max: x }); else cols[cols.length - 1].max = x; }
    const colOf = (x) => { let best = 0, d = Infinity; cols.forEach((c, i) => { const dd = x < c.min ? c.min - x : x > c.max ? x - c.max : 0; if (dd < d) { d = dd; best = i; } }); return best; };
    const aoa = rows.map((cells) => {
      const r = new Array(cols.length).fill('');
      for (const c of cells) { const i = colOf(c.x); r[i] = r[i] === '' ? toCell(c.s) : `${r[i]} ${c.s}`; }
      return r;
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), `Стр. ${p}`);
    onProgress(p / pdf.numPages);
  }
  if (!anyText) throw new Error('Текст не найден — даже распознавание ничего не нашло.');
  return { blob: new Blob([XLSX.write(wb, { type: 'array', bookType: 'xlsx' })], { type: MIME.xlsx }), ext: 'xlsx', note: `${wb.SheetNames.length} лист(ов)${ocrPages ? `, распознано стр.: ${ocrPages}` : ''}` };
}

/** Фото или скан таблицы → Excel: картинка становится страницей PDF без текста, дальше — распознавание с сеткой */
async function imageToXlsx(file, ext, opts, onProgress, onStatus) {
  const pdf = await convertImage(file, ext, 'pdf', { ...opts, maxWidth: null }, () => {}, onStatus);
  const blob = pdf instanceof Blob ? pdf : pdf.blob;
  return pdfToXlsx(new File([blob], 'scan.pdf'), onProgress, onStatus);
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
      // PDF с текстовым слоем: абзацы, заголовки и картинки по разметке страницы
      if (pg.html) {
        try { const h = await pg.html(); if (h.trim()) { pages.push(h); onProgress(pg.index / pg.total * 0.9); continue; } }
        catch (e) { console.warn('Разметка страницы не удалась, беру просто текст:', e); }
      }
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
        const cs = td.getAttribute('colspan'), rs = td.getAttribute('rowspan'), al = td.getAttribute('align');
        return `<${t}${cs ? ` colspan="${cs}"` : ''}${rs ? ` rowspan="${rs}"` : ''}${al ? ` style="text-align:${al}"` : ''}>${inline(td)}</${t}>`;
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
  html = html.replace(/<mbp:pagebreak\s*\/?>/gi, '<hr class="page">').replace(/<\/?mbp:[^>]*>/gi, '');
  if (!/<(p|div|br|h\d)\b/i.test(html)) return textToHtml(html); // старые PRC — простой текст
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script, style').forEach((x) => x.remove());
  return doc.body.innerHTML;
}

/* ===================== RTF, ODT, PPTX → HTML ===================== */

/** RTF: текст, абзацы, жирный/курсив/подчёркнутый, таблицы (ячейки через табуляцию), кириллица (\'xx и \uN). */
async function rtfToHtml(rtf) {
  // группы, которые не являются текстом документа
  const SKIP = new Set(['fonttbl', 'colortbl', 'stylesheet', 'info', 'header', 'footer', 'headerl', 'headerr', 'headerf', 'footerl', 'footerr', 'footerf',
    'themedata', 'colorschememapping', 'latentstyles', 'datastore', 'xmlnstbl', 'listtable', 'listoverridetable',
    'rsidtbl', 'generator', 'filetbl', 'revtbl', 'listtext', 'pgdsctbl', 'mmathPr', 'fldinst', 'bkmkstart', 'bkmkend', 'shpinst', 'nonshppict', 'objdata', 'footnote', 'annotation', 'pntext']);
  let codepage = 1252;
  const m = rtf.match(/\\ansicpg(\d+)/);
  if (m) codepage = +m[1];
  let dec;
  try { dec = new TextDecoder('windows-' + codepage); } catch { dec = new TextDecoder('windows-1252'); }

  const items = [];      // абзацы { runs, align } и таблицы { rows }
  let runs = [];
  let st = { b: false, i: false, u: false, s: false, va: null, skip: false, uc: 1, align: '', intbl: false, pict: null };
  const stack = [];
  let bytes = [];
  let skipChars = 0;
  // таблица: описание ячеек строки (\cellx и флаги объединения), собранные ячейки, строки
  let rowDefs = [], curDef = {}, rowCells = [], curCell = [], tableRows = null;
  const flushBytes = () => { if (bytes.length) { addText(dec.decode(new Uint8Array(bytes))); bytes = []; } };
  function addText(t) {
    if (st.skip || !t) return;
    if (st.pict) return;
    const last = runs[runs.length - 1];
    if (last && !last.img && last.b === st.b && last.i === st.i && last.u === st.u && last.s === st.s && last.va === st.va) last.t += t;
    else runs.push({ t, b: st.b, i: st.i, u: st.u, s: st.s, va: st.va });
  }
  const closeTable = () => { if (tableRows) { if (rowCells.length) tableRows.push({ cells: rowCells, defs: rowDefs }); items.push({ rows: tableRows }); tableRows = null; rowCells = []; } };
  const endPara = () => {
    flushBytes();
    if (st.intbl) { curCell.push({ runs, align: st.align }); runs = []; return; }
    closeTable();
    items.push({ runs, align: st.align });
    runs = [];
  };
  const endCell = () => {
    flushBytes();
    if (runs.length || !curCell.length) curCell.push({ runs, align: st.align });
    runs = [];
    rowCells.push(curCell);
    curCell = [];
    if (!tableRows) tableRows = [];
  };
  const endRow = () => { flushBytes(); if (!tableRows) tableRows = []; tableRows.push({ cells: rowCells, defs: rowDefs }); rowCells = []; };
  const finishPict = (p) => {
    const hex = p.hex.join('').replace(/[^0-9a-fA-F]/g, '');
    if (!hex || !p.type) return;
    const u8 = new Uint8Array(hex.length >> 1);
    for (let k = 0; k < u8.length; k++) u8[k] = parseInt(hex.substr(k * 2, 2), 16);
    // размер на странице: \picwgoal/\pichgoal в твипах (1/20 pt) с учётом масштаба
    const w = p.wgoal ? p.wgoal / 20 * (p.scalex || 100) / 100 : null, h = p.hgoal ? p.hgoal / 20 * (p.scaley || 100) / 100 : null;
    runs.push({ img: true, type: p.type, data: u8, w, h });
  };

  for (let i = 0; i < rtf.length; i++) {
    const c = rtf[i];
    if (c === '{') { flushBytes(); stack.push({ ...st }); continue; }
    if (c === '}') {
      flushBytes();
      if (st.pict && stack.length === st.pict.depth) { const p = st.pict; st.pict = null; finishPict(p); }
      const prev = stack.pop() || st;
      // свойства абзаца и таблицы живут дольше группы, где их задали
      st = { ...prev, align: st.align, intbl: st.intbl };
      continue;
    }
    if (c === '\r' || c === '\n') continue;
    if (c !== '\\') {
      if (st.pict) { st.pict.hex.push(c); continue; }
      if (skipChars > 0) { flushBytes(); skipChars--; continue; }
      // «сырые» 8-битные символы в RTF записаны в кодировке документа (например, Windows-1251)
      if (c.charCodeAt(0) >= 0x80) { if (!st.skip) bytes.push(c.charCodeAt(0)); continue; }
      flushBytes();
      addText(c);
      continue;
    }
    const n = rtf[i + 1];
    if (n === '\\' || n === '{' || n === '}') { flushBytes(); if (skipChars > 0) skipChars--; else addText(n); i++; continue; }
    if (n === "'") {
      const hex = parseInt(rtf.substr(i + 2, 2), 16);
      i += 3;
      if (skipChars > 0) { skipChars--; continue; }
      if (!st.skip) bytes.push(hex);
      continue;
    }
    if (n === '*') { st.skip = true; i++; continue; }
    if (n === '~') { flushBytes(); addText(' '); i++; continue; }
    if (n === '_') { flushBytes(); addText('-'); i++; continue; }
    if (n === '-') { i++; continue; }
    const w = /^([a-zA-Z]+)(-?\d+)? ?/.exec(rtf.slice(i + 1, i + 40));
    if (!w) { i++; continue; }
    i += w[0].length;
    const word = w[1], arg = w[2] !== undefined ? +w[2] : null;
    if (SKIP.has(word)) { st.skip = true; continue; }
    if (st.pict) {
      const p = st.pict;
      switch (word) {
        case 'pngblip': p.type = 'png'; break;
        case 'jpegblip': p.type = 'jpeg'; break;
        case 'wmetafile': p.type = 'wmf'; break;
        case 'emfblip': p.type = 'emf'; break;
        case 'picwgoal': p.wgoal = arg; break;
        case 'pichgoal': p.hgoal = arg; break;
        case 'picscalex': p.scalex = arg; break;
        case 'picscaley': p.scaley = arg; break;
        case 'bin': i += arg || 0; break;
      }
      continue;
    }
    switch (word) {
      case 'pict': if (!st.skip) st.pict = { hex: [], depth: stack.length }; break;
      case 'par': case 'sect': endPara(); break;
      case 'page': endPara(); closeTable(); items.push({ pageBreak: true }); break;
      case 'line': flushBytes(); addText('\n'); break;
      case 'tab': flushBytes(); addText('\t'); break;
      case 'pard': flushBytes(); st.align = ''; st.intbl = false; break;
      case 'intbl': st.intbl = true; break;
      case 'qc': st.align = 'center'; break;
      case 'qr': st.align = 'right'; break;
      case 'qj': st.align = 'justify'; break;
      case 'ql': st.align = ''; break;
      case 'trowd': rowDefs = []; curDef = {}; break;
      case 'clmgf': curDef.hm = 'first'; break;
      case 'clmrg': curDef.hm = 'cont'; break;
      case 'clvmgf': curDef.vm = 'first'; break;
      case 'clvmrg': curDef.vm = 'cont'; break;
      case 'cellx': rowDefs.push(curDef); curDef = {}; break;
      case 'cell': case 'nestcell': endCell(); break;
      case 'row': case 'nestrow': endRow(); break;
      case 'b': flushBytes(); st.b = arg !== 0; break;
      case 'i': flushBytes(); st.i = arg !== 0; break;
      case 'ul': flushBytes(); st.u = arg !== 0; break;
      case 'ulnone': flushBytes(); st.u = false; break;
      case 'strike': flushBytes(); st.s = arg !== 0; break;
      case 'super': flushBytes(); st.va = 'sup'; break;
      case 'sub': flushBytes(); st.va = 'sub'; break;
      case 'nosupersub': flushBytes(); st.va = null; break;
      case 'plain': flushBytes(); st.b = st.i = st.u = st.s = false; st.va = null; break;
      case 'uc': st.uc = arg ?? 1; break;
      case 'u': {
        flushBytes();
        addText(String.fromCharCode(arg < 0 ? arg + 65536 : arg));
        skipChars = st.uc;
        break;
      }
      case 'emdash': flushBytes(); addText('—'); break;
      case 'endash': flushBytes(); addText('–'); break;
      case 'lquote': case 'rquote': flushBytes(); addText('’'); break;
      case 'ldblquote': flushBytes(); addText('«'); break;
      case 'rdblquote': flushBytes(); addText('»'); break;
      case 'bullet': flushBytes(); addText('•'); break;
      default: break;
    }
  }
  endPara();
  closeTable();

  // картинки → data URL (WMF/EMF — рисуем сами)
  const allRuns = [];
  const collect = (rs) => rs.forEach((r) => r.img && allRuns.push(r));
  for (const it of items) {
    if (it.runs) collect(it.runs);
    if (it.rows) it.rows.forEach((row) => row.cells.forEach((cell) => cell.forEach((p) => collect(p.runs))));
  }
  for (const r of allRuns) {
    if (r.type === 'png' || r.type === 'jpeg') r.url = `data:image/${r.type};base64,${u8ToB64(r.data)}`;
    else if (typeof metafileToPng === 'function') {
      try { r.url = await metafileToPng(r.data.buffer.slice(r.data.byteOffset, r.data.byteOffset + r.data.byteLength), r.type); } catch { r.url = null; }
    }
  }

  const runsHtml = (rs) => rs.map((r) => {
    if (r.img) return r.url ? `<img src="${r.url}"${r.w ? ` width="${Math.round(r.w * 4 / 3)}"` : ''}${r.h ? ` height="${Math.round(r.h * 4 / 3)}"` : ''}>` : '';
    let t = escapeHtml(r.t).replace(/\n/g, '<br>').replace(/\t/g, '&emsp;');
    if (r.va) t = `<${r.va}>${t}</${r.va}>`;
    if (r.s) t = `<s>${t}</s>`;
    if (r.b) t = `<b>${t}</b>`;
    if (r.i) t = `<i>${t}</i>`;
    if (r.u) t = `<u>${t}</u>`;
    return t;
  }).join('');
  const paraHtml = (p) => {
    const inner = runsHtml(p.runs);
    if (!inner.replace(/&emsp;|\s|&nbsp;| /g, '')) return '';
    return p.align ? `<p style="text-align:${p.align}">${inner}</p>` : `<p>${inner}</p>`;
  };
  const tableHtml = (rows) => {
    // объединения: \clmrg — продолжение слева (colspan), \clvmrg — продолжение сверху (rowspan)
    const grid = rows.map((row) => row.cells.map((cell, ci) => ({ html: cell.map((p) => runsHtml(p.runs)).filter((x) => x.trim()).join('<br>'), def: row.defs[ci] || {}, cs: 1, rs: 1, skip: false })));
    grid.forEach((row, ri) => row.forEach((c, ci) => {
      if (c.def.hm === 'cont') { for (let k = ci - 1; k >= 0; k--) if (!row[k].skip) { row[k].cs++; break; } c.skip = true; }
      if (c.def.vm === 'cont') { for (let r = ri - 1; r >= 0; r--) { const up = grid[r][ci]; if (up && !up.skip) { up.rs++; break; } } c.skip = true; }
    }));
    return '<table>' + grid.map((row) => '<tr>' + row.filter((c) => !c.skip).map((c) => `<td${c.cs > 1 ? ` colspan="${c.cs}"` : ''}${c.rs > 1 ? ` rowspan="${c.rs}"` : ''}>${c.html}</td>`).join('') + '</tr>').join('') + '</table>';
  };
  const html = items.map((it) => (it.pageBreak ? '<hr class="page">' : it.rows ? tableHtml(it.rows) : paraHtml(it))).filter(Boolean).join('\n');
  if (!html.replace(/<hr>/g, '').trim()) throw new Error('В RTF не найден текст.');
  return html;
}

const u8ToB64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };

/** ODT (LibreOffice/OpenOffice Writer): заголовки, абзацы, списки, таблицы, жирный/курсив, картинки */
async function odtToHtml(file) {
  await loadLib('jszip');
  const zip = await JSZip.loadAsync(file);
  const content = zip.file('content.xml');
  if (!content) throw new Error('Повреждённый ODT: нет content.xml.');
  const doc = new DOMParser().parseFromString(await content.async('string'), 'application/xml');
  const attr = (el, name) => { for (const a of el.attributes) if (a.localName === name) return a.value; return ''; };
  // автоматические стили: какие из них жирные/курсивные/подчёркнутые
  const styles = {};
  for (const s of doc.getElementsByTagNameNS('*', 'style')) {
    const tp = [...s.children].find((c) => c.localName === 'text-properties');
    const pp = [...s.children].find((c) => c.localName === 'paragraph-properties');
    if (!tp && !pp) continue;
    const al = pp ? attr(pp, 'text-align') : '';
    styles[attr(s, 'name')] = {
      b: !!tp && attr(tp, 'font-weight') === 'bold',
      i: !!tp && attr(tp, 'font-style') === 'italic',
      u: !!tp && !!attr(tp, 'text-underline-style') && attr(tp, 'text-underline-style') !== 'none',
      align: { center: 'center', end: 'right', right: 'right', justify: 'justify' }[al] || '',
    };
  }
  const images = {};
  const inline = async (node) => {
    let out = '';
    for (const n of node.childNodes) {
      if (n.nodeType === 3) { out += escapeHtml(n.textContent); continue; }
      if (n.nodeType !== 1) continue;
      switch (n.localName) {
        case 's': out += ' '.repeat(+attr(n, 'c') || 1); break;
        case 'tab': out += '&emsp;'; break;
        case 'line-break': out += '<br>'; break;
        case 'span': case 'a': {
          let t = await inline(n);
          const s = styles[attr(n, 'style-name')];
          if (s) { if (s.b) t = `<b>${t}</b>`; if (s.i) t = `<i>${t}</i>`; if (s.u) t = `<u>${t}</u>`; }
          out += t;
          break;
        }
        case 'frame': {
          // формула (объект с MathML внутри) — переносим как формулу
          const obj = [...n.children].find((c) => c.localName === 'object');
          const objHref = obj && attr(obj, 'href').replace(/^\.\//, '').replace(/\/$/, '');
          if (objHref && zip.file(`${objHref}/content.xml`)) {
            const mdoc = new DOMParser().parseFromString(await zip.file(`${objHref}/content.xml`).async('string'), 'application/xml');
            const math = mdoc.getElementsByTagNameNS('http://www.w3.org/1998/Math/MathML', 'math')[0];
            if (math) {
              math.querySelectorAll('annotation, annotation-xml').forEach((a) => a.remove());
              out += new XMLSerializer().serializeToString(math);
              break;
            }
          }
          const im = [...n.children].find((c) => c.localName === 'image');
          const href = im && attr(im, 'href');
          if (href) {
            if (!(href in images)) images[href] = await zipDataUrl(zip, href);
            if (images[href]) out += `<img src="${images[href]}">`;
          }
          break;
        }
        case 'note': case 'annotation': case 'bookmark': case 'bookmark-start': case 'bookmark-end': break;
        default: out += await inline(n);
      }
    }
    return out;
  };
  const block = async (node) => {
    let out = '';
    for (const n of node.children) {
      switch (n.localName) {
        case 'h': { const lv = Math.min(+attr(n, 'outline-level') || 1, 6); out += `<h${lv}>${await inline(n)}</h${lv}>\n`; break; }
        case 'p': {
          let t = await inline(n);
          const s = styles[attr(n, 'style-name')];
          if (s) { if (s.b) t = `<b>${t}</b>`; if (s.i) t = `<i>${t}</i>`; }
          out += s && s.align ? `<p style="text-align:${s.align}">${t}</p>\n` : `<p>${t}</p>\n`;
          break;
        }
        case 'list': out += `<ul>${(await Promise.all([...n.children].filter((c) => c.localName === 'list-item').map(async (li) => `<li>${(await block(li)).replace(/<\/?p>/g, '')}</li>`))).join('')}</ul>\n`; break;
        case 'table': {
          const rows = [...n.getElementsByTagNameNS('*', 'table-row')];
          // объединённые ячейки: covered-table-cell пропускаем, у ячейки — colspan/rowspan
          out += '<table>' + (await Promise.all(rows.map(async (r) =>
            '<tr>' + (await Promise.all([...r.children].filter((c) => c.localName === 'table-cell').map(async (c) => {
              const cs = +attr(c, 'number-columns-spanned') || 1, rs = +attr(c, 'number-rows-spanned') || 1;
              const inner = (await block(c)).trim().replace(/^<p>|<\/p>$/g, '').replace(/<\/p>\s*<p[^>]*>/g, '<br>');
              return `<td${cs > 1 ? ` colspan="${cs}"` : ''}${rs > 1 ? ` rowspan="${rs}"` : ''}>${inner}</td>`;
            }))).join('') + '</tr>'))).join('') + '</table>\n';
          break;
        }
        case 'section': case 'text': out += await block(n); break;
        default: break;
      }
    }
    return out;
  };
  const body = doc.getElementsByTagNameNS('*', 'text')[0];
  const html = body ? await block(body) : '';
  if (!html.replace(/<[^>]+>/g, '').trim() && !html.includes('<img')) throw new Error('В ODT не найден текст.');
  return html;
}

/** PPTX (PowerPoint): по слайду — заголовок, текст, таблицы и картинки */
async function pptxToHtml(file, onStatus) {
  await loadLib('jszip');
  const zip = await JSZip.loadAsync(file);
  const xml = async (p) => { const f = zip.file(p); return f ? new DOMParser().parseFromString(await f.async('string'), 'application/xml') : null; };
  const attr = (el, name) => { for (const a of el.attributes) if (a.localName === name) return a.value; return ''; };
  const rels = async (p) => {
    const dir = dirOf(p), name = p.split('/').pop();
    const d = await xml(`${dir}/_rels/${name}.rels`);
    const map = {};
    if (d) for (const r of d.getElementsByTagNameNS('*', 'Relationship')) map[r.getAttribute('Id')] = resolvePath(dir, r.getAttribute('Target'));
    return map;
  };
  const pres = await xml('ppt/presentation.xml');
  if (!pres) throw new Error('Повреждённый PPTX: нет описания презентации.');
  const presRels = await rels('ppt/presentation.xml');
  // у sldId два атрибута с именем id: свой (id) и ссылка (r:id) — нужна ссылка
  const relId = (el) => { for (const a of el.attributes) if (a.localName === 'id' && /relationships/.test(a.namespaceURI || '')) return a.value; return ''; };
  const slides = [...pres.getElementsByTagNameNS('*', 'sldId')].map((s) => presRels[relId(s)]).filter(Boolean);
  if (!slides.length) throw new Error('В презентации нет слайдов.');
  const paraText = (p) => [...p.getElementsByTagNameNS('*', 't')].map((t) => t.textContent).join('');
  const parts = [];
  for (let k = 0; k < slides.length; k++) {
    onStatus(`Слайд ${k + 1} из ${slides.length}…`);
    const path = slides[k];
    const d = await xml(path);
    if (!d) continue;
    const r = await rels(path);
    let title = '';
    const body = [];
    const tree = d.getElementsByTagNameNS('*', 'spTree')[0];
    const walk = async (node) => {
      for (const el of node.children) {
        if (el.localName === 'grpSp') { await walk(el); continue; }
        if (el.localName === 'sp') {
          const ph = el.getElementsByTagNameNS('*', 'ph')[0];
          const isTitle = ph && /title|ctrTitle/i.test(ph.getAttribute('type') || '');
          const ps = [...el.getElementsByTagNameNS('*', 'p')].filter((p) => p.namespaceURI && p.namespaceURI.includes('drawingml'));
          const texts = ps.map(paraText).filter((t) => t.trim());
          if (!texts.length) continue;
          if (isTitle && !title) title = texts.join(' ');
          else if (texts.length > 1) body.push('<ul>' + texts.map((t) => `<li>${escapeHtml(t)}</li>`).join('') + '</ul>');
          else body.push(`<p>${escapeHtml(texts[0])}</p>`);
        } else if (el.localName === 'pic') {
          const blip = el.getElementsByTagNameNS('*', 'blip')[0];
          const target = blip && r[attr(blip, 'embed')];
          const data = target && await zipDataUrl(zip, target);
          if (data && /^data:image\/(png|jpe?g|gif|svg)/.test(data)) body.push(`<p><img src="${data}"></p>`);
        } else if (el.localName === 'graphicFrame') {
          const tbl = el.getElementsByTagNameNS('*', 'tbl')[0];
          if (tbl) body.push('<table>' + [...tbl.getElementsByTagNameNS('*', 'tr')].map((tr) =>
            '<tr>' + [...tr.getElementsByTagNameNS('*', 'tc')].map((tc) => `<td>${escapeHtml([...tc.getElementsByTagNameNS('*', 'p')].map(paraText).join(' '))}</td>`).join('') + '</tr>').join('') + '</table>');
        }
      }
    };
    if (tree) await walk(tree);
    parts.push(`<h2>Слайд ${k + 1}${title ? '. ' + escapeHtml(title) : ''}</h2>\n${body.join('\n')}`);
  }
  return parts.join('\n<hr>\n');
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
      // формулы mammoth выбрасывает — заменяем их метками и возвращаем как MathML
      const prep = typeof docxMathPrepare === 'function' ? await docxMathPrepare(await file.arrayBuffer()) : { buffer: await file.arrayBuffer(), formulas: [] };
      const html = (await mammoth.convertToHtml({ arrayBuffer: prep.buffer }, {
        // рисунки WMF/EMF (схемы, старые формулы) браузер не показывает — рисуем их сами
        convertImage: mammoth.images.imgElement(async (image) => {
          const type = image.contentType || '';
          if (/wmf|emf|x-wmf|x-emf/i.test(type) && typeof metafileToPng === 'function') {
            const png = await metafileToPng(await image.read().then((b) => (b.buffer ? b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) : b)), /emf/i.test(type) ? 'emf' : 'wmf');
            if (png) return { src: png };
          }
          return { src: `data:${type};base64,${await image.read('base64')}` };
        }),
      })).value;
      return docxMathRestore(html, prep.formulas);
    }
    case 'pdf': case 'djvu': return pagesToHtml(file, canon(ext), onProgress, onStatus);
    case 'epub': return epubToHtml(file);
    case 'fb2': return fb2ToHtml(await readText(file));
    case 'mobi': return mobiToHtml(file);
    case 'rtf': return rtfToHtml(new TextDecoder('latin1').decode(new Uint8Array(await file.arrayBuffer())));
    case 'odt': return odtToHtml(file);
    case 'pptx': return pptxToHtml(file, onStatus);
    case 'doc': case 'ppt': return legacyOfficeToHtml(file, ext, onProgress, onStatus);
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

async function htmlToPdfText(html, title, opt = {}) {
  await loadLib('pdfmake');
  await loadLib('pdfmakeFonts');
  await loadLib('htmlToPdfmake');
  const root = document.createElement('div');
  root.innerHTML = html;
  root.querySelectorAll('script, style, link, meta, iframe, object, video, audio, svg, input, button').forEach((n) => n.remove());
  // разрыв страницы (слайды PPT, разрывы в DOC/MOBI) — следующий блок с новой страницы
  for (const hr of [...root.querySelectorAll('hr.page')]) {
    let next = hr.nextElementSibling;
    while (next && next.matches('hr.page')) next = next.nextElementSibling;
    if (next) next.classList.add('pdf-pagebreak-before');
    hr.remove();
  }
  for (const img of [...root.querySelectorAll('img')]) {
    const s = img.getAttribute('src') || '';
    try {
      if (!/^data:image\/(png|jpe?g);base64,/i.test(s)) {
        if (!/^data:image\//i.test(s)) { img.remove(); continue; }
        img.setAttribute('src', await toPngDataUrl(s));
      }
      ['width', 'height', 'style'].forEach((a) => img.removeAttribute(a));
      // запоминаем настоящий размер, чтобы маленькие картинки (формулы, значки) не растягивались на весь лист
      try { const im = await imageFromUrl(img.getAttribute('src')); img.setAttribute('width', String(Math.round(im.naturalWidth * 0.75))); img.setAttribute('height', String(Math.round(im.naturalHeight * 0.75))); } catch { /* размер неизвестен */ }
    } catch { img.remove(); }
  }
  const content = htmlToPdfmake(root.innerHTML, { window });
  // класс pdf-pagebreak-before (html-to-pdfmake кладёт классы в style) → разрыв страницы pdfmake
  const breaks = (n) => {
    if (Array.isArray(n)) { n.forEach(breaks); return; }
    if (!n || typeof n !== 'object') return;
    if ([].concat(n.style || []).includes('pdf-pagebreak-before')) n.pageBreak = 'before';
    ['stack', 'text', 'ul', 'ol', 'columns'].forEach((k) => Array.isArray(n[k]) && breaks(n[k]));
  };
  breaks(content);
  const fit = (n) => {
    if (Array.isArray(n)) { n.forEach(fit); return; }
    if (!n || typeof n !== 'object') return;
    if (n.image) {
      const box = opt.landscape ? [760, 470] : [515, 700];
      const w = parseFloat(n.width), h = parseFloat(n.height);
      delete n.width; delete n.height;
      n.fit = w > 0 && h > 0 ? [Math.min(box[0], w), Math.min(box[1], h)] : box;
    }
    if (n.table) n.table.headerRows = n.table.body && n.table.body.length > 1 ? 1 : 0; // шапка таблицы на каждой странице
    for (const v of Object.values(n)) if (v && typeof v === 'object') fit(v);
  };
  fit(content);
  const dd = {
    info: { title },
    pageSize: 'A4',
    pageOrientation: opt.landscape ? 'landscape' : 'portrait',
    pageMargins: [40, 40, 40, 40],
    content,
    defaultStyle: { font: 'Roboto', fontSize: opt.fontSize || 11, lineHeight: 1.25 },
  };
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('pdfmake timeout')), Math.max(120000, layoutTimeout(JSON.stringify(content).length)));
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
      if (tag === 's' || tag === 'del' || tag === 'strike') f.s = true;
      if (tag === 'sup') f.va = 'superscript';
      if (tag === 'sub') f.va = 'subscript';
      if (tag === 'code' || tag === 'kbd') f.mono = true;
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
      const align = (n.style && n.style.textAlign) || n.getAttribute('align') || '';
      if (/^h[1-6]$/.test(tag)) blocks.push({ style: 'Heading' + Math.min(+tag[1], 3), runs: runsOf(n), align });
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
        const rows = [...n.rows].map((tr) => [...tr.cells].map((td) => ({ runs: runsOf(td), th: td.tagName === 'TH', colspan: Math.max(1, +td.colSpan || 1), rowspan: Math.max(1, +td.rowSpan || 1), align: (td.style && td.style.textAlign) || td.getAttribute('align') || '' })));
        if (rows.length) blocks.push({ table: rows });
      } else if (tag === 'img') {
        if (n.dataset.bc) blocks.push({ runs: [{ img: n.dataset.bc }], align });
      } else if (tag === 'hr') blocks.push({ pageBreak: true });
      else if (tag === 'ul' || tag === 'ol') walk(n, listDepth + 1);
      else if (BLOCK_CONTAINERS.has(tag) && [...n.children].some((c) => BLOCK_TAGS.has(c.tagName.toLowerCase()))) walk(n, listDepth);
      else if (n.textContent.trim() || n.querySelector('img')) blocks.push({ runs: runsOf(n), align });
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
      // размер: из атрибутов (так он задан в исходном документе), иначе по самой картинке
      const aw = parseFloat(img.getAttribute('width')), ah = parseFloat(img.getAttribute('height'));
      const nw = el.naturalWidth || 300, nh = el.naturalHeight || 200;
      const w = aw > 0 ? aw : ah > 0 ? ah * nw / nh : nw, h = ah > 0 ? ah : aw > 0 ? aw * nh / nw : nh;
      images[id] = { id, ext: m[1].toLowerCase() === 'png' ? 'png' : 'jpeg', b64: m[2], w, h };
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
  const rpr = (b.mono || r.mono ? '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/>' : '') +
    (r.b ? '<w:b/>' : '') + (r.i ? '<w:i/>' : '') + (r.s ? '<w:strike/>' : '') + (r.u ? '<w:u w:val="single"/>' : '') +
    (r.va ? `<w:vertAlign w:val="${r.va}"/>` : '');
  return `<w:r>${rpr ? `<w:rPr>${rpr}</w:rPr>` : ''}<w:t xml:space="preserve">${escapeXml(r.text)}</w:t></w:r>`;
}

function docxTable(rows, ctx) {
  // сетка с учётом объединений: colspan → gridSpan, rowspan → vMerge
  const grid = [];
  rows.forEach((r, ri) => {
    grid[ri] = grid[ri] || [];
    let c = 0;
    for (const cell of r) {
      while (grid[ri][c]) c++;
      for (let dr = 0; dr < cell.rowspan; dr++) for (let dc = 0; dc < cell.colspan; dc++) {
        grid[ri + dr] = grid[ri + dr] || [];
        grid[ri + dr][c + dc] = dr === 0 && dc === 0 ? { cell } : { cover: cell, first: dc === 0, origin: dr === 0 };
      }
      c += cell.colspan;
    }
  });
  const cols = Math.max(1, ...grid.map((r) => r.length));
  const border = (s) => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="808080"/>`;
  const jc = (a) => ({ center: 'center', right: 'right', justify: 'both' }[a] || '');
  const cellXml = (c, span, merge) => {
    // абзацы внутри ячейки разделены переводами строки
    const paras = [[]];
    for (const r of (c ? c.runs : [])) { if (r.br) paras.push([]); else paras[paras.length - 1].push(c.th && !r.img ? { ...r, b: true } : r); }
    const al = c && jc(c.align || (c.th ? 'center' : ''));
    const ps = paras.filter((p, i) => p.length || i === 0).map((p) => `<w:p>${al ? `<w:pPr><w:jc w:val="${al}"/></w:pPr>` : ''}${p.map((r) => docxRun(r, {}, ctx)).join('')}</w:p>`).join('');
    return `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/>${span > 1 ? `<w:gridSpan w:val="${span}"/>` : ''}${merge || ''}</w:tcPr>${ps || '<w:p/>'}</w:tc>`;
  };
  const rowXml = (r) => {
    let out = '';
    for (let c = 0; c < cols; c++) {
      const g = r[c];
      if (!g) { out += cellXml(null, 1); continue; }
      if (g.cell) { out += cellXml(g.cell, g.cell.colspan, g.cell.rowspan > 1 ? '<w:vMerge w:val="restart"/>' : ''); c += g.cell.colspan - 1; continue; }
      if (g.first && !g.origin) { out += cellXml(null, g.cover.colspan, '<w:vMerge/>'); c += g.cover.colspan - 1; }
    }
    return out;
  };
  return `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(border).join('')}</w:tblBorders><w:tblCellMar><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr>` +
    `<w:tblGrid>${'<w:gridCol/>'.repeat(cols)}</w:tblGrid>` +
    grid.map((r, i) => `<w:tr>${i === 0 && rows[0] && rows[0].every((c) => c.th) ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}${rowXml(r)}</w:tr>`).join('') +
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
  const jc = { center: 'center', right: 'right', justify: 'both' }[b.align];
  if (jc) ppr.push(`<w:jc w:val="${jc}"/>`);
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
      if (r.va === 'superscript') t = `<sup>${t}</sup>`;
      if (r.va === 'subscript') t = `<sub>${t}</sub>`;
      if (r.s) t = `<strikethrough>${t}</strikethrough>`;
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
        // объединённые ячейки FB2 понимает так же, как HTML
        return `<${t}${c.colspan > 1 ? ` colspan="${c.colspan}"` : ''}${c.rowspan > 1 ? ` rowspan="${c.rowspan}"` : ''}>${inline(c.runs)}</${t}>`;
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
  if (c === 'pdf' && target === 'xlsx') return pdfToXlsx(file, onProgress, onStatus);
  if (c === 'djvu' && target === 'pdf' && !htmlOverride) return pagesToPdf(file, c, opts, onProgress, onStatus);
  // DOCX → PDF/картинки: вёрстка прямо по разметке Word (поля, отступы, таблицы, шрифты как в документе)
  if (c === 'docx' && !htmlOverride && ['pdf', 'png', 'jpg'].includes(target)) {
    try {
      const { blob, skippedImages } = await docxToPdf(file, onStatus);
      const warn = skippedImages ? `⚠ не перенесено картинок: ${skippedImages} (формат EMF/WMF)` : undefined;
      if (target === 'pdf') return warn ? { blob, ext: 'pdf', warn } : blob;
      return pagesToImages(new File([blob], `${title}.pdf`), 'pdf', target, opts, onProgress, onStatus);
    } catch (e) {
      console.warn('Прямая вёрстка DOCX не удалась, делаю через HTML:', e);
    }
  }

  // «DOCX по ГОСТ»: сначала DOCX (из Word — как есть, из остального — через текст), затем оформление
  if (target === 'gost') {
    let docxBlob = c === 'docx' && !htmlOverride ? file : null;
    if (!docxBlob) {
      let h = htmlOverride ?? await docToHtml(file, ext, onProgress, onStatus);
      if (typeof mathToImages === 'function') h = await mathToImages(h);
      docxBlob = await htmlToDocx(h);
    }
    onStatus('Оформление по ГОСТ…');
    return { blob: await docxToGost(docxBlob), ext: 'docx', suffix: ' (ГОСТ)', note: 'поля 30/15/20/20, Times New Roman 14, интервал 1,5' };
  }

  // htmlOverride — текст, отредактированный пользователем в конвертере
  let html = htmlOverride ?? await docToHtml(file, ext, onProgress, onStatus);
  // формулы: в HTML остаются настоящими (MathML), в TXT/Markdown — линейной записью, в остальных — картинками
  if (typeof mathToImages === 'function' && /<math[\s>]/i.test(html)) {
    if (target === 'txt' || target === 'md') html = mathToLinear(html);
    else if (target !== 'html') { onStatus('Формулы…'); html = await mathToImages(html); }
  }
  // Word, RTF, ODT, книги… → JPG/PNG: сначала PDF, затем его страницы картинками
  if (target === 'png' || target === 'jpg') {
    onStatus('Вёрстка страниц…');
    const pdf = await htmlToPdf(html, title);
    return pagesToImages(new File([pdf], `${title}.pdf`), 'pdf', target, opts, onProgress, onStatus);
  }
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
    case 'pdf':
      onStatus('Создание PDF…');
      // слайды старого PowerPoint — на альбомных листах
      if (c === 'ppt') return htmlToPdfText(html, title, { landscape: true }).catch(() => htmlToPdf(html, title));
      return htmlToPdf(html, title);
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

/** Перекодирование видео (WEBM или MP4) записью воспроизведения — идёт в реальном времени */
async function recordVideo(file, target, onProgress, trim) {
  if (!window.MediaRecorder) throw new Error('Этот браузер не поддерживает запись видео.');
  const mime = recordable(target === 'mp4' ? MP4_TYPES : WEBM_TYPES);
  if (!mime) throw new Error(`Этот браузер не умеет сохранять видео в ${target.toUpperCase()}${target === 'mp4' ? ' — выберите WEBM или откройте сайт в Chrome/Edge/Safari' : ''}.`);

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
    const from = trim ? trim.start : 0;
    video.currentTime = from;
    await new Promise((r) => { video.onseeked = r; });

    const stream = new MediaStream([...cap.getVideoTracks(), ...dest.stream.getAudioTracks()]);
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4_000_000 });
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const done = new Promise((r) => { rec.onstop = r; });

    const stop = () => { video.pause(); if (rec.state !== 'inactive') rec.stop(); };
    video.ontimeupdate = () => {
      const end = trim && trim.end ? trim.end : video.duration;
      if (isFinite(end)) onProgress((video.currentTime - from) / Math.max(0.1, end - from));
      if (trim && trim.end && video.currentTime >= trim.end) stop();
    };
    video.onended = stop;
    rec.start(1000);
    await video.play();
    await done;
    return new Blob(chunks, { type: MIME[target] });
  } finally {
    video.pause();
    URL.revokeObjectURL(url);
    if (actx) actx.close();
  }
}

/** Открыть видео для покадрового чтения; узнаёт длительность даже у WEBM без неё */
async function openVideo(file) {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = url;
  await new Promise((res, rej) => {
    video.onloadeddata = res;
    video.onerror = () => rej(new Error('Браузер не может открыть это видео (кодек не поддерживается).'));
  });
  // у WEBM, записанных браузером, длительность неизвестна (Infinity) — узнаём её перемоткой в самый конец
  if (!isFinite(video.duration)) {
    video.currentTime = 1e7;
    await new Promise((r) => { video.onseeked = r; setTimeout(r, 3000); });
    video.currentTime = 0;
    await new Promise((r) => { video.onseeked = r; setTimeout(r, 3000); });
  }
  const dur = isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
  const seek = (t) => new Promise((r) => { video.onseeked = r; video.currentTime = Math.min(t, Math.max(0, dur - 0.01)); });
  return { video, dur, seek, close: () => URL.revokeObjectURL(url) };
}

/** Видео → анимированный GIF: 10 кадров/с, ширина до 480 px, не длиннее 30 секунд */
async function videoToGif(file, onProgress, onStatus, trim) {
  const v = await openVideo(file);
  try {
    const MAX_SEC = 30, FPS = 10;
    const from = trim ? trim.start : 0;
    const to = Math.min(trim && trim.end ? trim.end : (v.dur || MAX_SEC), from + MAX_SEC);
    const k = Math.min(1, 480 / (v.video.videoWidth || 480));
    const w = Math.max(2, Math.round((v.video.videoWidth || 480) * k)), h = Math.max(2, Math.round((v.video.videoHeight || 270) * k));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    const frames = [];
    const total = Math.max(1, Math.floor((to - from) * FPS));
    for (let f = 0; f < total; f++) {
      await v.seek(from + f / FPS);
      ctx.drawImage(v.video, 0, 0, w, h);
      frames.push(ctx.getImageData(0, 0, w, h));
      onStatus(`Кадр ${f + 1} из ${total}…`);
      onProgress((f + 1) / total * 0.85);
    }
    onStatus('Сборка GIF…');
    const blob = await encodeGIF(frames, w, h, 100 / FPS);
    const cut = (trim && trim.end ? trim.end : v.dur) - from > MAX_SEC;
    return { blob, ext: 'gif', note: cut ? `${MAX_SEC} с (GIF длиннее не бывает разумного размера)` : '' };
  } finally { v.close(); }
}

/** Видео → кадры JPG в ZIP: по кадру в секунду (для коротких — чаще), не больше 300 кадров */
async function videoFrames(file, onProgress, onStatus, opts) {
  const v = await openVideo(file);
  try {
    const trim = opts.trim;
    const from = trim ? trim.start : 0;
    const to = trim && trim.end ? trim.end : v.dur;
    if (!(to > from)) throw new Error('Не удалось определить длительность видео.');
    const step = to - from <= 10 ? 0.5 : 1;
    const total = Math.min(300, Math.floor((to - from) / step) + 1);
    const c = document.createElement('canvas');
    c.width = v.video.videoWidth; c.height = v.video.videoHeight;
    const ctx = c.getContext('2d');
    await loadLib('jszip');
    const zip = new JSZip();
    const base = baseOf(file.name);
    for (let f = 0; f < total; f++) {
      const t = from + f * step;
      await v.seek(t);
      ctx.drawImage(v.video, 0, 0, c.width, c.height);
      const mm = String(Math.floor(t / 60)).padStart(2, '0'), ss = (t % 60).toFixed(1).padStart(4, '0').replace('.', ',');
      zip.file(`${base}_${mm}-${ss}.jpg`, await canvasToBlob(c, 'image/jpeg', opts.quality || 0.9));
      onStatus(`Кадр ${f + 1} из ${total}…`);
      onProgress((f + 1) / total * 0.9);
    }
    return { blob: await zip.generateAsync({ type: 'blob' }), ext: 'zip', note: `${total} кадров` };
  } finally { v.close(); }
}

/** Вырезать фрагмент звука [start, end) секунд */
function sliceAudio(buf, start, end) {
  const a = Math.max(0, Math.floor(start * buf.sampleRate));
  const b = Math.min(buf.length, end ? Math.floor(end * buf.sampleRate) : buf.length);
  if (b <= a) throw new Error('Неверный отрезок: конец раньше начала.');
  const chans = Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c).subarray(a, b));
  return { numberOfChannels: buf.numberOfChannels, sampleRate: buf.sampleRate, length: b - a, getChannelData: (c) => chans[c] };
}

async function convertMedia(file, ext, target, opts, onProgress, onStatus = () => {}) {
  const trim = opts.trim || null;
  if (target === 'webm' || target === 'mp4') return recordVideo(file, target, onProgress, trim);
  if (target === 'gif') return videoToGif(file, onProgress, onStatus, trim);
  if (target === 'frames') return videoFrames(file, onProgress, onStatus, opts);
  let buf = await decodeAudio(file);
  if (trim) buf = sliceAudio(buf, trim.start, trim.end);
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
  OFFICE_NOT_INSTALLED: 'На компьютере не найден Microsoft Office.',
  OFFICE_BLOCKED: 'Word/PowerPoint показал вопрос на экране компьютера и ждёт ответа. Ответьте на него (лучше отметить «Не показывать это сообщение») и повторите.',
  OFFICE_FAILED: 'Office не смог открыть или сохранить файл (повреждён или защищён паролем?).',
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
  if (!r.ok) throw new Error(serverError(await r.text()));
  return { data: await r.arrayBuffer(), headers: r.headers };
}

/**
 * Сборки (A3D) и чертежи ссылаются на файлы деталей. Поэтому вместе с основным файлом
 * отправляем все CAD-файлы из той же папки/архива — КОМПАС найдёт их рядом.
 */
// Что Office (Word/PowerPoint) на компьютере владельца делает точнее браузера
const OFFICE_EXACT = { doc: ['pdf', 'docx', 'rtf', 'odt', 'txt'], ppt: ['pdf', 'pptx', 'jpg'], pptx: ['pdf', 'jpg'], docx: ['pdf'], rtf: ['pdf'], odt: ['pdf'] };
// Что умеет браузер сам — запасной путь, если Office занят, задал вопрос или не установлен
const BROWSER_OK = { doc: ['pdf', 'docx', 'txt'], ppt: ['pdf'], pptx: ['pdf', 'jpg'], docx: ['pdf'], rtf: ['pdf'], odt: ['pdf'] };
// Word/PowerPoint ждёт ответа на вопрос на экране — полчаса не обращаемся к этой программе,
// чтобы не ждать каждый раз (запоминается и после перезагрузки страницы)
const officeApp = (c) => (['ppt', 'pptx'].includes(c) ? 'powerpoint' : 'word');
const officeBlocked = (app) => { try { return Date.now() < +(localStorage.getItem('bcOfficeBlocked_' + app) || 0); } catch { return false; } };
const setOfficeBlocked = (app) => { try { localStorage.setItem('bcOfficeBlocked_' + app, String(Date.now() + 30 * 60 * 1000)); } catch { /* приватный режим */ } };

/** Документы: старые DOC/PPT и слайды PPTX — сначала через Office (если есть), иначе или при сбое — в браузере */
async function convertDocument(item, opts, onProgress, onStatus) {
  const { file, ext, target } = item;
  const c = canon(ext);
  const browser = () => (c === 'pptx' && (target === 'pdf' || target === 'jpg') && !item.editedHtml
    ? slidesConvert(file, target, opts, onProgress, onStatus)
    : convertDoc(file, ext, target, opts, onProgress, onStatus, item.editedHtml));
  const app = officeApp(c);
  const canBrowser = (BROWSER_OK[c] || []).includes(target);
  const viaOffice = pcFeatures && officeAvailable && !item.editedHtml && (OFFICE_EXACT[c] || []).includes(target) && !(canBrowser && officeBlocked(app));
  if (!viaOffice) return browser();
  try {
    return await convertOffice(item, onStatus);
  } catch (e) {
    if (e && e.message === SERVER_ERRORS.OFFICE_BLOCKED) setOfficeBlocked(app);
    if (!canBrowser) throw e;
    console.warn('Office не справился — конвертирую в браузере:', e);
    onStatus('Office не ответил — конвертирую в браузере…');
    if (item.el) setProgress(item, null);
    const r = await browser();
    // DOCX браузер верстает почти как Word; у старых форматов оформление проще
    const warn = c === 'docx' ? 'ℹ Word не ответил — PDF собран в BullConvert' : '⚠ без Office: оформление упрощённое';
    return r instanceof Blob ? { blob: r, ext: target, warn } : { ...r, warn: r.warn ? `${r.warn}; ${warn}` : warn };
  }
}

/** DOC, PPT и точная PPTX → PDF через установленный на компьютере владельца Microsoft Office */
async function convertOffice(item, onStatus) {
  const { file, ext, target } = item;
  onStatus(`Конвертация через Microsoft ${['ppt', 'pptx'].includes(canon(ext)) ? 'PowerPoint' : 'Word'}…`);
  const { data } = await serverPost(`/api/office?from=${encodeURIComponent(ext)}&to=${encodeURIComponent(target)}`, file);
  if (target === 'jpg') return { blob: new Blob([data], { type: MIME.zip }), ext: 'zip', note: 'слайды в ZIP' };
  const types = { rtf: 'application/rtf', odt: 'application/vnd.oasis.opendocument.text', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' };
  return new Blob([data], { type: MIME[target] || types[target] || 'application/octet-stream' });
}

/** Чертёж: DXF — в браузере (везде) или через КОМПАС (на компьютере владельца, с запасным путём) */
async function convertDrawing(item, opts, onStatus) {
  const { file, ext, target } = item;
  const inBrowser = ext === 'dxf' && typeof dxfConvert === 'function' && ['pdf', 'svg', 'png', 'jpg'].includes(target);
  if (inBrowser && (!pcFeatures || target === 'svg')) return dxfConvert(file, target, opts, onStatus);
  try { return await convertCad(item, onStatus); }
  catch (e) {
    if (!inBrowser) throw e;
    console.warn('КОМПАС не справился, рисую DXF в браузере:', e);
    const blob = await dxfConvert(file, target, opts, onStatus);
    return { blob, ext: target, warn: '⚠ без КОМПАС: нарисовано в браузере' };
  }
}

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
  // формат, выбранный в прошлый раз для такого типа файла
  const remembered = rememberedTarget(ext);
  item.target = (remembered && item.targets.includes(remembered) ? remembered : item.targets[0]) || null;
}

/* ---- запоминание форматов и шаблон имени ---- */
function rememberedTarget(ext) {
  try { return (JSON.parse(localStorage.getItem('bcTargets') || '{}'))[canon(ext)] || null; } catch { return null; }
}
function rememberTarget(ext, t) {
  try { const m = JSON.parse(localStorage.getItem('bcTargets') || '{}'); m[canon(ext)] = t; localStorage.setItem('bcTargets', JSON.stringify(m)); } catch { /* приватный режим */ }
}
/** Имя результата по шаблону: {имя}, {дата}, {номер}, {формат} */
function outputName(item, ext) {
  let tpl = '{имя}';
  try { tpl = localStorage.getItem('bcNameTpl') || '{имя}'; } catch { /* приватный режим */ }
  const d = new Date();
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const n = String(Math.max(1, items.indexOf(item) + 1)).padStart(String(items.length).length, '0');
  const name = tpl.replace(/\{имя\}|\{name\}/gi, item.outBase).replace(/\{дата\}|\{date\}/gi, date).replace(/\{номер\}|\{n\}/gi, n).replace(/\{формат\}|\{ext\}/gi, ext.toUpperCase())
    .replace(/[\\/:*?"<>|]+/g, '_').trim();
  return name || item.outBase;
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
    const l = b.dataset.l;
    if (l === 'doc') openDocEditor(item);
    else if (l === 'translate') translateItem(item);
    else if (l === 'img') openImageEditor(item);
    else if (l === 'media') openTrim(item);
    else if (l === 'share') shareResult(item.result);
    else openTools(l, item.file);
  };
  info.append(name, meta, links, progress);

  const arrow = document.createElement('span');
  arrow.className = 'arrow';
  arrow.textContent = '→';

  const target = document.createElement('select');
  target.className = 'target';
  target.onchange = () => { item.target = target.value; rememberTarget(item.ext, item.target); item.status = 'idle'; item.result = null; refreshRow(item); updateToolbar(); };

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
  if (item.targets.length) for (const t of item.targets) sel.add(new Option(targetLabel(t), t));
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
  if (item.cat === 'doc' && item.ext) L.push(['doc', '✏ Редактировать текст'], ['translate', item.translated ? `🌐 Переведено (${item.translated})` : '🌐 Перевести']);
  if (item.ext === 'pdf') L.push(['pages', '🛠 Страницы'], ['compress', '🗜 Сжать'], ['edit', '✍ Текст/подпись'], ['stamp', '# Номера/знак'], ['protect', '🔒 Пароль'], ['redact', '⬛ Скрыть данные']);
  if (item.cat === 'image' && item.ext) L.push(['img', item.editedImage ? '✂ Изменить фото (изменено)' : '✂ Обрезать, повернуть, сжать']);
  if (item.cat === 'media' && item.ext) L.push(['media', item.trim ? `✂ Обрезка ${fmtTime(item.trim.start)}–${item.trim.end ? fmtTime(item.trim.end) : 'конец'}` : '✂ Обрезать']);
  if (item.status === 'done' && canShareFiles()) L.push(['share', '📤 Поделиться']);
  const sig = L.map((x) => x.join(':')).join('|');
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

/** Любой поддерживаемый файл → нужный формат без строки в списке (для инструментов: «Всё в один PDF» и др.) */
async function convertFileTo(file, target, onStatus = () => {}) {
  const item = { file, path: '', depth: 0, status: 'idle' };
  await identify(item);
  if (!item.cat || item.cat === 'archive' || !item.targets.includes(target)) {
    throw new Error(`«${file.name}»: этот файл нельзя перевести в ${target.toUpperCase()}.`);
  }
  item.target = target;
  const opts = getOptions(), onProgress = () => {};
  let res;
  if (target === 'spdf') res = await searchablePdf(file, canon(item.ext), onProgress, onStatus);
  else if (item.cat === 'image' && target === 'xlsx') res = await imageToXlsx(file, canon(item.ext), opts, onProgress, onStatus);
  else switch (item.cat) {
    case 'image': res = await convertImage(file, canon(item.ext), target, opts, onProgress, onStatus); break;
    case 'data': res = await convertData(file, item.ext, target); break;
    case 'doc': res = await convertDocument(item, opts, onProgress, onStatus); break;
    case 'media': res = await convertMedia(file, item.ext, target, opts, onProgress, onStatus); break;
    case 'cad': res = await convertDrawing(item, opts, onStatus); break;
  }
  return res instanceof Blob ? res : res.blob;
}

async function convertItem(item) {
  if (!item.cat || !item.target || item.status === 'work' || item.cat === 'archive') return;
  item.status = 'work';
  item.workText = (item.target === 'webm' || item.target === 'mp4') ? 'Запись видео в реальном времени — не закрывайте вкладку…' : 'Конвертация…';
  refreshRow(item);
  setProgress(item, null);
  const onProgress = (p) => setProgress(item, p);
  const onStatus = (text) => { item.workText = text; item.el.meta.textContent = text; };
  const opts = { ...getOptions(), trim: item.trim || null };
  if (item.maxKB) opts.maxKB = item.maxKB;
  const { file, ext, target } = item;
  try {
    let res;
    if (target === 'spdf') {
      const src = item.editedImage ? new File([item.editedImage], item.outBase + '.png', { type: 'image/png' }) : file;
      res = await searchablePdf(src, item.editedImage ? 'png' : canon(ext), onProgress, onStatus);
    } else if (item.cat === 'image' && target === 'xlsx') {
      const src = item.editedImage ? new File([item.editedImage], item.outBase + '.png', { type: 'image/png' }) : file;
      res = await imageToXlsx(src, item.editedImage ? 'png' : canon(ext), opts, onProgress, onStatus);
    } else switch (item.cat) {
      case 'image':
        // фото, отредактированное в конвертере (обрезка, поворот, размер, фон), хранится как PNG
        res = item.editedImage
          ? await convertImage(new File([item.editedImage], item.outBase + '.png', { type: 'image/png' }), 'png', target, opts, onProgress, onStatus)
          : await convertImage(file, canon(ext), target, opts, onProgress, onStatus);
        break;
      case 'data':  res = await convertData(file, ext, target); break;
      case 'doc': res = await convertDocument(item, opts, onProgress, onStatus); break;
      case 'media': res = await convertMedia(file, ext, target, opts, onProgress, onStatus); break;
      case 'cad':   res = await convertDrawing(item, opts, onStatus); break;
    }
    const blob = res instanceof Blob ? res : res.blob;
    const outExt = res instanceof Blob ? target : res.ext;
    item.result = { blob, name: `${outputName(item, outExt)}${res.suffix || ''}.${outExt}`, path: item.path, note: res.note, warn: res.warn };
    item.status = 'done';
    if (typeof addHistory === 'function') addHistory(item.result).catch(() => {});
    if (typeof statsConvert === 'function') statsConvert(target);
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
  for (const t of Object.keys(counts).sort((a, b) => counts[b] - counts[a])) sel.add(new Option(`${targetLabel(t)} (${counts[t]})`, t));
  sel.value = counts[prev] ? prev : '';
  sel.hidden = Object.keys(counts).length === 0;
}

$('bulkTarget').onchange = (e) => {
  const t = e.target.value;
  if (!t) return;
  for (const i of items) {
    if (i.status === 'work' || !i.targets || !i.targets.includes(t) || i.target === t) continue;
    i.target = t; i.el.target.value = t; i.status = 'idle'; i.result = null;
    rememberTarget(i.ext, t);
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

// значок «Поделиться» как в Safari на iPhone: квадрат, открытый сверху, со стрелкой вверх
const IOS_SHARE_ICON = `<svg class="ios-share" viewBox="0 0 24 24" aria-label="Поделиться" role="img">
  <path d="M8.5 9.5H6.75A1.75 1.75 0 0 0 5 11.25v8A1.75 1.75 0 0 0 6.75 21h10.5A1.75 1.75 0 0 0 19 19.25v-8a1.75 1.75 0 0 0-1.75-1.75H15.5"/>
  <path d="M12 3v11.5M8.25 6.75 12 3l3.75 3.75"/></svg>`;

function installHelpHtml() {
  if (isIOS) {
    return `<ol class="steps"><li>Откройте эту страницу в <b>Safari</b>.</li>
      <li>Нажмите <b>«Поделиться»</b> ${IOS_SHARE_ICON} внизу экрана.</li>
      <li>Выберите <b>На экран «Домой»</b> → <b>Добавить</b>.</li></ol>
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
    <p class="muted"><b>iPhone:</b> Safari → «Поделиться» ${IOS_SHARE_ICON} → На экран «Домой». <b>Android:</b> Chrome → меню ⋮ → «Добавить на главный экран».</p>
    <p class="muted">Компьютер должен быть включён, а BullConvert — запущен (он стартует вместе с Windows).</p>`;
};

/* ---- Работа без интернета: заранее скачать все модули в кэш приложения ---- */

async function prepareOffline() {
  const out = $('offlineMsg');
  const btn = $('offlineBtn');
  btn.disabled = true;
  const sw = 'serviceWorker' in navigator && navigator.serviceWorker.controller;
  // просим браузер не удалять скачанные модули при нехватке места
  try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch { /* не поддерживается */ }
  try {
    const names = Object.keys(CDN).filter((k) => k !== 'pdfjsWorker');
    for (let i = 0; i < names.length; i++) {
      out.textContent = `Скачиваю модули: ${i + 1} из ${names.length}…`;
      try { if (names[i] === 'pdfjs') await getPdfJs(); else await loadLib(names[i]); } catch { /* модуль не критичен */ }
    }
    // шрифты для точного PDF из Word (как Times New Roman, Arial, Calibri, Courier)
    if (typeof docxFontUrl === 'function') {
      const fonts = Object.keys(DOCX_FONTS).flatMap((fam) => Object.keys(DOCX_FONT_STYLES).map((st) => docxFontUrl(fam, st)));
      for (let i = 0; i < fonts.length; i++) {
        out.textContent = `Скачиваю шрифты документов: ${i + 1} из ${fonts.length}…`;
        try { await fetch(fonts[i]); } catch { /* шрифт не критичен */ }
      }
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

/* ---- Администратор: кнопка и счётчик посетителей за сегодня (только на этом компьютере) ---- */

async function pollAdmin() {
  try {
    const r = await fetch('/api/admin/state', { headers: { 'X-BC-Admin': '1' }, cache: 'no-store' });
    if (!r.ok) return;
    const s = await r.json();
    $('adminBtn').hidden = false;
    // счётчик посетителей за сегодня: публичный сайт + этот компьютер
    const b = $('adminBadge');
    const t = s.today || {};
    const n = (t.local || 0) + (t.site || 0);
    b.hidden = false;
    b.classList.add('visitors');
    b.textContent = `👁 ${n}`;
    $('adminBtn').title = `Посетителей сегодня: ${n}` + (t.site == null ? ' (только этот компьютер — подключите ключ GoatCounter, чтобы видеть публичный сайт)' : ` — сайт ${t.site}, этот компьютер ${t.local || 0}`);
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
    officeAvailable = !!st.office && !TEST_MODE;
    document.body.classList.add('pc');
    // файлы, добавленные до ответа сервера, определяем заново
    for (const it of items) {
      if (it.status === 'work') continue;
      if (it.cat) {
        if (['doc', 'ppt'].includes(canon(it.ext))) { it.targets = targetsFor(it.cat, it.ext); rebuildTargets(it); }
        continue;
      }
      await identify(it); rebuildTargets(it); refreshRow(it);
      if (it.cat === 'archive') unpack(it);
    }
    updateToolbar();
  } catch { /* сервера нет — только браузерные форматы */ }
})();

autoConnect();
