// Pont WebSocket entre SID Ticket (cloud) et l'agent local installé chez le client.
// Permet de piloter un routeur MikroTik même quand il est derrière un CGNAT (Starlink, etc.)
// qui bloque les connexions entrantes : l'agent local se connecte VERS ce serveur
// (connexion sortante, jamais bloquée), et ce serveur lui envoie ensuite des commandes
// à exécuter localement sur le routeur.
const { WebSocketServer } = require('ws');
const crypto = require('crypto');

let db, DATA;
const connections = new Map(); // tenantId -> WebSocket
const pending = new Map(); // requestId -> { resolve, reject, timer }

function attach(httpServer, dbModule, dataRef) {
  db = dbModule;
  DATA = dataRef;
  const wss = new WebSocketServer({ server: httpServer, path: '/agent-ws' });

  wss.on('connection', (ws) => {
    let authedTenantId = null;
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch (e) { return; }

      if (msg.type === 'auth') {
        const tenant = DATA.tenants.find(t => t.agentToken && t.agentToken === msg.token);
        if (!tenant) { ws.send(JSON.stringify({ type: 'authError', message: 'Jeton invalide.' })); ws.close(); return; }
        authedTenantId = tenant.id;
        connections.set(tenant.id, ws);
        // On envoie à l'agent les infos du routeur déjà saisies dans SID Ticket
        // (page Hotspots) — plus besoin de les dupliquer dans config.json.
        const td = DATA.tenantData[tenant.id];
        const router = td && td.config && td.config.router ? td.config.router : {};
        ws.send(JSON.stringify({
          type: 'authOk',
          router: { host: router.host || '', user: router.user || 'admin', password: router.password || '', port: router.port || 8728 },
        }));
        return;
      }

      if (msg.type === 'ping') { ws.isAlive = true; ws.send(JSON.stringify({ type: 'pong' })); return; }

      if (msg.type === 'response' && msg.requestId && pending.has(msg.requestId)) {
        const p = pending.get(msg.requestId);
        clearTimeout(p.timer);
        pending.delete(msg.requestId);
        p.resolve(msg.ok ? { ok: true, ...msg.data } : { ok: false, error: msg.error });
      }
    });

    ws.on('close', () => {
      if (authedTenantId && connections.get(authedTenantId) === ws) connections.delete(authedTenantId);
    });
  });

  // Filet de sécurité supplémentaire : ping natif WebSocket toutes les 25s pour garder
  // la connexion active à travers les proxys d'hébergement (Render, etc.), et pour
  // fermer proprement les connexions mortes qui n'auraient pas déclenché 'close'.
  setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) { ws.terminate(); return; }
      ws.isAlive = false;
      try { ws.ping(); } catch (e) {}
    });
  }, 25000);
}

function isConnected(tenantId) {
  return connections.has(tenantId);
}

// Pousse la config routeur mise à jour vers l'agent déjà connecté (ex: après avoir changé
// le mot de passe dans SID Ticket → Hotspots), sans avoir besoin de redémarrer l'agent.
function pushRouterConfig(tenantId, router) {
  const ws = connections.get(tenantId);
  if (!ws) return;
  ws.send(JSON.stringify({ type: 'routerConfig', router }));
}

function sendCommand(tenantId, action, payload, timeoutMs = 20000) {
  return new Promise((resolve) => {
    const ws = connections.get(tenantId);
    if (!ws) { resolve({ ok: false, error: "Agent non connecté. Vérifiez qu'il tourne bien chez vous." }); return; }

    const requestId = crypto.randomUUID();
    const timer = setTimeout(() => {
      pending.delete(requestId);
      resolve({ ok: false, error: "Délai dépassé en attendant la réponse de l'agent local." });
    }, timeoutMs);

    pending.set(requestId, { resolve, timer });
    ws.send(JSON.stringify({ type: 'command', requestId, action, payload }));
  });
}

module.exports = { attach, isConnected, sendCommand, pushRouterConfig };
