/* ===================== Štullers – administrácia =====================
   Jedna stránka bez knižníc. Obsah sa upravuje ako koncept (priebežne sa ukladá na server),
   na web sa dostane až po stlačení „Zverejniť“. Dizajn webu sa tu nemení – len texty a médiá. */
(function(){
'use strict';

const API = '../api/admin.php';
const S = {
  csrf: '', content: null, meta: null, defaults: { sk: {}, en: {} }, view: 'overview',
  saveTimer: null, saving: false, pending: false, dirtyLocal: false, saveError: '',
  projKind: 'walls', counts: { workshops: 0 }, media: null,
};
const app = document.getElementById('app');

/* ---------- pomocné ---------- */
function h(tag, attrs, ...kids){
  const el = document.createElement(tag);
  for(const k in (attrs || {})){
    const v = attrs[k];
    if(v == null || v === false) continue;
    if(k === 'class') el.className = v;
    else if(k === 'html') el.innerHTML = v;
    else if(k === 'style') el.style.cssText = v;
    else if(k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if(k === 'value') el.value = v;
    else if(k === 'checked') el.checked = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  kids.flat(Infinity).forEach(c => { if(c == null || c === false) return; el.append(c.nodeType ? c : document.createTextNode(String(c))); });
  return el;
}
const fmtDate = (iso) => { if(!iso) return '—'; const d = new Date(iso); if(isNaN(d)) return iso; return d.toLocaleDateString('sk-SK') + ' ' + d.toLocaleTimeString('sk-SK', { hour: '2-digit', minute: '2-digit' }); };
const fmtSize = (n) => n > 1048576 ? (n / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(n / 1024)) + ' kB';
const uid = (p) => p + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const isVideo = (p) => /\.(mp4|webm|m4v)$/i.test(p || '');
const mediaUrl = (p) => !p ? '' : (/^(https?:|data:|blob:)/.test(p) ? p : '../' + p);
const clone = (o) => JSON.parse(JSON.stringify(o));
const fill = (el, ...kids) => el.replaceChildren(...kids.flat(Infinity).filter(k => k != null && k !== false));

let toastT = null;
function toast(msg, err){
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'toast' + (err ? ' err' : ''); t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, err ? 6000 : 3200);
}

const ERR = {
  network: 'Server neodpovedá. Skontroluj pripojenie.',
  server: 'Server odpovedal neočakávane (beží na hostingu PHP?).',
  login_required: 'Prihlásenie vypršalo. Prihlás sa znova.',
  csrf: 'Bezpečnostný kód relácie nesedí. Obnov stránku.',
  rate_limited: 'Príliš veľa pokusov. Skús to o chvíľu.',
  bad_password: 'Nesprávne heslo.',
  bad_code: 'Nesprávny inštalačný kód.',
  weak_password: 'Heslo musí mať aspoň 10 znakov.',
  too_large: 'Súbor je príliš veľký.',
  bad_type: 'Tento typ súboru sa nedá nahrať. Povolené sú JPG, PNG, WebP, GIF, MP4 a WebM.',
  in_use: 'Súbor sa ešte niekde používa, preto ho nemožno zmazať.',
  write_failed: 'Na server sa nepodarilo zapísať. Skontroluj práva priečinka data/ a media/.',
  conflict: 'Obsah medzitým zmenil niekto iný.',
};
const errText = (r) => ERR[r && r.error] || ('Chyba: ' + ((r && r.error) || 'neznáma'));

async function api(action, opts){
  opts = opts || {};
  const o = { method: opts.method || 'GET', credentials: 'same-origin', headers: {}, cache: 'no-store' };
  if(opts.body){ o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(opts.body); }
  if(o.method !== 'GET') o.headers['X-CSRF-Token'] = S.csrf;
  let r;
  try{ r = await fetch(API + '?action=' + encodeURIComponent(action), o); } catch(e){ return { ok: false, status: 0, error: 'network' }; }
  let j = null; try{ j = await r.json(); } catch(e){}
  if(!j || j.stullers !== true) return { ok: false, status: r.status, error: 'server' };
  if(r.status === 401 && action !== 'state'){ S.content = null; renderLogin({}); }
  return Object.assign({}, j, { status: r.status, ok: r.ok && j.ok === true });
}

function upload(blob, name, onProgress){
  return new Promise((resolve) => {
    const fd = new FormData();
    fd.append('file', blob, name);
    fd.append('name', name);
    const x = new XMLHttpRequest();
    x.open('POST', API + '?action=upload');
    x.setRequestHeader('X-CSRF-Token', S.csrf);
    x.withCredentials = true;
    x.upload.onprogress = (e) => { if(onProgress && e.lengthComputable) onProgress(e.loaded / e.total); };
    x.onload = () => { let j = null; try{ j = JSON.parse(x.responseText); } catch(e){} resolve(j && j.stullers ? Object.assign(j, { ok: x.status === 200 && j.ok }) : { ok: false, error: x.status === 413 ? 'too_large' : 'server' }); };
    x.onerror = () => resolve({ ok: false, error: 'network' });
    x.send(fd);
  });
}

// fotky do galérií: veľmi veľké fotky sa pred nahratím zmenšia na 2 400 px (kvalita na webe ostáva)
async function prepareImage(file, keepOriginal){
  if(keepOriginal || !/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
  const url = URL.createObjectURL(file);
  try{
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const max = Math.max(img.naturalWidth, img.naturalHeight);
    if(max <= 2600) return file;
    const sc = 2400 / max;
    const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * sc); c.height = Math.round(img.naturalHeight * sc);
    const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(img, 0, 0, c.width, c.height);
    const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
    const b = await new Promise(r => c.toBlob(r, type, 0.88));
    return b ? new File([b], file.name.replace(/\.\w+$/, type === 'image/png' ? '.png' : '.jpg'), { type }) : file;
  } catch(e){ return file; } finally { URL.revokeObjectURL(url); }
}

async function uploadFiles(files, keepOriginal){
  const out = [];
  for(const f of files){
    const prepared = await prepareImage(f, keepOriginal);
    toast('Nahrávam ' + f.name + '…');
    const r = await upload(prepared, prepared.name || f.name);
    if(!r.ok){ toast(f.name + ': ' + errText(r), true); continue; }
    out.push(r.path);
  }
  if(out.length){ S.media = null; toast(out.length === 1 ? 'Súbor je nahratý.' : 'Súbory sú nahraté.'); }
  return out;
}

/* ---------- obsah a ukladanie konceptu ---------- */
const C = () => S.content;
function textVal(lang, key){
  const o = C().texts && C().texts[lang];
  if(o && Object.prototype.hasOwnProperty.call(o, key)) return o[key];
  return (S.defaults[lang] && S.defaults[lang][key]) || '';
}
function setText(lang, key, v){
  const c = C();
  if(!c.texts || Array.isArray(c.texts)) c.texts = {};
  if(!c.texts[lang] || Array.isArray(c.texts[lang])) c.texts[lang] = {};
  if(v === ((S.defaults[lang] && S.defaults[lang][key]) || '')) delete c.texts[lang][key]; else c.texts[lang][key] = v;
  changed();
}
function ensure(obj, key, def){ if(obj[key] == null || typeof obj[key] !== typeof def || Array.isArray(obj[key]) !== Array.isArray(def)) obj[key] = def; return obj[key]; }
function normalize(c){
  ensure(c, 'site', {}); ensure(c, 'texts', {}); ensure(c, 'pages', {}); ensure(c, 'globals', {}); ensure(c, 'seo', {}); ensure(c, 'trash', []);
  ['walls', 'workshops', 'illustrations', 'graphicDesign'].forEach(k => ensure(c.site, k, []));
  ensure(c.site, 'shop', {}); ensure(c.site.shop, 'products', []);
  ensure(c.site, 'about', {}); ensure(c.site.about, 'paragraphs', []);
  ensure(c.seo, 'sk', {});
  return c;
}

function changed(){
  S.dirtyLocal = true; S.saveError = '';
  updateStatus();
  clearTimeout(S.saveTimer);
  S.saveTimer = setTimeout(save, 900);
}
async function save(force){
  clearTimeout(S.saveTimer);
  if(S.saving){ S.pending = true; return; }
  if(!S.dirtyLocal && !force) return;
  S.saving = true; S.dirtyLocal = false; updateStatus();
  const r = await api('save', { method: 'POST', body: { content: S.content, rev: S.meta.draftRev, force: !!force } });
  S.saving = false;
  if(r.ok){ S.meta = r.meta; }
  else if(r.status === 409){ S.dirtyLocal = true; conflictDialog(r.meta); }
  else { S.dirtyLocal = true; S.saveError = errText(r); if(r.status !== 401) toast('Koncept sa neuložil: ' + S.saveError, true); }
  updateStatus();
  if(S.pending){ S.pending = false; save(); }
}
async function flush(){ if(S.dirtyLocal || S.saving){ await save(); while(S.saving) await new Promise(r => setTimeout(r, 120)); } return !S.dirtyLocal; }
window.addEventListener('beforeunload', (e) => { if(S.dirtyLocal || S.saving){ e.preventDefault(); e.returnValue = ''; } });

function conflictDialog(meta){
  modal({
    title: 'Obsah sa medzitým zmenil',
    body: [h('p', null, 'Koncept medzitým uložil niekto iný, napríklad v inom okne alebo na mobile (' + fmtDate(meta && meta.draftSavedAt) + ').'),
           h('p', { class: 'muted', style: 'margin-top:8px' }, 'Môžeš načítať jeho verziu (tvoje posledné úpravy sa stratia), alebo ho prepísať svojou verziou.')],
    actions: [
      { label: 'Načítať aktuálny koncept', ghost: true, run: async (close) => { close(); await loadContent(); render(); toast('Načítaný aktuálny koncept.'); } },
      { label: 'Prepísať mojou verziou', run: async (close) => { close(); await save(true); } },
    ],
  });
}

async function loadContent(){
  const r = await api('content');
  if(!r.ok) return false;
  S.content = normalize(r.content); S.meta = r.meta; S.dirtyLocal = false;
  return true;
}

/* ---------- prihlásenie a inštalácia ---------- */
function authCard(title, lead, fields, btnLabel, onSubmit){
  const err = h('p', { class: 'auth-err', hidden: true });
  const btn = h('button', { class: 'btn', type: 'submit' }, btnLabel);
  const form = h('form', { class: 'auth-card', onsubmit: async (e) => {
    e.preventDefault(); err.hidden = true; btn.disabled = true;
    const msg = await onSubmit(form);
    btn.disabled = false;
    if(msg){ err.textContent = msg; err.hidden = false; }
  } }, h('h1', null, title), h('p', null, lead), fields, btn, err);
  fill(app, h('div', { class: 'auth' }, form));
  const first = form.querySelector('input'); if(first) first.focus();
}
function renderInstall(st){
  authCard('Štullers', 'Prvé spustenie administrácie. Nastav si heslo – bude jedno spoločné pre vás oboch.', [
    h('label', { for: 'ic' }, 'Inštalačný kód'),
    h('input', { id: 'ic', type: 'text', autocomplete: 'off', required: true, style: 'text-transform:uppercase' }),
    h('p', { class: 'hint' }, 'Nájdeš ho na hostingu v súbore data/INSTALACNY-KOD.txt (správca súborov alebo FTP vo Websupporte). Chráni administráciu, aby si heslo nemohol nastaviť nikto cudzí.'),
    h('label', { for: 'p1' }, 'Nové heslo (aspoň 10 znakov)'),
    h('input', { id: 'p1', type: 'password', autocomplete: 'new-password', required: true, minlength: 10 }),
    h('label', { for: 'p2' }, 'Heslo ešte raz'),
    h('input', { id: 'p2', type: 'password', autocomplete: 'new-password', required: true }),
    st.https ? null : h('p', { class: 'hint', style: 'color:#c77700' }, 'Pozor: stránka nebeží cez HTTPS. Na ostrom webe zapni vo Websupporte SSL certifikát.'),
  ], 'Nastaviť heslo', async (f) => {
    const p1 = f.querySelector('#p1').value, p2 = f.querySelector('#p2').value;
    if(p1.length < 10) return ERR.weak_password;
    if(p1 !== p2) return 'Heslá sa nezhodujú.';
    const r = await api('install', { method: 'POST', body: { code: f.querySelector('#ic').value.trim(), password: p1 } });
    if(!r.ok) return errText(r);
    S.csrf = r.csrf; await start(); return '';
  });
}
function renderLogin(st){
  authCard('Štullers', 'Administrácia webu', [
    h('label', { for: 'pw' }, 'Heslo'),
    h('input', { id: 'pw', type: 'password', autocomplete: 'current-password', required: true }),
    st && st.https === false ? h('p', { class: 'hint', style: 'color:#c77700' }, 'Stránka nebeží cez HTTPS – heslo by sa dalo odchytiť. Zapni SSL vo Websupporte.') : null,
  ], 'Prihlásiť', async (f) => {
    const r = await api('login', { method: 'POST', body: { password: f.querySelector('#pw').value } });
    if(!r.ok){
      if(r.error === 'rate_limited') return 'Príliš veľa nesprávnych pokusov. Skús to znova o ' + Math.ceil((r.retryAfter || 900) / 60) + ' min.';
      if(r.error === 'bad_password') return 'Nesprávne heslo.' + (r.left != null ? ' Zostáva pokusov: ' + r.left + '.' : '');
      return errText(r);
    }
    S.csrf = r.csrf; await start(); return '';
  });
}

/* ---------- rozloženie ---------- */
const NAV = [
  { group: 'Web' },
  { id: 'overview', label: 'Prehľad' },
  { id: 'pages', label: 'Stránky a texty' },
  { id: 'projects', label: 'Projekty' },
  { id: 'shop', label: 'Obchod' },
  { id: 'media', label: 'Médiá' },
  { id: 'globals', label: 'Globálne prvky' },
  { id: 'seo', label: 'SEO' },
  { group: 'Prevádzka' },
  { id: 'game', label: 'Hra a menu' },
  { id: 'requests', label: 'Zadania workshopov', count: () => S.counts.workshops },
  { group: 'Verzie' },
  { id: 'preview', label: 'Náhľad' },
  { id: 'history', label: 'História verzií' },
  { id: 'account', label: 'Účet' },
];
const VIEWS = {};

function renderShell(){
  const side = h('nav', { class: 'side', 'aria-label': 'Sekcie administrácie' },
    h('div', { class: 'brand' }, 'Štullers', h('small', null, 'Administrácia')),
    NAV.map(n => n.group ? h('div', { class: 'nav-group' }, n.group) :
      h('button', { class: 'nav-btn' + (S.view === n.id ? ' active' : ''), type: 'button', 'data-view': n.id, onclick: () => go(n.id) },
        n.label, n.count && n.count() ? h('span', { class: 'count' }, n.count()) : null)),
    h('div', { class: 'side-foot' }, h('a', { href: '../', target: '_blank', rel: 'noopener' }, 'Otvoriť web ↗')));
  const status = h('div', { class: 'status', id: 'status' });
  const top = h('div', { class: 'topbar' }, status,
    h('button', { class: 'btn ghost small', type: 'button', onclick: () => go('preview') }, 'Náhľad'),
    h('button', { class: 'btn ghost small', type: 'button', id: 'discardBtn', onclick: discard }, 'Zahodiť koncept'),
    h('button', { class: 'btn coral', type: 'button', id: 'publishBtn', onclick: publish }, 'Zverejniť'));
  const content = h('div', { class: 'content', id: 'view' });
  fill(app, h('div', { class: 'shell' }, side, h('main', { class: 'main' }, top, content)));
  updateStatus();
}
function updateStatus(){
  const el = document.getElementById('status');
  if(!el || !S.meta) return;
  let cls = '', txt;
  if(S.saving){ cls = 'saving'; txt = 'Ukladám koncept…'; }
  else if(S.saveError){ cls = 'error'; txt = 'Koncept sa neuložil – ' + S.saveError; }
  else if(S.dirtyLocal){ cls = 'dirty'; txt = 'Neuložené zmeny…'; }
  else if(S.meta.dirty){ cls = 'dirty'; txt = 'Koncept uložený ' + fmtDate(S.meta.draftSavedAt) + ' · zmeny ešte nie sú na webe'; }
  else { txt = 'Všetko je zverejnené' + (S.meta.publishedAt ? ' (' + fmtDate(S.meta.publishedAt) + ')' : ''); }
  fill(el, h('span', { class: 'dot ' + cls }), h('span', null, txt));
  const pending = S.dirtyLocal || S.saving || S.meta.dirty;
  const pb = document.getElementById('publishBtn'), db = document.getElementById('discardBtn');
  if(pb) pb.disabled = !pending;
  if(db) db.disabled = !(S.meta.dirty || S.dirtyLocal);
}
function go(view){
  if(!VIEWS[view]) view = 'overview';
  S.view = view;
  if(location.hash !== '#' + view) history.replaceState(null, '', '#' + view);
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  render();
  window.scrollTo(0, 0);
}
function render(){
  const v = document.getElementById('view');
  if(!v){ renderShell(); return render(); }
  fill(v, );
  VIEWS[S.view](v);
}
function title(v, t, lead){ v.append(h('h1', { class: 'page-title' }, t)); if(lead) v.append(h('p', { class: 'page-lead' }, lead)); }

async function publish(){
  if(!await flush()){ toast('Koncept sa najprv musí uložiť.', true); return; }
  if(!confirm('Zverejniť koncept? Návštevníci uvidia zmeny hneď. Doterajšia verzia sa uloží do histórie.')) return;
  const r = await api('publish', { method: 'POST', body: { rev: S.meta.draftRev } });
  if(!r.ok){ toast(errText(r), true); if(r.status === 409) conflictDialog(r.meta); return; }
  S.meta = r.meta; updateStatus(); toast('Zverejnené. Zmeny sú na webe.');
  if(S.view === 'overview' || S.view === 'history' || S.view === 'shop') render();
}
async function discard(){
  if(!confirm('Zahodiť všetky nezverejnené zmeny a vrátiť sa k obsahu, ktorý je teraz na webe?')) return;
  clearTimeout(S.saveTimer); S.dirtyLocal = false;
  const r = await api('discard', { method: 'POST', body: {} });
  if(!r.ok){ toast(errText(r), true); return; }
  S.content = normalize(r.content); S.meta = r.meta; updateStatus(); render(); toast('Koncept je zahodený.');
}

/* ---------- formulárové prvky ---------- */
function counter(input, max){
  if(!max) return null;
  const c = h('div', { class: 'counter' });
  const upd = () => { const n = input.value.length; c.textContent = n + ' / ' + max; c.classList.toggle('over', n > max); };
  input.addEventListener('input', upd); upd();
  return c;
}
function control(value, opts, onInput){
  const el = opts.multiline ? h('textarea', { rows: opts.rows || 4 }) : h('input', { type: opts.type || 'text' });
  el.value = value == null ? '' : value;
  if(opts.max) el.maxLength = opts.max;
  if(opts.placeholder) el.placeholder = opts.placeholder;
  el.addEventListener('input', () => onInput(el.value));
  return el;
}
function langBox(tag, el, max){ return h('div', { class: 'lang' }, el, h('span', { class: 'tag' }, tag), counter(el, max)); }
function fieldWrap(label, where, ...kids){ return h('div', { class: 'field' }, h('div', { class: 'flabel' }, label, where ? h('span', { class: 'where' }, where) : null), kids); }

// texty zo slovníka webu (SK / EN vedľa seba)
function textPair(label, where, key, opts){
  opts = opts || {};
  return fieldWrap(label, where, h('div', { class: 'pair' },
    langBox('SK', control(textVal('sk', key), opts, v => setText('sk', key, v)), opts.max),
    langBox('EN', control(textVal('en', key), opts, v => setText('en', key, v)), opts.max)));
}
// dvojjazyčné pole objektu, napr. item.title = {sk, en}
function objPair(label, where, obj, field, opts){
  opts = opts || {};
  if(!obj[field] || typeof obj[field] !== 'object') obj[field] = { sk: '', en: '' };
  const o = obj[field];
  return fieldWrap(label, where, h('div', { class: 'pair' },
    langBox('SK', control(o.sk, opts, v => { o.sk = v; changed(); if(opts.onInput) opts.onInput(); }), opts.max),
    langBox('EN', control(o.en, opts, v => { o.en = v; changed(); if(opts.onInput) opts.onInput(); }), opts.max)));
}
function simpleField(label, where, obj, field, opts){
  opts = opts || {};
  const el = control(obj[field], opts, v => { obj[field] = v; changed(); if(opts.onInput) opts.onInput(v); });
  return fieldWrap(label, where, el, counter(el, opts.max), opts.hint ? h('div', { class: 'counter', style: 'text-align:left' }, opts.hint) : null);
}

function thumbFor(path, sq){
  const t = h('div', { class: 'thumb' + (sq ? ' sq' : '') });
  if(path){ if(isVideo(path)) t.append(h('video', { src: mediaUrl(path), muted: true, preload: 'metadata' })); else t.append(h('img', { src: mediaUrl(path), alt: '', loading: 'lazy' })); }
  return t;
}
// pole s obrázkom alebo videom: nahrať nové / vybrať z knižnice / odstrániť
function mediaField(label, where, get, set, opts){
  opts = opts || {};
  const wrap = h('div', { class: 'imgfield' });
  const fileIn = h('input', { type: 'file', accept: opts.video ? 'video/mp4,video/webm' : 'image/jpeg,image/png,image/webp,image/gif', hidden: true });
  const draw = () => {
    const p = get();
    fill(wrap, thumbFor(p, opts.square), h('div', { class: 'actions' },
      h('div', { class: 'row' },
        h('button', { class: 'btn small', type: 'button', onclick: () => fileIn.click() }, p ? 'Nahrať iný' : 'Nahrať'),
        h('button', { class: 'btn ghost small', type: 'button', onclick: () => pickMedia(opts.video ? 'video' : 'image', (path) => { set(path); changed(); draw(); if(opts.onChange) opts.onChange(); }) }, 'Z knižnice'),
        p && opts.optional ? h('button', { class: 'btn danger small', type: 'button', onclick: () => { set(''); changed(); draw(); if(opts.onChange) opts.onChange(); } }, 'Odstrániť') : null),
      p ? h('div', { class: 'path' }, p) : h('div', { class: 'path' }, opts.optional ? 'Nepovinné' : 'Zatiaľ bez súboru'),
      opts.hint ? h('div', { class: 'path' }, opts.hint) : null), fileIn);
  };
  fileIn.addEventListener('change', async () => {
    const f = fileIn.files[0]; fileIn.value = '';
    if(!f) return;
    const [path] = await uploadFiles([f], opts.keepOriginal);
    if(path){ set(path); changed(); draw(); if(opts.onChange) opts.onChange(); }
  });
  draw();
  return fieldWrap(label, where, wrap);
}

function modal(o){
  const bg = h('div', { class: 'modal-bg' });
  const close = () => { bg.remove(); document.removeEventListener('keydown', esc); if(o.onClose) o.onClose(); };
  const esc = (e) => { if(e.key === 'Escape') close(); };
  document.addEventListener('keydown', esc);
  const box = h('div', { class: 'modal' + (o.wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': o.title },
    h('div', { class: 'modal-head' }, h('h2', null, o.title), o.headExtra || null, h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Zavrieť', onclick: close }, '✕')),
    h('div', { class: 'modal-body' }, o.body),
    o.actions ? h('div', { class: 'modal-foot' }, o.actions.map(a => h('button', { class: 'btn' + (a.ghost ? ' ghost' : '') + (a.danger ? ' danger' : '') + (a.coral ? ' coral' : ''), type: 'button', disabled: a.disabled, id: a.id, onclick: () => a.run(close) }, a.label))) : null);
  bg.addEventListener('mousedown', (e) => { if(e.target === bg && !o.sticky) close(); });
  bg.append(box);
  document.body.append(bg);
  return { close, box };
}

/* ---------- knižnica médií ---------- */
async function loadMedia(force){
  if(S.media && !force) return S.media;
  const r = await api('media');
  S.media = r.ok ? r.media : [];
  return S.media;
}
function usages(path){
  const c = C(), out = [];
  const KN = { walls: 'Steny', workshops: 'Workshopy', illustrations: 'Ilustrácie', graphicDesign: 'Grafický dizajn' };
  Object.keys(KN).forEach(k => (c.site[k] || []).forEach(it => {
    const nm = KN[k] + ' › ' + ((it.title && it.title.sk) || 'bez názvu');
    if(it.image === path) out.push(nm);
    if(it.fullImage === path) out.push(nm + ' (zväčšenie)');
    if((it.extraImages || []).includes(path)) out.push(nm + ' (ďalšia fotka)');
    if(it.video === path) out.push(nm + ' (video)');
  }));
  (c.site.shop.products || []).forEach(p => {
    const nm = 'Obchod › ' + ((p.title && p.title.sk) || 'produkt');
    if(p.image === path) out.push(nm);
    if(p.mockup && JSON.stringify(p.mockup.files || {}).includes(path)) out.push(nm + ' (mockup)');
  });
  if(c.site.about && c.site.about.image === path) out.push('O nás');
  if(c.pages && c.pages.heroImage === path) out.push('Úvod › posledný projekt');
  if(c.seo && c.seo.image === path) out.push('SEO › obrázok na zdieľanie');
  (c.trash || []).forEach(t => { if(JSON.stringify(t.item).includes(path)) out.push('Kôš'); });
  return out;
}
function mediaCard(m, opts){
  const name = m.path.split('/').pop();
  const pv = h('div', { class: 'pv' });
  if(isVideo(m.path)) pv.append(h('video', { src: mediaUrl(m.path), muted: true, preload: 'metadata' }));
  else pv.style.backgroundImage = `url("${mediaUrl(m.path)}")`;
  const used = usages(m.path);
  const card = h('div', { class: 'media' + (opts.pick ? ' pick' : ''), title: used.length ? 'Použité: ' + used.join(', ') : 'Nepoužité' },
    pv, h('div', { class: 'meta' },
      h('span', { class: 'nm' }, name),
      h('span', null, fmtSize(m.size), ' · ', used.length || m.used ? h('span', { class: 'pill ok' }, 'použité') : h('span', { class: 'pill' }, 'nepoužité')),
      used.length && !opts.pick ? h('span', null, used.slice(0, 3).join(', ') + (used.length > 3 ? ' …' : '')) : null,
      !opts.pick && m.uploaded && !used.length && !m.used ? h('button', { class: 'btn danger small', type: 'button', onclick: async () => {
        if(!confirm('Natrvalo zmazať súbor ' + name + '?')) return;
        const r = await api('media_delete', { method: 'POST', body: { path: m.path } });
        if(!r.ok){ toast(errText(r), true); return; }
        await loadMedia(true); toast('Súbor je zmazaný.'); render();
      } }, 'Zmazať') : null));
  if(opts.pick) card.addEventListener('click', () => opts.pick(m.path));
  return card;
}
async function pickMedia(kind, onPick){
  const grid = h('div', { class: 'media-grid' }, h('p', { class: 'muted' }, 'Načítavam…'));
  const fileIn = h('input', { type: 'file', multiple: true, hidden: true, accept: kind === 'video' ? 'video/mp4,video/webm' : 'image/jpeg,image/png,image/webp,image/gif' });
  let m;
  const draw = async (force) => {
    const list = (await loadMedia(force)).filter(x => kind === 'video' ? isVideo(x.path) : !isVideo(x.path));
    fill(grid, ...(list.length ? list.map(x => mediaCard(x, { pick: (p) => { m.close(); onPick(p); } })) : [h('p', { class: 'muted' }, 'Knižnica je zatiaľ prázdna.')]));
  };
  fileIn.addEventListener('change', async () => { const fs = [...fileIn.files]; fileIn.value = ''; const paths = await uploadFiles(fs); if(paths.length === 1){ m.close(); onPick(paths[0]); } else { await draw(true); } });
  m = modal({ title: kind === 'video' ? 'Vybrať video' : 'Vybrať obrázok', wide: true,
    headExtra: h('button', { class: 'btn small', type: 'button', onclick: () => fileIn.click() }, 'Nahrať nový'),
    body: [fileIn, grid] });
  draw();
}

/* ======================= SEKCIE ======================= */

VIEWS.overview = async (v) => {
  title(v, 'Prehľad', 'Všetko, čo upravíš, sa priebežne ukladá ako koncept. Návštevníci ho uvidia až po stlačení Zverejniť vpravo hore.');
  const c = C();
  const n = (k) => (c.site[k] || []).filter(i => !i.hidden).length;
  const stats = h('div', { class: 'grid c4' },
    [['Steny', n('walls')], ['Workshopy', n('workshops')], ['Ilustrácie', n('illustrations')], ['Produkty', (c.site.shop.products || []).filter(p => !p.hidden).length]]
      .map(([l, x]) => h('div', { class: 'card' }, h('div', { class: 'stat-label' }, l), h('div', { class: 'stat' }, x))));
  v.append(stats);
  const menuCard = h('div', { class: 'card' }, h('h2', null, 'Menu na webe'), h('p', { class: 'sub' }, 'Načítavam…'));
  const gameCard = h('div', { class: 'card' }, h('h2', null, 'Hra'), h('p', { class: 'sub' }, 'Načítavam…'));
  const wsCard = h('div', { class: 'card' }, h('h2', null, 'Zadania workshopov'), h('p', { class: 'sub' }, 'Načítavam…'));
  const verCard = h('div', { class: 'card' }, h('h2', null, 'Koncept a zverejnenie'),
    h('p', { class: 'sub' }, S.meta.dirty || S.dirtyLocal ? 'Máš nezverejnené zmeny (posledné uloženie ' + fmtDate(S.meta.draftSavedAt) + ').' : 'Web je zhodný s konceptom.'),
    h('p', null, 'Posledné zverejnenie: ', h('b', null, fmtDate(S.meta.publishedAt))),
    h('div', { class: 'row', style: 'margin-top:12px' }, h('button', { class: 'btn ghost small', type: 'button', onclick: () => go('preview') }, 'Náhľad konceptu'), h('button', { class: 'btn ghost small', type: 'button', onclick: () => go('history') }, 'História verzií')));
  v.append(h('div', { class: 'grid c2' }, verCard, menuCard, gameCard, wsCard));
  const [mr, sr, wr] = await Promise.all([api('menu'), api('scores'), api('workshops')]);
  fill(menuCard, h('h2', null, 'Menu na webe'), menuToggle(mr.ok && mr.locked));
  const sc = sr.ok ? sr.scores : [];
  fill(gameCard, h('h2', null, 'Hra'), h('p', { class: 'sub' }, sc.length ? 'Zapísaných hier: ' + sc.length : 'Zatiaľ sa nikto nezapísal.'),
    sc.length ? h('p', null, 'Najlepší: ', h('b', null, sc[0].name), ' – ', sc[0].score, ' bodov') : null,
    h('button', { class: 'btn ghost small', type: 'button', style: 'margin-top:12px', onclick: () => go('game') }, 'Rebríček'));
  const ws = wr.ok ? wr.requests : [];
  S.counts.workshops = ws.length;
  fill(wsCard, h('h2', null, 'Zadania workshopov'), h('p', { class: 'sub' }, ws.length ? 'Spolu ' + ws.length + ', posledné ' + fmtDate(ws[0].at) : 'Zatiaľ žiadne zadanie.'),
    ws.length ? h('p', null, h('b', null, ws[0].name), ' – ', (ws[0].topics || []).join(', ') || ws[0].topicText || '') : null,
    h('button', { class: 'btn ghost small', type: 'button', style: 'margin-top:12px', onclick: () => go('requests') }, 'Všetky zadania'));
};

function menuToggle(locked){
  const wrap = h('div');
  const draw = (on) => {
    fill(wrap, 
      h('p', { class: 'sub' }, on ? 'Menu je vypnuté: na webe ide len hra, položky menu, logo a košík sa nedajú kliknúť. Vzhľad ostáva rovnaký.' : 'Menu je zapnuté, návštevníci prechádzajú celým webom.'),
      h('button', { class: 'btn' + (on ? ' coral' : ' ghost'), type: 'button', onclick: async (e) => {
        e.target.disabled = true;
        const r = await api('menu', { method: 'POST', body: { locked: !on } });
        if(!r.ok){ toast(errText(r), true); e.target.disabled = false; return; }
        toast(r.locked ? 'Menu je vypnuté – platí hneď pre všetkých.' : 'Menu je znova zapnuté.');
        draw(r.locked);
      } }, on ? 'Zapnúť menu' : 'Vypnúť menu'),
      h('p', { class: 'muted', style: 'font-size:13px;margin-top:8px' }, 'Táto zmena platí hneď, bez zverejňovania.'));
  };
  draw(locked);
  return wrap;
}

/* ---------- Stránky a texty ---------- */
VIEWS.pages = (v) => {
  title(v, 'Stránky a texty', 'Texty sú vždy po slovensky aj po anglicky vedľa seba. Písmo, farby a rozloženie sa tu nemenia.');
  const c = C();
  v.append(h('div', { class: 'card' }, h('h2', null, 'Úvod'), h('p', { class: 'sub' }, 'Pod hrou na úvodnej stránke.'),
    mediaField('Fotka posledného projektu', 'pod hrou', () => c.pages.heroImage, (p) => { c.pages.heroImage = p; }),
    textPair('Popis pod fotkou', 'malý text pod fotkou', 'hero_caption', { max: 80 })));
  v.append(h('div', { class: 'card' }, h('h2', null, 'Workshopy'), h('p', { class: 'sub' }, 'Úvod sekcie nad formulárom a kartami workshopov.'),
    textPair('1. odsek', null, 'workshop_intro_1', { multiline: true, max: 600 }),
    textPair('2. odsek', null, 'workshop_intro_2', { multiline: true, max: 600 }),
    textPair('3. odsek', 'história workshopov', 'workshop_intro_3', { multiline: true, rows: 7, max: 1200 }),
    textPair('Tlačidlo formulára', null, 'wf_cta', { max: 40 })));
  v.append(h('div', { class: 'card' }, h('h2', null, 'Obchod'), h('p', { class: 'sub' }, 'Produkty upravíš v sekcii Obchod.'),
    textPair('Úvodný text obchodu', 'pod nadpisom Obchod', 'shop_intro', { multiline: true, max: 400 }),
    textPair('Tlačidlo pri produkte', null, 'add_to_cart', { max: 30 }),
    textPair('Tlačidlo v košíku', null, 'checkout_btn', { max: 30 }),
    textPair('Poznámka v košíku', null, 'checkout_note', { multiline: true, max: 300 })));
  // O nás
  const about = c.site.about;
  const paras = h('div');
  const drawParas = () => {
    fill(paras, ...about.paragraphs.map((p, i) => h('div', { class: 'card', style: 'background:#fbfafd' },
      h('div', { class: 'row', style: 'margin-bottom:8px' }, h('b', null, (i + 1) + '. odsek'), h('span', { class: 'spacer' }),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Posunúť vyššie', disabled: i === 0, onclick: () => { about.paragraphs.splice(i - 1, 0, about.paragraphs.splice(i, 1)[0]); changed(); drawParas(); } }, '↑'),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Posunúť nižšie', disabled: i === about.paragraphs.length - 1, onclick: () => { about.paragraphs.splice(i + 1, 0, about.paragraphs.splice(i, 1)[0]); changed(); drawParas(); } }, '↓'),
        h('button', { class: 'btn danger small', type: 'button', onclick: () => { if(!confirm('Odstrániť tento odsek?')) return; about.paragraphs.splice(i, 1); changed(); drawParas(); } }, 'Odstrániť')),
      h('div', { class: 'pair' },
        langBox('SK', control(p.sk, { multiline: true, max: 800 }, val => { p.sk = val; changed(); }), 800),
        langBox('EN', control(p.en, { multiline: true, max: 800 }, val => { p.en = val; changed(); }), 800)))),
      h('button', { class: 'btn ghost small', type: 'button', onclick: () => { about.paragraphs.push({ sk: '', en: '' }); changed(); drawParas(); } }, '+ Pridať odsek'));
  };
  drawParas();
  v.append(h('div', { class: 'card' }, h('h2', null, 'O nás'),
    mediaField('Fotka', 'vľavo od textu', () => about.image, (p) => { about.image = p; }), paras));
  v.append(h('div', { class: 'card' }, h('h2', null, 'Prázdne sekcie'),
    textPair('Text v prázdnej galérii', 'napr. Ilustrácie, kým v nich nič nie je', 'empty_gallery_note', { max: 120 })));
  v.append(h('p', { class: 'note' }, 'Texty pravidiel a súťaže v hre sú zatiaľ súčasťou hry a menia sa v kóde, aby sa hra nespomalila ani nerozbila.'));
};

/* ---------- Projekty ---------- */
const KINDS = [
  { id: 'walls', label: 'Steny', prefix: 'wall', video: true, full: true },
  { id: 'workshops', label: 'Workshopy', prefix: 'ws', hint: 'Názvy workshopov sa automaticky objavia aj ako témy vo formulári „Naklikaj si workshop“.' },
  { id: 'illustrations', label: 'Ilustrácie', prefix: 'illu' },
  { id: 'graphicDesign', label: 'Grafický dizajn', prefix: 'design' },
];
VIEWS.projects = (v) => {
  title(v, 'Projekty', 'Karty v galériách. Poradie zmeníš ťahaním alebo šípkami. Skrytý projekt na webe nevidno, zmazaný ide na 30 dní do koša.');
  const c = C();
  const kind = KINDS.find(k => k.id === S.projKind) || KINDS[0];
  v.append(h('div', { class: 'tabs' }, KINDS.map(k => h('button', { class: 'tab' + (k.id === kind.id ? ' on' : ''), type: 'button', onclick: () => { S.projKind = k.id; render(); } },
    k.label, h('span', { class: 'count' }, (c.site[k.id] || []).length)))));
  const list = c.site[kind.id];
  if(kind.hint) v.append(h('p', { class: 'note' }, kind.hint));
  v.append(h('div', { class: 'row', style: 'margin-bottom:14px' }, h('button', { class: 'btn', type: 'button', onclick: () => {
    const it = { id: uid(kind.prefix), title: { sk: '', en: '' }, desc: { sk: '', en: '' }, image: '', extraImages: [] };
    if(kind.video) it.video = '';
    list.unshift(it); changed(); render(); editItem(kind, it);
  } }, '+ Pridať projekt')));
  const items = h('div', { class: 'items' });
  let dragIdx = null;
  list.forEach((it, i) => {
    const row = h('div', { class: 'item' + (it.hidden ? ' is-hidden' : ''), draggable: 'true' },
      h('span', { class: 'handle', title: 'Potiahni pre zmenu poradia' }, '⠿'),
      thumbFor(it.image),
      h('div', null,
        h('div', { class: 't' }, (it.title && it.title.sk) || 'Bez názvu'),
        h('div', { class: 'd' }, (it.desc && it.desc.sk) || ''),
        h('div', { style: 'margin-top:6px' },
          it.hidden ? h('span', { class: 'pill hidden' }, 'skryté') : null,
          !it.image ? h('span', { class: 'pill coral' }, 'bez fotky – na webe sa nezobrazí') : null,
          it.video ? h('span', { class: 'pill' }, 'video') : null,
          (it.extraImages || []).length ? h('span', { class: 'pill' }, '+' + it.extraImages.length + ' fotky') : null)),
      h('div', { class: 'tools' },
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Vyššie', disabled: i === 0, onclick: () => { list.splice(i - 1, 0, list.splice(i, 1)[0]); changed(); render(); } }, '↑'),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Nižšie', disabled: i === list.length - 1, onclick: () => { list.splice(i + 1, 0, list.splice(i, 1)[0]); changed(); render(); } }, '↓'),
        h('button', { class: 'btn small', type: 'button', onclick: () => editItem(kind, it) }, 'Upraviť'),
        h('button', { class: 'btn ghost small', type: 'button', onclick: () => { it.hidden = !it.hidden; if(!it.hidden) delete it.hidden; changed(); render(); } }, it.hidden ? 'Zobraziť' : 'Skryť'),
        h('button', { class: 'btn danger small', type: 'button', onclick: () => {
          if(!confirm('Presunúť „' + ((it.title && it.title.sk) || 'projekt') + '“ do koša? Obnoviť ho môžeš 30 dní.')) return;
          list.splice(i, 1); c.trash.unshift({ kind: kind.id, index: i, item: it, deletedAt: new Date().toISOString() }); changed(); render();
        } }, 'Zmazať')));
    row.addEventListener('dragstart', (e) => { dragIdx = i; row.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); });
    row.addEventListener('dragend', () => { row.classList.remove('dragging'); items.querySelectorAll('.drop-before').forEach(x => x.classList.remove('drop-before')); });
    row.addEventListener('dragover', (e) => { e.preventDefault(); items.querySelectorAll('.drop-before').forEach(x => x.classList.remove('drop-before')); row.classList.add('drop-before'); });
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      if(dragIdx == null || dragIdx === i) return;
      const moved = list.splice(dragIdx, 1)[0];
      list.splice(dragIdx < i ? i - 1 : i, 0, moved);
      dragIdx = null; changed(); render();
    });
    items.append(row);
  });
  if(!list.length) items.append(h('p', { class: 'muted' }, 'V tejto galérii zatiaľ nič nie je. Na webe sa zobrazí text „Čoskoro pridáme ďalší obsah.“'));
  v.append(items);
  // kôš
  const trash = c.trash.filter(t => KINDS.some(k => k.id === t.kind));
  if(trash.length){
    v.append(h('div', { class: 'card', style: 'margin-top:28px' }, h('h2', null, 'Kôš'), h('p', { class: 'sub' }, 'Zmazané projekty sa po 30 dňoch odstránia natrvalo.'),
      h('div', { class: 'items' }, trash.map(t => h('div', { class: 'item' },
        h('span'), thumbFor(t.item.image),
        h('div', null, h('div', { class: 't' }, (t.item.title && t.item.title.sk) || 'Bez názvu'), h('div', { class: 'd' }, (KINDS.find(k => k.id === t.kind) || {}).label + ' · zmazané ' + fmtDate(t.deletedAt))),
        h('div', { class: 'tools' },
          h('button', { class: 'btn small', type: 'button', onclick: () => {
            const arr = c.site[t.kind]; arr.splice(Math.min(t.index || 0, arr.length), 0, t.item);
            c.trash.splice(c.trash.indexOf(t), 1); changed(); S.projKind = t.kind; render(); toast('Projekt je obnovený.');
          } }, 'Obnoviť'),
          h('button', { class: 'btn danger small', type: 'button', onclick: () => { if(!confirm('Zmazať natrvalo? Toto sa nedá vrátiť.')) return; c.trash.splice(c.trash.indexOf(t), 1); changed(); render(); } }, 'Zmazať natrvalo')))))));
  }
};

function editItem(kind, it){
  if(!it.title) it.title = { sk: '', en: '' };
  if(!it.desc) it.desc = { sk: '', en: '' };
  if(!Array.isArray(it.extraImages)) it.extraImages = [];
  const extras = h('div', { class: 'extras' });
  const drawExtras = () => {
    fill(extras, ...it.extraImages.map((p, i) => h('div', { class: 'extra' }, thumbFor(p),
      h('button', { class: 'x', type: 'button', 'aria-label': 'Odstrániť fotku', onclick: () => { it.extraImages.splice(i, 1); changed(); drawExtras(); } }, '×'))),
      h('button', { class: 'btn ghost small', type: 'button', onclick: () => pickMedia('image', (p) => { it.extraImages.push(p); changed(); drawExtras(); }) }, '+ Pridať fotku'));
  };
  drawExtras();
  const body = [
    objPair('Názov', 'na karte, veľkým písmom', it, 'title', { max: 60 }),
    objPair('Popis', 'vo fialovom paneli na karte', it, 'desc', { multiline: true, max: 400 }),
    mediaField('Hlavná fotka', 'na karte a prvá v galérii', () => it.image, (p) => { it.image = p; }),
    kind.full ? mediaField('Fotka na zväčšenie', 'nepovinné – vo väčšom rozlíšení', () => it.fullImage || '', (p) => { if(p) it.fullImage = p; else delete it.fullImage; }, { optional: true }) : null,
    fieldWrap('Ďalšie fotky', 'v galérii po kliknutí na kartu', extras),
    kind.video ? mediaField('Video', 'nepovinné – prehrá sa v galérii', () => it.video || '', (p) => { it.video = p; }, { video: true, optional: true }) : null,
  ];
  modal({ title: kind.label + ' – úprava projektu', body, actions: [{ label: 'Hotovo', run: (close) => close() }], onClose: () => { if(S.view === 'projects') render(); } });
}

/* ---------- Obchod ---------- */
function mockState(p){
  if(p.mockup && p.mockup.confirmed){
    if(p.mockup.source && p.mockup.source !== p.image) return { cls: 'coral', txt: 'Mockup je z predchádzajúceho obrázka – vytvor nový' };
    return { cls: 'ok', txt: 'Mockup potvrdený: ' + StullersMockup.label(p.mockup) };
  }
  if(p.mockupChoice) return { cls: 'hidden', txt: 'Vybraný variant čaká na potvrdenie' };
  return { cls: '', txt: 'Bez mockupu' };
}
VIEWS.shop = (v) => {
  title(v, 'Obchod', 'Produkty v e-shope. Ilustrácia sa ukladá ako originál a nikdy sa neupravuje. Mockup tlače vytvoríš na požiadanie a na web ide až po potvrdení a zverejnení.');
  const c = C(), list = c.site.shop.products;
  v.append(h('div', { class: 'row', style: 'margin-bottom:14px' }, h('button', { class: 'btn', type: 'button', onclick: () => {
    const p = { id: uid('product'), title: { sk: '', en: '' }, desc: { sk: '', en: '' }, badge: { sk: '', en: '' }, note: { sk: '', en: '' }, price: '', image: '', hidden: true };
    list.push(p); changed(); render(); editProduct(p);
  } }, '+ Pridať produkt')));
  if(list.length > 1) v.append(h('p', { class: 'note' }, 'Viac produktov sa na webe zobrazí pod sebou v rovnakom rozložení ako dnes. Pozri si to v Náhľade, rozloženie ešte schvaľujeme.'));
  v.append(h('div', { class: 'items' }, list.map((p, i) => {
    const ms = mockState(p);
    return h('div', { class: 'item' + (p.hidden ? ' is-hidden' : '') },
      h('span'), thumbFor(p.image, true),
      h('div', null,
        h('div', { class: 't' }, (p.title && p.title.sk) || 'Nový produkt'),
        h('div', { class: 'd' }, (p.price || 'bez ceny') + (p.badge && p.badge.sk ? ' · ' + p.badge.sk : '')),
        h('div', { style: 'margin-top:6px' }, p.hidden ? h('span', { class: 'pill hidden' }, 'skryté') : null, !p.image ? h('span', { class: 'pill coral' }, 'bez ilustrácie') : null, h('span', { class: 'pill ' + ms.cls }, ms.txt))),
      h('div', { class: 'tools' },
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Vyššie', disabled: i === 0, onclick: () => { list.splice(i - 1, 0, list.splice(i, 1)[0]); changed(); render(); } }, '↑'),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Nižšie', disabled: i === list.length - 1, onclick: () => { list.splice(i + 1, 0, list.splice(i, 1)[0]); changed(); render(); } }, '↓'),
        h('button', { class: 'btn small', type: 'button', onclick: () => editProduct(p) }, 'Upraviť'),
        h('button', { class: 'btn ghost small', type: 'button', disabled: !p.image, onclick: () => openMockups(p) }, 'Mockupy'),
        h('button', { class: 'btn ghost small', type: 'button', onclick: () => { p.hidden = !p.hidden; if(!p.hidden) delete p.hidden; changed(); render(); } }, p.hidden ? 'Zobraziť' : 'Skryť'),
        h('button', { class: 'btn danger small', type: 'button', onclick: () => {
          if(!confirm('Presunúť produkt do koša?')) return;
          list.splice(i, 1); c.trash.unshift({ kind: 'products', index: i, item: p, deletedAt: new Date().toISOString() }); changed(); render();
        } }, 'Zmazať')));
  })));
  const trash = c.trash.filter(t => t.kind === 'products');
  if(trash.length) v.append(h('div', { class: 'card', style: 'margin-top:28px' }, h('h2', null, 'Kôš'),
    trash.map(t => h('div', { class: 'row', style: 'margin:8px 0' }, h('b', null, (t.item.title && t.item.title.sk) || 'Produkt'), h('span', { class: 'muted' }, 'zmazané ' + fmtDate(t.deletedAt)), h('span', { class: 'spacer' }),
      h('button', { class: 'btn small', type: 'button', onclick: () => { list.splice(Math.min(t.index || 0, list.length), 0, t.item); c.trash.splice(c.trash.indexOf(t), 1); changed(); render(); } }, 'Obnoviť'),
      h('button', { class: 'btn danger small', type: 'button', onclick: () => { if(!confirm('Zmazať natrvalo?')) return; c.trash.splice(c.trash.indexOf(t), 1); changed(); render(); } }, 'Zmazať natrvalo')))));
};

function editProduct(p){
  ['title', 'desc', 'badge', 'note'].forEach(k => { if(!p[k] || typeof p[k] !== 'object') p[k] = { sk: '', en: '' }; });
  const status = h('div');
  const drawStatus = () => {
    const ms = mockState(p);
    fill(status, h('span', { class: 'pill ' + ms.cls }, ms.txt), ' ',
      h('button', { class: 'btn ghost small', type: 'button', disabled: !p.image, onclick: () => openMockups(p, drawStatus) }, 'Mockupy produktu'));
  };
  drawStatus();
  modal({ title: 'Produkt', body: [
    objPair('Názov', null, p, 'title', { max: 60 }),
    objPair('Štítok', 'farebný štítok nad názvom, nepovinné', p, 'badge', { max: 30 }),
    objPair('Popis', null, p, 'desc', { multiline: true, max: 500 }),
    simpleField('Cena', 'napr. 10 €', p, 'price', { max: 20 }),
    objPair('Poznámka', 'malý text pod tlačidlom (formát, papier, doručenie)', p, 'note', { max: 200 }),
    mediaField('Ilustrácia (originál)', 'ukladá sa bez úprav', () => p.image, (x) => { p.image = x; }, { keepOriginal: true, square: true, onChange: drawStatus, hint: 'Ak chceš krémový papier aj pod kresbou, nahraj PNG s priehľadným pozadím.' }),
    fieldWrap('Mockup tlače', 'vytvára sa len na požiadanie', status),
  ], actions: [{ label: 'Hotovo', run: (close) => close() }], onClose: () => { if(S.view === 'shop') render(); } });
}

/* ---------- Mockupy produktu (bod 14) ---------- */
function openMockups(p, onDone){
  const M = window.StullersMockup;
  const st = { src: null, shadow: (p.mockupChoice && p.mockupChoice.shadow) || 'soft', size: (p.mockupChoice && p.mockupChoice.size) || 'large', combos: [], cache: {} };
  const same = (a, b) => a && b && a.tone === b.tone && a.shadow === b.shadow && a.size === b.size;
  const pairsEl = h('div', { class: 'mk-pairs' });
  const info = h('div');
  const prog = h('div', { class: 'progress', hidden: true }, h('div'));
  let m;

  const seg = (opts, cur, set) => h('div', { class: 'seg' }, Object.keys(opts).map(k => h('button', { type: 'button', class: k === cur ? 'on' : '', onclick: () => { set(k); drawControls(); } }, opts[k].sk.replace(' tieň', '').replace(' print', ''))));
  const controls = h('div', { class: 'mk-controls' });
  function drawControls(){
    fill(controls, 
      h('div', null, h('div', { class: 'flabel' }, 'Tieň'), seg(M.SHADOWS, st.shadow, k => st.shadow = k)),
      h('div', null, h('div', { class: 'flabel' }, 'Veľkosť printu'), seg(M.SIZES, st.size, k => st.size = k)),
      h('button', { class: 'btn', type: 'button', onclick: () => generate([{ shadow: st.shadow, size: st.size }]) }, 'Vytvoriť mockupy'),
      st.combos.length ? h('button', { class: 'btn ghost', type: 'button', onclick: () => {
        const all = []; Object.keys(M.SHADOWS).forEach(s => Object.keys(M.SIZES).forEach(z => all.push({ shadow: s, size: z })));
        generate(all);
      } }, 'Vytvoriť ďalšie varianty') : null);
  }
  function variantCanvas(opt){
    const key = opt.tone + opt.shadow + opt.size;
    if(!st.cache[key]) st.cache[key] = M.preview(st.src, opt, 900);
    return st.cache[key];
  }
  function generate(list){
    list.forEach(c => { if(!st.combos.some(x => x.shadow === c.shadow && x.size === c.size)) st.combos.unshift(c); });
    drawPairs(); drawControls();
  }
  function drawPairs(){
    fill(pairsEl, ...st.combos.map(c => h('div', null,
      h('div', { class: 'mk-pair-title' }, M.SHADOWS[c.shadow].sk + ' · ' + M.SIZES[c.size].sk),
      h('div', { class: 'mk-pair' }, ['A', 'B'].map(tone => {
        const opt = { tone, shadow: c.shadow, size: c.size };
        const sel = same(p.mockupChoice, opt);
        const conf = p.mockup && p.mockup.confirmed && same(p.mockup, opt) && p.mockup.source === p.image;
        const cv = variantCanvas(opt);
        const img = h('img', { src: cv.toDataURL('image/jpeg', 0.9), alt: M.label(opt), onclick: () => zoom(opt) });
        return h('div', { class: 'mk-var' + (sel ? ' sel' : '') + (conf ? ' conf' : '') }, img,
          h('div', { class: 'bar' }, h('span', { class: 'lbl' }, M.TONES[tone].sk),
            conf ? h('span', { class: 'badge-conf' }, 'Potvrdený') : null,
            sel ? h('span', { class: 'badge-sel' }, 'Vybraný') : null,
            h('button', { class: 'btn ghost small', type: 'button', onclick: () => zoom(opt) }, 'Zväčšiť'),
            sel ? null : h('button', { class: 'btn small', type: 'button', onclick: () => { p.mockupChoice = opt; changed(); drawPairs(); updateConfirm(); } }, 'Vybrať')));
      })))));
  }
  function zoom(opt){
    const cv = M.preview(st.src, opt, 1600);
    const url = cv.toDataURL('image/jpeg', 0.92);
    const stage = h('div', { class: 'zoom-stage' }, h('div', { class: 'zoom-device' }, h('div', { class: 'zoom-photo' }, h('img', { src: url, alt: '' }))));
    const sw = h('div', { class: 'seg' },
      h('button', { type: 'button', class: 'on', onclick: (e) => { stage.classList.remove('mobile'); sw.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === e.target)); } }, 'Počítač'),
      h('button', { type: 'button', onclick: (e) => { stage.classList.add('mobile'); sw.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === e.target)); } }, 'Mobil'));
    modal({ title: M.label(opt), wide: true, headExtra: sw, body: [
      h('p', { class: 'muted', style: 'margin-bottom:10px' }, 'Takto bude mockup vyzerať po kliknutí na produkt v e-shope (na zelenom pozadí webu).'),
      stage, h('div', { class: 'zoom-full' }, h('img', { src: url, alt: M.label(opt) }))],
      actions: [{ label: 'Zavrieť', ghost: true, run: (close) => close() },
        { label: same(p.mockupChoice, opt) ? 'Vybraný' : 'Vybrať tento variant', disabled: same(p.mockupChoice, opt), run: (close) => { p.mockupChoice = opt; changed(); drawPairs(); updateConfirm(); close(); } }] });
  }
  function updateConfirm(){
    const b = m && m.box.querySelector('#mkConfirm');
    if(b) b.disabled = !p.mockupChoice;
  }
  async function confirmChoice(){
    const opt = p.mockupChoice;
    if(!opt){ toast('Najprv vyber variant.', true); return; }
    if(!confirm('Potvrdiť variant „' + M.label(opt) + '“ pre e-shop? Uloží sa do konceptu, na web pôjde až po zverejnení.')) return;
    const btn = m.box.querySelector('#mkConfirm'); btn.disabled = true;
    prog.hidden = false;
    const bar = prog.firstChild;
    try{
      const files = await M.finals(st.src, opt);
      const base = 'mockup-' + (((p.title && p.title.sk) || 'produkt').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'produkt') + '-' + opt.tone.toLowerCase();
      const out = { jpg: {}, webp: {} };
      for(let i = 0; i < files.length; i++){
        const f = files[i];
        const r = await upload(f.blob, base + '-' + f.size + '.' + f.format, (x) => { bar.style.width = Math.round(((i + x) / files.length) * 100) + '%'; });
        if(!r.ok) throw new Error(errText(r));
        out[f.format][f.size] = r.path;
      }
      if(!Object.keys(out.webp).length) delete out.webp;
      p.mockup = { confirmed: true, tone: opt.tone, shadow: opt.shadow, size: opt.size, template: M.TEMPLATE, source: p.image, files: out, confirmedAt: new Date().toISOString() };
      changed(); S.media = null;
      bar.style.width = '100%';
      toast('Mockup je potvrdený a uložený v koncepte. Na webe sa objaví po zverejnení.');
      drawPairs();
    } catch(e){ toast('Mockup sa nepodarilo uložiť: ' + e.message, true); }
    btn.disabled = false; setTimeout(() => { prog.hidden = true; bar.style.width = '0'; }, 800);
    if(onDone) onDone();
  }

  const origWrap = h('div', { class: 'mk-orig' }, h('img', { src: mediaUrl(p.image), alt: 'Originál' }));
  drawControls();
  m = modal({ title: 'Mockupy produktu', wide: true, sticky: true, onClose: () => { if(onDone) onDone(); if(S.view === 'shop') render(); }, body: [
    h('div', { class: 'mk-top' }, origWrap, h('div', null,
      h('h2', { style: 'font-family:var(--head);font-size:26px;text-transform:uppercase;line-height:1' }, (p.title && p.title.sk) || 'Produkt'),
      h('p', { class: 'muted', style: 'margin:4px 0 6px' }, (p.price || '') + ' · originál: ' + (p.image || '').split('/').pop()),
      h('p', { class: 'note' }, 'Každý mockup má rovnakú čistú šablónu: biele pozadie, rovný papier formátu A spredu, bez naklonenia, rámu a dekorácií. Odtieň papiera vidíš vždy v dvojici A a B. Tieň a veľkosť printu sú samostatné voľby.'),
      info, controls)),
    pairsEl, prog],
    actions: [
      { label: 'Zavrieť', ghost: true, run: (close) => close() },
      p.mockup && p.mockup.confirmed ? { label: 'Odstrániť mockup z produktu', danger: true, run: (close) => { if(!confirm('Odstrániť potvrdený mockup? Produkt bude na webe len s ilustráciou.')) return; delete p.mockup; changed(); close(); } } : null,
      { label: 'Potvrdiť pre e-shop', coral: true, id: 'mkConfirm', disabled: !p.mockupChoice, run: confirmChoice },
    ].filter(Boolean) });
  fill(pairsEl, h('p', { class: 'muted' }, 'Načítavam originál…'));
  M.load(mediaUrl(p.image)).then(src => {
    st.src = src;
    fill(pairsEl, h('p', { class: 'muted' }, 'Zatiaľ nič nie je vygenerované. Zvoľ tieň a veľkosť a stlač „Vytvoriť mockupy“.'));
    const msgs = [];
    if(src.info.transparent) msgs.push(h('p', { class: 'note' }, 'Originál má priehľadné miesta – ukáže sa v nich odtieň papiera. Kresba sa nemení.'));
    else if(src.info.opaqueWhiteBg) msgs.push(h('p', { class: 'note warn' }, 'Originál má nepriehľadné biele pozadie, preto pri krémovom variante B ostane plocha obrázka biela a krémový bude len okraj papiera. Ak chceš krémový papier aj pod kresbou, nahraj PNG s priehľadným pozadím.'));
    if(src.info.border > 0.02) msgs.push(h('p', { class: 'note' }, 'Originál má vlastný prázdny okraj (asi ' + Math.round(src.info.border * 100) + ' %), okraj papiera sa o neho zmenší, aby nevznikol dvojitý.'));
    fill(info, ...msgs);
    if(p.mockupChoice){ st.combos = [{ shadow: p.mockupChoice.shadow, size: p.mockupChoice.size }]; drawPairs(); drawControls(); }
  }).catch(() => { fill(pairsEl, h('p', { class: 'note warn' }, 'Originál sa nepodarilo načítať.')); });
}

/* ---------- Médiá ---------- */
VIEWS.media = async (v) => {
  title(v, 'Médiá', 'Všetky fotky a videá webu. Zmazať sa dá len nahratý súbor, ktorý sa nikde nepoužíva.');
  const fileIn = h('input', { type: 'file', multiple: true, hidden: true, accept: 'image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm' });
  fileIn.addEventListener('change', async () => { const fs = [...fileIn.files]; fileIn.value = ''; await uploadFiles(fs); await loadMedia(true); render(); });
  let filter = S.mediaFilter || 'all', q = '';
  const grid = h('div', { class: 'media-grid' }, h('p', { class: 'muted' }, 'Načítavam…'));
  const tabs = h('div', { class: 'tabs' });
  const search = h('input', { type: 'text', placeholder: 'Hľadať podľa názvu', style: 'max-width:260px' });
  search.addEventListener('input', () => { q = search.value.toLowerCase(); draw(); });
  v.append(h('div', { class: 'row', style: 'margin-bottom:14px' }, h('button', { class: 'btn', type: 'button', onclick: () => fileIn.click() }, 'Nahrať súbory'), search, fileIn), tabs, grid);
  const list = await loadMedia();
  function draw(){
    const F = { all: 'Všetko', image: 'Fotky', video: 'Videá', unused: 'Nepoužité' };
    const passK = (k, m) => (k === 'all') || (k === 'image' && !isVideo(m.path)) || (k === 'video' && isVideo(m.path)) || (k === 'unused' && !m.used && !usages(m.path).length);
    fill(tabs, ...Object.keys(F).map(k => h('button', { class: 'tab' + (k === filter ? ' on' : ''), type: 'button', onclick: () => { filter = S.mediaFilter = k; draw(); } }, F[k], h('span', { class: 'count' }, list.filter(m => passK(k, m)).length))));
    const shown = list.filter(m => passK(filter, m)).filter(m => !q || m.path.toLowerCase().includes(q));
    fill(grid, ...(shown.length ? shown.map(m => mediaCard(m, {})) : [h('p', { class: 'muted' }, 'Nič tu nie je.')]));
  }
  draw();
};

/* ---------- Globálne prvky ---------- */
VIEWS.globals = (v) => {
  title(v, 'Globálne prvky', 'Veci, ktoré sú na webe na viacerých miestach.');
  const g = C().globals;
  v.append(h('div', { class: 'card' }, h('h2', null, 'Menu'), h('p', { class: 'sub' }, 'Názvy položiek v hlavičke a nadpisy sekcií.'),
    [['nav_walls', 'Steny'], ['nav_workshops', 'Workshopy'], ['nav_shop', 'Obchod'], ['nav_illustrations', 'Ilustrácie'], ['nav_graphic_design', 'Grafický dizajn'], ['nav_contact', 'Kontakt'], ['nav_about', 'O nás']]
      .map(([k, l]) => textPair(l, null, k, { max: 24 }))));
  const emailCheck = (val) => !val || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val);
  const emailField = (label, where, key) => {
    const f = simpleField(label, where, g, key, { type: 'email', max: 120, onInput: (val) => warn.hidden = emailCheck(val) });
    const warn = h('div', { class: 'counter over', style: 'text-align:left', hidden: emailCheck(g[key]) }, 'Toto nevyzerá ako e-mailová adresa.');
    f.append(warn); return f;
  };
  v.append(h('div', { class: 'card' }, h('h2', null, 'E-maily'), h('p', { class: 'sub' }, 'Kam chodia objednávky, zadania workshopov a výsledky súťaže.'),
    emailField('Objednávky z obchodu', 'otvorí sa zákazníkovi v pošte', 'emailOrders'),
    emailField('Zadania workshopov', 'posiela server automaticky', 'emailWorkshops'),
    emailField('Súťaž v hre', 'výsledok hráča', 'emailGame'),
    h('p', { class: 'note' }, 'Zadania workshopov odosiela server. Ak by nechodili, vo Websupporte over, že schránka existuje, a nastav SPF/DKIM pre doménu.')));
  v.append(h('div', { class: 'card' }, h('h2', null, 'Instagram'),
    simpleField('Adresa profilu', 'odkazy na webe a v pätičke', g, 'instagram', { type: 'url', max: 200 })));
  const links = h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!g.footerLinks, onchange: (e) => { g.footerLinks = e.target.checked; changed(); } }), 'Zapnúť odkazy v pätičke (klik otvorí e-mail alebo telefón)');
  v.append(h('div', { class: 'card' }, h('h2', null, 'Pätička a Kontakt'), h('p', { class: 'sub' }, 'Položka Kontakt v menu posunie stránku na pätičku. Kým tu nič nevyplníš, ukazuje sa zástupný e-mail a telefón.'),
    h('div', { class: 'grid c2' },
      simpleField('E-mail v pätičke', null, g, 'footerEmail', { type: 'email', max: 120, placeholder: 'info@stullerscreative.com' }),
      simpleField('Telefón v pätičke', null, g, 'footerPhone', { type: 'tel', max: 30, placeholder: '+421 900 000 000' })),
    links));
};

/* ---------- SEO ---------- */
VIEWS.seo = (v) => {
  title(v, 'SEO', 'Ako sa web zobrazí vo vyhľadávači a pri zdieľaní odkazu. Web má jednu adresu, preto vyhľadávače čítajú slovenský titulok a popis.');
  const seo = C().seo; if(!seo.sk) seo.sk = {};
  const serp = h('div', { class: 'serp' });
  const drawSerp = () => fill(serp, h('div', { class: 'u' }, 'stullerscreative.com'), h('div', { class: 'ti' }, seo.sk.title || 'Štullers'), h('div', { class: 'ds' }, seo.sk.desc || 'Popis zatiaľ chýba – vyhľadávač si vyberie text zo stránky sám.'));
  drawSerp();
  v.append(h('div', { class: 'card' },
    simpleField('Titulok', 'ideálne do 60 znakov', seo.sk, 'title', { max: 70, onInput: drawSerp }),
    simpleField('Popis', 'ideálne 120 – 160 znakov', seo.sk, 'desc', { multiline: true, rows: 3, max: 170, onInput: drawSerp }),
    fieldWrap('Náhľad vo vyhľadávači', null, serp)));
  v.append(h('div', { class: 'card' }, h('h2', null, 'Obrázok pri zdieľaní'), h('p', { class: 'sub' }, 'Facebook, Messenger, WhatsApp… Ideálne 1 200 × 630 px.'),
    mediaField('Obrázok', null, () => seo.image || '', (p) => { seo.image = p; }, { optional: true })));
};

/* ---------- Hra a menu ---------- */
VIEWS.game = async (v) => {
  title(v, 'Hra a menu', 'Rebríček hráčov zo súťaže a vypnutie menu, keď má byť na webe len hra.');
  const mc = h('div', { class: 'card' }, h('h2', null, 'Menu na webe'), h('p', { class: 'sub' }, 'Načítavam…'));
  const lc = h('div', { class: 'card' }, h('h2', null, 'Rebríček'), h('p', { class: 'sub' }, 'Načítavam…'));
  v.append(mc, lc);
  const [mr, sr] = await Promise.all([api('menu'), api('scores')]);
  fill(mc, h('h2', null, 'Menu na webe'), menuToggle(mr.ok && mr.locked));
  const all = sr.ok ? sr.scores : [];
  let mode = 'best';
  const tbl = h('div');
  const draw = () => {
    let rows = all;
    if(mode === 'best'){
      const best = {};
      all.forEach(r => { const k = (r.email || r.name || '').toLowerCase(); const b = best[k]; if(!b) best[k] = Object.assign({ games: 1 }, r); else { b.games++; if(r.score > b.score) Object.assign(b, r, { games: b.games }); } });
      rows = Object.values(best).sort((a, b) => b.score - a.score || String(a.at).localeCompare(String(b.at)));
    }
    fill(tbl, rows.length ? h('div', { class: 'tbl-wrap' }, h('table', null,
      h('thead', null, h('tr', null, ['#', 'Meno', 'Instagram', 'E-mail', 'Body', 'Kolá', mode === 'best' ? 'Hier' : null, 'Dátum'].filter(Boolean).map(x => h('th', null, x)))),
      h('tbody', null, rows.map((r, i) => h('tr', null, h('td', { class: 'num' }, i + 1), h('td', null, r.name), h('td', null, r.ig || '—'), h('td', null, h('a', { href: 'mailto:' + r.email }, r.email)),
        h('td', { class: 'num' }, h('b', null, r.score)), h('td', { class: 'num' }, r.rounds), mode === 'best' ? h('td', { class: 'num' }, r.games) : null, h('td', null, fmtDate(r.at))))))) : h('p', { class: 'muted' }, 'Zatiaľ sa nikto nezapísal.'));
  };
  const sw = h('div', { class: 'seg' },
    h('button', { type: 'button', class: 'on', onclick: (e) => { mode = 'best'; sw.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === e.target)); draw(); } }, 'Najlepší výsledok hráča'),
    h('button', { type: 'button', onclick: (e) => { mode = 'all'; sw.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === e.target)); draw(); } }, 'Všetky hry'));
  const csv = h('button', { class: 'btn ghost small', type: 'button', onclick: () => {
    const q = (s) => '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"';
    const lines = [['Poradie', 'Meno', 'Instagram', 'E-mail', 'Body', 'Kolá', 'Dátum'].map(q).join(';')].concat(all.map((r, i) => [i + 1, r.name, r.ig, r.email, r.score, r.rounds, r.at].map(q).join(';')));
    const a = h('a', { href: URL.createObjectURL(new Blob(['﻿' + lines.join('\n')], { type: 'text/csv' })), download: 'stullers-rebricek.csv' }); a.click();
  } }, 'Stiahnuť CSV');
  fill(lc, h('h2', null, 'Rebríček'), h('p', { class: 'sub' }, 'Zoradené od najviac bodov. Zapísaných hier: ' + all.length + '.'), h('div', { class: 'row', style: 'margin-bottom:12px' }, sw, h('span', { class: 'spacer' }), all.length ? csv : null), tbl);
  draw();
};

/* ---------- Zadania workshopov ---------- */
VIEWS.requests = async (v) => {
  title(v, 'Zadania workshopov', 'Zadania z formulára „Naklikaj si workshop“. Okrem e-mailu sa ukladajú aj sem, aby sa žiadne nestratilo.');
  const box = h('div', null, h('p', { class: 'muted' }, 'Načítavam…'));
  v.append(box);
  const r = await api('workshops');
  const list = r.ok ? r.requests : [];
  S.counts.workshops = list.length;
  if(!list.length){ fill(box, h('p', { class: 'muted' }, 'Zatiaľ neprišlo žiadne zadanie.')); return; }
  const row = (k, val) => val ? [h('dt', null, k), h('dd', null, val)] : [];
  fill(box, ...list.map(w => {
    const d = (w.date || '').split('-');
    return h('div', { class: 'ws-req' },
      h('div', { class: 'row' }, h('b', { style: 'font-size:18px' }, w.name), h('span', { class: 'muted' }, 'prijaté ' + fmtDate(w.at)), h('span', { class: 'spacer' }),
        h('a', { class: 'btn small', href: 'mailto:' + w.email + '?subject=' + encodeURIComponent('Workshop – Štullers') }, 'Odpovedať')),
      h('dl', null,
        row('E-mail', w.email), row('Telefón', w.phone), row('Pre koho', [w.clientType, w.clientName].filter(Boolean).join(' – ')),
        row('Téma', [(w.topics || []).join(', '), w.topicText].filter(Boolean).join(' · ')),
        row('Kedy', d.length === 3 ? (+d[2]) + '. ' + (+d[1]) + '. ' + d[0] + ' o ' + w.time + (w.flexible ? ' (flexibilne)' : '') : ''),
        row('Kde', [w.city, w.place].filter(Boolean).join(' – ')), row('Vek', (w.ages || []).join(', ')), row('Dĺžka', w.duration),
        row('Účastníci', w.participants), row('Konzultácia', w.consult), row('Poznámka', w.note)));
  }));
};

/* ---------- Náhľad ---------- */
VIEWS.preview = async (v) => {
  title(v, 'Náhľad konceptu', 'Takto bude web vyzerať po zverejnení. Návštevníci koncept nevidia.');
  await flush();
  const frame = h('iframe', { src: '../index.php?preview=1&t=' + Date.now(), title: 'Náhľad webu' });
  const stage = h('div', { class: 'pv-stage' }, frame);
  const sw = h('div', { class: 'seg' },
    h('button', { type: 'button', class: 'on', onclick: (e) => { stage.classList.remove('mobile'); sw.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === e.target)); } }, 'Počítač'),
    h('button', { type: 'button', onclick: (e) => { stage.classList.add('mobile'); sw.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === e.target)); } }, 'Mobil'));
  v.append(h('div', { class: 'row', style: 'margin-bottom:12px' }, sw,
    h('button', { class: 'btn ghost small', type: 'button', onclick: async () => { await flush(); frame.src = '../index.php?preview=1&t=' + Date.now(); } }, 'Obnoviť'),
    h('a', { class: 'btn ghost small', href: '../index.php?preview=1', target: '_blank', rel: 'noopener' }, 'Otvoriť v novom okne')), stage);
};

/* ---------- História ---------- */
VIEWS.history = async (v) => {
  title(v, 'História verzií', 'Pri každom zverejnení sa predchádzajúca verzia webu uloží sem. Ktorúkoľvek vieš jedným klikom vrátiť na web.');
  const box = h('div', null, h('p', { class: 'muted' }, 'Načítavam…'));
  v.append(box);
  const r = await api('history');
  const list = r.ok ? r.history : [];
  if(!list.length){ fill(box, h('p', { class: 'muted' }, 'Zatiaľ žiadne staršie verzie. Vzniknú pri prvom zverejnení.')); return; }
  fill(box, h('div', { class: 'tbl-wrap' }, h('table', null,
    h('thead', null, h('tr', null, h('th', null, 'Verzia z'), h('th', null, 'Kedy uložená'), h('th', null, ''))),
    h('tbody', null, list.map(x => h('tr', null, h('td', null, fmtDate(x.at)), h('td', null, x.label), h('td', { style: 'text-align:right' },
      h('button', { class: 'btn small', type: 'button', onclick: async () => {
        if(!confirm('Vrátiť na web verziu z ' + fmtDate(x.at) + '? Súčasná verzia sa uloží do histórie a nezverejnený koncept sa nahradí.')) return;
        const rr = await api('restore', { method: 'POST', body: { id: x.id } });
        if(!rr.ok){ toast(errText(rr), true); return; }
        S.content = normalize(rr.content); S.meta = rr.meta; S.dirtyLocal = false; updateStatus(); toast('Verzia je obnovená a zverejnená.'); render();
      } }, 'Obnoviť'))))))));
};

/* ---------- Účet ---------- */
VIEWS.account = (v) => {
  title(v, 'Účet', 'Jeden spoločný účet pre administráciu.');
  const f = h('form', { class: 'card', style: 'max-width:520px', onsubmit: async (e) => {
    e.preventDefault();
    const o = f.querySelector('#po').value, n1 = f.querySelector('#pn').value, n2 = f.querySelector('#pn2').value;
    if(n1.length < 10){ toast(ERR.weak_password, true); return; }
    if(n1 !== n2){ toast('Nové heslá sa nezhodujú.', true); return; }
    const r = await api('password', { method: 'POST', body: { old: o, new: n1 } });
    if(!r.ok){ toast(errText(r), true); return; }
    f.reset(); toast('Heslo je zmenené.');
  } },
    h('h2', null, 'Zmena hesla'),
    h('div', { class: 'field' }, h('label', { for: 'po' }, 'Súčasné heslo'), h('input', { id: 'po', type: 'password', autocomplete: 'current-password', required: true })),
    h('div', { class: 'field' }, h('label', { for: 'pn' }, 'Nové heslo (aspoň 10 znakov)'), h('input', { id: 'pn', type: 'password', autocomplete: 'new-password', required: true })),
    h('div', { class: 'field' }, h('label', { for: 'pn2' }, 'Nové heslo ešte raz'), h('input', { id: 'pn2', type: 'password', autocomplete: 'new-password', required: true })),
    h('button', { class: 'btn', type: 'submit' }, 'Zmeniť heslo'));
  v.append(f, h('div', { class: 'card', style: 'max-width:520px' }, h('h2', null, 'Odhlásenie'), h('p', { class: 'sub' }, 'Na cudzom počítači sa vždy odhlás.'),
    h('button', { class: 'btn ghost', type: 'button', onclick: async () => { await flush(); await api('logout', { method: 'POST', body: {} }); location.reload(); } }, 'Odhlásiť sa')));
};

/* ---------- štart ---------- */
async function start(){
  const [ok, d] = await Promise.all([loadContent(), api('defaults')]);
  if(!ok){ fill(app, h('div', { class: 'boot' }, 'Obsah sa nepodarilo načítať.')); return; }
  if(d.ok) S.defaults = d.i18n;
  const view = (location.hash || '').slice(1);
  S.view = VIEWS[view] ? view : 'overview';
  renderShell(); render();
  api('workshops').then(r => { if(r.ok){ S.counts.workshops = r.requests.length; const b = document.querySelector('.nav-btn[data-view="requests"]'); if(b && r.requests.length && !b.querySelector('.count')) b.append(h('span', { class: 'count' }, r.requests.length)); } });
}
async function boot(){
  const st = await api('state');
  if(!st.ok){ fill(app, h('div', { class: 'boot' }, 'Administrácia sa nevie spojiť so serverom. ' + errText(st))); return; }
  S.csrf = st.csrf;
  if(!st.installed) renderInstall(st);
  else if(!st.loggedIn) renderLogin(st);
  else start();
}
boot();
})();
