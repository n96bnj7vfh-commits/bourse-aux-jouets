# Bourse aux jouets – Caisse QR

Caisse à QR codes pour la bourse aux jouets du Sou des écoles. Les grilles papier restent les mêmes ; chaque talon porte un QR code (`27-A1-03` = édition 2027, grille A1, article 3) qu'un téléphone lit pour faire les comptes.

Prototype, données fictives. Gratuit : un Google Sheet + Apps Script (le « serveur ») et ce site statique sur GitHub Pages.

## Les pages

| Page | Qui | Rôle |
|---|---|---|
| `index.html` | tous | Accueil : liens vers les 4 écrans |
| `listing.html` | bénévoles du samedi (PIN listing) | Scanner une grille, saisir les prix au pavé |
| `caisse.html?caisse=1` | caisses du dimanche (PIN caisse) | Scanner, encaisser (espèces, chèque, carte), fonctionne hors ligne |
| `restitution.html` | le soir (PIN restitution) | Bilan d'un vendeur : vendus, invendus, somme à verser |
| `admin.html` | PC de l'asso (PIN admin) | Modes, tableau de bord, recherche, corrections, retours, annulations, grilles PDF, sauvegarde, journal |
| `affichettes.html` | admin | Affichettes QR « Caisse 1 », « Listing »… à imprimer |
| `test-camera.html`, `qr-test.html`, `api-test.html` | tests | Essais de caméra, QR fictifs, appels directs au serveur |

Fichiers communs : `config.js` (adresse du serveur), `commun.js` (serveur, sons, scanner, connexion), `commun.css`, `outils-pdf.js` (grilles et liste des prix en PDF), `lib/` (bibliothèques : scan, PDF, QR).

## Le serveur (`apps-script/Code.gs`)

Collé dans le Google Sheet (Extensions > Apps Script), déployé en **application web** :
- Exécuter en tant que : **moi** ; Qui a accès : **tout le monde** (la protection, ce sont les codes PIN).
- Après chaque modification : **Déployer > Gérer les déploiements > crayon > Version : Nouvelle version > Déployer**. Ne jamais faire « Nouveau déploiement » : l'adresse changerait et `config.js` ne pointerait plus au bon endroit.
- Menu du Sheet « Caisse QR » : installer les onglets, définir les PIN (6 chiffres), générer des grilles, sauvegarder, effacer les ventes (tests, mode Préparation seulement).

**Règle de version** : le numéro de version est uniquement la constante `VERSION` en tête de `Code.gs`, augmentée à chaque modification. L'Admin l'affiche (« serveur v1.3 ») : on vérifie ainsi que le déploiement est à jour.

**Jamais dans ce dépôt (public)** : codes PIN, sel (`SEL`), jetons, `.clasprc.json`. Ils restent dans les propriétés du script.

## Documentation

- `docs/points-de-vigilance.md` : retours sur le prototype, consignes et questions pour le bureau.
- `docs/A-FAIRE-DEMAIN.md` : marche à suivre pour la dernière mise à jour.
