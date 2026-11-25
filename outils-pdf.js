// Bourse aux jouets – fabrication des PDF (grilles à imprimer, liste des prix)
// Nécessite jsPDF et qrcode-generator (chargés par la page).
const BJ_PDF = (() => {
  const deux = n => String(n).padStart(2, '0');

  // QR en vecteur (net à l'impression) : taille = côté du symbole en mm, sans la marge blanche.
  function dessinerQR(doc, texte, x, y, taille) {
    const q = qrcode(0, 'M'); q.addData(texte); q.make();
    const n = q.getModuleCount(), m = taille / n;
    doc.setFillColor(0, 0, 0);
    for (let r = 0; r < n; r++) {
      let c = 0;
      while (c < n) {
        if (!q.isDark(r, c)) { c++; continue; }
        let fin = c; while (fin + 1 < n && q.isDark(r, fin + 1)) fin++;
        doc.rect(x + c * m, y + r * m, (fin - c + 1) * m + 0.01, m + 0.01, 'F'); // léger recouvrement : pas de fines lignes blanches
        c = fin + 1;
      }
    }
  }

  // Tri naturel des codes : A2 avant A10, A avant B
  function cle(code) {
    const m = String(code).replace(/^\d{2}-/, '').match(/^([A-Z])(\d+)(?:-(\d+))?$/);
    return m ? [m[1], +m[2], +(m[3] || 0)] : [code, 0, 0];
  }
  function trier(a, b) {
    const x = cle(a), y = cle(b);
    return x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : (x[1] - y[1]) || (x[2] - y[2]);
  }

  // ---------- Grilles : A4 paysage, 2 grilles par feuille ----------
  // grilles : codes courts ['A1', 'A2', ...] ; edition : '27' ; opts.qr : taille des QR de talon en mm (9,5 par défaut)
  function grilles(edition, liste, opts) {
    opts = opts || {};
    const annee = '20' + edition;
    const tailleQR = opts.qr || 9.5;
    const doc = new jspdf.jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
    const W = 297, MX = 10, HG = 95, Y0 = [5, 106]; // hauteur d'une grille, position des 2 grilles
    const GW = W - 2 * MX;
    liste = liste.slice().sort(trier);
    liste.forEach((g, i) => {
      if (i > 0 && i % 2 === 0) doc.addPage();
      const y = Y0[i % 2];
      dessinerGrille(doc, edition, annee, g, MX, y, GW, HG, tailleQR);
      if (i % 2 === 0) {
        // trait de coupe entre les deux grilles
        doc.setLineDashPattern([0.6, 1.2], 0); doc.setDrawColor(150); doc.setLineWidth(0.2);
        doc.line(MX, 103, W - MX, 103);
        doc.setLineDashPattern([], 0);
        doc.setFontSize(6.5); doc.setTextColor(120); doc.setFont('helvetica', 'normal');
        doc.text(`Bourse aux jouets ${annee} – 2 grilles par A4 – QR des talons : ${String(tailleQR).replace('.', ',')} mm`, W / 2, 206, { align: 'center' });
        doc.setTextColor(0);
      }
    });
    return doc;
  }

  function dessinerGrille(doc, edition, annee, g, x, y, w, h, tailleQR) {
    const GAUCHE = 62;                     // colonne vendeur (< 1/4 de la largeur)
    const COLS = [10, 0, 24, 66];          // N°, description (le reste), prix, talon
    COLS[1] = w - GAUCHE - COLS[0] - COLS[2] - COLS[3];
    const ENT = 6.5, RH = (h - ENT) / 8;   // en-tête, hauteur d'une ligne (≈ 11 mm : marge blanche autour du QR)
    doc.setDrawColor(0); doc.setLineWidth(0.3); doc.setTextColor(0);
    doc.rect(x, y, w, h);
    doc.line(x + GAUCHE, y, x + GAUCHE, y + h);

    // --- Colonne vendeur ---
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
    doc.text('BOURSE AUX JOUETS ' + annee, x + 3, y + 6);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5);
    doc.text("Sou des écoles · partie gardée par l'asso", x + 3, y + 9.5);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(34);
    doc.text(g, x + 3, y + 24);
    dessinerQR(doc, edition + '-' + g, x + GAUCHE - 24, y + 12, 20);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
    ['Nom :', 'Téléphone :', "Nb d'articles :", 'Grilles du vendeur :'].forEach((t, k) => {
      const ly = y + h - 33 + k * 9;
      doc.text(t, x + 3, ly);
      doc.setLineWidth(0.2);
      doc.line(x + 3 + doc.getTextWidth(t) + 1.5, ly + 0.5, x + GAUCHE - 4, ly + 0.5);
    });

    // --- Tableau des articles ---
    const xs = [x + GAUCHE];
    COLS.forEach(c => xs.push(xs[xs.length - 1] + c));
    const xT = xs[3]; // début du talon
    doc.setLineWidth(0.3);
    doc.line(xs[0], y + ENT, x + w, y + ENT);
    doc.line(xs[1], y, xs[1], y + h);
    doc.line(xs[2], y, xs[2], y + h);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5);
    doc.text('N°', xs[0] + 2, y + 4.8);
    doc.text("Description de l'article", xs[1] + 2, y + 4.8);
    doc.text('Prix', xs[2] + 2, y + 4.8);
    doc.text("Talon à découper et fixer sur l'article", xT + 3, y + 4.8);
    // séparation du talon (pointillés = découpe)
    doc.setLineDashPattern([1, 0.8], 0); doc.setLineWidth(0.25);
    doc.line(xT, y, xT, y + h);
    doc.setLineDashPattern([], 0);

    for (let n = 1; n <= 8; n++) {
      const ly = y + ENT + (n - 1) * RH;
      if (n > 1) {
        doc.setLineWidth(0.2); doc.line(xs[0], ly, xT, ly);
        doc.setLineDashPattern([1, 0.8], 0); doc.line(xT, ly, x + w, ly); doc.setLineDashPattern([], 0);
      }
      const code = g + '-' + deux(n);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
      doc.text(String(n), xs[0] + COLS[0] / 2, ly + RH / 2 + 1.5, { align: 'center' });
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
      doc.text('€', xs[3] - 3, ly + RH / 2 + 1.5, { align: 'right' });
      // talon
      dessinerQR(doc, edition + '-' + code, xT + 2.5, ly + (RH - tailleQR) / 2, tailleQR);
      const xt = xT + 2.5 + tailleQR + 3;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
      doc.text(code, xt, ly + RH / 2 - 0.3);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7);
      doc.text('Prix : ________ €', xt, ly + RH / 2 + 3.4);
      doc.setFontSize(6);
      doc.text(annee, x + w - 2, ly + RH - 1.2, { align: 'right' });
    }
  }

  // ---------- Liste des prix (plan B : caisse papier) ----------
  // articles : [[code, prix, description, statut], ...]
  function listePrix(edition, articles, titre) {
    const doc = new jspdf.jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
    const liste = articles.slice().sort((a, b) => trier(a[0], b[0]));
    const eur = v => (Number(v) || 0).toFixed(2).replace('.', ',') + ' €';
    const H = 6, HAUT = 26, BAS = 285, COL = [12, 108];  // deux colonnes par page
    let page = 1, col = 0, y = HAUT, derniereGrille = '';
    const entete = () => {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
      doc.text(titre || ('Liste des prix – édition 20' + edition), 12, 13);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(90);
      doc.text(`${liste.length} articles · page ${page} · à garder pour une caisse papier si l'appli ne fonctionne plus`, 12, 18.5);
      doc.setTextColor(0);
    };
    entete();
    liste.forEach(a => {
      const court = String(a[0]).replace(/^\d{2}-/, '');
      const grille = court.split('-')[0];
      const besoin = grille !== derniereGrille ? 2 : 1;
      if (y + besoin * H > BAS) {
        if (col === 0) { col = 1; y = HAUT; } else { doc.addPage(); page++; col = 0; y = HAUT; entete(); }
      }
      const x = COL[col];
      if (grille !== derniereGrille) {
        doc.setFillColor(235, 233, 226); doc.rect(x, y - 4.2, 90, H, 'F');
        doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
        doc.text('Grille ' + grille, x + 1.5, y);
        y += H; derniereGrille = grille;
      }
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
      doc.text(court, x + 1.5, y);
      doc.setFont('helvetica', 'normal');
      let desc = (a[3] === 'vendu' ? '[VENDU] ' : '') + String(a[2] || '');
      while (desc && doc.getTextWidth(desc) > 56) desc = desc.slice(0, -2) + '…';
      doc.text(desc, x + 17, y);
      doc.setFont('helvetica', 'bold');
      doc.text(eur(a[1]), x + 89, y, { align: 'right' });
      doc.setDrawColor(225); doc.setLineWidth(0.1); doc.line(x, y + 1.6, x + 90, y + 1.6);
      y += H;
    });
    return doc;
  }

  // ---------- Liste des prix en CSV (ouvrable dans Excel) ----------
  function csvPrix(articles) {
    const lignes = [['code', 'grille', 'description', 'prix', 'statut']];
    articles.slice().sort((a, b) => trier(a[0], b[0])).forEach(a => {
      const court = String(a[0]).replace(/^\d{2}-/, '');
      lignes.push([court, court.split('-')[0], String(a[2] || ''), (Number(a[1]) || 0).toFixed(2).replace('.', ','), a[3]]);
    });
    const csv = lignes.map(l => l.map(v => /[;"\n]/.test(v) ? '"' + String(v).replace(/"/g, '""') + '"' : v).join(';')).join('\r\n');
    return new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  }

  function telecharger(blob, nom) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = nom;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  return { grilles, listePrix, csvPrix, telecharger, trier };
})();
