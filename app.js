/* ══════════════════════════════════════════════════════════
   storage — works as a Claude artifact, a local file, or on
   GitHub Pages. Tries window.storage, then localStorage, then
   memory (session only).
   ══════════════════════════════════════════════════════════ */
/* Bumped automatically by scripts/sync.ps1 on every release. Shown at the
   bottom of Setup so you can tell at a glance which build a device is
   actually running — a cached page looks identical otherwise. */
const APP_VERSION = '0.12.33';

const mem = {};
const store = {
  async get(k){
    try{ if(window.storage){ const r = await window.storage.get(k); return r ? JSON.parse(r.value) : null; } }catch(e){}
    try{ const v = localStorage.getItem(k); return v ? JSON.parse(v) : (k in mem ? mem[k] : null); }catch(e){}
    return k in mem ? mem[k] : null;
  },
  async set(k,v){
    mem[k]=v;
    try{ if(window.storage){ await window.storage.set(k, JSON.stringify(v)); return; } }catch(e){}
    try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){}
  }
};

/* ── state ────────────────────────────────────────────────── */
let DB = { items:[], shelves:['Main'], token:'', curr:'GBP' };
const SYM = {GBP:'£',USD:'$',EUR:'€',AUD:'A$',CAD:'C$',JPY:'¥',SEK:'kr '};
const sym = () => SYM[DB.curr] || '';
const $ = s => document.querySelector(s);
const esc = s => String(s??'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

async function load(){
  const d = await store.get('crate.db');
  if(d) DB = Object.assign(DB, d);
  $('#tok').value = DB.token || '';
  $('#bpmKey').value = DB.bpmKey || '';
  $('#curr').value = DB.curr || 'GBP';
}
let saveTimer;
function save(){
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    store.set('crate.db', DB);
    /* Sync is defined further down; harmless before it exists */
    try{ if(typeof Sync !== 'undefined') Sync.onLocalChange(); }catch(e){}
  }, 200);
}

/* ══════════════════════════════════════════════════════════
   SYNC (Firebase Firestore) — same approach as the POS app
   Local-first: everything works offline on localStorage. This
   layer mirrors the crate to a Firestore workspace so a phone,
   an iPad and a computer stay in step.
   - Each record syncs as its OWN document, so editing different
     records on two devices never clobbers anything.
   - Merge rule: newest edit to a given record wins.
   - Offline changes queue and go up on reconnect. Export backup
     remains the fully-offline fallback.
   Records live at workspaces/<code>/records and the shelf order
   at workspaces/<code>/meta/crate — different names to the POS's
   items/sales/session, so one Firebase project holds both safely.
   ══════════════════════════════════════════════════════════ */
var Sync = (function(){
  const CFG='crate.sync.cfg', CODE='crate.sync.code', MAIL='crate.sync.email',
        ON='crate.sync.on', CID='crate.sync.client', TIMES='crate.sync.times';
  const SDK_APP ='https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js';
  const SDK_FS  ='https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-compat.js';
  const SDK_AUTH='https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js';

  let app=null, db=null, recCol=null, metaDoc=null;
  let listeners=[], connected=false, connecting=false;
  let shadow={}, metaShadow='';

  const ls = {
    get(k){ try{ return localStorage.getItem(k)||''; }catch(e){ return ''; } },
    set(k,v){ try{ localStorage.setItem(k,v); }catch(e){} }
  };
  const clientId = (() => {
    let v = ls.get(CID);
    if(!v){ v = Math.random().toString(36).slice(2) + Date.now().toString(36); ls.set(CID,v); }
    return v;
  })();

  let times = (() => {
    let o = null; try{ o = JSON.parse(ls.get(TIMES)); }catch(e){}
    if(!o || typeof o !== 'object') o = {};
    o.records = o.records || {}; o.meta = o.meta || 0; return o;
  })();
  const saveTimes = () => ls.set(TIMES, JSON.stringify(times));

  const getCfg = () => { try{ return JSON.parse(ls.get(CFG)); }catch(e){ return null; } };
  const getCode = () => ls.get(CODE);
  const getEmail = () => ls.get(MAIL);
  const isOn = () => ls.get(ON) === '1';

  const ser = v => { try{ return JSON.stringify(v); }catch(e){ return ''; } };
  /* Firestore rejects undefined; a JSON round-trip drops those keys */
  const clean = v => JSON.parse(ser(v));
  const docSafe = s => String(s||'').replace(/[\/\.\#\$\[\]]/g,'_').slice(0,120);

  function setStatus(text, kind){
    const el = $('#syncState');
    if(!el) return;
    /* An error is never dressed up as "Synced — …". That prefix applied
       to every message while connected, which is a large part of why a
       failed upload looked exactly like a healthy one. */
    el.textContent = (connected && kind !== 'err') ? ('Synced — ' + text) : text;
    el.style.color = kind==='err' ? 'var(--bad)' : (kind==='ok' ? 'var(--ok)' : 'var(--dust)');
  }

  function loadScript(src){
    return new Promise((res, rej) => {
      if(document.querySelector(`script[data-fb="${src}"]`)) return res();
      const s = document.createElement('script');
      s.src = src; s.async = true; s.setAttribute('data-fb', src);
      s.onload = res;
      s.onerror = () => rej(new Error('Could not load Firebase — are you online?'));
      document.head.appendChild(s);
    });
  }
  async function loadSDK(){
    if(!(window.firebase && window.firebase.firestore && window.firebase.auth)){
      await loadScript(SDK_APP); await loadScript(SDK_FS); await loadScript(SDK_AUTH);
    }
    if(!(window.firebase && window.firebase.firestore)) throw new Error('Firebase failed to load');
  }

  /* ── incoming ─────────────────────────────────────────── */
  function applyRemoteRecord(id, d){
    if(!d) return false;
    const key = d.key || id;                       /* real uid, not the sanitised doc id */
    const ts = Number(d.updatedAt)||0, mine = Number(times.records[key])||0;
    if(d.by === clientId && ts <= mine) return false;   /* our own echo */
    if(ts < mine) return false;                         /* local is newer */
    const at = DB.items.findIndex(x => x.uid === key);
    if(d.deleted){ if(at >= 0) DB.items.splice(at, 1); delete shadow[key]; }
    else {
      if(at >= 0) DB.items[at] = d.data; else DB.items.unshift(d.data);
      shadow[key] = ser(d.data);
    }
    times.records[key] = ts;
    return true;
  }
  function applyRemoteMeta(d){
    if(!d) return false;
    const ts = Number(d.updatedAt)||0, mine = Number(times.meta)||0;
    if(d.by === clientId && ts <= mine) return false;
    if(ts < mine) return false;
    let changed = false;
    if(Array.isArray(d.shelves) && ser(d.shelves) !== ser(DB.shelves)){ DB.shelves = d.shelves; changed = true; }
    if(d.curr && d.curr !== DB.curr){ DB.curr = d.curr; changed = true; }
    times.meta = ts;
    metaShadow = ser({s: DB.shelves, c: DB.curr});
    return changed;
  }

  /* ── outgoing: diff against the shadow copy ───────────── */
  /* Writes are still fired without waiting — blocking a save on the
     network would make the app feel broken offline, and Firestore's own
     persistence queues and replays them. But a REJECTED write (rules,
     expired login, quota) must not leave the shadow claiming success:
     the shadow is what the next diff compares against, so a record
     marked as sent and then lost was never offered again, while the
     status line went on reading "Synced". */
  const guard = (p, fn) => { if(p && typeof p.catch === 'function') p.catch(fn); };

  /* Put the shadow and the timestamp back exactly as they were, so the
     next save — or Sync now — offers this record again. The timestamp
     matters as much as the shadow: left at the failed write's time it
     would out-rank a genuine remote update and reject it. */
  function writeFailed(uid, prevShadow, prevTs, err){
    if(prevShadow === undefined) delete shadow[uid]; else shadow[uid] = prevShadow;
    if(prevTs === undefined) delete times.records[uid]; else times.records[uid] = prevTs;
    saveTimes();
    setStatus('some changes have not uploaded — tap Sync now to try again', 'err');
    try{ console.warn('Crate sync: upload failed for', uid, err); }catch(e){}
  }

  function pushRecords(){
    if(!connected) return;
    const cur = {};
    DB.items.forEach(i => { if(i && i.uid) cur[i.uid] = i; });
    let n = 0;
    Object.keys(cur).forEach(uid => {
      const s = ser(cur[uid]);
      if(shadow[uid] !== s){
        const prevShadow = shadow[uid], prevTs = times.records[uid];
        const ts = Date.now(); times.records[uid] = ts; shadow[uid] = s; n++;
        guard(recCol.doc(docSafe(uid)).set({data: clean(cur[uid]), updatedAt: ts, by: clientId, deleted:false, key: uid}),
              err => writeFailed(uid, prevShadow, prevTs, err));
      }
    });
    Object.keys(shadow).forEach(uid => {
      if(!(uid in cur)){
        const prevShadow = shadow[uid], prevTs = times.records[uid];
        const ts = Date.now(); times.records[uid] = ts; delete shadow[uid]; n++;
        guard(recCol.doc(docSafe(uid)).set({updatedAt: ts, by: clientId, deleted:true, key: uid}),
              err => writeFailed(uid, prevShadow, prevTs, err));
      }
    });
    if(n) saveTimes();
  }
  function pushMeta(){
    if(!connected) return;
    const sig = ser({s: DB.shelves, c: DB.curr});
    if(sig === metaShadow) return;
    const prevShadow = metaShadow, prevTs = times.meta;   /* same trap as pushRecords */
    metaShadow = sig;
    const ts = Date.now(); times.meta = ts; saveTimes();
    guard(metaDoc.set({shelves: clean(DB.shelves), curr: DB.curr, updatedAt: ts, by: clientId}),
      err => {
        metaShadow = prevShadow; times.meta = prevTs; saveTimes();
        setStatus('your shelf list has not uploaded — tap Sync now to try again', 'err');
        try{ console.warn('Crate sync: shelf list upload failed', err); }catch(e){}
      });
  }

  /* the debounced save() calls this on every local change */
  function onLocalChange(){
    if(!connected) return;
    try{ pushRecords(); pushMeta(); }catch(e){}
  }

  function landed(){                     /* remote data arrived: persist + redraw */
    store.set('crate.db', DB);
    saveTimes();
    renderAll();
  }
  function attachListeners(){
    detach();
    listeners.push(recCol.onSnapshot(snap => {
      let touched = false;
      snap.docChanges().forEach(ch => { if(applyRemoteRecord(ch.doc.id, ch.doc.data())) touched = true; });
      if(touched) landed();
    }, onErr));
    listeners.push(metaDoc.onSnapshot(doc => {
      if(doc.exists && applyRemoteMeta(doc.data())) landed();
    }, onErr));
  }
  const onErr = () => setStatus('connection problem — retrying', 'err');
  function detach(){ listeners.forEach(u => { try{ u(); }catch(e){} }); listeners = []; }

  /* Merge everything remote into local, then set the shadow to what the
     SERVER holds — not to what we have. The push that follows diffs
     against it, so records only this device knows about (a fresh phone,
     or the very first connect) get sent up. Building the shadow from
     local data instead makes that diff empty and nothing ever uploads. */
  async function reconcile(){
    const rs = await recCol.get();
    const remote = {};
    rs.forEach(doc => { const d = doc.data(); if(d) remote[d.key || doc.id] = d; });
    Object.keys(remote).forEach(k => applyRemoteRecord(k, remote[k]));

    const ms = await metaDoc.get();
    if(ms.exists) applyRemoteMeta(ms.data());

    shadow = {};
    Object.keys(remote).forEach(k => { if(!remote[k].deleted) shadow[k] = ser(remote[k].data); });

    store.set('crate.db', DB); saveTimes();
    renderAll();
  }

  async function connect(opts){
    opts = opts || {};
    if(connecting) return;
    connecting = true;
    const cfg = getCfg();
    if(!cfg || !getCode()){ connecting = false; setStatus('needs setting up', 'err'); return; }
    try{
      setStatus('connecting…');
      await loadSDK();
      try{ app = firebase.apps && firebase.apps.length ? firebase.app() : firebase.initializeApp(cfg); }
      catch(e){ app = firebase.initializeApp(cfg); }

      const auth = firebase.auth(app);
      try{ await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL); }catch(e){}
      if(!auth.currentUser){
        const email = (opts.email || getEmail() || '').trim();
        const pw = opts.password || '';
        if(!email || !pw){
          connecting = false;
          setStatus('enter your email and password above, then tap Turn sync on', 'err');
          if(!opts.silent) toast('Sign in to turn sync on');
          return;
        }
        try{ await auth.signInWithEmailAndPassword(email, pw); }
        catch(e){
          connecting = false;
          const msg = e && e.code === 'auth/invalid-credential' ? 'Wrong email or password'
                    : e && e.code === 'auth/operation-not-allowed' ? 'Turn on Email/Password sign-in in Firebase'
                    : (e && e.message) || 'Sign-in failed';
          setStatus(msg, 'err');
          if(!opts.silent) toast(msg, 4000);
          return;
        }
      }

      db = firebase.firestore(app);
      try{ await db.enablePersistence({synchronizeTabs:true}); }catch(e){}
      const ws = db.collection('workspaces').doc(docSafe(getCode()));
      recCol  = ws.collection('records');
      metaDoc = ws.collection('meta').doc('crate');

      await reconcile();
      connected = true;
      pushRecords(); pushMeta();          /* send anything remote didn't have */
      attachListeners();
      connecting = false;
      ls.set(ON, '1');
      setStatus('all up to date', 'ok');
      if(!opts.silent) toast('Sync is on');
      const pw = $('#syncPw'); if(pw) pw.value = '';
    }catch(err){
      connecting = false; connected = false;
      setStatus((err && err.message) || 'could not connect', 'err');
      if(!opts.silent) toast((err && err.message) || 'Could not turn sync on', 4000);
    }
  }

  function disconnect(){
    detach(); connected = false; connecting = false;
    ls.set(ON, '0');
    setStatus('Sync is off.');
    toast('Sync turned off');
  }

  function saveSettings(cfgText, code, email){
    let cfg;
    try{ cfg = JSON.parse(cfgText); }
    catch(e){
      const m = cfgText && cfgText.match(/\{[\s\S]*\}/);        /* tolerate a pasted snippet */
      if(m){ try{ cfg = JSON.parse(m[0]); }catch(e2){
        try{ cfg = (new Function('return (' + m[0] + ')'))(); }catch(e3){ cfg = null; }
      } }
    }
    if(!cfg || !cfg.projectId || !cfg.apiKey) throw new Error('That Firebase config looks incomplete — it needs apiKey and projectId.');
    if(!code || !code.trim()) throw new Error('Pick a collection code, the same on every device.');
    if(!email || !email.trim()) throw new Error('Enter the email you log in with.');
    ls.set(CFG, JSON.stringify(cfg));
    ls.set(CODE, code.trim());
    ls.set(MAIL, email.trim());            /* email only — never the password */
    return cfg;
  }

  function syncNow(){
    if(!connected){ connect(); return; }
    try{ pushRecords(); pushMeta(); }catch(e){}
    reconcile().then(() => { attachListeners(); setStatus('all up to date', 'ok'); toast('Synced'); })
               .catch(() => setStatus('sync problem', 'err'));
  }

  /* for the backup file: the settings worth carrying to another device.
     Deliberately not the client id or the per-record sync timestamps —
     those describe THIS device's conversation with the server, and
     restoring them elsewhere would make it skip real updates. */
  function exportSettings(){
    return {cfg: getCfg(), code: getCode(), email: getEmail(), on: isOn()};
  }
  function importSettings(s){
    if(!s || typeof s !== 'object') return false;
    if(s.cfg)   ls.set(CFG, JSON.stringify(s.cfg));
    if(s.code)  ls.set(CODE, String(s.code));
    if(s.email) ls.set(MAIL, String(s.email));
    ls.set(ON, s.on ? '1' : '0');
    return true;
  }

  return {connect, disconnect, syncNow, saveSettings, onLocalChange, setStatus,
          isOn, getCfg, getCode, getEmail, exportSettings, importSettings,
          isConnected: () => connected};
})();

function toast(msg, ms=2600){
  const t = $('#toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(t._t); t._t = setTimeout(()=>t.classList.remove('on'), ms);
}
const spin = on => $('#disc').classList.toggle('on', on);

/* ══════════════════════════════════════════════════════════
   Discogs — throttled to stay inside 60 requests a minute
   ══════════════════════════════════════════════════════════ */
const API = 'https://api.discogs.com';
let lastCall = 0;
async function dg(path, params={}){
  if(!DB.token) throw new Error('NO_TOKEN');
  const wait = 1100 - (Date.now() - lastCall);
  if(wait > 0) await new Promise(r => setTimeout(r, wait));
  lastCall = Date.now();
  const u = new URL(API + path);
  Object.entries(params).forEach(([k,v]) => v!=null && v!=='' && u.searchParams.set(k,v));
  u.searchParams.set('token', DB.token);
  let res;
  try{ res = await fetch(u, {headers:{'Accept':'application/json'}}); }
  catch(e){ throw new Error('NETWORK'); }
  if(res.status === 401) throw new Error('BAD_TOKEN');
  if(res.status === 429){ await new Promise(r=>setTimeout(r,4000)); return dg(path, params); }
  if(res.status === 404) throw new Error('NOT_FOUND');
  if(!res.ok) throw new Error('HTTP_' + res.status);
  return res.json();
}

function friendly(e){
  const m = {
    NO_TOKEN:'Add your Discogs token in Setup first.',
    BAD_TOKEN:'Discogs rejected that token. Check it in Setup.',
    NETWORK:'Could not reach Discogs. Check your connection.',
    NOT_FOUND:'Discogs has no record with that ID.'
  };
  return m[e.message] || ('Discogs error: ' + e.message);
}

/* search by barcode, then catno, then free text.
   `parts` is [artist, title] when a cover read gave us two separate lines:
   naming the fields beats one blob in q= by a distance, and it also skips
   the catno attempt, which for a cover read was never going to hit. The
   free-text try still follows, so a sleeve laid out title-over-artist —
   or a line that came back garbled — is not left with nothing. */
async function findRelease(codeRaw, parts){
  const code = codeRaw.trim();
  /* Discogs stores catalogue numbers inconsistently — "WAP 39" on one
     release, "WAP39" on the next — and the catno search wants the shape
     it holds. Trying the de-spaced form costs one extra call, and only
     when the first has already missed. */
  const tight = code.replace(/\s+/g, '');
  const catTries = (tight !== code && tight.length >= 4)
    ? [{catno:code}, {catno:tight}] : [{catno:code}];
  const tries = (parts && parts.length === 2)
    ? [{artist: parts[0], release_title: parts[1]}, {q:code}]
    : /^\d{8,14}$/.test(code)
    ? [{barcode:code}, {q:code}]
    : catTries.concat([{q:code}]);
  for(const p of tries){
    const r = await dg('/database/search', Object.assign({type:'release', per_page:12}, p));
    if(r.results && r.results.length) return r.results;
  }
  return [];
}

async function fetchRelease(id){
  return dg('/releases/' + id, {curr_abbr: DB.curr});
}

/* ── Discogs tracklists are messier than they look ──────────
   Headings are dividers, not tracks. Index entries (continuous
   mix sides) hide the real tracks in sub_tracks. Compilation
   tracks carry their own artist that isn't the release artist. */
const cleanName = n => String(n||'').replace(/\s*\(\d+\)$/,'');
function mkTrack(t, parentPos){
  return {
    pos: t.position || parentPos || '',
    title: t.title || 'Untitled',
    artist: (t.artists||[]).map(a => cleanName(a.name)).join(' & '), // blank = same as release
    dur: t.duration || '',
    bpm: null, key: '', genre: ''
  };
}
function flatTracks(list){
  const out = [];
  (list||[]).forEach(t => {
    if(t.type_ === 'heading') return;
    if(Array.isArray(t.sub_tracks) && t.sub_tracks.length){
      t.sub_tracks.forEach(s => { if(s.type_ !== 'heading') out.push(mkTrack(s, t.position)); });
    } else out.push(mkTrack(t, ''));
  });
  return out;
}
/* keep BPM, key and genre already typed in when a tracklist is re-pulled.
   Title wins over position: sub-tracks on a continuous mix all share
   the parent's position, so matching on position alone double-assigns.
   Each old track is consumed once so nothing gets copied twice. */
function mergeTracks(fresh, old){
  const pool = (old||[]).slice();
  const take = pred => { const j = pool.findIndex(pred); return j<0 ? null : pool.splice(j,1)[0]; };
  const norm = s => String(s||'').trim().toLowerCase();
  const out = fresh.map(t => {
    const m = take(o => norm(o.title) === norm(t.title))
           || take(o => o.pos && o.pos === t.pos);
    if(!m) return t;                     /* genuinely new on Discogs */
    /* Anything already filled in here wins, field by field — Discogs
       only supplies what is still blank. A retitled track used to snap
       back to Discogs' wording on every refresh. */
    return {
      pos:    m.pos    || t.pos,
      title:  m.title  || t.title,
      artist: m.artist || t.artist,
      dur:    m.dur    || t.dur,
      bpm:    m.bpm ?? null,
      key:    m.key    || '',
      genre:  m.genre  || ''
    };
  });
  /* Whatever is left never matched a Discogs track, so it is one you
     added by hand. These used to be dropped on the floor by a refresh —
     the tracklist was simply replaced. They are kept, on the end. */
  return out.concat(pool);
}
function toItem(rel, scanned){
  const artist = (rel.artists||[]).map(a => a.name.replace(/\s*\(\d+\)$/,'')).join(' & ') || 'Unknown artist';
  const lab = (rel.labels||[])[0] || {};
  return {
    uid: 'r' + rel.id + '-' + Math.random().toString(36).slice(2,7),
    id: rel.id,
    artist,
    title: rel.title || 'Untitled',
    year: rel.year || (rel.released||'').slice(0,4) || '',
    label: lab.name ? lab.name.replace(/\s*\(\d+\)$/,'') : '',
    catno: lab.catno || '',
    country: rel.country || '',
    format: (rel.formats||[]).map(f => [f.name, f.text, (f.descriptions||[]).join(' ')].filter(Boolean).join(' ')).join(', '),
    genres: (rel.genres||[]).concat(rel.styles||[]),
    art: (rel.images && rel.images[0] ? (rel.images[0].uri150 || rel.images[0].uri) : (rel.thumb||'')),
    tracks: flatTracks(rel.tracklist),
    low: typeof rel.lowest_price === 'number' ? rel.lowest_price : null,
    forSale: rel.num_for_sale ?? null,
    have: rel.community?.have ?? null,
    want: rel.community?.want ?? null,
    barcode: scanned || '',
    media: 'VG+', sleeve: 'VG+',
    paid: null, notes: '', shelf: fileShelf(),
    slot: nextSlot(fileShelf()),                  /* fileNew() has the final say */
    added: new Date().toISOString(),
    priced: Date.now()
  };
}

/* The sane range for a typed tempo. Declared once so the input's own
   min/max and the code that enforces them can't drift apart — the
   attributes alone are only a browser hint and stopped nothing, so a
   slipped digit (1288 for 128) went straight into the record and then
   skewed relBpm(), which averages every track on it. */
const BPM_MIN = 40, BPM_MAX = 300;

/* Goldmine condition multipliers, applied to the Discogs low */
const COND = {'M':1.35,'NM':1.20,'VG+':1.00,'VG':0.62,'G+':0.35,'G':0.22,'F':0.12,'P':0.06};
const GRADES = ['M','NM','VG+','VG','G+','G','F','P'];
function itemValue(it){
  if(it.low == null) return null;
  const m = (COND[it.media] ?? 1) * 0.8 + (COND[it.sleeve] ?? 1) * 0.2;
  return it.low * m;
}
const money = n => n==null ? '—' : sym() + n.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});

/* ── Hearing a record ────────────────────────────────────────
   The query is built at the moment you tap it and nothing is
   stored, so there is no backfill, it can never go stale, and a
   record added by hand gets one just the same as a Discogs one.
   YouTube Music rather than YouTube: its results are songs and
   albums, so you skip the reaction videos and hour-long loops.
   Declared up here because the record sheet is a long way below
   and a const used above its declaration is a dead zone throw. */
const ytSearch = (...parts) =>
  'https://music.youtube.com/search?q=' +
  encodeURIComponent(parts.filter(Boolean).join(' ').trim());
/* toItem() falls back to 'Unknown artist', which would otherwise go into
   the search box as two words that match nothing. */
const ytArtist = a => a === 'Unknown artist' ? '' : a;

/* ══════════════════════════════════════════════════════════
   Camelot wheel — 1A…12B, plus the musical key each one means
   ══════════════════════════════════════════════════════════ */
const KEYNAME = {
  '1A':'Ab min','1B':'B maj',  '2A':'Eb min','2B':'F# maj', '3A':'Bb min','3B':'Db maj',
  '4A':'F min', '4B':'Ab maj', '5A':'C min', '5B':'Eb maj', '6A':'G min', '6B':'Bb maj',
  '7A':'D min', '7B':'F maj',  '8A':'A min', '8B':'C maj',  '9A':'E min', '9B':'G maj',
  '10A':'B min','10B':'D maj','11A':'F# min','11B':'A maj','12A':'Db min','12B':'E maj'
};
const CAMELOT = Object.keys(KEYNAME).sort((a,b)=>
  (parseInt(a)-parseInt(b)) || a.slice(-1).localeCompare(b.slice(-1)));
const keyRank = k => { if(!k) return 999; const n=parseInt(k,10); return n*2 + (k.slice(-1)==='B'?1:0); };
const keyHue  = k => k ? (parseInt(k,10)-1)*30 : 0;

/* the three moves that stay in key, plus the track itself */
function compatible(k){
  if(!k) return [];
  const n = parseInt(k,10), L = k.slice(-1);
  const up = n===12?1:n+1, dn = n===1?12:n-1;
  return [k, n+(L==='A'?'B':'A'), up+L, dn+L];
}

function keyOpts(sel, blank='Any key'){
  return `<option value="">${blank}</option>` + CAMELOT.map(k =>
    `<option value="${k}" ${k===sel?'selected':''}>${k} · ${KEYNAME[k]}</option>`).join('');
}
const keyBadge = k => k ? `<span class="key" style="--kh:${keyHue(k)}">${k}</span>` : '';

/* ══════════════════════════════════════════════════════════
   tempo & key from the internet
   Two sources, tried in order, because neither alone is enough:
   • GetSongBPM — tempo AND key, needs a free API key (Setup).
     Their terms ask for a credit link; it's in the help sheet.
   • AcousticBrainz — free and keyless, but you have to find the
     MusicBrainz recording first, and the project stopped taking
     new analyses in 2022, so coverage thins out fast.
   Measured 5 hits in 8 on well-known dance records — and on one of
   them Deezer said 136.4 BPM where AcousticBrainz said 142.1,
   because they'd matched different mixes. So nothing here writes to
   a record by itself: it proposes, shows what it matched and how
   sure it is, and you decide. Getting this wrong silently would
   poison harmonic mixing, which is the one thing you can't check
   by looking at the sleeve.
   ══════════════════════════════════════════════════════════ */
const PITCH = {C:0,'B#':0,'C#':1,DB:1,D:2,'D#':3,EB:3,E:4,FB:4,F:5,'E#':5,
               'F#':6,GB:6,G:7,'G#':8,AB:8,A:9,'A#':10,BB:10,B:11,CB:11};
/* Camelot number per pitch class — majors are the B ring, minors the A ring */
const CAM_MAJ = [8,3,10,5,12,7,2,9,4,11,6,1];
const CAM_MIN = [5,12,7,2,9,4,11,6,1,8,3,10];

function toCamelot(note, scale){
  if(!note) return '';
  const pc = PITCH[String(note).trim().toUpperCase()];
  if(pc == null) return '';
  const minor = /min/i.test(scale || '');
  return (minor ? CAM_MIN[pc] : CAM_MAJ[pc]) + (minor ? 'A' : 'B');
}

/* MusicBrainz asks for no more than one request a second, and means it */
let mbLast = 0;
async function mbFetch(url){
  const wait = 1100 - (Date.now() - mbLast);
  if(wait > 0) await new Promise(r => setTimeout(r, wait));
  mbLast = Date.now();
  const res = await fetch(url, {headers:{'Accept':'application/json'}});
  if(!res.ok) throw new Error('MB_' + res.status);
  return res.json();
}

/* GetSongBPM answers in OpenKey, not Camelot — a different wheel, and
   the two are offset by 7: OpenKey 1d is C major, which is Camelot 8B.
   'd' is major, 'm' is minor.
   The plain key_of field is only ever the note ("G"), with no mode, so
   it cannot be converted safely on its own — assuming major would be
   wrong about half the time, and a confidently wrong key is the one
   thing this whole flow exists to avoid. If open_key is missing we
   hand back the tempo and no key. */
function openKeyToCamelot(ok){
  const m = /^(\d{1,2})\s*([dm])$/i.exec(String(ok || '').trim());
  if(!m) return '';
  const n = parseInt(m[1], 10);
  if(!(n >= 1 && n <= 12)) return '';
  return (((n + 6) % 12) + 1) + (m[2].toLowerCase() === 'm' ? 'A' : 'B');
}

async function fromGetSongBpm(artist, title){
  const apiKey = (DB.bpmKey || '').trim();
  if(!apiKey || !title) return null;
  const u = 'https://api.getsong.co/search/?api_key=' + encodeURIComponent(apiKey) +
            '&type=both&lookup=' + encodeURIComponent('song:' + title + ' artist:' + artist);
  const res = await fetch(u);
  if(!res.ok) return null;
  const j = await res.json();
  const hit = j && Array.isArray(j.search) ? j.search[0] : null;
  if(!hit || hit.error) return null;
  const bpm = parseFloat(hit.tempo);          /* comes back as a string */
  const cam = openKeyToCamelot(hit.open_key);
  if(!(bpm > 0) && !cam) return null;
  return {
    bpm: bpm > 0 ? Math.round(bpm*10)/10 : null,
    key: cam || '',
    conf: 0,
    matched: [hit.artist && hit.artist.name, hit.title].filter(Boolean).join(' — ') || title,
    source: 'GetSongBPM'
  };
}

async function fromAcousticBrainz(artist, title){
  if(!title) return null;
  const clean = s => String(s||'').replace(/["\\]/g,' ').trim();
  const q = 'artist:"' + clean(artist) + '" AND recording:"' + clean(title) + '"';
  /* Ask for a spread of candidates, not the top 3. The same track exists
     in MusicBrainz many times over — album, single, compilation — and only
     some of those recordings were ever analysed. Search ranking shifts
     between calls, so a narrow window turns this into a lottery. All the
     ids go to AcousticBrainz in one request, so it costs nothing extra. */
  const mb = await mbFetch('https://musicbrainz.org/ws/2/recording?fmt=json&limit=12&query=' + encodeURIComponent(q));
  const recs = (mb && mb.recordings) || [];
  if(!recs.length) return null;
  const ids = recs.slice(0, 12).map(r => r.id);
  const res = await fetch('https://acousticbrainz.org/api/v1/low-level?recording_ids=' + ids.join(';'));
  if(!res.ok) return null;
  const j = await res.json();
  for(const id of ids){
    const d = j[id] && j[id]['0'];
    if(!d || !d.rhythm || !d.rhythm.bpm) continue;
    const rec = recs.find(r => r.id === id) || {};
    const who = (rec['artist-credit'] || [])[0];
    return {
      bpm: Math.round(d.rhythm.bpm * 10) / 10,
      key: toCamelot(d.tonal && d.tonal.key_key, d.tonal && d.tonal.key_scale),
      conf: Math.round(((d.tonal && d.tonal.key_strength) || 0) * 100),
      matched: [who && who.name, rec.title].filter(Boolean).join(' — ') || title,
      source: 'AcousticBrainz'
    };
  }
  return null;
}

/* Both sources funnel through here, so the 40–300 range the typed box and
   tap tempo enforce is applied in one place — this was the one path that
   could still store an out-of-range BPM. Dropping just the tempo and
   keeping the key: an odd number says nothing about the key analysis, and
   a half-answer beats no answer. A result with nothing usable left in it
   is discarded so the next source still gets its turn. */
function inRange(r){
  if(!r) return null;
  if(r.bpm != null && !(r.bpm >= BPM_MIN && r.bpm <= BPM_MAX)) r.bpm = null;
  return (r.bpm != null || r.key) ? r : null;
}

async function lookupTempoKey(artist, title){
  try{ const g = inRange(await fromGetSongBpm(artist, title)); if(g) return g; }catch(e){}
  try{ return inRange(await fromAcousticBrainz(artist, title)); }catch(e){ return null; }
}

/* every track in the collection, flattened, with its release attached */
function allTracks(){
  const out = [];
  DB.items.forEach(it => (it.tracks||[]).forEach((t,i) => out.push({t, i, it})));
  return out;
}
/* a release's BPM range, for sorting sleeves */
function relBpm(it){
  const b = (it.tracks||[]).map(t=>t.bpm).filter(x=>x>0);
  return b.length ? b.reduce((a,c)=>a+c,0)/b.length : null;
}
function relKey(it){
  const k = (it.tracks||[]).map(t=>t.key).filter(Boolean);
  return k.length ? k[0] : '';
}
/* A track's genre, falling back to the release's own Discogs genre —
   the same rule the filter and the DJ sheet use, so a track nobody has
   typed up yet still sorts and exports under something sensible. */
const trackGenre = (t, it) => (t && t.genre) || ((it && it.genres) || [])[0] || '';
/* A release's genre for sorting: the first one actually typed on a
   track, else what Discogs called the record. */
function relGenre(it){
  const g = (it.tracks||[]).map(t => t.genre).filter(Boolean);
  return g.length ? g[0] : (((it.genres)||[])[0] || '');
}

/* ── where a record lives, in short ─────────────────────────
   A shelf's code is derived from its name every time it is drawn and
   never stored, so a rename can't leave a stale code behind and shelves
   stay plain strings — giving them a second field would mean rewriting
   shelfRank, the tiles, the filter, add/rename/remove, fileTo, CSV
   import, backup and the sync meta doc.
   Initials for several words, first two letters for one: 'Record box'
   → RB, 'Soul & Funk' → SF, 'House' → HO. Two shelves that reduce to
   the same code get the later one's position appended. */
function shelfCodes(){
  const out = {}, seen = {};
  DB.shelves.forEach((s, i) => {
    const w = String(s).split(/[^A-Za-z0-9]+/).filter(Boolean);
    let c = (w.length > 1 ? w.map(x => x[0]).join('') : (w[0] || 'S').slice(0,2))
              .toUpperCase().slice(0,3);
    if(seen[c]) c += (i + 1);
    seen[c] = 1;
    out[s] = c;
  });
  return out;
}
/* '??' covers a record whose shelf was removed — it still sorts to the
   bottom via shelfRank, and this says so rather than inventing a code. */
const locCode = (it, codes) => (codes[it.shelf] || '??') + '-' + (it.slot || '?');

/* ── every genre you have used, for the track dropdown ──────
   Derived rather than kept in a list of its own: type one on a track
   and it is offered on every track from then on, with nothing to keep
   in step and nothing to prune when the last use of one goes away.
   Seeded from the release-level genres and styles Discogs already
   filled in, so the dropdown is worth opening before you have typed
   anything at all. Matched case-insensitively so 'House' and 'house'
   don't both end up in the list. */
function genreList(){
  const seen = new Map();
  const add = g => {
    const s = String(g || '').trim();
    if(s && !seen.has(s.toLowerCase())) seen.set(s.toLowerCase(), s);
  };
  DB.items.forEach(it => {
    (it.genres || []).forEach(add);
    (it.tracks || []).forEach(t => add(t.genre));
  });
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

/* ══════════════════════════════════════════════════════════
   queue — scans resolve one at a time in the background
   ══════════════════════════════════════════════════════════ */
let QUEUE = [], working = false;

function enqueue(code){
  if(QUEUE.some(q => q.code === code && q.state === 'waiting')) return;
  QUEUE.unshift({code, state:'waiting', note:''});
  renderQueue(); pump();
}

async function pump(){
  if(working) return;
  const job = QUEUE.find(q => q.state === 'waiting');
  if(!job) return;
  working = true; spin(true);
  job.state = 'working'; renderQueue();
  try{
    const hits = await findRelease(job.code);
    if(!hits.length){ job.state='miss'; job.note='no match'; }
    else if(hits.length > 1){
      /* One barcode, many pressings — original, reissue, promo, a different
         country — and they carry different tracklists and different prices.
         The scan used to take hits[0] silently to avoid a dialog per sleeve
         while working down a shelf, but the camera has closed itself on
         every hit since v0.12.2, so that shelf-at-a-time flow no longer
         exists and the dialog it was avoiding can't happen. Nothing is
         filed until you pick. */
      job.state='choose'; job.hits=hits;
      job.note = hits.length + ' pressings — pick the one you own';
    }
    else{
      const rel = await fetchRelease(hits[0].id);
      const it = toItem(rel, job.code);
      const dup = DB.items.find(x => x.id === it.id);
      fileNew(it); save();
      job.state='done';
      job.note = (dup ? 'dupe · ' : '') + it.artist + ' — ' + it.title;
      job.uid = it.uid;
      renderAll();
    }
  }catch(e){
    job.state='miss'; job.note = friendly(e);
    if(e.message==='NO_TOKEN' || e.message==='BAD_TOKEN'){ QUEUE.forEach(q=>{ if(q.state==='waiting'){q.state='miss'; q.note='needs token';} }); }
  }
  working = false; renderQueue();
  const more = QUEUE.some(q => q.state === 'waiting');
  spin(more);
  if(more) return pump();
  /* Only once the queue has drained, and only if nothing else is already
     on screen — opening a sheet mid-queue would stack pickers and steal
     the screen from a record you had open. The rest stay as tappable
     "pick one" rows, so a choice is never lost, only deferred. */
  const pending = QUEUE.find(q => q.state === 'choose');
  if(pending && !$('#sheet').classList.contains('on')) openPicker(pending.hits, pending.code, pending);
}

function renderQueue(){
  const el = $('#queue');
  if(!QUEUE.length){ el.innerHTML = '<div class="hint">Nothing queued. Scans land here and resolve one at a time so Discogs doesn\'t rate-limit you.</div>'; return; }
  el.innerHTML = QUEUE.slice(0,25).map((q, i) => {
    const cls = q.state==='done'?'done':q.state==='miss'?'miss':'';
    const st = q.state==='waiting'?'queued':q.state==='working'?'looking…':
               q.state==='done'?'added':q.state==='choose'?'pick one':'no match';
    const tap = q.state==='choose';
    return `<div class="q ${cls}"${tap?` data-choose="${i}" style="cursor:pointer"`:''}>
      <div style="min-width:0">
        <div class="code">${esc(q.code)}</div>
        ${q.note?`<div style="font-size:11.5px;color:var(--dust);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:56vw">${esc(q.note)}</div>`:''}
      </div>
      <div class="st">${st}</div>
    </div>`;
  }).join('');
  /* Indexed against the same slice that was rendered, not against QUEUE —
     the list is capped at 25 and the two would drift apart. */
  el.querySelectorAll('[data-choose]').forEach(row => {
    row.onclick = () => {
      const q = QUEUE.slice(0,25)[+row.dataset.choose];
      if(q && q.hits) openPicker(q.hits, q.code, q);
    };
  });
}

/* ══════════════════════════════════════════════════════════
   searching by hand — show what Discogs found and let you choose
   A barcode can match a dozen pressings: the original, the reissue,
   the promo, a different country. Taking the first hit silently is how
   you end up with the wrong tracklist and the wrong price, so every path
   in — typed, OCR and camera — asks whenever there is more than one.
   A single match is still filed without interrupting you.
   ══════════════════════════════════════════════════════════ */
const isBarcode = s => /^\d{8,14}$/.test(String(s||'').trim());

async function searchAndChoose(code, parts){
  spin(true);
  $('#manual').blur();
  toast('Asking Discogs…', 1600);
  try{
    const hits = await findRelease(code, parts);
    spin(false);
    if(!hits.length){
      toast(`Discogs has nothing matching “${code}”`, 4200);
      return;
    }
    openPicker(hits, code);
  }catch(e){
    spin(false);
    toast(friendly(e), 4400);
  }
}

/* `job` is set when the picker was opened for a queued scan rather than a
   typed search, so the queue row can be closed off either way. */
function openPicker(hits, code, job){
  const list = hits.slice(0, 12);
  const rows = list.map((h, i) => {
    const have = DB.items.some(x => x.id === h.id);
    const bits = [h.year, (h.format||[]).join(' '), h.country,
                  (h.label||[])[0], h.catno].filter(Boolean).join(' · ');
    return `<button class="pick" data-i="${i}">
      ${h.thumb ? `<img src="${esc(h.thumb)}" alt="" loading="lazy">` : '<span class="noimg"></span>'}
      <span class="who">
        <b>${esc(h.title || 'Untitled')}</b>
        <span>${esc(bits || 'no details')}</span>
      </span>
      ${have ? '<span class="have">IN CRATE</span>' : '<span class="add">add</span>'}
    </button>`;
  }).join('');

  $('#sheetBody').innerHTML = `
    <h3 style="margin:0 0 4px">${hits.length} match${hits.length === 1 ? '' : 'es'} on Discogs</h3>
    <p class="hint" style="margin:0 0 12px">for “${esc(code)}” — pick the pressing you actually own.
      Check the year, format and catalogue number; they often differ between reissues.</p>
    <div class="picklist">${rows}</div>
    <button class="btn quiet" id="pickNone" style="margin-top:12px">None of these</button>`;

  $('#pickNone').onclick = () => {
    /* Settled, not left pending: a row that stays "pick one" after you have
       said none of them nags for a decision you already made. */
    if(job){ job.state='miss'; job.note='none picked'; job.hits=null; renderQueue(); }
    closeSheet();
  };
  $('#sheetBody').querySelectorAll('.pick').forEach(btn => {
    btn.onclick = () => addChosen(list[+btn.dataset.i], code, job);
  });
  $('#scrim').classList.add('on');
  $('#sheet').classList.add('on');
}

async function addChosen(hit, code, job){
  if(!hit) return;
  closeSheet();
  spin(true);
  toast('Fetching the details…', 2000);
  try{
    const rel = await fetchRelease(hit.id);
    const it = toItem(rel, isBarcode(code) ? code.trim() : '');
    const dup = DB.items.some(x => x.id === it.id);
    fileNew(it);
    if(job){
      job.state='done'; job.hits=null; job.uid=it.uid;
      job.note = (dup ? 'dupe · ' : '') + it.artist + ' — ' + it.title;
      renderQueue();
    }
    save(); renderAll();
    toast((dup ? 'Added another copy · ' : 'Added · ') + it.artist + ' — ' + it.title, 4200);
  }catch(e){
    toast(friendly(e), 4400);
  }
  spin(false);
}

/* ══════════════════════════════════════════════════════════
   camera — native BarcodeDetector where available, ZXing on iOS
   ══════════════════════════════════════════════════════════ */
let stream=null, detector=null, zx=null, rafId=null, recent=new Map();

function accept(code){
  /* ZXing's callback can fire again between the hit and the camera
     actually releasing, so ignore anything after the first. */
  if(!stream) return;
  const now = Date.now();
  if(recent.get(code) && now - recent.get(code) < 4000) return;
  recent.set(code, now);
  if(navigator.vibrate) navigator.vibrate(35);
  $('#stageNote').textContent = 'Got ' + code;
  enqueue(code);
  /* One sleeve, one scan: close the camera on a hit rather than leaving
     the user to reach for Stop. The lookup carries on in the queue below. */
  stopCam();
  toast('Got ' + code + ' — looking it up');
}

async function startCam(mode){
  camMode = mode === 'ocr' ? 'ocr' : 'barcode';
  $('#stage').classList.add('on');
  $('#stage').classList.toggle('wide', camMode === 'ocr' && ocrKind === 'cover');
  $('#btnCam').style.display='none'; $('#btnStop').style.display='';
  $('#btnRead').style.display = camMode === 'ocr' ? '' : 'none';
  /* say what to do straight away, not once the camera has warmed up */
  if(camMode === 'ocr') $('#stageNote').textContent = ocrKind === 'catno'
    ? 'Fill the box with the catalogue number, then tap Read it'
    : 'Fit the whole sleeve in the frame, then tap Read it';
  try{
    stream = await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}, width:{ideal:1280}}});
  }catch(e){
    $('#stageNote').textContent = 'Camera blocked. Allow camera access, or type the barcode below.';
    toast('No camera access — type the code instead'); return;
  }
  const v = $('#video'); v.srcObject = stream; await v.play();

  /* OCR reads one frame you choose, rather than hunting every frame:
     it is far more accurate on a still you have lined up, and it
     doesn't cook the battery. */
  if(camMode === 'ocr') return;

  if('BarcodeDetector' in window){
    try{
      detector = new BarcodeDetector({formats:['ean_13','ean_8','upc_a','upc_e','code_128','code_39']});
      $('#stageNote').textContent = 'Point at the barcode on the sleeve';
      const tick = async () => {
        if(!stream) return;
        try{ const b = await detector.detect(v); if(b.length) accept(b[0].rawValue); }catch(e){}
        if(!stream) return;               /* accept() closed the camera on a hit */
        rafId = requestAnimationFrame(tick);
      };
      tick(); return;
    }catch(e){ detector = null; }
  }
  await zxing();
}

async function zxing(){
  $('#stageNote').textContent = 'Loading scanner…';
  try{
    if(!window.ZXing){
      await new Promise((ok,bad)=>{
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js';
        s.onload = ok; s.onerror = bad; document.head.appendChild(s);
      });
    }
    zx = new ZXing.BrowserMultiFormatReader();
    $('#stageNote').textContent = 'Point at the barcode on the sleeve';
    zx.decodeFromStream(stream, $('#video'), (res)=>{ if(res) accept(res.getText()); });
  }catch(e){
    $('#stageNote').textContent = 'Scanner needs an internet connection the first time. Type the barcode below instead.';
  }
}

function stopCam(){
  if(rafId) cancelAnimationFrame(rafId); rafId=null;
  if(zx){ try{ zx.reset(); }catch(e){} zx=null; }
  if(stream){ stream.getTracks().forEach(t=>t.stop()); stream=null; }
  $('#video').srcObject=null;
  $('#stage').classList.remove('on');
  $('#stage').classList.remove('wide');
  $('#btnCam').style.display=''; $('#btnStop').style.display='none';
  $('#btnRead').style.display='none';
}

/* ══════════════════════════════════════════════════════════
   reading a sleeve — Tesseract, fetched on demand like ZXing
   Two jobs, one engine:
   • cat. no. — a short code on the spine or centre label, so it
     gets the reticle crop, a character whitelist and single-line
     mode, and feeds the catno branch of findRelease().
   • cover — artist and title set large, so it gets the whole
     frame and ordinary prose settings, and feeds the free-text
     branch, ending at the same picker a typed search uses.
   Matching the artwork itself is not on the table: Discogs has no
   image search, so there is nothing to send a photograph to.
   Reading what is printed on the sleeve is the nearest thing.
   ══════════════════════════════════════════════════════════ */
const OCR_SDK = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
let ocrWorker = null, ocrBusy = false, camMode = 'barcode', ocrKind = 'catno';

async function ocrReady(){
  if(ocrWorker) return ocrWorker;
  if(!window.Tesseract){
    await new Promise((ok, bad) => {
      const s = document.createElement('script');
      s.src = OCR_SDK; s.onload = ok; s.onerror = bad; document.head.appendChild(s);
    });
  }
  ocrWorker = await Tesseract.createWorker('eng');
  return ocrWorker;
}

/* The video is object-fit:cover inside a 4:3 stage, so some of the
   camera frame is off-screen. Work back to source pixels or the crop
   drifts away from whatever you carefully lined up in the reticle. */
function grabFrame(tight){
  const v = $('#video'), box = $('#stage').getBoundingClientRect();
  const vw = v.videoWidth, vh = v.videoHeight;
  if(!vw || !vh) return null;
  const scale = Math.max(box.width / vw, box.height / vh);
  const visW = box.width / scale, visH = box.height / scale;
  const ox = (vw - visW) / 2, oy = (vh - visH) / 2;
  const fx = tight ? 0.10 : 0.04, fy = tight ? 0.18 : 0.04;
  const sw = visW * (1 - fx * 2), sh = visH * (1 - fy * 2);
  /* Tesseract wants roughly 30px of x-height; sleeve type photographed
     at arm's length is well under that, so upscale the crop */
  const up = Math.min(3, Math.max(1, 1500 / sw));
  const c = document.createElement('canvas');
  c.width = Math.round(sw * up); c.height = Math.round(sh * up);
  c.getContext('2d').drawImage(v, ox + visW * fx, oy + visH * fy, sw, sh, 0, 0, c.width, c.height);
  return c;
}

/* Grey it, then stretch the histogram. Sleeve print is often low
   contrast behind plastic, and Tesseract does far better on clean
   black-on-white than on a grey-on-grey photograph. */
function boostContrast(c){
  const g = c.getContext('2d'), im = g.getImageData(0, 0, c.width, c.height), d = im.data;
  let min = 255, max = 0;
  for(let i = 0; i < d.length; i += 4){
    const y = (d[i] * 0.299 + d[i+1] * 0.587 + d[i+2] * 0.114) | 0;
    d[i] = d[i+1] = d[i+2] = y;
    if(y < min) min = y;
    if(y > max) max = y;
  }
  const span = Math.max(1, max - min);
  for(let i = 0; i < d.length; i += 4){
    const y = Math.max(0, Math.min(255, ((d[i] - min) * 255 / span) | 0));
    d[i] = d[i+1] = d[i+2] = y;
  }
  g.putImageData(im, 0, 0);
  return c;
}

/* Lines the engine itself wasn't sure about are dropped before either
   reader looks at them: a 30%-confidence line is noise, and noise in a
   search string is worse than a shorter search string. Declared up here
   because both readers use it and a `const` used above its declaration
   sits in the temporal dead zone — see §5 of the working notes. */
const LINE_CONF_MIN = 55;

const tidyCatno = s => String(s||'').toUpperCase()
  .replace(/[^A-Z0-9 \-\/\.]/g, ' ').replace(/\s+/g, ' ').trim();

/* ── picking the catalogue number off a centre label ────────
   The reticle is meant to hold the cat. no. and nothing else, but in
   practice it catches the label name above it, or "SIDE A  45 RPM"
   below. So read the whole crop and score each line on how much it
   looks like a catalogue number rather than trusting the crop.

   Everything a pressing plant stamps around the number — the label,
   the speed, the country, the rights boilerplate — either has no digit
   in it or is one of the stock words below, so it scores zero. */
const CATNO_STOP = /\b(SIDE|RPM|STEREO|MONO|MADE|PRINTED|GERMANY|ENGLAND|FRANCE|USA|EU|RECORDS|RECORDINGS|RIGHTS|RESERVED|PUBLISHING|PRODUCED|DISTRIBUTED)\b/;
function catnoScore(t){
  if(!/\d/.test(t)) return 0;                 /* every catalogue number has one */
  if(CATNO_STOP.test(t)) return 0;
  if(t.length > 18) return 0;                 /* that is a sentence, not a number */
  /* "A1" and friends are runout side marks, not catalogue numbers */
  if(t.replace(/[^A-Z0-9]/g, '').length < 4) return 0;
  let s = 10;
  if(/^[A-Z]{1,8}([\s.\-][A-Z]{1,4})*[\s.\-]?\d{1,5}([\s.\-]?\d{1,4})*$/.test(t)) s += 20;  /* WAP 39, WARP LP 39 */
  else if(/^\d{2,}([\s.\-]\d+)*$/.test(t)) s += 14;                                          /* 855 992-1 */
  else s += 6;                                                                               /* mixed, less sure */
  return s - Math.max(0, t.length - 12);      /* a catalogue number is compact */
}
function catnoFrom(data){
  let best = '', bestScore = 0;
  (data.blocks || []).forEach(b => (b.paragraphs || []).forEach(p =>
    (p.lines || []).forEach(l => {
      if((l.confidence || 0) < LINE_CONF_MIN) return;
      const t = tidyCatno(l.text);
      const s = catnoScore(t);
      if(s > bestScore){ best = t; bestScore = s; }
    })));
  /* Nothing scored — the number is probably buried in a longer line, as on
     a spine. Hand back the lot and let the free-text try in findRelease
     deal with it, which is what used to happen to everything. */
  return best || tidyCatno(data.text);
}

const tidyLine = s => String(s||'').replace(/[^A-Za-z0-9&'\- ]/g, ' ')
  .replace(/\s+/g, ' ').trim();
const usableLine = t => t.length >= 3 && /[A-Za-z]/.test(t);

/* ── picking the artist and title off a cover ───────────────
   Whatever is set largest on a sleeve is nearly always the artist and
   the title. This used to rank by how *long* each line was, which is a
   different thing entirely — a label strapline or a "Manufactured in
   the EU" line is longer than "ORBITAL" every time, and won every time.
   Tesseract hands back a bbox per line, so rank by cap height instead:
   the tallest two lines are the two set biggest.

   Returns top-to-bottom, because artist over title is the usual layout
   and findRelease uses that order to name the Discogs fields. */
function coverLines(data){
  const out = [];
  (data.blocks || []).forEach(b => (b.paragraphs || []).forEach(p =>
    (p.lines || []).forEach(l => {
      const t = tidyLine(l.text);
      if(!usableLine(t)) return;
      if((l.confidence || 0) < LINE_CONF_MIN) return;
      const box = l.bbox || {};
      out.push({t, h: (box.y1 - box.y0) || 0, y: box.y0 || 0});
    })));
  if(!out.length) return [];
  return out.sort((a, b) => b.h - a.h).slice(0, 2)
            .sort((a, b) => a.y - b.y).map(l => l.t);
}

/* Belt and braces: if a Tesseract build ever stops handing back blocks,
   fall back to the old longest-lines guess rather than reading nothing. */
function coverFallback(s){
  return String(s||'').split('\n').map(tidyLine).filter(usableLine)
    .sort((a, b) => b.length - a.length).slice(0, 2);
}

async function readNow(){
  if(ocrBusy || !stream) return;
  const tight = ocrKind === 'catno';
  const shot = grabFrame(tight);
  if(!shot){ toast('Camera is still warming up — give it a second'); return; }
  ocrBusy = true; spin(true);
  stopCam();                    /* one look, then close — same as a barcode hit */
  toast(window.Tesseract ? 'Reading…' : 'Fetching the text reader…', 3000);
  try{
    if(tight) boostContrast(shot);
    const w = await ocrReady();
    /* The two readers want opposite things, which is why they disagree.
       A whole sleeve is never one block — the type is scattered around
       the artwork in clumps — so the cover gets PSM 11, sparse text.
       The reticle crop genuinely is one tight block, so the cat. no.
       gets PSM 6. What it must not get is PSM 7, "a single text line":
       the moment the box also catches the label name or "SIDE A" the
       whole read collapses to junk, or to nothing at all. */
    await w.setParameters(tight
      ? {tessedit_char_whitelist:'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-/. ', tessedit_pageseg_mode:'6'}
      : {tessedit_char_whitelist:'', tessedit_pageseg_mode:'11'});
    const {data} = await w.recognize(shot);
    let text, parts = null;
    if(tight){
      text = catnoFrom(data);
    }else{
      parts = coverLines(data);
      if(!parts.length) parts = coverFallback(data.text);
      text = parts.join(' ').trim();
    }
    spin(false); ocrBusy = false;
    if(!text){ toast('Nothing legible there — more light, and fill the box', 4400); return; }
    confirmRead(text, Math.round(data.confidence || 0), parts);
  }catch(e){
    spin(false); ocrBusy = false;
    toast('The text reader needs an internet connection the first time', 4600);
  }
}

/* Text read off a photographed sleeve is never certain enough to
   search blind, so it proposes and you confirm. Cheap to do now that
   the camera closes after every read anyway. */
function confirmRead(text, conf, parts){
  const kind = ocrKind === 'catno' ? 'catalogue number' : 'cover';
  $('#sheetBody').innerHTML = `
    <h3 style="margin:0 0 4px">Read off the ${kind}</h3>
    <p class="hint" style="margin:0 0 12px">${conf}% sure. Fix it if it has come out wrong — then Discogs shows you every pressing that matches, same as a typed search.</p>
    <input type="text" id="ocrText" value="${esc(text)}" autocomplete="off" spellcheck="false">
    <div class="row" style="margin-top:12px">
      <button class="btn" id="ocrGo">Search Discogs</button>
      <button class="btn quiet" id="ocrAgain">Have another go</button>
    </div>`;
  $('#ocrGo').onclick = () => {
    const v = $('#ocrText').value.trim();
    closeSheet();
    if(!v) return;
    /* Only hand the split lines to Discogs if they are still what was
       read — once you have edited the box we no longer know which half
       is the artist, so it goes as free text, exactly as before. */
    const unedited = parts && parts.length === 2 && v === parts.join(' ').trim();
    searchAndChoose(v, unedited ? parts : null);
  };
  $('#ocrAgain').onclick = () => { closeSheet(); startCam('ocr'); };
  $('#scrim').classList.add('on'); $('#sheet').classList.add('on');
}

/* ══════════════════════════════════════════════════════════
   rendering
   ══════════════════════════════════════════════════════════ */
function hue(s){ let h=0; for(let i=0;i<s.length;i++) h = (h*31 + s.charCodeAt(i)) % 360; return h; }

function renderStrip(){
  const n = DB.items.length;
  const vals = DB.items.map(itemValue).filter(v => v!=null);
  const total = vals.reduce((a,b)=>a+b,0);
  const priced = vals.length;
  const html = `
    <div><b>${n}</b><small>records</small></div>
    <div><b>${sym()}${Math.round(total).toLocaleString()}</b><small>market low</small></div>
    <div><b>${priced?money(total/priced).replace(/\.00$/,''):'—'}</b><small>average</small></div>`;
  $('#strip').innerHTML = html; $('#strip2').innerHTML = html;
  $('#valueNote').innerHTML = priced
    ? `Based on the lowest current Discogs asking price for ${priced} of your ${n} records, adjusted for the condition you've graded each copy. It's a floor, not an appraisal — rare pressings with nothing for sale show no price at all.`
    : `No prices yet. Add your Discogs token in Setup and scan something.`;
}

/* ── the rail is the physical crate ─────────────────────────
   Always in shelf order and filtered to the shelf you're looking at,
   so a spine's position on screen is its position on the shelf — which
   is what makes dragging one mean anything. */
let crateEdit = false;

/* How many spines the rail will draw at once. */
const RAIL_MAX = 150;

function crateList(){
  const shelf = $('#shelfFilter') ? $('#shelfFilter').value : '';
  const all = DB.items
    .filter(i => !shelf || i.shelf === shelf)
    .sort((a,b) => shelfRank(a.shelf) - shelfRank(b.shelf) || bySlot(a,b)
                   || (a.added||'').localeCompare(b.added||''));
  if(all.length <= RAIL_MAX) return all;
  /* Always taking the FIRST 150 meant a record further down the crate had
     no spine at all, so opening it lit the shelf tile and gave its
     position but never popped the sleeve — there was nothing there to
     pop. With a record open the window slides to sit around it, which
     also keeps its real neighbours either side, which is the whole point
     of the rail. hereUid is only ever set while a sheet is open, so
     arranging and select-all still see the ordinary first-150 window. */
  let start = 0;
  if(hereUid){
    const at = all.findIndex(i => i.uid === hereUid);
    if(at >= 0) start = Math.min(Math.max(0, at - Math.floor(RAIL_MAX/2)), all.length - RAIL_MAX);
  }
  return all.slice(start, start + RAIL_MAX);
}

function updateCrateBar(){
  const shelf = $('#shelfFilter') ? $('#shelfFilter').value : '';
  /* Arranging no longer needs a single shelf picked. Reordering happens
     within each shelf's own run of spines, and dropping on a shelf tile
     moves the record — both work fine on the all-shelves view. */
  const btn = $('#btnCrateArrange');
  if(btn){
    btn.style.display = DB.shelves.length ? '' : 'none';
    btn.textContent = crateEdit ? 'done' : 'arrange records';
  }
  const sbar = $('#crateSelBar');
  if(sbar) sbar.style.display = crateEdit ? 'flex' : 'none';
  updateSelBars();
  const note = $('#crateNote');
  if(note) note.textContent = !crateEdit
    ? (shelf ? 'Flick through · shelf ' + shelf : 'Flick through')
    : selMode ? selNote()
    : picked ? 'Now tap where it goes, or a shelf to move it'
             : 'Tap a record to pick it up';
  $('#crate').classList.toggle('editing', crateEdit);
  paintSel();          /* which surface shows ticks follows the arrange flags */
}

function renderCrate(){
  const el = $('#crate');
  updateCrateBar();
  if(!DB.items.length){ el.innerHTML = '<div class="crate-empty">Empty crate. Go and scan something.</div>'; return; }
  el.innerHTML = crateList().map(it => {
    const h = hue(it.artist + it.label);
    return `<button class="spine" data-uid="${it.uid}"
      style="background:linear-gradient(90deg,hsl(${h} 34% 26%),hsl(${h} 30% 17%))"
      title="${esc(it.artist)} — ${esc(it.title)}">
      <span class="tab" style="background:hsl(${h} 60% 55% / .5)"></span>
      <span class="txt">${esc(it.artist)} · ${esc(it.title)}</span>
    </button>`;
  }).join('');
}

/* current filter settings, read once per render */
function filters(){
  const kf = $('#keyFilter').value;
  return {
    q: $('#q').value.trim().toLowerCase(),
    shelf: $('#shelfFilter').value,
    fmt: $('#fmtFilter').value,
    lo: parseFloat($('#bpmMin').value) || null,
    hi: parseFloat($('#bpmMax').value) || null,
    keys: kf ? ($('#harmonic').checked ? compatible(kf) : [kf]) : null,
    genre: $('#genreFilter') ? $('#genreFilter').value : '',
    sort: $('#sort').value,
    desc: isDesc()
  };
}
/* One toggle rather than a reversed twin of every option: nine sorts
   would have become eighteen in a dropdown you already have to scroll,
   and each new sort would need remembering twice. */
const isDesc = () => {
  const b = $('#sortDir');
  return !!b && b.getAttribute('aria-pressed') === 'true';
};
/* A record answers to a genre if its own Discogs genres carry it or any
   of its tracks does, so the filter is useful before every track has
   been typed up. */
function genreOk(it, f){
  if(!f.genre) return true;
  const g = f.genre.toLowerCase();
  return (it.genres || []).some(x => String(x).toLowerCase() === g)
      || (it.tracks || []).some(t => String(t.genre || '').toLowerCase() === g);
}
/* In the track list the question is narrower — this track, not its
   record. A track with nothing typed falls back to the release's
   genres, so untyped tracks still turn up under the right heading. */
function trackGenreOk(t, it, f){
  if(!f.genre) return true;
  const g = f.genre.toLowerCase();
  if(t.genre) return String(t.genre).toLowerCase() === g;
  return (it.genres || []).some(x => String(x).toLowerCase() === g);
}
const bpmOk = (t,f) => !(f.lo || f.hi) ? true
  : (t.bpm > 0 && (!f.lo || t.bpm >= f.lo) && (!f.hi || t.bpm <= f.hi));
const keyOk = (t,f) => !f.keys ? true : f.keys.includes(t.key);
function relOk(it,f){
  if(f.shelf && it.shelf !== f.shelf) return false;
  if(f.fmt && !(it.format||'').toLowerCase().includes(f.fmt.toLowerCase())) return false;
  if(!genreOk(it,f)) return false;
  if(f.q && ![it.artist,it.title,it.label,it.catno,it.barcode,(it.genres||[]).join(' '),
              (it.tracks||[]).map(t=>t.genre).join(' ')]
       .join(' ').toLowerCase().includes(f.q)) return false;
  return true;
}

/* ── your own order within a shelf ──────────────────────────
   `slot` is a record's place on its shelf, 1-based, matching the
   PositionInShelf column collection apps export. Anything without one
   sorts to the end rather than jumping to the front. */
const slotOf = it => (typeof it.slot === 'number' && isFinite(it.slot)) ? it.slot : Infinity;
const bySlot = (a,b) => { const x = slotOf(a), y = slotOf(b); return x === y ? 0 : x - y; };
const shelfRank = s => { const i = DB.shelves.indexOf(s); return i < 0 ? 1e6 : i; };
function nextSlot(shelf){
  let max = 0;
  DB.items.forEach(i => { if(i.shelf === shelf && slotOf(i) !== Infinity && i.slot > max) max = i.slot; });
  return max + 1;
}
const renumber = ordered => ordered.forEach((it, i) => { it.slot = i + 1; });

/* ── where new records land ─────────────────────────────────
   Every way of adding a record — camera, Find, OCR, by hand —
   files it the same way, set once on the Scan view rather than
   asked per record, which would make scanning a shelf a chore.
   Kept on DB so it survives a reload and rides along in a
   backup; deliberately not synced, since which crate you are
   filling is a thing about the device in your hand.
   The CSV import is exempt: it carries its own Shelf column. */
function fileShelf(){
  const s = DB.fileTo && DB.fileTo.shelf;
  return DB.shelves.includes(s) ? s : (DB.shelves[0] || 'Main');
}
const fileAtStart = () => !!(DB.fileTo && DB.fileTo.at === 'start');

/* Filing at the front means everything already on that shelf shifts
   down one, so the whole shelf is renumbered dense 1..n afterwards —
   the same guarantee arranging by hand gives. */
function fileNew(it){
  const shelf = fileShelf();
  it.shelf = shelf;
  if(fileAtStart()){
    it.slot = 0;                      /* sorts ahead of slot 1 */
    DB.items.unshift(it);
    renumber(DB.items.filter(i => i.shelf === shelf).sort(bySlot));
  }else{
    it.slot = nextSlot(shelf);
    DB.items.unshift(it);
  }
  return it;
}

/* Renumber from what's actually on screen, one shelf at a time. On the
   all-shelves view the list spans several shelves, so each is numbered
   from the order its own records appear in — a record never picks up a
   slot belonging to a different shelf. */
function renumberFromDom(nodes){
  const before = placement();          /* only ever called after a drag moved something */
  const byShelf = {};
  nodes.forEach(n => {
    const it = DB.items.find(i => i.uid === n.dataset.uid);
    if(!it) return;
    (byShelf[it.shelf] = byShelf[it.shelf] || []).push(it);
  });
  Object.keys(byShelf).forEach(s => renumber(byShelf[s]));
  pushUndo(before);
}

/* ── dropping a record onto a shelf tile ────────────────────
   While a record is being dragged the shelf tiles act as targets, so
   you can flick one out of the shelf you're in and onto another. The
   dragged element sits under the pointer, so elementFromPoint is no
   use here — hit-test the tiles' rectangles directly. */
function shelfTileUnder(x, y){
  const grid = $('#shelfGrid');
  if(!grid) return null;
  const pad = 10;                                    /* a little slack for fingers */
  return [...grid.children].find(t => {
    if(!t.classList || !t.classList.contains('shelfTile')) return false;
    const r = t.getBoundingClientRect();
    if(!r.width) return false;                       /* not on screen */
    return x >= r.left - pad && x <= r.right + pad
        && y >= r.top  - pad && y <= r.bottom + pad;
  }) || null;
}

/* Keep scrolling the page while a record is held near the top or bottom
   of the screen — the shelf tiles are usually above the fold once you've
   scrolled down to the rail, and without this you can't reach them. The
   hit test re-runs on each tick, since the tiles move as the page does. */
const dragScroll = (() => {
  let timer = null, dir = 0, x = 0, y = 0, tick = null;
  const stop = () => { if(timer){ clearInterval(timer); timer = null; } dir = 0; };
  return {
    stop,
    update(cx, cy, onTick){
      x = cx; y = cy; tick = onTick;
      const d = cy < 110 ? -1 : cy > window.innerHeight - 110 ? 1 : 0;
      if(d !== dir) stop();
      dir = d;
      if(!d || timer) return;
      timer = setInterval(() => {
        window.scrollBy(0, dir * 16);
        if(tick) tick(x, y);
      }, 16);
    }
  };
})();
function markShelfTarget(tile){
  const grid = $('#shelfGrid');
  if(!grid) return;
  [...grid.children].forEach(t => t.classList &&
    t.classList.toggle('droptarget', t === tile));
}
/* keep the page moving when the tiles are off the top of the screen */
function edgeScroll(y){
  if(y < 90) window.scrollBy(0, -18);
  else if(y > window.innerHeight - 90) window.scrollBy(0, 18);
}
/* ── undo, for arranging ────────────────────────────────────
   A bulk move can shift forty records on one tap, and "which shelf were
   they on before?" is not a question the app could answer afterwards.
   So every arranging action snapshots where things sat first — uid, shelf
   and slot, which is all any of them touch — and putting it back is just
   restoring that map.

   The snapshot is taken inside the five functions that actually move
   records, not at the eight places that call them: a new way of moving a
   record then gets undo for free, and no call site can forget.

   In memory only. This is a way out of a fat-fingered tap, not a document
   history, so it deliberately does not survive a reload. */
const UNDO_MAX = 20;
const undoStack = [];
const placement = () => DB.items.map(i => ({uid: i.uid, shelf: i.shelf, slot: i.slot}));
function pushUndo(before){
  undoStack.push(before);
  if(undoStack.length > UNDO_MAX) undoStack.shift();
  updateSelBars();
}
function undoLast(){
  const before = undoStack.pop();
  if(!before) return toast('Nothing to undo');
  const was = new Map(before.map(p => [p.uid, p]));
  let n = 0;
  DB.items.forEach(i => {
    const p = was.get(i.uid);
    if(!p) return;                       /* added since the snapshot — leave it alone */
    if(i.shelf !== p.shelf || i.slot !== p.slot){ i.shelf = p.shelf; i.slot = p.slot; n++; }
  });
  /* A record added since the snapshot kept its own slot, which can now
     collide with a restored one, so every shelf is renumbered dense again —
     the same guarantee arranging by hand gives. */
  DB.shelves.forEach(s => renumber(DB.items.filter(i => i.shelf === s).sort(bySlot)));
  ticked.clear(); selPlacing = false;
  setPicked(null);
  save(); renderAll();
  toast(n ? 'Put back — ' + n + (n === 1 ? ' record' : ' records') : 'Nothing to put back', 3000);
}

/* ── file a whole shelf into tempo order ────────────────────
   Average BPM across the record's tracks, not the fastest or the first:
   a 12" with a 118 side and a 124 side belongs between them rather than
   at either end. Ties break on key, so records that would mix together
   end up next to each other. Anything with no BPM at all goes to the
   back — those are the ones still to be measured, and burying them in
   the middle would hide the work left to do.

   The snapshot is taken here, inside the mover, for the same reason the
   other five do it: undo covers a new way of moving records for free and
   no call site can forget. Pushed after the mutation, so a shelf too
   small to sort leaves no dead step on the stack. */
function sortShelfByTempo(name){
  const on = DB.items.filter(x => x.shelf === name);
  if(on.length < 2) return 0;
  const before = placement();
  /* Coerced, never read straight off the record: a CSV import or an old
     hand-added entry can reach here with no artist at all, and an
     undefined.localeCompare throws inside the comparator — which kills
     the sort silently, leaving the shelf untouched and no error on
     screen. That is exactly what it looks like when nothing happens. */
  const byName = (a, b) =>
    String(a.artist || '').localeCompare(String(b.artist || '')) ||
    String(a.title  || '').localeCompare(String(b.title  || ''));
  on.sort((a, b) => {
    const ba = relBpm(a), bb = relBpm(b);
    if(ba == null && bb == null)
      return keyRank(relKey(a)) - keyRank(relKey(b)) || byName(a, b);
    if(ba == null) return 1;
    if(bb == null) return -1;
    return ba - bb || keyRank(relKey(a)) - keyRank(relKey(b)) || byName(a, b);
  });
  renumber(on);
  pushUndo(before);
  save(); renderAll();
  return on.length;
}

/* ── tap to pick up, tap to place ───────────────────────────
   Dragging a 26px spine along a rail that can't scroll is miserable on
   a phone and fiddly with a mouse, so this is the main way to move a
   record: tap it to lift it, then tap where it should go. Nothing is
   captured between the two taps, so you can scroll and change shelf
   freely in between. Dragging still works with a mouse. */
let picked = null;              /* uid of the lifted record */
let justDragged = 0;            /* so a drag's click isn't read as a tap */

/* re-apply after any render, since the markup is rebuilt from scratch */
function paintPicked(){
  document.querySelectorAll('.picked').forEach(n => n.classList.remove('picked'));
  if(!picked) return;
  document.querySelectorAll('.rec[data-uid], .spine[data-uid]').forEach(n => {
    if(n.dataset.uid === picked) n.classList.add('picked');
  });
}
function setPicked(uid){
  picked = uid || null;
  paintPicked();
  updateCrateBar(); updateArrangeBar();
}

/* drop the lifted record into the slot just before `targetUid`, moving
   it between shelves if the target sits on a different one */
function placeBefore(targetUid){
  const a = DB.items.find(i => i.uid === picked);
  const b = DB.items.find(i => i.uid === targetUid);
  if(!a || !b || a === b) return false;
  const before = placement();
  const from = a.shelf;
  a.shelf = b.shelf;
  const list = DB.items.filter(i => i.shelf === b.shelf && i.uid !== a.uid).sort(bySlot);
  const at = list.findIndex(i => i.uid === b.uid);
  list.splice(at < 0 ? list.length : at, 0, a);
  renumber(list);
  if(from !== a.shelf) renumber(DB.items.filter(i => i.shelf === from).sort(bySlot));
  pushUndo(before);
  return true;
}

/* ── moving several at once ─────────────────────────────────
   One at a time is fine for tidying, but re-filing a run of records —
   everything a shelf has outgrown, or every record a search turned up —
   meant the same two taps forty times over. Selecting is a mode inside
   arranging rather than a third top-level state: taps tick instead of
   lifting, and the same targets then do the same things to the whole
   set. `ticked` holds uids, so it survives every re-render — and it is not
   called `sel`, because the shelf-tile handler already has a local of that
   name and the shadowing put this one in the temporal dead zone. */
let selMode = false;
const ticked = new Set();
let selPlacing = false;         /* armed: the next tap says where the set goes */

/* Always act in shelf order, never the order things were ticked in, so a
   block of records keeps the arrangement it already had wherever it lands. */
function selItems(){
  return DB.items.filter(i => ticked.has(i.uid))
    .sort((a,b) => shelfRank(a.shelf) - shelfRank(b.shelf) || bySlot(a,b));
}
/* ── which crate the open record is in ──────────────────────
   Repainted after every render for the same reason picked and ticked
   are: the tiles are rebuilt from scratch each time, so a class set
   once would not survive the next save. */
let hereUid = null;
function paintHere(){
  document.querySelectorAll('.here').forEach(n => n.classList.remove('here','hasart'));
  document.querySelectorAll('#crate .pop').forEach(n => n.remove());
  if(!hereUid) return;
  const it = DB.items.find(x => x.uid === hereUid);
  if(!it) return;
  document.querySelectorAll('.shelfTile[data-shelf-name]').forEach(n => {
    if(n.dataset.shelfName === it.shelf) n.classList.add('here');
  });
  /* The sleeve is hung on the one spine that needs it rather than
     rendered into all 150 the rail can hold — one image, not a crate
     full of them. Removed again above whenever the record changes. */
  const sp = document.querySelector('#crate .spine[data-uid="' + CSS.escape(hereUid) + '"]');
  if(!sp) return;
  sp.classList.add('here');
  if(it.art){
    const img = document.createElement('img');
    img.className = 'pop'; img.alt = ''; img.src = it.art;
    sp.appendChild(img);
    sp.classList.add('hasart');
  }
}
/* The sheet covers the bottom of the screen, so lighting up a tile that
   is scrolled off is no help. Only scroll when the record has actually
   changed, or re-rendering the sheet after a grade edit would yank the
   page about under your thumb. */
function showHere(uid){
  const changed = hereUid !== uid;
  hereUid = uid;
  /* The rail is drawn before this runs, so it was built by crateList()
     while hereUid was still null — the window could not have included
     this record yet. If there is no spine for it, rebuild the rail now
     that crateList() knows what to centre on. */
  if(uid && !document.querySelector('#crate .spine[data-uid="' + CSS.escape(uid) + '"]')) renderCrate();
  paintHere();
  if(!changed) return;
  /* Bring the popped record into the rail's view. block:'nearest' so
     scrolling the rail sideways doesn't also jerk the page up or down. */
  const sp = document.querySelector('#crate .spine.here');
  if(sp) sp.scrollIntoView({inline:'center', block:'nearest', behavior:'smooth'});
  const tile = document.querySelector('.shelfTile.here');
  if(!tile) return;
  const r = tile.getBoundingClientRect();
  if(!r.height) return;                /* Crate view isn't the one on screen */
  if(r.top < 56 || r.bottom > window.innerHeight * 0.45)
    tile.scrollIntoView({block:'center', behavior:'smooth'});
}

/* The set is shared, but each surface only shows a tick where a tap would
   actually land on one: outside its own arrange mode a tap opens the
   record, so a green outline there would be a lie. */
function paintSel(){
  document.querySelectorAll('.rec.sel, .spine.sel').forEach(n => n.classList.remove('sel'));
  if(!selMode || !ticked.size) return;
  const where = [recEdit && '.rec[data-uid]', crateEdit && '.spine[data-uid]'].filter(Boolean);
  if(!where.length) return;
  document.querySelectorAll(where.join(',')).forEach(n => {
    if(ticked.has(n.dataset.uid)) n.classList.add('sel');
  });
}
function selNote(){
  /* This sits in an eyebrow that ellipsises on a phone, so the count goes
     first — it is the part you check before tapping a shelf. */
  if(!ticked.size) return 'Tap records to tick them';
  const n = ticked.size + ' ticked';
  return selPlacing ? n + ' · tap where they go' : n + ' · tap a shelf';
}
/* The whole selection story lives in its own row under the arrange bar,
   not beside it: the header's eyebrow ellipsises on a phone, and a second
   button up there left no room for the count you tap a shelf on. */
function updateSelBars(){
  /* how many steps are left is worth showing — it is the difference between
     "I can back out of this" and "I have gone too far to bother" */
  document.querySelectorAll('[data-undo]').forEach(b => {
    b.disabled = !undoStack.length;
    b.textContent = undoStack.length > 1 ? 'undo · ' + undoStack.length : 'undo';
  });
  document.querySelectorAll('[data-sel-when]').forEach(b => b.style.display = selMode ? '' : 'none');
  document.querySelectorAll('#btnCrateSelect, #btnSelect').forEach(b =>
    b.textContent = selMode ? 'one at a time' : 'select several');
  document.querySelectorAll('[data-sel-place]').forEach(b => {
    b.textContent = selPlacing ? 'never mind' : 'place them';
    b.disabled = !ticked.size;
  });
  document.querySelectorAll('[data-sel-none]').forEach(b => b.disabled = !ticked.size);
}
function repaintSel(){ paintSel(); updateCrateBar(); updateArrangeBar(); }
function exitSel(){ selMode = false; ticked.clear(); selPlacing = false; renderList(); }

/* Drop a whole set on a shelf, at the back, keeping the order it was
   already in. Any of the set already sitting on that shelf is gathered up
   with the rest rather than left where it was, so the set always ends up
   together — half of it staying put is never what you meant. */
function moveManyToShelf(items, shelfName){
  if(!items.length || !DB.shelves.includes(shelfName)) return 0;
  const before = placement();
  const uids = new Set(items.map(i => i.uid));
  const froms = [...new Set(items.map(i => i.shelf))].filter(s => s !== shelfName);
  const rest = DB.items.filter(i => i.shelf === shelfName && !uids.has(i.uid)).sort(bySlot);
  items.forEach(i => i.shelf = shelfName);
  renumber(rest.concat(items));
  froms.forEach(s => renumber(DB.items.filter(i => i.shelf === s).sort(bySlot)));
  pushUndo(before);
  return items.length;
}

/* Slot the whole set in just before `targetUid`, wherever that record sits —
   the multi-record version of placeBefore. The target can't be inside the
   set: there'd be nowhere to put the rest relative to it. */
function placeManyBefore(items, targetUid){
  const uids = new Set(items.map(i => i.uid));
  const t = DB.items.find(i => i.uid === targetUid);
  if(!items.length || !t || uids.has(targetUid)) return false;
  const before = placement();
  const shelf = t.shelf;
  const froms = [...new Set(items.map(i => i.shelf))].filter(s => s !== shelf);
  const rest = DB.items.filter(i => i.shelf === shelf && !uids.has(i.uid)).sort(bySlot);
  const at = rest.findIndex(i => i.uid === targetUid);
  items.forEach(i => i.shelf = shelf);
  rest.splice(at < 0 ? rest.length : at, 0, ...items);
  renumber(rest);
  froms.forEach(s => renumber(DB.items.filter(i => i.shelf === s).sort(bySlot)));
  pushUndo(before);
  return true;
}

/* Both bulk actions end the same way. The ticks are dropped afterwards —
   forty records left ticked is an accidental second move waiting to
   happen — but select mode stays on, ready for the next batch. */
function afterBulk(n, where){
  ticked.clear(); selPlacing = false;
  save(); renderAll();
  toast(n + (n === 1 ? ' record' : ' records') + ' moved to shelf ' + where, 3400);
}

/* one tap on a record, in arrange mode: lift it, or place the lifted one */
function tapRecord(uid){
  if(!uid) return;
  if(selMode){
    if(selPlacing){
      const items = selItems();
      if(!placeManyBefore(items, uid))
        return toast('That one is in the set — tap a record outside it');
      afterBulk(items.length, items[0].shelf);
      return;
    }
    if(ticked.has(uid)) ticked.delete(uid); else ticked.add(uid);
    repaintSel();
    return;
  }
  if(!picked){ setPicked(uid); return; }
  if(picked === uid){ setPicked(null); toast('Put back'); return; }
  if(placeBefore(uid)){
    const done = picked;
    setPicked(null);
    save(); renderAll();
    const it = DB.items.find(i => i.uid === done);
    toast('Moved to shelf ' + it.shelf + ', position ' + it.slot, 3000);
  }
}

function moveToShelf(item, shelfName){
  if(!item || !shelfName || shelfName === item.shelf) return false;
  const before = placement();
  const from = item.shelf;
  item.shelf = shelfName;
  /* Clear the slot rather than asking nextSlot for one: the record is
     already on the new shelf by now, so it would count itself and its
     stale number, pushing every move one slot further out. Unplaced
     sorts to the end, then both shelves get renumbered 1..n. */
  item.slot = null;
  renumber(DB.items.filter(i => i.shelf === shelfName).sort(bySlot));
  renumber(DB.items.filter(i => i.shelf === from).sort(bySlot));
  pushUndo(before);
  return true;
}

/* sleeve view — a release survives if any of its tracks passes BPM/key */
function visible(){
  const f = filters();
  const list = DB.items.filter(it => {
    if(!relOk(it,f)) return false;
    if(!f.keys && !f.lo && !f.hi) return true;
    return (it.tracks||[]).some(t => bpmOk(t,f) && keyOk(t,f));
  });
  const cmp = {
    shelf:(a,b)=> shelfRank(a.shelf) - shelfRank(b.shelf) || bySlot(a,b)
                  || (a.added||'').localeCompare(b.added||''),
    added:(a,b)=> (b.added||'').localeCompare(a.added||''),
    artist:(a,b)=> a.artist.localeCompare(b.artist) || (a.year+'').localeCompare(b.year+''),
    year:(a,b)=> (b.year||0) - (a.year||0),
    value:(a,b)=> (itemValue(b)??-1) - (itemValue(a)??-1),
    /* Blanks are pushed to the end explicitly rather than with a '~'
       sentinel: localeCompare puts punctuation BEFORE letters, so '~'
       sorts an unlabelled record to the TOP, which is the opposite of what
       it looks like it is doing. Artist is coerced too — a CSV import can
       arrive without one, and undefined.localeCompare throws inside a
       comparator. Same shape as genre and track below. */
    label:(a,b)=>{
      const la = String(a.label||'').trim(), lb = String(b.label||'').trim();
      if(!la !== !lb) return la ? -1 : 1;
      return la.localeCompare(lb) || String(a.artist||'').localeCompare(String(b.artist||''));
    },
    genre:(a,b)=>{
      const ga = relGenre(a), gb = relGenre(b);
      if(!ga !== !gb) return ga ? -1 : 1;
      return ga.localeCompare(gb) || String(a.artist||'').localeCompare(String(b.artist||''));
    },
    /* The sleeve's own title here, not a track's. You are looking at a
       wall of covers: ordering them by a name printed inside one of them
       is invisible from the outside. The track list uses track titles. */
    track:(a,b)=>{
      const ta = String(a.title||'').trim(), tb = String(b.title||'').trim();
      if(!ta !== !tb) return ta ? -1 : 1;
      return ta.localeCompare(tb) || String(a.artist||'').localeCompare(String(b.artist||''));
    },
    bpm:(a,b)=> (relBpm(a)??1e9) - (relBpm(b)??1e9),
    keybpm:(a,b)=> keyRank(relKey(a)) - keyRank(relKey(b)) || (relBpm(a)??1e9) - (relBpm(b)??1e9),
    bpmkey:(a,b)=> (relBpm(a)??1e9) - (relBpm(b)??1e9) || keyRank(relKey(a)) - keyRank(relKey(b))
  }[f.sort];
  /* Negating the chosen comparator rather than writing a reversed twin of
     each one: a new sort added later gets its opposite for nothing. */
  return list.sort(f.desc ? (a,b) => -cmp(a,b) : cmp);
}

/* track view — the flat list a DJ actually reads */
function visibleTracks(){
  const f = filters();
  let rows = allTracks().filter(({t,it}) => {
    if(!relOk(it,f)){
      if(!f.q) return false;
      if(!`${t.title} ${t.artist}`.toLowerCase().includes(f.q)) return false;
    }
    return bpmOk(t,f) && keyOk(t,f) && trackGenreOk(t,it,f);
  });
  const cmp = {
    shelf:(a,b)=> shelfRank(a.it.shelf) - shelfRank(b.it.shelf) || bySlot(a.it,b.it) || a.i - b.i,
    added:(a,b)=> (b.it.added||'').localeCompare(a.it.added||''),
    artist:(a,b)=> a.it.artist.localeCompare(b.it.artist) || a.i - b.i,
    year:(a,b)=> (b.it.year||0) - (a.it.year||0),
    value:(a,b)=> (itemValue(b.it)??-1) - (itemValue(a.it)??-1),
    /* Blanks last, for the same localeCompare reason as the sleeve view. */
    label:(a,b)=>{
      const la = String(a.it.label||'').trim(), lb = String(b.it.label||'').trim();
      if(!la !== !lb) return la ? -1 : 1;
      return la.localeCompare(lb)
             || String(a.it.artist||'').localeCompare(String(b.it.artist||'')) || a.i - b.i;
    },
    /* The track's own genre here, not the record's — the track list is
       the surface where one side being Dub and the other Disco matters.
       Blanks last, for the same localeCompare reason as the sleeve view. */
    genre:(a,b)=>{
      const ga = trackGenre(a.t,a.it), gb = trackGenre(b.t,b.it);
      if(!ga !== !gb) return ga ? -1 : 1;
      return ga.localeCompare(gb)
             || String(a.it.artist||'').localeCompare(String(b.it.artist||'')) || a.i - b.i;
    },
    /* The track's own title here — this is the surface where you are
       actually hunting for a tune by name. */
    track:(a,b)=>{
      const ta = String(a.t.title||'').trim(), tb = String(b.t.title||'').trim();
      if(!ta !== !tb) return ta ? -1 : 1;
      return ta.localeCompare(tb)
             || String(a.it.artist||'').localeCompare(String(b.it.artist||''));
    },
    bpm:(a,b)=> (a.t.bpm||1e9) - (b.t.bpm||1e9),
    keybpm:(a,b)=> keyRank(a.t.key) - keyRank(b.t.key) || (a.t.bpm||1e9) - (b.t.bpm||1e9),
    bpmkey:(a,b)=> (a.t.bpm||1e9) - (b.t.bpm||1e9) || keyRank(a.t.key) - keyRank(b.t.key)
  }[f.sort];
  return {rows: rows.sort(f.desc ? (a,b) => -cmp(a,b) : cmp), sort: f.sort};
}

function renderTracks(){
  const {rows, sort} = visibleTracks();
  const el = $('#tlist');
  if(!rows.length){
    el.innerHTML = `<div class="hint" style="padding:26px 0;text-align:center">${
      allTracks().length ? 'No tracks match those filters.'
      : 'No tracklists yet. Open a record and add tracks, or scan one so Discogs fills them in.'}</div>`;
    return;
  }
  let html = '', lastKey = null;
  const grouped = sort === 'keybpm';
  const codes = shelfCodes();          /* once per render, not once per row */
  rows.forEach(({t,i,it}) => {
    if(grouped && t.key !== lastKey){
      lastKey = t.key;
      html += `<div class="keyhead"><b>${t.key || 'NO KEY'}</b><span>${t.key?KEYNAME[t.key]:'not set yet'}</span></div>`;
    }
    html += `<button class="trow" data-uid="${it.uid}">
      ${it.art?`<img class="art" src="${esc(it.art)}" alt="" loading="lazy">`:'<span class="art"></span>'}
      <span class="who">
        <b>${esc(t.title || 'Untitled')}</b>
        <span><i class="loc">${esc(locCode(it, codes))}</i> · ${esc(t.artist || it.artist)} · ${esc(it.title)}${t.pos?' · '+esc(t.pos):''}</span>
      </span>
      <span class="num">
        <span class="bpmv">${t.bpm ? t.bpm : '<small>—</small>'}</span>
        ${keyBadge(t.key)}
      </span>
    </button>`;
  });
  el.innerHTML = html;
}

function renderGrid(){
  const list = visible();
  const counts = {}; DB.items.forEach(i => counts[i.id] = (counts[i.id]||0)+1);
  const el = $('#grid');
  if(!list.length){
    el.innerHTML = `<div class="hint" style="grid-column:1/-1;padding:26px 0;text-align:center">${DB.items.length?'Nothing matches that.':'Your crate is empty. Scan a sleeve to start.'}</div>`;
    return;
  }
  el.innerHTML = list.map(it => {
    const v = itemValue(it);
    return `<button class="rec" data-uid="${it.uid}">
      <div class="sleeve">
        ${it.art ? `<img loading="lazy" src="${esc(it.art)}" alt="">`
                 : `<div class="noart">${esc(it.catno || 'no image')}</div>`}
        ${counts[it.id] > 1 ? '<span class="dupe">DUPE</span>' : ''}
        ${v!=null ? `<span class="tagsticker">${sym()}${v<10?v.toFixed(2):Math.round(v)}</span>` : ''}
      </div>
      <h4>${esc(it.title)}</h4>
      <p>${esc(it.artist)}</p>
      <p>${esc([it.label, it.year].filter(Boolean).join(' · '))}</p>
    </button>`;
  }).join('');
}

/* ── shelves as separate crates ─────────────────────────────
   One tile per shelf, its spines drawn from the records sitting on
   it. Tapping a tile filters the collection to that shelf; tapping
   the same one again clears it. "Rearrange" turns on drag-to-reorder,
   and DB.shelves order is what the filter and the sheet's shelf
   picker read, so moving a tile moves it everywhere. */
let shelfEdit = false;

function renderShelfGrid(){
  const el = $('#shelfGrid');
  if(!el) return;
  const active = $('#shelfFilter').value;
  el.classList.toggle('editing', shelfEdit);

  if(!DB.shelves.length){
    el.innerHTML = '<div class="hint">No shelves yet.</div>';
    return;
  }
  el.innerHTML = DB.shelves.map((s, i) => {
    const items = DB.items.filter(x => x.shelf === s);
    /* 18 spines is all that stays legible at this tile size */
    const bars = items.slice(0, 18).map(it => {
      const h = hue(it.artist + it.label);
      return `<i style="background:linear-gradient(180deg,hsl(${h} 36% 32%),hsl(${h} 30% 16%))"></i>`;
    }).join('');
    return `<div class="shelfTile${items.length ? '' : ' empty'}${s === active ? ' on' : ''}"
        data-i="${i}" data-shelf-name="${esc(s)}">
      <div class="art">
        <div class="spines">${bars}</div>
        <div class="count"><b>${items.length}</b></div>
      </div>
      <div class="name">${esc(s)}</div>
    </div>`;
  }).join('');
  paintHere();
}

function renderFilters(){
  const sh = $('#shelfFilter'), keepS = sh.value;
  sh.innerHTML = '<option value="">All shelves</option>' + DB.shelves.map(s=>`<option>${esc(s)}</option>`).join('');
  sh.value = keepS;
  const fmts = [...new Set(DB.items.map(i => (i.format||'').split(',')[0].trim().split(' ')[0]).filter(Boolean))].sort();
  const ff = $('#fmtFilter'), keepF = ff.value;
  ff.innerHTML = '<option value="">All formats</option>' + fmts.map(f=>`<option>${esc(f)}</option>`).join('');
  ff.value = keepF;
  /* Same derived list the track dropdown reads, so filtering can only
     ever offer a genre something is actually filed under. */
  const gf = $('#genreFilter');
  if(gf){
    const keepG = gf.value;
    gf.innerHTML = '<option value="">All genres</option>' +
      genreList().map(g=>`<option>${esc(g)}</option>`).join('');
    gf.value = keepG;
  }
  const kf = $('#keyFilter'), keepK = kf.value, tally = {};
  allTracks().forEach(({t}) => { if(t.key) tally[t.key] = (tally[t.key]||0)+1; });
  kf.innerHTML = '<option value="">Any key</option>' + CAMELOT.map(k =>
    `<option value="${k}">${k} · ${KEYNAME[k]}${tally[k]?' ('+tally[k]+')':''}</option>`).join('');
  kf.value = keepK;
  const fs = $('#fileShelf');
  if(fs){
    fs.innerHTML = DB.shelves.map(s=>`<option>${esc(s)}</option>`).join('');
    fs.value = fileShelf();                 /* falls back if the shelf has gone */
    $('#fileAt').value = fileAtStart() ? 'start' : 'end';
  }
  $('#shelfList').innerHTML = DB.shelves.map((s,i)=>
    `<div class="q"><div class="code">${esc(s)}</div>
     <div class="st">${DB.items.filter(x=>x.shelf===s).length} records</div>
     <button class="ghost" data-shelf-tempo="${i}" style="margin-left:10px">tempo order</button>
     <button class="ghost" data-shelf-rename="${i}" style="margin-left:6px">rename</button>
     ${DB.shelves.length>1?`<button class="ghost" data-shelf-remove="${i}" style="margin-left:6px">remove</button>`:''}</div>`).join('');
}

function bars(map, host, fmt = v=>v){
  const rows = Object.entries(map).sort((a,b)=>b[1]-a[1]).slice(0,8);
  const max = rows.length ? rows[0][1] : 1;
  $(host).innerHTML = rows.length ? rows.map(([k,v]) =>
    `<div class="bar"><div class="lab"><span>${esc(k)}</span><span>${fmt(v)}</span></div>
     <div class="track"><div class="fill" style="width:${Math.max(3,v/max*100)}%"></div></div></div>`).join('')
    : '<div class="hint">Not enough data yet.</div>';
}

function renderStats(){
  const dec={}, lab={}, sty={};
  DB.items.forEach(i=>{
    if(i.year) dec[(Math.floor(i.year/10)*10)+'s'] = (dec[(Math.floor(i.year/10)*10)+'s']||0)+1;
    if(i.label) lab[i.label] = (lab[i.label]||0)+1;
    (i.genres||[]).forEach(g => sty[g] = (sty[g]||0)+1);
  });
  bars(dec,'#byDecade'); bars(lab,'#byLabel'); bars(sty,'#byStyle');
  const top = DB.items.filter(i=>itemValue(i)!=null).sort((a,b)=>itemValue(b)-itemValue(a)).slice(0,8);
  $('#topValue').innerHTML = top.length ? top.map(i=>
    `<div class="q"><div style="min-width:0">
      <div class="code" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:58vw">${esc(i.title)}</div>
      <div style="font-size:11.5px;color:var(--dust)">${esc(i.artist)}</div></div>
     <div class="st" style="color:var(--sticker)">${money(itemValue(i))}</div></div>`).join('')
    : '<div class="hint">Nothing priced yet.</div>';
}

let MODE = 'sleeves';
let recEdit = false;

/* Rearranging only makes sense on one shelf at a time in the sleeve
   view sorted by shelf order — anywhere else a dragged record would
   just spring back to wherever the current sort puts it. */
function updateArrangeBar(){
  const bar = $('#arrangeBar');
  if(!bar) return;
  /* Reversed counts as a different sort here. renumberFromDom writes new
     slots straight from the on-screen order, so arranging a back-to-front
     grid would quietly turn the whole shelf round. */
  const usable = MODE === 'sleeves' && $('#sort').value === 'shelf' && !isDesc();
  bar.style.display = usable ? '' : 'none';
  const shelf = $('#shelfFilter').value;
  /* Sorting by anything else drops you out of arranging. Selecting goes
     with it, unless the rail is still arranging and can carry the set. */
  if(!usable){
    recEdit = false;
    if(!crateEdit && selMode){ selMode = false; ticked.clear(); selPlacing = false; }
  }
  $('#btnArrange').style.display = DB.shelves.length ? '' : 'none';
  $('#btnArrange').textContent = recEdit ? 'done' : 'arrange records';
  $('#gridSelBar').style.display = recEdit ? 'flex' : 'none';
  updateSelBars();
  $('#arrangeNote').textContent = !recEdit
    ? (shelf ? 'Shelf ' + shelf : 'Your order')
    : selMode ? selNote()
    : picked ? 'Now tap where it goes, or a shelf to move it'
             : 'Tap a record to pick it up';
  $('#grid').classList.toggle('editing', recEdit);
  paintSel();          /* which surface shows ticks follows the arrange flags */
}

function renderList(){
  $('#grid').style.display  = MODE==='sleeves' ? '' : 'none';
  $('#tlist').style.display = MODE==='tracks'  ? '' : 'none';
  renderCrate();
  updateArrangeBar();
  if(MODE==='sleeves') renderGrid(); else renderTracks();
  paintPicked();
  paintSel();
  /* Must be here, not only in renderShelfGrid: that runs BEFORE
     renderCrate rebuilds the rail from scratch, so the open record's
     spine lost its lift and its sleeve on every redraw — a grade edit,
     a note, a BPM — while the shelf tile stayed lit, because the tiles
     were not rebuilt. Same reason picked and ticked are repainted here. */
  paintHere();
}
/* renderShelfGrid and the rail both read the shelf filter, so they follow
   renderFilters. renderList draws the rail too, so changing the shelf
   filter reorders the spines as well as the grid. */
function renderAll(){ renderStrip(); renderFilters(); renderShelfGrid(); renderList(); renderStats(); }

/* ── where is it? ───────────────────────────────────────────
   Tapping a track in the list used to do nothing at all. It now answers
   the only question worth asking of a track you have just found: where
   do I go and pull the record.

   The two neighbours matter more than the number. If the crate has
   drifted a place or two — and it will, until the rack matches the app —
   you still find it by the sleeves either side, which a bare "23rd"
   cannot do. Position is counted from the sorted shelf rather than read
   off item.slot, so a stale number can never outlive the order it
   describes. */
/* Shared by the locator popup and the record sheet, so the two can never
   drift apart about where a record actually sits. */
function locatorHtml(it){
  const on = DB.items.filter(x => x.shelf === it.shelf).sort(bySlot);
  const n = on.length;
  const pos = Math.max(1, on.findIndex(x => x.uid === it.uid) + 1);
  const pct = n ? ((pos - 0.5) / n) * 100 : 50;
  const prev = on[pos - 2], next = on[pos];
  const gone = !DB.shelves.includes(it.shelf);
  const who = q => esc(q.artist) + ' — ' + esc(q.title);
  return `
    <div class="chips">
      <span class="chip" style="color:var(--sticker);border-color:var(--sticker)">${esc(locCode(it, shelfCodes()))}</span>
      <span class="chip">${esc(it.shelf || 'no shelf')}${gone ? ' · missing' : ''}</span>
      <span class="chip">${pos} of ${n}</span>
    </div>
    <div class="ruler"><b>front &nbsp;→&nbsp; back</b><i style="left:calc(${pct.toFixed(1)}% - 1px)"></i></div>
    <p class="neigh">
      ${prev ? `filed after &nbsp;<b>${who(prev)}</b>` : 'Right at the <b>front</b> of the crate.'}
      ${prev && next ? '<br>and before &nbsp;' : next ? '<br>just before &nbsp;' : ''}${next ? `<b>${who(next)}</b>` : ''}
      ${prev && !next ? '<br>Right at the <b>back</b> of the crate.' : ''}
    </p>`;
}

function openLocator(uid){
  const it = DB.items.find(x => x.uid === uid); if(!it) return;
  $('#sheetBody').innerHTML = `
    <div class="eyebrow" style="margin-top:4px">Where to find it</div>
    <h3 style="margin:0 0 2px;font-size:18px;line-height:1.25">${esc(it.title)}</h3>
    <div class="meta">${esc(it.artist)}</div>
    ${locatorHtml(it)}
    <p class="hint">Counted from the front. If the crate has drifted, go by the two
      records either side rather than the number.</p>
    <div class="row" style="margin-top:14px">
      <button class="btn quiet" id="locOpen">Open the record</button>
    </div>`;
  $('#locOpen').onclick = () => openSheet(uid);
  showHere(uid);
  $('#scrim').classList.add('on');
  $('#sheet').classList.add('on');
}

/* ── detail sheet ─────────────────────────────────────────── */
let openUid = null;
/* Position, title and artist start locked. BPM, key and genre do not —
   those are the boxes you actually work in, and gating them behind a
   toggle would put a tap in front of every tempo you type. */
let trackEdit = false;
function openSheet(uid){
  const it = DB.items.find(x => x.uid === uid); if(!it) return;
  /* Only a DIFFERENT record starts locked again. The sheet is rebuilt in
     place after adding a track or changing a grade, and re-locking there
     would drop you out of editing mid-job. */
  if(openUid !== uid) trackEdit = false;
  openUid = uid;
  showHere(uid);            /* light up the crate this one lives in */
  const v = itemValue(it);
  $('#sheetBody').innerHTML = `
    <div class="sheet-head">
      ${it.art?`<img src="${esc(it.art)}" alt="">`:`<div style="width:96px;height:96px;border-radius:4px;background:var(--ink);display:grid;place-items:center;font-family:var(--mono);font-size:10px;color:var(--dust)">no art</div>`}
      <div style="min-width:0">
        <h3>${esc(it.title)}</h3>
        <div class="meta">${esc(it.artist)}<br>
          ${esc([it.label, it.catno].filter(Boolean).join(' · '))}<br>
          ${esc([it.year, it.country, it.format].filter(Boolean).join(' · '))}</div>
      </div>
    </div>

    <div class="strip" style="margin-top:14px">
      <div><b style="color:var(--sticker)">${money(v)}</b><small>your copy</small></div>
      <div><b>${it.low!=null?money(it.low):'—'}</b><small>lowest listed</small></div>
      <div><b>${it.forSale ?? '—'}</b><small>for sale</small></div>
    </div>

    <div class="chips">
      ${(it.genres||[]).slice(0,8).map(g=>`<span class="chip">${esc(g)}</span>`).join('')}
      ${it.have!=null?`<span class="chip">${it.have} have · ${it.want} want</span>`:''}
    </div>

    <div class="row">
      <div><label class="f" for="sMedia">Media</label>
        <select id="sMedia">${GRADES.map(g=>`<option ${g===it.media?'selected':''}>${g}</option>`).join('')}</select></div>
      <div><label class="f" for="sSleeve">Sleeve</label>
        <select id="sSleeve">${GRADES.map(g=>`<option ${g===it.sleeve?'selected':''}>${g}</option>`).join('')}</select></div>
    </div>
    <div class="row">
      <div><label class="f" for="sShelf">Shelf</label>
        <select id="sShelf">${DB.shelves.map(s=>`<option ${s===it.shelf?'selected':''}>${esc(s)}</option>`).join('')}</select></div>
      <div><label class="f" for="sPaid">You paid</label>
        <input type="number" id="sPaid" step="0.01" placeholder="0.00" value="${it.paid??''}"></div>
    </div>
    ${it.paid!=null && v!=null ? `<p class="hint" style="color:${v>=it.paid?'var(--ok)':'var(--bad)'}">
       ${v>=it.paid?'Up':'Down'} ${money(Math.abs(v-it.paid))} on what you paid.</p>`:''}

    <div class="eyebrow" style="margin:20px 0 8px">Where it is</div>
    ${locatorHtml(it)}

    <label class="f" for="sNotes">Notes</label>
    <textarea id="sNotes" rows="2" placeholder="Runout etching, sleeve creasing, who you bought it from…">${esc(it.notes)}</textarea>

    <div class="shelfhead" style="margin:20px 0 8px">
      <div class="eyebrow">Tracklist · BPM, key &amp; genre</div>
      <div class="spacer"></div>
      <button class="ghost" id="sTrackEdit">${trackEdit ? 'done' : 'edit details'}</button>
    </div>
    <datalist id="genreOpts">${genreList().map(g=>`<option value="${esc(g)}">`).join('')}</datalist>
    ${(it.tracks||[]).length ? (it.tracks||[]).map((t,i)=>`
      <div class="ed">
        <div class="top">
          <input type="text" class="tPos" data-i="${i}" value="${esc(t.pos || '')}"
                 placeholder="${i+1}" aria-label="Position" spellcheck="false"
                 ${trackEdit ? '' : 'readonly'}>
          <input type="text" class="tTitle" data-i="${i}" value="${esc(t.title || '')}"
                 placeholder="Track title" aria-label="Track title"
                 ${trackEdit ? '' : 'readonly'}>
          <span>${esc(t.dur||'')}</span>
        </div>
        <div class="bot">
          <input type="number" class="tBpm" data-i="${i}" value="${t.bpm||''}"
                 placeholder="BPM" min="${BPM_MIN}" max="${BPM_MAX}" step="0.1" inputmode="decimal">
          <button class="tap" data-i="${i}">Tap</button>
          <select class="tKey" data-i="${i}">${keyOpts(t.key||'', '— key —')}</select>
          ${t.title ? `<a class="tap" href="${esc(ytSearch(t.artist || ytArtist(it.artist), t.title))}"
             target="_blank" rel="noopener" title="Find this track on YouTube Music">Play</a>` : ''}
        </div>
        <div class="gen">
          <input type="text" class="tArt" data-i="${i}" placeholder="Artist — blank if same"
                 value="${esc(t.artist || '')}" aria-label="Track artist"
                 ${trackEdit ? '' : 'readonly'}>
          <input type="text" class="tGen" data-i="${i}" list="genreOpts"
                 placeholder="Genre" value="${esc(t.genre || '')}">
        </div>
      </div>`).join('')
      : '<p class="hint">No tracklist on this one. Add the tracks you care about.</p>'}
    <div class="row" style="margin-top:10px">
      <button class="btn quiet" id="sAddTrack">Add a track</button>
      <button class="btn quiet" id="sLookup">Find tempo &amp; key</button>
    </div>
    <div class="row" style="margin-top:8px">
      <button class="btn quiet" id="sGenreAll">Set genre for every track</button>
    </div>

    <div class="row" style="margin-top:18px">
      <button class="btn quiet" id="sRefresh">Refresh from Discogs</button>
      <a class="btn quiet" href="https://www.discogs.com/release/${it.id}" target="_blank" rel="noopener" style="text-decoration:none">Open on Discogs</a>
    </div>
    <div class="row" style="margin-top:8px">
      <a class="btn quiet" href="${esc(ytSearch(ytArtist(it.artist), it.title))}" target="_blank" rel="noopener" style="text-decoration:none">Find on YouTube Music</a>
    </div>
    <button class="btn quiet" id="sDelete" style="margin-top:8px;color:var(--bad);border-color:var(--bad)">Remove from crate</button>
  `;
  const patch = (k, val) => { const o = DB.items.find(x=>x.uid===uid); o[k]=val; save(); renderAll(); };
  $('#sMedia').onchange = e => { patch('media', e.target.value); openSheet(uid); };
  $('#sSleeve').onchange = e => { patch('sleeve', e.target.value); openSheet(uid); };
  $('#sShelf').onchange = e => {
    /* Routed through moveToShelf rather than writing the field here.
       Setting it inline left a hole in the shelf you moved off — it was
       never renumbered — and skipped the undo step every other way of
       moving a record gets. It also puts the record at the end of the
       new shelf rather than at whatever slot it held on the old one. */
    const o = DB.items.find(x => x.uid === uid);
    if(moveToShelf(o, e.target.value)){ save(); renderAll(); }
    openSheet(uid);         /* "Where it is" is now stale — redraw it */
  };
  $('#sPaid').onchange = e => { patch('paid', e.target.value===''?null:parseFloat(e.target.value)); openSheet(uid); };
  $('#sNotes').oninput = e => patch('notes', e.target.value);
  /* per-track BPM and key */
  const tracksOf = () => DB.items.find(x=>x.uid===uid).tracks;
  document.querySelectorAll('#sheetBody .tBpm').forEach(inp => {
    inp.onchange = e => {
      const t = tracksOf()[+e.target.dataset.i];
      const raw = e.target.value.trim();
      if(raw === ''){ t.bpm = null; save(); renderAll(); return; }   /* clearing is fine */
      const v = parseFloat(raw);
      /* Refused rather than clamped: 1288 was meant to be 128, not 300,
         so pinning it to the ceiling would hide the typo instead of
         showing it. The old value goes back in the box. */
      if(!(v >= BPM_MIN && v <= BPM_MAX)){
        e.target.value = t.bpm ?? '';
        return toast(`BPM should be between ${BPM_MIN} and ${BPM_MAX} — left as it was`, 3800);
      }
      t.bpm = Math.round(v*10)/10;
      save(); renderAll();
    };
  });
  document.querySelectorAll('#sheetBody .tKey').forEach(sel => {
    sel.onchange = e => {
      tracksOf()[+e.target.dataset.i].key = e.target.value || '';
      save(); renderAll();
    };
  });
  /* Position, title and artist, editable in place. Written on change
     rather than per keystroke, so renderAll() isn't run mid-word.

     A title is never allowed to end up empty: mergeTracks matches an
     existing track to a fresh Discogs one by title first, and the Play
     link only renders when there is one, so a nameless track quietly
     loses both. An emptied box falls back to "Untitled". */
  $('#sTrackEdit').onclick = () => { trackEdit = !trackEdit; openSheet(uid); };

  document.querySelectorAll('#sheetBody .tTitle').forEach(inp => {
    inp.onchange = e => {
      if(!trackEdit) return;        /* readonly is the widget; this is the rule */
      const t = tracksOf()[+e.target.dataset.i];
      t.title = e.target.value.trim() || 'Untitled';
      e.target.value = t.title;
      save(); renderAll();
    };
  });
  /* Uppercased because sides are written A1, B2 — and because 'a1' and
     'A1' sorting as different positions would be a nasty surprise. */
  document.querySelectorAll('#sheetBody .tPos').forEach(inp => {
    inp.onchange = e => {
      if(!trackEdit) return;
      const t = tracksOf()[+e.target.dataset.i];
      t.pos = e.target.value.trim().toUpperCase();
      e.target.value = t.pos;
      save(); renderAll();
    };
  });
  /* Blank means "same as the record", which is what Discogs' own data
     means by an empty track artist — so clearing it is a real answer,
     not a missing one. */
  document.querySelectorAll('#sheetBody .tArt').forEach(inp => {
    inp.onchange = e => {
      if(!trackEdit) return;
      tracksOf()[+e.target.dataset.i].artist = e.target.value.trim();
      save(); renderAll();
    };
  });
  /* Genre. Written on change rather than on every keystroke, so a
     half-typed word never reaches the dropdown other tracks read from.
     An existing spelling wins over a new one differing only by case, so
     picking 'House' from the list can't quietly create 'house'. */
  document.querySelectorAll('#sheetBody .tGen').forEach(inp => {
    inp.onchange = e => {
      const typed = e.target.value.trim();
      const known = genreList().find(g => g.toLowerCase() === typed.toLowerCase());
      const val = known || typed;
      tracksOf()[+e.target.dataset.i].genre = val;
      e.target.value = val;
      save(); renderAll();
      $('#genreOpts').innerHTML = genreList().map(g=>`<option value="${esc(g)}">`).join('');
    };
  });

  /* tap tempo — tap along with the record, four taps is enough */
  document.querySelectorAll('#sheetBody .tap').forEach(btn => {
    let taps = [];
    btn.onclick = () => {
      const now = performance.now();
      if(taps.length && now - taps[taps.length-1] > 2200) taps = [];
      taps.push(now); taps = taps.slice(-8);
      btn.classList.add('live');
      if(taps.length < 2){ btn.textContent = 'again'; return; }
      const gaps = taps.slice(1).map((t,j) => t - taps[j]);
      const bpm = Math.round(60000 / (gaps.reduce((a,c)=>a+c,0)/gaps.length) * 10)/10;
      btn.textContent = bpm;
      /* Tapping writes straight to the track rather than through the
         input's change handler, so it needs the same range check or a
         flurry of fast taps lands a number the box would have refused. */
      if(!(bpm >= BPM_MIN && bpm <= BPM_MAX)) return;
      const inp = document.querySelector(`#sheetBody .tBpm[data-i="${btn.dataset.i}"]`);
      inp.value = bpm;
      tracksOf()[+btn.dataset.i].bpm = bpm; save();
      clearTimeout(btn._t);
      btn._t = setTimeout(() => { btn.textContent='Tap'; btn.classList.remove('live'); taps=[]; renderAll(); }, 2600);
    };
  });

  $('#sLookup').onclick = async () => {
    const o = DB.items.find(x => x.uid === uid);
    const tks = (o && o.tracks) || [];
    if(!tks.length) return toast('No tracks on this one yet — add them first', 3600);
    /* Only ask about tracks with a gap. Both sources are rate limited —
       MusicBrainz to one call a second — so re-asking about a track you
       have already filled in costs real time and buys nothing, since the
       answer could not be used anyway. */
    const todo = tks.map((t, i) => ({t, i})).filter(({t}) => !t.bpm || !t.key);
    if(!todo.length)
      return toast('Every track here already has a tempo and a key — nothing to look up', 4600);
    const btn = $('#sLookup');
    btn.disabled = true; spin(true);
    const found = [];
    for(let k = 0; k < todo.length; k++){
      btn.textContent = 'Looking up ' + (k+1) + ' of ' + todo.length + '…';
      const {t, i} = todo[k];
      found.push({i, t, r: await lookupTempoKey(t.artist || o.artist, t.title || '')});
    }
    spin(false);
    reviewLookups(uid, found);
  };

  /* Most records are one genre the whole way through, so typing it into
     twelve boxes is busywork. Seeded from whatever is already there —
     a track you have typed, else the release's own Discogs genre — and
     an empty answer clears the lot, which is the only way back. */
  $('#sGenreAll').onclick = () => {
    const o = DB.items.find(x => x.uid === uid);
    const tks = o.tracks || [];
    if(!tks.length) return toast('No tracks on this one yet');
    const seed = (tks.find(t => t.genre) || {}).genre || (o.genres || [])[0] || '';
    const typed = prompt('Genre for all ' + tks.length +
      (tks.length === 1 ? ' track' : ' tracks') + ' on this record:', seed);
    if(typed === null) return;
    const v = typed.trim();
    const known = genreList().find(g => g.toLowerCase() === v.toLowerCase());
    const val = known || v;
    tks.forEach(t => t.genre = val);
    save(); renderAll(); openSheet(uid);
    toast(val ? 'All ' + tks.length + ' set to ' + val : 'Genre cleared on every track', 3200);
  };

  $('#sAddTrack').onclick = () => {
    const title = prompt('Track title'); if(title===null) return;
    const o = DB.items.find(x=>x.uid===uid);
    o.tracks = o.tracks || [];
    o.tracks.push({pos:String.fromCharCode(65+Math.floor(o.tracks.length/2))+(o.tracks.length%2+1),
                   title:title||'Untitled', artist:'', dur:'', bpm:null, key:'', genre:''});
    save(); renderAll(); openSheet(uid);
  };

  $('#sDelete').onclick = () => {
    if(!confirm('Remove "'+it.title+'" from your crate?')) return;
    DB.items = DB.items.filter(x=>x.uid!==uid); save(); closeSheet(); renderAll(); toast('Removed');
  };
  $('#sRefresh').onclick = async () => {
    if(!it.id){ toast('This one was added by hand, so there is nothing on Discogs to refresh'); return; }
    spin(true); toast('Checking Discogs…');
    try{
      const rel = await fetchRelease(it.id);
      const o = DB.items.find(x=>x.uid===uid);
      /* Discogs sends no lowest_price when nothing happens to be listed
         this week, which is not the same as the record being worth
         nothing. Only a real number overwrites what is already here, so
         a quiet week can't wipe a price you had. priced is stamped with
         it, so it keeps meaning "when this price came from". */
      const gotPrice = typeof rel.lowest_price === 'number';
      if(gotPrice){ o.low = rel.lowest_price; o.priced = Date.now(); }
      if(rel.num_for_sale != null) o.forSale = rel.num_for_sale;   /* 0 is an answer */
      const fresh = flatTracks(rel.tracklist);
      let note = gotPrice ? 'Price updated'
                          : (o.low != null ? 'None listed — price left as it was'
                                           : 'None listed, so still no price');
      if(fresh.length){
        const before = (o.tracks||[]).length;
        o.tracks = mergeTracks(fresh, o.tracks);
        const kept = o.tracks.filter(t => t.bpm || t.key).length;
        /* appended, not replacing: the price line is the one that says
           whether anything was left alone, and it used to be thrown away
           the moment a record had a tracklist — which is nearly always */
        note += ` · ${o.tracks.length} track${o.tracks.length===1?'':'s'}`
             + (o.tracks.length !== before ? ` (was ${before})` : '')
             + (kept ? ` · kept ${kept} BPM/key` : '');
      }
      if(!o.art && rel.images?.[0]) o.art = rel.images[0].uri150 || rel.images[0].uri;
      save(); renderAll(); openSheet(uid); toast(note, 3600);
    }catch(e){ toast(friendly(e)); }
    spin(false);
  };
  $('#scrim').classList.add('on'); $('#sheet').classList.add('on');
}
/* Nothing is written until you tick it. Each row shows what the source
   actually matched, because the failure mode isn't "no answer" — it's a
   confident answer for the wrong mix. */
function reviewLookups(uid, found){
  /* What a result would actually change. A field already filled in is
     never offered, so the panel can't propose something it would then
     refuse to write. */
  const fills = f => ({
    bpm: !!(f.r && f.r.bpm && !f.t.bpm),
    key: !!(f.r && f.r.key && !f.t.key)
  });
  const usable = found.filter(f => { const w = fills(f); return w.bpm || w.key; });
  if(!usable.length){
    toast('Nothing new found — what these tracks were missing came back empty', 4600);
    openSheet(uid);
    return;
  }
  const rows = found.map(f => {
    const name = esc(f.t.pos || (f.i + 1)) + ' · ' + esc(f.t.title || 'Untitled');
    const w = fills(f);
    if(!w.bpm && !w.key)
      return `<div class="ed"><div class="top"><b>${name}</b>
        <span style="margin-left:auto;color:var(--dust)">nothing found</span></div></div>`;
    const now = [f.t.bpm ? f.t.bpm + ' BPM' : '', f.t.key || ''].filter(Boolean).join(' · ') || 'empty';
    const got = [w.bpm ? f.r.bpm + ' BPM' : '',
                 w.key ? esc(f.r.key) + ' (' + esc(KEYNAME[f.r.key] || '') + ')' : ''
                ].filter(Boolean).join(' · ');
    /* If the source also answered something you already have, say that it
       is being kept — otherwise it reads as though it was ignored. */
    const keeping = [f.r.bpm && f.t.bpm ? 'your ' + f.t.bpm + ' BPM' : '',
                     f.r.key && f.t.key ? 'your ' + f.t.key : ''].filter(Boolean).join(' and ');
    return `<div class="ed">
      <div class="top"><b>${name}</b></div>
      <label class="bot" style="gap:10px;align-items:center;cursor:pointer">
        <input type="checkbox" class="lkPick" data-i="${f.i}" checked>
        <span><b>${got}</b></span>
      </label>
      <div class="hint" style="margin:4px 0 0">now ${esc(now)} — matched “${esc(f.r.matched || '?')}”
        via ${esc(f.r.source)}${f.r.conf ? ' · ' + f.r.conf + '% sure of the key' : ''}${
        keeping ? ' · keeping ' + esc(keeping) : ''}</div>
    </div>`;
  }).join('');

  $('#sheetBody').innerHTML = `
    <h3 style="margin:0 0 4px">Tempo &amp; key found</h3>
    <p class="hint" style="margin:0 0 12px">Only empty boxes are filled — anything you have already
      entered is left alone. Check what each one matched before you accept it: a wrong mix
      will give a confident, wrong number. Untick anything that looks off.</p>
    ${rows}
    <div class="row" style="margin-top:14px">
      <button class="btn" id="lkApply">Use the ticked ones</button>
      <button class="btn quiet" id="lkCancel">Cancel</button>
    </div>`;

  $('#lkCancel').onclick = () => openSheet(uid);
  $('#lkApply').onclick = () => {
    const o = DB.items.find(x => x.uid === uid);
    if(!o) return closeSheet();
    let n = 0;
    document.querySelectorAll('#sheetBody .lkPick:checked').forEach(cb => {
      const f = found.find(x => x.i === +cb.dataset.i);
      if(!f || !f.r) return;
      const t = o.tracks[f.i];
      if(!t) return;
      /* Gaps only, re-checked here rather than trusting the panel — this
         is the last point before the write, and it used to overwrite a
         tempo you had tapped in yourself. */
      let touched = false;
      if(f.r.bpm && !t.bpm){ t.bpm = f.r.bpm; touched = true; }
      if(f.r.key && !t.key){ t.key = f.r.key; touched = true; }
      if(touched) n++;
    });
    save(); renderAll();
    toast(n ? n + ' track' + (n === 1 ? '' : 's') + ' filled in' : 'Nothing ticked', 3200);
    openSheet(uid);
  };
}

function closeSheet(){
  openUid=null; hereUid=null;
  /* Put the rail back to its ordinary window. Leaving it centred on a
     record that is no longer open would leave the spines on screen
     disagreeing with crateList(), which is what "select all" reads. */
  renderCrate(); paintHere();
  $('#scrim').classList.remove('on'); $('#sheet').classList.remove('on');
}

/* ══════════════════════════════════════════════════════════
   CSV — matches the Discogs export layout both ways
   ══════════════════════════════════════════════════════════ */
const COLS = ['Catalog#','Artist','Title','Label','Format','Rating','Released','release_id',
              'CollectionFolder','Date Added','Collection Media Condition',
              'Collection Sleeve Condition','Collection Notes'];
const cell = s => { s = String(s??''); return /[",\n]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s; };
const GM = {'M':'Mint (M)','NM':'Near Mint (NM or M-)','VG+':'Very Good Plus (VG+)','VG':'Very Good (VG)',
            'G+':'Good Plus (G+)','G':'Good (G)','F':'Fair (F)','P':'Poor (P)'};
const unGM = s => { const k = Object.keys(GM).find(k => GM[k] === s); return k || (GRADES.includes(s)?s:'VG+'); };

function exportCsv(){
  const rows = [COLS.join(',')].concat(DB.items.map(i => [
    i.catno, i.artist, i.title, i.label, i.format, '', i.year, i.id, i.shelf,
    (i.added||'').slice(0,19).replace('T',' '), GM[i.media]||'', GM[i.sleeve]||'',
    [i.notes, i.paid!=null?('Paid '+sym()+i.paid):''].filter(Boolean).join(' — ')
  ].map(cell).join(',')));
  download('crate-collection.csv', rows.join('\n'), 'text/csv');
}

function parseCsv(text){
  const rows=[]; let row=[], f='', q=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(q){ if(c==='"'){ if(text[i+1]==='"'){f+='"';i++;} else q=false; } else f+=c; }
    else if(c==='"') q=true;
    else if(c===','){ row.push(f); f=''; }
    else if(c==='\n'){ row.push(f); rows.push(row); row=[]; f=''; }
    else if(c!=='\r') f+=c;
  }
  if(f||row.length){ row.push(f); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim()!==''));
}

/* ── tracklists embedded in a CSV column ────────────────────
   Collection apps export a tracklist as one line per track:
       A1. The Drill (Evacuation Mix) (7:40)
   The position letters only ever run A-H on a record, so requiring
   that stops a title like "Mr. Vain" losing its "Mr." to the position.
   Only a trailing (m:ss) counts as a duration - mix names live in
   brackets too, and they're part of the title. */
function parseTrackLines(text){
  return String(text||'').split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(line => {
    let pos = '', title = line, dur = '';
    const m = title.match(/^([A-H]{1,3}\d{0,3}|\d{1,3})\.\s+(.+)$/);
    if(m){ pos = m[1]; title = m[2].trim(); }
    const d = title.match(/\s*\((\d{1,2}:\d{2})\)$/);
    if(d){ dur = d[1]; title = title.slice(0, d.index).trim(); }
    return {pos, title: title || 'Untitled', artist:'', dur, bpm:null, key:''};
  });
}

/* Some exports carry a second tracklist column with the artist in front
   of each title - the only place a compilation's real artists appear.
   Take the artist from it rather than the whole line, and only when the
   rich title is exactly "<someone> - <the plain title>", so a release
   like "Rich Pickings - Volume III" can't get split down its own dash. */
function mergeTrackArtists(tracks, richText){
  const rich = parseTrackLines(richText);
  if(rich.length !== tracks.length) return tracks;
  tracks.forEach((t, i) => {
    const suffix = ' - ' + t.title;
    const rt = rich[i].title;
    if(rt.length > suffix.length && rt.endsWith(suffix)){
      t.artist = rt.slice(0, rt.length - suffix.length).trim();
    }
  });
  return tracks;
}

/* "Barcode: 044006394510 (Scanned)" among matrix numbers and rights
   societies. The scanned one is the one a camera will match later. */
function barcodeFrom(text){
  let fallback = '';
  for(const line of String(text||'').split(/\r?\n/)){
    const m = line.match(/^\s*Barcode:\s*(.+)$/i);
    if(!m) continue;
    const digits = m[1].replace(/\D/g, '');
    if(digits.length < 8) continue;
    if(/\(scanned\)/i.test(line)) return digits;
    if(!fallback) fallback = digits;
  }
  return fallback;
}

function importCsv(text){
  const rows = parseCsv(text.replace(/^﻿/, ''));
  if(rows.length < 2){ toast('That CSV looks empty'); return; }
  const head = rows[0].map(h => h.trim());
  const ix = n => head.findIndex(h => h.toLowerCase() === n.toLowerCase());
  const g = (r, n) => { const j = ix(n); return j>=0 ? (r[j]||'').trim() : ''; };
  /* Same field, different spelling depending on which app wrote the file.
     First name that carries a value wins, so order matters: AlbumTitle
     beats Title because some exports put "Artist - Album" in Title. */
  const pick = (r, ...names) => { for(const n of names){ const v = g(r, n); if(v) return v; } return ''; };

  let added = 0, withTracks = 0, withSlots = 0;
  const fallbackSlot = {};                 /* per shelf, for rows with no position */
  rows.slice(1).forEach(r => {
    const artist = pick(r, 'Artist', 'ArtistSort');
    const title  = pick(r, 'AlbumTitle', 'Title');
    if(!artist && !title) return;

    const shelf = pick(r, 'CollectionFolder', 'Shelf') || DB.shelves[0] || 'Main';
    if(shelf && !DB.shelves.includes(shelf)) DB.shelves.push(shelf);

    const tracks = mergeTrackArtists(
      parseTrackLines(pick(r, 'Tracklist', 'Tracklist with Artists')),
      pick(r, 'Tracklist with Artists'));
    if(tracks.length) withTracks++;

    const paid = parseFloat(pick(r, 'Price').replace(/[^\d.]/g, ''));

    /* where it sits on the shelf; falls back to the order rows arrive in */
    fallbackSlot[shelf] = (fallbackSlot[shelf] || 0) + 1;
    const posn = parseInt(pick(r, 'PositionInShelf', 'Position'), 10);
    const slot = (isFinite(posn) && posn > 0) ? posn : fallbackSlot[shelf];
    if(isFinite(posn) && posn > 0) withSlots++;

    DB.items.push({
      uid:'i'+Date.now()+Math.random().toString(36).slice(2,7),
      id: parseInt(pick(r, 'release_id', 'DiscogsReleaseId'), 10) || 0,
      artist: artist || 'Unknown artist',
      title: title || 'Untitled',
      year: parseInt(pick(r, 'Released'), 10) || '',
      label: pick(r, 'Label'),
      catno: pick(r, 'Catalog#', 'CatNo'),
      country: pick(r, 'Country'),
      format: pick(r, 'Format'),
      genres: pick(r, 'Genres').split(/[,;\n]/).map(s => s.trim()).filter(Boolean),
      art:'', tracks,
      low:null, forSale:null, have:null, want:null,
      barcode: barcodeFrom(pick(r, 'Identifiers')),
      media: unGM(pick(r, 'Collection Media Condition')),
      sleeve: unGM(pick(r, 'Collection Sleeve Condition')),
      paid: isFinite(paid) && paid > 0 ? paid : null,
      notes: pick(r, 'Collection Notes', 'Notes'),
      shelf, slot,
      added: pick(r, 'Date Added', 'AddedAt') || new Date().toISOString(),
      priced: 0
    });
    added++;
  });

  save(); renderAll();
  toast(`${added} records imported`
      + (withTracks ? ` · ${withTracks} with tracklists` : '')
      + (withSlots ? ` · shelf order kept` : '')
      + '. Tap “Fill in from Discogs” in Setup for artwork and prices.', 5600);
}

/* ── filling in a CSV import ────────────────────────────────
   Discogs' export has no artwork, tracklist or price columns — only
   release_id — so imported records arrive as stubs. Walk them and pull
   the missing pieces, one release at a time. dg() already spaces calls
   1.1s apart, so the loop needs no throttle of its own. */
let filling = false;
const needsFill = it => it.id && (!it.art || !(it.tracks||[]).length);

async function backfill(){
  if(filling){ filling = false; return; }          /* second tap = stop */
  if(!DB.token){ toast('Add your Discogs token in Setup first.'); return; }

  const todo = DB.items.filter(needsFill);
  if(!todo.length){
    toast('Nothing to fill in — every record with a Discogs ID already has its artwork and tracklist.', 4200);
    return;
  }
  const mins = Math.max(1, Math.round(todo.length * 1.1 / 60));
  if(!confirm(`Fill in artwork and tracklists for ${todo.length} record${todo.length===1?'':'s'}?\n\n`
            + `Discogs allows about one request a second, so this takes roughly ${mins} minute${mins===1?'':'s'}. `
            + `You can carry on using Crate while it runs, and stop it any time.`)) return;

  const btn = $('#btnFill'), label = btn.textContent;
  filling = true; spin(true);
  let done = 0, failed = 0;

  for(const stub of todo){
    if(!filling) break;
    btn.textContent = `Stop (${done + failed + 1} of ${todo.length})`;
    try{
      const rel = await fetchRelease(stub.id);
      const o = DB.items.find(x => x.uid === stub.uid);
      if(!o) continue;                              /* deleted while we ran */
      if(!o.art && rel.images?.[0]) o.art = rel.images[0].uri150 || rel.images[0].uri;
      const fresh = flatTracks(rel.tracklist);
      if(fresh.length) o.tracks = mergeTracks(fresh, o.tracks);
      /* Same rule as the single-record refresh: a missing figure means
         Discogs has nothing listed today, not that the number is now
         zero. Only a real value overwrites one already here. */
      if(typeof rel.lowest_price === 'number'){ o.low = rel.lowest_price; o.priced = Date.now(); }
      if(rel.num_for_sale != null)    o.forSale = rel.num_for_sale;
      if(rel.community?.have != null) o.have    = rel.community.have;
      if(rel.community?.want != null) o.want    = rel.community.want;
      if(!o.country)          o.country = rel.country || '';
      if(!(o.genres||[]).length) o.genres = (rel.genres||[]).concat(rel.styles||[]);
      if(!o.year)             o.year = rel.year || (rel.released||'').slice(0,4) || '';
      if(!o.format)           o.format = (rel.formats||[]).map(f => [f.name, f.text, (f.descriptions||[]).join(' ')].filter(Boolean).join(' ')).join(', ');
      done++; save();
    }catch(e){
      failed++;
      if(e.message === 'NO_TOKEN' || e.message === 'BAD_TOKEN'){ toast(friendly(e)); break; }
    }
    if(done && done % 10 === 0) renderAll();        /* show progress as it lands */
  }

  const stopped = !filling;                          /* false = ran to the end */
  filling = false; btn.textContent = label;
  spin(false); save(); renderAll();
  toast(`${stopped ? 'Stopped — filled in' : 'Filled in'} ${done} record${done===1?'':'s'}`
      + (failed ? ` · ${failed} couldn't be fetched` : ''), 4600);
}

function download(name, data, type){
  const b = new Blob([data], {type});
  const u = URL.createObjectURL(b);
  const a = document.createElement('a'); a.href=u; a.download=name; a.click();
  setTimeout(()=>URL.revokeObjectURL(u), 4000);
}

/* ══════════════════════════════════════════════════════════
   wiring
   ══════════════════════════════════════════════════════════ */
document.querySelectorAll('nav button').forEach(b => b.onclick = () => {
  document.querySelectorAll('nav button').forEach(x=>x.classList.toggle('on', x===b));
  document.querySelectorAll('.view').forEach(v=>v.classList.toggle('on', v.id === 'v'+'-'+b.dataset.v));
  if(b.dataset.v !== 'scan') stopCam();
  window.scrollTo(0,0);
});

$('#btnCam').onclick = () => startCam('barcode');
$('#btnStop').onclick = stopCam;
$('#btnRead').onclick = readNow;
$('#btnOcrCat').onclick   = () => { ocrKind = 'catno'; startCam('ocr'); };
$('#btnOcrCover').onclick = () => { ocrKind = 'cover'; startCam('ocr'); };
$('#btnFind').onclick = () => {
  const v = $('#manual').value.trim();
  if(!v) return toast('Type a barcode, cat number or title first');
  searchAndChoose(v);          /* shows the matches rather than guessing */
};
$('#manual').addEventListener('keydown', e => { if(e.key==='Enter') $('#btnFind').click(); });

$('#btnPaste').onclick = async () => {
  const url = prompt('Paste a Discogs release URL or ID');
  if(!url) return;
  const m = url.match(/(?:release\/)?(\d{3,})/);
  if(!m) return toast('No release ID in that');
  spin(true);
  try{
    const rel = await fetchRelease(m[1]);
    DB.items.unshift(toItem(rel, '')); save(); renderAll();
    toast('Added ' + rel.title);
  }catch(e){ toast(friendly(e)); }
  spin(false);
};

$('#btnBlank').onclick = () => {
  const artist = prompt('Artist'); if(artist===null) return;
  const title = prompt('Title'); if(title===null) return;
  const it = fileNew({
    uid:'m'+Date.now(), id:0, artist:artist||'Unknown artist', title:title||'Untitled',
    year:'', label:'', catno:'', country:'', format:'Vinyl', genres:[], art:'', tracks:[],
    low:null, forSale:null, have:null, want:null, barcode:'', media:'VG+', sleeve:'VG+',
    paid:null, notes:'Added by hand', shelf:'', slot:0,
    added:new Date().toISOString(), priced:0
  });
  save(); renderAll(); toast('Added to ' + it.shelf + ', position ' + it.slot);
};

['#q','#sort','#shelfFilter','#fmtFilter','#genreFilter','#bpmMin','#bpmMax','#keyFilter','#harmonic']
  .forEach(s => {
    $(s).addEventListener('input', renderList);
    $(s).addEventListener('change', renderList);
  });

/* The arrow points the way the list runs, and the title says what a tap
   will do — an unlabelled arrow on its own is a coin toss. */
$('#sortDir').onclick = e => {
  const b = e.currentTarget;
  const on = b.getAttribute('aria-pressed') !== 'true';
  b.setAttribute('aria-pressed', String(on));
  b.textContent = on ? '↑' : '↓';
  b.title = on ? 'Reversed — tap for normal order' : 'Reverse the order';
  renderList();
};

document.querySelectorAll('#mode button').forEach(b => b.onclick = () => {
  MODE = b.dataset.m;
  document.querySelectorAll('#mode button').forEach(x => x.classList.toggle('on', x===b));
  renderList();
});

$('#clearF').onclick = () => {
  ['#q','#bpmMin','#bpmMax'].forEach(s => $(s).value = '');
  ['#shelfFilter','#fmtFilter','#genreFilter','#keyFilter'].forEach(s => $(s).value = '');
  $('#harmonic').checked = false;
  /* the direction is a filter too — leaving it reversed after "clear"
     is exactly the sort of thing that reads as a bug */
  const d = $('#sortDir');
  d.setAttribute('aria-pressed','false'); d.textContent = '↓'; d.title = 'Reverse the order';
  renderList();
};

document.addEventListener('click', e => {
  const rec = e.target.closest('.rec, .spine');
  if(rec){ openSheet(rec.dataset.uid); return; }
  /* a track row answers "where is it", not "tell me about it" — the
     record sheet is one tap further on, from inside the locator */
  const tr = e.target.closest('.trow');
  if(tr){ openLocator(tr.dataset.uid); return; }
  /* the remove button only - matching a bare [data-shelf] here once caught
     the shelf tiles too, and deleted whatever shelf sat at that index */
  const sh = e.target.closest('[data-shelf-remove]');
  if(sh){
    const i = +sh.dataset.shelfRemove, name = DB.shelves[i];
    if(!confirm('Remove shelf "'+name+'"? Records move to '+(DB.shelves.find(s=>s!==name))+'.')) return;
    DB.shelves.splice(i,1);
    DB.items.forEach(x => { if(x.shelf===name){ x.shelf = DB.shelves[0]; x.slot = nextSlot(DB.shelves[0]); } });
    save(); renderAll();
    return;
  }
  /* Filing a whole shelf by tempo. Confirmed first because it renumbers
     every record on the shelf in one go, and the undo button lives over
     on the Crate screen rather than here. */
  const st = e.target.closest('[data-shelf-tempo]');
  if(st){
    const name = DB.shelves[+st.dataset.shelfTempo];
    const on = DB.items.filter(x => x.shelf === name);
    if(on.length < 2) return toast('Not enough records on that shelf to sort');
    const noBpm = on.filter(x => relBpm(x) == null).length;
    if(!confirm('Re-file "' + name + '" into tempo order?\n\n' + on.length +
      ' records will be renumbered by average BPM, then key.' +
      (noBpm ? '\n\n' + noBpm + ' of them have no BPM yet and will go to the back.' : '') +
      '\n\nYou can undo this from the Crate screen.')) return;
    /* A throw inside the comparator used to die here with nothing on
       screen — the shelf simply didn't move and there was no way to tell
       why. Anything that fails now says so. */
    let done;
    try { done = sortShelfByTempo(name); }
    catch(err){ return toast('Could not sort that shelf — ' + err.message, 5000); }
    toast('Filed ' + done + ' records by tempo' +
      (noBpm ? ' · ' + noBpm + ' still to measure' : ''), 3600);
    return;
  }
  /* Renaming is not just DB.shelves[i]: a record stores its shelf by
     NAME, so every record sitting on it has to be rewritten in the same
     breath or they'd all point at a shelf that no longer exists and
     vanish from the crate view. Slots are untouched — nothing moves. */
  const rn = e.target.closest('[data-shelf-rename]');
  if(rn){
    const i = +rn.dataset.shelfRename, from = DB.shelves[i];
    const to = (prompt('Rename shelf "' + from + '" to:', from) || '').trim();
    if(!to || to === from) return;
    if(DB.shelves.some((s, j) => j !== i && s.toLowerCase() === to.toLowerCase()))
      return toast('You already have a shelf called that');
    const wasFiltered = $('#shelfFilter').value === from;
    DB.shelves[i] = to;
    let n = 0;
    DB.items.forEach(x => { if(x.shelf === from){ x.shelf = to; n++; } });
    /* the filing target is held by name too, so it has to follow or new
       records would quietly start landing on the first shelf instead */
    if(DB.fileTo && DB.fileTo.shelf === from) DB.fileTo.shelf = to;
    save(); renderAll();
    /* the filter dropdown was rebuilt around the new name, so a filter
       pointing at the old one would silently fall back to All shelves */
    if(wasFiltered){ $('#shelfFilter').value = to; renderShelfGrid(); renderList(); }
    toast('Renamed to “' + to + '”' + (n ? ' · ' + n + ' record' + (n === 1 ? '' : 's') + ' updated' : ''), 3200);
  }
});
$('#scrim').onclick = closeSheet;
document.addEventListener('keydown', e => { if(e.key==='Escape') closeSheet(); });

$('#btnSaveTok').onclick = () => { DB.token = $('#tok').value.trim(); DB.curr = $('#curr').value; save(); toast('Saved'); };
$('#btnSaveBpmKey').onclick = () => { DB.bpmKey = $('#bpmKey').value.trim(); save(); toast(DB.bpmKey ? 'Key saved' : 'Key cleared'); };
$('#curr').onchange = () => { DB.curr = $('#curr').value; save(); renderAll(); };
/* Deliberately does not go through fromGetSongBpm() — that returns null for
   every kind of failure alike, which is exactly what makes a dud key hard to
   spot. This reads the status and the body so the three that look identical
   from the outside can be told apart: not activated yet, wrong key, and a key
   that works but had nothing for the test track. */
$('#btnTestBpmKey').onclick = async () => {
  DB.bpmKey = $('#bpmKey').value.trim(); save();
  const out = $('#bpmKeyState');
  const say = (c, t) => out.innerHTML = '<span style="color:var(--'+c+')">'+esc(t)+'</span>';
  if(!DB.bpmKey){ say('warn', 'No key saved. Paste one above first.'); return; }
  out.textContent = 'Checking…'; spin(true);
  try{
    const u = 'https://api.getsong.co/search/?api_key=' + encodeURIComponent(DB.bpmKey) +
              '&type=both&lookup=' + encodeURIComponent('song:Billie Jean artist:Michael Jackson');
    const res = await fetch(u);
    let j = null; try{ j = await res.json(); }catch(e){}
    const err = j && (j.error || (j.search && j.search.error)) || '';
    if(res.status === 401 || /invalid|inactive/i.test(err)){
      /* the single most likely cause, and it looks just like a typo'd key */
      say('bad', 'Key rejected — “' + (err || 'unauthorised') + '”. A new key has to be activated from the link GetSongBPM email you before it will answer.');
    }else if(!res.ok){
      say('bad', 'GetSongBPM answered ' + res.status + '. Have another go in a minute.');
    }else if(Array.isArray(j && j.search) && j.search.length){
      const h = j.search[0];
      const bits = [h.tempo ? h.tempo + ' bpm' : '', openKeyToCamelot(h.open_key) || ''].filter(Boolean).join(' · ');
      say('ok', 'Working. It found “' + [h.artist && h.artist.name, h.title].filter(Boolean).join(' — ') + '”' + (bits ? ' at ' + bits : '') + '.');
    }else if(/no result/i.test(err)){
      /* auth got through, so the key is fine — the catalogue just missed */
      say('warn', 'Key accepted, but the test track came back empty. Odd, though the key itself is working.');
    }else{
      say('warn', 'Key accepted, but the answer was not a shape this app knows.');
    }
  }catch(e){
    /* a blocked or offline request looks the same as a CORS refusal here.
       friendly() is no use — every one of its messages names Discogs. */
    say('bad', 'Could not reach GetSongBPM. Check the connection — ' + e.message);
  }
  spin(false);
};
$('#btnTest').onclick = async () => {
  DB.token = $('#tok').value.trim(); DB.curr = $('#curr').value; save();
  $('#tokState').textContent = 'Checking…'; spin(true);
  try{
    const r = await dg('/database/search', {q:'aphex twin', type:'release', per_page:1});
    $('#tokState').innerHTML = r.results?.length
      ? '<span style="color:var(--ok)">Connected. Discogs is answering.</span>'
      : '<span style="color:var(--warn)">Connected, but the search came back empty.</span>';
  }catch(e){ $('#tokState').innerHTML = '<span style="color:var(--bad)">'+esc(friendly(e))+'</span>'; }
  spin(false);
};

$('#fileShelf').onchange = () => {
  DB.fileTo = {shelf: $('#fileShelf').value, at: $('#fileAt').value};
  save();
  toast('New records file into ' + DB.fileTo.shelf +
        (DB.fileTo.at === 'start' ? ', at the front' : ', at the back'), 3000);
};
$('#fileAt').onchange = $('#fileShelf').onchange;

$('#btnShelf').onclick = () => {
  const v = $('#newShelf').value.trim();
  if(!v) return; if(DB.shelves.includes(v)) return toast('You already have that shelf');
  DB.shelves.push(v); $('#newShelf').value=''; save(); renderAll(); toast('Shelf added');
};

$('#btnCsv').onclick = () => DB.items.length ? exportCsv() : toast('Nothing to export yet');
/* A backup is the whole app state, not just the records: the database
   plus the settings that live in their own storage keys. Wrapped in an
   envelope so a restore can tell what it's looking at and tell you what
   it's about to replace. Older backups were the bare database object,
   and the restore still accepts those. */
$('#btnJson').onclick = () => {
  const backup = {
    crate: 'backup',
    version: APP_VERSION,
    exported: new Date().toISOString(),
    records: DB.items.length,
    db: DB,
    sync: Sync.exportSettings()
  };
  download('crate-backup.json', JSON.stringify(backup, null, 2), 'application/json');
  toast(`Backed up ${DB.items.length} records and your settings`, 3600);
};
$('#btnDj').onclick = () => {
  const rows = allTracks();
  if(!rows.length) return toast('No tracklists to export yet');
  const head = ['Pos','Track','Artist','Release','BPM','Camelot','Key','Genre',
                'Label','Catalog#','Year','Shelf'];
  const body = rows
    .sort((a,b)=> keyRank(a.t.key)-keyRank(b.t.key) || (a.t.bpm||1e9)-(b.t.bpm||1e9))
    /* A track with no genre typed falls back to the release's own, the
       same way the genre filter treats it — otherwise most of the sheet
       reads blank until every track has been gone through by hand. */
    .map(({t,it}) => [t.pos, t.title, t.artist || it.artist, it.title, t.bpm??'', t.key||'',
                      t.key?KEYNAME[t.key]:'', trackGenre(t, it),
                      it.label, it.catno, it.year, it.shelf]
                     .map(cell).join(','));
  download('crate-dj-sheet.csv', [head.join(',')].concat(body).join('\n'), 'text/csv');
};
let importMode = 'csv';
/* ── shelf tiles: tap to filter, drag to reorder ────────────
   Pointer events rather than HTML5 drag-and-drop, which doesn't fire
   on touch. The dragged tile is moved in the DOM as you go so the
   others shuffle live; DB.shelves is kept in step and saved on drop. */
$('#btnShelfEdit').onclick = () => {
  shelfEdit = !shelfEdit;
  $('#btnShelfEdit').textContent = shelfEdit ? 'done' : 'reorder shelves';
  renderShelfGrid();
};

(function wireShelfTiles(){
  const grid = $('#shelfGrid');
  let dragEl = null, from = -1, moved = false;

  grid.addEventListener('pointerdown', e => {
    if(!shelfEdit) return;
    const tile = e.target.closest('.shelfTile');
    if(!tile) return;
    dragEl = tile; from = +tile.dataset.i; moved = false;
    /* capture keeps the moves coming if a finger strays off the tile;
       if the browser won't give it, the drag still works over the grid */
    try{ tile.setPointerCapture(e.pointerId); }catch(err){}
    tile.classList.add('drag');
    e.preventDefault();
  });

  grid.addEventListener('pointermove', e => {
    if(!dragEl) return;
    e.preventDefault();
    const over = [...grid.children].find(c => {
      if(c === dragEl) return false;
      const r = c.getBoundingClientRect();
      return e.clientX >= r.left && e.clientX <= r.right
          && e.clientY >= r.top  && e.clientY <= r.bottom;
    });
    if(!over) return;
    const to = +over.dataset.i;
    DB.shelves.splice(to, 0, DB.shelves.splice(from, 1)[0]);
    grid.insertBefore(dragEl, to < from ? over : over.nextSibling);
    [...grid.children].forEach((c, i) => c.dataset.i = i);
    from = to; moved = true;
  });

  const drop = () => {
    if(!dragEl) return;
    dragEl.classList.remove('drag');
    dragEl = null;
    if(moved){ save(); renderFilters(); toast('Shelf order saved'); }
  };
  grid.addEventListener('pointerup', drop);
  grid.addEventListener('pointercancel', drop);

  grid.addEventListener('click', e => {
    const tile = e.target.closest('.shelfTile');
    if(!tile) return;

    /* a set is ticked: this tap re-files the lot onto that shelf */
    if(!shelfEdit && selMode && ticked.size){
      const items = selItems(), to = tile.dataset.shelfName;
      const n = moveManyToShelf(items, to);
      if(n) afterBulk(n, to);
      return;
    }

    /* a record is lifted: this tap sends it to the end of that shelf */
    if(picked){
      const it = DB.items.find(i => i.uid === picked);
      const to = tile.dataset.shelfName;
      const ok = moveToShelf(it, to);
      setPicked(null);
      if(ok){ save(); renderAll(); toast('Moved to shelf ' + to); }
      else { renderAll(); toast('Already on shelf ' + to); }
      return;
    }

    if(shelfEdit) return;                       /* rearranging, not browsing */
    const sel = $('#shelfFilter');
    sel.value = sel.value === tile.dataset.shelfName ? '' : tile.dataset.shelfName;
    renderList(); renderShelfGrid();
    $('#grid').scrollIntoView({behavior:'smooth', block:'start'});
  });
})();

/* ── records: drag into your own order on a shelf ───────────
   Same pointer-event approach as the shelf tiles. On drop, the whole
   visible shelf is renumbered 1..n from the DOM order, so slots stay
   dense and the order survives a reload and syncs to your devices. */
$('#btnArrange').onclick = () => {
  recEdit = !recEdit;
  if(!recEdit){ setPicked(null); if(!crateEdit) return exitSel(); }
  updateArrangeBar();
};

/* ── selecting several ──────────────────────────────────────
   Both arrange bars drive the same set, so you can tick a few off the
   rail and a few more off the sleeves before moving the lot. The buttons
   are wired by data attribute rather than id for exactly that reason —
   two bars, one behaviour, one handler. */
$('#btnCrateSelect').onclick = $('#btnSelect').onclick = () => {
  selMode = !selMode;
  ticked.clear(); selPlacing = false;
  if(selMode) setPicked(null);      /* a lifted record and a set can't both be live */
  renderList();
};
/* "All" means what is actually on screen — the rail's own list, or the
   sleeve grid's, filters and search included. That is what makes it
   worth having: narrow to a shelf or a label first and one tap has the
   exact run you wanted. The count in the bar keeps it honest, since the
   rail stops at 150 spines. */
document.querySelectorAll('[data-undo]').forEach(b => b.onclick = undoLast);
document.querySelectorAll('[data-sel-all]').forEach(b => b.onclick = () => {
  (b.dataset.selAll === 'crate' ? crateList() : visible()).forEach(i => ticked.add(i.uid));
  selPlacing = false;
  repaintSel();
  toast(ticked.size + (ticked.size === 1 ? ' record ticked' : ' records ticked'));
});
document.querySelectorAll('[data-sel-none]').forEach(b => b.onclick = () => {
  ticked.clear(); selPlacing = false; repaintSel();
});
document.querySelectorAll('[data-sel-place]').forEach(b => b.onclick = () => {
  if(!ticked.size) return;
  selPlacing = !selPlacing;
  repaintSel();
});

(function wireRecordDrag(){
  const grid = $('#grid');
  let dragEl = null, dragUid = '', from = -1, moved = false, overShelf = null;

  const tiles = () => [...grid.children].filter(c => c.classList.contains('rec'));

  grid.addEventListener('pointerdown', e => {
    if(!recEdit || selMode) return;      /* while selecting, a press is a tick */
    const rec = e.target.closest('.rec');
    if(!rec) return;
    dragEl = rec; dragUid = rec.dataset.uid; moved = false; overShelf = null;
    from = tiles().indexOf(rec);
    try{ rec.setPointerCapture(e.pointerId); }catch(err){}
    rec.classList.add('drag');
    e.preventDefault();
  });

  const hover = (x, y) => {
    overShelf = shelfTileUnder(x, y);
    markShelfTarget(overShelf);
  };

  grid.addEventListener('pointermove', e => {
    if(!dragEl) return;
    e.preventDefault();
    dragScroll.update(e.clientX, e.clientY, hover);

    hover(e.clientX, e.clientY);
    if(overShelf) return;

    const list = tiles();
    const over = list.find(c => {
      if(c === dragEl) return false;
      const r = c.getBoundingClientRect();
      return e.clientX >= r.left && e.clientX <= r.right
          && e.clientY >= r.top  && e.clientY <= r.bottom;
    });
    if(!over) return;
    const to = list.indexOf(over);
    grid.insertBefore(dragEl, to < from ? over : over.nextSibling);
    from = to; moved = true;
  });

  const drop = () => {
    if(!dragEl) return;
    dragScroll.stop();
    dragEl.classList.remove('drag');
    dragEl = null;

    if(overShelf){
      const target = overShelf.dataset.shelfName;
      markShelfTarget(null);
      overShelf = null;
      const it = DB.items.find(i => i.uid === dragUid);
      if(moveToShelf(it, target)){
        save(); renderAll();
        toast('Moved to shelf ' + target);
      } else {
        renderList();
      }
      return;
    }

    if(!moved) return;
    justDragged = Date.now();          /* the click that follows isn't a tap */
    renumberFromDom(tiles());
    save();
    renderShelfGrid();
    toast('Order saved');
  };
  grid.addEventListener('pointerup', drop);
  grid.addEventListener('pointercancel', drop);

  /* same tap-to-lift, tap-to-place as the rail */
  grid.addEventListener('click', e => {
    if(!recEdit) return;
    e.stopPropagation();
    e.preventDefault();
    if(Date.now() - justDragged < 300) return;
    const rec = e.target.closest('.rec');
    if(rec) tapRecord(rec.dataset.uid);
  }, true);
})();

/* ── flick-through rail: drag a spine to move the record ────
   The rail scrolls horizontally, so while arranging we take over the
   pointer (touch-action:none in CSS) and nudge the scroll ourselves
   near the edges — otherwise you could only ever move a record as far
   as the visible window. */
$('#btnCrateArrange').onclick = () => {
  crateEdit = !crateEdit;
  if(!crateEdit){
    setPicked(null);                    /* don't leave one lifted */
    if(!recEdit) return exitSel();      /* nor a set ticked with no bar to act on it */
  }
  updateCrateBar();
};

(function wireCrateDrag(){
  const rail = $('#crate');
  let dragEl = null, dragUid = '', from = -1, moved = false, overShelf = null;

  const spines = () => [...rail.querySelectorAll('.spine')];

  rail.addEventListener('pointerdown', e => {
    if(!crateEdit || selMode) return;    /* while selecting, a press is a tick */
    const sp = e.target.closest('.spine');
    if(!sp) return;
    dragEl = sp; dragUid = sp.dataset.uid; moved = false; overShelf = null;
    from = spines().indexOf(sp);
    try{ sp.setPointerCapture(e.pointerId); }catch(err){}
    sp.classList.add('drag');
    e.preventDefault();
  });

  const hover = (x, y) => {
    overShelf = shelfTileUnder(x, y);
    markShelfTarget(overShelf);
  };

  rail.addEventListener('pointermove', e => {
    if(!dragEl) return;
    e.preventDefault();
    dragScroll.update(e.clientX, e.clientY, hover);

    /* over a shelf tile? then this is a move, not a reorder */
    hover(e.clientX, e.clientY);
    if(overShelf) return;

    /* creep along when the finger sits near either end */
    const box = rail.getBoundingClientRect();
    if(e.clientX < box.left + 44)       rail.scrollLeft -= 12;
    else if(e.clientX > box.right - 44) rail.scrollLeft += 12;

    const list = spines();
    const over = list.find(c => {
      if(c === dragEl) return false;
      const r = c.getBoundingClientRect();
      return e.clientX >= r.left && e.clientX <= r.right;
    });
    if(!over) return;
    const to = list.indexOf(over);
    rail.insertBefore(dragEl, to < from ? over : over.nextSibling);
    from = to; moved = true;
  });

  const drop = () => {
    if(!dragEl) return;
    dragScroll.stop();
    dragEl.classList.remove('drag');
    dragEl = null;

    if(overShelf){
      const target = overShelf.dataset.shelfName;
      markShelfTarget(null);
      overShelf = null;
      const it = DB.items.find(i => i.uid === dragUid);
      if(moveToShelf(it, target)){
        save(); renderAll();
        toast('Moved to shelf ' + target);
      } else {
        renderCrate();                    /* dropped on its own shelf */
      }
      return;
    }

    if(!moved) return;
    justDragged = Date.now();          /* the click that follows isn't a tap */
    renumberFromDom(spines());
    save();
    renderShelfGrid();
    if(MODE === 'sleeves' && $('#sort').value === 'shelf') renderGrid();
    toast('Order saved');
  };
  rail.addEventListener('pointerup', drop);
  rail.addEventListener('pointercancel', drop);

  /* In arrange mode a tap lifts or places the record instead of opening
     the sheet. Capture phase, so the document-wide .spine handler that
     opens the sheet never sees it. */
  rail.addEventListener('click', e => {
    if(!crateEdit) return;
    e.stopPropagation();
    e.preventDefault();
    if(Date.now() - justDragged < 300) return;      /* that was a drag */
    const sp = e.target.closest('.spine');
    if(sp) tapRecord(sp.dataset.uid);
  }, true);
})();

/* ── sync panel ─────────────────────────────────────────── */
function fillSyncForm(){
  const cfg = Sync.getCfg();
  if(cfg) $('#syncCfg').value = JSON.stringify(cfg, null, 2);
  $('#syncCode').value = Sync.getCode();
  $('#syncEmail').value = Sync.getEmail();
  if(!Sync.isConnected()) Sync.setStatus(Sync.isOn() ? 'was on — tap Turn sync on to reconnect' : 'Sync is off.');
}

$('#btnSyncOn').onclick = () => {
  try{ Sync.saveSettings($('#syncCfg').value, $('#syncCode').value, $('#syncEmail').value); }
  catch(e){ toast(e.message, 4200); return; }
  Sync.connect({email: $('#syncEmail').value, password: $('#syncPw').value});
};
$('#btnSyncOff').onclick = () => Sync.disconnect();
$('#btnSyncNow').onclick = () => Sync.syncNow();

$('#btnFill').onclick = backfill;
$('#btnImport').onclick = () => { importMode='csv'; $('#file').accept='.csv'; $('#file').click(); };
$('#btnRestore').onclick = () => { importMode='json'; $('#file').accept='.json'; $('#file').click(); };
$('#file').onchange = e => {
  const f = e.target.files[0]; if(!f) return;
  const r = new FileReader();
  r.onload = () => {
    try{
      if(importMode === 'json'){
        const d = JSON.parse(r.result);
        /* new backups wrap the database in .db; older ones were the
           database itself, so both are accepted */
        const db   = (d && d.db) ? d.db : d;
        const sync = (d && d.sync) ? d.sync : null;
        if(!db || !Array.isArray(db.items)) throw 0;

        const n = db.items.length;
        const when = d && d.exported ? String(d.exported).slice(0,10) : null;
        if(!confirm(`Replace your crate with this backup?\n\n`
          + `${n} record${n===1?'':'s'}${when ? `, saved ${when}` : ''}.\n`
          + `You currently have ${DB.items.length}. This cannot be undone.`)) return;

        DB = Object.assign({items:[], shelves:['Main'], token:'', curr:'GBP'}, db);
        const gotSync = sync ? Sync.importSettings(sync) : false;

        /* Write it out now. The old code called load() here, which read
           the PREVIOUS data straight back over the top before the
           debounced save had run — the restore undid itself. */
        store.set('crate.db', DB);
        save();

        $('#tok').value  = DB.token || '';
        $('#bpmKey').value = DB.bpmKey || '';
        $('#curr').value = DB.curr  || 'GBP';
        fillSyncForm();
        renderAll();
        toast(`Restored ${n} record${n===1?'':'s'}`
              + (gotSync ? ' and your sync settings' : ''), 4200);
      } else importCsv(r.result);
    }catch(err){ toast('Could not read that file'); }
  };
  r.readAsText(f); e.target.value='';
};

$('#btnWipe').onclick = () => {
  if(!confirm('Delete every record, shelf and setting? This cannot be undone.')) return;
  if(!confirm('Really sure? Export a backup first if you want one.')) return;
  DB = {items:[], shelves:['Main'], token:'', curr:'GBP'};
  save(); $('#tok').value=''; renderAll(); toast('Wiped');
};

$('#btnHelp').onclick = () => {
  $('#sheetBody').innerHTML = `
    <h3 style="margin:0 0 10px">How Crate works</h3>
    <p class="hint">Scan the barcode on a sleeve and Crate looks it up on Discogs, pulls the artwork, tracklist and lowest current asking price, and files it away. No barcode? Type the catalogue number instead — it works on white labels and 90s 12"s that never had one.</p>
    <p class="hint"><b>No barcode, nothing to type?</b> <i>Read cat. no.</i> points the camera at the code on the spine or centre label; <i>Read cover</i> reads the artist and title off the front. Line it up, tap Read it, check what came back — small stylised print is the hardest thing to read, so it always asks before searching. The reader downloads itself the first time you use it and works offline after that.</p>
    <p class="hint"><b>New records go where you say.</b> <i>File anything new into</i> on the Scan screen picks the crate and whether a record lands at the front or the back of it — set once, and every way of adding follows it: camera, Find, reading a sleeve, or by hand. Filing at the front shifts everything already on that shelf down one. A CSV import ignores it and uses its own Shelf column.</p>
    <p class="hint"><b>Moving a lot at once.</b> Tap <i>arrange records</i>, then <i>select several</i>, and a tap ticks a record instead of lifting it. <i>Select all</i> takes everything on screen — so search, or pick a shelf, and one tap has exactly the run you want. Then tap a shelf to send the lot there, or <i>place them</i> and tap a record to slot them all in just in front of it. They keep the order they were already in, and nothing moves until you tap the destination. <i>Undo</i> in the same row puts the last move back — every move, one at a time or forty at once, drag or tap — and it steps back through the last twenty. It lasts as long as the app is open, so undo a wrong move before you close it.</p>
    <p class="hint"><b>The camera closes on a hit.</b> Scan a sleeve and it shuts itself off, so you can put the record down before tapping Scan for the next one. Look-ups queue and resolve one a second in the background, so Discogs never throttles you.</p>
    <p class="hint"><b>You pick the pressing.</b> One barcode often matches a dozen releases — the original, the reissue, the promo, a foreign copy — and they carry different tracklists and different prices. When there's more than one, Crate shows them all and files nothing until you choose. A queued scan waits as <i>pick one</i> until you tap it, so nothing is lost if you're busy.</p>
    <p class="hint"><b>Values are condition-adjusted.</b> Discogs shows the lowest price anyone is asking, for any condition. Crate grades that against the Goldmine standard using the media and sleeve grades you set, so a G+ copy isn't valued like a Mint one.</p>
    <p class="hint"><b>Your data is yours.</b> Everything lives on this device. The CSV export uses Discogs' own column layout, so it imports straight back into your Discogs collection — and their export imports straight into Crate.</p>
    <p class="hint"><b>BPM and key are yours to enter.</b> No database covers 90s 12"s properly, so open a record and type them in per track — or hit Tap along with the record and Crate works the tempo out. Keys use the Camelot wheel, with the musical key shown next to each one.</p>
    <p class="hint"><b>Or have a look online first.</b> <i>Find tempo &amp; key</i> on a record asks GetSongBPM and AcousticBrainz. Expect gaps — these index streaming catalogues, and white labels, promos and vinyl-only remixes are exactly what they haven't got. It shows you what it matched and how sure it is, and writes nothing until you tick it, because the dangerous answer isn't "not found" — it's a confident number for the wrong mix. Tempo and key data by <a href="https://getsongbpm.com" target="_blank" rel="noopener">GetSongBPM</a> and <a href="https://acousticbrainz.org" target="_blank" rel="noopener">AcousticBrainz</a>.</p>
    <p class="hint"><b>Sorting for a set.</b> Switch to Tracks, pick "Key, then BPM", and your whole collection comes back grouped by key with tempo climbing inside each group. Set a BPM range and a key, tick "harmonically compatible", and you've got every record that'll mix.</p>
    <p class="hint"><b>Offline.</b> Scanning works without a signal after the first load; lookups queue until you're back online.</p>
    <button class="btn quiet" onclick="document.getElementById('scrim').click()" style="margin-top:14px">Got it</button>`;
  $('#scrim').classList.add('on'); $('#sheet').classList.add('on');
};

window.addEventListener('online', () => { if(QUEUE.some(q=>q.state==='waiting')) pump(); });
document.addEventListener('visibilitychange', () => { if(document.hidden) stopCam(); });

/* ── is a newer build live? ─────────────────────────────────
   GitHub Pages serves the page with max-age=600, so a device can sit on
   a stale copy for ten minutes — longer on iOS, longer still from a home
   screen shortcut — while looking completely normal. Diagnosing that has
   cost real time, so the app now asks the question itself.

   Deliberately quiet: it never reloads on its own, because doing that
   under someone's thumb mid-edit would be worse than being out of date.
   It just turns the version in the bar into something you can tap. */
const newerThan = (a, b) => {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for(let i = 0; i < 3; i++){
    const x = pa[i] || 0, y = pb[i] || 0;
    if(x !== y) return x > y;
  }
  return false;
};
async function checkForUpdate(){
  /* nothing to check against on file:// or inside an artifact */
  if(!/^https?:$/.test(location.protocol)) return;
  try{
    /* Reads the live index.html and pulls the version out of the app.js it
       asks for, rather than looking for APP_VERSION — which now lives in
       app.js, not here. That is not just a workaround for the split: the
       <script src> is the authoritative pairing, so this compares the build
       you are running against the build the live page would actually load.
       It is also a fraction of the download it used to be, because
       index.html is now markup only. */
    const r = await fetch(location.pathname + '?cb=' + Date.now(), {cache:'no-store'});
    if(!r.ok) return;
    const m = (await r.text()).match(/app\.js\?v=([^"']+)/);
    if(!m || !newerThan(m[1], APP_VERSION)) return;
    const live = m[1], el = $('#hdrVer');
    if(!el) return;
    el.textContent = 'v' + APP_VERSION + ' → ' + live;
    el.classList.add('upd');
    el.disabled = false;
    el.title = 'Version ' + live + ' is live — tap to load it';
    /* A brand new query string is a URL the cache has never seen, which
       is the one reliable way past it on every device. */
    el.onclick = () => location.replace(location.pathname + '?v=' + live);
    toast('Version ' + live + ' is ready — tap the version in the bar to load it', 6000);
  }catch(e){ /* offline, or Pages hiccuping: say nothing */ }
}

/* go */
(async () => {
  await load();
  renderAll(); renderQueue();
  $('#appVer').textContent = APP_VERSION;
  $('#hdrVer').textContent = 'v' + APP_VERSION;
  checkForUpdate();
  fillSyncForm();
  /* Firebase keeps the sign-in from last time, so reconnect quietly.
     If it needs a password the panel says so rather than nagging. */
  if(Sync.isOn()) Sync.connect({silent:true});
  if(!DB.token){
    document.querySelector('nav button[data-v="setup"]').click();
    toast('Add your Discogs token to get started', 4200);
  }
})();
