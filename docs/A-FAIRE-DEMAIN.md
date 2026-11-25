# Mise à jour v1.3 – marche à suivre

Rien n'a été modifié sur vos comptes Google ou GitHub : tout est dans Documents\bourse-aux-jouets.

## Ce qui change en v1.3

- **Retour d'un article** (Admin) : bouton « Retour d'article » sur chaque vente, et « Retour » dans la recherche, qui montre aussi la vente d'origine (heure, caisse, paiement). Motif obligatoire, montant à rembourser affiché. Refusé si le vendeur est déjà payé (grille restituée).
- **Paiement par carte** (v1 manuelle) : bouton « 💳 Carte » en caisse, colonne Carte au tableau des caisses.
- **Écran Listing** : tout tient sur un écran d'iPhone, boutons fixés en bas.
- **Sécurité** : PIN de 6 chiffres obligatoires, blocage global après 30 essais ratés, téléphones connectés par jeton (le PIN n'est plus gardé dans le téléphone).
- **Clôture** : les ventes en retard sont acceptées ; une vente refusée ne bloque plus la file de la caisse.
- **Tests : effacer les ventes** : seulement en mode Préparation.

## Avec le copier-coller (comme d'habitude)

1. **Apps Script** : recollez `apps-script\Code.gs` (Ctrl + A, Ctrl + V, Ctrl + S).
2. **Publier** : Déployer > Gérer les déploiements > crayon > Version : **Nouvelle version** > Déployer. Vérification : l'adresse /exec affiche `"version":"1.3"`.
3. **Google Sheet** : rechargez (F5), puis **Caisse QR > 1. Installer les onglets** (ajoute 2 colonnes à la fin de l'onglet Ventes).
4. **Codes PIN** : **Caisse QR > 2. Définir les codes PIN**, avec **6 chiffres** pour chaque rôle.
5. **GitHub** : déposez `admin.html`, `caisse.html`, `listing.html`, `restitution.html`, `commun.js`, `README.md`, le dossier `docs` et le dossier `apps-script`.
   Ne déposez pas `presentation` ni `.claude` (le fichier `.gitignore` les exclura quand Git sera installé).
6. **Téléphones** : chacun doit retaper son code PIN une fois (ancienne connexion effacée).

## Ou, si vous me donnez votre accord : Git + clasp

Je publie moi-même sur GitHub et dans Apps Script, après votre feu vert à chaque fois. Voir l'explication dans la conversation.

## À tester

| Où | Quoi |
|---|---|
| iPhone, Listing | Saisir une grille sans faire défiler l'écran |
| iPhone, Caisse | Payer une vente par « Carte » ; puis verrouiller/déverrouiller le téléphone |
| PC, Admin | Tableau des caisses avec la colonne Carte ; « Retour d'article » sur une vente ; recherche d'un article vendu (vente d'origine affichée) |
| Restitution | Après un retour, l'article rapporté n'est plus compté dans la somme à verser |
| Admin | Passer en Clôture avec une vente en attente sur un téléphone : elle doit passer |
