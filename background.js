// Traduz via API local: POST http://localhost:8000/translate  { "text": "...", "to": "xx" }
const ENDPOINT = 'http://localhost:8000/translate';

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

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type !== 'translate') return false;
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
});