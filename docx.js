'use strict';

/* BullConvert — DOCX → PDF напрямую по разметке Word (без перевода в HTML).
   Сохраняет: поля и размер страницы, отступы, интервалы, пустые строки, выравнивание, шрифты
   (Times New Roman/Arial/Calibri/Courier — метрически совместимыми Tinos/Arimo/Carlito/Cousine),
   жирный/курсив/подчёркивание, верхние/нижние индексы, символы шрифта Symbol, списки,
   таблицы (ширины столбцов, высоты строк, объединения, границы каждой ячейки, заливку),
   картинки, разрывы страниц, колонтитулы с номерами страниц и сноски. */

const DOCX_FONTS = {
  Tinos: { pkg: 'tinos@0.4.2', base: 'Tinos' },
  Arimo: { pkg: 'arimo@0.4.3', base: 'Arimo' },
  Carlito: { pkg: 'carlito@0.4.1', base: 'Carlito' },
  Cousine: { pkg: 'cousine@0.4.3', base: 'Cousine' },
};
const DOCX_FONT_STYLES = { normal: '400Regular', bold: '700Bold', italics: '400Regular_Italic', bolditalics: '700Bold_Italic' };
const docxFontUrl = (fam, style) => {
  const f = DOCX_FONTS[fam], s = DOCX_FONT_STYLES[style];
  return `vendor/npm/@expo-google-fonts/${f.pkg}/${s}/${f.base}_${s}.ttf`;
};

/** Название шрифта Word → шрифт PDF с такими же размерами букв */
function docxPdfFont(name) {
  const n = (name || '').toLowerCase();
  if (/courier|consolas|mono|lucida console|cousine/.test(n)) return 'Cousine';
  if (/calibri|carlito|candara|corbel|cambria math/.test(n)) return 'Carlito';
  if (/arial|helvetica|verdana|tahoma|segoe|trebuchet|franklin|liberation sans|arimo|sans|gothic|roboto|open sans|pt sans/.test(n)) return 'Arimo';
  return 'Tinos'; // Times New Roman, Baltica, Cambria, Georgia и прочие шрифты с засечками
}

// Шрифт Symbol: латинские буквы рисуются греческими, часть кодов — математическими знаками
const SYMBOL_MAP = (() => {
  const m = {};
  const greek = 'ΑΒΧΔΕΦΓΗΙϑΚΛΜΝΟΠΘΡΣΤΥςΩΞΨΖ';
  const latin = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  for (let i = 0; i < 26; i++) { m[latin[i]] = greek[i]; m[latin[i].toLowerCase()] = greek[i].toLowerCase(); }
  Object.assign(m, { j: 'φ', f: 'φ', J: 'ϑ', v: 'ϖ', V: 'ς', q: 'θ', c: 'χ', h: 'η', y: 'ψ', w: 'ω', x: 'ξ', z: 'ζ', u: 'υ', l: 'λ', m: 'μ', n: 'ν', p: 'π', r: 'ρ', s: 'σ', t: 'τ', e: 'ε', d: 'δ', g: 'γ', b: 'β', a: 'α', k: 'κ', i: 'ι', o: 'ο', C: 'Χ', Q: 'Θ', W: 'Ω', X: 'Ξ', Y: 'Ψ', F: 'Φ', U: 'Υ' });
  const codes = {
    0x22: '∀', 0x24: '∃', 0x27: '∋', 0x2A: '∗', 0x2D: '−', 0x40: '≅', 0x5C: '∴', 0x5E: '⊥', 0x60: '‾', 0x7E: '∼',
    0xA1: 'ϒ', 0xA2: '′', 0xA3: '≤', 0xA4: '⁄', 0xA5: '∞', 0xA6: 'ƒ', 0xA7: '♣', 0xA8: '♦', 0xA9: '♥', 0xAA: '♠',
    0xAB: '↔', 0xAC: '←', 0xAD: '↑', 0xAE: '→', 0xAF: '↓', 0xB0: '°', 0xB1: '±', 0xB2: '″', 0xB3: '≥', 0xB4: '×',
    0xB5: '∝', 0xB6: '∂', 0xB7: '•', 0xB8: '÷', 0xB9: '≠', 0xBA: '≡', 0xBB: '≈', 0xBC: '…', 0xBF: '↵', 0xC0: 'ℵ',
    0xC1: 'ℑ', 0xC2: 'ℜ', 0xC3: '℘', 0xC4: '⊗', 0xC5: '⊕', 0xC6: '∅', 0xC7: '∩', 0xC8: '∪', 0xC9: '⊃', 0xCA: '⊇',
    0xCB: '⊄', 0xCC: '⊂', 0xCD: '⊆', 0xCE: '∈', 0xCF: '∉', 0xD0: '∠', 0xD1: '∇', 0xD2: '®', 0xD3: '©', 0xD4: '™',
    0xD5: '∏', 0xD6: '√', 0xD7: '⋅', 0xD8: '¬', 0xD9: '∧', 0xDA: '∨', 0xDB: '⇔', 0xDC: '⇐', 0xDD: '⇑', 0xDE: '⇒',
    0xDF: '⇓', 0xE0: '◊', 0xE1: '〈', 0xE5: '∑', 0xF1: '〉', 0xF2: '∫',
  };
  for (const [k, v] of Object.entries(codes)) m[String.fromCharCode(+k)] = v;
  return m;
})();
const WINGDINGS_MAP = { '§': '▪', 'Ø': '➢', 'ü': '✓', 'û': '✗', 'q': '❑', 'v': '❖', 'n': '■', 'l': '●', 'o': '□', 'p': '■', 'w': '◆', 'u': '◆', 'Ü': '➢', 'è': '➔', 'à': '➔', 'J': '☺', 'L': '☹', 'F': '☞', '¨': '☐', 'þ': '☑', 'ý': '☒', '': '•' };

function docxMapSymbolText(text, font) {
  const sym = /symbol/i.test(font || ''), wing = /wingdings/i.test(font || '');
  if (!sym && !wing) return text;
  let out = '';
  for (let ch of text) {
    const code = ch.charCodeAt(0);
    if (code >= 0xF000 && code <= 0xF0FF) ch = String.fromCharCode(code - 0xF000);
    out += (sym ? SYMBOL_MAP[ch] : WINGDINGS_MAP[ch]) || (wing ? '•' : ch);
  }
  return out;
}

const HIGHLIGHT = { yellow: '#ffff00', green: '#00ff00', cyan: '#00ffff', magenta: '#ff00ff', blue: '#0000ff', red: '#ff0000', darkBlue: '#000080', darkCyan: '#008080', darkGreen: '#008000', darkMagenta: '#800080', darkRed: '#800000', darkYellow: '#808000', darkGray: '#808080', lightGray: '#c0c0c0', black: '#000000', white: '#ffffff' };

async function docxToPdf(file, onStatus) {
  await loadLib('jszip');
  const zip = await JSZip.loadAsync(file);
  const parse = (s) => new DOMParser().parseFromString(s, 'application/xml');
  const read = async (p) => { const f = zip.file(p); return f ? parse(await f.async('string')) : null; };

  /* ---------- помощники XML ---------- */
  const K = (el, n) => { if (!el) return null; for (const c of el.children) if (c.localName === n) return c; return null; };
  const KS = (el, n) => (el ? [...el.children].filter((c) => c.localName === n) : []);
  const A = (el, n) => { if (!el) return null; for (const a of el.attributes) if (a.localName === n) return a.value; return null; };
  const AN = (el, n, d = null) => { const v = A(el, n); if (v == null || v === '') return d; const x = parseFloat(v); return Number.isFinite(x) ? x : d; };
  const on = (el) => { if (!el) return undefined; const v = A(el, 'val'); return !(v === '0' || v === 'false' || v === 'off' || v === 'none'); };
  const tw = (v) => v / 20; // twips → pt

  const docXml = await read('word/document.xml');
  if (!docXml) throw new Error('Повреждённый DOCX: нет текста документа.');
  const body = K(docXml.documentElement, 'body');
  if (!body) throw new Error('Повреждённый DOCX: пустой документ.');

  // связи (картинки, колонтитулы)
  const relsOf = async (part) => {
    const dir = part.slice(0, part.lastIndexOf('/'));
    const d = await read(`${dir}/_rels/${part.split('/').pop()}.rels`);
    const m = {};
    if (d) for (const r of d.getElementsByTagNameNS('*', 'Relationship')) {
      if (r.getAttribute('TargetMode') === 'External') continue;
      m[r.getAttribute('Id')] = resolvePath(dir, r.getAttribute('Target') || '');
    }
    return m;
  };

  /* ---------- тема (шрифты) ---------- */
  const theme = { major: 'Calibri Light', minor: 'Calibri' };
  {
    const th = await read('word/theme/theme1.xml');
    if (th) {
      const fs = th.getElementsByTagNameNS('*', 'fontScheme')[0];
      theme.major = A(K(K(fs, 'majorFont'), 'latin'), 'typeface') || theme.major;
      theme.minor = A(K(K(fs, 'minorFont'), 'latin'), 'typeface') || theme.minor;
    }
  }

  /* ---------- свойства абзаца и текста ---------- */
  const parseRPr = (r) => {
    const o = {};
    if (!r) return o;
    for (const c of r.children) {
      switch (c.localName) {
        case 'rStyle': o.rStyle = A(c, 'val'); break;
        case 'rFonts': {
          const th = A(c, 'hAnsiTheme') || A(c, 'asciiTheme');
          const f = A(c, 'hAnsi') || A(c, 'ascii') || (th ? (/major/.test(th) ? theme.major : theme.minor) : null);
          if (f) o.font = f;
          break;
        }
        case 'b': o.b = on(c); break;
        case 'i': o.i = on(c); break;
        case 'caps': o.caps = on(c); break;
        case 'smallCaps': o.smallCaps = on(c); break;
        case 'strike': case 'dstrike': o.strike = on(c); break;
        case 'vanish': o.vanish = on(c); break;
        case 'u': o.u = A(c, 'val') && A(c, 'val') !== 'none'; break;
        case 'sz': o.sz = AN(c, 'val'); break;
        case 'color': { const v = A(c, 'val'); o.color = v && v !== 'auto' ? '#' + v : null; break; }
        case 'highlight': o.hl = HIGHLIGHT[A(c, 'val')] || null; break;
        case 'shd': { const f = A(c, 'fill'); if (f && f !== 'auto') o.hl = '#' + f; break; }
        case 'vertAlign': o.va = A(c, 'val'); break;
        case 'position': break;
      }
    }
    return o;
  };
  const parsePPr = (p) => {
    const o = {};
    if (!p) return o;
    for (const c of p.children) {
      switch (c.localName) {
        case 'pStyle': o.pStyle = A(c, 'val'); break;
        case 'jc': o.jc = A(c, 'val'); break;
        case 'ind': {
          const l = AN(c, 'left') ?? AN(c, 'start'), r = AN(c, 'right') ?? AN(c, 'end');
          if (l != null) o.indL = l;
          if (r != null) o.indR = r;
          if (A(c, 'firstLine') != null) { o.first = AN(c, 'firstLine', 0); o.hang = 0; }
          if (A(c, 'hanging') != null) { o.hang = AN(c, 'hanging', 0); o.first = 0; }
          break;
        }
        case 'spacing':
          if (A(c, 'before') != null) o.before = AN(c, 'before', 0);
          if (A(c, 'after') != null) o.after = AN(c, 'after', 0);
          if (A(c, 'beforeAutospacing') != null) o.beforeAuto = /^(1|true|on)$/.test(A(c, 'beforeAutospacing'));
          if (A(c, 'afterAutospacing') != null) o.afterAuto = /^(1|true|on)$/.test(A(c, 'afterAutospacing'));
          if (A(c, 'line') != null) { o.line = AN(c, 'line'); o.lineRule = A(c, 'lineRule') || 'auto'; }
          break;
        case 'numPr': {
          const id = A(K(c, 'numId'), 'val'), lvl = A(K(c, 'ilvl'), 'val');
          if (id != null) o.numId = id;
          if (lvl != null) o.ilvl = +lvl;
          break;
        }
        case 'pageBreakBefore': o.pageBreakBefore = on(c); break;
        case 'tabs': o.tabs = KS(c, 'tab').map((t) => ({ val: A(t, 'val'), pos: AN(t, 'pos', 0), leader: A(t, 'leader') })); break;
        case 'contextualSpacing': o.ctxSpacing = on(c); break;
        case 'outlineLvl': break;
        case 'rPr': o.markRPr = parseRPr(c); break;
      }
    }
    return o;
  };

  /* ---------- стили ---------- */
  const styles = {};
  let defP = {}, defR = {}, defaultParaStyle = null, defaultTableStyle = null;
  {
    const st = await read('word/styles.xml');
    const root = st && st.documentElement;
    const dd = K(root, 'docDefaults');
    defR = parseRPr(K(K(dd, 'rPrDefault'), 'rPr'));
    defP = parsePPr(K(K(dd, 'pPrDefault'), 'pPr'));
    for (const s of KS(root, 'style')) {
      const id = A(s, 'styleId');
      const type = A(s, 'type');
      styles[id] = {
        type, basedOn: A(K(s, 'basedOn'), 'val'),
        p: parsePPr(K(s, 'pPr')), r: parseRPr(K(s, 'rPr')),
        tblPr: K(s, 'tblPr'), tcPr: K(s, 'tcPr'),
      };
      if (A(s, 'default') === '1' || A(s, 'default') === 'true') {
        if (type === 'paragraph') defaultParaStyle = id;
        if (type === 'table') defaultTableStyle = id;
      }
    }
  }
  const chain = (id) => { const out = []; const seen = new Set(); while (id && styles[id] && !seen.has(id)) { seen.add(id); out.unshift(styles[id]); id = styles[id].basedOn; } return out; };
  const styleP = (id) => Object.assign({}, ...chain(id).map((s) => s.p));
  const styleR = (id) => Object.assign({}, ...chain(id).map((s) => s.r));

  /* ---------- нумерация списков ---------- */
  const abstract = {}, nums = {};
  {
    const nd = await read('word/numbering.xml');
    const root = nd && nd.documentElement;
    for (const an of KS(root, 'abstractNum')) {
      const lvls = {};
      for (const l of KS(an, 'lvl')) {
        lvls[A(l, 'ilvl')] = {
          fmt: A(K(l, 'numFmt'), 'val') || 'decimal', text: A(K(l, 'lvlText'), 'val') ?? '', start: AN(K(l, 'start'), 'val', 1),
          p: parsePPr(K(l, 'pPr')), r: parseRPr(K(l, 'rPr')), suff: A(K(l, 'suff'), 'val') || 'tab',
        };
      }
      abstract[A(an, 'abstractNumId')] = lvls;
    }
    for (const n of KS(root, 'num')) {
      const over = {};
      for (const o of KS(n, 'lvlOverride')) { const so = K(o, 'startOverride'); if (so) over[A(o, 'ilvl')] = AN(so, 'val', 1); }
      nums[A(n, 'numId')] = { abs: A(K(n, 'abstractNumId'), 'val'), over };
    }
  }
  const counters = {};
  const RU = 'абвгдежзиклмнопрстуфхцчшщэюя';
  const roman = (k) => { let r = ''; for (const [v, s] of [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']]) while (k >= v) { r += s; k -= v; } return r; };
  const fmtNum = (fmt, n) => {
    switch (fmt) {
      case 'lowerLetter': return String.fromCharCode(97 + (n - 1) % 26);
      case 'upperLetter': return String.fromCharCode(65 + (n - 1) % 26);
      case 'lowerRoman': return roman(n);
      case 'upperRoman': return roman(n).toUpperCase();
      case 'russianLower': return RU[(n - 1) % RU.length];
      case 'russianUpper': return RU[(n - 1) % RU.length].toUpperCase();
      case 'decimalZero': return String(n).padStart(2, '0');
      case 'none': return '';
      default: return String(n);
    }
  };
  /** номер/маркер абзаца списка (и считает) */
  const listLabel = (numId, ilvl) => {
    const num = nums[numId];
    const lvls = num && abstract[num.abs];
    const lvl = lvls && lvls[ilvl];
    if (!lvl) return null;
    const c = counters[numId] || (counters[numId] = {});
    const startOf = (k) => (num.over[k] ?? lvls[k]?.start ?? 1);
    c[ilvl] = c[ilvl] == null ? startOf(ilvl) : c[ilvl] + 1;
    for (const k of Object.keys(c)) if (+k > ilvl) delete c[k];
    let text;
    if (lvl.fmt === 'bullet') text = docxMapSymbolText(lvl.text || '•', lvl.r.font) || '•';
    else text = lvl.text.replace(/%(\d)/g, (m, d) => { const k = +d - 1; const v = c[k] ?? startOf(k); return fmtNum(lvls[k]?.fmt || 'decimal', v); });
    return { text, p: lvl.p, r: lvl.r, suff: lvl.suff };
  };

  /* ---------- страница ---------- */
  const sect = K(body, 'sectPr');
  const pgSz = K(sect, 'pgSz'), pgMar = K(sect, 'pgMar');
  let pageW = tw(AN(pgSz, 'w', 11906)), pageH = tw(AN(pgSz, 'h', 16838));
  if (A(pgSz, 'orient') === 'landscape' && pageW < pageH) [pageW, pageH] = [pageH, pageW];
  const mar = { l: tw(AN(pgMar, 'left', 1701)), r: tw(AN(pgMar, 'right', 850)), t: tw(Math.abs(AN(pgMar, 'top', 1134))), b: tw(Math.abs(AN(pgMar, 'bottom', 1134))), h: tw(AN(pgMar, 'header', 708)), f: tw(AN(pgMar, 'footer', 708)) };
  const contentW = pageW - mar.l - mar.r;
  const contentH = pageH - mar.t - mar.b;

  /* ---------- шрифты, которые понадобятся ---------- */
  const usedFonts = new Map(); // семейство → набор начертаний
  const useFont = (fam, b, i) => {
    const style = b && i ? 'bolditalics' : b ? 'bold' : i ? 'italics' : 'normal';
    if (!usedFonts.has(fam)) usedFonts.set(fam, new Set());
    usedFonts.get(fam).add(style);
  };

  /* ---------- картинки ---------- */
  const imgCache = new Map();
  let skippedImages = 0;
  const imageData = async (path) => {
    if (imgCache.has(path)) return imgCache.get(path);
    let url = null;
    const f = zip.file(path);
    const ext = extOf(path);
    if (f) {
      if (ext === 'png' || ext === 'jpg' || ext === 'jpeg') url = `data:${ext === 'png' ? 'image/png' : 'image/jpeg'};base64,${await f.async('base64')}`;
      else if (ext === 'wmf' || ext === 'emf') url = await metafileToPng(await f.async('arraybuffer'), ext);
      else if (IMG_MIME[ext] || ext === 'bmp') {
        try { url = await toPngDataUrl(URL.createObjectURL(new Blob([await f.async('arraybuffer')], { type: IMG_MIME[ext] || 'image/bmp' }))); } catch { url = null; }
      }
    }
    if (!url) skippedImages++;
    imgCache.set(path, url);
    return url;
  };

  /* ---------- сноски ---------- */
  const footnotes = {};
  {
    const fd = await read('word/footnotes.xml');
    if (fd) for (const fn of KS(fd.documentElement, 'footnote')) if (!A(fn, 'type') || A(fn, 'type') === 'normal') footnotes[A(fn, 'id')] = fn;
  }
  const usedNotes = [];

  /* ---------- плавающие рисунки и надписи «перед/за текстом» ---------- */
  const cssLen = (style, name) => {
    const m = new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*(-?[\\d.]+)(pt|px|in|cm|mm)?`, 'i').exec(style);
    if (!m) return null;
    return +m[1] * ({ pt: 1, px: 0.75, in: 72, cm: 28.35, mm: 2.835 }[(m[2] || 'pt').toLowerCase()]);
  };
  /** Позиция объекта, который не сдвигает текст (обтекание «нет», «перед текстом», «за текстом»); иначе null */
  const floatPos = (el) => {
    const anchor = el.localName === 'anchor' ? el : el.getElementsByTagNameNS('*', 'anchor')[0];
    if (anchor && anchor.namespaceURI && /wordprocessingDrawing/.test(anchor.namespaceURI)) {
      if (!K(anchor, 'wrapNone')) return null;
      const ph = K(anchor, 'positionH'), pv = K(anchor, 'positionV'), ext = K(anchor, 'extent');
      const off = (p) => { const o = K(p, 'posOffset'); return o ? +o.textContent / 12700 : null; };
      return {
        hFrom: A(ph, 'relativeFrom') || 'column', hOff: off(ph), hAlign: K(ph, 'align')?.textContent,
        vFrom: A(pv, 'relativeFrom') || 'paragraph', vOff: off(pv), vAlign: K(pv, 'align')?.textContent,
        w: AN(ext, 'cx', 0) / 12700, h: AN(ext, 'cy', 0) / 12700, behind: /^(1|true)$/.test(A(anchor, 'behindDoc') || ''),
      };
    }
    // старый формат фигур (VML)
    const shape = [el, ...el.getElementsByTagNameNS('*', '*')].find((x) => /^(shape|rect|roundrect|oval|group)$/.test(x.localName) && /position\s*:\s*absolute/i.test(x.getAttribute('style') || ''));
    if (!shape) return null;
    const wrap = shape.getElementsByTagNameNS('*', 'wrap')[0];
    if (wrap && A(wrap, 'type') && A(wrap, 'type') !== 'none') return null;
    const st = shape.getAttribute('style') || '';
    const rel = (n, d) => { const m = new RegExp(`${n}\\s*:\\s*([\\w-]+)`, 'i').exec(st); return m ? m[1] : d; };
    const hRel = rel('mso-position-horizontal-relative', 'text'), vRel = rel('mso-position-vertical-relative', 'text');
    return {
      hFrom: hRel === 'page' ? 'page' : hRel === 'margin' ? 'margin' : 'column', hOff: (cssLen(st, 'margin-left') || 0) + (cssLen(st, 'left') || 0), hAlign: rel('mso-position-horizontal', null),
      vFrom: vRel === 'page' ? 'page' : vRel === 'margin' ? 'margin' : 'paragraph', vOff: (cssLen(st, 'margin-top') || 0) + (cssLen(st, 'top') || 0), vAlign: rel('mso-position-vertical', null),
      w: cssLen(st, 'width') || 0, h: cssLen(st, 'height') || 0, behind: (cssLen(st, 'z-index') || 0) < 0,
    };
  };
  // Плавающие объекты рисуются отдельным слоем поверх (или под) готовых страниц:
  // в тексте остаётся невидимая метка, по ней узнаём страницу и высоту абзаца
  const floats = [];
  const floatMarker = (part) => {
    const id = `bcfloat${floats.length}`;
    floats.push({ part, id });
    return { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 0.01, y2: 0, lineWidth: 0.01, strokeOpacity: 0 }], id };
  };
  /** Узел pdfmake для слоя: объект на точных координатах страницы. pos — где оказался абзац-якорь */
  const placeFloat = (part, pos) => {
    const f = part.float;
    const w = f.w || part.width || 100, h = f.h || part.height || 20;
    const page = f.hFrom === 'page' || f.hFrom === 'leftMargin';
    const baseX = page ? 0 : mar.l, spanW = page ? pageW : contentW;
    const hA = f.hAlign && f.hAlign !== 'absolute' ? f.hAlign : null;
    const x = baseX + (hA ? (hA === 'center' ? (spanW - w) / 2 : hA === 'right' || hA === 'outside' ? spanW - w : 0) : (f.hOff || 0));
    let y;
    if (f.vFrom === 'page' || f.vFrom === 'margin' || f.vFrom === 'topMargin') {
      const baseY = f.vFrom === 'page' ? 0 : mar.t, spanH = f.vFrom === 'page' ? pageH : contentH;
      const vA = f.vAlign && f.vAlign !== 'absolute' ? f.vAlign : null;
      y = baseY + (vA ? (vA === 'center' ? (spanH - h) / 2 : vA === 'bottom' ? spanH - h : 0) : (f.vOff || 0));
    } else y = pos.top + (f.vOff || 0);
    const node = part.image
      ? { image: part.image, width: w, height: h }
      : { columns: [{ width: Math.max(10, w - 14.4), stack: part.blocks }], margin: [7.2, 3.6, 0, 0] };
    node.absolutePosition = { x, y };
    return node;
  };

  /* ======================= текст абзаца ======================= */

  /**
   * Собирает содержимое абзаца в части: { runs } (текст) и { image } (картинки), плюс разрывы страниц.
   * ctx: { rels, pStyleId, fieldPage (колонтитул) }
   */
  const paragraphParts = async (p, ctx, baseR) => {
    const parts = [];
    let runs = [];
    const flush = () => { parts.push({ runs }); runs = []; };
    const fields = []; // стек: 'code' | 'res'
    let instr = '';
    const visible = () => fields.every((f) => f.state === 'res');

    const addText = (text, rp) => {
      if (!text || rp.vanish) return;
      // неразрывный пробел роняет вёрстку в некоторых шрифтах (Carlito) — заменяем обычным
      let t = docxMapSymbolText(text, rp.font).replace(/ /g, ' ');
      if (rp.caps || rp.smallCaps) t = t.toUpperCase();
      const fam = /symbol|wingdings/i.test(rp.font || '') ? docxPdfFont(baseR.font || defR.font) : docxPdfFont(rp.font || baseR.font || defR.font);
      const size = (rp.sz ?? 24) / 2 * (rp.smallCaps ? 0.8 : 1);
      useFont(fam, !!rp.b, !!rp.i);
      const run = { text: t, font: fam, fontSize: size };
      if (rp.b) run.bold = true;
      if (rp.i) run.italics = true;
      const deco = [rp.u && 'underline', rp.strike && 'lineThrough'].filter(Boolean);
      if (deco.length) run.decoration = deco.length === 1 ? deco[0] : deco;
      if (rp.color) run.color = rp.color;
      if (rp.hl) run.background = rp.hl;
      // pdfmake уменьшает индексы только без явного размера шрифта — уменьшаем сами
      if (rp.va === 'superscript') { run.sup = true; run.fontSize = size * 0.58; }
      if (rp.va === 'subscript') { run.sub = true; run.fontSize = size * 0.58; }
      runs.push(run);
    };

    const runProps = (r) => {
      const own = parseRPr(K(r, 'rPr'));
      return { ...baseR, ...(own.rStyle ? styleR(own.rStyle) : {}), ...own };
    };

    const walk = async (node) => {
      for (const el of node.children) {
        switch (el.localName) {
          case 'r': {
            const rp = runProps(el);
            for (const c of el.children) {
              switch (c.localName) {
                case 'fldChar': {
                  const t = A(c, 'fldCharType');
                  if (t === 'begin') { fields.push({ state: 'code' }); instr = ''; }
                  else if (t === 'separate') {
                    if (!fields.length) break;
                    // номер страницы в колонтитуле: сохранённое Word значение не годится — подставляем настоящий номер
                    if (ctx.fieldPage && /^\s*(PAGE|NUMPAGES)\b/.test(instr)) {
                      fields[fields.length - 1].state = 'skip';
                      if (fields.slice(0, -1).every((f) => f.state === 'res')) addText(/NUMPAGES/.test(instr) ? '\u0002' : '\u0001', rp);
                    } else fields[fields.length - 1].state = 'res';
                  }
                  else if (t === 'end') {
                    const f = fields.pop();
                    // поле без результата: номер страницы в колонтитуле
                    if (f && f.state === 'code' && ctx.fieldPage && /^\s*(PAGE|NUMPAGES)\b/.test(instr)) addText(/NUMPAGES/.test(instr) ? '\u0002' : '\u0001', rp);
                  }
                  break;
                }
                case 'instrText': instr += c.textContent; break;
                case 't': if (visible()) addText(c.textContent, rp); break;
                case 'tab': case 'ptab': if (visible()) { addText('        ', rp); if (runs.length) runs[runs.length - 1].isTab = true; } break;
                case 'br': case 'cr':
                  if (!visible()) break;
                  if (A(c, 'type') === 'page') { flush(); parts.push({ pageBreak: true }); }
                  else if (A(c, 'type') !== 'column') addText('\n', rp);
                  break;
                case 'noBreakHyphen': if (visible()) addText('-', rp); break;
                case 'sym': if (visible()) { const code = parseInt(A(c, 'char') || '0', 16); addText(String.fromCharCode(code), { ...rp, font: A(c, 'font') || rp.font }); } break;
                case 'footnoteReference': {
                  const fn = footnotes[A(c, 'id')];
                  if (fn) { usedNotes.push(fn); addText(String(usedNotes.length), { ...rp, va: 'superscript' }); }
                  break;
                }
                case 'drawing': case 'pict': case 'object': case 'AlternateContent':
                  if (visible()) await graphic(c, rp);
                  break;
              }
            }
            break;
          }
          case 'hyperlink': case 'smartTag': case 'customXml': case 'ins': case 'fldSimple': case 'dir': case 'bdo':
            if (el.localName === 'fldSimple' && ctx.fieldPage && /^\s*(PAGE|NUMPAGES)\b/.test(A(el, 'instr') || '')) { addText(/NUMPAGES/.test(A(el, 'instr')) ? '\u0002' : '\u0001', runProps(K(el, 'r') || el)); break; }
            await walk(el); break;
          case 'sdt': await walk(K(el, 'sdtContent') || el); break;
          case 'oMathPara': case 'oMath': {
            if (!visible()) break;
            // формулы Word: простые (индексы, степени) — текстом в строке, двумерные (дроби, корни, суммы) — картинкой
            const block = el.localName === 'oMathPara';
            const size = (baseR.sz ?? 24) / 2;
            if (!block && typeof ommlIsComplex === 'function' && !ommlIsComplex(el)) {
              for (const r of ommlToRuns(el)) addText(r.text, { ...baseR, i: /^[A-Za-zα-ωΑ-Ω]$/.test(r.text.trim()) || undefined, va: r.va });
              break;
            }
            const png = typeof ommlToMathML === 'function' ? await mathmlToPng(ommlToMathML(el, block), size) : null;
            if (png) {
              if (runs.length) flush();
              parts.push({ image: png.url, width: png.w, height: png.h, align: block ? 'center' : null, formula: true });
            } else {
              const t = typeof ommlToRuns === 'function' ? ommlToRuns(el) : [{ text: [...el.getElementsByTagNameNS('*', 't')].map((x) => x.textContent).join('') }];
              for (const r of t) addText(r.text, { ...baseR, va: r.va });
            }
            break;
          }
          case 'AlternateContent': await graphic(el, baseR); break;
        }
      }
    };

    // картинки и надписи внутри абзаца
    const graphic = async (el, rp) => {
      if (el.localName === 'AlternateContent') {
        const ch = K(el, 'Choice') || K(el, 'Fallback');
        if (ch) for (const c of ch.children) await graphic(c, rp);
        return;
      }
      const fp = floatPos(el); // «поверх текста»: ставим по координатам, не сдвигая текст
      const blip = el.getElementsByTagNameNS('*', 'blip')[0];
      const imgData = el.getElementsByTagNameNS('*', 'imagedata')[0];
      const rid = blip ? A(blip, 'embed') : imgData ? A(imgData, 'id') : null;
      const txbxs = [...el.getElementsByTagNameNS('*', 'txbxContent')];
      if (fp && txbxs.length > 1 && !rid) {
        // группа надписей: каждую — по её собственной позиции в группе нельзя узнать просто, ставим стопкой
        if (runs.length) flush();
        const blocks = [];
        for (const t of txbxs) blocks.push(...await blocksOf(t, ctx));
        parts.push({ blocks, float: fp });
        return;
      }
      if (rid && ctx.rels[rid]) {
        let w = null, h = null;
        const ext = el.getElementsByTagNameNS('*', 'extent')[0];
        if (ext) { w = AN(ext, 'cx', 0) / 12700; h = AN(ext, 'cy', 0) / 12700; }
        else {
          const shape = imgData && imgData.parentElement;
          const style = (shape && shape.getAttribute('style')) || '';
          const dim = (n) => { const m = new RegExp(`${n}:\\s*([\\d.]+)(pt|px|in|cm|mm)?`).exec(style); if (!m) return null; const v = +m[1]; return { pt: v, px: v * 0.75, in: v * 72, cm: v * 28.35, mm: v * 2.835 }[m[2] || 'pt']; };
          w = dim('width'); h = dim('height');
        }
        const url = await imageData(ctx.rels[rid]);
        if (url) {
          if (runs.length) flush();
          parts.push({ image: url, width: w, height: h, float: fp });
        }
      }
      // надписи (текст в фигурах)
      const txbx = txbxs[0];
      if (txbx) { if (runs.length) flush(); parts.push({ blocks: await blocksOf(txbx, ctx), float: fp }); }
    };

    await walk(p);
    flush();
    return parts;
  };

  /* ======================= абзацы и таблицы ======================= */

  const paragraphNode = async (p, ctx, cell = null) => {
    const own = parsePPr(K(p, 'pPr'));
    const sid = own.pStyle || ctx.pStyleId || defaultParaStyle;
    let pp = { ...defP, ...(cell?.tblP || {}), ...styleP(sid), ...own };
    const rBase = { ...defR, ...(cell?.tblR || {}), ...styleR(sid) };

    // список
    let label = null;
    const numId = own.numId ?? pp.numId;
    if (numId != null && numId !== '0') {
      label = listLabel(numId, pp.ilvl ?? 0);
      if (label) pp = { ...defP, ...styleP(sid), ...label.p, ...own };
    }

    const parts = await paragraphParts(p, ctx, rBase);
    // позиции табуляции: из стилей и самого абзаца (clear — отмена позиции из стиля)
    const tabStops = [];
    for (const src of [defP, ...chain(sid).map((st) => st.p), label ? label.p : null, own]) {
      for (const t of (src && src.tabs) || []) {
        const i = tabStops.findIndex((x) => Math.abs(x.pos - t.pos) < 2);
        if (i >= 0) tabStops.splice(i, 1);
        if (t.val !== 'clear') tabStops.push(t);
      }
    }
    const markR = { ...rBase, ...(own.markRPr || {}) };
    const markSize = (markR.sz ?? 24) / 2;
    const fam = docxPdfFont(markR.font || defR.font);

    const left = tw(pp.indL || 0), right = tw(pp.indR || 0);
    const first = tw(pp.first || 0), hang = tw(pp.hang || 0);
    const auto = 14;
    let before = pp.beforeAuto ? auto : tw(pp.before || 0);
    let after = pp.afterAuto ? auto : tw(pp.after || 0);
    if (pp.ctxSpacing && ctx.prevStyle === sid) before = 0;
    const align = { center: 'center', right: 'right', end: 'right', both: 'justify', distribute: 'justify' }[pp.jc] || 'left';

    // высота строки
    const runsAll = parts.flatMap((x) => x.runs || []);
    const maxSize = Math.max(markSize, ...runsAll.map((r) => r.fontSize));
    let lineHeight = 1;
    if (pp.line != null) {
      if (pp.lineRule === 'auto') lineHeight = pp.line / 240;
      else {
        const want = tw(pp.line) / (maxSize * 1.15);
        lineHeight = pp.lineRule === 'exact' ? want : Math.max(1, want);
      }
    }
    // строки таблицы с точной высотой: пустой абзац не должен раздувать строку
    let emptySize = markSize;
    if (cell && cell.exactH) emptySize = Math.min(markSize, Math.max(1, (cell.exactH - 1) / (1.15 * lineHeight)));

    const nodes = [];
    let pendingBreak = !!pp.pageBreakBefore;
    const mk = (n) => { if (pendingBreak) { n.pageBreak = 'before'; pendingBreak = false; } nodes.push(n); };
    let firstLine = true;
    for (const part of parts) {
      if (part.pageBreak) { pendingBreak = true; continue; }
      // в теле документа — по координатам; в ячейках таблиц координаты не посчитать, оставляем на месте
      if (part.float && !cell && (part.image || (part.blocks && part.blocks.length))) { nodes.push(floatMarker(part)); continue; }
      if (part.blocks) { for (const b of part.blocks) mk(b); continue; }
      if (part.image) {
        let w = part.width, h = part.height;
        // картинка не может быть шире колонки и выше страницы — иначе вёрстка PDF зацикливается
        const maxW = Math.max(10, (cell ? cell.width : contentW) - left - right);
        const maxH = Math.max(10, contentH - 6);
        const n = { image: part.image, margin: [left, part.formula ? 3 : 0, right, part.formula ? 3 : 0], alignment: part.align || (align === 'justify' ? 'left' : align) };
        if (w > 0.5 && h > 0.5) {
          const k = Math.min(1, maxW / w, maxH / h);
          n.width = w * k; n.height = h * k;
        } else n.fit = [maxW, maxH];
        mk(n);
        continue;
      }
      let text = part.runs;
      // табуляция с выравниванием по правому краю (оглавления, «подпись ...... дата»)
      const tabAt = text.map((r, k) => (r.isTab ? k : -1)).filter((k) => k >= 0);
      const rightStop = tabStops.filter((t) => t.val === 'right' || t.val === 'end').sort((a, b) => b.pos - a.pos)[0];
      text = text.map((r) => { if (!r.isTab) return r; const c = { ...r }; delete c.isTab; return c; });
      if (tabAt.length && rightStop && !(firstLine && label && label.text)) {
        const k = tabAt[tabAt.length - 1];
        const colW = cell ? cell.width : contentW;
        const rightGap = Math.max(0, colW - tw(rightStop.pos) - right);
        const leftRuns = text.slice(0, k), rightRuns = text.slice(k + 1);
        const cols = [{ width: '*', text: leftRuns.length ? leftRuns : ' ', alignment: align === 'justify' ? 'left' : align, lineHeight, preserveLeadingSpaces: true }];
        cols.push({ width: 'auto', text: rightRuns.length ? rightRuns : ' ', lineHeight, preserveLeadingSpaces: true });
        mk({ columns: cols, columnGap: 2, margin: [Math.max(0, left - (firstLine ? hang : 0)), firstLine ? before : 0, rightGap, 0] });
        firstLine = false;
        continue;
      }
      const empty = !text.some((r) => r.text && r.text !== '\n');
      if (empty && !firstLine) continue;
      if (empty) { useFont(fam, false, false); text = [{ text: ' ', font: fam, fontSize: cell?.exactH ? emptySize : markSize }]; }
      const n = { text, alignment: align, lineHeight, preserveLeadingSpaces: true, preserveTrailingSpaces: empty };
      if (firstLine && label && label.text) {
        const lr = { ...rBase, ...label.r };
        const lfam = /symbol|wingdings/i.test(lr.font || '') ? docxPdfFont(rBase.font || defR.font) : docxPdfFont(lr.font || rBase.font || defR.font);
        useFont(lfam, !!lr.b, !!lr.i);
        const lab = { text: label.text, font: lfam, fontSize: (lr.sz ?? rBase.sz ?? 24) / 2, bold: !!lr.b, italics: !!lr.i };
        const gap = Math.max(hang, 18);
        if (label.suff === 'tab' && hang > 0) {
          mk({ columns: [{ width: gap, text: [lab] }, { width: '*', ...n }], columnGap: 0, margin: [left - hang, firstLine ? before : 0, right, 0] });
        } else {
          n.text = [lab, { text: label.suff === 'nothing' ? '' : ' ', font: lfam, fontSize: lab.fontSize }, ...text];
          n.margin = [Math.max(0, left - hang), before, right, 0];
          mk(n);
        }
      } else {
        n.margin = [Math.max(0, left - (firstLine ? hang : 0)), firstLine ? before : 0, right, 0];
        if (firstLine && first > 0) n.leadingIndent = first;
        if (!firstLine && hang) n.margin[0] = left;
        mk(n);
      }
      firstLine = false;
    }
    if (!nodes.length) {
      useFont(fam, false, false);
      mk({ text: [{ text: ' ', font: fam, fontSize: cell?.exactH ? emptySize : markSize }], lineHeight, margin: [left, before, right, 0] });
    }
    if (pendingBreak) nodes.push({ text: '', pageBreak: 'after' });
    // интервал после — к последнему элементу
    const last = nodes[nodes.length - 1];
    if (after && last) last.margin = [...(last.margin || [0, 0, 0, 0])].map((v, k) => (k === 3 ? (v || 0) + after : v));
    ctx.prevStyle = sid;
    return nodes;
  };

  const borderOf = (el) => {
    if (!el) return undefined; // не задано
    const v = A(el, 'val');
    if (!v || v === 'nil' || v === 'none') return null; // явно нет
    const c = A(el, 'color');
    return { w: Math.max(0.25, AN(el, 'sz', 4) / 8), color: c && c !== 'auto' ? '#' + c : '#000000' };
  };
  const bordersOf = (el) => {
    const o = {};
    if (!el) return o;
    for (const c of el.children) {
      const n = { start: 'left', end: 'right' }[c.localName] || c.localName;
      o[n] = borderOf(c);
    }
    return o;
  };

  const tableNode = async (tbl, ctx, availW) => {
    const tblPrEl = K(tbl, 'tblPr');
    const tStyleId = A(K(tblPrEl, 'tblStyle'), 'val') || defaultTableStyle;
    const tStyles = chain(tStyleId);
    // свойства таблицы: стиль, затем свои
    const tb = {}; let cellMar = { l: 108, r: 108, t: 0, b: 0 }, ind = 0, jc = null;
    for (const src of [...tStyles.map((s) => s.tblPr), tblPrEl]) {
      if (!src) continue;
      Object.assign(tb, bordersOf(K(src, 'tblBorders')));
      const cm = K(src, 'tblCellMar');
      if (cm) for (const c of cm.children) { const n = { start: 'l', left: 'l', end: 'r', right: 'r', top: 't', bottom: 'b' }[c.localName]; if (n) cellMar[n] = AN(c, 'w', 0); }
      if (K(src, 'tblInd')) ind = AN(K(src, 'tblInd'), 'w', 0);
      if (K(src, 'jc')) jc = A(K(src, 'jc'), 'val');
    }
    const tblP = Object.assign({}, ...tStyles.map((s) => s.p));
    const tblR = Object.assign({}, ...tStyles.map((s) => s.r));

    let grid = KS(K(tbl, 'tblGrid'), 'gridCol').map((g) => tw(AN(g, 'w', 0)));
    const rowsEl = KS(tbl, 'tr');
    const ncols = Math.max(grid.length, ...rowsEl.map((tr) => KS(tr, 'tc').reduce((a, tc) => a + AN(K(K(tc, 'tcPr'), 'gridSpan'), 'val', 1), 0) + AN(K(K(tr, 'trPr'), 'gridBefore'), 'val', 0)));
    while (grid.length < ncols) grid.push(0);
    if (grid.every((w) => !w)) grid = grid.map(() => availW / ncols);
    else { const known = grid.filter((w) => w > 0); const avg = known.reduce((a, b) => a + b, 0) / known.length; grid = grid.map((w) => w || avg); }
    let total = grid.reduce((a, b) => a + b, 0);
    const indent = Math.max(0, tw(ind));
    const room = Math.max(50, availW - indent);
    if (total > room + 0.5) { const k = room / total; grid = grid.map((w) => w * k); total = room; }

    // матрица ячеек
    const R = rowsEl.length, C = grid.length;
    const cells = Array.from({ length: R }, () => Array(C).fill(null));
    const vOpen = {}; // столбец → ячейка, объединяемая по вертикали
    const heights = [];
    let headerRows = 0, headerDone = false;
    for (let ri = 0; ri < R; ri++) {
      const tr = rowsEl[ri];
      const trPr = K(tr, 'trPr');
      const th = K(trPr, 'trHeight');
      const hv = th ? tw(AN(th, 'val', 0)) : 0;
      heights.push({ h: hv, exact: A(th, 'hRule') === 'exact' });
      if (!headerDone && K(trPr, 'tblHeader') && on(K(trPr, 'tblHeader')) !== false) headerRows++; else headerDone = true;
      let c = AN(K(trPr, 'gridBefore'), 'val', 0);
      for (let k = 0; k < c && k < C; k++) cells[ri][k] = { skip: true, empty: true };
      for (const tc of KS(tr, 'tc')) {
        if (c >= C) break;
        const tcPr = K(tc, 'tcPr');
        const span = Math.min(C - c, AN(K(tcPr, 'gridSpan'), 'val', 1));
        const vm = K(tcPr, 'vMerge');
        const vmVal = vm ? (A(vm, 'val') || 'continue') : null;
        if (vmVal === 'continue' && vOpen[c]) {
          vOpen[c].rowSpan++;
          for (let k = 0; k < span; k++) cells[ri][c + k] = { covered: vOpen[c] };
          c += span; continue;
        }
        const cell = { tc, tcPr, ri, ci: c, colSpan: span, rowSpan: 1, own: bordersOf(K(tcPr, 'tcBorders')) };
        cells[ri][c] = cell;
        for (let k = 1; k < span; k++) cells[ri][c + k] = { covered: cell };
        if (vmVal === 'restart') vOpen[c] = cell; else delete vOpen[c];
        c += span;
      }
      for (let k = c; k < C; k++) if (!cells[ri][k]) cells[ri][k] = { skip: true, empty: true };
    }

    // границы: для каждой стороны ячейки — своя или табличная; линия видна, если её задала хотя бы одна из соседних ячеек
    const H = Array.from({ length: R + 1 }, () => Array(C).fill(null));
    const V = Array.from({ length: R }, () => Array(C + 1).fill(null));
    const pick = (own, outer, inner, isOuter) => (own !== undefined ? own : (isOuter ? outer : inner)) || null;
    const heavier = (a, b) => (!a ? b : !b ? a : (b.w > a.w ? b : a));
    for (let ri = 0; ri < R; ri++) for (let ci = 0; ci < C; ci++) {
      const cell = cells[ri][ci];
      if (!cell || cell.covered || cell.skip) continue;
      const r2 = ri + cell.rowSpan, c2 = ci + cell.colSpan;
      const top = pick(cell.own.top, tb.top, tb.insideH, ri === 0);
      const bottom = pick(cell.own.bottom, tb.bottom, tb.insideH, r2 >= R);
      const left = pick(cell.own.left, tb.left, tb.insideV, ci === 0);
      const right = pick(cell.own.right, tb.right, tb.insideV, c2 >= C);
      for (let k = ci; k < c2; k++) { H[ri][k] = heavier(H[ri][k], top); if (r2 <= R) H[r2][k] = heavier(H[r2][k], bottom); }
      for (let k = ri; k < r2 && k < R; k++) { V[k][ci] = heavier(V[k][ci], left); V[k][c2] = heavier(V[k][c2], right); }
    }

    // содержимое ячеек
    const bodyRows = [];
    for (let ri = 0; ri < R; ri++) {
      const row = [];
      for (let ci = 0; ci < C; ci++) {
        const cell = cells[ri][ci];
        if (!cell || cell.skip) { row.push({ text: '', border: [false, false, false, false] }); continue; }
        if (cell.covered) { row.push({}); continue; }
        const w = grid.slice(ci, ci + cell.colSpan).reduce((a, b) => a + b, 0);
        const mar = { ...cellMar };
        const tm = K(cell.tcPr, 'tcMar');
        if (tm) for (const c of tm.children) { const n = { start: 'l', left: 'l', end: 'r', right: 'r', top: 't', bottom: 'b' }[c.localName]; if (n) mar[n] = AN(c, 'w', 0); }
        const inner = w - tw(mar.l + mar.r);
        const hRow = heights[ri];
        const cctx = { ...ctx, prevStyle: null };
        const stack = await blocksOf(cell.tc, cctx, { width: inner, tblP, tblR, exactH: hRow.h && cell.rowSpan === 1 ? hRow.h - tw(mar.t + mar.b) : 0 });
        const shd = K(cell.tcPr, 'shd');
        const fill = A(shd, 'fill');
        const r2 = ri + cell.rowSpan, c2 = ci + cell.colSpan;
        const vis = (seg) => !!seg;
        const node = {
          stack: stack.length ? stack : [{ text: '' }],
          colSpan: cell.colSpan > 1 ? cell.colSpan : undefined, rowSpan: cell.rowSpan > 1 ? cell.rowSpan : undefined,
          border: [vis(V[ri][ci]), vis(H[ri][ci]), vis(V[ri][c2]), vis(H[Math.min(r2, R)][ci])],
          borderColor: [(V[ri][ci] || {}).color || '#000', (H[ri][ci] || {}).color || '#000', (V[ri][c2] || {}).color || '#000', (H[Math.min(r2, R)][ci] || {}).color || '#000'],
          margin: [tw(mar.l), tw(mar.t), tw(mar.r), tw(mar.b)],
        };
        if (fill && fill !== 'auto' && /^[0-9a-f]{6}$/i.test(fill)) node.fillColor = '#' + fill;
        row.push(node);
      }
      bodyRows.push(row);
    }
    // толщина линий: по самой частой заданной
    const widths = [...H.flat(), ...V.flat()].filter(Boolean).map((b) => b.w);
    const lw = widths.length ? widths.sort((a, b) => a - b)[Math.floor(widths.length / 2)] : 0.5;
    let left = indent;
    if (jc === 'center') left = Math.max(0, (availW - total) / 2);
    else if (jc === 'right' || jc === 'end') left = Math.max(0, availW - total);
    return {
      table: { widths: grid, body: bodyRows, heights: heights.map((h) => h.h || 'auto'), headerRows: headerRows || undefined, dontBreakRows: false },
      layout: {
        hLineWidth: () => lw, vLineWidth: () => lw,
        paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 0, paddingBottom: () => 0,
      },
      margin: [left, 0, 0, 0],
    };
  };

  /** Блоки (абзацы, таблицы) из тела документа, ячейки, колонтитула или надписи */
  const blocksOf = async (container, ctx, cell = null) => {
    const out = [];
    for (const el of container.children) {
      switch (el.localName) {
        case 'p': {
          out.push(...await paragraphNode(el, ctx, cell));
          // раздел, начинающийся с новой страницы
          const sp = K(K(el, 'pPr'), 'sectPr');
          if (sp && !cell && A(K(sp, 'type'), 'val') !== 'continuous') out.push({ text: '', pageBreak: 'after' });
          break;
        }
        case 'tbl': out.push(await tableNode(el, ctx, cell ? cell.width : contentW)); break;
        case 'sdt': out.push(...await blocksOf(K(el, 'sdtContent') || el, ctx, cell)); break;
        case 'customXml': case 'ins': out.push(...await blocksOf(el, ctx, cell)); break;
        case 'AlternateContent': { const ch = K(el, 'Choice') || K(el, 'Fallback'); if (ch) out.push(...await blocksOf(ch, ctx, cell)); break; }
      }
    }
    return out;
  };

  /* ======================= сборка документа ======================= */
  onStatus && onStatus('Вёрстка страниц…');
  const docRels = await relsOf('word/document.xml');
  const content = await blocksOf(body, { rels: docRels, prevStyle: null });
  // лишний разрыв в самом конце дал бы пустую страницу
  while (content.length && content[content.length - 1].pageBreak === 'after' && !content[content.length - 1].text) content.pop();

  // сноски — в конце документа
  if (usedNotes.length) {
    const fnRels = await relsOf('word/footnotes.xml');
    content.push({ canvas: [{ type: 'line', x1: 0, y1: 0, x2: 150, y2: 0, lineWidth: 0.5 }], margin: [0, 12, 0, 6] });
    for (let k = 0; k < usedNotes.length; k++) {
      const blocks = await blocksOf(usedNotes[k], { rels: fnRels, prevStyle: null });
      if (blocks[0] && blocks[0].text) blocks[0].text = [{ text: `${k + 1} `, sup: true, fontSize: 8 }, ...(Array.isArray(blocks[0].text) ? blocks[0].text : [blocks[0].text])];
      content.push(...blocks);
    }
  }

  // колонтитулы
  const hf = async (kind) => {
    const refs = KS(sect, `${kind}Reference`);
    const res = {};
    for (const ref of refs) {
      const path = docRels[A(ref, 'id')];
      const d = path && await read(path);
      if (!d) continue;
      const blocks = await blocksOf(d.documentElement, { rels: await relsOf(path), prevStyle: null, fieldPage: true });
      const hasText = JSON.stringify(blocks).replace(/\\u00a0| /g, '').match(/"text":"[^"]+"/);
      if (blocks.length && (hasText || JSON.stringify(blocks).includes('"image"'))) res[A(ref, 'type') || 'default'] = blocks;
    }
    return res;
  };
  const headers = await hf('header'), footers = await hf('footer');
  const titlePg = K(sect, 'titlePg') && on(K(sect, 'titlePg')) !== false;
  const firstNum = AN(K(sect, 'pgNumType'), 'start', 1); // нумерация может начинаться не с 1
  const subst = (blocks, page, count) => JSON.parse(JSON.stringify(blocks).replace(/\\u0001|\u0001/g, String(page + firstNum - 1)).replace(/\\u0002|\u0002/g, String(count + firstNum - 1)));
  const choose = (set, page) => (page === 1 && titlePg ? set.first : (page % 2 === 0 && set.even) || set.default);

  // шрифты: загружаем только нужные начертания (без интернета — из кэша приложения)
  await loadLib('pdfmake');
  await loadLib('pdfmakeFonts');
  await docxLoadFonts(usedFonts, onStatus);

  onStatus && onStatus('Создание PDF…');
  const dd = {
    pageSize: { width: pageW, height: pageH },
    pageMargins: [mar.l, mar.t, mar.r, mar.b],
    content,
    defaultStyle: { font: docxPdfFont(defR.font), fontSize: (defR.sz ?? 24) / 2 },
    header: Object.keys(headers).length ? (page, count) => { const b = choose(headers, page); return b ? { stack: subst(b, page, count), margin: [mar.l, mar.h, mar.r, 0] } : null; } : undefined,
    footer: Object.keys(footers).length ? (page, count) => { const b = choose(footers, page); return b ? { stack: subst(b, page, count), margin: [mar.l, Math.max(0, mar.b - mar.f - 14), mar.r, 0] } : null; } : undefined,
    info: { title: baseOf(file.name) },
  };
  docxToPdf.lastDoc = dd; // для диагностики
  const make = (def) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Вёрстка PDF заняла слишком много времени.')), layoutTimeout(file.size));
    try { pdfMake.createPdf(def).getBuffer((b) => { clearTimeout(timer); resolve(b); }); } catch (e) { clearTimeout(timer); reject(e); }
  });

  // метки плавающих объектов: где на какой странице оказались
  const pos = {};
  if (floats.length) dd.pageBreakBefore = (node) => { if (node.id && node.startPosition && /^bcfloat/.test(node.id)) pos[node.id] = node.startPosition; return false; };
  let bytes = await make(dd);

  const placed = floats.filter((f) => pos[f.id]);  if (placed.length) {
    try {
      onStatus && onStatus('Надписи и рисунки поверх текста…');
      // по слою на каждую сторону: «за текстом» и «перед текстом»
      const layer = async (list) => {
        const pages = [...new Set(list.map((f) => pos[f.id].pageNumber))].sort((a, b) => a - b);
        const content = [];
        pages.forEach((pg, i) => {
          for (const f of list.filter((x) => pos[x.id].pageNumber === pg)) content.push(placeFloat(f.part, pos[f.id]));
          if (i < pages.length - 1) content.push({ text: '', pageBreak: 'after' });
        });
        return { pages, bytes: await make({ pageSize: dd.pageSize, pageMargins: [0, 0, 0, 0], content, defaultStyle: dd.defaultStyle }) };
      };
      const front = placed.filter((f) => !f.part.float.behind), back = placed.filter((f) => f.part.float.behind);
      await loadLib('pdflib');
      const { PDFDocument, PDFArray } = PDFLib;
      const main = await PDFDocument.load(bytes);
      for (const [list, under] of [[front, false], [back, true]]) {
        if (!list.length) continue;
        const ov = await layer(list);
        const ovDoc = await PDFDocument.load(ov.bytes);
        for (let i = 0; i < ov.pages.length; i++) {
          const page = main.getPage(ov.pages[i] - 1);
          const [emb] = await main.embedPages([ovDoc.getPage(i)]);
          page.drawPage(emb, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });
          if (under) {
            // рисунок «за текстом»: переносим его в начало содержимого страницы
            const arr = page.node.Contents();
            if (arr instanceof PDFArray && arr.size() > 1) { const last = arr.get(arr.size() - 1); arr.remove(arr.size() - 1); arr.insert(0, last); }
          }
        }
      }
      bytes = await main.save({ useObjectStreams: false });
    } catch (e) {
      console.warn('Не удалось наложить плавающие объекты:', e);
    }
  }
  return { blob: new Blob([bytes], { type: 'application/pdf' }), skippedImages };
}

/** Регистрирует в pdfmake шрифты Tinos/Arimo/Carlito/Cousine (скачиваются один раз и кэшируются) */
const docxFontCache = {};
async function docxLoadFonts(used, onStatus) {
  const toB64 = (blob) => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.onerror = rej; fr.readAsDataURL(blob); });
  pdfMake.fonts = pdfMake.fonts || { Roboto: { normal: 'Roboto-Regular.ttf', bold: 'Roboto-Medium.ttf', italics: 'Roboto-Italic.ttf', bolditalics: 'Roboto-MediumItalic.ttf' } };
  for (const [fam, stylesSet] of used) {
    const def = {};
    const want = new Set([...stylesSet, 'normal']);
    for (const st of want) {
      const key = `${fam}-${st}.ttf`;
      if (!docxFontCache[key]) {
        onStatus && onStatus(`Загрузка шрифта ${fam}…`);
        docxFontCache[key] = fetch(docxFontUrl(fam, st)).then((r) => { if (!r.ok) throw new Error(r.status); return r.blob(); }).then(toB64)
          .then((b64) => { pdfMake.vfs[key] = b64; return true; }).catch(() => { delete docxFontCache[key]; return false; });
      }
      if (await docxFontCache[key]) def[st] = key;
    }
    if (!def.normal) { pdfMake.fonts[fam] = pdfMake.fonts.Roboto; continue; } // нет сети и кэша — запасной шрифт
    pdfMake.fonts[fam] = {
      normal: def.normal, bold: def.bold || def.normal, italics: def.italics || def.normal,
      bolditalics: def.bolditalics || def.bold || def.italics || def.normal,
    };
  }
}

/** Векторные картинки Windows (WMF — формулы старого редактора, EMF) → PNG. Без поддержки — null. */
async function metafileToPng(buf, ext) {
  try {
    const dv = new DataView(buf);
    let svg, wPt, hPt;
    if (ext === 'wmf') {
      await loadLib('wmf');
      let xExt = 0, yExt = 0, inch = 1440;
      if (dv.getUint32(0, true) === 0x9AC6CDD7) {
        xExt = Math.abs(dv.getInt16(10, true) - dv.getInt16(6, true));
        yExt = Math.abs(dv.getInt16(12, true) - dv.getInt16(8, true));
        inch = dv.getUint16(14, true) || 1440;
      } else {
        // без «размещаемого» заголовка: размер окна из записи SetWindowExt
        for (let o = 18; o + 10 <= buf.byteLength;) {
          const size = dv.getUint32(o, true) * 2, fn = dv.getUint16(o + 4, true);
          if (fn === 0x020C) { yExt = Math.abs(dv.getInt16(o + 6, true)); xExt = Math.abs(dv.getInt16(o + 8, true)); break; }
          if (!size) break;
          o += size;
        }
        inch = 1440;
      }
      if (!xExt || !yExt) return null;
      wPt = xExt / inch * 72; hPt = yExt / inch * 72;
      svg = new WMFJS.Renderer(buf).render({ width: `${wPt}pt`, height: `${hPt}pt`, xExt, yExt, mapMode: 8 });
    } else {
      await loadLib('emf');
      const l = dv.getInt32(8, true), t = dv.getInt32(12, true), r = dv.getInt32(16, true), b = dv.getInt32(20, true);
      const fl = dv.getInt32(24, true), ft = dv.getInt32(28, true), fr = dv.getInt32(32, true), fb = dv.getInt32(36, true);
      const xExt = r - l, yExt = b - t;
      if (xExt <= 0 || yExt <= 0) return null;
      wPt = (fr - fl) / 100 / 25.4 * 72 || xExt * 0.75; hPt = (fb - ft) / 100 / 25.4 * 72 || yExt * 0.75;
      svg = new EMFJS.Renderer(buf).render({ width: `${wPt}pt`, height: `${hPt}pt`, wExt: xExt, hExt: yExt, xExt, yExt, mapMode: 8 });
    }
    // Надписи: кодировку каждой берём из шрифта в самом WMF (204 — русская, 161 — греческая, 2 — Symbol);
    // библиотека читает все байты как западные, а на телефонах шрифта Symbol нет
    const texts = [...svg.querySelectorAll('text')];
    const sets = ext === 'wmf' ? wmfTextCharsets(buf) : null;
    const CODEPAGE = { 204: 'windows-1251', 161: 'windows-1253', 162: 'windows-1254', 238: 'windows-1250', 186: 'windows-1257', 177: 'windows-1255', 178: 'windows-1256', 163: 'windows-1258' };
    texts.forEach((t, k) => {
      const ff = t.getAttribute('font-family') || '';
      const info = sets && sets.length === texts.length ? sets[k] : null;
      const cs = info ? info.cs : null;
      if (info && !t.getAttribute('transform')) {
        // выравнивание надписи из WMF (библиотека всегда ставит текст по базовой линии и слева)
        const v = info.align & 24, hz = info.align & 6;
        if (v === 0) t.setAttribute('dy', '0.8em'); // по верхнему краю — так в WMF по умолчанию
        else if (v === 8) t.setAttribute('dy', '-0.2em');
        if (hz === 6) t.setAttribute('text-anchor', 'middle');
        else if (hz === 2) t.setAttribute('text-anchor', 'end');
      }
      const raw = t.textContent;
      const bytes = () => Uint8Array.from([...raw].map((ch) => ch.charCodeAt(0) & 0xFF));
      if (cs === 2 || /symbol/i.test(ff)) {
        t.textContent = docxMapSymbolText(raw, 'Symbol');
        t.setAttribute('font-family', 'Times New Roman, Tinos, serif');
      } else if (CODEPAGE[cs] && /[\x80-\xff]/.test(raw)) {
        t.textContent = new TextDecoder(CODEPAGE[cs]).decode(bytes());
      } else if (cs == null && /[\xc0-\xff]/.test(raw) && ![...raw].some((ch) => ch.charCodeAt(0) > 255)) {
        t.textContent = new TextDecoder('windows-1251').decode(bytes()); // запасной вариант: русские документы
      }
    });
    // чёткость: не меньше ~1600 точек по большей стороне (мелкие подписи остаются читаемыми при растяжении)
    const scale = Math.min(12, Math.max(3, 1600 / Math.max(wPt, hPt, 1)));
    const w = Math.max(1, Math.round(wPt * scale)), h = Math.max(1, Math.round(hPt * scale));
    svg.setAttribute('width', w); svg.setAttribute('height', h);
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(svg));
    const img = await imageFromUrl(src);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0, w, h); // фон прозрачный, как в оригинале: под рисунком могут быть надписи
    return c.toDataURL('image/png');
  } catch (e) {
    console.warn('Не удалось нарисовать', ext, e);
    return null;
  }
}

/** Кодировка шрифта для каждой надписи WMF (в порядке записей), чтобы правильно прочитать байты текста */
function wmfTextCharsets(buf) {
  const dv = new DataView(buf);
  let o = dv.getUint32(0, true) === 0x9AC6CDD7 ? 22 : 0;
  o += dv.getUint16(o + 2, true) * 2; // заголовок
  const objects = [];
  const alloc = (v) => { let i = objects.indexOf(undefined); if (i < 0) i = objects.length; objects[i] = v; };
  const CREATE = new Set([0x02FA, 0x02FC, 0x00F7, 0x01F9, 0x0142, 0x06FF]);
  let cur = 0, align = 0;
  const saved = [];
  const out = [];
  while (o + 6 <= buf.byteLength) {
    const size = dv.getUint32(o, true) * 2, fn = dv.getUint16(o + 4, true);
    if (size < 6 || fn === 0) break;
    const p = o + 6;
    if (fn === 0x02FB) alloc({ font: true, cs: dv.getUint8(p + 13) });
    else if (CREATE.has(fn)) alloc({});
    else if (fn === 0x01F0) objects[dv.getUint16(p, true)] = undefined;
    else if (fn === 0x012D) { const ob = objects[dv.getUint16(p, true)]; if (ob && ob.font) cur = ob.cs; }
    else if (fn === 0x012E) align = dv.getUint16(p, true);
    else if (fn === 0x001E) saved.push({ cur, align });                       // SaveDC
    else if (fn === 0x0127) { const s = saved.pop(); if (s) ({ cur, align } = s); } // RestoreDC
    else if (fn === 0x0521 || fn === 0x0A32) out.push({ cs: cur, align });
    o += size;
  }
  return out;
}

/**
 * Оформление по ГОСТ 7.32 (отчёты, курсовые): поля 30/15/20/20 мм, Times New Roman 14, интервал 1,5,
 * абзацный отступ 1,25 см, по ширине; в таблицах — 12 пт и одинарный интервал; рисунки по центру;
 * нумерация страниц внизу по центру. Заголовки, списки и выравнивание по центру сохраняются.
 */
async function docxToGost(file) {
  await loadLib('jszip');
  const zip = await JSZip.loadAsync(file);
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const parse = async (p) => { const f = zip.file(p); return f ? new DOMParser().parseFromString(await f.async('string'), 'application/xml') : null; };
  const save = (p, d) => zip.file(p, new XMLSerializer().serializeToString(d));
  const K = (e, n) => { if (!e) return null; for (const c of e.children) if (c.localName === n) return c; return null; };
  const el = (d, name, attrs = {}) => { const e = d.createElementNS(W, 'w:' + name); for (const [k, v] of Object.entries(attrs)) e.setAttributeNS(W, 'w:' + k, v); return e; };
  // Word требует строгий порядок свойств — вставляем на своё место
  const ORDER = {
    rPr: ['rStyle', 'rFonts', 'b', 'bCs', 'i', 'iCs', 'caps', 'smallCaps', 'strike', 'dstrike', 'outline', 'shadow', 'emboss', 'imprint', 'noProof', 'snapToGrid', 'vanish', 'webHidden', 'color', 'spacing', 'w', 'kern', 'position', 'sz', 'szCs', 'highlight', 'u', 'effect', 'bdr', 'shd', 'fitText', 'vertAlign', 'rtl', 'cs', 'em', 'lang', 'eastAsianLayout', 'specVanish', 'oMath'],
    pPr: ['pStyle', 'keepNext', 'keepLines', 'pageBreakBefore', 'framePr', 'widowControl', 'numPr', 'suppressLineNumbers', 'pBdr', 'shd', 'tabs', 'suppressAutoHyphens', 'kinsoku', 'wordWrap', 'overflowPunct', 'topLinePunct', 'autoSpaceDE', 'autoSpaceDN', 'bidi', 'adjustRightInd', 'snapToGrid', 'spacing', 'ind', 'contextualSpacing', 'mirrorIndents', 'suppressOverlap', 'jc', 'textDirection', 'textAlignment', 'textboxTightWrap', 'outlineLvl', 'divId', 'cnfStyle', 'rPr', 'sectPr', 'pPrChange'],
    sectPr: ['headerReference', 'footerReference', 'footnotePr', 'endnotePr', 'type', 'pgSz', 'pgMar', 'paperSrc', 'pgBorders', 'lnNumType', 'pgNumType', 'cols', 'formProt', 'vAlign', 'noEndnote', 'titlePg', 'textDirection', 'bidi', 'rtlGutter', 'docGrid', 'printerSettings', 'sectPrChange'],
    style: ['name', 'aliases', 'basedOn', 'next', 'link', 'autoRedefine', 'hidden', 'uiPriority', 'semiHidden', 'unhideWhenUsed', 'qFormat', 'locked', 'personal', 'personalCompose', 'personalReply', 'rsid', 'pPr', 'rPr', 'tblPr', 'trPr', 'tcPr', 'tblStylePr'],
    docDefaults: ['rPrDefault', 'pPrDefault'],
    r: ['rPr'], p: ['pPr'],
  };
  const put = (parent, child) => {
    const order = ORDER[parent.localName];
    const old = K(parent, child.localName);
    if (old) old.remove();
    if (!order) { parent.appendChild(child); return child; }
    const idx = order.indexOf(child.localName);
    const before = [...parent.children].find((c) => order.indexOf(c.localName) > idx || (idx >= 0 && order.indexOf(c.localName) < 0 && ['r', 'p'].includes(parent.localName)));
    if (before) parent.insertBefore(child, before); else parent.appendChild(child);
    return child;
  };
  const ensure = (d, parent, name) => K(parent, name) || put(parent, el(d, name));
  const setFont = (d, rPr, sz) => {
    put(rPr, el(d, 'rFonts', { ascii: 'Times New Roman', hAnsi: 'Times New Roman', cs: 'Times New Roman', eastAsia: 'Times New Roman' }));
    if (sz) { put(rPr, el(d, 'sz', { val: String(sz) })); put(rPr, el(d, 'szCs', { val: String(sz) })); }
    const col = K(rPr, 'color');
    if (col && !/^(auto|000000)$/i.test(col.getAttributeNS(W, 'val') || '')) col.remove(); // цветной текст — чёрным
  };

  /* ---- стили ---- */
  const styles = await parse('word/styles.xml');
  const headingIds = new Set();
  if (styles) {
    const root = styles.documentElement;
    let dd = K(root, 'docDefaults');
    if (!dd) { dd = el(styles, 'docDefaults'); root.insertBefore(dd, root.firstElementChild); }
    setFont(styles, ensure(styles, ensure(styles, dd, 'rPrDefault'), 'rPr'), 28);
    put(ensure(styles, ensure(styles, dd, 'pPrDefault'), 'pPr'), el(styles, 'spacing', { before: '0', after: '0', line: '360', lineRule: 'auto' }));
    for (const s of [...root.getElementsByTagNameNS(W, 'style')]) {
      const type = s.getAttributeNS(W, 'type');
      if (type !== 'paragraph' && type !== 'character') continue;
      const name = (K(s, 'name') && K(s, 'name').getAttributeNS(W, 'val')) || '';
      const isHeading = type === 'paragraph' && (/^heading|заголовок|^title/i.test(name) || !!K(K(s, 'pPr'), 'outlineLvl'));
      if (isHeading) headingIds.add(s.getAttributeNS(W, 'styleId'));
      const def = s.getAttributeNS(W, 'default') === '1';
      const rp = ensure(styles, s, 'rPr');
      // заголовки: тот же шрифт, полужирный, 16 пт (первый уровень) или 14 пт, чёрный цвет
      setFont(styles, rp, isHeading ? (/(^heading ?1$)|(заголовок ?1$)|^title/i.test(name) ? 32 : 28) : (def ? 28 : null));
      if (isHeading) put(rp, el(styles, 'b'));
      if (type === 'paragraph' && def) {
        const pp = ensure(styles, s, 'pPr');
        put(pp, el(styles, 'spacing', { before: '0', after: '0', line: '360', lineRule: 'auto' }));
        put(pp, el(styles, 'ind', { firstLine: '709' }));
        put(pp, el(styles, 'jc', { val: 'both' }));
      }
    }
    save('word/styles.xml', styles);
  }

  /* ---- текст документа ---- */
  const doc = await parse('word/document.xml');
  if (!doc) throw new Error('Повреждённый DOCX.');
  const body = doc.getElementsByTagNameNS(W, 'body')[0];
  for (const p of [...body.getElementsByTagNameNS(W, 'p')]) {
    let anc = p.parentNode, where = 'body';
    while (anc && anc !== body) { if (anc.localName === 'tbl') { where = 'table'; break; } if (anc.localName === 'txbxContent') { where = 'box'; break; } anc = anc.parentNode; }
    if (where === 'box') continue; // надписи не трогаем
    const tbl = where === 'table';
    const pPr = ensure(doc, p, 'pPr');
    const styleId = K(pPr, 'pStyle') && K(pPr, 'pStyle').getAttributeNS(W, 'val');
    const heading = headingIds.has(styleId) || !!K(pPr, 'outlineLvl');
    const list = !!K(pPr, 'numPr');
    const picture = p.getElementsByTagNameNS('*', 'drawing').length + p.getElementsByTagNameNS('*', 'pict').length > 0 && !p.textContent.trim();
    const jc = K(pPr, 'jc') && K(pPr, 'jc').getAttributeNS(W, 'val');
    put(pPr, el(doc, 'spacing', tbl ? { before: '0', after: '0', line: '240', lineRule: 'auto' } : heading ? { before: '240', after: '240', line: '360', lineRule: 'auto' } : { before: '0', after: '0', line: '360', lineRule: 'auto' }));
    // в ячейках таблиц абзацный отступ и «по ширине» из основного стиля не нужны
    if (tbl) {
      if (!K(pPr, 'ind')) put(pPr, el(doc, 'ind', { firstLine: '0' }));
      if (!jc) put(pPr, el(doc, 'jc', { val: 'left' }));
    }
    if (!tbl && !list && !heading) {
      const ind = K(pPr, 'ind'); if (ind) ind.remove();
      if (!picture && jc !== 'center' && jc !== 'right') put(pPr, el(doc, 'ind', { firstLine: '709' }));
      if (picture) put(pPr, el(doc, 'jc', { val: 'center' }));
      else if (!jc || jc === 'left' || jc === 'start') put(pPr, el(doc, 'jc', { val: 'both' }));
    }
    // шрифт и размер у каждого фрагмента текста (жирный, курсив, индексы сохраняются)
    for (const r of [...p.getElementsByTagNameNS(W, 'r')]) {
      const rPr = ensure(doc, r, 'rPr');
      const f = K(rPr, 'rFonts');
      if (f && /symbol|wingdings|math/i.test(f.getAttributeNS(W, 'ascii') || f.getAttributeNS(W, 'hAnsi') || '')) continue;
      setFont(doc, rPr, tbl ? 24 : heading ? null : 28);
    }
    const mark = K(pPr, 'rPr');
    if (mark) setFont(doc, mark, tbl ? 24 : heading ? null : 28);
  }

  /* ---- страница и нумерация ---- */
  const sects = [...body.getElementsByTagNameNS(W, 'sectPr')];
  let last = sects.find((x) => x.parentNode === body);
  if (!last) { last = el(doc, 'sectPr'); body.appendChild(last); sects.push(last); }
  for (const s of sects) {
    const sz = K(s, 'pgSz');
    const land = sz && sz.getAttributeNS(W, 'orient') === 'landscape';
    put(s, el(doc, 'pgSz', land ? { w: '16838', h: '11906', orient: 'landscape' } : { w: '11906', h: '16838' }));
    put(s, el(doc, 'pgMar', { top: '1134', right: '850', bottom: '1134', left: '1701', header: '709', footer: '709', gutter: '0' }));
  }
  if (!K(last, 'footerReference')) {
    const run = (inner) => `<w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/><w:sz w:val="24"/></w:rPr>${inner}</w:r>`;
    zip.file('word/footer_gost.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:ftr xmlns:w="${W}"><w:p><w:pPr><w:jc w:val="center"/></w:pPr>${run('<w:fldChar w:fldCharType="begin"/>')}${run('<w:instrText xml:space="preserve"> PAGE </w:instrText>')}${run('<w:fldChar w:fldCharType="separate"/>')}${run('<w:t>1</w:t>')}${run('<w:fldChar w:fldCharType="end"/>')}</w:p></w:ftr>`);
    const relsPath = 'word/_rels/document.xml.rels';
    const rels = await parse(relsPath);
    const rel = rels.createElementNS(rels.documentElement.namespaceURI, 'Relationship');
    rel.setAttribute('Id', 'rIdGostFooter');
    rel.setAttribute('Type', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer');
    rel.setAttribute('Target', 'footer_gost.xml');
    rels.documentElement.appendChild(rel);
    save(relsPath, rels);
    const ct = await parse('[Content_Types].xml');
    const ov = ct.createElementNS(ct.documentElement.namespaceURI, 'Override');
    ov.setAttribute('PartName', '/word/footer_gost.xml');
    ov.setAttribute('ContentType', 'application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml');
    ct.documentElement.appendChild(ov);
    save('[Content_Types].xml', ct);
    const ref = el(doc, 'footerReference', { type: 'default' });
    ref.setAttributeNS(R, 'r:id', 'rIdGostFooter');
    last.insertBefore(ref, last.firstElementChild);
  }
  save('word/document.xml', doc);
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}
