const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DATA_PATH = path.join(DATA_DIR, 'store.json');

function defaultData() {
  return {
    adminSecretHash: null, // mot de passe superadmin, défini au premier lancement
    upgradeMessage: "Passez au plan Pro pour débloquer l'accès distant et plus d'options. Contactez-nous pour en savoir plus.",
    upgradeContact: '',
    paymentPhone: '+227 94958025',
    paymentName: 'MOUSSA ABOU BOUKARI',
    subscriptionPrices: { '30': 5000, '90': 13000, '180': 24000, '365': 45000 }, // en FCFA, modifiable par le superadmin
    paymentRequests: [], // { id, tenantId, businessName, email, durationDays, reference, createdAt, status }
    passwordResetRequests: [], // { id, tenantId, businessName, email, token, tokenExpiresAt, createdAt, status }
    tenants: [], // { id, slug, email, passwordHash, businessName, phone, plan, trialEndsAt, active, maxProfiles, maxRouters, features, createdAt }
    // Données propres à chaque client, indexées par tenant id :
    tenantData: {}, // { [tenantId]: { config, profiles, tickets } }
  };
}

function defaultTenantData() {
  return {
    config: { router: { host: '', user: 'admin', password: '', port: 8728 } },
    profiles: [],
    tickets: [],
  };
}

function load() {
  try {
    return JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  } catch (e) {
    const d = defaultData();
    save(d);
    return d;
  }
}

function save(data) {
  fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
}

module.exports = { load, save, defaultTenantData };
