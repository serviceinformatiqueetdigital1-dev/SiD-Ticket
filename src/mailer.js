// Envoi d'email optionnel pour la réinitialisation de mot de passe.
// Si aucune variable d'environnement SMTP_* n'est configurée sur Render, cette fonction
// ne fait rien (retourne sent:false) — le mot de passe oublié fonctionne quand même via
// la file d'attente visible par le superadmin (voir README).
let nodemailer;
try { nodemailer = require('nodemailer'); } catch (e) { nodemailer = null; }

function getTransport() {
  if (!nodemailer || !process.env.SMTP_HOST) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

async function sendResetEmail(to, resetUrl, businessName) {
  const transport = getTransport();
  if (!transport) return { sent: false };
  try {
    await transport.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to,
      subject: 'Réinitialisation de votre mot de passe SID Ticket',
      text: `Bonjour ${businessName},\n\nCliquez sur ce lien pour choisir un nouveau mot de passe (valable 1 heure) :\n${resetUrl}\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez cet email.`,
    });
    return { sent: true };
  } catch (e) {
    return { sent: false, error: e.message };
  }
}

module.exports = { sendResetEmail, isConfigured: () => !!getTransport() };
