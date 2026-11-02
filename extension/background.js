// ---------- Tradução via API local: POST http://localhost:8000/translate  { "text": "...", "to": "xx" } ----------
const ENDPOINT = 'http://localhost:8000/translate';

// ---------- TikTok Studio ----------
const TIKTOK_URL = 'https://www.tiktok.com/tiktokstudio/content';
const TIKTOK_TAB_ACTIVE = false; // mude para true se o TikTok não carregar a lista com a aba em segundo plano
const TIKTOK_WAIT = { total: 45000, retry: 500 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Extrai o texto traduzido da resposta (o formato exato pode variar)
function extractText(v) {
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.length ? extractText(v[0]) : null;
  if (v && typeof v === 'object') {
    for (const k of ['translated_text', 'translatedText', 'translation', 'translated', 'result', 'text', 'data']) {
      if (k in v) {
        const r = extractText(v[k]);
        if (r) return r;
      }
    }
  }
  return null;
}

async function translateOne(text, to) {
  let r;
  try {
    r = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, to })
    });
  } catch {
    throw new Error('Servidor localhost:8000 indisponível');
  }
  const raw = await r.text();
  if (!r.ok) throw new Error(raw || `HTTP ${r.status}`);
  let parsed = raw;
  try { parsed = JSON.parse(raw); } catch { /* resposta em texto puro */ }
  const out = extractText(parsed);
  if (!out) throw new Error('Resposta sem texto traduzido');
  return out.trim();
}

// Abre o TikTok Studio em uma aba em segundo plano (usa a sessão já logada), pede ao
// content script (tiktok-scraper.js) para ler a lista de vídeos e fecha a aba.
async function scrapeTiktok() {
  const tab = await chrome.tabs.create({ url: TIKTOK_URL, active: TIKTOK_TAB_ACTIVE });
  try {
    const deadline = Date.now() + TIKTOK_WAIT.total;
    while (Date.now() < deadline) {
      try {
        const res = await chrome.tabs.sendMessage(tab.id, { type: 'scrape-tiktok' });
        if (res) return res;
      } catch {
        // content script ainda não carregou (ou a página foi redirecionada)
      }
      const current = await chrome.tabs.get(tab.id).catch(() => null);
      if (!current) return { ok: false, error: 'A aba do TikTok foi fechada antes de terminar.' };
      if (current.status === 'complete' && current.url && !current.url.includes('/tiktokstudio/')) {
        return { ok: false, error: 'Sessão do TikTok não encontrada. Faça login em tiktok.com e tente de novo.' };
      }
      await sleep(TIKTOK_WAIT.retry);
    }
    return { ok: false, error: 'Tempo esgotado ao carregar o TikTok Studio.' };
  } finally {
    chrome.tabs.remove(tab.id).catch(() => { /* aba já fechada */ });
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'translate') {
    Promise.all(
      msg.targets.map(async (code) => {
        try {
          return { code, text: await translateOne(msg.title, code) };
        } catch (e) {
          return { code, error: e.message };
        }
      })
    ).then((results) => sendResponse({ ok: true, data: { results } }));
    return true; // resposta assíncrona
  }

  if (msg.type === 'tiktok-videos') {
    scrapeTiktok()
      .then((r) => sendResponse(r.ok ? { ok: true, data: { videos: r.videos } } : { ok: false, data: { error: r.error } }))
      .catch((e) => sendResponse({ ok: false, data: { error: e.message } }));
    return true;
  }

  return false;
});
