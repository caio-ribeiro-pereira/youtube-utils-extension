(() => {
  const BTN_ID = 'tm-multi-btn';
  const ADD_LABELS = ['adicionar idioma', 'add language'];
  const UPDATE_LABELS = ['atualizar', 'update'];
  const STORAGE_KEY = 'selectedLangs';

  // Códigos de 2 letras suportados pela API local (free-translate-api)
  const SUPPORTED = ('aa ab af ak am an ar as av ay az ba be bg bh bi bm bn bo br bs ca ce ch co cr cs cu cv cy ' +
    'da de dv dz ee el en eo es et eu fa ff fi fj fo fr fy ga gd gl gn gu gv ha he hi ho hr ht hu hy hz ia id ie ' +
    'ig ii ik io is it iu ja jv ka kg ki kj kk kl km kn ko kr ks ku kv kw ky la lb lg li ln lo lt lv mg mh mi mk ' +
    'ml mn mo mr ms mt my na nd ne ng nl nn no nr nv ny oc oj om or os pa pi pl ps pt qu rm rn ro ru rw sa sc sd ' +
    'sg sh si sk sl sm sn so sq sr ss st su sv sw ta te tg th ti tk tl tn to tr ts tt tw ty ug uk ur ve vi vo wa ' +
    'wo xh yi yo za zh zu').split(' ');

  // Tempos (ms). Aumente se o Studio ainda estiver lento.
  const WAIT = { afterAddClick: 800, field: 8000, afterFill: 1000, updateSettle: 6000, afterUpdate: 3000, betweenLangs: 1500 };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const api = (type, payload = {}) =>
    new Promise((res) => chrome.runtime.sendMessage({ type, ...payload }, res));
  const norm = (s) =>
    s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\(.*?\)/g, '').trim();
  const clean = (s) => s.trim().replace(/\s+/g, ' ');
  const isVisible = (el) => el.getClientRects().length > 0;
  const isEnabled = (el) => !el.hasAttribute('disabled') && el.getAttribute('aria-disabled') !== 'true';
  const onTranslationsPage = () => /^\/video\/[^/]+\/translations/.test(location.pathname);

  async function waitFor(fn, timeout = 5000, step = 150) {
    const t = Date.now();
    while (Date.now() - t < timeout) {
      const v = fn();
      if (v) return v;
      await sleep(step);
    }
    return null;
  }

  // ---------- Lista de idiomas (fixa, sem abrir o select do Studio) ----------
  const LOCALES = () =>
    [...new Set([document.documentElement.lang, navigator.language, 'pt-BR', 'en'].filter(Boolean))];

  // nome normalizado (como o Studio exibe) -> código de 2 letras
  function buildCodeMap() {
    const map = new Map([['filipino', 'tl']]);
    for (const loc of LOCALES()) {
      let dn;
      try { dn = new Intl.DisplayNames([loc], { type: 'language' }); } catch { continue; }
      for (const code of SUPPORTED) {
        let n;
        try { n = dn.of(code); } catch { continue; }
        if (n && n !== code && !map.has(norm(n))) map.set(norm(n), code);
      }
    }
    return map;
  }

  function buildOptions() {
    let dn;
    for (const loc of LOCALES()) {
      try { dn = new Intl.DisplayNames([loc], { type: 'language' }); break; } catch { /* tenta o próximo */ }
    }
    const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
    return SUPPORTED
      .map((code) => ({ code, name: dn ? cap(dn.of(code) || '') : '' }))
      .filter((o) => o.name && o.name.toLowerCase() !== o.code) // sem nome conhecido = fora da lista
      .sort((a, b) => a.name.localeCompare(b.name, LOCALES()[0]));
  }

  // Título no idioma principal, já renderizado na tela. Ajuste os seletores se o Studio mudar.
  const TITLE_SELECTORS = [
    'ytcp-video-translations #original-title',
    'ytcp-video-translations .original-title',
    'ytcp-video-info .video-title',
    'ytcp-entity-page-header #entity-name',
    '#entity-name',
    '.entity-name'
  ];
  const getVideoTitle = () => {
    for (const sel of TITLE_SELECTORS) {
      const t = document.querySelector(sel)?.textContent?.trim();
      if (t) return t;
    }
    return '';
  };

  const findAddBtn = () =>
    [...document.querySelectorAll('ytcp-button, button')].find(
      (b) => b.id !== BTN_ID && ADD_LABELS.includes(b.textContent.trim().toLowerCase())
    );
  const findUpdateBtn = () =>
    [...document.querySelectorAll('ytcp-button, button')].find(
      (b) => b.id !== BTN_ID && isVisible(b) && UPDATE_LABELS.includes(clean(b.textContent).toLowerCase())
    );

  // ---------- Injeção do botão (Studio é SPA, então observamos o DOM) ----------
  let scheduled = false;
  function inject() {
    scheduled = false;
    if (!onTranslationsPage() || document.getElementById(BTN_ID)) return;
    const add = findAddBtn();
    if (!add) return;
    const btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.textContent = 'Tradução múltipla';
    btn.style.cssText =
      'margin-left:8px;padding:0 16px;height:36px;border:1px solid #3ea6ff;border-radius:18px;' +
      'background:transparent;color:#3ea6ff;font:500 14px Roboto,Arial,sans-serif;cursor:pointer;';
    btn.addEventListener('click', openModal);
    add.insertAdjacentElement('afterend', btn);
  }
  new MutationObserver(() => {
    if (!scheduled) { scheduled = true; requestAnimationFrame(inject); }
  }).observe(document.body, { childList: true, subtree: true });
  inject();

  async function openModal() {
    let saved = [];
    try {
      const st = await chrome.storage.local.get(STORAGE_KEY);
      saved = st[STORAGE_KEY] || [];
    } catch { /* segue sem seleção salva */ }
    renderModal(buildOptions(), saved);
  }

  // ---------- Aplicação das traduções via DOM ----------
  const ITEM_SEL = 'tp-yt-paper-item, [role="menuitem"], [role="option"]';
  const EDITABLE_SEL = 'textarea, input[type="text"], input:not([type]), [contenteditable="true"]';
  const editables = () => new Set([...document.querySelectorAll(EDITABLE_SEL)]);
  const pressEscape = () =>
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));

  function setValue(el, value) {
    el.focus();
    if (el.isContentEditable) {
      el.textContent = value;
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    } else {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    el.blur?.();
  }

  // Clica em "Atualizar" e espera o Studio processar antes de seguir
  async function clickUpdate() {
    const btn = await waitFor(() => {
      const b = findUpdateBtn();
      return b && isEnabled(b) ? b : null;
    }, 8000);
    if (!btn) throw new Error('Botão "Atualizar" não encontrado ou desabilitado');
    btn.click();
    await waitFor(() => {
      const b = findUpdateBtn();
      return !b || !isEnabled(b);
    }, WAIT.updateSettle);
    await sleep(WAIT.afterUpdate);
  }

  // Adiciona o idioma (escolhido pelo código), preenche o título e clica em "Atualizar"
  async function addLanguageWithTitle(code, text, codeMap) {
    const add = await waitFor(findAddBtn, 8000);
    if (!add) throw new Error('Botão "Adicionar idioma" não encontrado');
    const beforeFields = editables();
    add.click();
    await sleep(WAIT.afterAddClick);
    const item = await waitFor(() => {
      const cands = [...document.querySelectorAll(ITEM_SEL)].filter(
        (el) => isVisible(el) && codeMap.get(norm(clean(el.textContent))) === code
      );
      return cands.find((el) => !el.textContent.includes('(')) || cands[0] || null; // prefere o nome sem variante
    }, 5000);
    if (!item) { pressEscape(); throw new Error('Idioma não encontrado no menu (não existe no Studio ou já foi adicionado)'); }
    item.click();
    const field = await waitFor(
      () => [...editables()].find((el) => !beforeFields.has(el) && isVisible(el)),
      WAIT.field
    );
    if (!field) throw new Error('Campo de título não apareceu');
    await sleep(500);
    setValue(field, text);
    await sleep(WAIT.afterFill);
    await clickUpdate(); // vale para todos os idiomas, inclusive o último
  }

  // Overlay bloqueante apenas com mensagem de espera
  function showWait(total) {
    const host = document.createElement('div');
    host.id = 'tm-wait';
    const r = host.attachShadow({ mode: 'open' });
    r.innerHTML = `
      <style>
        .ov{position:fixed;inset:0;background:rgba(0,0,0,.78);z-index:100000;display:flex;align-items:center;justify-content:center;font-family:Roboto,Arial,sans-serif;color:#fff;font-size:16px}
        .b{background:#282828;border-radius:12px;padding:24px;width:420px;max-width:90vw;text-align:center;display:flex;flex-direction:column;gap:12px}
        .spin{width:36px;height:36px;margin:0 auto;border:4px solid #555;border-top-color:#3ea6ff;border-radius:50%;animation:s 1s linear infinite}
        @keyframes s{to{transform:rotate(360deg)}}
        .det{font-size:14px;color:#bbb}
      </style>
      <div class="ov"><div class="b">
        <div class="spin"></div>
        <div>Aplicando traduções… Aguarde até a conclusão.</div>
        <div class="det" id="det">Não clique nem feche a página durante o processo.</div>
      </div></div>`;
    document.body.appendChild(host);
    return {
      progress: (i, name) => (r.getElementById('det').textContent = `(${i}/${total}) ${name}`),
      close: () => host.remove()
    };
  }

  async function applyTranslations(items) {
    const wait = showWait(items.length);
    const codeMap = buildCodeMap();
    try {
      for (let i = 0; i < items.length; i++) {
        const { code, name, text } = items[i];
        wait.progress(i + 1, name);
        try {
          await addLanguageWithTitle(code, text, codeMap);
        } catch (e) {
          console.warn(`[Tradução múltipla] Falha ao aplicar "${name}" (${code}):`, e.message);
          pressEscape();
        }
        await sleep(WAIT.betweenLangs);
      }
    } finally {
      wait.close(); // só fecha depois do "Atualizar" do último idioma ter sido processado
    }
  }

  // ---------- Popup (Shadow DOM para não conflitar com o CSS do Studio) ----------
  function renderModal(options, saved) {
    document.getElementById('tm-host')?.remove();
    const host = document.createElement('div');
    host.id = 'tm-host';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>
        .ov{position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:99999;display:flex;align-items:center;justify-content:center;font-family:Roboto,Arial,sans-serif;font-size:14px}
        .box{background:#282828;color:#fff;width:520px;max-width:94vw;max-height:88vh;border-radius:12px;padding:20px;display:flex;flex-direction:column;gap:12px}
        h2{margin:0;font-size:18px} input[type=text]{padding:8px;border-radius:6px;border:1px solid #555;background:#1f1f1f;color:#fff;font-size:14px}
        .list{overflow:auto;max-height:260px;border:1px solid #444;border-radius:6px;padding:6px}
        .list label{display:flex;gap:8px;padding:4px;cursor:pointer;font-size:18px;align-items:center}
        .list input[type=checkbox]{width:18px;height:18px}
        .row{display:flex;gap:8px;align-items:center} .sp{flex:1}
        button{padding:8px 16px;border-radius:18px;border:0;cursor:pointer;font-weight:500}
        .pri{background:#3ea6ff;color:#0f0f0f} .sec{background:#3f3f3f;color:#fff} button:disabled{opacity:.5;cursor:wait}
        [hidden]{display:none!important}
        .res{overflow:auto;max-height:260px;font-size:13px;display:flex;flex-direction:column;gap:6px}
        .it{background:#1f1f1f;border-radius:6px;padding:8px} .it b{display:block;color:#aaa;font-weight:500;margin-bottom:4px}
        textarea{width:100%;box-sizing:border-box;background:#121212;color:#fff;border:1px solid #555;border-radius:6px;padding:6px;font:inherit;font-size:14px;resize:vertical}
        .cnt{font-size:12px;color:#aaa} .cnt.over{color:#ffb84d}
        .err{color:#ff7b7b}
      </style>
      <div class="ov"><div class="box">
        <h2>Tradução múltipla de títulos</h2>
        <input type="text" id="title" placeholder="Título do vídeo">
        <div class="row"><button class="sec" id="none">Limpar</button><span class="sp"></span><span id="cnt">0 selecionados</span></div>
        <div class="list" id="list"></div>
        <div id="status"></div>
        <div class="res" id="res"></div>
        <div class="row">
          <button class="sec" id="close">Fechar</button><span class="sp"></span>
          <button class="pri" id="go">Traduzir títulos</button>
          <button class="pri" id="apply" hidden>Aplicar traduções</button>
        </div>
      </div></div>`;
    document.body.appendChild(host);
    const $ = (id) => root.getElementById(id);

    $('title').value = getVideoTitle();
    const savedSet = new Set(saved);
    const list = $('list');
    options.forEach((o, i) => {
      const l = document.createElement('label');
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.value = o.code; cb.dataset.i = i; cb.checked = savedSet.has(o.code);
      l.append(cb, document.createTextNode(o.name));
      list.appendChild(l);
    });
    const boxes = () => [...list.querySelectorAll('input')];
    const updateCount = () => ($('cnt').textContent = `${boxes().filter((b) => b.checked).length} selecionados`);
    const saveSelection = () => {
      try { chrome.storage.local.set({ [STORAGE_KEY]: boxes().filter((b) => b.checked).map((b) => b.value) }); } catch { /* ignora */ }
    };
    list.addEventListener('change', () => { updateCount(); saveSelection(); });
    $('none').onclick = () => { boxes().forEach((b) => (b.checked = false)); updateCount(); saveSelection(); };
    $('close').onclick = () => host.remove();
    updateCount();

    $('go').onclick = async () => {
      const chosen = boxes().filter((b) => b.checked).map((b) => ({ name: options[b.dataset.i].name, code: b.value }));
      const title = $('title').value.trim();
      if (!title) { $('status').textContent = 'Título não encontrado. Digite-o no campo acima.'; return; }
      if (!chosen.length) { $('status').textContent = 'Selecione ao menos um idioma.'; return; }
      $('go').disabled = true;
      $('apply').hidden = true;
      $('status').className = '';
      $('status').textContent = 'Traduzindo…';
      $('res').innerHTML = '';

      const r = await api('translate', { title, targets: chosen.map((c) => c.code) });
      $('go').disabled = false;
      if (!r.ok) { $('status').textContent = r.data.error || 'Erro'; $('status').className = 'err'; return; }

      const byCode = new Map(r.data.results.map((x) => [x.code, x]));
      $('status').textContent = `Original: ${title}`;
      let hasText = false;
      chosen.forEach(({ name, code }) => {
        const x = byCode.get(code) || { error: 'Sem resposta' };
        const d = document.createElement('div'); d.className = 'it';
        const h = document.createElement('b'); h.textContent = `${name} (${code})`;
        d.appendChild(h);
        if (x.error) {
          const e = document.createElement('div'); e.className = 'err'; e.textContent = x.error;
          d.appendChild(e);
        } else {
          hasText = true;
          const ta = document.createElement('textarea');
          ta.rows = 2; ta.value = x.text; ta.dataset.code = code; ta.dataset.name = name;
          const c = document.createElement('div'); c.className = 'cnt';
          const upd = () => {
            c.textContent = `${ta.value.length}/100`;
            c.classList.toggle('over', ta.value.length > 100);
          };
          ta.addEventListener('input', upd);
          upd();
          d.append(ta, c);
        }
        $('res').appendChild(d);
      });
      $('apply').hidden = !hasText; // só aparece quando há títulos traduzidos
    };

    $('apply').onclick = () => {
      const items = [...root.querySelectorAll('textarea[data-code]')]
        .map((ta) => ({ code: ta.dataset.code, name: ta.dataset.name, text: ta.value.trim() }))
        .filter((i) => i.text);
      if (!items.length) { $('status').textContent = 'Nenhum título para aplicar.'; return; }
      host.remove(); // fecha o modal; o overlay de espera assume
      applyTranslations(items);
    };
  }
})();
