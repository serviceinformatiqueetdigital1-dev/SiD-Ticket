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

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch (e) { return; }

      if (msg.type === 'auth') {
        const tenant = DATA.tenants.find(t => t.agentToken && t.agentToken === msg.token);
        if (!tenant) { ws.send(JSON.stringify({ type: 'authError', message: 'Jeton invalide.' })); ws.close(); return; }
        authedTenantId = tenant.id;
        connections.set(tenant.id, ws);
        ws.send(JSON.stringify({ type: 'authOk' }));
        return;
      }

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
}

function isConnected(tenantId) {
  return connections.has(tenantId);
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

module.exports = { attach, isConnected, sendCommand };
