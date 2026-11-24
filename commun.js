// Bourse aux jouets – fonctions communes aux écrans (serveur, sons, scanner, formats)
const BJ = (() => {
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const deux = n => String(n).padStart(2, '0');
  const eur = v => v == null ? '—' : (Number.isInteger(v) ? v + ' €' : v.toFixed(2).replace('.', ',') + ' €');
  const eur2 = v => (Number(v) || 0).toFixed(2).replace('.', ',') + ' €';

  // ---------- Identifiants ----------
  function appareil() {
    let a = localStorage.getItem('appareil');
    if (!a) { a = 'app-' + Math.random().toString(36).slice(2, 10); localStorage.setItem('appareil', a); }
    return a;
  }
  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
  }

  // ---------- Serveur ----------
  // POST en text/plain : requête « simple », sans pré-vérification CORS.
  const session = { pin: '', caisse: '' };
  async function api(action, params) {
    const ctrl = new AbortController();
    const minuterie = setTimeout(() => ctrl.abort(), 25000);
    try {
      const corps = Object.assign({ action, pin: session.pin, appareil: appareil(), caisse: session.caisse }, params || {});
      const rep = await fetch(CONFIG.API, {
        method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(corps), signal: ctrl.signal,
      });
      return await rep.json(); // { ok: true, ... } ou { ok: false, erreur }
    } finally {
      clearTimeout(minuterie);
    } // une exception = problème réseau (à réessayer)
  }

  // ---------- Codes ----------
  // « 27-A1-03 » -> { ed: '27', kind: 'art', code: 'A1-03' } ; « A1 » -> { ed: null, kind: 'grille', code: 'A1' }
  function lireCode(brut) {
    let s = String(brut == null ? '' : brut).trim().toUpperCase().replace(/\s/g, '');
    let ed = null;
    const m = s.match(/^(\d{2})-(.+)$/);
    if (m) { ed = m[1]; s = m[2]; }
    let k = s.match(/^([A-Z])(\d{1,2})-(\d{1,2})$/);
    if (k && +k[2] >= 1 && +k[3] >= 1 && +k[3] <= 8) return { ed, kind: 'art', code: k[1] + (+k[2]) + '-' + deux(+k[3]) };
    k = s.match(/^([A-Z])(\d{1,2})$/);
    if (k && +k[2] >= 1) return { ed, kind: 'grille', code: k[1] + (+k[2]) };
    return { ed, kind: null, code: s };
  }

  // ---------- Sons (débloqués par un premier appui, obligatoire sur iPhone) ----------
  let audio = null;
  function debloquerSon() {
    try {
      if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === 'suspended') audio.resume();
    } catch (e) { /* pas de son */ }
  }
  function ton(freq, debut, duree, vol, type) {
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, audio.currentTime + debut);
    g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + debut + duree);
    o.connect(g).connect(audio.destination);
    o.start(audio.currentTime + debut); o.stop(audio.currentTime + debut + duree + 0.02);
  }
  function son(type) {
    try {
      if (audio) {
        if (type === 'ok') ton(1500, 0, 0.12, 0.3, 'square');
        if (type === 'doux') ton(600, 0, 0.18, 0.12, 'sine');
        if (type === 'erreur') { ton(220, 0, 0.18, 0.3, 'sawtooth'); ton(180, 0.22, 0.25, 0.3, 'sawtooth'); }
        if (type === 'caisse') { ton(880, 0, 0.1, 0.2, 'sine'); ton(1320, 0.12, 0.18, 0.2, 'sine'); }
      }
      if (navigator.vibrate) navigator.vibrate(type === 'erreur' ? [80, 60, 80] : 40);
    } catch (e) { /* ignorer */ }
  }

  // ---------- Écran maintenu allumé, relâché après 2 min sans scan ----------
  let verrou = null, minuterieVerrou = null;
  async function garderEcranAllume() {
    clearTimeout(minuterieVerrou);
    minuterieVerrou = setTimeout(relacherEcran, 120000);
    if (verrou || !('wakeLock' in navigator) || document.hidden) return;
    try {
      verrou = await navigator.wakeLock.request('screen');
      verrou.addEventListener('release', () => { verrou = null; });
    } catch (e) { verrou = null; }
  }
  function relacherEcran() {
    clearTimeout(minuterieVerrou);
    if (verrou) { verrou.release().catch(() => {}); verrou = null; }
  }

  // ---------- Scanner (caméra en continu, zoom, viseur) ----------
  // Le même code relu en moins de 3 s est ignoré (le QR reste souvent plusieurs images devant la caméra).
  const VISEURS = { petit: 0.4, moyen: 0.6, grand: 0.85 };
  function creerScanner(idVideo, idReglages, surCode) {
    let sc = null, actif = false, demarrage = null, dernier = null, dernierT = 0;
    let viseur = localStorage.getItem('viseur') || 'moyen';
    const reglages = $(idReglages);
    reglages.innerHTML = `
      <div class="reglage"><span>Viseur</span><div class="puces" data-r="viseur">
        <button data-v="petit">Petit</button><button data-v="moyen">Moyen</button><button data-v="grand">Grand</button></div></div>
      <div class="reglage" data-r="zoom" hidden><span>Zoom</span><div class="puces" data-r="zpuces"></div></div>`;
    const marquerViseur = () => reglages.querySelectorAll('[data-r=viseur] button').forEach(b => b.classList.toggle('on', b.dataset.v === viseur));
    marquerViseur();
    reglages.querySelectorAll('[data-r=viseur] button').forEach(b => b.onclick = async () => {
      viseur = b.dataset.v; localStorage.setItem('viseur', viseur); marquerViseur();
      if (actif) { await arreter(); demarrer(); } // le viseur ne change qu'au redémarrage
    });

    function lu(texte) {
      const t = Date.now();
      if (texte === dernier && t - dernierT < 3000) { dernierT = t; return; }
      dernier = texte; dernierT = t;
      garderEcranAllume();
      surCode(texte);
    }

    async function demarrer() {
      if (actif || demarrage) return demarrage;
      demarrage = (async () => {
        if (typeof Html5Qrcode === 'undefined') throw new Error('bibliothèque de scan non chargée (réseau ?)');
        sc = sc || new Html5Qrcode(idVideo, { formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE], verbose: false });
        await sc.start({ facingMode: 'environment' },
          { fps: 10, qrbox: (w, h) => { const s = Math.max(80, Math.floor(Math.min(w, h) * VISEURS[viseur])); return { width: s, height: s }; } },
          lu, () => {});
        actif = true;
        installerZoom();
        garderEcranAllume();
      })();
      try { await demarrage; } finally { demarrage = null; }
    }

    async function arreter() {
      if (demarrage) { try { await demarrage; } catch (e) { /* ignoré */ } }
      if (sc && actif) { try { await sc.stop(); } catch (e) { /* déjà arrêté */ } }
      actif = false;
      reglages.querySelector('[data-r=zoom]').hidden = true;
      relacherEcran();
    }

    function installerZoom() {
      const boite = reglages.querySelector('[data-r=zoom]');
      let z;
      try { z = sc.getRunningTrackCapabilities().zoom; } catch (e) { z = null; }
      if (!z || !(z.max > z.min)) { boite.hidden = true; return; }
      const choix = [1, 1.5, 2, 3, 4].filter(v => v >= z.min && v <= z.max);
      const puces = boite.querySelector('[data-r=zpuces]');
      puces.innerHTML = choix.map(v => `<button data-z="${v}">${String(v).replace('.', ',')}×</button>`).join('');
      const appliquer = v => {
        localStorage.setItem('zoom', v);
        puces.querySelectorAll('button').forEach(b => b.classList.toggle('on', +b.dataset.z === v));
        sc.applyVideoConstraints({ advanced: [{ zoom: v }] }).catch(() => {});
      };
      puces.querySelectorAll('button').forEach(b => b.onclick = () => appliquer(+b.dataset.z));
      const mem = parseFloat(localStorage.getItem('zoom'));
      appliquer(choix.includes(mem) ? mem : choix[0]);
      boite.hidden = false;
    }

    return { demarrer, arreter, get actif() { return actif; } };
  }

  function expliquerErreurCamera(e) {
    const s = String(e && (e.name || e.message || e));
    if (!window.isSecureContext) return 'la page doit être ouverte en https://';
    if (/NotAllowed|Permission/i.test(s)) return 'caméra refusée. Autorisez-la dans les réglages du navigateur, puis rechargez la page.';
    if (/NotFound|Overconstrained/i.test(s)) return 'aucune caméra arrière trouvée.';
    if (/NotReadable|in use/i.test(s)) return 'caméra déjà utilisée par une autre appli.';
    return s;
  }

  return { $, esc, deux, eur, eur2, appareil, uid, session, api, lireCode, debloquerSon, son, garderEcranAllume, relacherEcran, creerScanner, expliquerErreurCamera };
})();
