# Rangou — brancher le vrai paiement

## Étape 1 — Mettre ce backend sur GitHub
Créez un **nouveau** dépôt GitHub (différent de `rangou`), par exemple
`rangou-backend`. Uploadez ces 3 fichiers **en une seule fois** (Add file
→ Upload files) :
- `index.js`
- `package.json`
- `.gitignore`

## Étape 2 — Créer un compte CinetPay
1. Allez sur https://cinetpay.com → "Créer un compte" (gratuit)
2. Une fois inscrit, allez dans votre tableau de bord → **"Intégration"**
   ou **"API"** → récupérez :
   - `APIKEY`
   - `SITE_ID`
   (CinetPay peut demander une vérification d'identité/entreprise avant
   d'activer les paiements réels — c'est normal, ça prend parfois
   quelques jours. En attendant, ils fournissent en général un mode test.)

## Étape 3 — Héberger le backend sur Render (gratuit)
1. Allez sur https://render.com → connectez-vous avec GitHub
2. "New +" → "Web Service"
3. Choisissez le dépôt `rangou-backend`
4. Réglages :
   - **Build Command** : `npm install`
   - **Start Command** : `npm start`
   - **Instance Type** : Free
5. Dans "Environment Variables", ajoutez :
   | Clé | Valeur |
   |---|---|
   | `CINETPAY_APIKEY` | (celle de CinetPay) |
   | `CINETPAY_SITE_ID` | (celui de CinetPay) |
   | `NOTIFY_URL` | `https://VOTRE-SERVICE.onrender.com/api/payments/webhook` |
   | `RETURN_URL` | `https://dadj2up.github.io/rangou/` |
   | `FRONTEND_ORIGIN` | `https://dadj2up.github.io` |
6. "Create Web Service" → attendez le déploiement (2-5 min)
7. Vous obtenez une URL du style `https://rangou-backend-xxxx.onrender.com`
   — ouvrez-la dans un navigateur, vous devez voir `{"ok":true,...}`

⚠️ Sur le plan gratuit de Render, le serveur "s'endort" après 15 min
d'inactivité et met ~30-50 secondes à se réveiller au prochain appel.
Pour une vraie mise en prod plus tard, un plan payant (7$/mois) évite ça.

## Étape 4 — Me donner l'URL du backend
Une fois que `https://VOTRE-SERVICE.onrender.com` répond bien, donnez-la
moi. Je modifierai alors `App.jsx` pour que le paiement appelle vraiment
ce serveur (au lieu de la simulation actuelle), avec un système d'attente
("en attente de confirmation du paiement...") pendant que CinetPay traite
la transaction réelle.
