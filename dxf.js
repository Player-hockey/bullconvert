'use strict';

/* BullConvert — чертежи DXF прямо в браузере (без КОМПАС/AutoCAD): разбор DXF, отрисовка в SVG,
   из SVG — векторный PDF, PNG и JPG. Линии, полилинии (с дугами), окружности, дуги, эллипсы, сплайны,
   тексты, блоки (вставки и размеры), цвета слоёв, толщины линий. */

// цвета AutoCAD (ACI) — основные; 7 (белый/чёрный) на бумаге чёрный
const ACI = { 1: '#ff0000', 2: '#c8b400', 3: '#00a000', 4: '#00a0c8', 5: '#0000ff', 6: '#c800c8', 7: '#000000', 8: '#808080', 9: '#a0a0a0', 30: '#ff7f00', 40: '#ff9f00', 140: '#0080ff', 150: '#0060c0', 250: '#333333', 251: '#505050', 252: '#696969', 253: '#828282', 254: '#bebebe', 255: '#ffffff' };

async function dxfToSvg(file) {
  // кодировка: новые DXF — UTF-8, старые русские — Windows-1251 ($DWGCODEPAGE ANSI_1251)
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (String.fromCharCode(...bytes.subarray(0, 22)) === 'AutoCAD Binary DXF\r\n\x1a\x00') throw new Error('Двоичный DXF не поддерживается в браузере — сохраните чертёж как текстовый DXF.');
  let text = new TextDecoder('latin1').decode(bytes.subarray(0, 4000));
  const cp = /\$DWGCODEPAGE\s*\r?\n\s*3\s*\r?\n\s*ANSI_(\d+)/.exec(text);
  const ver = /\$ACADVER\s*\r?\n\s*1\s*\r?\n\s*AC(\d+)/.exec(text);
  const utf8 = !ver || +ver[1] >= 1021;
  try { text = new TextDecoder(utf8 ? 'utf-8' : `windows-${cp ? cp[1] : '1251'}`, { fatal: utf8 }).decode(bytes); }
  catch { text = new TextDecoder(`windows-${cp ? cp[1] : '1251'}`).decode(bytes); }

  // пары «код — значение»
  const lines = text.split(/\r?\n/);
  const pairs = [];
  for (let i = 0; i + 1 < lines.length; i += 2) pairs.push([parseInt(lines[i], 10), lines[i + 1]]);
  let p = 0;
  const layers = {}, blocks = {}, entities = [], tstyles = {}, ltypes = {};
  const ltscale = (() => { const m = /\$LTSCALE\s*\r?\n\s*40\s*\r?\n\s*([-\d.eE+]+)/.exec(text); return m ? +m[1] || 1 : 1; })();
  const readEntity = () => {
    const e = { type: pairs[p][1].trim(), g: [] };
    p++;
    while (p < pairs.length && pairs[p][0] !== 0) { e.g.push(pairs[p]); p++; }
    return e;
  };
  const val = (e, code, d = null) => { const x = e.g.find((q) => q[0] === code); return x ? x[1].trim() : d; };
  const num = (e, code, d = 0) => { const v = val(e, code); const n = v == null ? NaN : parseFloat(v); return Number.isFinite(n) ? n : d; };
  const all = (e, code) => e.g.filter((q) => q[0] === code).map((q) => parseFloat(q[1]));
  // секции
  while (p < pairs.length) {
    if (pairs[p][0] === 0 && pairs[p][1].trim() === 'SECTION') {
      const name = pairs[p + 1] && pairs[p + 1][1].trim();
      p += 2;
      if (name === 'TABLES') {
        while (p < pairs.length && !(pairs[p][0] === 0 && pairs[p][1].trim() === 'ENDSEC')) {
          const kind = pairs[p][0] === 0 && pairs[p][1].trim();
          if (kind === 'LAYER') {
            const e = readEntity();
            layers[val(e, 2, '0')] = { color: Math.abs(num(e, 62, 7)), off: num(e, 62, 7) < 0, lw: num(e, 370, -3), lt: val(e, 6, 'Continuous') };
          } else if (kind === 'STYLE') {
            const e = readEntity();
            tstyles[(val(e, 2) || '').toUpperCase()] = { w: num(e, 41, 1) || 1, obl: num(e, 50, 0), font: val(e, 3, '') || '' };
          } else if (kind === 'LTYPE') {
            const e = readEntity();
            const d = all(e, 49);
            if (d.length) ltypes[(val(e, 2) || '').toUpperCase()] = d;
          } else p++;
        }
      } else if (name === 'BLOCKS') {
        let cur = null;
        while (p < pairs.length && !(pairs[p][0] === 0 && pairs[p][1].trim() === 'ENDSEC')) {
          if (pairs[p][0] !== 0) { p++; continue; }
          const e = readEntity();
          if (e.type === 'BLOCK') { cur = { name: val(e, 2), bx: num(e, 10), by: num(e, 20), ents: [] }; blocks[cur.name] = cur; }
          else if (e.type === 'ENDBLK') cur = null;
          else if (cur) cur.ents.push(e);
        }
      } else if (name === 'ENTITIES') {
        while (p < pairs.length && !(pairs[p][0] === 0 && pairs[p][1].trim() === 'ENDSEC')) {
          if (pairs[p][0] !== 0) { p++; continue; }
          entities.push(readEntity());
        }
      }
    } else p++;
  }
  if (!entities.length) throw new Error('В DXF нет объектов чертежа.');

  // старые POLYLINE: вершины идут отдельными объектами до SEQEND
  const groupPolylines = (list) => {
    const out = [];
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.type === 'POLYLINE') {
        e.verts = [];
        while (i + 1 < list.length && list[i + 1].type === 'VERTEX') { i++; e.verts.push({ x: num(list[i], 10), y: num(list[i], 20), b: num(list[i], 42) }); }
        if (i + 1 < list.length && list[i + 1].type === 'SEQEND') i++;
      }
      out.push(e);
    }
    return out;
  };
  for (const b of Object.values(blocks)) b.ents = groupPolylines(b.ents);
  const ents = groupPolylines(entities);

  // геометрия → примитивы в координатах чертежа: {k:'path', pts|d…} и {k:'text'}
  const prims = [];
  // чертёж печатается чёрным (как PDF из КОМПАС/AutoCAD при печати), белый — тоже чёрным
  const colorOf = () => '#000000';
  const colorOfReal = (e, inherit) => {
    const lay = layers[val(e, 8, '0')] || { color: 7 };
    let c = num(e, 62, 256);
    if (c === 256) c = lay.color;
    if (c === 0) return inherit || '#000000';
    const tc = val(e, 420);
    if (tc) return '#' + (+tc).toString(16).padStart(6, '0');
    return ACI[c] || '#000000';
  };
  void colorOfReal;
  const dashOf = (e, inheritLt, scale) => {
    let lt = (val(e, 6) || 'BYLAYER').toUpperCase();
    if (lt === 'BYLAYER') lt = ((layers[val(e, 8, '0')] || {}).lt || 'CONTINUOUS').toUpperCase();
    if (lt === 'BYBLOCK') lt = inheritLt || 'CONTINUOUS';
    const d = ltypes[lt];
    if (!d) return null;
    const k = ltscale * num(e, 48, 1) * scale;
    return d.map((x) => Math.abs(x) * k);
  };
  const widthOf = (e) => { let w = num(e, 370, -1); if (w < 0) { const lay = layers[val(e, 8, '0')]; w = lay && lay.lw > 0 ? lay.lw : 25; } return w / 100; }; // мм
  const hidden = (e) => { const lay = layers[val(e, 8, '0')]; return (lay && lay.off) || num(e, 60, 0) === 1; };
  const mtextPlain = (s) => s.replace(/\\P/g, '\n').replace(/\\[A-Za-z][^;\\{}]*;/g, '').replace(/\\[LlOoKk]/g, '').replace(/[{}]/g, '')
    .replace(/\\U\+([0-9A-Fa-f]{4})/g, (m, h) => String.fromCharCode(parseInt(h, 16))).replace(/%%[cC]/g, 'Ø').replace(/%%[dD]/g, '°').replace(/%%[pP]/g, '±').replace(/\\~/g, ' ');

  const emit = (list, M, inherit, depth) => {
    if (depth > 8) return;
    const T = (x, y) => [M[0] * x + M[2] * y + M[4], M[1] * x + M[3] * y + M[5]];
    const scaleOf = Math.sqrt(Math.abs(M[0] * M[3] - M[1] * M[2])) || 1;
    for (const e of list) {
      if (hidden(e)) continue;
      const color = colorOf(e, inherit), w = widthOf(e), dash = dashOf(e, null, scaleOf);
      const path = (pts, closed = false) => pts.length > 1 && prims.push({ k: 'path', pts: pts.map(([x, y]) => T(x, y)), closed, color, w, dash });
      const arcPts = (cx, cy, r, a0, a1, rx2 = r, rot = 0) => {
        // дуга против часовой стрелки от a0 до a1 (градусы) — набор точек
        let span = a1 - a0; while (span <= 0) span += 360;
        const n = Math.max(8, Math.ceil(span / 4)), pts = [];
        for (let i = 0; i <= n; i++) {
          const a = (a0 + span * i / n) * Math.PI / 180, ca = Math.cos(a) * r, sa = Math.sin(a) * rx2;
          pts.push([cx + ca * Math.cos(rot) - sa * Math.sin(rot), cy + ca * Math.sin(rot) + sa * Math.cos(rot)]);
        }
        return pts;
      };
      const bulgePts = (vs, closed) => {
        const out = [];
        const n = vs.length;
        for (let i = 0; i < n; i++) {
          const a = vs[i], b = vs[(i + 1) % n];
          out.push([a.x, a.y]);
          if (i === n - 1 && !closed) break;
          if (a.b) {
            // сегмент-дуга: прогиб = tg(угол/4)
            const th = 4 * Math.atan(a.b), dx = b.x - a.x, dy = b.y - a.y, ch = Math.hypot(dx, dy);
            if (ch > 0) {
              const r = ch / (2 * Math.sin(Math.abs(th) / 2));
              const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, hgt = r * Math.cos(Math.abs(th) / 2);
              const s = a.b > 0 ? 1 : -1;
              const cx = mx - s * hgt * dy / ch, cy = my + s * hgt * dx / ch;
              const a0 = Math.atan2(a.y - cy, a.x - cx), steps = Math.max(4, Math.ceil(Math.abs(th) * 180 / Math.PI / 5));
              for (let k = 1; k < steps; k++) { const ang = a0 + th * k / steps; out.push([cx + r * Math.cos(ang), cy + r * Math.sin(ang)]); }
            }
          }
        }
        return out;
      };
      switch (e.type) {
        case 'LINE': path([[num(e, 10), num(e, 20)], [num(e, 11), num(e, 21)]]); break;
        case 'XLINE': case 'RAY': break; // бесконечные линии на бумаге не рисуем
        case 'LWPOLYLINE': {
          const xs = all(e, 10), ys = all(e, 20), vs = [];
          // прогиб (42) относится к вершине перед ним
          let vi = -1;
          for (const [code, v] of e.g) { if (code === 10) vs[++vi] = { x: parseFloat(v), y: ys[vi], b: 0 }; else if (code === 42 && vi >= 0) vs[vi].b = parseFloat(v); }
          void xs;
          const closed = (num(e, 70) & 1) === 1;
          path(bulgePts(vs, closed), closed);
          break;
        }
        case 'POLYLINE': { const closed = (num(e, 70) & 1) === 1; if (e.verts && e.verts.length) path(bulgePts(e.verts, closed), closed); break; }
        case 'CIRCLE': path(arcPts(num(e, 10), num(e, 20), num(e, 40), 0, 360), true); break;
        case 'ARC': path(arcPts(num(e, 10), num(e, 20), num(e, 40), num(e, 50), num(e, 51))); break;
        case 'ELLIPSE': {
          const cx = num(e, 10), cy = num(e, 20), mx = num(e, 11), my = num(e, 21), ratio = num(e, 40, 1);
          const r = Math.hypot(mx, my), rot = Math.atan2(my, mx);
          const t0 = num(e, 41, 0) * 180 / Math.PI, t1 = num(e, 42, Math.PI * 2) * 180 / Math.PI;
          path(arcPts(cx, cy, r, t0, t1 === t0 ? t0 + 360 : t1, r * ratio, rot));
          break;
        }
        case 'SPLINE': {
          const deg = num(e, 71, 3), knots = all(e, 40), cxs = all(e, 10), cys = all(e, 20);
          const fx = all(e, 11), fy = all(e, 21);
          let pts;
          if (cxs.length > deg && knots.length === cxs.length + deg + 1) {
            // B-сплайн: алгоритм де Бура
            const P = cxs.map((x, i) => [x, cys[i]]);
            const lo = knots[deg], hi = knots[knots.length - deg - 1];
            pts = [];
            for (let s = 0; s <= 80; s++) {
              const t = lo + (hi - lo) * s / 80;
              let k = deg; while (k < knots.length - deg - 2 && t >= knots[k + 1]) k++;
              const d = []; for (let j = 0; j <= deg; j++) d.push([...P[k - deg + j]]);
              for (let r = 1; r <= deg; r++) for (let j = deg; j >= r; j--) {
                const i = k - deg + j, den = knots[i + deg - r + 1] - knots[i];
                const a = den ? (t - knots[i]) / den : 0;
                d[j] = [(1 - a) * d[j - 1][0] + a * d[j][0], (1 - a) * d[j - 1][1] + a * d[j][1]];
              }
              pts.push(d[deg]);
            }
          } else pts = (fx.length ? fx.map((x, i) => [x, fy[i]]) : cxs.map((x, i) => [x, cys[i]]));
          path(pts, (num(e, 70) & 1) === 1);
          break;
        }
        case 'SOLID': case '3DFACE': case 'TRACE': {
          const q = [[num(e, 10), num(e, 20)], [num(e, 11), num(e, 21)], [num(e, 13), num(e, 23)], [num(e, 12), num(e, 22)]];
          prims.push({ k: 'path', pts: q.map(([x, y]) => T(x, y)), closed: true, color, w, fill: e.type !== '3DFACE' });
          break;
        }
        case 'HATCH': {
          // контуры штриховки
          const loops = [];
          const g = e.g;
          let i = g.findIndex((q) => q[0] === 91);
          const nLoops = i >= 0 ? parseInt(g[i][1], 10) : 0;
          i++;
          const take = (code) => { while (i < g.length && g[i][0] !== code) i++; return i < g.length ? parseFloat(g[i++][1]) : 0; };
          for (let L = 0; L < nLoops && i < g.length; L++) {
            const flags = take(92);
            const pts = [];
            if (flags & 2) {
              const hasB = take(72), _closed = take(73), n = take(93); void _closed;
              const vs = [];
              for (let v = 0; v < n; v++) { const x = take(10), y = take(20); let b = 0; if (hasB && i < g.length && g[i][0] === 42) b = parseFloat(g[i++][1]); vs.push({ x, y, b }); }
              pts.push(...bulgePts(vs, true));
            } else {
              const n = take(93);
              for (let ed = 0; ed < n; ed++) {
                const type = take(72);
                if (type === 1) { const x0 = take(10), y0 = take(20), x1 = take(11), y1 = take(21); pts.push([x0, y0], [x1, y1]); }
                else if (type === 2) { const cx = take(10), cy = take(20), r = take(40); const a0 = take(50), a1 = take(51); const ccw = take(73); // по часовой стрелке углы записаны со знаком минус: идём обратно
                  if (!ccw) pts.push(...arcPts(cx, cy, r, 360 - a1, 360 - a0).reverse()); else pts.push(...arcPts(cx, cy, r, a0, a1)); }
                else if (type === 3) { const cx = take(10), cy = take(20), mx = take(11), my = take(21), ratio = take(40), a0 = take(50), a1 = take(51); take(73); const r = Math.hypot(mx, my); pts.push(...arcPts(cx, cy, r, a0, a1, r * ratio, Math.atan2(my, mx))); }
                else if (type === 4) { const nk = take(95), nc = take(96); for (let q = 0; q < nk; q++) take(40); for (let q = 0; q < nc; q++) pts.push([take(10), take(20)]); }
              }
            }
            if (pts.length > 2) loops.push(pts);
          }
          if (!loops.length) break;
          const solid = num(e, 70) === 1;
          const tl = loops.map((lp) => lp.map(([x, y]) => T(x, y)));
          if (solid) { prims.push({ k: 'poly', loops: tl, color }); break; }
          // линии узора: угол (53) и шаг (45/46) каждой линии узора; без узора — 45° с шагом 3
          const pat = [];
          for (let q = 0; q < g.length; q++) if (g[q][0] === 53) {
            const ang = parseFloat(g[q][1]); let ox = 0, oy = 0, bx = 0, by = 0;
            for (let r = q + 1; r < Math.min(g.length, q + 6); r++) { if (g[r][0] === 43) bx = +g[r][1]; if (g[r][0] === 44) by = +g[r][1]; if (g[r][0] === 45) ox = +g[r][1]; if (g[r][0] === 46) oy = +g[r][1]; }
            pat.push({ ang, ox, oy, bx, by });
          }
          if (!pat.length) pat.push({ ang: 45, ox: -2.12, oy: 2.12, bx: 0, by: 0 });
          // отрезки узора внутри контура (правило чёт-нечёт)
          const edges = [];
          for (const lp of tl) for (let q = 0; q < lp.length; q++) edges.push([lp[q], lp[(q + 1) % lp.length]]);
          const xs = tl.flat().map((v) => v[0]), ys = tl.flat().map((v) => v[1]);
          const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
          const R = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / 2 + 1;
          for (const pl of pat) {
            const a = pl.ang * Math.PI / 180 + Math.atan2(M[1], M[0]);
            const ux = Math.cos(a), uy = Math.sin(a), nx = -uy, ny = ux;
            let step = Math.abs(-Math.sin(pl.ang * Math.PI / 180) * pl.ox + Math.cos(pl.ang * Math.PI / 180) * pl.oy) * scaleOf;
            if (!(step > 0)) step = 3 * scaleOf;
            while (2 * R / step > 1500) step *= 2;
            const [bx, by] = T(pl.bx, pl.by);
            const off0 = Math.ceil(((cx - bx) * nx + (cy - by) * ny - R) / step);
            for (let n = off0; n * step <= (cx - bx) * nx + (cy - by) * ny + R; n++) {
              const px = bx + nx * n * step, py = by + ny * n * step;
              const ts = [];
              for (const [p1, p2] of edges) {
                const ex = p2[0] - p1[0], ey = p2[1] - p1[1];
                const den = ux * ey - uy * ex;
                if (Math.abs(den) < 1e-12) continue;
                const t = ((p1[0] - px) * ey - (p1[1] - py) * ex) / den, u = ((p1[0] - px) * uy - (p1[1] - py) * ux) / den;
                if (u >= 0 && u < 1) ts.push(t);
              }
              ts.sort((p1, p2) => p1 - p2);
              for (let q = 0; q + 1 < ts.length; q += 2) prims.push({ k: 'path', pts: [[px + ux * ts[q], py + uy * ts[q]], [px + ux * ts[q + 1], py + uy * ts[q + 1]]], closed: false, color, w: Math.min(w, 0.25) });
            }
          }
          break;
        }
        case 'POINT': { const [x, y] = T(num(e, 10), num(e, 20)); prims.push({ k: 'dot', x, y, color }); break; }
        case 'TEXT': case 'ATTRIB': case 'MTEXT': {
          if (e.type === 'ATTRIB' && (num(e, 70) & 1)) break; // невидимый атрибут
          const mt = e.type === 'MTEXT';
          let s = mt ? e.g.filter((q) => q[0] === 3 || q[0] === 1).map((q) => q[1]).join('') : (val(e, 1) || '');
          s = mtextPlain(s);
          if (!s.trim()) break;
          const h = num(e, 40, 2.5) * scaleOf;
          let x = num(e, 10), y = num(e, 20), anchor = 'start', base = 'alphabetic';
          if (!mt && (num(e, 72) || num(e, 73)) && val(e, 11) != null) {
            x = num(e, 11); y = num(e, 21);
            anchor = ['start', 'middle', 'end', 'start', 'middle', 'start'][num(e, 72)] || 'start';
            base = { 1: 'alphabetic', 2: 'middle', 3: 'hanging' }[num(e, 73)] || 'alphabetic';
          }
          if (mt) {
            const ap = num(e, 71, 1);
            anchor = ['start', 'middle', 'end'][(ap - 1) % 3];
            base = ap <= 3 ? 'hanging' : ap <= 6 ? 'middle' : 'alphabetic';
          }
          let rot = num(e, 50, 0);
          if (mt && val(e, 11) != null) rot = Math.atan2(num(e, 21), num(e, 11)) * 180 / Math.PI;
          const [tx, ty] = T(x, y);
          const mrot = Math.atan2(M[1], M[0]) * 180 / Math.PI;
          const sty = tstyles[(val(e, 7, 'STANDARD') || 'STANDARD').toUpperCase()] || { w: 1, obl: 0, font: '' };
          const wf = (mt ? sty.w : num(e, 41, sty.w)) || 1;
          // чертёжный шрифт ГОСТ (и большинство шрифтов САПР) уже обычного — сжимаем по ширине
          const narrow = /gost|txt|simplex|romans|isocp|\.shx/i.test(sty.font) ? 0.78 : 0.9;
          const italic = /gost|_a|_au/i.test(sty.font) || (mt ? sty.obl : num(e, 51, sty.obl)) !== 0;
          prims.push({ k: 'text', x: tx, y: ty, h, s, rot: rot + mrot, anchor, base, color, sx: wf * narrow, italic });
          break;
        }
        case 'INSERT': case 'DIMENSION': {
          const b = blocks[val(e, 2)];
          if (!b) break;
          let N;
          if (e.type === 'DIMENSION') N = M; // у размеров блок уже в координатах чертежа
          else {
            const sx = num(e, 41, 1), sy = num(e, 42, 1), ang = num(e, 50, 0) * Math.PI / 180, ix = num(e, 10), iy = num(e, 20);
            const ca = Math.cos(ang), sa = Math.sin(ang);
            // перенос в точку вставки × поворот × масштаб × сдвиг базовой точки блока
            const L = [ca * sx, sa * sx, -sa * sy, ca * sy, ix - (ca * sx * b.bx - sa * sy * b.by), iy - (sa * sx * b.bx + ca * sy * b.by)];
            N = [M[0] * L[0] + M[2] * L[1], M[1] * L[0] + M[3] * L[1], M[0] * L[2] + M[2] * L[3], M[1] * L[2] + M[3] * L[3], M[0] * L[4] + M[2] * L[5] + M[4], M[1] * L[4] + M[3] * L[5] + M[5]];
          }
          emit(b.ents, N, color, depth + 1);
          break;
        }
        default: break;
      }
    }
  };
  emit(ents, [1, 0, 0, 1, 0, 0], null, 0);
  if (!prims.length) throw new Error('Не удалось нарисовать чертёж: нет поддерживаемых объектов.');

  // границы чертежа
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const addPt = (x, y) => { if (!Number.isFinite(x) || !Number.isFinite(y)) return; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
  for (const q of prims) { if (q.k === 'path') q.pts.forEach(([x, y]) => addPt(x, y)); else if (q.k === 'poly') q.loops.flat().forEach(([x, y]) => addPt(x, y)); else { addPt(q.x, q.y); if (q.k === 'text') addPt(q.x + q.h * q.s.length * 0.6 * (q.sx || 1), q.y + q.h); } }
  const dw = Math.max(1e-6, x1 - x0), dh = Math.max(1e-6, y1 - y0);
  // лист: A4 или A3 (по размеру чертежа в мм, если он сам похож на формат), ориентация по пропорциям
  const landscape = dw > dh;
  const big = Math.max(dw, dh) > 330 && Math.max(dw, dh) < 460;
  const [pw, ph] = big ? (landscape ? [1190.55, 841.89] : [841.89, 1190.55]) : (landscape ? [841.89, 595.28] : [595.28, 841.89]);
  const m = 20;
  const s = Math.min((pw - 2 * m) / dw, (ph - 2 * m) / dh);
  const ox = m + ((pw - 2 * m) - dw * s) / 2, oy = m + ((ph - 2 * m) - dh * s) / 2;
  const X = (x) => +(ox + (x - x0) * s).toFixed(2), Y = (y) => +(oy + (y1 - y) * s).toFixed(2);
  const lw = (mm) => Math.max(0.25, mm * 72 / 25.4 * 0.8);
  const esc = (t) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const parts = [];
  for (const q of prims) {
    if (q.k === 'path') {
      const d = q.pts.map(([x, y], i) => `${i ? 'L' : 'M'}${X(x)} ${Y(y)}`).join('') + (q.closed ? 'Z' : '');
      const dash = q.dash && q.dash.some((v) => v > 0) ? ` stroke-dasharray="${q.dash.map((v) => Math.max(0.6, v * s).toFixed(2)).join(' ')}"` : '';
      parts.push(q.fill ? `<path d="${d}" fill="${q.color}" stroke="none"/>` : `<path d="${d}" fill="none" stroke="${q.color}" stroke-width="${lw(q.w)}" stroke-linecap="${dash ? 'butt' : 'round'}" stroke-linejoin="round"${dash}/>`);
    } else if (q.k === 'poly') {
      parts.push(`<path d="${q.loops.map((lp) => lp.map(([x, y], i) => `${i ? 'L' : 'M'}${X(x)} ${Y(y)}`).join('') + 'Z').join('')}" fill="${q.color}" fill-rule="evenodd" stroke="none"/>`);
    } else if (q.k === 'dot') parts.push(`<circle cx="${X(q.x)}" cy="${Y(q.y)}" r="0.6" fill="${q.color}"/>`);
    else {
      const fs = Math.max(1, q.h * s * 1.35); // высота заглавных в DXF → размер шрифта
      const linesT = q.s.split('\n');
      const tx = X(q.x), ty = Y(q.y);
      const dy = q.base === 'hanging' ? fs * 0.8 : q.base === 'middle' ? fs * 0.35 - (linesT.length - 1) * fs * 0.6 : -(linesT.length - 1) * fs * 1.2;
      // текст в своей системе координат: поворот, затем сжатие по ширине (чертёжный шрифт уже)
      const tf = `translate(${tx} ${ty})${q.rot ? ` rotate(${(-q.rot).toFixed(2)})` : ''}${q.sx && Math.abs(q.sx - 1) > 0.01 ? ` scale(${q.sx.toFixed(3)} 1)` : ''}`;
      parts.push(`<text x="0" y="0" font-family="Roboto, Arial, sans-serif" font-size="${fs.toFixed(2)}"${q.italic ? ' font-style="italic"' : ''} fill="${q.color}" text-anchor="${q.anchor}" transform="${tf}">` +
        linesT.map((l, i) => `<tspan x="0" dy="${(i ? fs * 1.2 : dy).toFixed(2)}">${esc(l)}</tspan>`).join('') + '</text>');
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${pw}" height="${ph}" viewBox="0 0 ${pw} ${ph}"><rect width="100%" height="100%" fill="#fff"/>${parts.join('')}</svg>`;
  return { svg, pw, ph, count: prims.length };
}

/** DXF → PDF (вектор), SVG, PNG, JPG */
async function dxfConvert(file, target, opts, onStatus) {
  onStatus && onStatus('Разбор чертежа…');
  const { svg, pw, ph } = await dxfToSvg(file);
  if (target === 'svg') return new Blob([svg], { type: 'image/svg+xml' });
  if (target === 'pdf') {
    await loadLib('pdfmake'); await loadLib('pdfmakeFonts');
    onStatus && onStatus('Создание PDF…');
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Чертёж слишком сложный для PDF.')), 90000);
      try {
        pdfMake.createPdf({ pageSize: { width: pw, height: ph }, pageMargins: [0, 0, 0, 0], content: [{ svg, width: pw, height: ph }] })
          .getBlob((b) => { clearTimeout(t); resolve(b); });
      } catch (e) { clearTimeout(t); reject(e); }
    });
  }
  // картинка: 300 точек на дюйм по длинной стороне, но не больше 7000
  const k = Math.min(300 / 72, 7000 / Math.max(pw, ph));
  const img = await imageFromUrl('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg));
  const c = document.createElement('canvas');
  c.width = Math.round(pw * k); c.height = Math.round(ph * k);
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  g.drawImage(img, 0, 0, c.width, c.height);
  return canvasToBlob(c, target === 'png' ? 'image/png' : 'image/jpeg', target === 'png' ? undefined : (opts && opts.quality) || 0.92);
}
