function signalMark(color){
  color = color || 'var(--signal)';
  return `<div class="signal-mark"><svg viewBox="0 0 44 44" fill="none">
    <circle cx="22" cy="34" r="2.6" fill="${color}"/>
    <path class="arc arc-1" d="M15 27a10 10 0 0 1 14 0" stroke="${color}" stroke-width="2.4" stroke-linecap="round"/>
    <path class="arc arc-2" d="M10 21a17 17 0 0 1 24 0" stroke="${color}" stroke-width="2.4" stroke-linecap="round" opacity="0.6"/>
    <path class="arc arc-3" d="M5 15a24 24 0 0 1 34 0" stroke="${color}" stroke-width="2.4" stroke-linecap="round" opacity="0.3"/>
  </svg></div>`;
}
const ICONS = {
  dashboard:'🏠',
  ticket:'🎟',
  profile:'👤',
  router:'📡',
  history:'💰',
  settings:'⚙️',
  logout:'🚪',
  users:'👥',
  print:'🖨',
};

window.addEventListener('error', (e)=>{ alert('Erreur technique :\n\n'+(e.message||e)); });
window.addEventListener('unhandledrejection', (e)=>{ const m=e.reason&&e.reason.message?e.reason.message:String(e.reason); alert('Erreur technique (requête) :\n\n'+m); });

const DURATION_UNITS = { minutes:60000, heures:3600000, jours:86400000, semaines:604800000, mois:2592000000 };
const DURATION_UNIT_LABELS = { minutes:'Minute(s)', heures:'Heure(s)', jours:'Jour(s)', semaines:'Semaine(s)', mois:'Mois' };
const VOLUME_UNITS = { mo:1024*1024, go:1024*1024*1024 };
const VOLUME_UNIT_LABELS = { mo:'Mo', go:'Go' };

let TOKEN = localStorage.getItem('sidticket_token') || null;
let ADMIN_SECRET = sessionStorage.getItem('sidticket_admin_secret') || null;
let STATE = null;
let VIEW = 'landing'; // landing | login | signup | dashboard-views | admin-login | admin | portal
let authError = '';
let forgotEmail = '';
let forgotSent = false;
let resetToken = null;
let resetError = '';
let resetSuccess = false;
let adminState = null;
let adminError = '';
let ADMIN_VIEW = 'admin-dashboard'; // admin-dashboard | admin-clients | admin-settings
let adminDetail = null; // détail du client sélectionné (modale)
let adminSettingsState = null;
let adminPaymentsState = null;
let adminPasswordResetsState = null;
let resetPasswordResult = null; // { businessName, tempPassword }
let licenseModalTenant = null; // { id, businessName, plan }
let portalSlug = null;
let portalInfo = null;
let portalCode = '';
let portalResult = null;

let showNewProfileForm = false;
let editingProfileId = null; // null = création, sinon id du profil en cours de modification
let np = { name:'', price:0, sharedUsers:1, speedLimit:'', activeTimeText:'1d', dataLimitValue:0, dataLimitUnit:'go', validityText:'', credentialMode:'user_eq_pass', usernameCharType:'abc', passwordCharType:'123', credentialLength:6, prefix:'', lockByMac:true };
let selectedProfileId = null;
let newTicketQty = 10;
let priceOverride = '';
let ticketFilter = 'tous';
let ticketSearch = '';
let ticketSort = 'date-desc';
let historyPeriod = 'jour';
let routerStatus = null;
let routerStatusLoading = false;

function fmtMoney(n){ return (n||0).toLocaleString('fr-FR') + ' FCFA'; }
function fmtDate(ts){ if(!ts) return '—'; const d = new Date(ts); return d.toLocaleDateString('fr-FR') + ' ' + d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}); }
function fmtDuration(ms){
  if(!ms) return 'Illimité';
  const min = ms/60000;
  if(min < 60) return `${Math.round(min)} minute(s)`;
  const h = ms/3600000;
  if(h < 24) return `${Math.round(h*10)/10} heure(s)`;
  const j = h/24;
  if(j < 7) return `${Math.round(j*10)/10} jour(s)`;
  const s = j/7;
  if(s < 4.3) return `${Math.round(s*10)/10} semaine(s)`;
  return `${Math.round((j/30)*10)/10} mois`;
}
function fmtBytes(bytes){
  if(!bytes) return 'Illimité';
  const go = bytes/(1024*1024*1024);
  if(go >= 1) return `${Math.round(go*100)/100} Go`;
  return `${Math.round(bytes/(1024*1024))} Mo`;
}
function fmtDurationCompact(ms){
  if(!ms) return '';
  const min = ms/60000;
  if(min < 60) return `${Math.round(min)}min`;
  const h = ms/3600000;
  if(h < 24) return `${Math.round(h)}h`;
  return `${Math.round(h/24)}j`;
}
function fmtBytesCompact(bytes){
  if(!bytes) return '';
  const go = bytes/(1024*1024*1024);
  if(go >= 1) return `${Math.round(go*100)/100} GB`;
  return `${Math.round(bytes/(1024*1024))} MB`;
}
function startOfDay(d){ const x = new Date(d); x.setHours(0,0,0,0); return x.getTime(); }
function startOfWeek(d){ const x = new Date(d); const day=(x.getDay()+6)%7; x.setDate(x.getDate()-day); x.setHours(0,0,0,0); return x.getTime(); }
function startOfMonth(d){ const x = new Date(d); x.setDate(1); x.setHours(0,0,0,0); return x.getTime(); }
function startOfYear(d){ const x = new Date(d); x.setMonth(0,1); x.setHours(0,0,0,0); return x.getTime(); }
function soldTickets(){ return STATE.tickets.filter(t=>t.status==='verrouille'||t.status==='expire'); }
function sumFor(fromTs){ const l = soldTickets().filter(t=>t.activatedAt>=fromTs); return { total:l.reduce((s,t)=>s+t.price,0), count:l.length }; }
function daysLeft(ts){ return Math.max(0, Math.ceil((ts-Date.now())/86400000)); }
function parseDurationInput(str){
  if(!str || !str.trim()) return 0;
  const m = str.trim().match(/^(\d+(?:\.\d+)?)\s*(m|h|d|w)$/i);
  if(!m) return null;
  const n = parseFloat(m[1]);
  const unit = m[2].toLowerCase();
  const mult = { m:60000, h:3600000, d:86400000, w:604800000 };
  return Math.round(n * mult[unit]);
}
function msToDurationInput(ms){
  if(!ms) return '';
  if(ms % 604800000 === 0) return (ms/604800000)+'w';
  if(ms % 86400000 === 0) return (ms/86400000)+'d';
  if(ms % 3600000 === 0) return (ms/3600000)+'h';
  return Math.round(ms/60000)+'m';
}

async function api(path, method, body){
  try{
    const headers = body ? {'Content-Type':'application/json'} : {};
    if(TOKEN) headers['Authorization'] = 'Bearer ' + TOKEN;
    const res = await fetch(path, { method: method||'GET', headers, body: body?JSON.stringify(body):undefined });
    const data = await res.json().catch(()=>({}));
    return { ok: res.ok, status: res.status, data };
  }catch(err){
    alert('Impossible de contacter le serveur.\n\nDétail : ' + err.message);
    return { ok:false, status:0, data:{ message:'Erreur réseau : '+err.message } };
  }
}
async function adminApi(path, method, body){
  try{
    const headers = body ? {'Content-Type':'application/json'} : {};
    if(ADMIN_SECRET) headers['x-admin-secret'] = ADMIN_SECRET;
    const res = await fetch(path, { method: method||'GET', headers, body: body?JSON.stringify(body):undefined });
    const data = await res.json().catch(()=>({}));
    return { ok: res.ok, status: res.status, data };
  }catch(err){
    alert('Impossible de contacter le serveur.\n\nDétail : ' + err.message);
    return { ok:false, status:0, data:{ message:'Erreur réseau : '+err.message } };
  }
}
function toast(msg, type){
  const el = document.createElement('div');
  el.className = 'toast ' + (type||'');
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(()=>el.remove(), 2800);
}
async function refreshState(){ const r = await api('/api/state'); if(r.ok){ STATE=r.data; return true; } return false; }

async function boot(){
  const portalMatch = location.pathname.match(/^\/portal\/([a-z0-9-]+)/);
  if(portalMatch){
    portalSlug = portalMatch[1];
    const urlCode = new URLSearchParams(location.search).get('code');
    if(urlCode) portalCode = urlCode.toUpperCase();
    VIEW='portal'; render(); return;
  }
  if(location.pathname === '/reset-password'){
    resetToken = new URLSearchParams(location.search).get('token');
    VIEW='reset-password'; render(); return;
  }
  if(location.hash === '#admin'){ VIEW = ADMIN_SECRET ? 'admin' : 'admin-login'; render(); return; }
  if(TOKEN){
    const ok = await refreshState();
    if(ok){ VIEW='dashboard'; render(); return; }
    localStorage.removeItem('sidticket_token'); TOKEN=null;
  }
  VIEW='landing'; render();
}

function render(){
  const root = document.getElementById('root');
  if(VIEW==='portal'){ root.innerHTML = renderPortal(); attachPortalEvents(); if(!portalInfo) loadPortalInfo(); return; }
  if(VIEW==='landing'){ root.innerHTML = renderLanding(); attachLandingEvents(); return; }
  if(VIEW==='login'){ root.innerHTML = renderLogin(); attachLoginEvents(); return; }
  if(VIEW==='forgot-password'){ root.innerHTML = renderForgotPassword(); attachForgotPasswordEvents(); return; }
  if(VIEW==='reset-password'){ root.innerHTML = renderResetPassword(); attachResetPasswordEvents(); return; }
  if(VIEW==='signup'){ root.innerHTML = renderSignup(); attachSignupEvents(); return; }
  if(VIEW==='admin-login'){ root.innerHTML = renderAdminLogin(); attachAdminLoginEvents(); return; }
  if(VIEW==='admin'){
    root.innerHTML = renderAdmin(); attachAdminEvents();
    if(!adminState) loadAdminTenants();
    if(ADMIN_VIEW==='admin-settings' && !adminSettingsState) loadAdminSettings();
    if(ADMIN_VIEW==='admin-payments' && !adminPaymentsState) loadAdminPayments();
    if(ADMIN_VIEW==='admin-password-resets' && !adminPasswordResetsState) loadAdminPasswordResets();
    return;
  }
  root.innerHTML = renderShell();
  attachShellEvents();
}

/* ===================== PORTAIL CAPTIF (public) ===================== */
async function loadPortalInfo(){
  const res = await fetch(`/api/portal/${portalSlug}/info`);
  const data = await res.json().catch(()=>({}));
  portalInfo = res.ok ? data : { businessName: null, error: data.message };
  render();
}
function renderPortal(){
  if(!portalInfo) return `<div class="center-screen"><div class="card">${signalMark()}<p class="sub">Chargement…</p></div></div>`;
  if(!portalInfo.businessName) return `<div class="center-screen"><div class="card">${signalMark()}<h1>Boutique introuvable</h1><p class="sub">Ce lien WiFi n'est plus valide.</p></div></div>`;
  const theme = portalInfo.portalTheme || 'signal';
  return `<div class="center-screen portal-theme-${theme}"><div style="width:100%; max-width:420px;">
  <div class="card" style="max-width:none;">
    ${signalMark()}
    <h1>${portalInfo.businessName}</h1>
    <p class="sub">Entrez le code de votre ticket WiFi pour vous connecter</p>
    ${portalResult && !portalResult.ok ? `<div class="error-msg">${portalResult.message}</div>` : ''}
    ${portalResult && portalResult.ok ? `
      <div class="success-msg">✓ Connexion activée !</div>
      <div class="ticket-result">
        <div class="row"><span>Forfait</span><span>${portalResult.profileName}</span></div>
        ${portalResult.activeTimeMs ? `<div class="row"><span>Durée</span><span>${fmtDuration(portalResult.activeTimeMs)}</span></div>` : ''}
        ${portalResult.dataLimitBytes ? `<div class="row"><span>Données</span><span>${fmtBytes(portalResult.dataLimitBytes)}</span></div>` : ''}
      </div>
    ` : `
    <form id="portal-form">
      <div class="field"><input id="portal-code" class="code-input mono" placeholder="Code du ticket" value="${portalCode}" autofocus autocapitalize="characters" /></div>
      <button type="submit" class="btn btn-primary">Se connecter</button>
    </form>`}
  </div>
  <p style="text-align:center; font-size:11.5px; color:var(--text-dim-onlight); margin-top:16px;">Propulsé par <strong>SERVICE INFORMATIQUE ET DIGITAL</strong></p>
  </div></div>`;
}
function attachPortalEvents(){
  const form = document.getElementById('portal-form');
  if(!form) return;
  form.addEventListener('submit', async e=>{
    e.preventDefault();
    const code = document.getElementById('portal-code').value.trim().toUpperCase();
    const res = await fetch(`/api/portal/${portalSlug}/activate`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ code }) });
    const data = await res.json().catch(()=>({}));
    portalResult = res.ok ? { ok:true, ...data } : { ok:false, message: data.message || 'Erreur.' };
    render();
  });
  if(portalCode){
    const autoCode = portalCode;
    portalCode = ''; // évite de re-soumettre automatiquement à chaque nouveau rendu
    form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event('submit'));
  }
}

function renderLanding(){
  return `
  <div class="landing">
    <div class="landing-nav">
      ${signalMark()}<div class="landing-brand">SID Ticket</div>
    </div>
    <div class="landing-hero">
      ${signalMark()}
      <h1>Bienvenue sur SID Ticket</h1>
      <p class="landing-tagline">La solution intelligente de gestion des hotspots Wi-Fi</p>
      <p class="landing-sub">Créez, vendez et gérez vos tickets Wi-Fi en toute simplicité. Suivez vos ventes en temps réel, administrez vos zones Wi-Fi et consultez vos statistiques depuis une seule plateforme.</p>
      <div class="landing-cta">
        <button class="btn btn-primary" id="hero-signup" style="width:auto;">Créer un compte gratuitement</button>
        <button class="btn btn-ghost" id="hero-login" style="width:auto;">Se connecter</button>
      </div>
      <p class="hint">14 jours d'essai gratuit, sans carte bancaire.</p>
    </div>
    <div class="landing-features">
      <div class="feature-card"><div class="feature-icon">${ICONS.profile}</div><h3>Profils sur-mesure</h3><p>Durée, volume de données, vitesse, verrouillage — configurez vos forfaits comme vous le souhaitez.</p></div>
      <div class="feature-card"><div class="feature-icon">${ICONS.ticket}</div><h3>Tickets en un clic</h3><p>Générez et imprimez des lots de tickets, connectés automatiquement à votre routeur MikroTik.</p></div>
      <div class="feature-card"><div class="feature-icon">${ICONS.dashboard}</div><h3>Ventes en temps réel</h3><p>Suivez votre chiffre d'affaires journalier, hebdomadaire, mensuel et annuel.</p></div>
    </div>
  </div>`;
}
function attachLandingEvents(){
  document.getElementById('hero-login').addEventListener('click', ()=>{ VIEW='login'; render(); });
  document.getElementById('hero-signup').addEventListener('click', ()=>{ VIEW='signup'; render(); });
}

function renderLogin(){
  return `<div class="center-screen"><div class="card">
    ${signalMark()}
    <h1>Connexion</h1>
    <p class="sub">Accédez à votre espace SID Ticket</p>
    ${authError ? `<div class="error-msg">${authError}</div>` : ''}
    <form id="login-form">
      <div class="field"><label>Email</label><input type="email" id="login-email" required autofocus /></div>
      <div class="field"><label>Mot de passe</label><input type="password" id="login-pass" required /></div>
      <button type="submit" class="btn btn-primary">Se connecter</button>
    </form>
    <p class="hint">Pas encore de compte ? <a href="#" id="go-signup" style="color:var(--signal);">Créer un compte</a></p>
    <p class="hint"><a href="#" id="go-forgot" style="color:var(--text-faint);">Mot de passe oublié ?</a></p>
    <p class="hint"><a href="#" id="go-landing" style="color:var(--text-faint);">← Retour à l'accueil</a></p>
  </div></div>`;
}
function attachLoginEvents(){
  document.getElementById('login-form').addEventListener('submit', async (e)=>{
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-pass').value;
    const r = await api('/api/auth/login', 'POST', { email, password });
    if(r.ok){
      TOKEN = r.data.token; localStorage.setItem('sidticket_token', TOKEN);
      authError=''; await refreshState(); VIEW='dashboard'; render();
    } else { authError = r.data.message || 'Erreur de connexion.'; render(); }
  });
  document.getElementById('go-signup').addEventListener('click', (e)=>{ e.preventDefault(); authError=''; VIEW='signup'; render(); });
  document.getElementById('go-forgot').addEventListener('click', (e)=>{ e.preventDefault(); authError=''; VIEW='forgot-password'; render(); });
  document.getElementById('go-landing').addEventListener('click', (e)=>{ e.preventDefault(); authError=''; VIEW='landing'; render(); });
}

function renderForgotPassword(){
  return `<div class="center-screen"><div class="card">
    ${signalMark()}
    <h1>Mot de passe oublié</h1>
    <p class="sub">Entrez votre email, nous vous enverrons un lien de réinitialisation (ou votre administrateur pourra vous en générer un nouveau).</p>
    ${forgotSent ? `
      <div class="success-msg">Si ce compte existe, une demande a été enregistrée. Vérifiez votre email, ou contactez votre administrateur.</div>
      <button class="btn btn-ghost" id="back-to-login" style="width:auto;">← Retour à la connexion</button>
    ` : `
    <form id="forgot-form">
      <div class="field"><label>Email</label><input type="email" id="forgot-email" value="${forgotEmail}" required autofocus /></div>
      <button type="submit" class="btn btn-primary">Envoyer la demande</button>
    </form>
    <p class="hint"><a href="#" id="go-login" style="color:var(--text-faint);">← Retour à la connexion</a></p>
    `}
  </div></div>`;
}
function attachForgotPasswordEvents(){
  const backBtn = document.getElementById('back-to-login');
  if(backBtn) backBtn.addEventListener('click', ()=>{ forgotSent=false; VIEW='login'; render(); });
  const goLogin = document.getElementById('go-login');
  if(goLogin) goLogin.addEventListener('click', (e)=>{ e.preventDefault(); VIEW='login'; render(); });
  const form = document.getElementById('forgot-form');
  if(form) form.addEventListener('submit', async (e)=>{
    e.preventDefault();
    forgotEmail = document.getElementById('forgot-email').value;
    await api('/api/auth/forgot-password', 'POST', { email: forgotEmail });
    forgotSent = true; render();
  });
}

function renderResetPassword(){
  return `<div class="center-screen"><div class="card">
    ${signalMark()}
    <h1>Nouveau mot de passe</h1>
    ${resetError ? `<div class="error-msg">${resetError}</div>` : ''}
    ${resetSuccess ? `
      <div class="success-msg">✓ Mot de passe mis à jour. Vous pouvez vous connecter.</div>
      <button class="btn btn-primary" id="go-login-after-reset" style="width:100%;">Se connecter</button>
    ` : `
    <p class="sub">Choisissez votre nouveau mot de passe.</p>
    <form id="reset-form">
      <div class="field"><label>Nouveau mot de passe</label><input type="password" id="reset-pass" minlength="6" required autofocus /></div>
      <button type="submit" class="btn btn-primary">Mettre à jour</button>
    </form>
    `}
  </div></div>`;
}
function attachResetPasswordEvents(){
  const goLogin = document.getElementById('go-login-after-reset');
  if(goLogin) goLogin.addEventListener('click', ()=>{ VIEW='login'; history.replaceState(null,'','/'); render(); });
  const form = document.getElementById('reset-form');
  if(form) form.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const newPassword = document.getElementById('reset-pass').value;
    const r = await api('/api/auth/reset-password', 'POST', { token: resetToken, newPassword });
    if(r.ok){ resetSuccess=true; resetError=''; render(); }
    else { resetError = r.data.message || 'Erreur.'; render(); }
  });
}
function renderSignup(){
  return `<div class="center-screen"><div class="card">
    ${signalMark()}
    <h1>Créer un compte</h1>
    <p class="sub">14 jours d'essai gratuit, activé immédiatement</p>
    ${authError ? `<div class="error-msg">${authError}</div>` : ''}
    <form id="signup-form">
      <div class="field"><label>Nom de l'entreprise / boutique</label><input id="su-business" required autofocus /></div>
      <div class="field"><label>Email</label><input type="email" id="su-email" required /></div>
      <div class="field"><label>Téléphone (optionnel)</label><input id="su-phone" /></div>
      <div class="field"><label>Mot de passe</label><input type="password" id="su-pass" required minlength="6" /></div>
      <button type="submit" class="btn btn-primary">Créer mon compte</button>
    </form>
    <p class="hint">Déjà un compte ? <a href="#" id="go-login" style="color:var(--signal);">Se connecter</a></p>
    <p class="hint"><a href="#" id="go-landing" style="color:var(--text-faint);">← Retour à l'accueil</a></p>
  </div></div>`;
}
function attachSignupEvents(){
  document.getElementById('signup-form').addEventListener('submit', async (e)=>{
    e.preventDefault();
    const body = {
      businessName: document.getElementById('su-business').value,
      email: document.getElementById('su-email').value,
      phone: document.getElementById('su-phone').value,
      password: document.getElementById('su-pass').value,
    };
    const r = await api('/api/auth/signup', 'POST', body);
    if(r.ok){
      TOKEN = r.data.token; localStorage.setItem('sidticket_token', TOKEN);
      authError=''; await refreshState(); VIEW='dashboard'; render();
    } else { authError = r.data.message || 'Erreur lors de la création du compte.'; render(); }
  });
  document.getElementById('go-login').addEventListener('click', (e)=>{ e.preventDefault(); authError=''; VIEW='login'; render(); });
  document.getElementById('go-landing').addEventListener('click', (e)=>{ e.preventDefault(); authError=''; VIEW='landing'; render(); });
}

let CUR_VIEW = 'dashboard';
function renderInfoBar(){
  const t = STATE.tenant;
  const firstName = t.email.split('@')[0].replace(/[._-]/g,' ').replace(/\b\w/g, c=>c.toUpperCase());
  const connected = STATE.config.router.host && STATE.config.router.connected;
  const lastSync = STATE.config.lastSyncAt ? fmtDate(STATE.config.lastSyncAt) : 'Jamais';
  return `<div class="info-bar">
    <span class="info-item"><strong>Bienvenue ${firstName} 👋</strong></span>
    <span class="info-sep">·</span>
    <span class="info-item">Routeur : ${STATE.config.router.host ? (connected ? 'Connecté ✅' : 'Non connecté ⚠️') : 'Non configuré'}</span>
    <span class="info-sep">·</span>
    <span class="info-item">Zone : ${STATE.config.businessName}</span>
    <span class="info-sep">·</span>
    <span class="info-item">Version : 1.0.0</span>
    <span class="info-sep">·</span>
    <span class="info-item">Dernière synchronisation : ${lastSync}</span>
  </div>`;
}
function renderShell(){
  const nav = [
    {id:'dashboard', label:'Tableau de bord', icon:ICONS.dashboard},
    {id:'profiles', label:'Profils', icon:ICONS.profile},
    {id:'tickets', label:'Tickets', icon:ICONS.ticket},
    {id:'router', label:'Hotspots', icon:ICONS.router},
    {id:'history', label:'Historique des ventes', icon:ICONS.history},
    {id:'settings', label:'Paramètres', icon:ICONS.settings},
  ];
  const t = STATE.tenant;
  const dLeft = daysLeft(t.trialEndsAt);
  const subOk = STATE.subscriptionActive;
  return `<div id="app-shell">
    <div class="sidebar">
      <div class="brand">${signalMark()}<div><div class="brand-name">${STATE.config.businessName}</div><div class="brand-sub">Gestion des tickets</div></div></div>
      <div>${nav.map(n=>`<button class="nav-item ${CUR_VIEW===n.id?'active':''}" data-nav="${n.id}">${n.icon}${n.label}</button>`).join('')}</div>
      <div class="sidebar-footer">
        <div class="license-chip ${t.plan==='pro'?'ok':''}" style="text-transform:capitalize;"><span class="dot"></span>Plan ${t.plan}</div>
        <div class="license-chip ${subOk && dLeft>2 ? 'ok':'warn'}"><span class="dot"></span>${subOk ? `Essai : ${dLeft} jour(s)` : 'Essai terminé'}</div>
        ${t.plan!=='pro' ? `<button class="nav-item" id="upgrade-btn" style="color:var(--signal); font-weight:600;">⚡ Passer au plan supérieur</button>` : ''}
        <button class="nav-item" id="logout-btn">${ICONS.logout} Déconnexion</button>
      </div>
    </div>
    <div class="main">
      ${renderInfoBar()}
      ${!subOk ? `<div class="error-msg">Votre période d'essai est terminée. Contactez-nous pour continuer à utiliser SID Ticket.</div>` : ''}
      ${CUR_VIEW==='dashboard'?renderDashboard():''}
      ${CUR_VIEW==='profiles'?renderProfiles():''}
      ${CUR_VIEW==='tickets'?renderTickets():''}
      ${CUR_VIEW==='router'?renderRouter():''}
      ${CUR_VIEW==='history'?renderHistory():''}
      ${CUR_VIEW==='settings'?renderSettings():''}
    </div>
  </div>`;
}

function renderDashboard(){
  const now = Date.now();
  const day = sumFor(startOfDay(now)), week = sumFor(startOfWeek(now)), month = sumFor(startOfMonth(now)), year = sumFor(startOfYear(now));
  const stock = STATE.tickets.filter(t=>t.status==='disponible').length;
  const days = [];
  for(let i=6;i>=0;i--){
    const d = new Date(); d.setDate(d.getDate()-i); d.setHours(0,0,0,0);
    const next = d.getTime()+86400000;
    const list = soldTickets().filter(t=>t.activatedAt>=d.getTime() && t.activatedAt<next);
    days.push({ label: d.toLocaleDateString('fr-FR',{weekday:'short'}), total: list.reduce((s,t)=>s+t.price,0) });
  }
  const maxVal = Math.max(1, ...days.map(d=>d.total));
  return `
  <div class="page-header"><div><div class="eyebrow">Vue d'ensemble</div><h1>Tableau de bord</h1><p>Ventes de vos tickets WiFi</p></div>
    <button class="btn btn-ghost btn-sm" id="sync-btn">Synchroniser avec le routeur</button>
  </div>
  <div class="grid-cards">
    <div class="stat-card accent"><div class="label">Aujourd'hui</div><div class="value">${fmtMoney(day.total)}</div><div class="count">${day.count} vente(s)</div></div>
    <div class="stat-card"><div class="label">Cette semaine</div><div class="value">${fmtMoney(week.total)}</div><div class="count">${week.count} vente(s)</div></div>
    <div class="stat-card"><div class="label">Ce mois</div><div class="value">${fmtMoney(month.total)}</div><div class="count">${month.count} vente(s)</div></div>
    <div class="stat-card"><div class="label">Cette année</div><div class="value">${fmtMoney(year.total)}</div><div class="count">${year.count} vente(s)</div></div>
  </div>
  <div class="panel"><h3>Ventes des 7 derniers jours</h3>
    <div style="display:flex; align-items:flex-end; gap:10px; height:140px; padding-top:10px;">
      ${days.map(d=>`<div style="flex:1; display:flex; flex-direction:column; align-items:center; gap:8px; height:100%; justify-content:flex-end;">
        <div style="width:100%; max-width:34px; background:linear-gradient(180deg,var(--signal),rgba(38,217,190,.25)); border-radius:6px 6px 3px 3px; min-height:3px; height:${Math.max(4,(d.total/maxVal)*100)}%" title="${fmtMoney(d.total)}"></div>
        <div style="font-size:10.5px; color:var(--text-faint);">${d.label}</div></div>`).join('')}
    </div>
  </div>
  <div class="panel"><h3>Stock de tickets</h3>
    <div style="display:flex; gap:28px; flex-wrap:wrap;">
      <div><div style="color:var(--text-dim); font-size:12px; margin-bottom:6px;">Disponibles</div><div style="font-size:20px; font-family:'Space Grotesk';">${stock}</div></div>
      <div><div style="color:var(--text-dim); font-size:12px; margin-bottom:6px;">Total générés</div><div style="font-size:20px; font-family:'Space Grotesk';">${STATE.tickets.length}</div></div>
      <div><div style="color:var(--text-dim); font-size:12px; margin-bottom:6px;">Vendus (total)</div><div style="font-size:20px; font-family:'Space Grotesk';">${soldTickets().length}</div></div>
      <div><div style="color:var(--text-dim); font-size:12px; margin-bottom:6px;">Profils créés</div><div style="font-size:20px; font-family:'Space Grotesk';">${STATE.profiles.length}</div></div>
    </div>
  </div>`;
}

function renderProfiles(){
  const routerConfigured = !!STATE.config.router.host;
  const maxProfiles = STATE.tenant.maxProfiles || 0;
  const limitReached = maxProfiles > 0 && STATE.profiles.length >= maxProfiles;
  return `<div class="page-header"><div><div class="eyebrow">Modèles</div><h1>Profils</h1><p>Définissez une fois un type de forfait, puis générez des tickets à partir de lui ${maxProfiles ? `(${STATE.profiles.length}/${maxProfiles} utilisés)` : ''}</p></div>
    <button class="btn btn-primary" id="new-profile-btn" style="width:auto;" ${limitReached?'disabled':''}>+ Nouveau profil</button>
  </div>
  ${limitReached ? `<div class="error-msg">Limite de ${maxProfiles} profil(s) atteinte. Contactez-nous pour l'augmenter.</div>` : ''}
  ${!routerConfigured ? `<div class="error-msg">Aucun routeur configuré — les profils seront créés localement mais pas poussés sur le Hotspot.</div>` : ''}
  ${showNewProfileForm ? renderNewProfileForm() : ''}
  <div class="panel">
    ${STATE.profiles.length===0 ? '<div class="empty-state">Aucun profil. Créez votre premier forfait (ex: "1 Jour", "5 Go", "2 Heures").</div>' : `
    <table><thead><tr><th>Nom</th><th>Prix</th><th>Utilisateurs</th><th>Vitesse</th><th>Temps actif</th><th>Données</th><th>MAC</th><th>Routeur</th><th></th></tr></thead>
    <tbody>${STATE.profiles.map(p=>`<tr>
      <td><strong>${p.name}</strong></td><td>${fmtMoney(p.price)}</td><td>${p.sharedUsers}</td><td>${p.speedLimit||'—'}</td>
      <td>${fmtDuration(p.activeTimeMs)}</td><td>${fmtBytes(p.dataLimitBytes)}</td>
      <td>${p.lockByMac?'✓':'—'}</td><td>${p.routerSynced?'✓ Créé':'—'}</td>
      <td style="display:flex; gap:6px;">
        <button class="btn btn-ghost btn-sm" data-edit-profile="${p.id}">Modifier</button>
        <button class="btn btn-danger btn-sm" data-delete-profile="${p.id}">Suppr.</button>
      </td>
    </tr>`).join('')}</tbody></table>`}
  </div>`;
}
function renderNewProfileForm(){
  return `<div class="panel">
    <h3>${editingProfileId ? 'Modifier le profil' : 'Nouveau profil'}</h3>
    <div class="form-row">
      <div class="field" style="margin-bottom:0;"><label>Nom du profil</label><input id="np-name" placeholder="Ex: 1Jour, 1Heure, 5Go" value="${np.name}" /></div>
      <div class="field" style="margin-bottom:0;"><label>Prix (FCFA)</label><input id="np-price" type="number" value="${np.price}" /></div>
      <div class="field" style="margin-bottom:0;"><label>Utilisateurs simultanés</label><input id="np-users" type="number" min="1" value="${np.sharedUsers}" /></div>
      <div class="field" style="margin-bottom:0;"><label>Limite de vitesse (optionnel)</label><input id="np-speed" placeholder="Ex: 8M/8M" value="${np.speedLimit}" /></div>
    </div>
    <div class="form-row" style="margin-top:14px;">
      <div class="field" style="margin-bottom:0;"><label>Validité (0 = illimité)</label><input id="np-validity" placeholder="Ex: 30m, 12h, 3d, 1w" value="${np.validityText}" /></div>
      <div class="field" style="margin-bottom:0;"><label>Temps actif</label><input id="np-active" placeholder="Ex: 30m, 12h, 3d, 1w" value="${np.activeTimeText}" /></div>
      <div class="field" style="margin-bottom:0;"><label>Limite de données (0 = illimité)</label><input id="np-data-value" type="number" min="0" value="${np.dataLimitValue}" /></div>
      <div class="field" style="margin-bottom:0;"><label>Unité</label>
        <div class="type-toggle" style="margin-bottom:0;">
          <button type="button" data-data-unit="mo" class="${np.dataLimitUnit==='mo'?'active':''}">MB</button>
          <button type="button" data-data-unit="go" class="${np.dataLimitUnit==='go'?'active':''}">GB</button>
        </div>
      </div>
    </div>
    <p class="hint" style="margin-top:8px;">Format des durées : <span class="mono">m</span> minutes, <span class="mono">h</span> heures, <span class="mono">d</span> jours, <span class="mono">w</span> semaines (ex: <span class="mono">3d</span> = 3 jours).</p>

    <h3 style="margin-top:20px;">Génération des identifiants</h3>
    <div class="type-toggle">
      <button data-cred-mode="user_eq_pass" class="${np.credentialMode==='user_eq_pass'?'active':''}">User = Pass</button>
      <button data-cred-mode="user_pass" class="${np.credentialMode==='user_pass'?'active':''}">Nom + Mot de passe séparés</button>
    </div>
    <div class="form-row">
      <div class="field" style="margin-bottom:0;"><label>Type nom d'utilisateur</label>
        <select id="np-uname-type">
          <option value="abc" ${np.usernameCharType==='abc'?'selected':''}>Lettres (Abc)</option>
          <option value="123" ${np.usernameCharType==='123'?'selected':''}>Chiffres (123)</option>
          <option value="mixte" ${np.usernameCharType==='mixte'?'selected':''}>Alphanumérique (A1b2c3)</option>
        </select>
      </div>
      ${np.credentialMode==='user_pass' ? `
      <div class="field" style="margin-bottom:0;"><label>Type mot de passe</label>
        <select id="np-pass-type">
          <option value="abc" ${np.passwordCharType==='abc'?'selected':''}>Lettres (Abc)</option>
          <option value="123" ${np.passwordCharType==='123'?'selected':''}>Chiffres (123)</option>
          <option value="mixte" ${np.passwordCharType==='mixte'?'selected':''}>Alphanumérique (A1b2c3)</option>
        </select>
      </div>` : ''}
      <div class="field" style="margin-bottom:0;"><label>Longueur</label><input id="np-length" type="number" min="3" max="20" value="${np.credentialLength}" /></div>
      <div class="field" style="margin-bottom:0;"><label>Préfixe (optionnel)</label><input id="np-prefix" placeholder="Ex: WZ-" value="${np.prefix}" /></div>
    </div>
    <div class="panel" style="background:var(--surface-2); margin-top:16px; margin-bottom:0;">
      <label style="display:flex; align-items:center; gap:10px; cursor:pointer; font-size:13.5px;">
        <input type="checkbox" id="np-lockmac" ${np.lockByMac?'checked':''} style="width:16px; height:16px;" />
        <span><strong>Verrouiller par MAC</strong><br><span class="hint" style="margin:0;">Bloque le partage du ticket sur un autre appareil, même après déconnexion.</span></span>
      </label>
    </div>
    <div style="display:flex; gap:8px; margin-top:18px;">
      <button class="btn btn-primary" id="np-submit" style="width:auto;">${editingProfileId ? 'Enregistrer les modifications' : 'Créer le profil'}</button>
      <button class="btn btn-ghost" id="np-cancel">Annuler</button>
    </div>
  </div>`;
}

function renderTickets(){
  const list = STATE.tickets
    .filter(t=> ticketFilter==='tous'?true:t.status===ticketFilter)
    .filter(t=> ticketSearch ? t.username.toLowerCase().includes(ticketSearch.toLowerCase()) : true)
    .sort((a,b)=>{
      if(ticketSort==='profile') return a.profileName.localeCompare(b.profileName);
      if(ticketSort==='date-asc') return a.createdAt-b.createdAt;
      return b.createdAt-a.createdAt; // date-desc (défaut)
    });
  const routerConfigured = !!STATE.config.router.host;
  if(STATE.profiles.length===0){
    return `<div class="page-header"><div><div class="eyebrow">Génération</div><h1>Tickets</h1><p>Créez d'abord un profil avant de générer des tickets</p></div></div>
    <div class="panel"><div class="empty-state">Vous n'avez encore aucun profil.<br><br><button class="btn btn-primary" style="width:auto;" data-nav="profiles">Créer mon premier profil</button></div></div>`;
  }
  const selected = STATE.profiles.find(p=>p.id===selectedProfileId) || STATE.profiles[0];
  selectedProfileId = selected.id;
  const unusedCount = STATE.tickets.filter(t=>t.status==='disponible').length;
  return `
  <div class="page-header"><div><div class="eyebrow">Génération</div><h1>Tickets</h1><p>Chaque ticket créé ici crée automatiquement un compte Hotspot sur votre routeur</p></div></div>
  ${!routerConfigured ? `<div class="error-msg">Aucun routeur MikroTik configuré — les tickets seront créés localement mais pas sur le Hotspot.</div>` : ''}
  <div class="panel">
    <h3>Générer à partir d'un profil</h3>
    <div class="form-row">
      <div class="field" style="margin-bottom:0; grid-column:span 2;"><label>Profil</label>
        <select id="ticket-profile">${STATE.profiles.map(p=>`<option value="${p.id}" ${selectedProfileId===p.id?'selected':''}>${p.name} — ${fmtMoney(p.price)}</option>`).join('')}</select>
      </div>
      <div class="field" style="margin-bottom:0;"><label>Prix (remplace celui du profil, optionnel)</label><input type="number" id="price-override" placeholder="${selected.price}" value="${priceOverride}" /></div>
      <div class="field" style="margin-bottom:0;"><label>Quantité de tickets</label><input type="number" id="new-qty" min="1" max="500" value="${newTicketQty}" /></div>
    </div>
    <p class="hint">Profil sélectionné : <strong>${selected.name}</strong> · ${fmtDuration(selected.activeTimeMs)} · ${fmtBytes(selected.dataLimitBytes)} · ${selected.sharedUsers} utilisateur(s) ${selected.lockByMac ? '· verrouillage MAC actif' : ''}</p>
    <button class="btn btn-primary" id="generate-btn" style="width:auto; margin-top:6px;">Générer les tickets</button>
  </div>
  <div class="panel">
    <div class="table-toolbar">
      <div class="filter-tabs">
        <button data-filter="tous" class="${ticketFilter==='tous'?'active':''}">Tous</button>
        <button data-filter="disponible" class="${ticketFilter==='disponible'?'active':''}">Disponibles</button>
        <button data-filter="verrouille" class="${ticketFilter==='verrouille'?'active':''}">Verrouillés</button>
        <button data-filter="expire" class="${ticketFilter==='expire'?'active':''}">Expirés</button>
      </div>
      <div style="display:flex; gap:8px; flex-wrap:wrap;">
        <select id="ticket-sort" style="background:var(--surface-2); border:1px solid var(--border); border-radius:10px; padding:9px 12px; color:var(--text); font-size:13px;">
          <option value="date-desc" ${ticketSort==='date-desc'?'selected':''}>Date (récent → ancien)</option>
          <option value="date-asc" ${ticketSort==='date-asc'?'selected':''}>Date (ancien → récent)</option>
          <option value="profile" ${ticketSort==='profile'?'selected':''}>Par profil</option>
        </select>
        <input class="field" style="width:200px; margin:0;" id="ticket-search" placeholder="Rechercher un identifiant…" value="${ticketSearch}" />
        <button class="btn btn-ghost btn-sm" id="print-btn">Imprimer (${list.length})</button>
        ${unusedCount>0 ? `<button class="btn btn-danger btn-sm" id="delete-unused-btn">🗑 Supprimer les ${unusedCount} non utilisés</button>` : ''}
      </div>
    </div>
    ${list.length===0 ? '<div class="empty-state">Aucun ticket. Générez un lot ci-dessus.</div>' : `
    <table><thead><tr><th>Identifiant</th><th>Mot de passe</th><th>Profil</th><th>Prix</th><th>Statut</th><th>Routeur</th><th>Créé le</th><th></th></tr></thead>
    <tbody>${list.map(t=>`<tr>
      <td class="mono">${t.username}</td><td class="mono">${t.password===t.username?'(identique)':t.password}</td><td>${t.profileName}</td><td>${fmtMoney(t.price)}</td>
      <td>${badgeFor(t.status)}</td><td>${t.routerSynced?'✓ Créé':'—'}</td><td>${fmtDate(t.createdAt)}</td>
      <td><button class="btn btn-danger btn-sm" data-delete-ticket="${t.username}">Suppr.</button></td>
    </tr>`).join('')}</tbody></table>`}
  </div>`;
}
function printTickets(list){
  if(list.length===0){ toast('Aucun ticket à imprimer.', 'error'); return; }
  const portalBase = STATE.config.router.loginUrl || `${location.origin}/portal/${STATE.tenant.slug}`;
  const area = document.getElementById('print-area');
  area.innerHTML = `<div class="p-grid">${list.map(t=>{
    const parts = [fmtDurationCompact(t.activeTimeMs), fmtBytesCompact(t.dataLimitBytes)].filter(Boolean);
    const connectUrl = `${portalBase}?code=${encodeURIComponent(t.username)}`;
    const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=110x110&margin=0&data=${encodeURIComponent(connectUrl)}`;
    return `<div class="p-ticket">
      <div class="p-head"><span class="p-name">${t.profileName}</span><span class="p-price">${fmtMoney(t.price)}</span></div>
      <div class="p-body">
        <div class="p-code-col">
          <div class="p-code">${t.username}</div>
          ${t.password!==t.username?`<div class="p-pass">${t.password}</div>`:''}
          ${parts.length ? `<div class="p-pills">${parts.map(p=>`<span class="p-pill">${p}</span>`).join('')}</div>` : ''}
        </div>
        <img class="p-qr" src="${qrSrc}" alt="QR" />
      </div>
      <div class="p-scan-hint">📱 Scanner pour se connecter</div>
    </div>`;
  }).join('')}</div>`;
  window.print();
}
function badgeFor(status){
  if(status==='disponible') return '<span class="badge badge-dispo">Disponible</span>';
  if(status==='verrouille') return '<span class="badge badge-lock">Verrouillé</span>';
  return '<span class="badge badge-exp">Expiré</span>';
}

function renderRouter(){
  const r = STATE.config.router;
  const portalUrl = `${location.origin}/portal/${STATE.tenant.slug}`;
  return `<div class="page-header"><div><div class="eyebrow">Intégration</div><h1>📡 Hotspots</h1><p>Connexion à l'API Hotspot de votre routeur</p></div>
    ${r.host ? `<button class="btn btn-ghost btn-sm" id="refresh-router-status">🔄 Actualiser l'état</button>` : ''}
  </div>
  ${r.host ? renderRouterStatusPanel() : ''}
  <div class="panel">
    <h3>Portail de connexion WiFi</h3>
    <p class="hint" style="margin-top:0;">Donnez ce lien à vos clients (affiché automatiquement sur les tickets imprimés) : ils y saisissent leur code pour se connecter.</p>
    <input class="field mono" readonly value="${portalUrl}" onclick="this.select()" style="width:100%; cursor:pointer;" />
    <h3 style="margin-top:20px;">Modèle du portail</h3>
    <p class="hint" style="margin-top:0; margin-bottom:12px;">Choisissez l'apparence de la page que voient vos clients.</p>
    <div class="profile-pick" style="grid-template-columns:repeat(5,1fr);">
      ${[
        {id:'signal', label:'Signal'},
        {id:'classic', label:'Classique'},
        {id:'ocean', label:'Océan'},
        {id:'sunset', label:'Coucher de soleil'},
        {id:'minimal', label:'Minimal'},
      ].map(th=>`<div class="profile-opt theme-swatch-${th.id} ${STATE.tenant.portalTheme===th.id?'selected':''}" data-portal-theme="${th.id}">
        <div class="p-name">${th.label}</div>
      </div>`).join('')}
    </div>
    <a href="${portalUrl}" target="_blank" class="hint" style="display:inline-block; margin-top:10px;">👁 Voir un aperçu du portail →</a>
  </div>
  <div class="panel">
    <h3>Connexion directe au routeur (optionnel)</h3>
    <p class="hint" style="margin-top:0; margin-bottom:14px;">Permet une synchronisation automatique avec un vrai routeur MikroTik. ⚠️ Cette application étant hébergée en ligne, la connexion échouera tant que votre routeur n'est pas accessible depuis internet (redirection de port ou VPN nécessaire) — un échec ici est normal si ce n'est pas encore configuré, et n'empêche pas le portail ci-dessus de fonctionner.</p>
    <div class="form-row">
      <div class="field" style="margin-bottom:0;"><label>Adresse IP du routeur</label><input id="r-host" value="${r.host||''}" placeholder="192.168.88.1" /></div>
      <div class="field" style="margin-bottom:0;"><label>Utilisateur API</label><input id="r-user" value="${r.user||'admin'}" /></div>
      <div class="field" style="margin-bottom:0;"><label>Mot de passe API</label><input type="password" id="r-pass" placeholder="${r.password?'••••••••':''}" /></div>
      <div class="field" style="margin-bottom:0;"><label>Port API</label><input id="r-port" value="${r.port||8728}" /></div>
    </div>
    <div style="display:flex; gap:10px; margin-top:18px;">
      <button class="btn btn-primary" id="save-router" style="width:auto;">Enregistrer</button>
      <button class="btn btn-ghost" id="test-router">Tester la connexion</button>
      ${r.host ? `<button class="btn btn-danger" id="reset-router" style="width:auto;">Effacer la configuration</button>` : ''}
    </div>
    <div id="router-test-result"></div>
  </div>
  <div class="panel">
    <h3>Impression des tickets</h3>
    <div class="form-row">
      <div class="field" style="margin-bottom:0;"><label>Adresse de connexion (affichée sur les tickets)</label><input id="r-loginurl" value="${r.loginUrl||''}" placeholder="${portalUrl}" /></div>
      <div class="field" style="margin-bottom:0;"><button class="btn btn-primary" id="save-print-settings" style="width:auto;">Enregistrer</button></div>
    </div>
    <p class="hint">Laissez vide pour utiliser automatiquement votre lien de portail ci-dessus.</p>
  </div>`;
}
function renderRouterStatusPanel(){
  if(routerStatusLoading) return `<div class="panel"><p class="hint" style="margin:0;">Chargement de l'état du routeur…</p></div>`;
  if(!routerStatus) return '';
  if(!routerStatus.ok) return `<div class="error-msg">Impossible de récupérer l'état du routeur : ${routerStatus.error}</div>`;
  const memUsedPct = routerStatus.totalMemory ? Math.round((1 - routerStatus.freeMemory/routerStatus.totalMemory)*100) : null;
  return `<div class="grid-cards">
    <div class="stat-card"><div class="label">Adresse IP</div><div class="value" style="font-size:16px;">${STATE.config.router.host}</div></div>
    <div class="stat-card accent"><div class="label">Statut</div><div class="value" style="font-size:16px;">✅ Connecté</div></div>
    <div class="stat-card"><div class="label">Version RouterOS</div><div class="value" style="font-size:16px;">${routerStatus.version||'—'}</div></div>
    <div class="stat-card"><div class="label">Utilisateurs connectés 👥</div><div class="value">${routerStatus.activeUsers}</div></div>
    <div class="stat-card"><div class="label">CPU</div><div class="value" style="font-size:16px;">${routerStatus.cpuLoad!==null?routerStatus.cpuLoad+'%':'—'}</div></div>
    <div class="stat-card"><div class="label">RAM utilisée</div><div class="value" style="font-size:16px;">${memUsedPct!==null?memUsedPct+'%':'—'}</div></div>
    <div class="stat-card"><div class="label">Température</div><div class="value" style="font-size:16px;">${routerStatus.temperature?routerStatus.temperature+'°C':'—'}</div></div>
    <div class="stat-card"><div class="label">Temps de fonctionnement</div><div class="value" style="font-size:16px;">${routerStatus.uptime||'—'}</div></div>
  </div>`;
}

function renderHistory(){
  const now = Date.now();
  let fromTs = historyPeriod==='jour'?startOfDay(now):historyPeriod==='semaine'?startOfWeek(now):historyPeriod==='mois'?startOfMonth(now):startOfYear(now);
  const list = soldTickets().filter(t=>t.activatedAt>=fromTs).sort((a,b)=>b.activatedAt-a.activatedAt);
  const total = list.reduce((s,t)=>s+t.price,0);
  return `<div class="page-header"><div><div class="eyebrow">Rapports</div><h1>Historique des ventes</h1><p>Détail des tickets vendus par période</p></div></div>
  <div class="panel">
    <div class="table-toolbar">
      <div class="filter-tabs">
        <button data-period="jour" class="${historyPeriod==='jour'?'active':''}">Journalier</button>
        <button data-period="semaine" class="${historyPeriod==='semaine'?'active':''}">Hebdomadaire</button>
        <button data-period="mois" class="${historyPeriod==='mois'?'active':''}">Mensuel</button>
        <button data-period="annee" class="${historyPeriod==='annee'?'active':''}">Annuel</button>
      </div>
      <div style="font-weight:600;">Total : <span style="color:var(--signal);">${fmtMoney(total)}</span> · ${list.length} vente(s)</div>
    </div>
    ${list.length===0?'<div class="empty-state">Aucune vente sur cette période.</div>':`
    <table><thead><tr><th>Identifiant</th><th>Profil</th><th>Prix</th><th>Vendu le</th></tr></thead>
    <tbody>${list.map(t=>`<tr><td class="mono">${t.username}</td><td>${t.profileName}</td><td>${fmtMoney(t.price)}</td><td>${fmtDate(t.activatedAt)}</td></tr>`).join('')}</tbody></table>`}
  </div>`;
}

function renderSettings(){
  const t = STATE.tenant;
  const hasRemoteAccess = t.features && t.features.remoteAccess;
  return `<div class="page-header"><div><div class="eyebrow">Configuration</div><h1>Paramètres</h1><p>Identité, sécurité et abonnement</p></div></div>
  <div class="settings-grid">
    <div class="panel"><h3>Nom de la boutique</h3><div class="field"><input id="biz-name" value="${STATE.config.businessName}" /></div><button class="btn btn-primary" id="save-biz" style="width:auto;">Enregistrer</button></div>
    <div class="panel"><h3>Changer le mot de passe</h3>
      <div class="field"><label>Mot de passe actuel</label><input type="password" id="pw-current" /></div>
      <div class="field"><label>Nouveau mot de passe</label><input type="password" id="pw-new" /></div>
      <button class="btn btn-primary" id="save-pw" style="width:auto;">Mettre à jour</button>
    </div>
  </div>
  <div class="panel" style="margin-top:22px;"><h3>Votre abonnement</h3>
    <p style="font-size:13.5px; color:var(--text-dim);">Email : <strong style="color:var(--text);">${t.email}</strong> · Plan <strong style="color:var(--text); text-transform:capitalize;">${t.plan}</strong> · Actif jusqu'au ${new Date(t.trialEndsAt).toLocaleDateString('fr-FR')}</p>
    <p style="font-size:13px; color:var(--text-dim); margin-top:8px;">Profils autorisés : <strong style="color:var(--text);">${t.maxProfiles ? t.maxProfiles : 'Illimité'}</strong> (${STATE.profiles.length} utilisé(s))</p>
    <button class="btn btn-ghost btn-sm" id="mobile-logout-btn" style="width:auto; margin-top:12px;">Déconnexion</button>
  </div>
  ${renderPaymentPanel()}
  <div class="panel" style="margin-top:22px;">
    <h3>Mode accès distant</h3>
    ${!hasRemoteAccess ? `<div class="error-msg">Non disponible sur votre compte. Contactez-nous pour l'activer.</div>` : `
    <p class="hint" style="margin-top:0; margin-bottom:14px;">Nécessite <span class="mono">cloudflared</span> installé sur le serveur.</p>
    <button class="btn btn-primary" id="start-remote" style="width:auto;">Activer l'accès distant</button>`}
  </div>`;
}
function renderPaymentPanel(){
  const prices = STATE.subscriptionPrices || {};
  const durations = [ {days:'30', label:'1 mois'}, {days:'90', label:'3 mois'}, {days:'180', label:'6 mois'}, {days:'365', label:'1 an'} ];
  const pending = (STATE.myPaymentRequests||[]).filter(r=>r.status==='pending');
  return `<div class="panel" style="margin-top:22px;">
    <h3>Renouveler / prolonger mon abonnement</h3>
    <p class="hint" style="margin-top:0; margin-bottom:14px;">Envoyez le montant correspondant via MyNITA (ou mobile money) au numéro ci-dessous, puis indiquez-nous que vous avez payé — nous validerons et activerons votre licence.</p>
    <div class="ticket-result" style="margin-top:0;">
      <div class="row"><span>Numéro à payer</span><span class="mono">${STATE.paymentPhone||'—'}</span></div>
      <div class="row"><span>Nom du bénéficiaire</span><span>${STATE.paymentName||'—'}</span></div>
    </div>
    <div class="form-row" style="margin-top:16px;">
      ${durations.map(d=>`<div class="field" style="margin-bottom:0;">
        <label>${d.label}</label>
        <button type="button" class="btn btn-ghost duration-pick-btn" data-duration="${d.days}" style="width:100%;">${fmtMoney(prices[d.days]||0)}</button>
      </div>`).join('')}
    </div>
    <div class="field" style="margin-top:14px;"><label>Référence de transaction (optionnel)</label><input id="payment-reference" placeholder="Ex: numéro de transaction MyNITA" /></div>
    <button class="btn btn-primary" id="submit-payment" style="width:auto;" disabled>J'ai payé — Demander la validation</button>
    <p class="hint" id="selected-duration-hint" style="margin-top:10px;">Choisissez d'abord une durée ci-dessus.</p>
    ${pending.length>0 ? `<div class="success-msg" style="margin-top:14px;">⏳ ${pending.length} demande(s) en attente de validation par l'administrateur.</div>` : ''}
  </div>`;
}

function attachShellEvents(){
  document.querySelectorAll('[data-nav]').forEach(b=>b.addEventListener('click', ()=>{ CUR_VIEW=b.dataset.nav; render(); }));
  const logoutBtn = document.getElementById('logout-btn');
  if(logoutBtn) logoutBtn.addEventListener('click', async ()=>{
    await api('/api/auth/logout', 'POST', {});
    localStorage.removeItem('sidticket_token'); TOKEN=null; STATE=null; VIEW='landing'; render();
  });
  const upgradeBtn = document.getElementById('upgrade-btn');
  if(upgradeBtn) upgradeBtn.addEventListener('click', ()=>{
    const msg = STATE.upgradeMessage || "Contactez-nous pour passer au plan supérieur.";
    const contact = STATE.upgradeContact;
    alert(msg + (contact ? `\n\nContact : ${contact}` : ''));
  });
  if(CUR_VIEW==='dashboard'){
    document.getElementById('sync-btn').addEventListener('click', async ()=>{
      const r = await api('/api/tickets/sync', 'POST', {});
      if(r.ok){ toast(`Synchronisé (${r.data.changed} mise(s) à jour).`); await refreshState(); render(); }
      else toast(r.data.message || 'Erreur de synchronisation', 'error');
    });
  }
  if(CUR_VIEW==='profiles') attachProfilesEvents();
  if(CUR_VIEW==='tickets') attachTicketsEvents();
  if(CUR_VIEW==='router'){
    attachRouterEvents();
    if(STATE.config.router.host && !routerStatus && !routerStatusLoading) loadRouterStatus();
  }
  if(CUR_VIEW==='history') document.querySelectorAll('[data-period]').forEach(b=>b.addEventListener('click', ()=>{ historyPeriod=b.dataset.period; render(); }));
  if(CUR_VIEW==='settings') attachSettingsEvents();
}
function attachProfilesEvents(){
  const newBtn = document.getElementById('new-profile-btn');
  if(newBtn) newBtn.addEventListener('click', ()=>{ showNewProfileForm=!showNewProfileForm; editingProfileId=null; resetProfileForm(); render(); });
  document.querySelectorAll('[data-delete-profile]').forEach(b=>b.addEventListener('click', async ()=>{
    if(!confirm('Supprimer ce profil ?')) return;
    await api(`/api/profiles/${b.dataset.deleteProfile}`, 'DELETE', {});
    await refreshState(); render();
  }));
  document.querySelectorAll('[data-edit-profile]').forEach(b=>b.addEventListener('click', ()=>{
    const p = STATE.profiles.find(x=>x.id===b.dataset.editProfile);
    if(!p) return;
    editingProfileId = p.id;
    np = {
      name:p.name, price:p.price, sharedUsers:p.sharedUsers, speedLimit:p.speedLimit||'',
      activeTimeText: msToDurationInput(p.activeTimeMs), validityText: msToDurationInput(p.validityMs),
      dataLimitValue: p.dataLimitBytes ? (p.dataLimitBytes >= 1024*1024*1024 ? p.dataLimitBytes/(1024*1024*1024) : p.dataLimitBytes/(1024*1024)) : 0,
      dataLimitUnit: p.dataLimitBytes && p.dataLimitBytes >= 1024*1024*1024 ? 'go' : 'mo',
      credentialMode:p.credentialMode, usernameCharType:p.usernameCharType, passwordCharType:p.passwordCharType,
      credentialLength:p.credentialLength, prefix:p.prefix||'', lockByMac:p.lockByMac,
    };
    showNewProfileForm = true;
    render();
  }));
  if(!showNewProfileForm) return;
  document.getElementById('np-name').addEventListener('input', e=>np.name=e.target.value);
  document.getElementById('np-price').addEventListener('input', e=>np.price=parseFloat(e.target.value)||0);
  document.getElementById('np-users').addEventListener('input', e=>np.sharedUsers=parseInt(e.target.value)||1);
  document.getElementById('np-speed').addEventListener('input', e=>np.speedLimit=e.target.value);
  document.getElementById('np-validity').addEventListener('input', e=>np.validityText=e.target.value);
  document.getElementById('np-active').addEventListener('input', e=>np.activeTimeText=e.target.value);
  document.getElementById('np-data-value').addEventListener('input', e=>np.dataLimitValue=parseFloat(e.target.value)||0);
  document.querySelectorAll('[data-data-unit]').forEach(b=>b.addEventListener('click', ()=>{ np.dataLimitUnit=b.dataset.dataUnit; render(); }));
  document.querySelectorAll('[data-cred-mode]').forEach(b=>b.addEventListener('click', ()=>{ np.credentialMode=b.dataset.credMode; render(); }));
  document.getElementById('np-uname-type').addEventListener('change', e=>np.usernameCharType=e.target.value);
  const passType = document.getElementById('np-pass-type');
  if(passType) passType.addEventListener('change', e=>np.passwordCharType=e.target.value);
  document.getElementById('np-length').addEventListener('input', e=>np.credentialLength=parseInt(e.target.value)||6);
  document.getElementById('np-prefix').addEventListener('input', e=>np.prefix=e.target.value);
  document.getElementById('np-lockmac').addEventListener('change', e=>np.lockByMac=e.target.checked);
  document.getElementById('np-cancel').addEventListener('click', ()=>{ showNewProfileForm=false; editingProfileId=null; render(); });
  document.getElementById('np-submit').addEventListener('click', async ()=>{
    if(!np.name.trim()){ toast('Le nom du profil est requis.', 'error'); return; }
    const validityMs = parseDurationInput(np.validityText);
    const activeTimeMs = parseDurationInput(np.activeTimeText);
    if(validityMs===null){ toast('Format de validité invalide (ex: 30m, 12h, 3d, 1w).', 'error'); return; }
    if(activeTimeMs===null){ toast('Format de temps actif invalide (ex: 30m, 12h, 3d, 1w).', 'error'); return; }
    const body = {
      name: np.name.trim(), price: np.price, sharedUsers: np.sharedUsers, speedLimit: np.speedLimit.trim(),
      validityMs, activeTimeMs,
      dataLimitBytes: np.dataLimitValue * VOLUME_UNITS[np.dataLimitUnit],
      credentialMode: np.credentialMode, usernameCharType: np.usernameCharType, passwordCharType: np.passwordCharType,
      credentialLength: np.credentialLength, prefix: np.prefix.trim(), lockByMac: np.lockByMac,
    };
    const r = editingProfileId
      ? await api(`/api/profiles/${editingProfileId}/update`, 'POST', body)
      : await api('/api/profiles', 'POST', body);
    if(r.ok){
      toast(editingProfileId ? 'Profil modifié.' : 'Profil créé.');
      showNewProfileForm=false; editingProfileId=null; resetProfileForm();
      await refreshState(); render();
    } else toast(r.data.message || 'Erreur', 'error');
  });
}
function resetProfileForm(){
  np = { name:'', price:0, sharedUsers:1, speedLimit:'', activeTimeText:'1d', dataLimitValue:0, dataLimitUnit:'go', validityText:'', credentialMode:'user_eq_pass', usernameCharType:'abc', passwordCharType:'123', credentialLength:6, prefix:'', lockByMac:true };
}
function attachTicketsEvents(){
  const profileSelect = document.getElementById('ticket-profile');
  if(profileSelect) profileSelect.addEventListener('change', e=>{ selectedProfileId=e.target.value; render(); });
  const priceEl = document.getElementById('price-override');
  if(priceEl) priceEl.addEventListener('input', e=>priceOverride=e.target.value);
  const qtyEl = document.getElementById('new-qty');
  if(qtyEl) qtyEl.addEventListener('input', e=>newTicketQty=parseInt(e.target.value)||1);
  const sortEl = document.getElementById('ticket-sort');
  if(sortEl) sortEl.addEventListener('change', e=>{ ticketSort=e.target.value; render(); });
  document.querySelectorAll('[data-delete-ticket]').forEach(b=>b.addEventListener('click', async ()=>{
    if(!confirm('Supprimer ce ticket ?')) return;
    await api(`/api/tickets/${encodeURIComponent(b.dataset.deleteTicket)}`, 'DELETE', {});
    await refreshState(); render();
  }));
  const deleteUnusedBtn = document.getElementById('delete-unused-btn');
  if(deleteUnusedBtn) deleteUnusedBtn.addEventListener('click', async ()=>{
    if(!confirm('Supprimer tous les tickets non utilisés (jamais activés) ? Cette action est irréversible.')) return;
    const r = await api('/api/tickets/delete-unused', 'POST', {});
    if(r.ok){ toast(`${r.data.deleted} ticket(s) supprimé(s).`); await refreshState(); render(); }
  });
  document.querySelectorAll('[data-filter]').forEach(b=>b.addEventListener('click', ()=>{ ticketFilter=b.dataset.filter; render(); }));
  const search = document.getElementById('ticket-search');
  if(search){ search.addEventListener('input', e=>{ ticketSearch=e.target.value; render(); }); setTimeout(()=>{ search.focus(); search.selectionStart=search.selectionEnd=search.value.length; },0); }
  const genBtn = document.getElementById('generate-btn');
  if(genBtn) genBtn.addEventListener('click', async ()=>{
    const r = await api('/api/tickets/generate', 'POST', { profileId: selectedProfileId, qty: newTicketQty, priceOverride });
    if(r.ok){
      toast(`${r.data.created} ticket(s) généré(s).`);
      if(r.data.routerErrors && r.data.routerErrors.length) toast('Erreurs routeur: ' + r.data.routerErrors[0], 'error');
      priceOverride=''; await refreshState(); render();
    } else toast(r.data.message || 'Erreur', 'error');
  });
  const printBtn = document.getElementById('print-btn');
  if(printBtn) printBtn.addEventListener('click', ()=>{
    const list = STATE.tickets.filter(t=> ticketFilter==='tous'?true:t.status===ticketFilter).filter(t=> ticketSearch?t.username.toLowerCase().includes(ticketSearch.toLowerCase()):true).sort((a,b)=>b.createdAt-a.createdAt);
    printTickets(list);
  });
}
async function loadRouterStatus(){
  routerStatusLoading = true; render();
  const r = await api('/api/config/router/status');
  routerStatusLoading = false;
  routerStatus = r.ok ? r.data : { ok:false, error: r.data.message || 'Erreur' };
  render();
}
function attachRouterEvents(){
  const refreshBtn = document.getElementById('refresh-router-status');
  if(refreshBtn) refreshBtn.addEventListener('click', ()=>{ routerStatus=null; loadRouterStatus(); });
  const resetBtn = document.getElementById('reset-router');
  if(resetBtn) resetBtn.addEventListener('click', async ()=>{
    if(!confirm('Effacer la configuration du routeur (adresse, identifiants) ?')) return;
    const r = await api('/api/config/router/reset', 'POST', {});
    if(r.ok){ toast('Configuration effacée.'); routerStatus=null; await refreshState(); render(); }
  });
  document.querySelectorAll('[data-portal-theme]').forEach(el=>el.addEventListener('click', async ()=>{
    const r = await api('/api/config/portal-theme', 'POST', { theme: el.dataset.portalTheme });
    if(r.ok){ toast('Modèle de portail mis à jour.'); await refreshState(); render(); }
  }));
  document.getElementById('save-router').addEventListener('click', async ()=>{
    const body = { host: document.getElementById('r-host').value.trim(), user: document.getElementById('r-user').value.trim(), password: document.getElementById('r-pass').value, port: document.getElementById('r-port').value };
    const r = await api('/api/config/router', 'POST', body);
    if(r.ok){ toast('Configuration enregistrée.'); routerStatus=null; await refreshState(); render(); }
  });
  document.getElementById('test-router').addEventListener('click', async ()=>{
    const box = document.getElementById('router-test-result');
    box.innerHTML = '<p class="hint">Test en cours…</p>';
    const r = await api('/api/config/router/test', 'POST', {});
    if(r.ok && r.data.ok) box.innerHTML = `<div class="success-msg" style="margin-top:14px;">✓ Connecté à ${r.data.identity}</div>`;
    else box.innerHTML = `<div class="error-msg" style="margin-top:14px;">Échec : ${(r.data && r.data.error) || 'inconnu'}</div>`;
  });
  document.getElementById('save-print-settings').addEventListener('click', async ()=>{
    const r = await api('/api/config/router/print-settings', 'POST', { loginUrl: document.getElementById('r-loginurl').value.trim() });
    if(r.ok){ toast('Paramètres enregistrés.'); await refreshState(); render(); }
  });
}
function attachSettingsEvents(){
  document.getElementById('save-biz').addEventListener('click', async ()=>{
    const r = await api('/api/config/business', 'POST', { businessName: document.getElementById('biz-name').value.trim() });
    if(r.ok){ toast('Nom mis à jour.'); await refreshState(); render(); }
  });
  document.getElementById('save-pw').addEventListener('click', async ()=>{
    const current = document.getElementById('pw-current').value, next = document.getElementById('pw-new').value;
    const r = await api('/api/change-password', 'POST', { current, next });
    if(r.ok) toast('Mot de passe mis à jour.'); else toast(r.data.message || 'Erreur', 'error');
  });
  const startBtn = document.getElementById('start-remote');
  if(startBtn) startBtn.addEventListener('click', async ()=>{
    toast('Connexion en cours…');
    const r = await api('/api/remote-access/start', 'POST', {});
    if(r.ok) toast('Accès distant activé : ' + r.data.url); else toast(r.data.message || 'Erreur', 'error');
  });
  const mobileLogout = document.getElementById('mobile-logout-btn');
  if(mobileLogout) mobileLogout.addEventListener('click', async ()=>{
    await api('/api/auth/logout', 'POST', {});
    localStorage.removeItem('sidticket_token'); TOKEN=null; STATE=null; VIEW='landing'; render();
  });
  let selectedDuration = null;
  document.querySelectorAll('.duration-pick-btn').forEach(b=>b.addEventListener('click', ()=>{
    selectedDuration = b.dataset.duration;
    document.querySelectorAll('.duration-pick-btn').forEach(x=>x.classList.toggle('selected-pill', x===b));
    const submitBtn = document.getElementById('submit-payment');
    if(submitBtn) submitBtn.disabled = false;
    const hint = document.getElementById('selected-duration-hint');
    if(hint) hint.textContent = `Durée sélectionnée : ${b.parentElement.querySelector('label').textContent}`;
  }));
  const submitPayment = document.getElementById('submit-payment');
  if(submitPayment) submitPayment.addEventListener('click', async ()=>{
    if(!selectedDuration){ toast('Choisissez une durée.', 'error'); return; }
    const reference = document.getElementById('payment-reference').value.trim();
    const r = await api('/api/payment-requests', 'POST', { durationDays: selectedDuration, reference });
    if(r.ok){ toast('Demande envoyée. En attente de validation.'); await refreshState(); render(); }
    else toast(r.data.message || 'Erreur', 'error');
  });
}

function renderLicenseModal(){
  const t = licenseModalTenant;
  return `<div style="position:fixed; inset:0; background:rgba(0,0,0,.5); display:flex; align-items:center; justify-content:center; z-index:1000; padding:20px;" id="license-overlay">
    <div class="card" style="max-width:420px; text-align:left;">
      <h1 style="font-size:18px; margin-bottom:14px;">Gérer l'abonnement : ${t.businessName}</h1>
      <div class="field"><label>Plan</label>
        <div class="type-toggle">
          <button type="button" data-license-plan="basique" class="license-plan-btn ${t.plan!=='pro'?'active':''}">Basique</button>
          <button type="button" data-license-plan="pro" class="license-plan-btn ${t.plan==='pro'?'active':''}">Pro</button>
        </div>
      </div>
      <div class="field"><label>Durée de la licence (jours à partir d'aujourd'hui)</label><input id="license-days" type="number" min="1" value="30" /></div>
      <p class="hint" style="margin-top:0;">Remplace la date de fin actuelle par aujourd'hui + ce nombre de jours.</p>
      <div style="display:flex; gap:8px; margin-top:14px;">
        <button class="btn btn-primary" id="license-submit" style="width:auto;">Générer la licence</button>
        <button class="btn btn-ghost" id="license-cancel">Annuler</button>
      </div>
    </div>
  </div>`;
}
function renderResetPasswordModal(){
  const r = resetPasswordResult;
  return `<div style="position:fixed; inset:0; background:rgba(0,0,0,.5); display:flex; align-items:center; justify-content:center; z-index:1000; padding:20px;" id="reset-overlay">
    <div class="card" style="max-width:420px; text-align:left;">
      <h1 style="font-size:18px; margin-bottom:10px;">Mot de passe réinitialisé</h1>
      <p class="sub" style="text-align:left; margin-bottom:14px;">Communiquez ce nouveau mot de passe temporaire à <strong>${r.businessName}</strong> (email : ${r.email}). Il pourra le changer ensuite dans ses Paramètres.</p>
      <div class="ticket-result"><div class="row"><span>Nouveau mot de passe</span><span class="mono">${r.tempPassword}</span></div></div>
      <div style="display:flex; gap:8px; margin-top:14px;">
        <button class="btn btn-primary" id="reset-copy" style="width:auto;">Copier</button>
        <button class="btn btn-ghost" id="reset-close">Fermer</button>
      </div>
    </div>
  </div>`;
}
async function loadAdminPasswordResets(){
  const r = await adminApi('/api/admin/password-reset-requests');
  if(r.ok){ adminPasswordResetsState = r.data.requests; render(); }
}
function renderAdminPasswordResets(){
  if(!adminPasswordResetsState) return `<div class="page-header"><h1>Chargement…</h1></div>`;
  const pending = adminPasswordResetsState.filter(r=>r.status==='pending');
  const others = adminPasswordResetsState.filter(r=>r.status!=='pending');
  return `<div class="page-header"><div><div class="eyebrow">Comptes</div><h1>🔑 Mots de passe oubliés</h1><p>${pending.length} demande(s) en attente</p></div></div>
  <div class="panel">
    <h3>En attente</h3>
    ${pending.length===0 ? '<div class="empty-state">Aucune demande en attente.</div>' : `
    <table><thead><tr><th>Boutique</th><th>Email</th><th>Demandé le</th><th></th></tr></thead>
    <tbody>${pending.map(r=>`<tr>
      <td>${r.businessName}</td><td>${r.email}</td><td>${fmtDate(r.createdAt)}</td>
      <td><button class="btn btn-primary btn-sm" data-resolve-reset="${r.id}" style="width:auto;">Générer un nouveau mot de passe</button></td>
    </tr>`).join('')}</tbody></table>`}
  </div>
  ${others.length>0 ? `<div class="panel"><h3>Historique</h3>
    <table><thead><tr><th>Boutique</th><th>Email</th><th>Statut</th><th>Date</th></tr></thead>
    <tbody>${others.map(r=>`<tr><td>${r.businessName}</td><td>${r.email}</td><td><span class="badge badge-dispo">Résolu</span></td><td>${fmtDate(r.createdAt)}</td></tr>`).join('')}</tbody></table>
  </div>` : ''}`;
}
async function loadAdminPayments(){
  const r = await adminApi('/api/admin/payment-requests');
  if(r.ok){ adminPaymentsState = r.data.requests; render(); }
}
function renderAdminPayments(){
  if(!adminPaymentsState) return `<div class="page-header"><h1>Chargement…</h1></div>`;
  const pending = adminPaymentsState.filter(p=>p.status==='pending');
  const others = adminPaymentsState.filter(p=>p.status!=='pending');
  return `<div class="page-header"><div><div class="eyebrow">Abonnements</div><h1>💵 Paiements</h1><p>${pending.length} demande(s) en attente de validation</p></div></div>
  <div class="panel">
    <h3>En attente</h3>
    ${pending.length===0 ? '<div class="empty-state">Aucune demande en attente.</div>' : `
    <table><thead><tr><th>Boutique</th><th>Email</th><th>Durée</th><th>Montant</th><th>Référence</th><th>Demandé le</th><th></th></tr></thead>
    <tbody>${pending.map(p=>`<tr>
      <td>${p.businessName}</td><td>${p.email}</td><td>${durationLabel(p.durationDays)}</td><td>${fmtMoney(p.amount)}</td><td>${p.reference||'—'}</td><td>${fmtDate(p.createdAt)}</td>
      <td style="display:flex; gap:6px;">
        <button class="btn btn-primary btn-sm" data-validate-payment="${p.id}" style="width:auto;">✓ Valider</button>
        <button class="btn btn-danger btn-sm" data-reject-payment="${p.id}">✗ Rejeter</button>
      </td>
    </tr>`).join('')}</tbody></table>`}
  </div>
  <div class="panel">
    <h3>Historique</h3>
    ${others.length===0 ? '<div class="empty-state">Aucun historique.</div>' : `
    <table><thead><tr><th>Boutique</th><th>Durée</th><th>Montant</th><th>Statut</th><th>Date</th></tr></thead>
    <tbody>${others.map(p=>`<tr><td>${p.businessName}</td><td>${durationLabel(p.durationDays)}</td><td>${fmtMoney(p.amount)}</td><td>${p.status==='validated'?'<span class="badge badge-dispo">Validé</span>':'<span class="badge badge-exp">Rejeté</span>'}</td><td>${fmtDate(p.validatedAt||p.createdAt)}</td></tr>`).join('')}</tbody></table>`}
  </div>`;
}
function durationLabel(days){
  const map = {30:'1 mois', 90:'3 mois', 180:'6 mois', 365:'1 an'};
  return map[days] || `${days} jours`;
}

async function loadAdminSettings(){
  const r = await adminApi('/api/admin/settings');
  if(r.ok){ adminSettingsState = r.data; render(); }
}
function renderAdminSettings(){
  if(!adminSettingsState) return `<div class="page-header"><h1>Chargement…</h1></div>`;
  const prices = adminSettingsState.subscriptionPrices || {};
  return `<div class="page-header"><div><div class="eyebrow">Configuration</div><h1>Paramètres administrateur</h1><p>Sécurité, paiement et message de mise à niveau</p></div></div>
  <div class="settings-grid">
    <div class="panel"><h3>Changer le mot de passe admin</h3>
      <div class="field"><label>Mot de passe actuel</label><input type="password" id="admin-pw-current" /></div>
      <div class="field"><label>Nouveau mot de passe</label><input type="password" id="admin-pw-new" /></div>
      <button class="btn btn-primary" id="admin-pw-save" style="width:auto;">Mettre à jour</button>
    </div>
    <div class="panel"><h3>Message "Passer au plan supérieur"</h3>
      <p class="hint" style="margin-top:0;">Affiché à tous les clients en plan Basique.</p>
      <div class="field"><label>Message</label><textarea id="upgrade-message" rows="3">${adminSettingsState.upgradeMessage||''}</textarea></div>
      <div class="field"><label>Contact (téléphone, WhatsApp, email…)</label><input id="upgrade-contact" value="${adminSettingsState.upgradeContact||''}" /></div>
      <button class="btn btn-primary" id="upgrade-msg-save" style="width:auto;">Enregistrer</button>
    </div>
  </div>
  <div class="panel" style="margin-top:22px;">
    <h3>Paiement des abonnements</h3>
    <div class="form-row">
      <div class="field" style="margin-bottom:0;"><label>Numéro à payer</label><input id="payment-phone" value="${adminSettingsState.paymentPhone||''}" /></div>
      <div class="field" style="margin-bottom:0;"><label>Nom du bénéficiaire</label><input id="payment-name" value="${adminSettingsState.paymentName||''}" /></div>
    </div>
    <h3 style="margin-top:18px;">Tarifs (FCFA)</h3>
    <div class="form-row">
      <div class="field" style="margin-bottom:0;"><label>1 mois</label><input id="price-30" type="number" value="${prices['30']||0}" /></div>
      <div class="field" style="margin-bottom:0;"><label>3 mois</label><input id="price-90" type="number" value="${prices['90']||0}" /></div>
      <div class="field" style="margin-bottom:0;"><label>6 mois</label><input id="price-180" type="number" value="${prices['180']||0}" /></div>
      <div class="field" style="margin-bottom:0;"><label>1 an</label><input id="price-365" type="number" value="${prices['365']||0}" /></div>
    </div>
    <button class="btn btn-primary" id="payment-settings-save" style="width:auto; margin-top:14px;">Enregistrer</button>
  </div>`;
}

function renderAdminLogin(){
  return `<div class="center-screen"><div class="card">
    ${signalMark()}
    <h1>Administration</h1>
    <p class="sub">Accès réservé au superadmin</p>
    ${adminError ? `<div class="error-msg">${adminError}</div>` : ''}
    <form id="admin-login-form">
      <div class="field"><label>Mot de passe administrateur</label><input type="password" id="admin-pass" required autofocus /></div>
      <button type="submit" class="btn btn-primary">Se connecter</button>
    </form>
  </div></div>`;
}
function attachAdminLoginEvents(){
  document.getElementById('admin-login-form').addEventListener('submit', async e=>{
    e.preventDefault();
    const secret = document.getElementById('admin-pass').value;
    const r = await api('/api/admin/login', 'POST', { secret });
    if(r.ok){ ADMIN_SECRET=secret; sessionStorage.setItem('sidticket_admin_secret', secret); adminError=''; VIEW='admin'; render(); }
    else { adminError = r.data.message || 'Erreur'; render(); }
  });
}
async function loadAdminTenants(){
  const r = await adminApi('/api/admin/tenants');
  if(r.ok){ adminState = r.data.tenants; render(); }
  else { ADMIN_SECRET=null; sessionStorage.removeItem('sidticket_admin_secret'); VIEW='admin-login'; adminError='Session expirée.'; render(); }
}
function renderAdmin(){
  if(!adminState) return `<div class="page-header"><h1>Chargement…</h1></div>`;
  const nav = [
    {id:'admin-dashboard', label:'Tableau de bord', icon:ICONS.dashboard},
    {id:'admin-clients', label:'Tous les clients', icon:ICONS.profile},
    {id:'admin-payments', label:'Paiements', icon:'💵'},
    {id:'admin-password-resets', label:'Mots de passe oubliés', icon:'🔑'},
    {id:'admin-settings', label:'Paramètres', icon:ICONS.settings},
  ];
  return `<div id="app-shell"><div class="sidebar">
    <div class="brand">${signalMark()}<div><div class="brand-name">Administration</div><div class="brand-sub">SID Ticket</div></div></div>
    <div>${nav.map(n=>`<button class="nav-item ${ADMIN_VIEW===n.id?'active':''}" data-admin-nav="${n.id}">${n.icon}${n.label}</button>`).join('')}</div>
    <div class="sidebar-footer"><button class="nav-item" id="admin-logout">${ICONS.logout} Déconnexion</button></div>
  </div>
  <div class="main">
    ${ADMIN_VIEW==='admin-dashboard' ? renderAdminDashboard() : ''}
    ${ADMIN_VIEW==='admin-clients' ? renderAdminClients() : ''}
    ${ADMIN_VIEW==='admin-payments' ? renderAdminPayments() : ''}
    ${ADMIN_VIEW==='admin-password-resets' ? renderAdminPasswordResets() : ''}
    ${ADMIN_VIEW==='admin-settings' ? renderAdminSettings() : ''}
    ${adminDetail ? renderAdminDetailModal() : ''}
    ${resetPasswordResult ? renderResetPasswordModal() : ''}
    ${licenseModalTenant ? renderLicenseModal() : ''}
  </div></div>`;
}
function renderAdminDashboard(){
  const total = adminState.length;
  const active = adminState.filter(t=>t.active && daysLeft(t.trialEndsAt)>0).length;
  const expiringSoon = adminState.filter(t=>t.active && daysLeft(t.trialEndsAt)>0 && daysLeft(t.trialEndsAt)<=3).length;
  const pro = adminState.filter(t=>t.plan==='pro').length;
  return `<div class="page-header"><div><div class="eyebrow">Vue d'ensemble</div><h1>Tableau de bord</h1><p>Aperçu de tous vos clients SID Ticket</p></div></div>
  <div class="grid-cards">
    <div class="stat-card accent"><div class="label">Comptes inscrits</div><div class="value">${total}</div></div>
    <div class="stat-card"><div class="label">Comptes actifs</div><div class="value">${active}</div></div>
    <div class="stat-card"><div class="label">Essai finissant sous 3j</div><div class="value">${expiringSoon}</div></div>
    <div class="stat-card"><div class="label">Plan Pro</div><div class="value">${pro}</div></div>
  </div>
  ${expiringSoon>0 ? `<div class="panel"><h3>À surveiller</h3>
    <table><thead><tr><th>Boutique</th><th>Email</th><th>Essai jusqu'au</th></tr></thead>
    <tbody>${adminState.filter(t=>t.active && daysLeft(t.trialEndsAt)>0 && daysLeft(t.trialEndsAt)<=3).map(t=>`<tr data-detail="${t.id}" style="cursor:pointer;"><td>${t.businessName}</td><td>${t.email}</td><td>${fmtDate(t.trialEndsAt)}</td></tr>`).join('')}</tbody></table>
  </div>` : ''}`;
}
function renderAdminClients(){
  return `<div class="page-header"><div><div class="eyebrow">Comptes</div><h1>Tous les clients</h1><p>${adminState.length} compte(s) inscrit(s) — cliquez une ligne pour voir le détail</p></div></div>
  <div class="panel">
    ${adminState.length===0 ? '<div class="empty-state">Aucun compte pour le moment.</div>' : `
    <table><thead><tr><th>Boutique</th><th>Email</th><th>Plan</th><th>Essai jusqu'au</th><th>Statut</th><th>Profils</th><th></th></tr></thead>
    <tbody>${adminState.map(t=>{
      const d = daysLeft(t.trialEndsAt);
      const statusBadge = !t.active ? '<span class="badge badge-exp">Désactivé</span>' : d<=0 ? '<span class="badge badge-exp">Essai terminé</span>' : d<=3 ? '<span class="badge badge-lock">Bientôt</span>' : '<span class="badge badge-dispo">Actif</span>';
      return `<tr>
        <td data-detail="${t.id}" style="cursor:pointer;">${t.businessName}</td><td data-detail="${t.id}" style="cursor:pointer;">${t.email}</td><td style="text-transform:capitalize;">${t.plan}</td><td>${fmtDate(t.trialEndsAt)}</td>
        <td>${statusBadge}</td><td>${t.profilesCount}${t.maxProfiles?'/'+t.maxProfiles:''}</td>
        <td style="display:flex; gap:6px; flex-wrap:wrap;">
          <button class="btn btn-ghost btn-sm" data-license="${t.id}" data-plan="${t.plan}">Licence</button>
          <button class="btn btn-ghost btn-sm" data-reset-pw="${t.id}" data-name="${t.businessName}">Réinit. MDP</button>
          <button class="btn btn-ghost btn-sm" data-toggle-active="${t.id}" data-active="${!t.active}">${t.active?'Désactiver':'Activer'}</button>
          <button class="btn btn-danger btn-sm" data-delete-tenant="${t.id}">Suppr.</button>
        </td>
      </tr>`;
    }).join('')}</tbody></table>`}
  </div>`;
}
function renderAdminDetailModal(){
  const d = adminDetail;
  if(d==='loading') return `<div style="position:fixed; inset:0; background:rgba(0,0,0,.5); display:flex; align-items:center; justify-content:center; z-index:1000;"><div class="card">Chargement…</div></div>`;
  const t = d.tenant;
  return `<div style="position:fixed; inset:0; background:rgba(0,0,0,.5); display:flex; align-items:center; justify-content:center; z-index:1000; padding:20px;" id="detail-overlay">
    <div class="card" style="max-width:480px; text-align:left;">
      <h1 style="font-size:19px; margin-bottom:4px;">${t.businessName}</h1>
      <p class="sub" style="text-align:left; margin-bottom:16px;">${t.email}${t.phone ? ' · '+t.phone : ''}</p>
      <div class="ticket-result">
        <div class="row"><span>Lien portail</span><span class="mono">/portal/${t.slug}</span></div>
        <div class="row"><span>Plan</span><span style="text-transform:capitalize;">${t.plan}</span></div>
        <div class="row"><span>Inscrit le</span><span>${fmtDate(d.createdAt)}</span></div>
        <div class="row"><span>Essai jusqu'au</span><span>${fmtDate(t.trialEndsAt)}</span></div>
        <div class="row"><span>Statut</span><span>${t.active?'Actif':'Désactivé'}</span></div>
        <div class="row"><span>Routeur configuré</span><span>${d.router.configured ? d.router.host : 'Non'}</span></div>
        <div class="row"><span>Profils créés</span><span>${d.profilesCount}${t.maxProfiles?' / '+t.maxProfiles:''}</span></div>
        <div class="row"><span>Tickets générés</span><span>${d.ticketsTotal}</span></div>
        <div class="row"><span>Tickets vendus</span><span>${d.ticketsSold}</span></div>
        <div class="row"><span>Chiffre d'affaires</span><span>${fmtMoney(d.totalRevenue)}</span></div>
      </div>
      <button class="btn btn-ghost" id="detail-close" style="width:auto; margin-top:16px;">Fermer</button>
    </div>
  </div>`;
}
async function openAdminDetail(id){
  adminDetail = 'loading'; render();
  const r = await adminApi(`/api/admin/tenants/${id}`);
  if(r.ok){ adminDetail = r.data; render(); }
  else { adminDetail = null; toast(r.data.message || 'Erreur', 'error'); render(); }
}
function attachAdminEvents(){
  document.querySelectorAll('[data-admin-nav]').forEach(b=>b.addEventListener('click', ()=>{ ADMIN_VIEW=b.dataset.adminNav; render(); }));
  const logout = document.getElementById('admin-logout');
  if(logout) logout.addEventListener('click', ()=>{ ADMIN_SECRET=null; sessionStorage.removeItem('sidticket_admin_secret'); adminState=null; VIEW='admin-login'; render(); });
  document.querySelectorAll('[data-detail]').forEach(el=>el.addEventListener('click', ()=>openAdminDetail(el.dataset.detail)));
  const closeBtn = document.getElementById('detail-close');
  if(closeBtn) closeBtn.addEventListener('click', ()=>{ adminDetail=null; render(); });
  const overlay = document.getElementById('detail-overlay');
  if(overlay) overlay.addEventListener('click', (e)=>{ if(e.target===overlay){ adminDetail=null; render(); } });

  document.querySelectorAll('[data-toggle-active]').forEach(b=>b.addEventListener('click', async (e)=>{ e.stopPropagation();
    await adminApi(`/api/admin/tenants/${b.dataset.toggleActive}`, 'POST', { active: b.dataset.active==='true' });
    loadAdminTenants();
  }));
  document.querySelectorAll('[data-delete-tenant]').forEach(b=>b.addEventListener('click', async (e)=>{ e.stopPropagation();
    if(!confirm('Supprimer définitivement ce compte et toutes ses données ?')) return;
    await adminApi(`/api/admin/tenants/${b.dataset.deleteTenant}`, 'DELETE', {});
    loadAdminTenants();
  }));

  // Licence
  document.querySelectorAll('[data-license]').forEach(b=>b.addEventListener('click', (e)=>{ e.stopPropagation();
    const t = adminState.find(x=>x.id===b.dataset.license);
    licenseModalTenant = { id: t.id, businessName: t.businessName, plan: t.plan };
    render();
  }));
  const licenseCancel = document.getElementById('license-cancel');
  if(licenseCancel) licenseCancel.addEventListener('click', ()=>{ licenseModalTenant=null; render(); });
  document.querySelectorAll('[data-license-plan]').forEach(b=>b.addEventListener('click', ()=>{
    licenseModalTenant.plan = b.dataset.licensePlan;
    document.querySelectorAll('.license-plan-btn').forEach(x=>x.classList.toggle('active', x===b));
  }));
  const licenseSubmit = document.getElementById('license-submit');
  if(licenseSubmit) licenseSubmit.addEventListener('click', async ()=>{
    const days = document.getElementById('license-days').value;
    await adminApi(`/api/admin/tenants/${licenseModalTenant.id}`, 'POST', { plan: licenseModalTenant.plan, setDays: days });
    toast('Licence générée.');
    licenseModalTenant = null;
    loadAdminTenants();
  });
  const licenseOverlay = document.getElementById('license-overlay');
  if(licenseOverlay) licenseOverlay.addEventListener('click', (e)=>{ if(e.target===licenseOverlay){ licenseModalTenant=null; render(); } });

  // Réinitialisation mot de passe
  document.querySelectorAll('[data-reset-pw]').forEach(b=>b.addEventListener('click', async (e)=>{ e.stopPropagation();
    const t = adminState.find(x=>x.id===b.dataset.resetPw);
    if(!confirm(`Réinitialiser le mot de passe de ${t.businessName} ?`)) return;
    const r = await adminApi(`/api/admin/tenants/${b.dataset.resetPw}/reset-password`, 'POST', {});
    if(r.ok){ resetPasswordResult = { businessName: t.businessName, email: t.email, tempPassword: r.data.tempPassword }; render(); }
    else toast(r.data.message || 'Erreur', 'error');
  }));
  document.querySelectorAll('[data-resolve-reset]').forEach(b=>b.addEventListener('click', async ()=>{
    const req = adminPasswordResetsState.find(x=>x.id===b.dataset.resolveReset);
    const r = await adminApi(`/api/admin/password-reset-requests/${b.dataset.resolveReset}/resolve`, 'POST', {});
    if(r.ok){
      resetPasswordResult = { businessName: req.businessName, email: req.email, tempPassword: r.data.tempPassword };
      adminPasswordResetsState = null;
      render();
    } else toast(r.data.message || 'Erreur', 'error');
  }));
  const resetClose = document.getElementById('reset-close');
  if(resetClose) resetClose.addEventListener('click', ()=>{ resetPasswordResult=null; render(); });
  const resetCopy = document.getElementById('reset-copy');
  if(resetCopy) resetCopy.addEventListener('click', ()=>{ navigator.clipboard.writeText(resetPasswordResult.tempPassword).then(()=>toast('Copié.')); });
  const resetOverlay = document.getElementById('reset-overlay');
  if(resetOverlay) resetOverlay.addEventListener('click', (e)=>{ if(e.target===resetOverlay){ resetPasswordResult=null; render(); } });

  // Paramètres admin
  const adminPwSave = document.getElementById('admin-pw-save');
  if(adminPwSave) adminPwSave.addEventListener('click', async ()=>{
    const current = document.getElementById('admin-pw-current').value;
    const next = document.getElementById('admin-pw-new').value;
    const r = await api('/api/admin/change-password', 'POST', { current, next });
    if(r.ok){ toast('Mot de passe admin mis à jour.'); ADMIN_SECRET=next; sessionStorage.setItem('sidticket_admin_secret', next); }
    else toast(r.data.message || 'Erreur', 'error');
  });
  const upgradeSave = document.getElementById('upgrade-msg-save');
  if(upgradeSave) upgradeSave.addEventListener('click', async ()=>{
    const upgradeMessage = document.getElementById('upgrade-message').value;
    const upgradeContact = document.getElementById('upgrade-contact').value;
    const r = await adminApi('/api/admin/settings', 'POST', { upgradeMessage, upgradeContact });
    if(r.ok) toast('Message mis à jour.'); else toast(r.data.message || 'Erreur', 'error');
  });
  const paymentSettingsSave = document.getElementById('payment-settings-save');
  if(paymentSettingsSave) paymentSettingsSave.addEventListener('click', async ()=>{
    const body = {
      paymentPhone: document.getElementById('payment-phone').value.trim(),
      paymentName: document.getElementById('payment-name').value.trim(),
      subscriptionPrices: {
        '30': parseFloat(document.getElementById('price-30').value)||0,
        '90': parseFloat(document.getElementById('price-90').value)||0,
        '180': parseFloat(document.getElementById('price-180').value)||0,
        '365': parseFloat(document.getElementById('price-365').value)||0,
      },
    };
    const r = await adminApi('/api/admin/settings', 'POST', body);
    if(r.ok){ toast('Paramètres de paiement enregistrés.'); adminSettingsState=null; loadAdminSettings(); }
    else toast(r.data.message || 'Erreur', 'error');
  });
  document.querySelectorAll('[data-validate-payment]').forEach(b=>b.addEventListener('click', async ()=>{
    const r = await adminApi(`/api/admin/payment-requests/${b.dataset.validatePayment}/validate`, 'POST', {});
    if(r.ok){ toast('Licence générée et activée.'); adminPaymentsState=null; loadAdminPayments(); }
    else toast(r.data.message || 'Erreur', 'error');
  }));
  document.querySelectorAll('[data-reject-payment]').forEach(b=>b.addEventListener('click', async ()=>{
    if(!confirm('Rejeter cette demande de paiement ?')) return;
    await adminApi(`/api/admin/payment-requests/${b.dataset.rejectPayment}/reject`, 'POST', {});
    adminPaymentsState=null; loadAdminPayments();
  }));
}

boot();
