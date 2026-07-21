# SID Ticket

Plateforme de gestion de tickets WiFi (créés, vendus, verrouillés à 1 seul appareil) avec intégration MikroTik Hotspot, page d'accueil publique et inscription en ligne.

## Fonctionnement général

- Un visiteur arrive sur la page d'accueil → crée un compte (email, nom de la boutique, téléphone, mot de passe) → accède immédiatement à son espace avec **14 jours d'essai gratuit**.
- Chaque compte a ses propres données isolées (profils, tickets, ventes, configuration du routeur).
- Une page d'administration séparée (`/#admin`) permet de gérer tous les comptes inscrits.

## Installation / déploiement

Voir `DEPLOYMENT.md` pour la mise en ligne (GitHub + Render, sans commande technique).

Pour un lancement local (test) :
```
npm install
npm start
```
Puis ouvrir `http://localhost:3000`.

## Administration

Accessible à `/#admin` (ex: `https://votre-site.onrender.com/#admin`).

Mot de passe par défaut : `admin1234` — **à changer immédiatement** via l'API `/api/admin/change-password` (aucune interface graphique pour l'instant, à ajouter si besoin).

Depuis cette page, vous pouvez pour chaque compte client :
- Prolonger l'essai gratuit (+30 jours)
- Changer de plan (Basique / Pro — le plan Pro débloque le Mode accès distant)
- Activer ou désactiver le compte
- Supprimer définitivement un compte

## Profils (façon TikFlow / Mikhmon)

Avant de générer des tickets, chaque client crée un ou plusieurs **Profils** dans l'onglet "Profils" : nom, prix, utilisateurs simultanés, limite de vitesse, validité, temps actif, limite de données, format des identifiants générés, et verrouillage MAC.

Chaque profil est automatiquement créé/mis à jour comme un vrai profil Hotspot sur le routeur MikroTik du client (`/ip hotspot user profile`).

## Verrouillage à un seul appareil — comment ça marche vraiment

Il y a deux scénarios bien différents, à ne pas confondre :

### Scénario 1 — Un vrai routeur MikroTik est connecté (protection réelle et solide)
1. **Utilisateurs simultanés = 1** (réglage du profil) empêche 2 appareils de se connecter **en même temps**.
2. **Verrouiller par MAC** (si activé sur le profil) va plus loin : dès la **toute première connexion**, un script MikroTik natif fige instantanément le compte sur l'adresse MAC de cet appareil — directement sur le routeur, sans dépendre d'une synchronisation manuelle. Résultat : même si le premier appareil se déconnecte, aucun autre appareil ne pourra jamais réutiliser ce même code.

### Scénario 2 — Aucun routeur connecté, seulement le Portail (`/portal/...`)
⚠️ Sans routeur MikroTik réellement relié à cette application, il n'existe **aucun blocage réseau réel**. Le portail marque simplement un code comme "déjà utilisé" dans la base de données (et refuse toute réutilisation du même code) — mais rien n'empêche techniquement un appareil de rester connecté au WiFi au-delà de cette vérification, puisque c'est votre point d'accès physique qui contrôle réellement l'accès internet, indépendamment de cette application.

**En clair** : pour une vraie sécurité "1 ticket = 1 appareil, pour toujours", il faut un routeur MikroTik connecté avec le verrouillage MAC activé (Scénario 1).

## Connexion au routeur MikroTik

⚠️ Cette application est hébergée en ligne. Elle ne peut contacter un routeur MikroTik que si celui-ci est accessible depuis internet à l'adresse renseignée dans "Routeur MikroTik" — ce qui nécessite une configuration réseau chez le client (redirection de port, VPN, ou passerelle). Sans cette configuration, les tickets/profils sont créés dans l'application mais pas sur le Hotspot réel.

## Mode accès distant (plan Pro)

Nécessite `cloudflared` installé sur le serveur qui héberge l'application. Sur un hébergeur comme Render, cette fonctionnalité n'est généralement pas utilisable telle quelle (pas d'accès pour installer des binaires système) — elle est surtout pertinente pour une installation auto-hébergée sur un PC/Raspberry Pi.

## Limites connues

- Les sessions de connexion sont gardées en mémoire côté serveur : elles sont perdues si le serveur redémarre (ex: sur le plan gratuit Render qui met le service en veille après inactivité). Les utilisateurs devront alors se reconnecter.
- Le stockage des données est un simple fichier JSON. Suffisant pour démarrer, mais à faire évoluer vers une vraie base de données avant une utilisation commerciale à grande échelle.
