# Caisse QR – Points de vigilance (relecture du 25/11/2026)

Relecture du dépôt GitHub `n96bnj7vfh-commits/bourse-aux-jouets` (commit « Full v1.3 ») et du Code.gs (VERSION 1.2). À traiter avec Claude Code.

## À faire par Claude Code
- [x] Bloquer le menu « Tests : effacer les ventes » hors du mode Préparation (ou le retirer avant l'édition réelle).
  *Fait (v1.3) : le menu et la fonction refusent hors du mode Préparation, avec un message.*
- [x] Rendre les PIN de 6 chiffres obligatoires (aujourd'hui 4 à 8). Le compteur d'essais par appareil est contournable (l'identifiant d'appareil vient du téléphone) ; envisager un vrai blocage global.
  *Fait (v1.3) : 6 chiffres exactement au menu « Définir les codes PIN » (les PIN actuels de 4-5 ou 7-8 chiffres restent valables jusqu'à ce qu'on les redéfinisse). Blocage global : 30 essais ratés (tous appareils) → connexions par PIN bloquées 15 min, noté au journal. Pour que ce blocage ne paralyse pas la bourse, les téléphones déjà connectés utilisent un **jeton** (valable 4 jours, annulé dès que le PIN change) : ils continuent de fonctionner pendant un blocage. Bonus : les téléphones ne gardent plus le PIN en mémoire, seulement le jeton.*
- [x] Accepter les ventes en mode Clôture (aujourd'hui seulement Vente et Restitution) : sinon une vente en attente sur un téléphone est refusée et bloque toute la file de la caisse.
  *Fait (v1.3). En plus : une vente refusée définitivement par le serveur est mise de côté sur le téléphone (avec un message « prévenez l'admin ») au lieu de bloquer les ventes suivantes.*
- [x] Versionner Code.gs dans le dépôt via clasp ; `.clasprc.json` dans `.gitignore` ; jamais de PIN ni de SEL dans le dépôt.
  *Fait le 25/11/2026 : `apps-script/` (Code.gs + manifeste + `.clasp.json` pointant vers le projet déployé) est dans le dépôt, sans PIN ni sel. Git, Node.js et clasp installés ; v1.3 envoyée par `clasp push` puis publiée sur le même déploiement (`clasp deploy -i …`), même adresse /exec. Attention : chaque sauvegarde Drive copie aussi le script (« Caisse QR » en plusieurs exemplaires) ; le projet déployé est celui ouvert depuis le Sheet par Extensions > Apps Script.*
- [x] Règle de version : numéro uniquement dans le code (constante VERSION), augmenté à chaque modification ; les messages de commit décrivent le changement.
  *Fait : VERSION = '1.3', règle écrite en tête de Code.gs et dans le README ; l'Admin affiche « serveur v1.3 » pour vérifier le déploiement.*
- [x] README à remplir (rôle de chaque page, déploiement).
- [x] (déjà demandé par Emilien) « Retirer un article d'une vente » au lieu d'annuler toute la vente + recherche qui affiche la vente d'origine à partir du code d'un article (heure, caisse, moyen de paiement, prix).
  *Fait (v1.3) : bouton « Retour d'article » sur chaque vente et « Retour » dans la recherche (qui affiche heure, caisse, moyen de paiement et prix de la vente d'origine). Motif obligatoire, montant à rembourser indiqué (SumUp pour la carte), tableau de bord et caisses corrigés. Refusé si la grille est restituée (vendeur déjà payé).*
- [x] (retour test iPhone) Écran Listing : tout tient sur un écran (8 articles sur une ligne, pavé compact, « Valider ce prix » et Précédent / Passer / Fin de grille fixés en bas, au-dessus de la barre de Safari).

## Retours des tests du 25/11/2026 (v1.4)
- [x] Listing fluide : ouverture d'une grille instantanée (toutes les grilles sont gardées sur le téléphone) et « Valider la grille » sans attente (envoi en arrière-plan, pastille « ⏳ N en attente / ✓ Tout envoyé »).
- [x] Listing fermé dès que l'admin quitte le mode Listing (vérifié toutes les 15 s) : fenêtre « la saisie des prix est terminée ». Une grille validée qui n'a pas pu partir à temps s'affiche en rouge avec ses prix, à transmettre à l'admin (correction de prix).
- [x] Caisse : menu ⋮ > « Changer le numéro de caisse » (ex. une caisse carte/chèque, une caisse espèces).
- [x] Restitution : « Le vendeur donne des invendus… » → on coche les jouets donnés, les autres sont rendus. *(Option peut-être supprimée plus tard : à voir avec le bureau.)*
- [x] Bac à sable (Admin, mode Préparation uniquement) : « Tout remettre à zéro » (confirmation EFFACER ; PIN, paramètres, codes de grilles et journal gardés) et « Créer les données de test » (ex. A1-A9 remplies au hasard, B1-B9 vierges pour s'entraîner au listing). Aussi dans le menu du Sheet.

## Retours des tests (v1.5)
- [x] Mode **Repos (pause)** : personne ne peut saisir, vendre ou restituer, sauf l'admin (ex. samedi soir entre le listing et la vente). Les ventes en attente sur un téléphone repartent dès la réouverture. La sauvegarde Drive se fait aussi en passant de Repos à Vente.
- [x] Admin : cases « Stock déposé » (nombre d'articles et valeur) et « Encore en vente ».
- [x] Liste des prix PDF / CSV au passage en Vente : **désactivée par défaut**, à cocher dans l'Admin (réglage gardé sur le PC). La copie Drive reste automatique.
- Grille validée deux fois (deux téléphones, ou hors ligne) : le serveur garde **la dernière arrivée**, chaque changement (ancien → nouveau prix) est noté au journal. Une grille déjà vendue ne peut pas être modifiée sur ses articles vendus. Consigne : une grille = un bénévole.

## Retours des tests (v1.6)
- [x] **Caisse en panne en v1.5** (page qui ne démarrait plus : erreur d'apostrophe dans le message du mode Repos). Corrigé. Désormais, la syntaxe de toutes les pages est vérifiée automatiquement avant chaque publication.
- [x] Caisse en mode Repos : affiche directement « Application en pause » après la connexion.
- [x] Restitution : fenêtre bloquante hors du mode Restitution (comme le listing), vérifiée toutes les 15 s.
- [x] **Garde-fou de réimpression des grilles** : chaque grille imprimée est datée (colonne `imprimee_le` ajoutée à la fin de l'onglet Grilles). Si on redemande des grilles déjà imprimées, l'Admin prévient et propose les prochaines jamais imprimées (ex. A10 à A18) ; on peut quand même réimprimer (grilles abîmées, non distribuées). L'Admin affiche « Déjà imprimées : A : 18 grille(s), prochaine A19 ».
- [x] Bac à sable : jusqu'à 99 grilles par lettre (message clair au-delà).

## Jouet sans talon (talon décollé ou arraché)
Idée des photos au listing **écartée le 25/11/2026** : trop de photos à parcourir, ralentit le dépôt, la recherche par description fait déjà le tri. Consignes retenues à la place :
- En caisse : jouet sans talon mis de côté ; l'admin cherche par mot de la description et le vend s'il n'y a pas de doute.
- À la restitution : table « sans talon » ; chaque vendeur reconnaît ses jouets.
- Prévention : double du code écrit sur un scotch de masquage sous les jouets chers ou fragiles.

### Piste à tester : étiquettes autocollantes QR (25/11/2026)
- Collage par un bénévole au listing **écarté** : il faudrait retrouver la planche de la bonne grille pour chaque vendeur → trop lent.
- Variante retenue comme piste : distribuer **avec chaque grille vierge** une petite planche de 8 étiquettes autocollantes (QR + code + « Prix : ___ € »), que le vendeur colle lui-même chez lui, à la place des talons agrafés. Aucune étape en plus au listing.
- Étiquettes **repositionnables / enlevables** (ne pas abîmer boîtes et livres). Les peluches et tissus gardent un talon attaché (ficelle, épingle).
- Générateur PDF à adapter au gabarit exact des planches choisies (référence du fabricant). QR ≥ 9,5 mm à garder.
- Coût et logistique à chiffrer (planches + découpe par grille) ; tester sur quelques grilles avant de généraliser.

## Paiement par carte (SumUp) – piste
- Le compte SumUp de l'asso servirait uniquement aux acheteurs. Remboursement partiel possible dans l'appli SumUp ; pas de frais si remboursé avant le versement (le lendemain). Frais : 1,75 % en paiement à l'utilisation.
- Matériel actuel de l'asso : petit lecteur relié en Bluetooth au téléphone (appli SumUp, montant tapé à la main ; probablement un Solo Lite ou un ancien Air, modèle exact à confirmer). Ce type de lecteur n'est pas compatible avec la Cloud API.
- **v1 faite (v1.3)** : bouton « 💳 Carte » sur l'écran de paiement, avec le rappel « n'appuyer qu'après Paiement accepté », colonne Carte au tableau des caisses et dans la vente papier.
- v1 (manuel, avec le lecteur actuel) : bouton « Carte » à côté d'Espèces/Chèque (valeur `carte` dans PAIEMENTS, ventilation au tableau de bord). Le bénévole tape le total dans l'appli SumUp et n'appuie sur « Carte » qu'après « Paiement accepté ». Retour d'un article : retirer l'article dans l'Admin, puis remboursement partiel dans SumUp (retrouvé par heure + montant). Le soir : comparer le total « Carte » au total du jour dans SumUp. De préférence un téléphone dédié à SumUp (changer d'appli coupe la caméra de la caisse QR).
- Plus tard (après validation du bureau, sur le compte de l'asso) : automatisation via la **Cloud API SumUp**, qui exige un terminal **Solo** autonome (environ 79 € HT / 95 € TTC, prix constaté le 25/11/2026 ; batterie, SIM 4G, écran tactile, catalogue d'articles utilisable seul pour les buvettes). Le script envoie le montant au Solo avec `vente_id` comme référence (`foreign_transaction_id`) et reçoit le résultat. Prérequis : clé API + clé d'affiliation (dans les propriétés du script, jamais dans le dépôt), appairage du Solo, Solo sur sa base ou une batterie pendant la vente, données mobiles du Solo à faire activer par SumUp pour la Cloud API. Testable gratuitement avec Virtual Solo + compte sandbox. Les remboursements ne font pas partie de la Cloud API (restent manuels dans l'appli SumUp, mais faciles à retrouver grâce au numéro de vente). Payment Switch (ouvrir l'appli SumUp depuis la page) : n'est plus développé, à éviter.

## Questions pour le bureau
- **Fonds de caisse** : se permet-on un fonds de caisse beaucoup plus élevé pour compenser les paiements par carte ? (L'argent CB arrive le lendemain sur SumUp, alors que les vendeurs sont payés en espèces le soir même.) Alternatives : virement à une partie des vendeurs les jours suivants, montant minimum pour la CB. Le tableau de bord montre en direct la répartition espèces / chèques / carte : la trésorière peut anticiper (retrait d'espèces avant la restitution).
- **Retours** : acceptés seulement le jour même avant la restitution (ex. jusqu'à 17 h), ou « vendu en l'état » ?
- **Achat d'un Solo** (~95 € TTC) : utile seul pour les buvettes et autres événements (ne dépend plus du téléphone de la personne qui a le compte), et permet ensuite d'automatiser la CB à la bourse.
- **Étiquettes autocollantes QR** fournies avec les grilles : budget planches, essai sur une partie des grilles ?
- Arrondi des sommes versées aux vendeurs (au centime pour l'instant).

## Sécurité – à vérifier
- ~~PIN mémorisés dans le navigateur des téléphones~~ Depuis la v1.3, les téléphones ne gardent plus le PIN, seulement un jeton de 4 jours (annulé si le PIN change). Toujours : changer les PIN chaque année, déconnecter les téléphones personnels en fin de journée (« Quitter »). L'écran Admin utilise sessionStorage (oublié à la fermeture) : OK.
- Sheet et projet Apps Script partagés uniquement avec le bureau (lecture seule si possible).
- Déploiement : « Exécuter en tant que : moi », « Accès : tout le monde » (protection par PIN).

## Erreurs possibles – consignes
- ~~Ne pas passer en Clôture avant « ✓ Tout envoyé »~~ Corrigé en v1.3 (ventes acceptées en Clôture). Bonne pratique quand même : vérifier « ✓ Tout envoyé » sur chaque caisse avant de faire les comptes.
- Après la mise à jour v1.3 : relancer « Caisse QR > 1. Installer les onglets » (ajoute les colonnes `rembourse` et `retours` à la fin de l'onglet Ventes) et redéfinir les PIN en 6 chiffres.
- Redéployer via « Gérer les déploiements → modifier → Nouvelle version » (sinon l'URL change et `config.js` ne pointe plus au bon endroit).
- Ne pas ajouter/déplacer/renommer de colonnes dans le Sheet (le code lit les colonnes par position) ; ne pas modifier le Sheet à la main pendant la vente (chaque vente réécrit l'onglet Articles).
- Changer l'édition dans l'onglet Paramètres chaque année.
- Pas de navigation privée sur les téléphones de caisse ; ne jamais fermer la page avec des ventes en attente.
- Jamais deux fichiers .gs avec le même code dans le projet (déclarations en double → le script plante).

## Déjà bien en place
PIN hachés avec sel dans les propriétés du script ; LockService ; déduplication par vente_id ; double vente entre caisses enregistrée « à vérifier » avec total encaissé séparé ; protection contre les formules ; règle des 0,50 € ; refus des autres éditions.
