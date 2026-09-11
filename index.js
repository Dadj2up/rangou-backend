/**
 * BACKEND DE PAIEMENT — RANGOU
 * ------------------------------------------------------------
 * Ce serveur est le SEUL endroit où on décide si une carte
 * d'abonnement est "payée". Le navigateur de l'utilisateur
 * ne peut jamais déclencher lui-même l'activation.
 *
 * Flux :
 *  1. L'app appelle  POST /api/payments/initiate
 *     -> le serveur crée une transaction "en_attente" en base
 *     -> le serveur demande à CinetPay un lien/QR de paiement
 *     -> renvoie ce lien à l'app (l'utilisateur paie via
 *        Orange Money / MTN / Moov / Wave / carte, sur la
 *        page CinetPay, PAS dans votre app)
 *  2. Quand le paiement aboutit réellement, CinetPay appelle
 *     votre serveur sur  POST /api/payments/webhook
 *     -> le serveur revérifie le statut auprès de CinetPay
 *        (on ne fait jamais confiance au webhook seul, on
 *        recontrôle toujours côté API)
 *     -> si confirmé : transaction -> "payee", et SEULEMENT
 *        alors on crée/active la carte en base
 *  3. L'app interroge  GET /api/payments/:id/status
 *     en boucle (ou via websocket) pour savoir si c'est bon,
 *     et affiche la carte une fois "payee".
 *
 * Ce fichier est un point de départ FONCTIONNEL mais à adapter :
 *  - remplacer le stockage en mémoire (Map) par une vraie base
 *    (Postgres/Supabase/Firebase…)
 *  - héberger ce serveur quelque part (Render, Railway, Fly.io…)
 *  - créer un compte marchand CinetPay et récupérer APIKEY / SITE_ID
 *  - mettre l'URL publique de ce serveur dans NOTIFY_URL
 * ------------------------------------------------------------
 */

const express = require("express");
const crypto = require("crypto");
const cors = require("cors");
const fetch = require("node-fetch"); // npm i express node-fetch@2 cors

const app = express();
app.use(express.json());

// Autorise le front hébergé sur GitHub Pages (dadj2up.github.io) à appeler
// ce backend, qui est sur un autre domaine (ex: onrender.com).
app.use(
  cors({
    origin: process.env.FRONTEND_ORIGIN || "*",
  })
);

// Simple endpoint pour vérifier que le serveur tourne (utile pour Render
// et pour tester rapidement l'URL dans un navigateur).
app.get("/", (req, res) => {
  res.json({ ok: true, service: "rangou-payment-backend" });
});

// ---- Configuration (à mettre dans des variables d'environnement, jamais en dur) ----
const CINETPAY_APIKEY = process.env.CINETPAY_APIKEY;
const CINETPAY_SITE_ID = process.env.CINETPAY_SITE_ID;
const NOTIFY_URL = process.env.NOTIFY_URL; // ex: https://votre-serveur.com/api/payments/webhook
const RETURN_URL = process.env.RETURN_URL; // page où revient l'utilisateur après paiement

// ---- "Base de données" en mémoire — À REMPLACER par une vraie DB en production ----
const transactions = new Map(); // transaction_id -> { statut, abonnementData, montant, ... }
const cartesActivees = new Map(); // transaction_id -> carte créée

function genTransactionId() {
  return `RGA-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
}

// ---------------------------------------------------------------
// 1. Initier un paiement
// ---------------------------------------------------------------
app.post("/api/payments/initiate", async (req, res) => {
  const { montant, nom, telephone, abonnementForm } = req.body;

  if (!montant || !telephone || !nom) {
    return res.status(400).json({ error: "Champs manquants" });
  }

  const transaction_id = genTransactionId();

  // On enregistre la transaction comme "en_attente" AVANT même
  // d'appeler CinetPay : si le paiement échoue ou n'est jamais
  // finalisé, elle restera en_attente pour toujours (pas de carte).
  transactions.set(transaction_id, {
    statut: "en_attente",
    montant,
    nom,
    telephone,
    abonnementForm, // toutes les infos du formulaire (type, durée, CI, code…)
    creeLe: new Date().toISOString(),
  });

  try {
    const cinetpayRes = await fetch("https://api-checkout.cinetpay.com/v2/payment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apikey: CINETPAY_APIKEY,
        site_id: CINETPAY_SITE_ID,
        transaction_id,
        amount: montant,
        currency: "XOF",
        description: `Abonnement Rangou - ${abonnementForm?.type || ""}`,
        customer_name: nom,
        customer_phone_number: telephone,
        notify_url: NOTIFY_URL,
        return_url: RETURN_URL,
        channels: "ALL", // laisse CinetPay proposer Orange Money, MTN, Moov, Wave, carte...
      }),
    });

    const data = await cinetpayRes.json();

    if (data.code !== "201") {
      transactions.get(transaction_id).statut = "echec_initiation";
      return res.status(502).json({ error: "Échec initiation paiement", detail: data });
    }

    // On renvoie l'URL de paiement CinetPay : c'est LÀ que l'utilisateur
    // choisit et confirme son moyen de paiement, pas dans l'app Rangou.
    return res.json({
      transaction_id,
      payment_url: data.data.payment_url,
    });
  } catch (err) {
    transactions.get(transaction_id).statut = "erreur";
    return res.status(500).json({ error: "Erreur serveur paiement" });
  }
});

// ---------------------------------------------------------------
// 2. Webhook CinetPay — notification asynchrone de paiement
// ---------------------------------------------------------------
app.post("/api/payments/webhook", async (req, res) => {
  // On répond vite à CinetPay (sinon il réessaiera), le traitement
  // se fait ensuite.
  res.sendStatus(200);

  const { cpm_trans_id } = req.body; // CinetPay envoie l'id de transaction
  const transaction_id = cpm_trans_id;
  const tx = transactions.get(transaction_id);
  if (!tx) return;

  // RÈGLE D'OR : on ne fait JAMAIS confiance au contenu du webhook seul
  // (il pourrait être falsifié). On revérifie toujours le statut réel
  // directement auprès de l'API CinetPay.
  try {
    const checkRes = await fetch("https://api-checkout.cinetpay.com/v2/payment/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apikey: CINETPAY_APIKEY,
        site_id: CINETPAY_SITE_ID,
        transaction_id,
      }),
    });
    const check = await checkRes.json();

    const estPaye =
      check.code === "00" && check.data && check.data.status === "ACCEPTED";

    if (estPaye) {
      tx.statut = "payee";
      // -> Et SEULEMENT maintenant on active la carte.
      const carte = creerCarteApresPaiement(tx, transaction_id);
      cartesActivees.set(transaction_id, carte);
    } else {
      tx.statut = "refusee";
    }
  } catch (err) {
    tx.statut = "erreur_verification";
  }
});

function creerCarteApresPaiement(tx, transaction_id) {
  const now = new Date();
  const dureeMois = parseInt(tx.abonnementForm.duree, 10);
  const expiration = new Date(now);
  expiration.setMonth(expiration.getMonth() + dureeMois);

  return {
    id: transaction_id,
    nom: tx.nom,
    telephone: tx.telephone,
    type: tx.abonnementForm.type,
    duree: tx.abonnementForm.duree,
    montant: tx.montant,
    numero: `RGA-${Math.floor(1000 + Math.random() * 9000)}-${Math.floor(1000 + Math.random() * 9000)}`,
    dateCreation: now.toISOString(),
    expiration: expiration.toISOString(),
  };
}

// ---------------------------------------------------------------
// 3. L'app interroge le statut (polling depuis le frontend)
// ---------------------------------------------------------------
app.get("/api/payments/:id/status", (req, res) => {
  const tx = transactions.get(req.params.id);
  if (!tx) return res.status(404).json({ error: "Transaction inconnue" });

  if (tx.statut === "payee") {
    return res.json({ statut: "payee", carte: cartesActivees.get(req.params.id) });
  }
  return res.json({ statut: tx.statut });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Serveur de paiement Rangou sur le port ${PORT}`));
