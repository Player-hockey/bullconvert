'use strict';

/* =====================================================================
   BullConvert — английский интерфейс.
   Русские надписи переводятся «на лету» (включая появляющиеся позже),
   оригиналы запоминаются, поэтому язык переключается без перезагрузки.
   Имена файлов и редактируемый текст не трогаются.
   ===================================================================== */

const I18N_EN = {
  // шапка и общие
  'Инструменты': 'Tools', '🛠 Инструменты': '🛠 Tools', '🕘 История': '🕘 History', '⤓ Установить приложение': '⤓ Install app',
  '📱 Другие устройства': '📱 Other devices', '⚙ Администратор': '⚙ Admin',
  'Документы, PDF, книги, DjVu, фото, таблицы, аудио, видео, архивы': 'Documents, PDF, e-books, DjVu, photos, spreadsheets, audio, video, archives',
  ', чертежи КОМПАС и AutoCAD': ', KOMPAS and AutoCAD drawings',
  '. Конвертация идёт прямо на вашем устройстве — файлы никуда не загружаются, работает и без интернета.': '. Conversion runs right on your device — files are never uploaded, works offline too.',
  'Перетащите файлы, папки или архивы сюда': 'Drop files, folders or archives here',
  'или нажмите, чтобы выбрать файлы ·': 'or click to choose files ·', 'выбрать папку': 'choose a folder',
  'Настройки': 'Settings', 'Качество JPG / WEBP:': 'JPG / WEBP quality:', 'Макс. ширина изображения, px': 'Max image width, px',
  'Фото не больше, КБ': 'Photo no larger than, KB', 'Битрейт MP3': 'MP3 bitrate', 'без изменений': 'unchanged', 'без ограничения': 'no limit',
  'Без интернета': 'Offline', '⤓ Подготовить к работе без интернета': '⤓ Prepare for offline use',
  'Скачает все модули один раз (≈35 МБ), дальше конвертер работает офлайн.': 'Downloads all modules once (≈35 MB), then the converter works offline.',
  '✓ Подготовлено к работе без интернета.': '✓ Ready for offline use.',
  'Формат для всех…': 'Format for all…', 'Очистить': 'Clear', '🗜 Упаковать в ZIP': '🗜 Pack to ZIP', 'Скачать всё (ZIP)': 'Download all (ZIP)',
  'Конвертировать все': 'Convert all', 'Конвертировать': 'Convert', 'Скачать': 'Download', 'Ещё раз': 'Retry', 'Нет': 'No',
  'Конвертация…': 'Converting…', 'определение формата…': 'detecting format…', 'формат не поддерживается': 'format not supported',
  'Готово': 'Done', 'Убрать': 'Remove',
  // категории
  'Фото': 'Photo', 'Данные': 'Data', 'Док': 'Doc', 'Медиа': 'Media', 'Архив': 'Archive',
  // ссылки в строке
  '✏ Редактировать текст': '✏ Edit text', '🛠 Страницы': '🛠 Pages', '🗜 Сжать': '🗜 Compress', '✍ Текст/подпись': '✍ Text/signature',
  '# Номера/знак': '# Numbers/watermark', '🔒 Пароль': '🔒 Password', '⬛ Скрыть данные': '⬛ Redact',
  '✂ Обрезать, повернуть, сжать': '✂ Crop, rotate, compress', '✂ Изменить фото (изменено)': '✂ Edit photo (edited)', '✂ Обрезать': '✂ Trim',
  '📤 Поделиться': '📤 Share', 'PNG без фона': 'PNG, no background', 'Кадры JPG (ZIP)': 'JPG frames (ZIP)',
  // что умеет
  'Что умеет': 'Features', 'Инструменты PDF': 'PDF tools', 'PDF и DjVu': 'PDF & DjVu', 'Электронные книги': 'E-books', 'Документы': 'Documents',
  'Фото → текст': 'Photo → text', 'Таблицы и данные': 'Spreadsheets & data', 'Аудио и видео': 'Audio & video', 'Архивы и папки': 'Archives & folders',
  // инструменты
  'Объединить PDF': 'Merge PDF', 'Страницы и разделение': 'Pages & split', 'Сжать PDF': 'Compress PDF', 'Текст и подпись': 'Text & signature',
  'Номера и водяной знак': 'Numbers & watermark', 'Пароль': 'Password', 'Скрыть данные': 'Redact', 'Склеить фото': 'Photo collage',
  'Открыть PDF': 'Open PDF', 'или перетащите файл сюда': 'or drop a file here', '+ Добавить файлы': '+ Add files', '+ Добавить фото': '+ Add photos',
  'Другой файл': 'Another file', 'Объединить и скачать': 'Merge & download', 'Сохранить PDF': 'Save PDF', 'Скрыть и скачать': 'Redact & download',
  'Сжать и скачать': 'Compress & download', 'Применить и скачать': 'Apply & download', 'Склеить и скачать': 'Make collage & download',
  'Зашифровать и скачать': 'Encrypt & download', 'Снять пароль и скачать': 'Remove password & download',
  'Выбрать все': 'Select all', 'Снять выбор': 'Deselect', 'Удалить выбранные': 'Delete selected', 'Извлечь выбранные в PDF': 'Extract selected to PDF',
  'Разделить:': 'Split:', 'Разделить (ZIP)': 'Split (ZIP)', 'каждую страницу в отдельный PDF': 'every page to its own PDF', 'по диапазонам…': 'by ranges…', 'каждые N страниц': 'every N pages',
  'Найти': 'Find', 'Номера страниц': 'Page numbers', 'Водяной знак': 'Watermark', 'Поставить пароль': 'Set password', 'Снять пароль': 'Remove password',
  'запретить печать': 'disallow printing', 'запретить копирование текста': 'disallow copying text',
  'удалить метаданные, комментарии, вложения': 'remove metadata, comments, attachments',
  'Сохранить правки': 'Save changes', 'Вернуть оригинал': 'Restore original', 'Сохранить': 'Save', 'Без обрезки': 'No trim',
  'Сбросить обрезку': 'Reset crop', '✨ Убрать фон': '✨ Remove background', 'Ширина, px': 'Width, px', 'Не больше, КБ': 'Max size, KB', 'как есть': 'as is', 'авто': 'auto', 'любой': 'any',
  'Чтобы обрезать — выделите нужную область мышью или пальцем.': 'To crop, select the area with your mouse or finger.',
  'Начало': 'Start', 'Конец': 'End', '⇤ текущий момент': '⇤ current time', 'текущий момент ⇥': 'current time ⇥', 'до конца': 'to the end',
  '🕘 История конвертаций': '🕘 Conversion history', 'Очистить историю': 'Clear history',
  'Хранится только на этом устройстве (последние 50 файлов).': 'Stored only on this device (last 50 files).',
  'Пока пусто — здесь появятся сконвертированные файлы.': 'Empty so far — converted files will appear here.',
  'Правки применятся при конвертации в любой формат.': 'Changes apply when converting to any format.',
  'Абзац': 'Paragraph', '• Список': '• List', '1. Список': '1. List',
  // установка и устройства
  'Установить BullConvert': 'Install BullConvert', 'BullConvert на других устройствах': 'BullConvert on other devices', 'Значок на экран': 'Home screen icon', 'Поделиться': 'Share',
  'Откройте эту страницу в': 'Open this page in', 'Нажмите': 'Tap', '«Поделиться»': '“Share”', 'внизу экрана.': 'at the bottom of the screen.',
  'Выберите': 'Choose', 'На экран «Домой»': 'Add to Home Screen', 'Добавить': 'Add',
  'На экране появится значок BullConvert с быком — он открывается как отдельное приложение.': 'A BullConvert bull icon appears on your home screen — it opens as a separate app.',
  '✅ Этот сайт работает прямо на вашем устройстве — файлы никуда не загружаются.': '✅ This site runs right on your device — files are never uploaded.',
  'Проверяю…': 'Checking…', 'Закрыть': 'Close',
  '📄 Всё в один PDF': '📄 All into one PDF', 'Всё в один PDF': 'All into one PDF',
  'Соберите в один PDF что угодно: PDF, фото (JPG, PNG, HEIC…), Word (DOCX, DOC), Excel, презентации, тексты, книги. Каждый файл сначала переводится в PDF. Порядок меняется стрелками или перетаскиванием.': 'Combine anything into one PDF: PDFs, photos (JPG, PNG, HEIC…), Word (DOCX, DOC), Excel, presentations, texts, books. Each file is converted to PDF first. Reorder with arrows or drag and drop.',
  'PDF с поиском (распознать текст)': 'Searchable PDF (OCR)', '📄 Скан документа': '📄 Scan document', '☀ Выровнять свет': '☀ Even out lighting', 'Обработка…': 'Processing…',
  'текст уже был': 'text was already there',
  'Презентации': 'Presentations', 'Аудио': 'Audio', 'Видео': 'Video', 'DjVu': 'DjVu', 'Защита данных': 'Data protection',
  'PDF, DOCX, DOCX по ГОСТ, EPUB, FB2, HTML, Markdown, TXT, PNG, JPG': 'PDF, DOCX, DOCX per GOST, EPUB, FB2, HTML, Markdown, TXT, PNG, JPG',
  'DOCX, DOCX по ГОСТ, Excel, PDF с поиском, TXT, Markdown, HTML, EPUB, FB2, PNG, JPG': 'DOCX, DOCX per GOST, Excel, searchable PDF, TXT, Markdown, HTML, EPUB, FB2, PNG, JPG',
  'PDF, PDF с поиском, DOCX, TXT, Markdown, HTML, EPUB, FB2, PNG, JPG': 'PDF, searchable PDF, DOCX, TXT, Markdown, HTML, EPUB, FB2, PNG, JPG',
  'PNG, JPG, WEBP, PDF, PDF с поиском, PNG без фона, GIF, TIFF, BMP, ICO, TXT, DOCX, Excel': 'PNG, JPG, WEBP, PDF, searchable PDF, PNG without background, GIF, TIFF, BMP, ICO, TXT, DOCX, Excel',
  'MP4, WEBM, GIF, MP3, WAV, кадры JPG': 'MP4, WEBM, GIF, MP3, WAV, JPG frames', ', а также ': ', and also ',
  'Файлы конвертируются ': 'Files are converted ', 'прямо на вашем устройстве': 'right on your device',
  ' — в браузере. Они не загружаются на сервер, их никто не видит и не хранит. Сайт не требует регистрации, не использует рекламу и cookie; посещения считаются только в обезличенном виде, без имён файлов и IP-адресов.': ' — in the browser. They are not uploaded to a server; nobody sees or stores them. No sign-up, no ads, no cookies; visits are counted anonymously, without file names or IP addresses.',
  'История конвертаций, настройки и сохранённая подпись хранятся только в вашем браузере — их можно удалить в любой момент.': 'Conversion history, settings and a saved signature stay only in your browser — you can delete them at any time.',
  'Политика конфиденциальности': 'Privacy policy (in Russian)', 'Понятно': 'Got it',
  'BullConvert обрабатывает файлы на вашем устройстве — они никуда не загружаются. Для использования приложения необходимо принять': 'BullConvert processes files on your device — they are never uploaded. To use the app, please accept the',
  'Политику конфиденциальности': 'Privacy Policy', ' и дать': ' and give', 'согласие на обработку персональных данных': 'consent to personal data processing',
  'Я ознакомлен(а) с Политикой конфиденциальности и даю согласие на обработку персональных данных': 'I have read the Privacy Policy and consent to the processing of personal data',
  'Согласие на обработку данных': 'Consent to data processing',
  'BullConvert обрабатывает файлы на вашем устройстве — они никуда не загружаются. Для использования приложения необходимо ознакомиться с': 'BullConvert processes files on your device — they are never uploaded. To use the app, please read the',
  'Политикой конфиденциальности': 'Privacy Policy', 'Согласие на обработку персональных данных': 'Consent to personal data processing (in Russian)',
  'Я ознакомлен(а) с': 'I have read the', 'Я даю согласие на обработку персональных данных на условиях': 'I consent to the processing of personal data under the terms of the', 'Согласия': 'Consent',
  'Текст согласия, дата его получения и кнопка отзыва всегда доступны внизу страницы — ссылка «Согласие на обработку персональных данных».': 'The consent text, the date it was given and a withdraw button are always available at the bottom of the page — link “Consent to personal data processing”.',
  'Отказаться': 'Decline', 'Принять': 'Accept', 'Без согласия использование BullConvert невозможно. Вы можете закрыть страницу.': 'BullConvert cannot be used without consent. You may close the page.',
  '🔒 Файлы конвертируются на вашем устройстве и никуда не загружаются. ': '🔒 Files are converted on your device and never uploaded. ',
  'Заполнить бланк': 'Fill a form', 'Сравнить': 'Compare', 'Скан документов': 'Scan documents', '✍ Нарисовать подпись': '✍ Draw signature',
  '📐 Выровнять лист': '📐 Straighten page', '✔ Выпрямить лист': '✔ Straighten now', '🌐 Перевести': '🌐 Translate', 'По имени ↓': 'By name ↓',
  'Имя результата': 'Output file name', 'Скачать отчёт (HTML)': 'Download report (HTML)', 'Было': 'Before', 'Стало': 'After', 'Выбрать файл': 'Choose file',
  'Заменить': 'Replace', 'Собрать PDF': 'Build PDF', '+ Добавить фото': '+ Add photos', 'Поставить': 'Place', 'Отмена': 'Cancel',
  'Моя сохранённая подпись': 'My saved signature', 'запомнить на этом устройстве': 'remember on this device', 'Толщина': 'Thickness',
  'Чертежи DXF': 'DXF drawings', 'DOCX по ГОСТ (поля, шрифт 14, интервал 1,5)': 'DOCX per GOST (margins, 14 pt, 1.5 spacing)',
  'найти и выпрямить лист': 'find and straighten the page', 'чёрно-белый скан (без теней)': 'black & white scan (no shadows)',
  'распознать текст (PDF с поиском)': 'recognize text (searchable PDF)', 'закрепить (поля больше нельзя изменить)': 'flatten (fields can no longer be changed)',
  'Тексты совпадают.': 'The texts are identical.', 'Формулы…': 'Formulas…', 'Оформление по ГОСТ…': 'Applying GOST formatting…', 'Разбор чертежа…': 'Reading drawing…',
  'Лист найден — поправьте углы, если нужно, и нажмите «Выпрямить лист».': 'Page found — adjust the corners if needed and press “Straighten now”.',
  'Лист не найден автоматически — перетащите углы на края листа.': 'Page not found automatically — drag the corners to the page edges.',
  'Выпрямляю…': 'Straightening…', 'Перевод: Переводчик браузера не отвечает — перевод работает в Google Chrome 138+ на компьютере.': 'Translation: the browser translator does not respond — translation works in Google Chrome 138+ on a computer.', 'Перевод: подготовка…': 'Translating: preparing…', 'Загрузка словаря для перевода (один раз)…': 'Downloading the translation dictionary (once)…',
  '⚠ Этот браузер не умеет переводить сам. Нужен Google Chrome 138+ на компьютере (перевод идёт на устройстве, без интернета).': '⚠ This browser cannot translate on its own. Google Chrome 138+ on a computer is needed (translation runs on the device, offline).',
  '⚠ без КОМПАС: нарисовано в браузере': '⚠ without KOMPAS: drawn in the browser', '⚠ диаграммы и картинки листа не перенесены': '⚠ sheet charts and pictures were not transferred', 'Нажмите на страницу, куда поставить подпись. Потом её можно двигать.': 'Tap the page where the signature should go. You can move it afterwards.',
  // старые Word/PowerPoint
  'Старый Word и PowerPoint': 'Old Word & PowerPoint', 'Чтение старого формата Office…': 'Reading old Office format…',
  'Office не ответил — конвертирую в браузере…': 'Office did not respond — converting in the browser…',
  '⚠ без Office: оформление упрощённое': '⚠ without Office: simplified layout', 'слайды в ZIP': 'slides in ZIP',
  'Конвертация через Microsoft Word…': 'Converting with Microsoft Word…', 'Конвертация через Microsoft PowerPoint…': 'Converting with Microsoft PowerPoint…',
};

// Шаблоны с числами и вставками
const I18N_RULES = [
  [/^(\d+(?:[.,]\d+)?) (Б|КБ|МБ|ГБ)$/, (m, n, u) => `${n} ${{ 'Б': 'B', 'КБ': 'KB', 'МБ': 'MB', 'ГБ': 'GB' }[u]}`],
  [/^Файлов: (\d+)$/, 'Files: $1'], [/^готово: (\d+)$/, 'done: $1'],
  [/^Ошибка: (.*)$/, 'Error: $1'], [/^определён как (\S+)$/, 'detected as $1'],
  [/^Страница (\d+) из (\d+)…$/, 'Page $1 of $2…'], [/^Кадр (\d+) из (\d+)…$/, 'Frame $1 of $2…'],
  [/^Распознавание текста: страница (\d+) из (\d+)…$/, 'Recognizing text: page $1 of $2…'],
  [/^(\d+) стр\.$/, '$1 pages'], [/^(\d+) кадров$/, '$1 frames'], [/^(\d+) лист\(ов\)$/, '$1 sheet(s)'],
  [/^стр\. (\d+) из (\d+)$/, 'page $1 of $2'], [/^Итог: (\d+) × (\d+) px(.*)$/, 'Result: $1 × $2 px$3'],
  [/^✂ Обрезка (.*)$/, '✂ Trim $1'], [/^Слайд (\d+) из (\d+)…$/, 'Slide $1 of $2…'], [/^Слайдов: (\d+)$/, 'Slides: $1'],
  [/^Загрузка шрифта (\w+)…$/, 'Loading font $1…'], [/^Скачиваю шрифты документов: (\d+) из (\d+)…$/, 'Downloading document fonts: $1 of $2…'],
  [/^Надписи и рисунки поверх текста…$/, 'Placing text boxes and floating pictures…'],
  [/^ℹ Word не ответил — PDF собран в BullConvert$/, 'ℹ Word did not respond — PDF made by BullConvert'],
  [/^распознано стр\.: (\d+)$/, 'pages recognized: $1'],
  [/^Перевод: (\d+) из (\d+)…$/, 'Translating: $1 of $2…'], [/^Загрузка словаря: (\d+)%$/, 'Downloading dictionary: $1%'],
  [/^Страница (\d+) из (\d+): (.*)$/, 'Page $1 of $2: $3'], [/^Изменений: удалено (\d+), добавлено (\d+)\.$/, 'Changes: $1 removed, $2 added.'],
  [/^Полей: (\d+)$/, 'Fields: $1'], [/^Лист «(.*)»…$/, 'Sheet “$1”…'], [/^Распознавание таблицы: страница (\d+) из (\d+)…$/, 'Recognizing table: page $1 of $2…'],
  [/^🌐 Переведено \((.*)\)$/, '🌐 Translated ($1)'], [/^Готово \((.*)\)\.$/, 'Done ($1).'], [/^Рисунки и формулы: (\d+)…$/, 'Pictures and formulas: $1…'],
  [/^(\d+) из (\d+): (.*) — (.*)$/, '$1 of $2: $3 — $4'], [/^Добавляю (\d+) из (\d+): (.*)$/, 'Adding $1 of $2: $3'],
  [/^⚠ не перенесено картинок: (\d+) \(формат EMF\/WMF\)$/, '⚠ images not transferred: $1 (EMF/WMF format)'],
  [/^⚠ не нарисовано (.*)$/, (m, x) => '⚠ not drawn: ' + x.replace('диаграмм', 'charts').replace('картинок', 'images')], [/^(\d+) стр\. в ZIP$/, '$1 pages in ZIP'],
];

const I18N_SKIP = '.name, .m-name, .t-name, .h-info b, #editTitle, #imgTitle, #mediaTitle, #editArea, script, style, code, .pv-text-in';

let LANG = (() => {
  try { const s = localStorage.getItem('bcLang'); if (s) return s; } catch { /* нет доступа */ }
  return /^ru|^uk|^be|^kk/i.test(navigator.language || 'ru') ? 'ru' : 'en';
})();

function trPiece(t) {
  if (I18N_EN[t]) return I18N_EN[t];
  for (const [re, rep] of I18N_RULES) if (re.test(t)) return t.replace(re, rep);
  return null;
}

/** перевод строки: целиком, иначе по частям, разделённым « · » */
function trText(s) {
  const t = s.trim();
  if (!t || !/[А-Яа-яЁё]/.test(t)) return null;
  let out = trPiece(t);
  if (out == null && t.includes(' · ')) {
    const parts = t.split(' · ').map((p) => trPiece(p) ?? p);
    out = parts.join(' · ');
    if (out === t) out = null;
  }
  return out == null ? null : s.replace(t, out);
}

function trNode(node) {
  if (node.nodeType === 3) {
    const p = node.parentElement;
    if (!p || p.closest(I18N_SKIP)) return;
    if (node.__bcEn !== undefined && node.data === node.__bcEn) return; // уже переведено нами
    const en = trText(node.data);
    if (en != null) { node.__bcRu = node.data; node.__bcEn = en; node.data = en; }
    return;
  }
  if (node.nodeType !== 1 || node.closest(I18N_SKIP)) return;
  for (const a of ['title', 'placeholder', 'aria-label']) {
    const v = node.getAttribute(a);
    if (!v) continue;
    const en = trText(v);
    if (en != null) { node.__bcAttrs = node.__bcAttrs || {}; node.__bcAttrs[a] = v; node.setAttribute(a, en); }
  }
  for (const o of node.querySelectorAll('option')) { const en = trText(o.text); if (en != null) { o.__bcRu = o.text; o.text = en; } }
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let n = walker.nextNode();
  while (n) {
    if (n.nodeType === 3) trNode(n);
    else if (n !== node && n.attributes) for (const a of ['title', 'placeholder', 'aria-label']) {
      const v = n.getAttribute(a);
      const en = v && trText(v);
      if (en) { n.__bcAttrs = n.__bcAttrs || {}; n.__bcAttrs[a] = v; n.setAttribute(a, en); }
    }
    n = walker.nextNode();
  }
}

function restoreRu(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let n = walker.currentNode;
  while (n) {
    if (n.nodeType === 3 && n.__bcRu !== undefined && n.data === n.__bcEn) n.data = n.__bcRu;
    if (n.nodeType === 1) {
      if (n.__bcAttrs) for (const [a, v] of Object.entries(n.__bcAttrs)) n.setAttribute(a, v);
      if (n.tagName === 'OPTION' && n.__bcRu) n.text = n.__bcRu;
    }
    n = walker.nextNode();
  }
}

let i18nObserver = null;
function applyLang() {
  document.documentElement.lang = LANG;
  const btn = document.getElementById('langBtn');
  if (btn) btn.textContent = LANG === 'en' ? 'RU' : 'EN';
  if (LANG === 'en') {
    trNode(document.body);
    if (!i18nObserver) {
      i18nObserver = new MutationObserver((muts) => {
        if (LANG !== 'en') return;
        for (const m of muts) {
          if (m.type === 'characterData') trNode(m.target);
          else m.addedNodes.forEach(trNode);
        }
      });
      i18nObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
    }
  } else {
    restoreRu(document.body);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  applyLang();
  document.getElementById('langBtn').onclick = () => {
    LANG = LANG === 'en' ? 'ru' : 'en';
    try { localStorage.setItem('bcLang', LANG); } catch { /* приватный режим */ }
    applyLang();
  };
});
