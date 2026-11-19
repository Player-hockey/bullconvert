'use strict';

/* BullConvert — подпись от руки, заполнение PDF-бланков, сравнение документов. */

/* ============================ Подпись от руки ============================ */

/** Окно для рисования подписи. Возвращает { url, w, h } (PNG с прозрачным фоном) или null */
function drawSignature() {
  return new Promise((resolve) => {
    const saved = (() => { try { return localStorage.getItem('bcSignature'); } catch { return null; } })();
    const box = document.createElement('div');
    box.className = 'sig-overlay';
    box.innerHTML = `<div class="sig-box">
      <b>✍ Подпись</b><span class="muted small"> — нарисуйте мышью или пальцем</span>
      <canvas class="sig-pad" width="900" height="300"></canvas>
      <div class="tool-actions">
        <label class="mini">Цвет <input type="color" class="sig-color" value="#1a2a8a"></label>
        <label class="mini">Толщина <input type="range" class="sig-width" min="2" max="10" value="4"></label>
        <button class="btn sm sig-clear">Очистить</button>
        ${saved ? '<button class="btn sm sig-saved">Моя сохранённая подпись</button>' : ''}
        <span class="sp"></span>
        <label class="chk"><input type="checkbox" class="sig-remember" checked> запомнить на этом устройстве</label>
        <button class="btn ghost sig-cancel">Отмена</button>
        <button class="btn primary sig-ok">Поставить</button>
      </div></div>`;
    (document.querySelector('dialog[open]') || document.body).appendChild(box);
    const c = box.querySelector('.sig-pad');
    const g = c.getContext('2d');
    g.lineCap = 'round'; g.lineJoin = 'round';
    let drawing = false, last = null, dirty = false;
    const pos = (e) => { const r = c.getBoundingClientRect(); return { x: (e.clientX - r.left) * c.width / r.width, y: (e.clientY - r.top) * c.height / r.height, p: e.pressure || 0.5 }; };
    c.onpointerdown = (e) => { drawing = true; last = pos(e); c.setPointerCapture(e.pointerId); e.preventDefault(); };
    c.onpointermove = (e) => {
      if (!drawing) return;
      const p = pos(e);
      g.strokeStyle = box.querySelector('.sig-color').value;
      // нажим пера/пальца немного меняет толщину — подпись выглядит живой
      g.lineWidth = +box.querySelector('.sig-width').value * (0.6 + p.p * 0.8);
      g.beginPath(); g.moveTo(last.x, last.y);
      g.quadraticCurveTo(last.x, last.y, (last.x + p.x) / 2, (last.y + p.y) / 2);
      g.lineTo(p.x, p.y); g.stroke();
      last = p; dirty = true;
    };
    c.onpointerup = () => { drawing = false; };
    const close = (v) => { box.remove(); resolve(v); };
    box.querySelector('.sig-clear').onclick = () => { g.clearRect(0, 0, c.width, c.height); dirty = false; };
    box.querySelector('.sig-cancel').onclick = () => close(null);
    const savedBtn = box.querySelector('.sig-saved');
    if (savedBtn) savedBtn.onclick = async () => { const img = await imageFromUrl(saved); close({ url: saved, w: img.naturalWidth, h: img.naturalHeight }); };
    box.querySelector('.sig-ok').onclick = () => {
      if (!dirty) { close(null); return; }
      // обрезаем пустые поля вокруг подписи
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let x0 = c.width, y0 = c.height, x1 = 0, y1 = 0;
      for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4 + 3] > 10) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
      const pad = 8;
      x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(c.width - 1, x1 + pad); y1 = Math.min(c.height - 1, y1 + pad);
      const o = document.createElement('canvas');
      o.width = x1 - x0 + 1; o.height = y1 - y0 + 1;
      o.getContext('2d').drawImage(c, x0, y0, o.width, o.height, 0, 0, o.width, o.height);
      const url = o.toDataURL('image/png');
      if (box.querySelector('.sig-remember').checked) { try { localStorage.setItem('bcSignature', url); } catch { /* приватный режим */ } }
      close({ url, w: o.width, h: o.height });
    };
  });
}

/* ============================ Заполнение бланков ============================ */

function renderForm() {
  if (!pdfFileTab('form', 'Заполните бланк PDF с полями (заявления, анкеты, формы госорганов): текстовые поля, галочки, списки. Русские буквы поддерживаются.', '<div id="formFields" class="form-fields muted">Читаю поля…</div>')) return;
  listFormFields(T.form);
}

async function listFormFields(st) {
  const box = $('formFields');
  try {
    const { PDFTextField, PDFCheckBox, PDFDropdown, PDFRadioGroup, PDFOptionList } = await getPdfLib();
    const pdf = await loadPdfLibDoc(st.bytes);
    const fields = pdf.getForm().getFields();
    st.fields = fields.map((f) => {
      const name = f.getName();
      const label = name.replace(/[_.]+/g, ' ').replace(/\[\d+\]/g, '').trim();
      if (f instanceof PDFTextField) return { name, label, kind: 'text', value: f.getText() || '', multi: f.isMultiline() };
      if (f instanceof PDFCheckBox) return { name, label, kind: 'check', value: f.isChecked() };
      if (f instanceof PDFDropdown || f instanceof PDFOptionList) return { name, label, kind: 'select', options: f.getOptions(), value: (f.getSelected() || [])[0] || '' };
      if (f instanceof PDFRadioGroup) return { name, label, kind: 'radio', options: f.getOptions(), value: f.getSelected() || '' };
      return null;
    }).filter(Boolean);
    if (!st.fields.length) {
      box.innerHTML = 'В этом PDF нет полей для заполнения. Впишите текст поверх бланка во вкладке «Текст и подпись».' +
        ' <button class="btn sm" id="formToEdit">Открыть в «Текст и подпись»</button>';
      $('formToEdit').onclick = () => openTools('edit', new File([st.bytes], st.name, { type: 'application/pdf' }));
      return;
    }
    box.classList.remove('muted');
    box.innerHTML = st.fields.map((f, i) => {
      const id = `ff${i}`;
      const lab = `<span class="ff-label" title="${escapeHtml(f.name)}">${escapeHtml(f.label || f.name)}</span>`;
      if (f.kind === 'text') return `<label class="ff">${lab}${f.multi ? `<textarea id="${id}" rows="3">${escapeHtml(f.value)}</textarea>` : `<input id="${id}" value="${escapeHtml(f.value)}">`}</label>`;
      if (f.kind === 'check') return `<label class="ff chk"><input type="checkbox" id="${id}" ${f.value ? 'checked' : ''}> ${escapeHtml(f.label || f.name)}</label>`;
      return `<label class="ff">${lab}<select id="${id}"><option value=""></option>${f.options.map((o) => `<option ${o === f.value ? 'selected' : ''}>${escapeHtml(o)}</option>`).join('')}</select></label>`;
    }).join('') + `<div class="tool-actions">
        <label class="chk"><input type="checkbox" id="formFlat"> закрепить (поля больше нельзя изменить)</label>
        <span class="sp"></span><button class="btn primary" id="formSave">Сохранить PDF</button></div>`;
    $('formSave').onclick = () => saveForm(st);
    toolMsg(`Полей: ${st.fields.length}`);
  } catch (e) { box.textContent = ''; toolMsg(e.message, 'err'); }
}

async function saveForm(st) {
  const btn = $('formSave');
  btn.disabled = true;
  try {
    const pdf = await loadPdfLibDoc(st.bytes);
    const form = pdf.getForm();
    const font = await embedCyrFont(pdf);
    st.fields.forEach((f, i) => {
      const el = $(`ff${i}`);
      try {
        if (f.kind === 'text') form.getTextField(f.name).setText(el.value);
        else if (f.kind === 'check') { const cb = form.getCheckBox(f.name); el.checked ? cb.check() : cb.uncheck(); }
        else if (f.kind === 'select' && el.value) { try { form.getDropdown(f.name).select(el.value); } catch { form.getOptionList(f.name).select(el.value); } }
        else if (f.kind === 'radio' && el.value) form.getRadioGroup(f.name).select(el.value);
      } catch (e) { console.warn('Поле', f.name, e); }
    });
    // внешний вид полей — шрифтом с кириллицей, иначе русские буквы не покажутся
    form.updateFieldAppearances(font);
    if ($('formFlat').checked) form.flatten();
    const blob = pdfBlob(await pdf.save());
    download({ blob, name: `${st.base} (заполнено).pdf` });
    toolMsg(`Готово (${formatSize(blob.size)}).`, 'ok');
  } catch (e) { toolMsg(e.message, 'err'); }
  finally { btn.disabled = false; }
}

/* ============================ Сравнение документов ============================ */

T.compare = T.compare || { a: null, b: null };

function renderCompare() {
  const st = T.compare;
  const slot = (k, title) => `<div class="cmp-slot"><b>${title}</b>
    <div class="tool-drop" id="cmpDrop${k}">${filePickerHtml('cmpPick' + k, '', false, st[k] ? 'Заменить' : 'Выбрать файл')}</div>
    <div class="muted small">${st[k] ? escapeHtml(st[k].name) : 'Word, PDF, ODT, RTF, TXT, HTML, книги…'}</div></div>`;
  $('toolBody').innerHTML = `<p class="muted">Покажет, что изменилось между двумя версиями: удалённое — <del>зачёркнуто</del>, добавленное — <ins>подчёркнуто</ins>. Форматы могут быть разными (например, DOCX и PDF).</p>
    <div class="cmp-slots">${slot('a', 'Было')}${slot('b', 'Стало')}</div>
    <div class="tool-actions"><button class="btn primary" id="cmpGo" ${st.a && st.b ? '' : 'disabled'}>Сравнить</button>
      <button class="btn ghost" id="cmpSave" hidden>Скачать отчёт (HTML)</button><span class="muted" id="cmpStat"></span></div>
    <div class="tool-msg" id="toolMsg"></div><div class="cmp-out" id="cmpOut"></div>`;
  for (const k of ['a', 'b']) {
    $('cmpPick' + k).onchange = (e) => { if (e.target.files[0]) { st[k] = e.target.files[0]; renderCompare(); } };
    bindDrop($('cmpDrop' + k), (fs) => { st[k] = fs[0]; renderCompare(); });
  }
  $('cmpGo').onclick = () => runCompare(st);
}

async function docPlainText(file) {
  // простой текст читаем как есть (с определением кодировки, в т.ч. старой Windows-1251)
  if (['txt', 'text', 'csv', 'log'].includes(extOf(file.name))) return readText(file);
  const blob = await convertFileTo(file, 'txt', (s) => toolMsg(`${file.name}: ${s}`));
  return blob.text();
}

/** Разница двух последовательностей (алгоритм Майерса): [{op: '=', '-', '+', v}] */
function diffSeq(a, b) {
  const n = a.length, m = b.length, max = n + m;
  const v = new Int32Array(2 * max + 2), trace = [];
  const off = max + 1;
  outer: for (let d = 0; d <= max; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) { x++; y++; }
      v[off + k] = x;
      if (x >= n && y >= m) break outer;
    }
    if (d > 20000) break; // слишком разные тексты — дальше не ищем
  }
  // обратный проход
  const out = [];
  let x = n, y = m;
  for (let d = trace.length - 1; d >= 0 && (x > 0 || y > 0); d--) {
    const vv = trace[d], k = x - y;
    const prevK = k === -d || (k !== d && vv[off + k - 1] < vv[off + k + 1]) ? k + 1 : k - 1;
    const px = vv[off + prevK], py = px - prevK;
    while (x > px && y > py) { out.push({ op: '=', v: a[x - 1] }); x--; y--; }
    if (d > 0) { if (x === px) { out.push({ op: '+', v: b[y - 1] }); y--; } else { out.push({ op: '-', v: a[x - 1] }); x--; } }
  }
  while (x > 0 && y > 0 && a[x - 1] === b[y - 1]) { out.push({ op: '=', v: a[x - 1] }); x--; y--; }
  while (x > 0) { out.push({ op: '-', v: a[--x] }); }
  while (y > 0) { out.push({ op: '+', v: b[--y] }); }
  return out.reverse();
}

async function runCompare(st) {
  const btn = $('cmpGo');
  btn.disabled = true;
  try {
    const [ta, tb] = [await docPlainText(st.a), await docPlainText(st.b)];
    toolMsg('Сравниваю…');
    await new Promise((r) => setTimeout(r, 20));
    // сначала по абзацам, затем внутри изменённых абзацев — по словам
    const norm = (t) => t.replace(/\r/g, '').split(/\n+/).map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const pa = norm(ta), pb = norm(tb);
    const ops = diffSeq(pa, pb);
    const words = (s) => s.split(/(\s+)/).filter(Boolean);
    const html = [];
    let added = 0, removed = 0;
    // похожесть абзацев по словам (0…1): правленый абзац похож на старый
    const sim = (x, y) => {
      const A = new Set(x.toLowerCase().split(/\s+/)), B = new Set(y.toLowerCase().split(/\s+/));
      let common = 0; for (const t of A) if (B.has(t)) common++;
      return common / Math.max(1, Math.min(A.size, B.size));
    };
    const wordDiff = (x, y) => '<p>' + diffSeq(words(x), words(y)).map((w) => (w.op === '=' ? escapeHtml(w.v)
      : w.op === '-' ? (w.v.trim() && removed++, `<del>${escapeHtml(w.v)}</del>`) : (w.v.trim() && added++, `<ins>${escapeHtml(w.v)}</ins>`))).join('') + '</p>';
    for (let i = 0; i < ops.length;) {
      if (ops[i].op === '=') { html.push(`<p>${escapeHtml(ops[i].v)}</p>`); i++; continue; }
      // участок изменений: удалённые и добавленные абзацы; похожие пары — правка абзаца (отличия по словам)
      const D = [], I = [];
      while (i < ops.length && ops[i].op !== '=') { (ops[i].op === '-' ? D : I).push(ops[i].v); i++; }
      // выравнивание по порядку: динамика по похожести (> 0.35 — тот же абзац)
      const n = D.length, m = I.length;
      const dp = Array.from({ length: n + 1 }, () => new Float64Array(m + 1));
      for (let a = n - 1; a >= 0; a--) for (let b = m - 1; b >= 0; b--) {
        const s = sim(D[a], I[b]);
        dp[a][b] = Math.max(dp[a + 1][b], dp[a][b + 1], s > 0.35 ? s + dp[a + 1][b + 1] : 0);
      }
      let a = 0, b = 0;
      while (a < n || b < m) {
        if (a < n && b < m && sim(D[a], I[b]) > 0.35 && Math.abs(dp[a][b] - (sim(D[a], I[b]) + dp[a + 1][b + 1])) < 1e-9) { html.push(wordDiff(D[a], I[b])); a++; b++; }
        else if (a < n && (b >= m || dp[a + 1][b] >= dp[a][b + 1])) { removed++; html.push(`<p class="cmp-del"><del>${escapeHtml(D[a])}</del></p>`); a++; }
        else { added++; html.push(`<p class="cmp-ins"><ins>${escapeHtml(I[b])}</ins></p>`); b++; }
      }
    }
    $('cmpOut').innerHTML = html.join('');
    const same = !added && !removed;
    $('cmpStat').textContent = same ? 'Тексты совпадают.' : `Изменений: удалено ${removed}, добавлено ${added}.`;
    toolMsg('');
    const save = $('cmpSave');
    save.hidden = false;
    save.onclick = () => download({
      name: `Сравнение — ${baseOf(st.a.name)} и ${baseOf(st.b.name)}.html`,
      blob: new Blob([htmlPage('Сравнение документов', `<h1>Сравнение документов</h1><p><b>Было:</b> ${escapeHtml(st.a.name)}<br><b>Стало:</b> ${escapeHtml(st.b.name)}<br>${escapeHtml($('cmpStat').textContent)}</p><style>del{background:#fdd;color:#900}ins{background:#dfd;color:#060;text-decoration:none}</style><hr>${html.join('')}`)], { type: MIME.html }),
    });
  } catch (e) { toolMsg(e.message, 'err'); }
  finally { btn.disabled = false; }
}
