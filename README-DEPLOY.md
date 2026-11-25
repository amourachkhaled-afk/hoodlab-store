# HOODLAB — déploiement permanent

La boutique tourne avec **Node 24 + SQLite intégré**, sans aucune dépendance npm.

## 1. Déployer sur Render (gratuit, HTTPS, disque persistant)

1. Créez un dépôt GitHub et poussez ce dossier :
   ```bash
   git init && git add . && git commit -m "HOODLAB store"
   git remote add origin https://github.com/VOTRE_COMPTE/hoodlab-store.git
   git push -u origin main
   ```
   Le fichier `.env` est exclu du dépôt (voir `.gitignore`).
2. Sur https://render.com → **New → Blueprint** → sélectionnez le dépôt.
   `render.yaml` crée le service web + un disque persistant `/data`.
3. Dans l'onglet **Environment**, ajoutez :
   - `STRIPE_SECRET_KEY` = `sk_test_...` (puis `sk_live_...` en production)
   - `STRIPE_WEBHOOK_SECRET` = `whsec_...` (optionnel)
   - `PUBLIC_URL` = l'URL Render (ex. `https://hoodlab.onrender.com`) — nécessaire pour que Stripe renvoie vers le bon domaine.
4. L'URL publique est `https://hoodlab.onrender.com`.

## 2. Railway (alternative)

```bash
railway login
railway init
railway up
```
Ajoutez un volume monté sur `/data` dans le dashboard, puis les mêmes variables d'environnement.

## 3. Après le déploiement

- Stripe Dashboard → Webhooks → `https://VOTRE-DOMAINE/api/webhook`, événement `checkout.session.completed`.
- Payez avec la carte de test `4242 4242 4242 4242`.
- Les produits et commandes sont dans `/data/shop.db` (disque persistant).
- Admin (démo) : `admin@hoodlab.fr` / `admin123` — à remplacer par une vraie authentification avant la mise en production.

## Variables

| Variable | Rôle |
|---|---|
| `PORT` | Port HTTP (4242 par défaut) |
| `DATA_DIR` | Chemin du fichier SQLite (`/data/shop.db` en production) |
| `STRIPE_SECRET_KEY` | Clé secrète Stripe |
| `STRIPE_WEBHOOK_SECRET` | Vérification HMAC du webhook |
| `PUBLIC_URL` | URL publique pour les redirections Stripe |

## Limites à traiter avant une vraie mise en vente

- L'authentification admin est une démo côté navigateur : la remplacer par une session serveur.
- Ajouter la gestion des stocks, taxes, factures et emails transactionnels.
- Remplacer les visuels SVG par de vraies photos produits.
