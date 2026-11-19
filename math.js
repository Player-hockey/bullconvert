'use strict';

/* BullConvert — формулы.
   Формулы Word (OMML) → MathML (браузер рисует настоящие дроби, корни, индексы) →
   картинка PNG для PDF/DOCX/FB2 или линейная запись для TXT/Markdown. */

const MATHML_NS = 'http://www.w3.org/1998/Math/MathML';

const mmlEsc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** OMML (элемент m:oMath или m:oMathPara) → строка MathML */
function ommlToMathML(el, display = false) {
  const K = (e, n) => { if (!e) return null; for (const c of e.children) if (c.localName === n) return c; return null; };
  const KS = (e, n) => (e ? [...e.children].filter((c) => c.localName === n) : []);
  const val = (e) => { if (!e) return null; for (const a of e.attributes) if (a.localName === 'val') return a.value; return null; };
  const prop = (e, pr, name) => val(K(K(e, pr), name));

  // текст: числа → mn, операторы → mo, буквы → mi (одна буква — курсив, слово — прямо)
  const tokens = (text, plain) => {
    let out = '';
    const re = /(\d+(?:[.,]\d+)*)|([+\-−=<>≤≥≠≈±×·÷∙∗/|∞∑∏∫∂∇→←⇒⇔∈∉⊂⊃∪∩∧∨¬%°′″!,;:()[\]{}])|(\s+)|([^\d\s+\-−=<>≤≥≠≈±×·÷∙∗/|∞∑∏∫∂∇→←⇒⇔∈∉⊂⊃∪∩∧∨¬%°′″!,;:()[\]{}]+)/g;
    let m;
    while ((m = re.exec(text))) {
      if (m[1]) out += `<mn>${mmlEsc(m[1])}</mn>`;
      else if (m[2]) out += `<mo>${mmlEsc(m[2] === '-' ? '−' : m[2])}</mo>`;
      else if (m[3]) out += '<mspace width="0.25em"/>';
      else if (m[4]) out += plain || m[4].length > 1 ? `<mi mathvariant="normal">${mmlEsc(m[4])}</mi>` : `<mi>${mmlEsc(m[4])}</mi>`;
    }
    return out;
  };
  const row = (e) => `<mrow>${kids(e)}</mrow>`;
  const kids = (e) => (e ? [...e.children].map(node).join('') : '');
  const arg = (e, n) => row(K(e, n));

  function node(e) {
    switch (e.localName) {
      case 'r': {
        const t = [...e.children].filter((c) => c.localName === 't').map((c) => c.textContent).join('');
        const plain = !!K(K(e, 'rPr'), 'nor') || prop(e, 'rPr', 'sty') === 'p';
        return tokens(t, plain);
      }
      case 'f': {
        const type = prop(e, 'fPr', 'type');
        if (type === 'lin') return `<mrow>${arg(e, 'num')}<mo>/</mo>${arg(e, 'den')}</mrow>`;
        return `<mfrac${type === 'noBar' ? ' linethickness="0"' : ''}>${arg(e, 'num')}${arg(e, 'den')}</mfrac>`;
      }
      case 'sSup': return `<msup>${arg(e, 'e')}${arg(e, 'sup')}</msup>`;
      case 'sSub': return `<msub>${arg(e, 'e')}${arg(e, 'sub')}</msub>`;
      case 'sSubSup': return `<msubsup>${arg(e, 'e')}${arg(e, 'sub')}${arg(e, 'sup')}</msubsup>`;
      case 'sPre': return `<mmultiscripts>${arg(e, 'e')}<mprescripts/>${arg(e, 'sub')}${arg(e, 'sup')}</mmultiscripts>`;
      case 'rad': {
        const deg = K(e, 'deg');
        const hide = prop(e, 'radPr', 'degHide') === '1' || prop(e, 'radPr', 'degHide') === 'on';
        return deg && deg.children.length && !hide ? `<mroot>${arg(e, 'e')}${row(deg)}</mroot>` : `<msqrt>${arg(e, 'e')}</msqrt>`;
      }
      case 'nary': {
        const chr = prop(e, 'naryPr', 'chr') || '∫';
        const under = prop(e, 'naryPr', 'limLoc') === 'undOvr' || (!prop(e, 'naryPr', 'limLoc') && chr !== '∫' && chr !== '∮');
        const sub = K(e, 'sub'), sup = K(e, 'sup');
        const op = `<mo largeop="true">${mmlEsc(chr)}</mo>`;
        const hasSub = sub && sub.children.length && prop(e, 'naryPr', 'subHide') !== '1';
        const hasSup = sup && sup.children.length && prop(e, 'naryPr', 'supHide') !== '1';
        let big = op;
        if (hasSub && hasSup) big = under ? `<munderover>${op}${row(sub)}${row(sup)}</munderover>` : `<msubsup>${op}${row(sub)}${row(sup)}</msubsup>`;
        else if (hasSub) big = under ? `<munder>${op}${row(sub)}</munder>` : `<msub>${op}${row(sub)}</msub>`;
        else if (hasSup) big = under ? `<mover>${op}${row(sup)}</mover>` : `<msup>${op}${row(sup)}</msup>`;
        return `<mrow>${big}${arg(e, 'e')}</mrow>`;
      }
      case 'd': {
        const pr = K(e, 'dPr');
        const beg = val(K(pr, 'begChr')) ?? '(', end = val(K(pr, 'endChr')) ?? ')', sep = val(K(pr, 'sepChr')) ?? '|';
        const parts = KS(e, 'e').map(row);
        return `<mrow>${beg ? `<mo fence="true">${mmlEsc(beg)}</mo>` : ''}${parts.join(`<mo>${mmlEsc(sep)}</mo>`)}${end ? `<mo fence="true">${mmlEsc(end)}</mo>` : ''}</mrow>`;
      }
      case 'func': return `<mrow>${arg(e, 'fName')}<mo>&#x2061;</mo>${arg(e, 'e')}</mrow>`;
      case 'acc': {
        const chr = prop(e, 'accPr', 'chr') || '̂';
        const map = { '̂': '^', '̃': '~', '̄': '¯', '⃗': '→', '̇': '˙', '̈': '¨', '́': '´', '̀': '`', '̆': '˘', '̌': 'ˇ' };
        return `<mover accent="true">${arg(e, 'e')}<mo>${mmlEsc(map[chr] || chr)}</mo></mover>`;
      }
      case 'bar': return prop(e, 'barPr', 'pos') === 'bot' ? `<munder>${arg(e, 'e')}<mo>_</mo></munder>` : `<mover>${arg(e, 'e')}<mo>¯</mo></mover>`;
      case 'groupChr': {
        const chr = prop(e, 'groupChrPr', 'chr') || '⏟';
        return prop(e, 'groupChrPr', 'pos') === 'top' ? `<mover>${arg(e, 'e')}<mo>${mmlEsc(chr)}</mo></mover>` : `<munder>${arg(e, 'e')}<mo>${mmlEsc(chr)}</mo></munder>`;
      }
      case 'limLow': return `<munder>${arg(e, 'e')}${arg(e, 'lim')}</munder>`;
      case 'limUpp': return `<mover>${arg(e, 'e')}${arg(e, 'lim')}</mover>`;
      case 'm': return `<mtable>${KS(e, 'mr').map((r) => `<mtr>${KS(r, 'e').map((c) => `<mtd>${row(c)}</mtd>`).join('')}</mtr>`).join('')}</mtable>`;
      case 'eqArr': return `<mtable columnalign="left">${KS(e, 'e').map((c) => `<mtr><mtd>${row(c)}</mtd></mtr>`).join('')}</mtable>`;
      case 'box': case 'borderBox': case 'phant': case 'e': case 'num': case 'den': case 'sub': case 'sup': case 'deg': case 'lim': case 'fName':
        return row(e);
      case 'oMath': return kids(e);
      case 'oMathPara': return KS(e, 'oMath').map((m) => `<mrow>${kids(m)}</mrow>`).join('<mspace linebreak="newline"/>');
      default: return ''; // свойства (…Pr), закладки и прочее
    }
  }
  const body = e => (e.localName === 'oMathPara' ? node(e) : kids(e));
  return `<math xmlns="${MATHML_NS}"${display ? ' display="block"' : ''}><mrow>${body(el)}</mrow></math>`;
}

/** Есть ли в формуле двумерные конструкции (дробь, корень, сумма, матрица…) — тогда рисуем картинкой */
function ommlIsComplex(el) {
  return el.getElementsByTagNameNS('*', 'f').length + el.getElementsByTagNameNS('*', 'rad').length +
    el.getElementsByTagNameNS('*', 'nary').length + el.getElementsByTagNameNS('*', 'm').length +
    el.getElementsByTagNameNS('*', 'eqArr').length + el.getElementsByTagNameNS('*', 'limLow').length +
    el.getElementsByTagNameNS('*', 'limUpp').length + el.getElementsByTagNameNS('*', 'groupChr').length +
    el.getElementsByTagNameNS('*', 'acc').length + el.getElementsByTagNameNS('*', 'bar').length > 0;
}

/** Простая формула (индексы, степени) → куски текста { text, va: 'superscript'|'subscript'|null } */
function ommlToRuns(el) {
  const out = [];
  const K = (e, n) => { if (!e) return null; for (const c of e.children) if (c.localName === n) return c; return null; };
  const walk = (e, va) => {
    for (const c of e.children) {
      switch (c.localName) {
        case 'r': { const t = [...c.children].filter((x) => x.localName === 't').map((x) => x.textContent).join(''); if (t) out.push({ text: t.replace(/-/g, '−'), va }); break; }
        case 'sSup': walk(K(c, 'e') || c, va); walk(K(c, 'sup') || c, 'superscript'); break;
        case 'sSub': walk(K(c, 'e') || c, va); walk(K(c, 'sub') || c, 'subscript'); break;
        case 'sSubSup': walk(K(c, 'e') || c, va); walk(K(c, 'sub') || c, 'subscript'); walk(K(c, 'sup') || c, 'superscript'); break;
        case 'd': {
          const pr = K(c, 'dPr');
          const v = (n, d) => { const x = K(pr, n); if (!x) return d; for (const a of x.attributes) if (a.localName === 'val') return a.value; return d; };
          out.push({ text: v('begChr', '('), va }); walk(c, va); out.push({ text: v('endChr', ')'), va }); break;
        }
        case 'func': walk(K(c, 'fName') || c, va); out.push({ text: ' ', va }); walk(K(c, 'e') || c, va); break;
        default: if (!/Pr$/.test(c.localName)) walk(c, va);
      }
    }
  };
  walk(el, null);
  return out.filter((r) => r.text);
}

/** MathML → линейная запись для TXT/Markdown: (a+b)/c, x^2, √(x) */
function mathmlToLinear(m) {
  const lin = (e) => {
    if (!e) return '';
    if (e.nodeType === 3) return e.textContent;
    const k = [...e.children];
    const wrap = (s) => (s.length > 1 && !/^[\w.,]+$/.test(s) ? `(${s})` : s);
    switch (e.localName) {
      case 'mfrac': return `${wrap(lin(k[0]))}/${wrap(lin(k[1]))}`;
      case 'msup': return `${lin(k[0])}^${wrap(lin(k[1]))}`;
      case 'msub': return `${lin(k[0])}_${wrap(lin(k[1]))}`;
      case 'msubsup': return `${lin(k[0])}_${wrap(lin(k[1]))}^${wrap(lin(k[2]))}`;
      case 'msqrt': return `√(${k.map(lin).join('')})`;
      case 'mroot': return `${wrap(lin(k[1]))}√(${lin(k[0])})`;
      case 'munderover': return `${lin(k[0])}_${wrap(lin(k[1]))}^${wrap(lin(k[2]))}`;
      case 'munder': return `${lin(k[0])}_${wrap(lin(k[1]))}`;
      case 'mover': return `${lin(k[0])}${lin(k[1]) === '¯' ? '̅' : '^' + wrap(lin(k[1]))}`;
      case 'mtable': return k.map((r) => [...r.children].map(lin).join(' ')).join('; ');
      case 'mspace': return e.getAttribute('linebreak') === 'newline' ? '\n' : ' ';
      case 'mo': { const t = e.textContent; return t === '⁡' ? '' : /[=<>≤≥≠≈±×÷→⇒]/.test(t) ? ` ${t} ` : t; }
      default: return k.length ? k.map(lin).join('') : e.textContent;
    }
  };
  return lin(m).replace(/ {2,}/g, ' ').trim();
}

/**
 * MathML → картинка PNG (браузер рисует формулу, затем снимок через SVG).
 * Возвращает { url, w, h } в pt (при fontPt), либо null, если браузер не умеет.
 */
const mathPngCache = new Map();
async function mathmlToPng(mathml, fontPt = 12) {
  const key = fontPt + '|' + mathml;
  if (mathPngCache.has(key)) return mathPngCache.get(key);
  const px = fontPt * 4 / 3; // 1pt = 4/3 px
  const host = document.createElement('div');
  host.style.cssText = `position:fixed;left:-10000px;top:0;font-size:${px}px;line-height:1.2;color:#000;background:#fff;padding:2px 3px;font-family:'Cambria Math','STIX Two Math','Latin Modern Math','Times New Roman',serif;white-space:nowrap;display:inline-block`;
  host.innerHTML = mathml;
  document.body.appendChild(host);
  let res = null;
  try {
    const r = host.getBoundingClientRect();
    const w = Math.ceil(r.width) + 2, h = Math.ceil(r.height) + 2;
    if (w < 4 || h < 4) return null;
    const scale = 3;
    // стиль без позиционирования; кавычки в именах шрифтов — одинарные, иначе разметка картинки ломается
    const css = host.style.cssText.replace(/position:[^;]+;|left:[^;]+;|top:[^;]+;/g, '').replace(/"/g, "'");
    const xhtml = `<div xmlns="http://www.w3.org/1999/xhtml" style="${css}">${host.innerHTML}</div>`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w * scale}" height="${h * scale}"><foreignObject width="${w}" height="${h}" transform="scale(${scale})">${xhtml}</foreignObject></svg>`;
    const img = await imageFromUrl('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg));
    const c = document.createElement('canvas');
    c.width = w * scale; c.height = h * scale;
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(img, 0, 0);
    res = { url: c.toDataURL('image/png'), w: w * 0.75, h: h * 0.75 };
  } catch {
    res = null; // браузер запретил снимок (Safari) — вызывающий использует линейную запись
  } finally {
    host.remove();
  }
  mathPngCache.set(key, res);
  return res;
}

/**
 * Формулы в HTML: каждую <math> заменяем картинкой (для PDF, DOCX, FB2 — там MathML не понимают).
 * Если картинку сделать нельзя — линейная запись.
 */
async function mathToImages(html, fontPt = 12) {
  if (!/<math[\s>]/i.test(html)) return html;
  const root = document.createElement('div');
  root.innerHTML = html;
  for (const m of [...root.querySelectorAll('math')]) {
    const block = m.getAttribute('display') === 'block';
    const png = await mathmlToPng(m.outerHTML, fontPt);
    if (png) {
      const img = document.createElement('img');
      img.src = png.url;
      img.setAttribute('width', String(Math.round(png.w / 0.75)));
      img.setAttribute('height', String(Math.round(png.h / 0.75)));
      img.setAttribute('alt', mathmlToLinear(m));
      img.className = 'bc-math';
      if (block) { const p = document.createElement('p'); p.style.textAlign = 'center'; p.appendChild(img); m.replaceWith(p); }
      else m.replaceWith(img);
    } else m.replaceWith(document.createTextNode(mathmlToLinear(m)));
  }
  return root.innerHTML;
}

/** Формулы в HTML → линейная запись (для TXT и Markdown) */
function mathToLinear(html) {
  if (!/<math[\s>]/i.test(html)) return html;
  const root = document.createElement('div');
  root.innerHTML = html;
  for (const m of [...root.querySelectorAll('math')]) m.replaceWith(document.createTextNode(mathmlToLinear(m)));
  return root.innerHTML;
}

/**
 * DOCX для mammoth: mammoth формулы выбрасывает. Заменяем каждую m:oMath меткой ⟦MATHn⟧,
 * после mammoth метки → MathML. Возвращает { buffer, formulas[] } (formulas — MathML).
 */
async function docxMathPrepare(arrayBuffer) {
  await loadLib('jszip');
  const zip = await JSZip.loadAsync(arrayBuffer);
  const f = zip.file('word/document.xml');
  if (!f) return { buffer: arrayBuffer, formulas: [] };
  const xml = await f.async('string');
  if (!/<m:oMath/.test(xml)) return { buffer: arrayBuffer, formulas: [] };
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const formulas = [];
  // сначала целые блоки формул, затем одиночные (вне блоков)
  const all = [...doc.getElementsByTagNameNS('*', 'oMathPara'), ...[...doc.getElementsByTagNameNS('*', 'oMath')].filter((m) => !m.parentElement || m.parentElement.localName !== 'oMathPara')];
  for (const m of all) {
    const display = m.localName === 'oMathPara';
    formulas.push(ommlToMathML(m, display));
    const r = doc.createElementNS(W, 'w:r');
    const t = doc.createElementNS(W, 'w:t');
    t.textContent = `⟦MATH${formulas.length - 1}⟧`;
    r.appendChild(t);
    // блок формул стоит прямо в абзаце (w:p) — метка-ран на его месте
    m.parentNode.replaceChild(r, m);
  }
  zip.file('word/document.xml', new XMLSerializer().serializeToString(doc));
  return { buffer: await zip.generateAsync({ type: 'arraybuffer' }), formulas };
}
function docxMathRestore(html, formulas) {
  if (!formulas.length) return html;
  // блочная формула — отдельным абзацем по центру
  html = html.replace(/<p>\s*⟦MATH(\d+)⟧\s*<\/p>/g, (s, i) => (formulas[+i] && formulas[+i].includes('display="block"') ? `<p style="text-align:center">${formulas[+i]}</p>` : s));
  return html.replace(/⟦MATH(\d+)⟧/g, (s, i) => formulas[+i] || '');
}
