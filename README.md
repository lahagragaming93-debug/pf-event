# PROTOCOLE OMERTA

Plateforme web temps reel pour un event RP competitif "illegal" (3 manches) sur le serveur FiveM **FlashFA**. Codename interne : **PF**.

- Espace **GROUPE** (cellules) : objectifs, chrono geant, soumission de preuves photo, chasses en direct, chat avec le GM, classement, ecran OUT.
- Cockpit **GAME MASTER** : controle des manches et du chrono, validation des preuves, gestion des objectifs et des chasses, classement, eliminations, creation/suppression des cellules.

Stack : **HTML / CSS / JS vanilla** (aucune etape de build), **Firebase Web SDK v10 modulaire** (Firestore + Storage + Auth anonyme), deployable tel quel sur **GitHub Pages**.

---

## Structure du projet

```
pf-event/
├── index.html            # Espace GROUPE (login + dashboard)
├── admin.html            # Cockpit GAME MASTER
├── css/
│   └── styles.css        # Direction artistique hacker / clandestin
├── js/
│   ├── firebase-config.js  # >>> TA config Firebase (placeholders a remplir)
│   ├── firebase-init.js    # Init SDK + auth anonyme
│   ├── common.js           # Constantes, chrono, toast, modale, collage image
│   ├── auth.js             # Login groupe + barriere GM
│   ├── objectives.js       # Seed objectifs M1/M2 + chasses
│   ├── group-app.js        # Logique espace groupe
│   └── admin-app.js        # Logique cockpit GM
├── firestore.rules        # Regles Firestore (anti-triche, points GM only)
├── storage.rules          # Regles Storage
├── firebase.json          # Pour deployer les regles via la CLI Firebase
└── README.md
```

---

## Mise en route pas a pas

### 1. Creer le projet Firebase
1. Va sur https://console.firebase.google.com > **Ajouter un projet** (nouveau projet dedie).
2. Une fois cree, ajoute une **application Web** (icone `</>`). Donne-lui un nom (ex : `pf-web`).
3. Firebase affiche un objet `firebaseConfig`. **Garde-le sous la main** pour l'etape 3.

### 2. Activer Firestore + Storage + Auth anonyme
Dans la console du projet :
- **Build > Authentication > Sign-in method** : active **Anonyme**.
- **Build > Firestore Database** : **Creer une base** (mode production, region au choix EU).
- **Build > Storage** : **Commencer** (mode production).

### 3. Coller la config dans `firebase-config.js`
Ouvre `js/firebase-config.js` et remplace les placeholders par les valeurs de ton `firebaseConfig` (etape 1) :

```js
export const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "ton-projet.firebaseapp.com",
  projectId: "ton-projet",
  storageBucket: "ton-projet.appspot.com",
  messagingSenderId: "1234567890",
  appId: "1:1234567890:web:abcdef..."
};
```

> Ces cles Web sont **publiques par nature** (elles partent dans le navigateur). La securite reelle vient des regles Firestore/Storage, pas du secret de ces valeurs.

### 4. Deployer les regles Firestore + Storage
Deux options.

**Option A - Copier-coller dans la console (le plus simple)**
- **Firestore Database > Regles** : colle le contenu de `firestore.rules` puis **Publier**.
- **Storage > Regles** : colle le contenu de `storage.rules` puis **Publier**.

**Option B - CLI Firebase**
```bash
npm install -g firebase-tools
firebase login
firebase use --add        # selectionne ton projet
firebase deploy --only firestore:rules,storage
```

### 5. Creer le repo GitHub + activer GitHub Pages
```bash
cd pf-event
git init
git add .
git commit -m "PROTOCOLE OMERTA - init"
git branch -M main
git remote add origin https://github.com/<ton-compte>/pf-event.git
git push -u origin main
```
Puis sur GitHub : **Settings > Pages** > Source = **Deploy from a branch** > Branch = **main** / **/(root)** > Save.
Ton site sera servi sur `https://<ton-compte>.github.io/pf-event/`.

> Le repo peut s'appeler autrement, ca n'a aucun impact sur le code.

### 6. Creer le compte admin (GM) et mettre son uid dans `config/admins`
L'acces GM est protege par une **allowlist d'uid** (la vraie securite) + un **mot de passe GM** (confort).

1. Ouvre `https://<ton-site>/admin.html`. La page se connecte en anonyme et affiche **ton uid** avec un bouton "Copier".
2. Dans la console : **Firestore Database > Demarrer une collection** `config`, document `admins`, avec les champs :
   - `uids` (type **map**) -> ajoute une cle = **ton uid copie**, valeur **true** (booleen).
   - `password` (type **string**) -> ton mot de passe GM (ex : `OMERTA-GM`).

   Le document doit ressembler a :
   ```
   config/admins = {
     uids: { "TON_UID": true },
     password: "OMERTA-GM"
   }
   ```
3. Recharge `admin.html`, entre le mot de passe GM : tu es dans le cockpit.

> Tu peux ajouter d'autres GM plus tard en ajoutant leurs uid dans `uids`. Le doc `config/event` se cree tout seul au premier acces au cockpit.

### 7. Creer les 12 groupes + initialiser les objectifs
Dans le cockpit GM :
1. Onglet **Objectifs** > **Initialiser les objectifs par defaut** (charge M1 objets + M2 photo).
2. Onglet **Chasses** > **Initialiser chasses d'exemple** (optionnel : 3 creneaux du Jour 2). Ajoute la photo du lieu et ouvre-les au bon moment.
3. Onglet **Creer un groupe** > cree tes 12 cellules (nom + code auto-genere ou manuel). Note les codes (tu peux toujours les revoir/regenerer depuis le panneau du groupe).

---

## Tester en live (apres deploiement)

1. **GM** : ouvre `admin.html`, connecte-toi, cree 2-3 groupes de test, **Initialise les objectifs**.
2. **Groupe** : sur un tel ou un autre onglet/navigateur, ouvre `index.html`, connecte-toi avec un nom + code de groupe.
3. **Manche 1** :
   - GM : Manche **1** selectionnee > **Demarrer** (chrono 24h). Le chrono geant tourne des deux cotes.
   - GM : panneau du groupe > boutons **+ / -** pour incrementer les objets livres. Quand toutes les cibles sont atteintes, le groupe passe **complete** automatiquement (ou bouton "Marquer complete").
   - Des que **8 groupes** sont completes, les autres passent **OUT** (l'ecran OUT glitch s'affiche en temps reel chez eux).
4. **Manche 2** :
   - GM : Manche **2** > **Demarrer** (48h).
   - Groupe : onglet **Soumettre** > **Ctrl+V** d'une capture ou choix de fichier > selectionne l'objectif > **Transmettre**.
   - GM : panneau du groupe > **Valider** (les points se creditent) ou **Refuser**.
   - **Chasse** : GM onglet Chasses > **Ouvrir** une chasse > elle s'affiche en direct chez les groupes avec compte a rebours > le groupe transmet la photo de rencontre > GM valide.
   - GM : **Cloturer la manche** = top 4 qualifies, le reste OUT.
5. **Manche 3** :
   - GM cree les objectifs/chasses voulus en direct (onglets Objectifs/Chasses), **Demarrer**, puis **Cloturer** = classement final (top 3 gagnants, 4e perdant).
6. **Nettoyage** : onglet **Section OUT** > supprime une cellule eliminee, ou **Purge tous les OUT** (efface groupe + preuves + messages + fichiers Storage).

---

## Notes de conception (choix faits)

- **Auth** : tout le monde (groupes et GM) utilise l'**auth anonyme** Firebase. L'uid sert aux regles. Le GM est identifie par son **uid dans `config/admins`** ; le mot de passe GM est une barriere de confort, lisible uniquement par un uid deja autorise.
- **Mots de passe groupe** : stockes en clair (le GM doit pouvoir les recommuniquer). Les docs groupe sont lisibles par les utilisateurs connectes (necessaire pour le classement et le login). C'est de la **securite legere** assumee (event RP). En revanche, **points / statut / progression / validations sont inviolables cote groupe** : seul le GM peut les ecrire (voir `firestore.rules`).
- **Points** : jamais derives de ce que soumet un groupe. A la validation, le GM credite les points depuis la **source de verite** (l'objectif ou la chasse), pas depuis la soumission.
- **Chrono** : stocke dans `config/event` (`endsAt`, `remainingMsAtPause`, `status`). Les deux interfaces calculent le restant depuis ces valeurs, pas de timer local desynchronise. Une legere derive d'horloge entre machines est possible (sans impact RP).
- **Chasses** : gerees dans leur propre collection `chasses` (comportement specifique : fenetre, ouverture/fermeture, diffusion live). Les objectifs `count` et `photo` vivent dans `objectives`. Les soumissions hors fenetre sont marquees **hors delai** et non creditees.
- **Manche 1 automatique** : l'auto-completion et le passage OUT au 8e complet sont declenches par le cockpit (le GM est la machine qui incremente). L'ecran OUT s'affiche en temps reel chez les groupes ; la **suppression** reste manuelle (section OUT).

---

## Modele de donnees (Firestore)

- `config/event` : `currentManche`, `status`, `endsAt`, `remainingMsAtPause`, `durationHours`, `durationHoursByManche`, `qualifyCount`.
- `config/admins` : `{ uids: { <uid>: true }, password }`.
- `groups/{id}` : `name`, `nameLower`, `password`, `status` (active/completed/qualified/out), `memberUids[]`, `manche1Progress` (map objId -> qte), `points` (map manche -> pts, **GM only**), `completedAt`, `completionRank`, `eliminatedAt`, `createdAt`, `lastReadByGm`.
- `groups/{id}/submissions/{id}` : `objectiveId`, `chasseId`, `manche`, `type`, `label`, `photoUrl`, `storagePath`, `status`, `points`, `credited`, `submittedAt`, `validatedAt`, `note`.
- `groups/{id}/messages/{id}` : `sender` (group/gm), `text`, `createdAt`.
- `objectives/{id}` : `manche`, `type` (count/photo), `label`, `targetQty`, `points`, `repeatable`, `order`.
- `chasses/{id}` : `label`, `photoUrl`, `storagePath`, `points`, `windowMinutes`, `manche`, `status` (idle/open/closed), `openedAt`, `closesAt`, `order`.

---

## Depannage rapide

- **"Habilitation refusee" sur admin.html** : ton uid n'est pas (ou mal) dans `config/admins.uids`. Recopie l'uid affiche, verifie que la valeur est bien le booleen `true`.
- **Les groupes ne voient rien / erreurs permission** : verifie que **Auth anonyme** est active et que les regles Firestore sont publiees.
- **Upload photo qui echoue** : verifie que **Storage** est active et que `storage.rules` est publie (image < 10 Mo).
- **Le login groupe ne trouve pas le groupe** : le nom est insensible a la casse mais doit correspondre ; recree le groupe si besoin.
