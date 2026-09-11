/**
 * BACKEND RANGOU — Paiement manuel vérifié
 * ------------------------------------------------------------
 * Aucun compte marchand tiers requis. Principe :
 *  1. L'acheteur demande à payer -> une transaction "en_attente"
 *     est créée sur ce serveur.
 *  2. L'acheteur envoie l'argent lui-même (Orange Money, Wave...)
 *     au numéro affiché dans l'app, en dehors du site.
 *  3. Vous (admin) ouvrez la page /admin sur ce même serveur,
 *     entrez votre mot de passe, et voyez la liste des paiements
 *     en attente. Vous vérifiez sur votre téléphone que l'argent
 *     est bien arrivé, puis cliquez "Confirmer".
 *  4. À ce moment-là seulement, la carte est créée. L'app de
 *     l'acheteur (qui vérifie le statut toutes les quelques
 *     secondes) affiche alors sa carte automatiquement.
 *
 * Stockage : fichier JSON simple sur le disque du serveur.
 * Limite à connaître : sur l'offre gratuite de Render, ce fichier
 * est remis à zéro à chaque redéploiement (pas à chaque simple
 * redémarrage/veille). Suffisant pour démarrer ; pour une vraie
 * activité, prévoir une vraie base plus tard (ex. Supabase).
 * ------------------------------------------------------------
 */

const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());
app.use(cors({ origin: process.env.FRONTEND_ORIGIN || "*" }));
app.use(express.static(path.join(__dirname, "public")));

const DATA_FILE = path.join(__dirname, "data.json");
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "changeMoi123";

function readData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch (e) {
    return { transactions: {} };
  }
}
function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function checkAdmin(req, res, next) {
  const pass = req.headers["x-admin-password"];
  if (pass !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Mot de passe incorrect" });
  }
  next();
}

app.get("/", (req, res) => {
  res.json({ ok: true, service: "rangou-payment-backend (manuel)" });
});

// ---------------------------------------------------------------
// Acheteur : je veux payer
// ---------------------------------------------------------------
app.post("/api/payments/request", (req, res) => {
  const { nom, telephone, montant, abonnementForm } = req.body;
  if (!nom || !telephone || !montant) {
    return res.status(400).json({ error: "Champs manquants" });
  }
  const id = `RGA-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
  const data = readData();
  data.transactions[id] = {
    id,
    statut: "en_attente",
    nom,
    telephone,
    montant,
    abonnementForm,
    creeLe: new Date().toISOString(),
  };
  writeData(data);
  res.json({ transaction_id: id });
});

// ---------------------------------------------------------------
// Acheteur : est-ce confirmé ?
// ---------------------------------------------------------------
app.get("/api/payments/:id/status", (req, res) => {
  const data = readData();
  const tx = data.transactions[req.params.id];
  if (!tx) return res.status(404).json({ error: "Transaction inconnue" });
  res.json({ statut: tx.statut, carte: tx.carte || null });
});

// ---------------------------------------------------------------
// Admin : liste des paiements en attente
// ---------------------------------------------------------------
app.get("/api/admin/pending", checkAdmin, (req, res) => {
  const data = readData();
  const pending = Object.values(data.transactions)
    .filter((t) => t.statut === "en_attente")
    .sort((a, b) => new Date(a.creeLe) - new Date(b.creeLe));
  res.json({ pending });
});

// ---------------------------------------------------------------
// Admin : confirmer un paiement -> crée la carte
// ---------------------------------------------------------------
app.post("/api/admin/confirm", checkAdmin, (req, res) => {
  const { id } = req.body;
  const data = readData();
  const tx = data.transactions[id];
  if (!tx) return res.status(404).json({ error: "Transaction inconnue" });

  const now = new Date();
  const dureeMois = parseInt(tx.abonnementForm?.duree || "1", 10);
  const expiration = new Date(now);
  expiration.setMonth(expiration.getMonth() + dureeMois);

  tx.statut = "confirmee";
  tx.carte = {
    id: tx.id,
    nom: tx.nom,
    telephone: tx.telephone,
    type: tx.abonnementForm?.type || "Revendeur",
    duree: tx.abonnementForm?.duree || "1",
    montant: tx.montant,
    moyenPaiement: "Paiement manuel vérifié",
    numero: `RGA-${Math.floor(1000 + Math.random() * 9000)}-${Math.floor(1000 + Math.random() * 9000)}`,
    dateCreation: now.toISOString(),
    expiration: expiration.toISOString(),
  };
  writeData(data);
  res.json({ ok: true, carte: tx.carte });
});

// ---------------------------------------------------------------
// Admin : rejeter un paiement (jamais reçu / montant faux...)
// ---------------------------------------------------------------
app.post("/api/admin/reject", checkAdmin, (req, res) => {
  const { id } = req.body;
  const data = readData();
  const tx = data.transactions[id];
  if (!tx) return res.status(404).json({ error: "Transaction inconnue" });
  tx.statut = "refusee";
  writeData(data);
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Serveur Rangou (paiement manuel) sur le port ${PORT}`));
