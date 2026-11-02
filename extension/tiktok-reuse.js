// Botão "Reutilizar do Tiktok" ao lado de "Reutilizar detalhes" no diálogo de upload do YouTube Studio.
(() => {
  const BTN_ID = 'tm-tiktok-btn';
  const HOST_ID = 'tm-tiktok-host';
  const REUSE_LABELS = ['reutilizar detalhes', 'reuse details'];
  const DESCRIPTION_SEL = '#description-textarea [contenteditable="true"]';
  const MAX_CHARS = 180;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clean = (s) => s.trim().replace(/\s+/g, ' ').toLowerCase();
  const isVisible = (el) => el.getClientRects().length > 0;
  const api = (type, payload = {}) =>
    new Promise((res) => {
      chrome.runtime.sendMessage({ type, ...payload }, (r) => {
        res(r || { ok: false, data: { error: chrome.runtime.lastError?.message || 'Sem resposta da extensão' } });
      });
    });

  const preview = (text) => {
    const flat = text.replace(/\s+/g, ' ').trim();
    return flat.length > MAX_CHARS ? `${flat.slice(0, MAX_CHARS).trimEnd()}…` : flat;
  };

  // ---------- Campo de descrição do diálogo de upload ----------
  function findDescriptionBox() {
    const direct = document.querySelector(DESCRIPTION_SEL);
    if (direct) return direct;
    const boxes = [...document.querySelectorAll('ytcp-uploads-dialog #textbox[contenteditable="true"]')];
    return boxes[1] || null; // 1º = título, 2º = descrição
  }

  // Substitui todo o conteúdo do campo pelo texto do TikTok
  function fillDescription(box, text) {
    box.focus();
    const range = document.createRange();
    range.selectNodeContents(box);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    const ok = document.execCommand('insertText', false, text);
    if (!ok || !box.textContent.trim()) {
      box.innerText = text;
      box.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    }
  }

  // ---------- Modal (mesmo layout da lista de "Reutilizar detalhes") ----------
  let modalOpen = false;

  function openModal() {
    if (modalOpen) return;
    modalOpen = true;

    const host = document.createElement('div');
    host.id = HOST_ID;
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>
        .ov{position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:100001;display:flex;align-items:center;justify-content:center;font-family:Roboto,Arial,sans-serif;font-size:14px}
        .box{background:#282828;color:#fff;width:640px;max-width:94vw;max-height:86vh;border-radius:12px;display:flex;flex-direction:column;overflow:hidden}
        .hd{padding:16px 20px;border-bottom:1px solid #3f3f3f}
        h2{margin:0;font-size:18px;font-weight:500}
        .body{overflow:auto;flex:1;min-height:160px}
        .it{display:flex;gap:12px;padding:10px 20px;cursor:pointer;align-items:flex-start}
        .it:hover,.it:focus{background:#3f3f3f;outline:none}
        .th{width:64px;height:86px;flex:none;border-radius:6px;object-fit:cover;background:#1f1f1f}
        .tx{flex:1;line-height:1.4;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word}
        .state{padding:40px 20px;text-align:center;color:#bbb;display:flex;flex-direction:column;align-items:center;gap:12px}
        .state.err{color:#ff7b7b}
        .spin{width:32px;height:32px;border:4px solid #555;border-top-color:#3ea6ff;border-radius:50%;animation:s 1s linear infinite}
        @keyframes s{to{transform:rotate(360deg)}}
        .msg{padding:8px 20px 0;color:#ff7b7b}
        .msg:empty{display:none}
        .ft{padding:12px 20px;border-top:1px solid #3f3f3f;display:flex;justify-content:flex-end;gap:8px}
        button{padding:8px 16px;border-radius:18px;border:0;cursor:pointer;font-weight:500}
        .sec{background:#3f3f3f;color:#fff}
        .pri{background:#3ea6ff;color:#0f0f0f}
      </style>
      <div class="ov"><div class="box">
        <div class="hd"><h2>Reutilizar do TikTok</h2></div>
        <div class="body" id="body"></div>
        <div class="msg" id="msg"></div>
        <div class="ft"><button class="sec" id="close">Cancelar</button></div>
      </div></div>`;
    document.body.appendChild(host);
    const $ = (id) => root.getElementById(id);

    function close() {
      document.removeEventListener('keydown', onKey, true);
      host.remove();
      modalOpen = false;
    }
    // Esc fecha só este modal (não o diálogo de upload do YouTube)
    function onKey(e) {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      e.preventDefault();
      close();
    }
    document.addEventListener('keydown', onKey, true);
    $('close').onclick = close;
    root.querySelector('.ov').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) close();
    });

    const setState = (html, cls = '') => {
      $('body').innerHTML = `<div class="state ${cls}">${html}</div>`;
    };

    async function choose(video) {
      const box = findDescriptionBox();
      if (!box) {
        $('msg').textContent = 'Campo de descrição não encontrado. Vá até a etapa "Detalhes" do upload.';
        return;
      }
      close();
      await sleep(150);
      fillDescription(box, video.text);
    }

    function renderList(videos) {
      const body = $('body');
      body.innerHTML = '';
      videos.forEach((v) => {
        const row = document.createElement('div');
        row.className = 'it';
        row.tabIndex = 0;

        const thumb = document.createElement(v.thumb ? 'img' : 'div');
        thumb.className = 'th';
        if (v.thumb) {
          thumb.referrerPolicy = 'no-referrer';
          thumb.alt = '';
          thumb.src = v.thumb;
        }
        const text = document.createElement('div');
        text.className = 'tx';
        text.textContent = preview(v.text);
        text.title = v.text;

        row.append(thumb, text);
        row.addEventListener('click', () => choose(v));
        row.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') choose(v);
        });
        body.appendChild(row);
      });
    }

    async function load() {
      $('msg').textContent = '';
      setState('<div class="spin"></div><div>Carregando vídeos do TikTok Studio…<br>Uma aba do TikTok será aberta e fechada automaticamente.</div>');
      const r = await api('tiktok-videos');
      if (!host.isConnected) return; // modal fechado durante o carregamento
      if (!r.ok || !r.data.videos.length) {
        setState('<div></div>', 'err');
        const box = $('body').firstElementChild;
        box.firstElementChild.textContent = r.ok ? 'Nenhum vídeo com descrição encontrado.' : (r.data.error || 'Erro ao carregar o TikTok Studio.');
        const retry = document.createElement('button');
        retry.className = 'pri';
        retry.textContent = 'Tentar novamente';
        retry.onclick = load;
        box.appendChild(retry);
        return;
      }
      renderList(r.data.videos);
    }

    load();
  }

  // ---------- Injeção do botão (o diálogo de upload abre e fecha dinamicamente) ----------
  const findReuseBtn = () =>
    [...document.querySelectorAll('ytcp-button, button')].find(
      (b) => b.id !== BTN_ID && isVisible(b) && REUSE_LABELS.includes(clean(b.textContent))
    );

  let scheduled = false;
  function inject() {
    scheduled = false;
    const reuse = findReuseBtn();
    if (!reuse) return;
    const existing = document.getElementById(BTN_ID);
    if (existing && reuse.nextElementSibling === existing) return;
    existing?.remove();

    const btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.type = 'button';
    btn.textContent = 'Reutilizar do Tiktok';
    btn.style.cssText =
      'margin-left:8px;padding:0 16px;height:36px;border:1px solid #3ea6ff;border-radius:18px;' +
      'background:transparent;color:#3ea6ff;font:500 14px Roboto,Arial,sans-serif;cursor:pointer;';
    btn.addEventListener('click', openModal);
    reuse.insertAdjacentElement('afterend', btn);
  }

  new MutationObserver(() => {
    if (!scheduled) { scheduled = true; requestAnimationFrame(inject); }
  }).observe(document.body, { childList: true, subtree: true });
  inject();
})();
