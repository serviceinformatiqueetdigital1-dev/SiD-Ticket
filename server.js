const express = require('express');
const crypto = require('crypto');
const path = require('path');
const { spawn } = require('child_process');
const db = require('./src/db');
const auth = require('./src/auth');
const mailer = require('./src/mailer');
const mikrotik = require('./src/mikrotik');
const agentBridge = require('./src/agentBridge');

process.on('uncaughtException', (err) => {
  console.error('Erreur inattendue (le serveur continue de fonctionner) :', err.message);
});
process.on('unhandledRejection', (err) => {
  console.error('Erreur de promesse non gérée (le serveur continue de fonctionner) :', err && err.message ? err.message : err);
});

const app = express();
app.get('/health', (req, res) => res.send('OK')); // pour garder le service éveillé (voir README)
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  lastModified: false,
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate'),
}));

let DATA = db.load();
const TRIAL_DAYS = 14;

// Envoie une action au routeur : via l'agent local si connecté (fonctionne même derrière
// un CGNAT/Starlink), sinon en tentant une connexion directe (ne marche que si le routeur
// a une IP publique joignable).
async function routerAction(req, action, payload) {
  if (agentBridge.isConnected(req.tenant.id)) {
    return agentBridge.sendCommand(req.tenant.id, action, payload);
  }
  switch (action) {
    case 'testConnection': return mikrotik.testConnection(req.td.config.router);
    case 'getRouterStatus': return mikrotik.getRouterStatus(req.td.config.router);
    case 'upsertHotspotProfile': return mikrotik.upsertHotspotProfile(req.td.config.router, payload.profile);
    case 'createHotspotUsersBatch': return mikrotik.createHotspotUsersBatch(req.td.config.router, payload.tickets);
    case 'fetchUsersStatus': return mikrotik.fetchUsersStatus(req.td.config.router);
    case 'lockUserToMac': return mikrotik.lockUserToMac(req.td.config.router, payload.username, payload.mac);
    default: return { ok: false, error: 'Action inconnue.' };
  }
}

if (!DATA.adminSecretHash) {
  DATA.adminSecretHash = auth.hashPassword('admin1234'); // à changer immédiatement en production
  db.save(DATA);
}

function hash(str) { return crypto.createHash('sha256').update(str).digest('hex'); }

function findTenantByEmail(email) {
  return DATA.tenants.find(t => t.email.toLowerCase() === String(email || '').toLowerCase());
}
function findTenantBySlug(slug) {
  return DATA.tenants.find(t => t.slug === slug);
}
function slugify(str) {
  return String(str).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'boutique';
}
function makeUniqueSlug(businessName) {
  const base = slugify(businessName);
  let slug = base, n = 1;
  while (DATA.tenants.some(t => t.slug === slug)) { n++; slug = `${base}-${n}`; }
  return slug;
}
function tenantData(tenantId) {
  if (!DATA.tenantData[tenantId]) DATA.tenantData[tenantId] = db.defaultTenantData();
  return DATA.tenantData[tenantId];
}
function subscriptionActive(tenant) {
  if (!tenant.active) return false;
  return Date.now() < tenant.trialEndsAt;
}

// ---------- Middleware ----------
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const session = token ? auth.getSession(token) : null;
  if (!session || !session.tenantId) return res.status(401).json({ message: 'Session expirée, reconnectez-vous.' });
  const tenant = DATA.tenants.find(t => t.id === session.tenantId);
  if (!tenant) return res.status(401).json({ message: 'Compte introuvable.' });
  req.tenant = tenant;
  req.td = tenantData(tenant.id);
  next();
}
function requireActiveSubscription(req, res, next) {
  if (!subscriptionActive(req.tenant)) {
    return res.status(402).json({ message: "Votre période d'essai est terminée ou votre compte est suspendu. Contactez-nous pour continuer." });
  }
  next();
}
function requireAdmin(req, res, next) {
  const secret = req.headers['x-admin-secret'];
  if (!secret || !auth.verifyPassword(secret, DATA.adminSecretHash)) {
    return res.status(401).json({ message: 'Accès administrateur refusé.' });
  }
  next();
}

// ---------- AUTH ----------
app.post('/api/auth/signup', (req, res) => {
  const { email, businessName, phone, password } = req.body;
  if (!email || !businessName || !password) return res.status(400).json({ message: 'Email, nom de la boutique et mot de passe sont requis.' });
  if (password.length < 6) return res.status(400).json({ message: 'Le mot de passe doit contenir au moins 6 caractères.' });
  if (findTenantByEmail(email)) return res.status(409).json({ message: 'Un compte existe déjà avec cet email.' });

  const now = Date.now();
  const tenant = {
    id: crypto.randomUUID(),
    slug: makeUniqueSlug(businessName),
    email: email.trim(),
    passwordHash: auth.hashPassword(password),
    businessName: businessName.trim(),
    phone: phone ? phone.trim() : '',
    plan: 'basique',
    portalTheme: 'signal',
    trialEndsAt: now + TRIAL_DAYS * 86400000,
    active: true,
    maxProfiles: 0,
    maxRouters: 1,
    features: { remoteAccess: false, macLock: true },
    agentToken: crypto.randomBytes(20).toString('hex'),
    createdAt: now,
  };
  DATA.tenants.push(tenant);
  DATA.tenantData[tenant.id] = db.defaultTenantData();
  db.save(DATA);

  const token = auth.createSession({ tenantId: tenant.id });
  res.json({ ok: true, token, tenant: publicTenant(tenant) });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  const tenant = findTenantByEmail(email);
  if (!tenant || !auth.verifyPassword(password || '', tenant.passwordHash)) {
    return res.status(401).json({ message: 'Email ou mot de passe incorrect.' });
  }
  const token = auth.createSession({ tenantId: tenant.id });
  res.json({ ok: true, token, tenant: publicTenant(tenant) });
});

app.post('/api/auth/forgot-password', async (req, res) => {
  const { email } = req.body;
  const tenant = findTenantByEmail(email);
  // Réponse générique dans tous les cas, pour ne pas révéler si un email existe ou non.
  const genericMsg = "Si ce compte existe, une demande de réinitialisation a été enregistrée. Un email peut vous être envoyé si configuré, sinon contactez votre administrateur.";
  if (!tenant) return res.json({ ok: true, message: genericMsg });

  const token = crypto.randomBytes(24).toString('hex');
  tenant.resetToken = token;
  tenant.resetTokenExpiresAt = Date.now() + 3600000; // 1h
  DATA.passwordResetRequests.push({
    id: crypto.randomUUID(), tenantId: tenant.id, businessName: tenant.businessName,
    email: tenant.email, createdAt: Date.now(), status: 'pending',
  });
  db.save(DATA);

  const resetUrl = `${req.protocol}://${req.get('host')}/reset-password?token=${token}`;
  const mailResult = await mailer.sendResetEmail(tenant.email, resetUrl, tenant.businessName);
  res.json({ ok: true, message: genericMsg, emailSent: mailResult.sent });
});

app.post('/api/auth/reset-password', (req, res) => {
  const { token, newPassword } = req.body;
  if (!newPassword || newPassword.length < 6) return res.status(400).json({ message: 'Le mot de passe doit contenir au moins 6 caractères.' });
  const tenant = DATA.tenants.find(t => t.resetToken === token && t.resetTokenExpiresAt > Date.now());
  if (!tenant) return res.status(400).json({ message: 'Lien invalide ou expiré. Refaites une demande.' });
  tenant.passwordHash = auth.hashPassword(newPassword);
  tenant.resetToken = null;
  tenant.resetTokenExpiresAt = null;
  const pending = DATA.passwordResetRequests.find(r => r.tenantId === tenant.id && r.status === 'pending');
  if (pending) pending.status = 'resolved';
  db.save(DATA);
  res.json({ ok: true });
});

app.post('/api/auth/logout', requireAuth, (req, res) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (token) auth.destroySession(token);
  res.json({ ok: true });
});

function publicTenant(t) {
  return {
    id: t.id, slug: t.slug, email: t.email, businessName: t.businessName, phone: t.phone,
    plan: t.plan, portalTheme: t.portalTheme || 'signal', trialEndsAt: t.trialEndsAt, active: t.active,
    maxProfiles: t.maxProfiles, maxRouters: t.maxRouters, features: t.features,
    lastSubscriptionDuration: t.lastSubscriptionDuration || null, lastSubscriptionAt: t.lastSubscriptionAt || null,
  };
}

app.post('/api/config/portal-theme', requireAuth, (req, res) => {
  const { theme } = req.body;
  const valid = ['signal', 'classic', 'ocean', 'sunset', 'minimal'];
  if (!valid.includes(theme)) return res.status(400).json({ message: 'Modèle invalide.' });
  req.tenant.portalTheme = theme;
  db.save(DATA);
  res.json({ ok: true });
});

// ---------- STATE ----------
app.get('/api/state', requireAuth, (req, res) => {
  const td = req.td;
  res.json({
    tenant: publicTenant(req.tenant),
    subscriptionActive: subscriptionActive(req.tenant),
    upgradeMessage: DATA.upgradeMessage,
    upgradeContact: DATA.upgradeContact,
    paymentPhone: DATA.paymentPhone,
    paymentName: DATA.paymentName,
    subscriptionPrices: DATA.subscriptionPrices,
    myPaymentRequests: DATA.paymentRequests.filter(p => p.tenantId === req.tenant.id).sort((a, b) => b.createdAt - a.createdAt),
    agentToken: req.tenant.agentToken,
    agentConnected: agentBridge.isConnected(req.tenant.id),
    config: {
      businessName: req.tenant.businessName,
      lastSyncAt: td.config.lastSyncAt || null,
      router: { ...td.config.router, password: td.config.router.password ? '••••••••' : '' },
    },
    profiles: td.profiles,
    tickets: td.tickets,
  });
});

app.post('/api/config/agent-token/regenerate', requireAuth, (req, res) => {
  req.tenant.agentToken = crypto.randomBytes(20).toString('hex');
  db.save(DATA);
  res.json({ ok: true, agentToken: req.tenant.agentToken });
});

app.post('/api/payment-requests', requireAuth, (req, res) => {
  const { durationDays, reference } = req.body;
  const days = parseInt(durationDays, 10);
  if (!DATA.subscriptionPrices[String(days)]) return res.status(400).json({ message: 'Durée invalide.' });
  const request = {
    id: crypto.randomUUID(),
    tenantId: req.tenant.id,
    businessName: req.tenant.businessName,
    email: req.tenant.email,
    durationDays: days,
    amount: DATA.subscriptionPrices[String(days)],
    reference: reference || '',
    createdAt: Date.now(),
    status: 'pending',
  };
  DATA.paymentRequests.push(request);
  db.save(DATA);
  res.json({ ok: true, request });
});

app.post('/api/change-password', requireAuth, (req, res) => {
  const { current, next } = req.body;
  if (!auth.verifyPassword(current || '', req.tenant.passwordHash)) return res.status(401).json({ message: 'Mot de passe actuel incorrect.' });
  if (!next || next.length < 6) return res.status(400).json({ message: 'Le nouveau mot de passe doit contenir au moins 6 caractères.' });
  req.tenant.passwordHash = auth.hashPassword(next);
  db.save(DATA);
  res.json({ ok: true });
});

// ---------- CONFIG ----------
app.post('/api/config/business', requireAuth, (req, res) => {
  const { businessName } = req.body;
  if (businessName) req.tenant.businessName = businessName;
  db.save(DATA);
  res.json({ ok: true });
});

app.post('/api/config/router', requireAuth, async (req, res) => {
  const { host, user, password, port } = req.body;
  req.td.config.router = { ...req.td.config.router, host, user, password: password || req.td.config.router.password, port: port ? parseInt(port, 10) : 8728 };
  db.save(DATA);
  agentBridge.pushRouterConfig(req.tenant.id, req.td.config.router);
  res.json({ ok: true });
});

app.post('/api/config/router/reset', requireAuth, (req, res) => {
  req.td.config.router = { host: '', user: 'admin', password: '', port: 8728, loginUrl: req.td.config.router.loginUrl, defaultProfile: req.td.config.router.defaultProfile };
  db.save(DATA);
  agentBridge.pushRouterConfig(req.tenant.id, req.td.config.router);
  res.json({ ok: true });
});

app.post('/api/config/router/print-settings', requireAuth, async (req, res) => {
  const { loginUrl, defaultProfile } = req.body;
  req.td.config.router = { ...req.td.config.router, loginUrl: loginUrl || '', defaultProfile: defaultProfile || '' };
  db.save(DATA);
  res.json({ ok: true });
});

app.post('/api/config/router/test', requireAuth, async (req, res) => {
  const result = await routerAction(req, 'testConnection', {});
  req.td.config.router.connected = !!result.ok;
  db.save(DATA);
  res.json(result);
});

app.get('/api/config/router/status', requireAuth, async (req, res) => {
  if (!req.td.config.router.host && !agentBridge.isConnected(req.tenant.id)) return res.status(400).json({ ok: false, message: 'Aucun routeur configuré.' });
  const result = await routerAction(req, 'getRouterStatus', {});
  req.td.config.router.connected = !!result.ok;
  db.save(DATA);
  res.json(result);
});

// ---------- PROFILES ----------
app.post('/api/profiles', requireAuth, requireActiveSubscription, async (req, res) => {
  const maxProfiles = req.tenant.maxProfiles || 0;
  if (maxProfiles > 0 && req.td.profiles.length >= maxProfiles) {
    return res.status(403).json({ message: `Votre compte autorise au maximum ${maxProfiles} profil(s). Contactez-nous pour augmenter cette limite.` });
  }
  const {
    name, price, sharedUsers, speedLimit,
    validityMs, activeTimeMs, dataLimitBytes,
    credentialMode, usernameCharType, passwordCharType, credentialLength, prefix,
    lockByMac,
  } = req.body;
  if (!name) return res.status(400).json({ message: 'Le nom du profil est requis.' });

  const profile = {
    id: crypto.randomUUID(),
    name,
    price: Math.max(0, parseFloat(price) || 0),
    sharedUsers: Math.max(1, parseInt(sharedUsers, 10) || 1),
    speedLimit: speedLimit || '',
    validityMs: validityMs || 0,
    activeTimeMs: activeTimeMs || 0,
    dataLimitBytes: dataLimitBytes || 0,
    credentialMode: credentialMode || 'user_eq_pass',
    usernameCharType: usernameCharType || 'abc',
    passwordCharType: passwordCharType || '123',
    credentialLength: Math.max(3, parseInt(credentialLength, 10) || 6),
    prefix: prefix || '',
    lockByMac: !!lockByMac,
    routerSynced: false,
    createdAt: Date.now(),
  };

  if (req.td.config.router.host || agentBridge.isConnected(req.tenant.id)) {
    const result = await routerAction(req, 'upsertHotspotProfile', { profile });
    profile.routerSynced = result.ok;
    if (!result.ok) profile.routerError = result.error;
  }

  req.td.profiles.push(profile);
  db.save(DATA);
  res.json({ ok: true, profile });
});

app.delete('/api/profiles/:id', requireAuth, (req, res) => {
  req.td.profiles = req.td.profiles.filter(p => p.id !== req.params.id);
  db.save(DATA);
  res.json({ ok: true });
});

app.post('/api/profiles/:id/update', requireAuth, async (req, res) => {
  const profile = req.td.profiles.find(p => p.id === req.params.id);
  if (!profile) return res.status(404).json({ message: 'Profil introuvable.' });
  const {
    name, price, sharedUsers, speedLimit,
    validityMs, activeTimeMs, dataLimitBytes,
    credentialMode, usernameCharType, passwordCharType, credentialLength, prefix,
    lockByMac,
  } = req.body;
  if (!name) return res.status(400).json({ message: 'Le nom du profil est requis.' });

  Object.assign(profile, {
    name,
    price: Math.max(0, parseFloat(price) || 0),
    sharedUsers: Math.max(1, parseInt(sharedUsers, 10) || 1),
    speedLimit: speedLimit || '',
    validityMs: validityMs || 0,
    activeTimeMs: activeTimeMs || 0,
    dataLimitBytes: dataLimitBytes || 0,
    credentialMode: credentialMode || 'user_eq_pass',
    usernameCharType: usernameCharType || 'abc',
    passwordCharType: passwordCharType || '123',
    credentialLength: Math.max(3, parseInt(credentialLength, 10) || 6),
    prefix: prefix || '',
    lockByMac: !!lockByMac,
  });

  if (req.td.config.router.host || agentBridge.isConnected(req.tenant.id)) {
    const result = await routerAction(req, 'upsertHotspotProfile', { profile });
    profile.routerSynced = result.ok;
    if (!result.ok) profile.routerError = result.error;
  }

  db.save(DATA);
  res.json({ ok: true, profile });
});

// ---------- TICKETS ----------
function genCredential(charType, length) {
  let chars;
  if (charType === 'abc') chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  else if (charType === '123') chars = '23456789';
  else chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}
function genUniqueCredentials(existingUsernames, profile) {
  let username, password, tries = 0;
  do {
    username = (profile.prefix || '') + genCredential(profile.usernameCharType, profile.credentialLength);
    password = profile.credentialMode === 'user_pass' ? genCredential(profile.passwordCharType, profile.credentialLength) : username;
    tries++;
  } while (existingUsernames.has(username) && tries < 50);
  existingUsernames.add(username);
  return { username, password };
}

app.post('/api/tickets/generate', requireAuth, requireActiveSubscription, async (req, res) => {
  const { profileId, qty, priceOverride } = req.body;
  const profile = req.td.profiles.find(p => p.id === profileId);
  if (!profile) return res.status(400).json({ message: 'Profil introuvable. Créez-en un dans "Profils".' });

  const n = Math.max(1, Math.min(500, parseInt(qty, 10) || 1));
  const price = priceOverride !== undefined && priceOverride !== null && priceOverride !== '' ? Math.max(0, parseFloat(priceOverride) || 0) : profile.price;

  // 1. On génère d'abord tous les tickets en mémoire (rapide, pas d'accès réseau ici).
  const existingUsernames = new Set(req.td.tickets.map(t => t.username));
  const newTickets = [];
  for (let i = 0; i < n; i++) {
    const { username, password } = genUniqueCredentials(existingUsernames, profile);
    newTickets.push({
      username, password, code: username,
      profileId: profile.id, profileName: profile.name,
      price,
      activeTimeMs: profile.activeTimeMs, dataLimitBytes: profile.dataLimitBytes, validityMs: profile.validityMs,
      routerProfile: profile.name, lockByMac: profile.lockByMac, macLocked: false,
      status: 'disponible', routerSynced: false, createdAt: Date.now(), activatedAt: null,
    });
  }

  // 2. Puis on les envoie TOUS d'un coup au routeur, en une seule connexion
  //    (beaucoup plus rapide que se reconnecter pour chaque ticket individuellement).
  const routerErrors = [];
  if (req.td.config.router.host || agentBridge.isConnected(req.tenant.id)) {
    const batchResult = await routerAction(req, 'createHotspotUsersBatch', { tickets: newTickets });
    req.td.config.router.connected = !!batchResult.ok;
    const byUsername = {};
    (batchResult.results || []).forEach(r => { byUsername[r.username] = r; });
    for (const ticket of newTickets) {
      const r = byUsername[ticket.username];
      if (r && r.ok) ticket.routerSynced = true;
      else if (r) routerErrors.push(`${ticket.username}: ${r.error}`);
    }
  }

  req.td.tickets.push(...newTickets);
  db.save(DATA);
  res.json({ ok: true, created: newTickets.length, routerErrors: routerErrors.slice(0, 5) });
});

app.post('/api/tickets/sync', requireAuth, requireActiveSubscription, async (req, res) => {
  if (!req.td.config.router.host && !agentBridge.isConnected(req.tenant.id)) return res.status(400).json({ ok: false, message: 'Aucun routeur configuré.' });
  const result = await routerAction(req, 'fetchUsersStatus', {});
  req.td.config.router.connected = !!result.ok;
  if (!result.ok) { db.save(DATA); return res.status(502).json({ ok: false, message: result.error }); }

  let changed = 0;
  for (const t of req.td.tickets) {
    const info = result.users[t.username];
    if (!info) continue;
    const used = info.uptimeUsed && info.uptimeUsed !== '0s';
    if (t.status === 'disponible' && used) { t.status = 'verrouille'; t.activatedAt = Date.now(); changed++; }
    if (info.disabled && t.status !== 'expire') { t.status = 'expire'; changed++; }
    if (t.lockByMac && !t.macLocked) {
      const activeSession = result.activeByUser[t.username];
      if (activeSession && activeSession.macAddress) {
        const lockResult = await routerAction(req, 'lockUserToMac', { username: t.username, mac: activeSession.macAddress });
        if (lockResult.ok) { t.macLocked = true; changed++; }
      }
    }
  }
  if (changed) db.save(DATA);
  req.td.config.lastSyncAt = Date.now();
  db.save(DATA);
  res.json({ ok: true, changed });
});

app.delete('/api/tickets/:username', requireAuth, (req, res) => {
  const before = req.td.tickets.length;
  req.td.tickets = req.td.tickets.filter(t => t.username !== req.params.username);
  db.save(DATA);
  res.json({ ok: true, deleted: before - req.td.tickets.length });
});

app.post('/api/tickets/delete-unused', requireAuth, (req, res) => {
  const before = req.td.tickets.length;
  req.td.tickets = req.td.tickets.filter(t => t.status !== 'disponible');
  db.save(DATA);
  res.json({ ok: true, deleted: before - req.td.tickets.length });
});

// ---------- MODE ACCÈS DISTANT ----------
let remoteAccess = { active: false, url: null, error: null };
let remoteProcess = null;
function requireRemoteAccessFeature(req, res, next) {
  if (!req.tenant.features || !req.tenant.features.remoteAccess) {
    return res.status(403).json({ message: "Cette fonctionnalité n'est pas activée sur votre compte." });
  }
  next();
}
app.post('/api/remote-access/start', requireAuth, requireActiveSubscription, requireRemoteAccessFeature, (req, res) => {
  if (remoteAccess.active) return res.json({ ok: true, ...remoteAccess });
  let responded = false;
  try {
    remoteProcess = spawn('cloudflared', ['tunnel', '--url', 'http://localhost:3000']);
  } catch (e) {
    return res.status(500).json({ ok: false, message: "cloudflared n'est pas installé sur cet ordinateur." });
  }
  const onData = (data) => {
    const text = data.toString();
    const match = text.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
    if (match && !responded) { remoteAccess = { active: true, url: match[0], error: null }; responded = true; res.json({ ok: true, ...remoteAccess }); }
  };
  remoteProcess.stdout.on('data', onData);
  remoteProcess.stderr.on('data', onData);
  remoteProcess.on('error', () => { if (!responded) { responded = true; res.status(500).json({ ok: false, message: 'cloudflared introuvable.' }); } });
  remoteProcess.on('exit', () => { remoteAccess = { active: false, url: null, error: null }; remoteProcess = null; });
  setTimeout(() => { if (!responded) { responded = true; res.status(504).json({ ok: false, message: 'Délai dépassé.' }); } }, 15000);
});
app.post('/api/remote-access/stop', requireAuth, requireRemoteAccessFeature, (req, res) => {
  if (remoteProcess) { remoteProcess.kill(); remoteProcess = null; }
  remoteAccess = { active: false, url: null, error: null };
  res.json({ ok: true });
});

// ---------- PORTAIL CAPTIF (public, sans authentification) ----------
// Page où le client WiFi saisit son code de ticket. Ne nécessite aucune connexion.
app.get('/api/portal/:slug/info', (req, res) => {
  const tenant = findTenantBySlug(req.params.slug);
  if (!tenant) return res.status(404).json({ message: 'Boutique introuvable.' });
  res.json({ businessName: tenant.businessName, portalTheme: tenant.portalTheme || 'signal' });
});

app.post('/api/portal/:slug/activate', (req, res) => {
  const tenant = findTenantBySlug(req.params.slug);
  if (!tenant) return res.status(404).json({ message: 'Boutique introuvable.' });
  const td = tenantData(tenant.id);
  const { code } = req.body;
  const ticket = td.tickets.find(t => t.username === String(code || '').trim());

  if (!ticket) return res.status(404).json({ message: 'Code invalide. Vérifiez le ticket et réessayez.' });
  if (ticket.status === 'verrouille') return res.status(409).json({ message: `Ce ticket est déjà utilisé sur un autre appareil depuis le ${new Date(ticket.activatedAt).toLocaleString('fr-FR')}.` });
  if (ticket.status === 'expire') return res.status(409).json({ message: 'Ce ticket a expiré et ne peut plus être activé.' });

  ticket.status = 'verrouille';
  ticket.activatedAt = Date.now();
  db.save(DATA);
  res.json({
    ok: true,
    profileName: ticket.profileName,
    activeTimeMs: ticket.activeTimeMs,
    dataLimitBytes: ticket.dataLimitBytes,
    activatedAt: ticket.activatedAt,
  });
});

// ---------- ADMIN (superadmin, protégé par un mot de passe séparé) ----------
app.post('/api/admin/login', (req, res) => {
  const { secret } = req.body;
  if (!auth.verifyPassword(secret || '', DATA.adminSecretHash)) return res.status(401).json({ message: 'Mot de passe administrateur incorrect.' });
  res.json({ ok: true });
});
app.post('/api/admin/change-password', (req, res) => {
  const { current, next } = req.body;
  if (!auth.verifyPassword(current || '', DATA.adminSecretHash)) return res.status(401).json({ message: 'Mot de passe actuel incorrect.' });
  if (!next || next.length < 6) return res.status(400).json({ message: 'Le nouveau mot de passe doit contenir au moins 6 caractères.' });
  DATA.adminSecretHash = auth.hashPassword(next);
  db.save(DATA);
  res.json({ ok: true });
});
app.get('/api/admin/settings', requireAdmin, (req, res) => {
  res.json({
    upgradeMessage: DATA.upgradeMessage,
    upgradeContact: DATA.upgradeContact,
    paymentPhone: DATA.paymentPhone,
    paymentName: DATA.paymentName,
    subscriptionPrices: DATA.subscriptionPrices,
  });
});
app.post('/api/admin/settings', requireAdmin, (req, res) => {
  const { upgradeMessage, upgradeContact, paymentPhone, paymentName, subscriptionPrices } = req.body;
  if (upgradeMessage !== undefined) DATA.upgradeMessage = upgradeMessage;
  if (upgradeContact !== undefined) DATA.upgradeContact = upgradeContact;
  if (paymentPhone !== undefined) DATA.paymentPhone = paymentPhone;
  if (paymentName !== undefined) DATA.paymentName = paymentName;
  if (subscriptionPrices !== undefined) DATA.subscriptionPrices = subscriptionPrices;
  db.save(DATA);
  res.json({ ok: true });
});

app.get('/api/admin/payment-requests', requireAdmin, (req, res) => {
  res.json({ requests: DATA.paymentRequests.sort((a, b) => b.createdAt - a.createdAt) });
});
app.post('/api/admin/payment-requests/:id/validate', requireAdmin, (req, res) => {
  const request = DATA.paymentRequests.find(p => p.id === req.params.id);
  if (!request) return res.status(404).json({ message: 'Demande introuvable.' });
  const tenant = DATA.tenants.find(t => t.id === request.tenantId);
  if (!tenant) return res.status(404).json({ message: 'Compte client introuvable.' });
  tenant.trialEndsAt = Math.max(tenant.trialEndsAt, Date.now()) + request.durationDays * 86400000;
  tenant.active = true;
  tenant.lastSubscriptionDuration = request.durationDays;
  tenant.lastSubscriptionAt = Date.now();
  request.status = 'validated';
  request.validatedAt = Date.now();
  db.save(DATA);
  res.json({ ok: true, tenant: publicTenant(tenant) });
});
app.post('/api/admin/payment-requests/:id/reject', requireAdmin, (req, res) => {
  const request = DATA.paymentRequests.find(p => p.id === req.params.id);
  if (!request) return res.status(404).json({ message: 'Demande introuvable.' });
  request.status = 'rejected';
  db.save(DATA);
  res.json({ ok: true });
});
app.get('/api/admin/password-reset-requests', requireAdmin, (req, res) => {
  res.json({ requests: DATA.passwordResetRequests.sort((a, b) => b.createdAt - a.createdAt) });
});
app.post('/api/admin/password-reset-requests/:id/resolve', requireAdmin, (req, res) => {
  const request = DATA.passwordResetRequests.find(r => r.id === req.params.id);
  if (!request) return res.status(404).json({ message: 'Demande introuvable.' });
  const tenant = DATA.tenants.find(t => t.id === request.tenantId);
  if (!tenant) return res.status(404).json({ message: 'Compte introuvable.' });
  const tempPassword = crypto.randomBytes(5).toString('hex');
  tenant.passwordHash = auth.hashPassword(tempPassword);
  tenant.resetToken = null;
  tenant.resetTokenExpiresAt = null;
  request.status = 'resolved';
  db.save(DATA);
  res.json({ ok: true, tempPassword });
});

app.post('/api/admin/tenants/:id/reset-password', requireAdmin, (req, res) => {
  const tenant = DATA.tenants.find(t => t.id === req.params.id);
  if (!tenant) return res.status(404).json({ message: 'Compte introuvable.' });
  const tempPassword = crypto.randomBytes(5).toString('hex'); // ex: "a1b2c3d4e5"
  tenant.passwordHash = auth.hashPassword(tempPassword);
  db.save(DATA);
  res.json({ ok: true, tempPassword });
});
app.get('/api/admin/tenants', requireAdmin, (req, res) => {
  res.json({ tenants: DATA.tenants.map(t => ({ ...publicTenant(t), profilesCount: (DATA.tenantData[t.id] || {}).profiles ? DATA.tenantData[t.id].profiles.length : 0 })) });
});
app.get('/api/admin/tenants/:id', requireAdmin, (req, res) => {
  const tenant = DATA.tenants.find(t => t.id === req.params.id);
  if (!tenant) return res.status(404).json({ message: 'Compte introuvable.' });
  const td = tenantData(tenant.id);
  const sold = td.tickets.filter(t => t.status === 'verrouille' || t.status === 'expire');
  res.json({
    tenant: publicTenant(tenant),
    createdAt: tenant.createdAt,
    router: { host: td.config.router.host || '', configured: !!td.config.router.host },
    profilesCount: td.profiles.length,
    ticketsTotal: td.tickets.length,
    ticketsSold: sold.length,
    totalRevenue: sold.reduce((s, t) => s + t.price, 0),
  });
});
app.post('/api/admin/tenants/:id', requireAdmin, (req, res) => {
  const tenant = DATA.tenants.find(t => t.id === req.params.id);
  if (!tenant) return res.status(404).json({ message: 'Compte introuvable.' });
  const { plan, active, extendDays, setDays, maxRouters, maxProfiles, features } = req.body;
  if (plan) tenant.plan = plan === 'pro' ? 'pro' : 'basique';
  if (active !== undefined) tenant.active = !!active;
  if (extendDays) tenant.trialEndsAt = Math.max(tenant.trialEndsAt, Date.now()) + parseInt(extendDays, 10) * 86400000;
  if (setDays) { tenant.trialEndsAt = Date.now() + parseInt(setDays, 10) * 86400000; tenant.lastSubscriptionDuration = parseInt(setDays, 10); tenant.lastSubscriptionAt = Date.now(); }
  if (maxRouters !== undefined) tenant.maxRouters = parseInt(maxRouters, 10) || 1;
  if (maxProfiles !== undefined) tenant.maxProfiles = parseInt(maxProfiles, 10) || 0;
  if (features) tenant.features = { remoteAccess: !!features.remoteAccess, macLock: features.macLock !== false };
  db.save(DATA);
  res.json({ ok: true, tenant: publicTenant(tenant) });
});
app.delete('/api/admin/tenants/:id', requireAdmin, (req, res) => {
  DATA.tenants = DATA.tenants.filter(t => t.id !== req.params.id);
  delete DATA.tenantData[req.params.id];
  db.save(DATA);
  res.json({ ok: true });
});

// SPA fallback : toute URL non reconnue (ex: /portal/ma-boutique) sert l'application,
// qui décide elle-même quoi afficher selon le chemin (portail captif, page d'accueil, etc.)
app.get(/^(?!\/api\/).*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`SID Ticket démarré : http://localhost:${PORT}`);
});
agentBridge.attach(server, db, DATA);
