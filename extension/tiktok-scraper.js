// Roda dentro do TikTok Studio (https://www.tiktok.com/tiktokstudio/*) e lê a listagem de vídeos.
(() => {
  const VIDEO_LINK_SEL = 'a[href*="/video/"]'; // link do vídeo: o texto dentro dele é a descrição
  const MAX_ITEMS = 30;
  const WAIT = { rows: 25000, poll: 700, stableRounds: 2 };
  const THUMB_WIDTH = 160;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const keyOf = (a) => a.href.split(/[?#]/)[0];

  // Todo o texto dentro do link do vídeo, preservando quebras de linha
  function textOf(a) {
    const clone = a.cloneNode(true);
    clone.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
    return clone.textContent.trim();
  }

  // Um item por vídeo; entre links repetidos (miniatura + legenda) vale o que tem mais texto
  function collect() {
    const byKey = new Map();
    for (const a of document.querySelectorAll(VIDEO_LINK_SEL)) {
      const text = textOf(a);
      const current = byKey.get(keyOf(a));
      if (!current || text.length > current.text.length) byKey.set(keyOf(a), { a, text, url: a.href });
    }
    return [...byKey.values()].filter((v) => v.text);
  }

  // Maior ancestral que ainda contém apenas este vídeo = "card" da linha
  function findCard(a) {
    let el = a;
    while (el.parentElement && el.parentElement !== document.body) {
      const keys = new Set([...el.parentElement.querySelectorAll(VIDEO_LINK_SEL)].map(keyOf));
      if (keys.size > 1) break;
      el = el.parentElement;
    }
    return el;
  }

  function findThumbSrc(card) {
    const area = (i) => {
      const r = i.getBoundingClientRect();
      return r.width * r.height;
    };
    const img = [...card.querySelectorAll('img')]
      .filter((i) => i.currentSrc || i.src)
      .sort((x, y) => area(y) - area(x))[0]; // a maior imagem do card (ignora avatares)
    if (img) return img.currentSrc || img.src;
    const bg = card.querySelector('[style*="background-image"]');
    const m = bg && bg.style.backgroundImage.match(/url\(["']?(.*?)["']?\)/);
    return m ? m[1] : '';
  }

  // Reduz a miniatura para data URL (evita bloqueio de CSP/hotlink no YouTube); se falhar, usa a URL original
  async function toDataUrl(src) {
    try {
      const res = await fetch(src);
      const bmp = await createImageBitmap(await res.blob());
      const canvas = document.createElement('canvas');
      canvas.width = THUMB_WIDTH;
      canvas.height = Math.round((bmp.height / bmp.width) * THUMB_WIDTH);
      canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/jpeg', 0.7);
    } catch {
      return src;
    }
  }

  // Espera a lista renderizar e a quantidade de itens estabilizar
  async function waitForRows() {
    const start = Date.now();
    let last = -1;
    let stable = 0;
    while (Date.now() - start < WAIT.rows) {
      const n = collect().length;
      stable = n > 0 && n === last ? stable + 1 : 0;
      if (stable >= WAIT.stableRounds) return true;
      last = n;
      await sleep(WAIT.poll);
    }
    return last > 0;
  }

  async function scrape() {
    if (!(await waitForRows())) {
      return { ok: false, error: 'Nenhum vídeo encontrado no TikTok Studio. Verifique se você está logado.' };
    }
    const videos = await Promise.all(
      collect().slice(0, MAX_ITEMS).map(async ({ a, text, url }) => {
        const src = findThumbSrc(findCard(a));
        return { url, text, thumb: src ? await toDataUrl(src) : '' };
      })
    );
    return { ok: true, videos };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type !== 'scrape-tiktok') return false;
    scrape().then(sendResponse);
    return true;
  });
})();
