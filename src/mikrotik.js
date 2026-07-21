// Intégration avec le routeur MikroTik via l'API RouterOS (node-routeros).
// Le routeur doit être sur le MEME réseau local que cette application (ou joignable via son IP),
// avec l'API activée : IP > Services > api (port 8728, ou apissl port 8729).
const { RouterOSAPI } = require('node-routeros');

function client(routerConfig) {
  const conn = new RouterOSAPI({
    host: routerConfig.host,
    user: routerConfig.user,
    password: routerConfig.password,
    port: routerConfig.port || 8728,
    timeout: 8,
  });
  // Sans ce filet de sécurité, une erreur réseau (routeur injoignable, mauvais
  // identifiants, etc.) peut émettre un événement 'error' non intercepté par
  // le try/catch environnant et FAIRE PLANTER tout le serveur Node. On l'attrape
  // ici pour que l'erreur soit uniquement renvoyée en résultat {ok:false,...}.
  conn.on('error', () => {});
  return conn;
}

async function testConnection(routerConfig) {
  const conn = client(routerConfig);
  try {
    await conn.connect();
    const identity = await conn.write('/system/identity/print');
    await conn.close();
    return { ok: true, identity: identity[0] ? identity[0].name : 'MikroTik' };
  } catch (e) {
    try { await conn.close(); } catch (_) {}
    return { ok: false, error: e.message || String(e) };
  }
}

// Crée ou met à jour un PROFIL Hotspot sur le routeur (façon TikFlow/Mikhmon) :
// nom, nombre d'utilisateurs simultanés (shared-users), limite de vitesse.
// `shared-users=1` empêche 2 appareils d'utiliser le même identifiant EN MÊME TEMPS.
// Si lockByMac est activé, on ajoute aussi un script "on-login" natif MikroTik qui fige
// le compte sur l'adresse MAC du premier appareil DÈS la première connexion (pas besoin
// d'attendre une synchronisation manuelle) — cela empêche un second appareil de réutiliser
// le même code plus tard, même après la déconnexion du premier.
async function upsertHotspotProfile(routerConfig, profile) {
  const conn = client(routerConfig);
  try {
    await conn.connect();
    const found = await conn.write('/ip/hotspot/user/profile/print', ['?name=' + profile.name]);
    const params = [
      '=name=' + profile.name,
      '=shared-users=' + (profile.sharedUsers || 1),
    ];
    if (profile.speedLimit) params.push('=rate-limit=' + profile.speedLimit);
    if (profile.lockByMac) {
      // Verrouille l'adresse MAC du premier appareil connecté, immédiatement.
      params.push('=on-login=:delay 2; :local m [/ip hotspot active get value-name=mac-address [find user=$username]]; /ip hotspot user set mac-address=$m [find name=$username]');
    } else {
      params.push('=on-login=');
    }

    if (found[0]) {
      await conn.write('/ip/hotspot/user/profile/set', ['=.id=' + found[0]['.id'], ...params]);
    } else {
      await conn.write('/ip/hotspot/user/profile/add', params);
    }
    await conn.close();
    return { ok: true };
  } catch (e) {
    try { await conn.close(); } catch (_) {}
    return { ok: false, error: e.message || String(e) };
  }
}

// Crée un utilisateur Hotspot correspondant à un ticket, rattaché à son profil.
// Crée PLUSIEURS utilisateurs Hotspot en une seule connexion (beaucoup plus rapide
// que d'ouvrir/fermer une connexion pour chaque ticket un par un — essentiel pour
// les gros lots, ex: générer 500 tickets d'un coup).
async function createHotspotUsersBatch(routerConfig, tickets) {
  const conn = client(routerConfig);
  const results = [];
  try {
    await conn.connect();
    for (const ticket of tickets) {
      try {
        const params = [
          '=name=' + ticket.username,
          '=password=' + ticket.password,
        ];
        if (ticket.activeTimeMs) params.push('=limit-uptime=' + msToDuration(ticket.activeTimeMs));
        if (ticket.dataLimitBytes) params.push('=limit-bytes-total=' + ticket.dataLimitBytes);
        if (ticket.validityMs) params.push('=validity=' + msToDuration(ticket.validityMs));
        if (ticket.routerProfile) params.push('=profile=' + ticket.routerProfile);
        await conn.write('/ip/hotspot/user/add', params);
        results.push({ username: ticket.username, ok: true });
      } catch (e) {
        results.push({ username: ticket.username, ok: false, error: e.message || String(e) });
      }
    }
    await conn.close();
    return { ok: true, results };
  } catch (e) {
    try { await conn.close(); } catch (_) {}
    // Connexion impossible dès le départ : tous les tickets du lot échouent pareil.
    return { ok: false, error: e.message || String(e), results: tickets.map(t => ({ username: t.username, ok: false, error: e.message || String(e) })) };
  }
}

async function createHotspotUser(routerConfig, ticket) {
  const conn = client(routerConfig);
  try {
    await conn.connect();

    const params = [
      '=name=' + ticket.username,
      '=password=' + ticket.password,
    ];
    if (ticket.activeTimeMs) params.push('=limit-uptime=' + msToDuration(ticket.activeTimeMs));
    if (ticket.dataLimitBytes) params.push('=limit-bytes-total=' + ticket.dataLimitBytes);
    if (ticket.validityMs) params.push('=validity=' + msToDuration(ticket.validityMs));
    if (ticket.routerProfile) params.push('=profile=' + ticket.routerProfile);

    await conn.write('/ip/hotspot/user/add', params);
    await conn.close();
    return { ok: true };
  } catch (e) {
    try { await conn.close(); } catch (_) {}
    return { ok: false, error: e.message || String(e) };
  }
}

// Récupère l'état réel des comptes hotspot sur le routeur (utilisé / temps restant / désactivé,
// et l'adresse MAC des sessions actives), pour resynchroniser le statut des tickets et
// appliquer le verrouillage MAC quand il est activé sur le profil.
async function fetchUsersStatus(routerConfig) {
  const conn = client(routerConfig);
  try {
    await conn.connect();
    const users = await conn.write('/ip/hotspot/user/print');
    const active = await conn.write('/ip/hotspot/active/print');
    await conn.close();
    const map = {};
    users.forEach(u => {
      map[u.name] = {
        id: u['.id'],
        uptimeUsed: u['uptime'] || '0s',
        disabled: u['disabled'] === 'true',
        bytesIn: parseInt(u['bytes-in'] || '0', 10),
        bytesOut: parseInt(u['bytes-out'] || '0', 10),
        macAddress: u['mac-address'] || null,
      };
    });
    const activeByUser = {};
    active.forEach(a => { activeByUser[a.user] = { macAddress: a['mac-address'] || null }; });
    return { ok: true, users: map, activeByUser };
  } catch (e) {
    try { await conn.close(); } catch (_) {}
    return { ok: false, error: e.message || String(e) };
  }
}

// Verrouille un compte Hotspot à l'adresse MAC détectée lors de sa première connexion :
// une fois posée, MikroTik refuse toute connexion à ce compte depuis un autre appareil,
// même après déconnexion — un verrouillage plus fort que shared-users seul.
async function lockUserToMac(routerConfig, username, mac) {
  const conn = client(routerConfig);
  try {
    await conn.connect();
    const found = await conn.write('/ip/hotspot/user/print', ['?name=' + username]);
    if (found[0]) {
      await conn.write('/ip/hotspot/user/set', ['=.id=' + found[0]['.id'], '=mac-address=' + mac]);
    }
    await conn.close();
    return { ok: true };
  } catch (e) {
    try { await conn.close(); } catch (_) {}
    return { ok: false, error: e.message || String(e) };
  }
}

async function removeHotspotUser(routerConfig, username) {
  const conn = client(routerConfig);
  try {
    await conn.connect();
    const found = await conn.write('/ip/hotspot/user/print', ['?name=' + username]);
    if (found[0]) {
      await conn.write('/ip/hotspot/user/remove', ['=.id=' + found[0]['.id']]);
    }
    await conn.close();
    return { ok: true };
  } catch (e) {
    try { await conn.close(); } catch (_) {}
    return { ok: false, error: e.message || String(e) };
  }
}

function msToDuration(ms) {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${h}h${m}m${s}s`;
}

// Récupère les informations détaillées du routeur (version, CPU, RAM, utilisateurs connectés, etc.)
// pour la barre d'informations et la page Hotspots.
async function getRouterStatus(routerConfig) {
  const conn = client(routerConfig);
  try {
    await conn.connect();
    const identity = await conn.write('/system/identity/print');
    const resource = await conn.write('/system/resource/print');
    const active = await conn.write('/ip/hotspot/active/print');
    let temperature = null;
    try {
      const health = await conn.write('/system/health/print');
      if (health[0] && health[0].temperature) temperature = health[0].temperature;
    } catch (e) { /* pas tous les modèles ont un capteur de température */ }
    await conn.close();
    const r = resource[0] || {};
    return {
      ok: true,
      identity: identity[0] ? identity[0].name : 'MikroTik',
      version: r['version'] || null,
      cpuLoad: r['cpu-load'] || null,
      freeMemory: parseInt(r['free-memory'] || '0', 10),
      totalMemory: parseInt(r['total-memory'] || '0', 10),
      uptime: r['uptime'] || null,
      temperature,
      activeUsers: active.length,
    };
  } catch (e) {
    try { await conn.close(); } catch (_) {}
    return { ok: false, error: e.message || String(e) };
  }
}

module.exports = { testConnection, getRouterStatus, upsertHotspotProfile, createHotspotUser, createHotspotUsersBatch, fetchUsersStatus, lockUserToMac, removeHotspotUser };
