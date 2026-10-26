/* ===================== Štullers – generátor clean print mockupov =====================
   Bez AI a bez externej služby: mockup sa skladá v prehliadači z pevnej šablóny.
   Vrstvy: biele pozadie → tieň → papier vo zvolenom odtieni → ilustrácia (bez prelínania,
   farby ostávajú presne podľa originálu; priehľadné miesta ukážu odtieň papiera).
   Originál sa nikdy neupravuje ani neprepisuje. */
(function(){
  const TEMPLATE = 'clean-1';
  const TONES = {
    A: { paper: '#ffffff', sk: 'A – Čistá biela' },
    B: { paper: '#fbf7ef', sk: 'B – Jemná krémová' },
  };
  // [mäkký tieň: priehľadnosť, rozmazanie, posun] + [hrana papiera: priehľadnosť]
  const SHADOWS = {
    soft:   { a: 0.10, blur: 0.023, y: 0.007, edge: 0.10, sk: 'jemný tieň' },
    medium: { a: 0.14, blur: 0.028, y: 0.010, edge: 0.13, sk: 'stredný tieň' },
    strong: { a: 0.19, blur: 0.033, y: 0.013, edge: 0.16, sk: 'výraznejší tieň' },
  };
  const SIZES = {
    large: { scale: 0.80, sk: 'väčší print' },
    airy:  { scale: 0.68, sk: 'viac priestoru' },
  };
  const MARGIN = 0.09;   // okraj papiera okolo ilustrácie

  function loadImage(src){
    return new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i); i.onerror = () => rej(new Error('img'));
      i.src = src;
    });
  }

  // zmeria vlastný biely (alebo priehľadný) okraj originálu, aby nevznikol dvojitý okraj
  function analyze(img){
    const W = 400, sc = Math.min(1, W / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * sc)), h = Math.max(1, Math.round(img.naturalHeight * sc));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0, w, h);
    const d = g.getImageData(0, 0, w, h).data;
    let transparent = false, opaqueWhiteBg = true;
    const blank = (x, y) => { const i = (y * w + x) * 4; if(d[i + 3] < 12){ transparent = true; return true; } return d[i] > 246 && d[i + 1] > 246 && d[i + 2] > 246; };
    const rowBlank = (y) => { for(let x = 0; x < w; x++) if(!blank(x, y)) return false; return true; };
    const colBlank = (x) => { for(let y = 0; y < h; y++) if(!blank(x, y)) return false; return true; };
    let top = 0; while(top < h / 2 && rowBlank(top)) top++;
    let bottom = 0; while(bottom < h / 2 && rowBlank(h - 1 - bottom)) bottom++;
    let left = 0; while(left < w / 2 && colBlank(left)) left++;
    let right = 0; while(right < w / 2 && colBlank(w - 1 - right)) right++;
    for(let i = 3; i < d.length; i += 4){ if(d[i] < 250){ transparent = true; break; } }
    // má originál nepriehľadné biele pozadie? (rohy sú biele a nepriehľadné)
    const corner = (x, y) => { const i = (y * w + x) * 4; return d[i + 3] > 240 && d[i] > 246 && d[i + 1] > 246 && d[i + 2] > 246; };
    opaqueWhiteBg = corner(0, 0) && corner(w - 1, 0) && corner(0, h - 1) && corner(w - 1, h - 1);
    const minSide = Math.min(w, h);
    return {
      border: Math.min(top, bottom, left, right) / minSide,   // najmenší okraj ako podiel kratšej strany
      transparent, opaqueWhiteBg,
      landscape: img.naturalWidth > img.naturalHeight * 1.05,
      width: img.naturalWidth, height: img.naturalHeight,
    };
  }

  function render(img, info, opt, S){
    const tone = TONES[opt.tone] || TONES.A, sh = SHADOWS[opt.shadow] || SHADOWS.soft, sz = SIZES[opt.size] || SIZES.large;
    const c = document.createElement('canvas'); c.width = c.height = S;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, S, S);                 // čisto biele pozadie
    const r = Math.SQRT2;                                                  // papier vo formáte A
    let ph, pw;
    if(info.landscape){ pw = S * sz.scale; ph = pw / r; } else { ph = S * sz.scale; pw = ph / r; }
    const x = Math.round((S - pw) / 2), y = Math.round((S - ph) / 2 - S * 0.008);
    pw = Math.round(pw); ph = Math.round(ph);
    ctx.save();
    ctx.shadowColor = `rgba(0,0,0,${sh.a})`; ctx.shadowBlur = S * sh.blur; ctx.shadowOffsetY = S * sh.y;
    ctx.fillStyle = tone.paper; ctx.fillRect(x, y, pw, ph);
    ctx.restore();
    ctx.save();
    ctx.shadowColor = `rgba(0,0,0,${sh.edge})`; ctx.shadowBlur = Math.max(1.5, S * 0.0015); ctx.shadowOffsetY = Math.max(0.5, S * 0.0005);
    ctx.fillStyle = tone.paper; ctx.fillRect(x, y, pw, ph);
    ctx.restore();
    // okraj papiera: ak má originál vlastný biely okraj, o toľko sa zmenší
    let m = Math.min(pw, ph) * MARGIN;
    const bw0 = pw - 2 * m, bh0 = ph - 2 * m;
    const s0 = Math.min(bw0 / info.width, bh0 / info.height);
    const own = info.border * Math.min(info.width, info.height) * s0;
    m = Math.max(Math.min(pw, ph) * 0.02, m - own);
    const bw = pw - 2 * m, bh = ph - 2 * m;
    const s = Math.min(bw / info.width, bh / info.height);
    const iw = info.width * s, ih = info.height * s;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, x + (pw - iw) / 2, y + (ph - ih) / 2, iw, ih);     // ilustrácia bez zmeny farieb
    return c;
  }

  function toBlob(canvas, type, q){
    return new Promise((res) => canvas.toBlob((b) => res(b), type, q));
  }

  function label(opt){
    return [TONES[opt.tone].sk, SHADOWS[opt.shadow].sk, SIZES[opt.size].sk].join(' · ');
  }

  window.StullersMockup = {
    TEMPLATE, TONES, SHADOWS, SIZES, label,
    async load(src){ const img = await loadImage(src); return { img, info: analyze(img) }; },
    preview(src, opt, size){ return src.img ? render(src.img, src.info, opt, size || 900) : null; },
    // finálne súbory: 3 veľkosti, WebP (ak to prehliadač vie) a JPG
    async finals(src, opt){
      const out = [];
      for(const S of [2400, 1600, 800]){
        const c = render(src.img, src.info, opt, S);
        const jpg = await toBlob(c, 'image/jpeg', 0.9);
        out.push({ size: String(S), format: 'jpg', blob: jpg });
        const webp = await toBlob(c, 'image/webp', 0.9);
        if(webp && webp.type === 'image/webp') out.push({ size: String(S), format: 'webp', blob: webp });
      }
      return out;
    },
  };
})();
