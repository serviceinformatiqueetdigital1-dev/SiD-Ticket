# Mettre l'application en ligne (accessible par un lien, depuis n'importe quel navigateur)

Ce guide ne demande aucune commande technique compliquée — juste des clics sur deux sites web gratuits : **GitHub** (pour stocker le code) et **Render** (pour le faire tourner en ligne).

⚠️ **Rappel important** : une fois en ligne, l'application ne pourra plus parler directement à votre routeur MikroTik (qui est chez vous, sur un autre réseau). Elle reste utile pour : gérer vos profils/tickets, suivre vos ventes, consulter depuis votre téléphone où que vous soyez. La création automatique des comptes Hotspot sur le routeur nécessitera une étape supplémentaire plus tard (un petit programme "agent" installé chez vous — on pourra le construire quand vous serez prêt).

## Étape 1 — Créer un compte GitHub (gratuit)

1. Allez sur https://github.com
2. Cliquez "Sign up", créez un compte gratuit

## Étape 2 — Créer un dépôt et y déposer le code

1. Une fois connecté, cliquez sur le **+** en haut à droite → **"New repository"**
2. Donnez-lui un nom, ex: `wifizone-app` — laissez-le **Public** ou **Private** (peu importe) → **"Create repository"**
3. Sur la page qui suit, cliquez **"uploading an existing file"**
4. Ouvrez sur votre ordinateur le dossier `customer-app` (celui que je vous ai fourni), **sélectionnez tous les fichiers et dossiers à l'intérieur** (pas le dossier `customer-app` lui-même, son contenu), et glissez-déposez-les dans la page GitHub
5. En bas de la page, cliquez **"Commit changes"**

## Étape 3 — Créer un compte Render (gratuit)

1. Allez sur https://render.com
2. Cliquez "Get Started", inscrivez-vous avec votre compte GitHub (le plus simple, un clic)

## Étape 4 — Déployer l'application

1. Sur le tableau de bord Render, cliquez **"New +"** → **"Web Service"**
2. Choisissez votre dépôt `wifizone-app` (autorisez l'accès si demandé)
3. Render détecte automatiquement que c'est une application Node — laissez les réglages par défaut :
   - **Build Command** : `npm install`
   - **Start Command** : `npm start`
4. Choisissez le plan **"Free"**
5. Cliquez **"Create Web Service"**

Après 1-2 minutes, Render vous donne un lien du type :
```
https://wifizone-app-xxxx.onrender.com
```

C'est ce lien que vous pouvez ouvrir depuis **n'importe quel navigateur, sur n'importe quel appareil** (téléphone Android via Chrome, Firefox, Opera Mini, etc. — pas besoin d'installer quoi que ce soit).

## À savoir sur le plan gratuit de Render

- L'application "s'endort" après 15 minutes sans visite, et met quelques secondes à se réveiller au prochain accès — normal sur le plan gratuit.
- Les données (tickets, profils) sont stockées dans un simple fichier sur le serveur. Sur le plan gratuit, ce fichier peut être remis à zéro si vous republiez une nouvelle version du code. Pour un usage commercial sérieux à long terme, on pourra passer à un plan payant avec stockage permanent (quelques dollars/mois), ou passer à une vraie base de données.

## Mettre à jour l'application plus tard

Si je vous donne une nouvelle version des fichiers : retournez sur votre dépôt GitHub → supprimez les anciens fichiers → uploadez les nouveaux (même méthode qu'à l'étape 2) → Render republie automatiquement la nouvelle version en quelques minutes.
