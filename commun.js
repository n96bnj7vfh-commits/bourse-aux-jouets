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
  // Après la connexion, le téléphone ne garde PAS le code PIN : seulement un jeton donné par le serveur
  // (valable 4 jours, annulé si le PIN change). Le PIN n'est envoyé qu'au moment de la connexion.
  const session = { pin: '', jeton: '', caisse: '' };
  async function api(action, params) {
    const ctrl = new AbortController();
    const minuterie = setTimeout(() => ctrl.abort(), 25000);
    try {
      const ident = session.jeton ? { jeton: session.jeton } : { pin: session.pin };
      const corps = Object.assign({ action, appareil: appareil(), caisse: session.caisse }, ident, params || {});
      const rep = await fetch(CONFIG.API, {
        method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(corps), signal: ctrl.signal,
      });
      const r = await rep.json(); // { ok: true, ... } ou { ok: false, erreur }
      if (action !== 'connexion') siSessionExpiree(r);
      return r;
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
          // Image en 4:3 « paysage » : moins haute à l'écran, sans recadrage (le viseur reste exact)
          { fps: 10, aspectRatio: 4 / 3, qrbox: (w, h) => { const s = Math.max(80, Math.floor(Math.min(w, h) * VISEURS[viseur])); return { width: s, height: s }; } },
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

  // Le premier appui n'importe où débloque le son (iPhone)
  document.addEventListener('pointerdown', debloquerSon, { passive: true });

  // ---------- Modes ----------
  const MODES = {
    preparation: ['Préparation', '#6b7280'], listing: ['Listing (dépôt)', '#3b82f6'], vente: ['Vente', '#1f8a4c'],
    restitution: ['Restitution', '#b7791f'], cloture: ['Clôture', '#6b7280'],
  };
  function badgeMode(mode) {
    const m = MODES[mode] || [mode, '#6b7280'];
    return `<span class="pastille"><span style="width:9px;height:9px;border-radius:50%;background:${m[1]}"></span>${esc(m[0])}</span>`;
  }

  // ---------- Connexion par code PIN (écran plein) ----------
  // opts : { titre, roles: ['listing'], cle: 'pinListing', session: true pour ne garder le code que dans l'onglet }
  // Renvoie une promesse résolue avec la réponse « connexion » ({ role, mode, edition, taux }).
  function connexion(opts) {
    const st = opts.session ? sessionStorage : localStorage;
    return new Promise(resolve => {
      const div = document.createElement('div');
      div.className = 'plein';
      div.innerHTML = `<div class="card"><h2>${esc(opts.titre)}</h2>
        <p class="note" style="margin-top:8px">Code PIN ${esc(opts.nomCode || opts.roles[0])} :</p>
        <input type="password" inputmode="numeric" autocomplete="off" style="width:100%;text-align:center;font-size:22px;letter-spacing:6px">
        <p class="msg err"></p><button class="btn p big">Entrer</button></div>`;
      document.body.appendChild(div);
      const champ = div.querySelector('input'), msg = div.querySelector('.msg'), bouton = div.querySelector('button');
      // ident = { pin } (saisi) ou { jeton } (mémorisé sur l'appareil)
      async function essayer(ident, discret) {
        session.pin = ident.pin || ''; session.jeton = ident.jeton || '';
        bouton.disabled = true;
        try {
          const r = await BJ.api('connexion');
          if (r.ok && (opts.roles.includes(r.role) || r.role === 'admin')) {
            session.pin = '';                    // le PIN est oublié tout de suite
            session.jeton = r.jeton || session.jeton;
            st.setItem(opts.cle, session.jeton);  // seul le jeton est gardé
            div.remove();
            resolve(r);
            return;
          }
          if (!discret) msg.textContent = r.ok ? "Ce code ne donne pas accès à cet écran." : r.erreur;
        } catch (e) {
          if (!discret) msg.textContent = 'Pas de réseau : impossible de vérifier le code.';
        } finally {
          bouton.disabled = false;
        }
        session.pin = ''; session.jeton = '';
        st.removeItem(opts.cle);
        champ.focus();
      }
      bouton.onclick = () => { const v = champ.value.trim(); if (v) essayer({ pin: v }, false); else msg.textContent = 'Tapez le code PIN.'; };
      champ.onkeydown = e => { if (e.key === 'Enter') bouton.onclick(); };
      ['pinListing', 'pinRestitution', 'pinAdmin'].forEach(k => { localStorage.removeItem(k); sessionStorage.removeItem(k); }); // anciennes versions : PIN en clair
      cleSession = opts.cle;
      const memo = st.getItem(opts.cle);
      if (memo) essayer({ jeton: memo }, true); else champ.focus();
    });
  }
  let cleSession = '';
  function deconnexion(cle) {
    localStorage.removeItem(cle || cleSession); sessionStorage.removeItem(cle || cleSession);
    session.pin = ''; session.jeton = '';
    location.reload();
  }
  // Jeton expiré ou PIN changé pendant l'utilisation : retour à l'écran de connexion
  // (la caisse remplace ce comportement pour ne rien perdre de sa file d'attente)
  let surSessionExpiree = () => deconnexion();
  function siSessionExpiree(r) {
    if (r && !r.ok && /Session expirée/.test(r.erreur || '')) surSessionExpiree();
    return r;
  }

  return { $, esc, deux, eur, eur2, appareil, uid, session, api, lireCode, debloquerSon, son, garderEcranAllume, relacherEcran,
    creerScanner, expliquerErreurCamera, MODES, badgeMode, connexion, deconnexion,
    set surSessionExpiree(f) { surSessionExpiree = f; } };
})();
