(() => {
  // Telas de listagem: /channel/<id>/videos/upload (vídeos) e /channel/<id>/videos/short (shorts)
  const LIST_PATH = /^\/channel\/[^/]+\/videos(\/(upload|short))?\/?$/;

  const SCHEDULE_LABELS = ['programar', 'agendar', 'schedule'];
  const CONFIRM_LABELS = [...SCHEDULE_LABELS, 'salvar', 'save', 'concluído', 'concluido', 'done'];
  const DIALOG_SEL = 'ytcp-dialog, tp-yt-paper-dialog, [role="dialog"]';
  const BUTTON_SEL = 'ytcp-button, button, [role="button"]';
  const RADIO_SEL = 'tp-yt-paper-radio-button, [role="radio"]';
  const ROW_SEL = 'ytcp-video-row';
  const DATE_SEL = '.tablecell-date, [class*="tablecell-date"]'; // coluna "Data" da linha

  // Tempos (ms)
  const WAIT = { dialogClose: 15000, rowUpdate: 8000, settle: 600 };

  let busy = false;
  let lastRow = null; // última linha clicada = linha de onde o agendamento foi aberto

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clean = (s) => s.trim().replace(/\s+/g, ' ').toLowerCase();
  const strip = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const isVisible = (el) => el.getClientRects().length > 0;
  const onListPage = () => LIST_PATH.test(location.pathname);

  async function waitFor(fn, timeout, step = 200) {
    const t = Date.now();
    while (Date.now() - t < timeout) {
      if (fn()) return true;
      await sleep(step);
    }
    return false;
  }

  // ---------- Interpretação de data e hora (textos localizados do Studio) ----------
  const LOCALES = () =>
    [...new Set([document.documentElement.lang, navigator.language, 'pt-BR', 'en', 'es'].filter(Boolean))];

  let monthMap = null; // nome do mês (sem acento, minúsculo) -> 0..11
  function getMonthMap() {
    if (monthMap) return monthMap;
    monthMap = new Map();
    for (const loc of LOCALES()) {
      for (const style of ['long', 'short']) {
        let fmt;
        try { fmt = new Intl.DateTimeFormat(loc, { month: style }); } catch { continue; }
        for (let m = 0; m < 12; m++) {
          const name = strip(fmt.format(new Date(2000, m, 15))).replace(/\./g, '');
          if (name.length >= 3 && !monthMap.has(name)) monthMap.set(name, m);
        }
      }
    }
    return monthMap;
  }

  function parseTime(s) {
    const m = s.match(/(\d{1,2})\s*[:h]\s*(\d{2})(?:\s*([ap])\.?\s?m\b\.?)?/);
    if (!m) return { h: 0, min: 0, raw: '' };
    let h = Number(m[1]);
    if (m[3] === 'p' && h < 12) h += 12;
    if (m[3] === 'a' && h === 12) h = 0;
    return { h, min: Number(m[2]), raw: m[0] };
  }

  function parseDate(s) {
    let m = s.match(/(\d{4})\s*[-./年]\s*(\d{1,2})\s*[-./月]\s*(\d{1,2})/); // 2026-10-05, 2026年10月5日
    if (m) return { y: Number(m[1]), m: Number(m[2]) - 1, d: Number(m[3]) };

    m = s.match(/(\d{1,2})\s*[/.-]\s*(\d{1,2})\s*[/.-]\s*(\d{4})/); // 05/10/2026 ou 10/05/2026
    if (m) {
      const a = Number(m[1]);
      const b = Number(m[2]);
      const lang = (document.documentElement.lang || navigator.language || '').toLowerCase();
      const mdy = a <= 12 && (b > 12 || lang === 'en' || lang === 'en-us');
      return mdy ? { y: Number(m[3]), m: a - 1, d: b } : { y: Number(m[3]), m: b - 1, d: a };
    }

    // Textual: "5 de out. de 2026", "Oct 5, 2026"
    const months = getMonthMap();
    const word = (s.match(/[a-z]{3,}/g) || []).find((w) => months.has(w));
    if (word === undefined) return null;
    const year = s.match(/\b(\d{4})\b/);
    const day = (s.match(/\b\d{1,2}\b/g) || []).map(Number).find((n) => n >= 1 && n <= 31);
    if (!day) return null;
    return { y: year ? Number(year[1]) : new Date().getFullYear(), m: months.get(word), d: day };
  }

  function parseDateTime(text) {
    if (!text) return null;
    let s = strip(text);
    const time = parseTime(s);
    if (time.raw) s = s.replace(time.raw, ' ');
    const date = parseDate(s);
    if (!date || date.m < 0 || date.m > 11 || date.d < 1 || date.d > 31) return null;
    return new Date(date.y, date.m, date.d, time.h, time.min).getTime();
  }

  // ---------- Leitura das linhas e do diálogo ----------
  const dateText = (row) => row.querySelector(DATE_SEL)?.textContent.trim().replace(/\s+/g, ' ') || '';

  // Data e hora escolhidas no diálogo de agendamento (lidas dos campos de texto)
  function readScheduledFromDialog(dialog) {
    const text = [...dialog.querySelectorAll('input')].map((i) => i.value).filter(Boolean).join(' ');
    return parseDateTime(text);
  }

  // A opção "Programar" está marcada no diálogo de visibilidade?
  const isScheduleSelected = (dialog) =>
    [...dialog.querySelectorAll(RADIO_SEL)].some((r) => {
      const checked = r.hasAttribute('checked') || r.getAttribute('aria-checked') === 'true';
      const text = clean(r.textContent);
      return checked && SCHEDULE_LABELS.some((l) => text.startsWith(l));
    });

  // ---------- Reordenação (mais recente primeiro), só das linhas presentes na tela ----------
  // Usa a propriedade CSS "order" em vez de mover elementos, para não interferir na lista do Studio.
  function reorderRows(scheduledRow, scheduledTime) {
    const groups = new Map();
    for (const r of document.querySelectorAll(ROW_SEL)) {
      const list = groups.get(r.parentElement) || [];
      list.push(r);
      groups.set(r.parentElement, list);
    }

    for (const [parent, rows] of groups) {
      const entries = rows.map((row, i) => ({
        row,
        i,
        t: row === scheduledRow && scheduledTime !== null ? scheduledTime : parseDateTime(dateText(row))
      }));

      // Linhas sem data reconhecida (rascunhos etc.) mantêm sua posição; as demais são reordenadas
      const dated = entries.filter((e) => e.t !== null);
      const slots = dated.map((e) => e.i);
      const sorted = [...dated].sort((a, b) => b.t - a.t || a.i - b.i);
      const finalOrder = [...entries];
      slots.forEach((slot, k) => { finalOrder[slot] = sorted[k]; });

      parent.style.display = 'flex';
      parent.style.flexDirection = 'column';
      finalOrder.forEach((e, pos) => { e.row.style.order = String(pos + 1); });
      console.debug(`[Reordenar] ${dated.length}/${rows.length} linhas com data reconhecida`);
    }
  }

  // Após confirmar o agendamento: espera salvar, deixa a linha atualizar e reordena a lista
  async function onScheduleConfirmed(dialog) {
    busy = true;
    const row = lastRow;
    const before = row ? dateText(row) : '';
    const scheduledTime = readScheduledFromDialog(dialog);
    try {
      const closed = await waitFor(() => !dialog.isConnected || !isVisible(dialog), WAIT.dialogClose);
      if (!closed || !onListPage()) return; // diálogo continuou aberto (erro/validação) ou o usuário saiu da lista
      if (row) await waitFor(() => !row.isConnected || dateText(row) !== before, WAIT.rowUpdate);
      await sleep(WAIT.settle);
      reorderRows(row, scheduledTime);
    } finally {
      busy = false;
    }
  }

  // Um único listener no documento (o Studio é SPA); só age nas telas de listagem
  document.addEventListener('click', (e) => {
    if (!onListPage()) return;
    const path = e.composedPath();
    const row = path.find((n) => n.matches?.(ROW_SEL));
    if (row) lastRow = row;
    if (busy) return;

    const btn = path.find((n) => n.matches?.(BUTTON_SEL));
    const dialog = path.find((n) => n.matches?.(DIALOG_SEL));
    if (!btn || !dialog) return;

    const label = clean(btn.textContent);
    if (!CONFIRM_LABELS.includes(label)) return;
    const scheduling = SCHEDULE_LABELS.includes(label) || isScheduleSelected(dialog);
    if (scheduling) onScheduleConfirmed(dialog);
  }, true);
})();
