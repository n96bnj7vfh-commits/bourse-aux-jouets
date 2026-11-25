/**
 * Bourse aux jouets – Caisse QR – serveur Google Apps Script
 * ----------------------------------------------------------
 * À coller dans le Google Sheet : Extensions > Apps Script.
 * Aucun code PIN n'est écrit ici : ils se définissent par le menu
 * « Caisse QR > 2. Définir les codes PIN » (stockés chiffrés dans les propriétés du script).
 *
 * Les pages web envoient des requêtes POST en text/plain contenant du JSON :
 *   { "action": "...", "pin": "...", "appareil": "...", "caisse": "...", ...paramètres }
 * Réponse : { "ok": true, ... } ou { "ok": false, "erreur": "message lisible" }
 */

// Numéro de version : augmenté à CHAQUE modification de ce fichier (règle du projet).
const VERSION = '1.5';

// ---------- Structure du classeur ----------
const ONGLETS = {
  Parametres: ['cle', 'valeur', 'note'],
  Grilles: ['grille', 'statut', 'listee_le', 'restituee_le', 'invendus'],
  Articles: ['code', 'grille', 'n', 'description', 'prix', 'statut', 'vente_id', 'maj'],
  Ventes: ['vente_id', 'recue_le', 'heure_caisse', 'caisse', 'paiement', 'nb', 'total', 'total_caisse', 'codes', 'statut', 'motif', 'anomalies', 'rembourse', 'retours'],
  Journal: ['date', 'role', 'caisse', 'action', 'cible', 'ancien', 'nouveau', 'detail'],
};
const COL = { code: 0, grille: 1, n: 2, description: 3, prix: 4, statut: 5, vente_id: 6, maj: 7 };
const GCOL = { grille: 0, statut: 1, listee_le: 2, restituee_le: 3, invendus: 4 };
const VCOL = { id: 0, recue_le: 1, heure_caisse: 2, caisse: 3, paiement: 4, nb: 5, total: 6, total_caisse: 7, codes: 8, statut: 9, motif: 10, anomalies: 11, rembourse: 12, retours: 13 };
// Nouvelles colonnes : toujours AJOUTÉES À LA FIN (le code lit les colonnes par position).
const PARAMS_DEFAUT = [
  ['edition', '27', "2 derniers chiffres de l'année (27 = 2027)"],
  ['mode', 'preparation', 'preparation, listing, vente, restitution ou cloture'],
  ['taux', '0.15', "part retenue par l'association (0.15 = 15 %)"],
];
// Statuts d'article : vierge (imprimé), depose (prix saisi), vendu, restitue (rendu au vendeur), donne (donné à une asso)

const ROLES = ['listing', 'caisse', 'restitution', 'admin'];
// « repos » : pause entre deux moments (ex. samedi soir) ; seul l'admin peut agir
const MODES = ['preparation', 'listing', 'vente', 'restitution', 'cloture', 'repos'];
const PAIEMENTS = ['especes', 'cheque', 'carte']; // carte : saisie manuelle après « Paiement accepté » sur SumUp
const DUREE_JETON = 4 * 24 * 3600 * 1000;  // une connexion reste valable 4 jours (samedi → mardi)
const SEUIL_BLOCAGE = 30;                   // essais de PIN ratés (tous appareils) avant blocage global
const DUREE_BLOCAGE = 900;                  // secondes (15 min)
const LETTRES = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // toutes sauf I et O

// ---------- Actions disponibles ----------
// roles : rôles autorisés (l'admin peut tout) ; modes : modes où l'action est permise ; ecrit : modifie le classeur
const ACTIONS = {
  connexion:     { roles: ROLES, fn: aConnexion },
  grille:        { roles: ['listing', 'restitution'], fn: aGrille },
  listing:       { roles: ['listing'], modes: ['listing'], ecrit: true, fn: aListing },
  prix:          { roles: ['caisse'], fn: aPrix },
  // Ventes acceptées aussi en Restitution et Clôture : une caisse hors ligne peut envoyer ses ventes en retard
  // (sinon une vente refusée bloquerait toute la file d'attente du téléphone).
  vente:         { roles: ['caisse'], modes: ['vente', 'restitution', 'cloture'], ecrit: true, fn: aVente },
  restitution:   { roles: ['restitution'], fn: aRestitution },
  restituer:     { roles: ['restitution'], modes: ['restitution'], ecrit: true, fn: aRestituer },
  mode:          { roles: [], ecrit: true, fn: aMode },
  tableau:       { roles: [], fn: aTableau },
  recherche:     { roles: [], fn: aRecherche },
  corriger_prix: { roles: [], ecrit: true, fn: aCorrigerPrix },
  annuler_vente: { roles: [], ecrit: true, fn: aAnnulerVente },
  retour:        { roles: [], ecrit: true, fn: aRetour },
  journal:       { roles: [], fn: aJournal },
  ventes:        { roles: [], fn: aVentes },
  sauvegarde:    { roles: [], ecrit: true, fn: aSauvegarde },
  generer:       { roles: [], ecrit: true, fn: aGenerer },
  // Listing : toutes les grilles et tous les articles d'un coup (ouverture instantanée d'une grille sur le téléphone)
  catalogue:     { roles: ['listing'], fn: aCatalogue },
  // Bac à sable (tests) : seulement en mode Préparation
  reinitialiser: { roles: [], modes: ['preparation'], ecrit: true, fn: aReinitialiser },
  donnees_test:  { roles: [], modes: ['preparation'], ecrit: true, fn: aDonneesTest },
};

// =====================================================================
// Point d'entrée web
// =====================================================================
function doPost(e) {
  let req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return json({ ok: false, erreur: 'Requête illisible.' });
  }
  try {
    return json(traiter(req));
  } catch (err) {
    return json({ ok: false, erreur: err && err.message ? err.message : String(err) });
  }
}

function doGet() {
  return json({ ok: true, message: 'Caisse QR : serveur actif', version: VERSION });
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function traiter(req) {
  const def = ACTIONS[req.action];
  if (!def) throw new Error('Action inconnue.');
  const auth = authentifier(req);
  const role = auth.role;
  if (role !== 'admin' && def.roles.indexOf(role) < 0) {
    throw new Error("Ce code PIN ne donne pas accès à cette fonction.");
  }
  const ctx = { role: role, caisse: texte(req.caisse, 20), req: req, journal: [], auth: auth };

  if (!def.ecrit) {
    ctx.params = lireParams();
    verifierMode(def, ctx.params, role, req.action);
    return Object.assign({ ok: true }, def.fn(ctx));
  }

  // Écriture : une seule à la fois (plusieurs caisses en même temps)
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) throw new Error('Serveur occupé, réessayez dans un instant.');
  try {
    ctx.params = lireParams();
    verifierMode(def, ctx.params, role, req.action);
    const res = def.fn(ctx);
    ecrireJournal(ctx);
    SpreadsheetApp.flush();
    return Object.assign({ ok: true }, res);
  } finally {
    lock.releaseLock();
  }
}

function verifierMode(def, params, role, action) {
  // Mode Repos : application en pause, seul l'admin agit (les autres peuvent juste connaître le mode)
  if (params.mode === 'repos' && role !== 'admin' && action !== 'connexion') {
    throw new Error('Impossible dans le mode actuel (« repos ») : application en pause, attendez que l\'admin la rouvre.');
  }
  if (def.modes && def.modes.indexOf(params.mode) < 0) {
    throw new Error('Impossible dans le mode actuel (« ' + params.mode + ' »).');
  }
}

// =====================================================================
// Codes PIN
// =====================================================================
function hashPin(pin) {
  const sel = PropertiesService.getScriptProperties().getProperty('SEL') || '';
  const d = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, sel + '|' + pin, Utilities.Charset.UTF_8);
  return d.map(function (b) { return ((b + 256) % 256).toString(16).padStart(2, '0'); }).join('');
}

/**
 * Authentification d'une requête :
 *  - par JETON (après une connexion réussie) : le téléphone ne garde plus le PIN, seulement ce jeton,
 *    valable 4 jours et annulé dès que le PIN du rôle change ;
 *  - par PIN (écran de connexion) : essais limités par appareil ET au total (blocage global).
 * Le blocage global ne touche que les connexions par PIN : les téléphones déjà connectés continuent.
 */
function authentifier(req) {
  if (req.jeton) {
    const j = lireJetons()[String(req.jeton)];
    const props = PropertiesService.getScriptProperties();
    if (j && j[1] > Date.now() && j[2] === empreinte(props.getProperty('PIN_' + j[0]))) return { role: j[0], jeton: String(req.jeton) };
    throw new Error('Session expirée ou code PIN changé : retapez le code PIN.');
  }
  return { role: verifierPin(req.pin, req.appareil), parPin: true };
}

function verifierPin(pin, appareil) {
  pin = String(pin == null ? '' : pin).trim();
  const cache = CacheService.getScriptCache();
  if (cache.get('blocage_global')) {
    throw new Error("Trop d'essais de code PIN : connexions bloquées 15 minutes. Les téléphones déjà connectés continuent de fonctionner.");
  }
  const props = PropertiesService.getScriptProperties();
  if (pin) {
    const h = hashPin(pin);
    for (let i = 0; i < ROLES.length; i++) {
      if (props.getProperty('PIN_' + ROLES[i]) === h) return ROLES[i];
    }
  }
  // Échec : on limite les essais par appareil (contournable) ET au total (blocage global)
  const cleApp = 'echecs_' + String(appareil || 'inconnu').slice(0, 60);
  const nApp = Number(cache.get(cleApp) || 0) + 1;
  const nTous = Number(cache.get('echecs_tous') || 0) + 1;
  cache.put(cleApp, String(nApp), 300);
  cache.put('echecs_tous', String(nTous), DUREE_BLOCAGE);
  if (nTous >= SEUIL_BLOCAGE) {
    cache.put('blocage_global', '1', DUREE_BLOCAGE);
    cache.put('echecs_tous', '0', DUREE_BLOCAGE);
    try { ecrireJournal({ role: 'serveur', caisse: '', journal: [['blocage_pin', '', '', 'bloqué 15 min', nTous + ' essais de PIN ratés']] }); } catch (e) { /* journal facultatif */ }
  }
  Utilities.sleep(nTous > 10 ? 3000 : 800);
  if (nApp > 5) throw new Error("Trop d'essais de code PIN sur cet appareil : attendez 5 minutes.");
  throw new Error('Code PIN incorrect.');
}

// Empreinte courte du PIN d'un rôle : un changement de PIN annule tous les jetons de ce rôle
function empreinte(hash) { return String(hash || '').slice(0, 16); }

function lireJetons() {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty('JETONS') || '{}'); } catch (e) { return {}; }
}

function creerJeton(role) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const props = PropertiesService.getScriptProperties();
    const j = lireJetons(), maintenant = Date.now();
    // ménage : jetons expirés, et au plus 80 jetons (les plus anciens partent)
    Object.keys(j).forEach(function (k) { if (j[k][1] < maintenant) delete j[k]; });
    const cles = Object.keys(j).sort(function (a, b) { return j[a][1] - j[b][1]; });
    while (cles.length >= 80) delete j[cles.shift()];
    const id = Utilities.getUuid().replace(/-/g, '');
    j[id] = [role, maintenant + DUREE_JETON, empreinte(props.getProperty('PIN_' + role))];
    props.setProperty('JETONS', JSON.stringify(j));
    return id;
  } finally {
    lock.releaseLock();
  }
}

// =====================================================================
// Actions
// =====================================================================
function aConnexion(ctx) {
  const jeton = ctx.auth.parPin ? creerJeton(ctx.role) : ctx.auth.jeton;
  return { role: ctx.role, mode: ctx.params.mode, edition: ctx.params.edition, taux: ctx.params.taux, version: VERSION, jeton: jeton };
}

function aGrille(ctx) {
  const g = lireCodeGrille(ctx.req.grille, ctx.params.edition);
  return detailGrille(g, charger('Grilles'), charger('Articles'));
}

function aListing(ctx) {
  const ed = ctx.params.edition;
  const g = lireCodeGrille(ctx.req.grille, ed);
  const G = charger('Grilles'), A = charger('Articles');
  const gi = trouver(G, GCOL.grille, g);
  if (gi < 0) throw new Error('Grille inconnue : ' + court(g) + " (elle n'a pas été générée).");
  if (G.lignes[gi][GCOL.statut] === 'restituee') throw new Error('Grille ' + court(g) + ' déjà restituée.');

  const liste = Array.isArray(ctx.req.articles) ? ctx.req.articles : [];
  const idx = indexer(A, COL.code);
  // On vérifie tout avant de modifier quoi que ce soit
  const modifs = liste.map(function (a) {
    const n = Number(a.n);
    if (!(n >= 1 && n <= 8 && n === Math.floor(n))) throw new Error("Numéro d'article invalide : " + a.n);
    const code = g + '-' + deux(n);
    const i = idx[code];
    if (i == null) throw new Error('Article inconnu : ' + court(code));
    const r = A.lignes[i];
    if (r[COL.statut] !== 'vierge' && r[COL.statut] !== 'depose') {
      throw new Error('Article ' + court(code) + ' : déjà « ' + r[COL.statut] + ' », modification impossible.');
    }
    const vide = a.prix === '' || a.prix == null;
    return { i: i, code: code, prix: vide ? '' : prixValide(a.prix, court(code)), desc: texte(a.description, 200) };
  });

  modifs.forEach(function (m) {
    const r = A.lignes[m.i];
    if (m.prix === r[COL.prix] && m.desc === String(r[COL.description])) return;
    const ancien = resume(r[COL.prix], r[COL.description]);
    r[COL.prix] = m.prix;
    r[COL.description] = m.desc;
    r[COL.statut] = m.prix === '' ? 'vierge' : 'depose';
    r[COL.maj] = new Date();
    A.modifie = true;
    ctx.journal.push(['listing', m.code, ancien, resume(m.prix, m.desc)]);
  });

  const deposes = A.lignes.filter(function (r) { return r[COL.grille] === g && r[COL.statut] === 'depose'; }).length;
  const rg = G.lignes[gi];
  const statut = deposes ? 'listee' : 'vierge';
  if (rg[GCOL.statut] !== statut) {
    rg[GCOL.statut] = statut;
    if (statut === 'listee' && !rg[GCOL.listee_le]) rg[GCOL.listee_le] = new Date();
    G.modifie = true;
  }
  sauver(A); sauver(G);
  return detailGrille(g, G, A);
}

function aPrix(ctx) {
  const A = charger('Articles');
  const articles = [];
  A.lignes.forEach(function (r) {
    if (r[COL.statut] === 'depose' || r[COL.statut] === 'vendu') {
      articles.push([r[COL.code], r[COL.prix], String(r[COL.description]), r[COL.statut]]);
    }
  });
  return { edition: ctx.params.edition, mode: ctx.params.mode, articles: articles, horodatage: new Date().toISOString() };
}

function aVente(ctx) {
  const req = ctx.req, ed = ctx.params.edition;
  const id = texte(req.vente_id, 64);
  if (!id) throw new Error('Identifiant de vente manquant.');
  const paiement = String(req.paiement || '');
  if (PAIEMENTS.indexOf(paiement) < 0) throw new Error('Moyen de paiement invalide.');

  const V = charger('Ventes');
  if (trouver(V, VCOL.id, id) >= 0) return { vente_id: id, doublon: true, mode: ctx.params.mode }; // déjà reçue (renvoi de la file d'attente)

  const bruts = Array.isArray(req.codes) ? req.codes : [];
  if (!bruts.length) throw new Error('Vente vide.');

  const A = charger('Articles');
  const idx = indexer(A, COL.code);
  const vus = {}, codes = [], anomalies = [];
  let total = 0;
  bruts.forEach(function (c) {
    let code;
    try { code = lireCodeArticle(c, ed); } catch (e) { anomalies.push(String(c) + ' : ' + e.message); return; }
    if (vus[code]) return;
    vus[code] = true;
    codes.push(code);
    const i = idx[code];
    if (i == null) { anomalies.push(court(code) + ' : inconnu'); return; }
    const r = A.lignes[i];
    if (r[COL.statut] === 'depose') {
      r[COL.statut] = 'vendu';
      r[COL.vente_id] = id;
      r[COL.maj] = new Date();
      total += Number(r[COL.prix]) || 0;
      A.modifie = true;
    } else if (r[COL.statut] === 'vendu') {
      anomalies.push(court(code) + ' : déjà vendu (vente ' + r[COL.vente_id] + ')');
    } else {
      anomalies.push(court(code) + ' : statut « ' + r[COL.statut] + ' »');
    }
  });
  total = arrondi(total);
  const totalCaisse = req.total == null || req.total === '' ? '' : Number(req.total);
  if (totalCaisse !== '' && Math.abs(totalCaisse - total) > 0.001) {
    anomalies.push('total caisse ' + totalCaisse + ' € ≠ total calculé ' + total + ' €');
  }
  const heure = req.heure ? new Date(req.heure) : '';
  V.nouvelles = [[id, new Date(), isNaN(heure) ? '' : heure, ctx.caisse, paiement, codes.length, total, totalCaisse,
    codes.map(court).join(', '), anomalies.length ? 'a_verifier' : 'ok', '', anomalies.join(' ; '), 0, '']];
  if (V.nouvelles[0].length !== V.nc) throw new Error('Erreur interne : nombre de colonnes de la vente.');
  sauver(A); sauver(V);
  ctx.journal.push(['vente', id, '', total, codes.length + ' article(s), ' + paiement + (anomalies.length ? ' – À VÉRIFIER' : '')]);
  return { vente_id: id, total: total, anomalies: anomalies, mode: ctx.params.mode };
}

function aRestitution(ctx) {
  const gs = listeGrilles(ctx.req.grilles, ctx.params.edition);
  return bilanRestitution(gs, charger('Grilles'), charger('Articles'), ctx.params.taux);
}

function aRestituer(ctx) {
  const ed = ctx.params.edition;
  const gs = listeGrilles(ctx.req.grilles, ed);
  // Invendus donnés à une association : tous (ancien bouton) ou seulement ceux listés (codes)
  const tousDonnes = ctx.req.invendus === 'donnes';
  const donnes = {};
  (Array.isArray(ctx.req.donnes) ? ctx.req.donnes : []).forEach(function (c) { donnes[lireCodeArticle(c, ed)] = true; });
  const G = charger('Grilles'), A = charger('Articles');
  gs.forEach(function (g) {
    const gi = trouver(G, GCOL.grille, g);
    if (gi < 0) throw new Error('Grille inconnue : ' + court(g));
  });
  gs.forEach(function (g) {
    const rg = G.lignes[trouver(G, GCOL.grille, g)];
    if (rg[GCOL.statut] === 'restituee') return; // déjà fait : on ne refait rien
    let nR = 0, nD = 0;
    A.lignes.forEach(function (r) {
      if (r[COL.grille] === g && r[COL.statut] === 'depose') {
        const donne = tousDonnes || donnes[r[COL.code]];
        r[COL.statut] = donne ? 'donne' : 'restitue';
        r[COL.maj] = new Date();
        if (donne) nD++; else nR++;
      }
    });
    rg[GCOL.statut] = 'restituee';
    rg[GCOL.restituee_le] = new Date();
    rg[GCOL.invendus] = [nR ? nR + ' rendu(s)' : '', nD ? nD + ' donné(s)' : ''].filter(Boolean).join(', ');
    A.modifie = G.modifie = true;
    ctx.journal.push(['restitution', court(g), '', 'restituée', nR + ' invendu(s) rendu(s), ' + nD + ' donné(s)']);
  });
  sauver(A); sauver(G);
  return bilanRestitution(gs, G, A, ctx.params.taux);
}

function aMode(ctx) {
  const m = String(ctx.req.mode || '');
  if (MODES.indexOf(m) < 0) throw new Error('Mode inconnu : ' + m);
  const ancien = ctx.params.mode;
  const res = { mode: m };
  if (m !== ancien) {
    ecrireParam('mode', m);
    ctx.journal.push(['mode', '', ancien, m]);
    // Fin du listing : copie datée du classeur dans Drive (sans bloquer le changement de mode si elle échoue)
    if (m === 'vente' && (ancien === 'listing' || ancien === 'repos')) { // repos possible entre listing et vente
      try {
        res.sauvegarde = sauvegarder('fin de listing');
        ctx.journal.push(['sauvegarde', res.sauvegarde.nom, '', '', 'automatique (fin de listing)']);
      } catch (e) {
        res.sauvegarde_erreur = e.message || String(e);
        ctx.journal.push(['sauvegarde', '', '', 'ÉCHEC', res.sauvegarde_erreur]);
      }
    }
  }
  return res;
}

function aSauvegarde(ctx) {
  const s = sauvegarder('manuelle');
  ctx.journal.push(['sauvegarde', s.nom, '', '', 'manuelle']);
  return { sauvegarde: s };
}

/** Copie datée du classeur dans le dossier Drive « Bourse aux jouets – sauvegardes ». */
function sauvegarder(motif) {
  const ss = SpreadsheetApp.getActive();
  const nomDossier = 'Bourse aux jouets – sauvegardes';
  const it = DriveApp.getFoldersByName(nomDossier);
  const dossier = it.hasNext() ? it.next() : DriveApp.createFolder(nomDossier);
  const date = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH'h'mm");
  const nom = ss.getName() + ' – sauvegarde ' + motif + ' – ' + date;
  SpreadsheetApp.flush();
  const copie = DriveApp.getFileById(ss.getId()).makeCopy(nom, dossier);
  return { nom: nom, url: copie.getUrl(), dossier: dossier.getUrl() };
}

function aTableau(ctx) {
  const A = charger('Articles'), V = charger('Ventes'), taux = ctx.params.taux;
  const articles = {};
  // Stock : articles déposés (en vente + déjà vendus + rendus/donnés) et ce qui reste en vente, avec leur valeur
  let nbDeposes = 0, valeurDeposee = 0, nbEnVente = 0, valeurEnVente = 0;
  A.lignes.forEach(function (r) {
    const s = r[COL.statut], p = Number(r[COL.prix]) || 0;
    articles[s] = (articles[s] || 0) + 1;
    if (s !== 'vierge') { nbDeposes++; valeurDeposee += p; }
    if (s === 'depose') { nbEnVente++; valeurEnVente += p; }
  });
  let nb = 0, ca = 0, aVerifier = 0, annulees = 0, rembourse = 0;
  const caisses = {};
  V.lignes.forEach(function (r) {
    if (r[VCOL.statut] === 'annulee') { annulees++; return; }
    nb++;
    const remb = Number(r[VCOL.rembourse]) || 0; // articles retirés (retours) : remboursés au client
    rembourse += remb;
    ca += (Number(r[VCOL.total]) || 0) - remb;
    if (r[VCOL.statut] === 'a_verifier') aVerifier++;
    // Pour la trésorière : ce qui a réellement été encaissé à chaque caisse, remboursements déduits
    const encaisse = (r[VCOL.total_caisse] === '' ? Number(r[VCOL.total]) || 0 : Number(r[VCOL.total_caisse]) || 0) - remb;
    const c = String(r[VCOL.caisse] || '?');
    const k = caisses[c] || (caisses[c] = { ventes: 0, especes: 0, cheque: 0, carte: 0 });
    k.ventes++;
    k[r[VCOL.paiement]] = arrondi((k[r[VCOL.paiement]] || 0) + encaisse);
  });
  ca = arrondi(ca);
  return {
    mode: ctx.params.mode, edition: ctx.params.edition, taux: taux, version: VERSION,
    articles: articles, ventes: nb, a_verifier: aVerifier, annulees: annulees, rembourse: arrondi(rembourse),
    stock: { deposes: nbDeposes, valeur_deposee: arrondi(valeurDeposee), en_vente: nbEnVente, valeur_en_vente: arrondi(valeurEnVente) },
    total_vendu: arrondi(ca), part_asso: arrondi(ca * taux), part_vendeurs: arrondi(ca - arrondi(ca * taux)),
    caisses: caisses,
  };
}

function aRecherche(ctx) {
  const q = texte(ctx.req.q, 60);
  if (q.length < 2) throw new Error('Tapez au moins 2 caractères.');
  const ed = ctx.params.edition;
  let code = null, grille = null;
  try { code = lireCodeArticle(q, ed); } catch (e) { /* pas un code d'article */ }
  try { grille = lireCodeGrille(q, ed); } catch (e) { /* pas un code de grille */ }
  const mot = simplifier(q);
  const A = charger('Articles');
  const res = A.lignes.filter(function (r) {
    return r[COL.code] === code || r[COL.grille] === grille || (mot && simplifier(r[COL.description]).indexOf(mot) >= 0);
  }).slice(0, 50).map(objArticle);
  // Pour un article vendu : la vente d'origine (heure, caisse, moyen de paiement), utile pour un retour
  if (res.some(function (a) { return a.vente_id; })) {
    const V = charger('Ventes');
    const iv = indexer(V, VCOL.id);
    const G = charger('Grilles');
    const ig = indexer(G, GCOL.grille);
    res.forEach(function (a) {
      if (!a.vente_id || iv[a.vente_id] == null) return;
      const v = V.lignes[iv[a.vente_id]];
      a.vente = { id: a.vente_id, heure: v[VCOL.heure_caisse] || v[VCOL.recue_le], caisse: v[VCOL.caisse], paiement: v[VCOL.paiement], statut: v[VCOL.statut] };
      const g = G.lignes[ig[String(a.code).split('-').slice(0, 2).join('-')]];
      a.grille_restituee = !!g && g[GCOL.statut] === 'restituee';
    });
  }
  return { resultats: res };
}

/**
 * Retour d'un ou plusieurs articles d'une vente (le client rapporte un jouet).
 * Possible seulement tant que la grille du jouet n'est pas restituée : une fois le vendeur payé, plus de retour.
 * L'article redevient « en vente » ; le montant à rembourser est noté sur la vente (colonne « rembourse »).
 */
function aRetour(ctx) {
  const req = ctx.req, ed = ctx.params.edition;
  const id = texte(req.vente_id, 64);
  const motif = texte(req.motif, 200);
  if (motif.length < 3) throw new Error('Le motif du retour est obligatoire.');
  const codes = (Array.isArray(req.codes) ? req.codes : String(req.codes || '').split(/[,;\s]+/))
    .filter(function (c) { return String(c).trim(); })
    .map(function (c) { return lireCodeArticle(c, ed); });
  if (!codes.length) throw new Error('Indiquez le ou les articles rapportés.');
  const V = charger('Ventes');
  const vi = trouver(V, VCOL.id, id);
  if (vi < 0) throw new Error('Vente introuvable : ' + id);
  const rv = V.lignes[vi];
  if (rv[VCOL.statut] === 'annulee') throw new Error('Vente déjà annulée.');
  const A = charger('Articles'), G = charger('Grilles');
  const idx = indexer(A, COL.code), ig = indexer(G, GCOL.grille);
  // Tout vérifier avant de modifier
  const lignes = codes.map(function (code) {
    const i = idx[code];
    if (i == null) throw new Error('Article inconnu : ' + court(code));
    const r = A.lignes[i];
    if (r[COL.vente_id] !== id || r[COL.statut] !== 'vendu') throw new Error(court(code) + " ne fait pas (ou plus) partie de cette vente.");
    const g = G.lignes[ig[r[COL.grille]]];
    if (g && g[GCOL.statut] === 'restituee') throw new Error('Vendeur déjà payé (grille ' + court(r[COL.grille]) + ' restituée) : retour impossible.');
    return r;
  });
  let montant = 0;
  const detail = [];
  lignes.forEach(function (r) {
    montant += Number(r[COL.prix]) || 0;
    detail.push(court(r[COL.code]) + ' (' + String(r[COL.prix]).replace('.', ',') + ' €)');
    r[COL.statut] = 'depose';
    r[COL.vente_id] = '';
    r[COL.maj] = new Date();
  });
  montant = arrondi(montant);
  rv[VCOL.rembourse] = arrondi((Number(rv[VCOL.rembourse]) || 0) + montant);
  rv[VCOL.retours] = (rv[VCOL.retours] ? rv[VCOL.retours] + ' ; ' : '') + detail.join(', ') + ' : ' + motif;
  const restants = A.lignes.filter(function (r) { return r[COL.vente_id] === id && r[COL.statut] === 'vendu'; }).length;
  if (!restants) { rv[VCOL.statut] = 'annulee'; rv[VCOL.motif] = 'tous les articles rapportés'; }
  A.modifie = V.modifie = true;
  sauver(A); sauver(V);
  ctx.journal.push(['retour', id, '', '-' + montant + ' €', detail.join(', ') + ' – ' + motif]);
  return { vente_id: id, rembourse: montant, paiement: rv[VCOL.paiement], articles_restants: restants };
}

function aCorrigerPrix(ctx) {
  const ed = ctx.params.edition;
  const code = lireCodeArticle(ctx.req.code, ed);
  const motif = texte(ctx.req.motif, 200);
  if (motif.length < 3) throw new Error('Le motif de la correction est obligatoire.');
  const A = charger('Articles');
  const i = trouver(A, COL.code, code);
  if (i < 0) throw new Error('Article inconnu : ' + court(code));
  const r = A.lignes[i];
  if (r[COL.statut] === 'vendu') throw new Error("Article déjà vendu : annulez d'abord la vente.");
  if (r[COL.statut] !== 'vierge' && r[COL.statut] !== 'depose') throw new Error('Article déjà « ' + r[COL.statut] + ' ».');
  const prix = prixValide(ctx.req.prix, court(code));
  const ancien = r[COL.prix];
  r[COL.prix] = prix;
  r[COL.statut] = 'depose';
  r[COL.maj] = new Date();
  A.modifie = true;
  sauver(A);
  ctx.journal.push(['correction_prix', code, ancien, prix, motif]);
  return { article: objArticle(r) };
}

function aAnnulerVente(ctx) {
  const id = texte(ctx.req.vente_id, 64);
  const motif = texte(ctx.req.motif, 200);
  if (motif.length < 3) throw new Error("Le motif de l'annulation est obligatoire.");
  const V = charger('Ventes');
  const vi = trouver(V, VCOL.id, id);
  if (vi < 0) throw new Error('Vente introuvable : ' + id);
  const rv = V.lignes[vi];
  if (rv[VCOL.statut] === 'annulee') throw new Error('Vente déjà annulée.');
  const A = charger('Articles');
  let n = 0;
  A.lignes.forEach(function (r) {
    if (r[COL.vente_id] === id && r[COL.statut] === 'vendu') {
      r[COL.statut] = 'depose';
      r[COL.vente_id] = '';
      r[COL.maj] = new Date();
      n++;
    }
  });
  const ancien = rv[VCOL.statut];
  rv[VCOL.statut] = 'annulee';
  rv[VCOL.motif] = motif;
  A.modifie = V.modifie = true;
  sauver(A); sauver(V);
  ctx.journal.push(['annulation_vente', id, ancien, 'annulee', motif + ' (' + n + ' article(s) remis en vente)']);
  return { vente_id: id, articles_remis: n };
}

function aJournal(ctx) {
  const n = Math.min(Math.max(Number(ctx.req.n) || 100, 1), 500);
  const sh = feuille('Journal');
  const der = sh.getLastRow();
  if (der < 2) return { lignes: [] };
  const debut = Math.max(2, der - n + 1);
  const v = sh.getRange(debut, 1, der - debut + 1, ONGLETS.Journal.length).getValues();
  return { lignes: v.reverse() };
}

function aVentes(ctx) {
  const n = Math.min(Math.max(Number(ctx.req.n) || 30, 1), 300);
  const V = charger('Ventes');
  const ventes = V.lignes.slice(-n).reverse().map(function (r) {
    const o = {};
    Object.keys(VCOL).forEach(function (k) { o[k] = r[VCOL[k]]; });
    return o;
  });
  return { ventes: ventes, total: V.lignes.length };
}

function aCatalogue(ctx) {
  const A = charger('Articles'), G = charger('Grilles');
  const grilles = {};
  G.lignes.forEach(function (r) { grilles[r[GCOL.grille]] = r[GCOL.statut]; });
  const articles = A.lignes.map(function (r) { return [r[COL.code], r[COL.prix], String(r[COL.description]), r[COL.statut]]; });
  return { edition: ctx.params.edition, mode: ctx.params.mode, grilles: grilles, articles: articles, horodatage: new Date().toISOString() };
}

/**
 * Bac à sable : remise à zéro complète POUR LES TESTS (mode Préparation, confirmation « EFFACER »).
 * Efface ventes, prix, descriptions et statuts : toutes les grilles redeviennent vierges.
 * Gardé : les codes de grilles, les PIN, les paramètres et le journal (qui note la remise à zéro).
 */
function aReinitialiser(ctx) {
  if (String(ctx.req.confirmation || '') !== 'EFFACER') throw new Error('Tapez EFFACER pour confirmer la remise à zéro.');
  return remiseAZero(ctx);
}

function remiseAZero(ctx) {
  const V = charger('Ventes');
  const nbVentes = V.lignes.length;
  if (nbVentes) V.sh.getRange(2, 1, nbVentes, V.nc).clearContent();
  const A = charger('Articles');
  A.lignes.forEach(function (r) {
    r[COL.description] = ''; r[COL.prix] = ''; r[COL.statut] = 'vierge'; r[COL.vente_id] = ''; r[COL.maj] = '';
  });
  A.modifie = A.lignes.length > 0;
  const G = charger('Grilles');
  G.lignes.forEach(function (r) {
    r[GCOL.statut] = 'vierge'; r[GCOL.listee_le] = ''; r[GCOL.restituee_le] = ''; r[GCOL.invendus] = '';
  });
  G.modifie = G.lignes.length > 0;
  sauver(A); sauver(G);
  ctx.journal.push(['remise_a_zero', '', nbVentes + ' vente(s)', 'tout vierge', A.lignes.length + ' article(s), ' + G.lignes.length + ' grille(s)']);
  return { ventes: nbVentes, articles: A.lignes.length, grilles: G.lignes.length };
}

/**
 * Bac à sable : crée des grilles et les remplit de prix et descriptions au hasard (prêtes à vendre),
 * et crée d'autres grilles laissées vierges (pour s'entraîner au listing). Mode Préparation seulement.
 */
function aDonneesTest(ctx) {
  const ed = ctx.params.edition;
  const nb = Math.min(Math.max(Number(ctx.req.nb) || 9, 1), 30);
  const remplies = String(ctx.req.remplies || '').toUpperCase().split(/[^A-Z]+/).filter(Boolean);
  const vierges = String(ctx.req.vierges || '').toUpperCase().split(/[^A-Z]+/).filter(Boolean);
  if (!remplies.length && !vierges.length) throw new Error('Indiquez au moins une lettre.');
  if (remplies.length) genererGrilles(ed, remplies.join(','), nb, 1);
  if (vierges.length) genererGrilles(ed, vierges.join(','), nb, 1);
  const PRIX = [0.5, 0.5, 1, 1, 1, 2, 2, 2, 3, 3, 4, 5, 5, 6, 8, 10, 10, 12, 15, 20, 25, 35];
  const DESC = ['Puzzle Cars 48 pièces', 'Poupée robe rose', 'Camion de pompiers', 'Lego ville', 'Livre Petit Ours Brun',
    'Jeu Uno', 'Peluche lapin', 'Voiture télécommandée', 'Dînette en bois', 'Trottinette', 'Playmobil ferme',
    'Robot musical', 'Ballon de foot', 'Memory animaux', 'Garage voitures', 'Train en bois', 'Déguisement pirate',
    'Jeu de l\'oie', 'Kapla 100 pièces', 'Tablette éducative', 'Draisienne', 'Cuisine en plastique', '', '', ''];
  const hasard = function (t) { return t[Math.floor(Math.random() * t.length)]; };
  const A = charger('Articles'), G = charger('Grilles');
  const ia = indexer(A, COL.code), ig = indexer(G, GCOL.grille);
  let nbArticles = 0, nbGrilles = 0;
  remplies.forEach(function (l) {
    for (let k = 1; k <= nb; k++) {
      const g = ed + '-' + l + k;
      const rg = G.lignes[ig[g]];
      if (!rg || rg[GCOL.statut] !== 'vierge') continue; // on ne touche pas une grille déjà utilisée
      const combien = 4 + Math.floor(Math.random() * 5); // 4 à 8 articles
      for (let n = 1; n <= combien; n++) {
        const r = A.lignes[ia[g + '-' + deux(n)]];
        if (!r) continue;
        r[COL.prix] = hasard(PRIX); r[COL.description] = hasard(DESC); r[COL.statut] = 'depose'; r[COL.maj] = new Date();
        nbArticles++;
      }
      rg[GCOL.statut] = 'listee'; rg[GCOL.listee_le] = new Date();
      nbGrilles++;
    }
  });
  A.modifie = G.modifie = nbGrilles > 0;
  sauver(A); sauver(G);
  ctx.journal.push(['donnees_test', '', '', nbGrilles + ' grille(s) remplie(s)', nbArticles + ' article(s) au hasard ; vierges : ' + vierges.join(', ')]);
  return { grilles_remplies: nbGrilles, articles: nbArticles };
}

function aGenerer(ctx) {
  const creees = genererGrilles(ctx.params.edition, ctx.req.lettres, Number(ctx.req.nb), Number(ctx.req.debut) || 1);
  ctx.journal.push(['generation', '', '', creees.length + ' grille(s)', creees.map(court).join(', ').slice(0, 400)]);
  return { creees: creees };
}

// =====================================================================
// Outils métier
// =====================================================================
function genererGrilles(ed, lettres, nb, debut) {
  const L = String(lettres || '').toUpperCase().split(/[^A-Z]+/).filter(Boolean);
  if (!L.length) throw new Error('Indiquez au moins une lettre.');
  L.forEach(function (l) {
    if (l.length !== 1 || LETTRES.indexOf(l) < 0) throw new Error('Lettre refusée : ' + l + ' (I et O sont exclues).');
  });
  if (!(nb >= 1 && nb <= 99)) throw new Error('Nombre de grilles par lettre : entre 1 et 99.');
  if (!(debut >= 1 && debut + nb - 1 <= 99)) throw new Error('Numéros de grille : de 1 à 99.');
  const G = charger('Grilles'), A = charger('Articles');
  const existe = indexer(G, GCOL.grille);
  const creees = [];
  G.nouvelles = []; A.nouvelles = [];
  L.forEach(function (l) {
    for (let k = debut; k < debut + nb; k++) {
      const g = ed + '-' + l + k;
      if (existe[g] != null) continue;
      creees.push(g);
      G.nouvelles.push([g, 'vierge', '', '', '']);
      for (let n = 1; n <= 8; n++) A.nouvelles.push([g + '-' + deux(n), g, n, '', '', 'vierge', '', '']);
    }
  });
  sauver(G); sauver(A);
  return creees;
}

function detailGrille(g, G, A) {
  const gi = trouver(G, GCOL.grille, g);
  if (gi < 0) throw new Error('Grille inconnue : ' + court(g) + " (elle n'a pas été générée).");
  const articles = A.lignes.filter(function (r) { return r[COL.grille] === g; })
    .sort(function (a, b) { return a[COL.n] - b[COL.n]; })
    .map(objArticle);
  return { grille: g, statut: G.lignes[gi][GCOL.statut], articles: articles };
}

function bilanRestitution(gs, G, A, taux) {
  let total = 0;
  const grilles = gs.map(function (g) {
    const d = detailGrille(g, G, A);
    d.vendus = d.articles.filter(function (a) { return a.statut === 'vendu'; });
    d.invendus = d.articles.filter(function (a) { return a.statut === 'depose'; });
    d.total_vendu = arrondi(d.vendus.reduce(function (s, a) { return s + a.prix; }, 0));
    total += d.total_vendu;
    return d;
  });
  total = arrondi(total);
  const retenue = arrondi(total * taux);
  // Règle d'arrondi de la somme versée : question ouverte (bureau). Pour l'instant, au centime.
  return { grilles: grilles, total_vendu: total, retenue: retenue, a_verser: arrondi(total - retenue), taux: taux };
}

function objArticle(r) {
  return {
    code: r[COL.code], n: Number(r[COL.n]), description: String(r[COL.description]),
    prix: r[COL.prix] === '' ? null : Number(r[COL.prix]), statut: r[COL.statut], vente_id: r[COL.vente_id],
  };
}

function lireCodeGrille(s, ed) {
  const c = String(s == null ? '' : s).toUpperCase().replace(/\s+/g, '');
  const m = c.match(/^(?:(\d{2})-)?([A-Z])(\d{1,2})$/);
  if (!m) throw new Error('Code de grille invalide : « ' + s + ' »');
  if (m[1] && m[1] !== ed) throw new Error("Grille d'une autre édition (20" + m[1] + ').');
  if (Number(m[3]) < 1) throw new Error('Code de grille invalide : « ' + s + ' »');
  return ed + '-' + m[2] + Number(m[3]);
}

function lireCodeArticle(s, ed) {
  const c = String(s == null ? '' : s).toUpperCase().replace(/\s+/g, '');
  const m = c.match(/^(?:(\d{2})-)?([A-Z])(\d{1,2})-(\d{1,2})$/);
  if (!m) throw new Error('Code article invalide');
  if (m[1] && m[1] !== ed) throw new Error("autre édition (20" + m[1] + ')');
  const n = Number(m[4]);
  if (n < 1 || n > 8 || Number(m[3]) < 1) throw new Error('Code article invalide');
  return ed + '-' + m[2] + Number(m[3]) + '-' + deux(n);
}

function listeGrilles(v, ed) {
  const brut = Array.isArray(v) ? v : String(v || '').split(/[,;\s]+/);
  const res = [];
  brut.forEach(function (x) {
    if (String(x).trim() === '') return;
    const g = lireCodeGrille(x, ed);
    if (res.indexOf(g) < 0) res.push(g);
  });
  if (!res.length) throw new Error('Indiquez au moins une grille.');
  return res;
}

function prixValide(p, quoi) {
  const x = typeof p === 'number' ? p : Number(String(p).replace(',', '.').replace('€', '').trim());
  if (!isFinite(x) || x <= 0) throw new Error('Prix invalide' + (quoi ? ' pour ' + quoi : '') + ' : « ' + p + ' »');
  if (Math.abs(x * 2 - Math.round(x * 2)) > 1e-9) {
    throw new Error('Prix refusé' + (quoi ? ' pour ' + quoi : '') + ' (' + p + ' €) : uniquement des euros ronds ou des 0,50 €.');
  }
  return Math.round(x * 2) / 2;
}

// =====================================================================
// Accès au classeur
// =====================================================================
function feuille(nom) {
  const sh = SpreadsheetApp.getActive().getSheetByName(nom);
  if (!sh) throw new Error('Onglet « ' + nom + ' » manquant : menu Caisse QR > 1. Installer les onglets.');
  return sh;
}

/** Charge un onglet en mémoire : { sh, nc, lignes, modifie, nouvelles } */
function charger(nom) {
  const sh = feuille(nom);
  const nc = ONGLETS[nom].length;
  // Colonnes ajoutées par une nouvelle version : on complète la ligne d'en-tête (toujours à la fin)
  if (sh.getLastRow() > 0 && sh.getLastColumn() < nc) sh.getRange(1, 1, 1, nc).setValues([ONGLETS[nom]]);
  const n = sh.getLastRow();
  const lignes = n > 1 ? sh.getRange(2, 1, n - 1, nc).getValues() : [];
  return { sh: sh, nc: nc, lignes: lignes, modifie: false, nouvelles: [] };
}

/** Réécrit l'onglet s'il a été modifié (une seule écriture) et ajoute les nouvelles lignes. */
function sauver(t) {
  if (t.modifie && t.lignes.length) {
    t.sh.getRange(2, 1, t.lignes.length, t.nc).setValues(t.lignes.map(proteger));
    t.modifie = false;
  }
  if (t.nouvelles.length) {
    t.sh.getRange(t.lignes.length + 2, 1, t.nouvelles.length, t.nc).setValues(t.nouvelles.map(proteger));
    t.lignes = t.lignes.concat(t.nouvelles);
    t.nouvelles = [];
  }
}

/** Empêche qu'un texte saisi (ex. « =... ») soit interprété comme une formule par le tableur. */
function proteger(ligne) {
  return ligne.map(function (v) { return typeof v === 'string' && /^[=+\-@]/.test(v) ? "'" + v : v; });
}

function trouver(t, col, val) {
  for (let i = 0; i < t.lignes.length; i++) if (String(t.lignes[i][col]) === val) return i;
  return -1;
}

function indexer(t, col) {
  const m = {};
  t.lignes.forEach(function (r, i) { m[String(r[col])] = i; });
  return m;
}

function lireParams() {
  const v = feuille('Parametres').getDataRange().getValues();
  const p = {};
  for (let i = 1; i < v.length; i++) if (String(v[i][0]).trim()) p[String(v[i][0]).trim()] = v[i][1];
  const edition = String(p.edition == null ? '' : p.edition).trim().slice(-2).padStart(2, '0');
  const taux = Number(String(p.taux == null ? '0.15' : p.taux).replace(',', '.').replace('%', ''));
  if (!/^\d{2}$/.test(edition)) throw new Error("Paramètre « edition » invalide dans l'onglet Parametres.");
  if (!(taux >= 0 && taux < 1)) throw new Error("Paramètre « taux » invalide dans l'onglet Parametres (ex. 0.15).");
  return { edition: edition, mode: String(p.mode || 'preparation').trim(), taux: taux };
}

function ecrireParam(cle, valeur) {
  const P = charger('Parametres');
  const i = trouver(P, 0, cle);
  if (i >= 0) { P.lignes[i][1] = valeur; P.modifie = true; }
  else P.nouvelles.push([cle, valeur, '']);
  sauver(P);
}

function ecrireJournal(ctx) {
  if (!ctx.journal.length) return;
  const J = charger('Journal');
  J.nouvelles = ctx.journal.map(function (j) {
    return [new Date(), ctx.role, ctx.caisse, j[0], j[1] == null ? '' : String(j[1]),
      j[2] == null ? '' : String(j[2]), j[3] == null ? '' : String(j[3]), j[4] == null ? '' : String(j[4])];
  });
  sauver(J);
}

// ---------- Petits utilitaires ----------
function texte(s, max) { return String(s == null ? '' : s).trim().slice(0, max); }
function deux(n) { return String(n).padStart(2, '0'); }
function court(code) { return String(code).replace(/^\d{2}-/, ''); } // 27-A1-03 -> A1-03
function arrondi(x) { return Math.round((x + (x >= 0 ? 1 : -1) * 1e-9) * 100) / 100; } // 2,325 -> 2,33 (évite l'erreur des nombres à virgule)
function resume(prix, desc) { return (prix === '' ? '—' : prix + ' €') + (desc ? ' | ' + desc : ''); }
function simplifier(s) {
  return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

// =====================================================================
// Menu du Google Sheet (pour le propriétaire)
// =====================================================================
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Caisse QR')
    .addItem('1. Installer les onglets', 'menuInstaller')
    .addItem('2. Définir les codes PIN', 'menuPins')
    .addItem('3. Générer des grilles', 'menuGenerer')
    .addItem('4. Sauvegarder maintenant (copie dans Drive)', 'menuSauvegarder')
    .addSeparator()
    .addItem('Tests : effacer les ventes', 'menuEffacerVentes')
    .addItem('Tests : tout remettre à zéro', 'menuRemiseAZero')
    .addToUi();
}

function installerOnglets() {
  const ss = SpreadsheetApp.getActive();
  Object.keys(ONGLETS).forEach(function (nom) {
    let sh = ss.getSheetByName(nom);
    if (!sh) sh = ss.insertSheet(nom);
    // En-têtes réécrits à chaque installation : ajoute les colonnes d'une nouvelle version (toujours à la fin)
    sh.getRange(1, 1, 1, ONGLETS[nom].length).setValues([ONGLETS[nom]]).setFontWeight('bold');
    sh.setFrozenRows(1);
  });
  feuille('Ventes').getRange('M:M').setNumberFormat('0.00 "€"');
  // Codes et identifiants en texte brut (évite les conversions automatiques du tableur)
  feuille('Articles').getRange('A:B').setNumberFormat('@');
  feuille('Grilles').getRange('A:A').setNumberFormat('@');
  feuille('Ventes').getRange('A:A').setNumberFormat('@');
  feuille('Ventes').getRange('I:I').setNumberFormat('@');
  feuille('Articles').getRange('E:E').setNumberFormat('0.00 "€"');
  feuille('Ventes').getRange('G:H').setNumberFormat('0.00 "€"');
  // Supprime l'onglet vide créé par défaut
  ['Feuille 1', 'Feuille1', 'Sheet1'].forEach(function (nom) {
    const sh = ss.getSheetByName(nom);
    if (sh && sh.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(sh);
  });
  const P = charger('Parametres');
  const deja = indexer(P, 0);
  P.nouvelles = PARAMS_DEFAUT.filter(function (p) { return deja[p[0]] == null; });
  sauver(P);
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('SEL')) props.setProperty('SEL', Utilities.getUuid());
}

function menuInstaller() {
  installerOnglets();
  SpreadsheetApp.getUi().alert('Onglets installés ✔\n\nÉtape suivante : menu Caisse QR > 2. Définir les codes PIN.');
}

function menuPins() {
  const ui = SpreadsheetApp.getUi();
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('SEL')) props.setProperty('SEL', Utilities.getUuid());
  const nouveaux = {};
  for (let i = 0; i < ROLES.length; i++) {
    const r = ROLES[i];
    const existe = !!props.getProperty('PIN_' + r);
    const rep = ui.prompt('Code PIN « ' + r + ' » (' + (i + 1) + '/4)',
      'Exactement 6 chiffres.' + (existe ? '\nLaissez vide pour garder le code actuel.' : ''),
      ui.ButtonSet.OK_CANCEL);
    if (rep.getSelectedButton() !== ui.Button.OK) { ui.alert('Annulé : aucun code modifié.'); return; }
    const v = rep.getResponseText().trim();
    if (!v && existe) continue;
    if (!/^\d{6}$/.test(v)) { ui.alert('Code refusé : exactement 6 chiffres.\nAucun code modifié.'); return; }
    nouveaux[r] = hashPin(v);
  }
  const finals = ROLES.map(function (r) { return nouveaux[r] || props.getProperty('PIN_' + r); }).filter(Boolean);
  if (finals.length !== new Set(finals).size) { ui.alert('Deux rôles ont le même code : chaque rôle doit avoir un code différent.\nAucun code modifié.'); return; }
  Object.keys(nouveaux).forEach(function (r) { props.setProperty('PIN_' + r, nouveaux[r]); });
  ecrireJournal({ role: 'proprietaire', caisse: '', journal: [['pins', Object.keys(nouveaux).join(', '), '', 'modifié(s)']] });
  ui.alert('Codes PIN enregistrés ✔\n\nNotez-les sur papier : ils ne sont affichés nulle part.');
}

/** Pour les tests : supprime toutes les ventes et remet en vente les articles vendus, rendus ou donnés. Les prix sont gardés. */
function effacerVentes() {
  // Garde-fou : jamais pendant une vraie bourse
  if (lireParams().mode !== 'preparation') {
    throw new Error('Effacement des ventes possible seulement en mode Préparation (passez d\'abord en Préparation dans l\'Admin).');
  }
  const V = charger('Ventes');
  const nbVentes = V.lignes.length;
  if (nbVentes) V.sh.getRange(2, 1, nbVentes, V.nc).clearContent();
  const A = charger('Articles');
  let n = 0;
  A.lignes.forEach(function (r) {
    if (r[COL.statut] === 'vendu' || r[COL.statut] === 'restitue' || r[COL.statut] === 'donne') {
      r[COL.statut] = 'depose'; r[COL.vente_id] = ''; r[COL.maj] = new Date(); n++;
    }
  });
  A.modifie = n > 0;
  const G = charger('Grilles');
  G.lignes.forEach(function (r) {
    if (r[GCOL.statut] === 'restituee') { r[GCOL.statut] = 'listee'; r[GCOL.restituee_le] = ''; r[GCOL.invendus] = ''; G.modifie = true; }
  });
  sauver(A); sauver(G);
  ecrireJournal({ role: 'proprietaire', caisse: '', journal: [['effacement_ventes', '', nbVentes + ' vente(s)', '', n + ' article(s) remis en vente']] });
  return { ventes: nbVentes, articles: n };
}

function menuRemiseAZero() {
  const ui = SpreadsheetApp.getUi();
  if (lireParams().mode !== 'preparation') {
    ui.alert('Impossible : la remise à zéro ne fonctionne qu\'en mode Préparation (garde-fou pour la vraie bourse).');
    return;
  }
  const rep = ui.prompt('Tout remettre à zéro (tests)',
    'Ventes, prix, descriptions et statuts seront effacés : toutes les grilles redeviennent vierges.\n' +
    'Gardés : codes des grilles, PIN, paramètres, journal.\n\nTapez EFFACER pour confirmer :', ui.ButtonSet.OK_CANCEL);
  if (rep.getSelectedButton() !== ui.Button.OK || rep.getResponseText().trim() !== 'EFFACER') { ui.alert('Annulé : rien n\'a été effacé.'); return; }
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    const ctx = { role: 'proprietaire', caisse: '', journal: [] };
    const r = remiseAZero(ctx);
    ecrireJournal(ctx);
    ui.alert('Remise à zéro faite ✔\n' + r.ventes + ' vente(s) effacée(s), ' + r.grilles + ' grille(s) redevenue(s) vierge(s).');
  } finally {
    lock.releaseLock();
  }
}

function menuEffacerVentes() {
  const ui = SpreadsheetApp.getUi();
  if (lireParams().mode !== 'preparation') {
    ui.alert('Impossible : l\'effacement des ventes ne fonctionne qu\'en mode Préparation.\n\nC\'est un garde-fou pour qu\'il ne soit jamais lancé pendant une vraie bourse.');
    return;
  }
  const rep = ui.alert('Effacer les ventes (tests)',
    'Toutes les ventes seront supprimées et les articles vendus remis en vente.\nLes prix saisis sont gardés. À utiliser seulement pendant les tests.\n\nContinuer ?',
    ui.ButtonSet.YES_NO);
  if (rep !== ui.Button.YES) return;
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    const r = effacerVentes();
    ui.alert(r.ventes + ' vente(s) effacée(s), ' + r.articles + ' article(s) remis en vente ✔\n\nSur les téléphones de caisse : menu ⋮ > Recharger les prix.');
  } catch (e) {
    ui.alert('Erreur : ' + e.message);
  } finally {
    lock.releaseLock();
  }
}

function menuSauvegarder() {
  const ui = SpreadsheetApp.getUi();
  try {
    const s = sauvegarder('manuelle');
    ecrireJournal({ role: 'proprietaire', caisse: '', journal: [['sauvegarde', s.nom, '', '', 'manuelle (menu)']] });
    ui.alert('Sauvegarde faite ✔\n\n« ' + s.nom + ' »\n\nDossier Drive : Bourse aux jouets – sauvegardes');
  } catch (e) {
    ui.alert('Erreur de sauvegarde : ' + e.message);
  }
}

function menuGenerer() {
  const ui = SpreadsheetApp.getUi();
  const ed = lireParams().edition;
  const r1 = ui.prompt('Générer des grilles (édition 20' + ed + ')', 'Lettres, séparées par des virgules (ex. A, B, C) :', ui.ButtonSet.OK_CANCEL);
  if (r1.getSelectedButton() !== ui.Button.OK) return;
  const r2 = ui.prompt('Générer des grilles', 'Nombre de grilles par lettre (ex. 9 pour A1 à A9) :', ui.ButtonSet.OK_CANCEL);
  if (r2.getSelectedButton() !== ui.Button.OK) return;
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    const creees = genererGrilles(ed, r1.getResponseText(), Number(r2.getResponseText()), 1);
    ecrireJournal({ role: 'proprietaire', caisse: '', journal: [['generation', '', '', creees.length + ' grille(s)', creees.map(court).join(', ').slice(0, 400)]] });
    ui.alert(creees.length ? creees.length + ' grille(s) créée(s) : ' + creees.map(court).join(', ') : 'Aucune nouvelle grille (elles existent déjà).');
  } catch (e) {
    ui.alert('Erreur : ' + e.message);
  } finally {
    lock.releaseLock();
  }
}
