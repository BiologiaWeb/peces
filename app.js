// ═══════════════════════════════════════════════════════
//  FCB — app.js · Facultad de Ciencias Biológicas
//  Roles: admin · supervisor · operador
// ═══════════════════════════════════════════════════════

import { initializeApp }  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore,
  collection, addDoc, getDocs,
  query, orderBy, limit, where,
  doc, setDoc, updateDoc, getDoc, deleteDoc,
  serverTimestamp, increment
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ── Configuración Firebase ────────────────────────────
const firebaseConfig = {
  apiKey:            "AIzaSyBkawcfBFAugbhfs6R3lDuyDmhlhx832N8",
  authDomain:        "peces-3fa4d.firebaseapp.com",
  projectId:         "peces-3fa4d",
  storageBucket:     "peces-3fa4d.firebasestorage.app",
  messagingSenderId: "1053419003639",
  appId:             "1:1053419003639:web:ab162a748a2f187ad27df2"
};
const app = initializeApp(firebaseConfig);
const db  = getFirestore(app);

// ── Estado global ────────────────────────────────────
let session        = null;   // { uid, username, name, role }
let pondsCache     = [];
let fishCache      = [];
let currentLogRows = [];
let detailPondId   = null;
let detailPondName = null;
let detailFishId   = null;

// ── Roles ─────────────────────────────────────────────
function isAdmin()      { return session?.role === 'admin'; }
function isSupervisor() { return session?.role === 'supervisor'; }
function isOperator()   { return session?.role === 'operador'; }
function canManage()    { return isAdmin() || isSupervisor(); }  // admin + supervisor
function displayName()  { return session?.name     || 'Usuario'; }
function displayUser()  { return session?.username || '?'; }

// ── SHA-256 ───────────────────────────────────────────
async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}

// ── Sesión ────────────────────────────────────────────
function saveSession(d) { session = d; localStorage.setItem('fcb_session', JSON.stringify(d)); }
function clearSession() { session = null; localStorage.removeItem('fcb_session'); }
function loadSession()  { try { const r = localStorage.getItem('fcb_session'); return r ? JSON.parse(r) : null; } catch { return null; } }

// ── INIT ──────────────────────────────────────────────
async function init() {
  await ensureAdminExists();
  const saved = loadSession();
  if (saved?.uid) {
    try {
      const snap = await getDoc(doc(db, 'users', saved.uid));
      if (snap.exists()) { session = saved; enterApp(); return; }
    } catch { /* sin conexión — mostrar login */ }
  }
  showAuthScreen();
}

async function ensureAdminExists() {
  try {
    const snap = await getDocs(query(collection(db, 'users'), limit(1)));
    if (!snap.empty) return;
    const hash = await sha256('Administrador$26');
    await setDoc(doc(db, 'users', 'administrador'), {
      username: 'administrador', name: 'Administrador',
      role: 'admin', password: hash, createdAt: serverTimestamp()
    });
  } catch { /* sin conexión */ }
}

// ── LOGIN ─────────────────────────────────────────────
window.doLogin = async () => {
  const username = document.getElementById('login-user').value.trim().toLowerCase();
  const pass     = document.getElementById('login-pass').value;
  if (!username || !pass) { showToast('Completa usuario y contraseña', 'err'); return; }
  try {
    const snap = await getDocs(query(collection(db, 'users'), where('username', '==', username)));
    if (snap.empty) { showToast('Usuario no encontrado', 'err'); return; }
    const ud   = snap.docs[0].data();
    const hash = await sha256(pass);
    if (hash !== ud.password) { showToast('Contraseña incorrecta', 'err'); return; }
    saveSession({ uid: snap.docs[0].id, username: ud.username, name: ud.name, role: ud.role });
    enterApp();
  } catch (e) { showToast('Error: ' + e.message, 'err'); }
};

window.doLogout = () => { clearSession(); showAuthScreen(); };

// ── PANTALLAS ─────────────────────────────────────────
function showAuthScreen() {
  document.getElementById('login-user').value = '';
  document.getElementById('login-pass').value = '';
  document.getElementById('auth-screen').style.display = 'flex';
  document.getElementById('app-screen').style.display  = 'none';
}

async function enterApp() {
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('app-screen').style.display  = 'block';
  document.getElementById('user-avatar').textContent   = session.name.slice(0,2).toUpperCase();
  document.getElementById('user-name-header').textContent = session.name;

  // Tab Usuarios solo admin
  const tabUsers = document.getElementById('tab-users');
  if (tabUsers) tabUsers.style.display = isAdmin() ? 'block' : 'none';

  // Botones admin/supervisor en Estanques
  const pondBtns = document.getElementById('pond-admin-btns');
  if (pondBtns) pondBtns.style.display = canManage() ? 'flex' : 'none';

  // Botones admin/supervisor en Fauna
  const fishBtns = document.getElementById('fish-admin-btns');
  if (fishBtns) fishBtns.style.display = canManage() ? 'flex' : 'none';

  // Quitar opciones de mortalidad/nacimiento/introducción para operadores
  document.querySelectorAll('.action-sup-only').forEach(o => {
    o.style.display = canManage() ? '' : 'none';
  });

  await loadPonds();
}

// ── NAVEGACIÓN ────────────────────────────────────────
window.switchTab = (e, tab) => {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  e.currentTarget.classList.add('active');
  document.getElementById('page-' + tab).classList.add('active');
  if (tab === 'log')   loadLog();
  if (tab === 'fish')  loadFishView();
  if (tab === 'users') loadUsers();
};

// ── HELPERS GLOBALES ──────────────────────────────────
window.closeModal = id => document.getElementById(id).classList.remove('open');

window.showToast = (msg, type = 'ok') => {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = `show toast-${type}`;
  clearTimeout(t._tid);
  t._tid = setTimeout(() => { t.className = ''; }, 2800);
};

function fmtDate(ts) {
  const d = ts?.toDate?.() ?? new Date(ts);
  return d.toLocaleDateString('es-MX', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
}

function tagClass(action) {
  return ({
    'alimentación':   'tag-feed',
    'limpieza':       'tag-clean',
    'tratamiento':    'tag-treatment',
    'medicamento':    'tag-treatment',
    'cambio de agua': 'tag-water',
    'medición':       'tag-measure',
    'mortalidad':     'tag-mortality',
    'nacimiento':     'tag-birth',
    'introducción':   'tag-intro',
  })[action] || 'tag-other';
}

function catBadge(f) {
  const a = f.alevines || 0, j = f.juveniles || 0, ad = f.adultos || 0;
  const parts = [];
  if (a)  parts.push(`<span class="cat-badge cat-alevin">A:${a}</span>`);
  if (j)  parts.push(`<span class="cat-badge cat-juvenil">J:${j}</span>`);
  if (ad) parts.push(`<span class="cat-badge cat-adulto">Ad:${ad}</span>`);
  return parts.join('');
}

function totalQty(f) {
  return (f.alevines || 0) + (f.juveniles || 0) + (f.adultos || 0);
}

// Popula todos los selects de estanques
function populatePondSelects(ids) {
  (ids || ['action-pond','create-fish-pond','add-units-pond','filter-pond','filter-fish-pond']).forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const isFilter = id.startsWith('filter');
    sel.innerHTML =
      (isFilter ? '<option value="">Todos los estanques</option>' : '<option value="">— Selecciona —</option>') +
      pondsCache.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
  });
}

// Popula un select de especies por estanque
function populateFishSelect(selectId, pondId) {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  const items = pondId ? fishCache.filter(f => f.pondId === pondId) : [];
  sel.innerHTML = items.length
    ? '<option value="">— Selecciona especie —</option>' + items.map(f => `<option value="${f.id}">${f.name}</option>`).join('')
    : '<option value="">Sin especies en este estanque</option>';
}

// ── USUARIOS ──────────────────────────────────────────
window.openAddUser = () => {
  if (!isAdmin()) { showToast('Solo el administrador puede crear usuarios', 'err'); return; }
  ['new-user-name','new-user-username','new-user-pass'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('new-user-role').value = 'operador';
  document.getElementById('modal-add-user').classList.add('open');
};

window.saveUser = async () => {
  if (!isAdmin()) return;
  const name     = document.getElementById('new-user-name').value.trim();
  const username = document.getElementById('new-user-username').value.trim().toLowerCase();
  const pass     = document.getElementById('new-user-pass').value;
  const role     = document.getElementById('new-user-role').value;
  if (!name || !username || !pass) { showToast('Completa todos los campos', 'err'); return; }
  if (pass.length < 6)  { showToast('Contraseña mínimo 6 caracteres', 'err'); return; }
  if (!/^[a-z0-9_]+$/.test(username)) { showToast('Usuario: solo letras, números y _', 'err'); return; }
  const snap = await getDocs(query(collection(db, 'users'), where('username', '==', username)));
  if (!snap.empty) { showToast('Ese nombre de usuario ya existe', 'err'); return; }
  try {
    const hash = await sha256(pass);
    await addDoc(collection(db, 'users'), { username, name, role, password: hash, createdAt: serverTimestamp(), createdBy: displayUser() });
    closeModal('modal-add-user');
    showToast(`Usuario @${username} creado`);
    loadUsers();
  } catch (e) { showToast('Error: ' + e.message, 'err'); }
};

window.deleteUser = async (uid, username) => {
  if (!isAdmin()) return;
  if (uid === session.uid) { showToast('No puedes eliminar tu propio usuario', 'err'); return; }
  if (!confirm(`¿Eliminar al usuario @${username}?`)) return;
  try { await deleteDoc(doc(db, 'users', uid)); showToast(`Usuario @${username} eliminado`); loadUsers(); }
  catch (e) { showToast('Error: ' + e.message, 'err'); }
};

window.openChangePassword = (uid, username) => {
  if (!isAdmin()) return;
  document.getElementById('chpass-uid').value        = uid;
  document.getElementById('chpass-user').textContent = `@${username}`;
  document.getElementById('chpass-new').value        = '';
  document.getElementById('modal-change-pass').classList.add('open');
};

window.saveChangePassword = async () => {
  if (!isAdmin()) return;
  const uid  = document.getElementById('chpass-uid').value;
  const pass = document.getElementById('chpass-new').value;
  if (pass.length < 6) { showToast('Mínimo 6 caracteres', 'err'); return; }
  try {
    const hash = await sha256(pass);
    await updateDoc(doc(db, 'users', uid), { password: hash });
    closeModal('modal-change-pass');
    showToast('Contraseña actualizada');
  } catch (e) { showToast('Error: ' + e.message, 'err'); }
};

async function loadUsers() {
  if (!isAdmin()) return;
  const snap  = await getDocs(query(collection(db, 'users'), orderBy('createdAt', 'asc')));
  const users = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
  const roleBadge = r => ({
    admin:      `<span class="action-tag role-admin">admin</span>`,
    supervisor: `<span class="action-tag role-supervisor">supervisor</span>`,
    operador:   `<span class="action-tag role-operador">operador</span>`,
  })[r] || r;
  document.getElementById('users-tbody').innerHTML = users.map(u => `
    <tr>
      <td style="font-weight:700;color:var(--brand)">@${u.username}</td>
      <td>${u.name}</td>
      <td>${roleBadge(u.role)}</td>
      <td style="color:var(--text-lt);font-size:.75rem">${u.createdAt ? fmtDate(u.createdAt) : '—'}</td>
      <td>
        <div style="display:flex;gap:.4rem">
          <button class="btn btn-ghost btn-sm" onclick="openChangePassword('${u.uid}','${u.username}')">Contraseña</button>
          ${u.uid !== session.uid ? `<button class="btn btn-danger btn-sm" onclick="deleteUser('${u.uid}','${u.username}')">✕</button>` : ''}
        </div>
      </td>
    </tr>`).join('');
}

// ── ESTANQUES ─────────────────────────────────────────
window.openAddPond = () => {
  if (!canManage()) return;
  ['pond-name','pond-type','pond-cap','pond-notes'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('pond-edit-id').value = '';
  document.getElementById('pond-modal-title').textContent = 'Nuevo Estanque';
  document.getElementById('btn-save-pond').textContent    = 'Guardar estanque';
  document.getElementById('modal-add-pond').classList.add('open');
};

window.openEditPond = id => {
  if (!canManage()) return;
  const pond = pondsCache.find(p => p.id === id);
  if (!pond) return;
  document.getElementById('pond-edit-id').value  = id;
  document.getElementById('pond-name').value     = pond.name     || '';
  document.getElementById('pond-type').value     = pond.type     || '';
  document.getElementById('pond-cap').value      = pond.capacity || '';
  document.getElementById('pond-notes').value    = pond.notes    || '';
  document.getElementById('pond-modal-title').textContent = 'Editar Estanque';
  document.getElementById('btn-save-pond').textContent    = 'Actualizar estanque';
  document.getElementById('modal-add-pond').classList.add('open');
};

window.savePond = async () => {
  if (!canManage()) return;
  const name   = document.getElementById('pond-name').value.trim();
  const editId = document.getElementById('pond-edit-id').value;
  if (!name) { showToast('El nombre es obligatorio', 'err'); return; }
  const data = {
    name, type:     document.getElementById('pond-type').value.trim(),
    capacity: Number(document.getElementById('pond-cap').value) || 0,
    notes:    document.getElementById('pond-notes').value.trim()
  };
  try {
    if (editId) {
      await updateDoc(doc(db, 'ponds', editId), data);
      showToast('Estanque actualizado');
    } else {
      await addDoc(collection(db, 'ponds'), { ...data, createdBy: displayName(), createdByUser: displayUser(), createdAt: serverTimestamp() });
      showToast('Estanque creado');
    }
    closeModal('modal-add-pond');
    await loadPonds();
  } catch (e) { showToast('Error: ' + e.message, 'err'); }
};

window.deletePond = async (id, name) => {
  if (!canManage()) return;
  if (!confirm(`¿Eliminar el estanque "${name}"?`)) return;
  try { await deleteDoc(doc(db, 'ponds', id)); showToast(`Estanque "${name}" eliminado`); await loadPonds(); }
  catch (e) { showToast('Error: ' + e.message, 'err'); }
};

async function loadPonds() {
  try {
    const snap = await getDocs(query(collection(db, 'ponds'), orderBy('createdAt', 'asc')));
    pondsCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch { pondsCache = []; }
  renderPonds();
  populatePondSelects();
}

function renderPonds() {
  const grid = document.getElementById('pond-grid');
  if (!pondsCache.length) {
    grid.innerHTML = `<div class="empty"><div class="icon">~</div><p>No hay estanques todavía.</p></div>`;
    return;
  }
  grid.innerHTML = pondsCache.map(p => {
    const adminBtns = canManage() ? `
      <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();openEditPond('${p.id}')">Editar</button>
      <button class="btn btn-danger btn-sm" onclick="event.stopPropagation();deletePond('${p.id}','${p.name.replace(/'/g,"\\'")}')">✕ Eliminar</button>
    ` : '';
    return `
    <div class="pond-card" onclick="openPondDetail('${p.id}')">
      <div class="pond-card-accent"></div>
      <div class="pond-header">
        <div>
          <div class="pond-name">${p.name}</div>
          <div class="pond-type">${p.type || 'Sin tipo especificado'}</div>
        </div>
      </div>
      <div class="pond-body">
        <div class="stat-row"><span class="stat-label">Capacidad</span><span class="stat-value">${p.capacity ? p.capacity.toLocaleString() + ' L' : '—'}</span></div>
        ${p.notes ? `<div class="stat-row"><span class="stat-label">Notas</span><span class="stat-value">${p.notes}</span></div>` : ''}
      </div>
      ${canManage() ? `<div class="pond-footer">${adminBtns}</div>` : ''}
    </div>`;
  }).join('');
}

// ── DETALLE DE ESTANQUE ───────────────────────────────
window.openPondDetail = async pondId => {
  const pond = pondsCache.find(p => p.id === pondId);
  if (!pond) return;
  detailPondId = pondId; detailPondName = pond.name;
  document.getElementById('pond-detail-title').textContent = pond.name;
  document.getElementById('pond-detail-info').innerHTML = `
    <div class="pond-detail-meta">
      <div class="pond-detail-row"><span class="pd-label">Tipo / uso</span><span class="pd-value">${pond.type || '—'}</span></div>
      <div class="pond-detail-row"><span class="pd-label">Capacidad</span><span class="pd-value">${pond.capacity ? pond.capacity.toLocaleString() + ' L' : '—'}</span></div>
      ${pond.notes ? `<div class="pond-detail-row"><span class="pd-label">Notas</span><span class="pd-value">${pond.notes}</span></div>` : ''}
    </div>`;
  const adminDiv = document.getElementById('pond-detail-admin-btns');
  if (adminDiv) adminDiv.style.display = canManage() ? 'flex' : 'none';
  document.getElementById('pond-detail-log').innerHTML = '<p style="color:var(--text-lt);font-size:.82rem">Cargando…</p>';
  document.getElementById('modal-pond-detail').classList.add('open');
  try {
    const today = new Date(); today.setHours(0,0,0,0);
    const snap  = await getDocs(query(collection(db,'actions'), where('pondId','==',pondId)));
    const rows  = snap.docs.map(d => d.data())
      .filter(a => { const t = a.timestamp?.toDate?.() ?? new Date(a.timestamp); return t >= today; })
      .sort((a,b) => { const ta = a.timestamp?.toDate?.() ?? new Date(a.timestamp); const tb = b.timestamp?.toDate?.() ?? new Date(b.timestamp); return tb - ta; });
    if (!rows.length) {
      document.getElementById('pond-detail-log').innerHTML = '<p style="color:var(--text-lt);font-size:.82rem;padding:.5rem 0">Sin actividad hoy.</p>';
    } else {
      document.getElementById('pond-detail-log').innerHTML = rows.map(a => `
        <div class="pond-log-entry">
          <span class="action-tag ${tagClass(a.action)}">${a.action}</span>
          <span class="pond-log-time">${fmtDate(a.timestamp)}</span>
          <span class="pond-log-user">@${a.username || a.userName}</span>
          ${a.notes ? `<span class="pond-log-notes">${a.notes}</span>` : ''}
        </div>`).join('');
    }
  } catch (e) {
    document.getElementById('pond-detail-log').innerHTML = `<p style="color:var(--red);font-size:.82rem">Error: ${e.message}</p>`;
  }
};
window.openActionFromDetail = () => { closeModal('modal-pond-detail'); openRegisterAction(detailPondId); };
window.editPondFromDetail   = () => { closeModal('modal-pond-detail'); openEditPond(detailPondId); };
window.deletePondFromDetail = async () => { closeModal('modal-pond-detail'); await deletePond(detailPondId, detailPondName); };

// ── ACCIONES ─────────────────────────────────────────
window.openRegisterActionGlobal = () => openRegisterAction(null);

window.openRegisterAction = pondId => {
  document.getElementById('action-notes').value = '';
  const selGrp   = document.getElementById('action-pond-selector-group');
  const fixedGrp = document.getElementById('action-pond-fixed-group');
  const fixedName = document.getElementById('action-pond-fixed-name');

  if (pondId) {
    const pond = pondsCache.find(p => p.id === pondId);
    selGrp.style.display   = 'none';
    fixedGrp.style.display = 'block';
    fixedName.textContent  = pond ? pond.name : pondId;
    fixedName.dataset.pondId = pondId;
  } else {
    selGrp.style.display   = 'block';
    fixedGrp.style.display = 'none';
  }
  // Resetear tipo de acción al primero disponible
  const atSel = document.getElementById('action-type');
  atSel.value = 'alimentación';
  onActionTypeChange();

  // Si se abre con un estanque, precargar selects de especies
  if (pondId) {
    populateFishSelect('mort-fish',   pondId);
    populateFishSelect('birth-fish',  pondId);
    populateFishSelect('intro-fish',  pondId);
  }
  document.getElementById('modal-action').classList.add('open');
};

// Cuando cambia el estanque en el selector de acción
window.onActionPondChange = () => {
  const pondId = document.getElementById('action-pond').value;
  if (!pondId) return;
  populateFishSelect('mort-fish',  pondId);
  populateFishSelect('birth-fish', pondId);
  populateFishSelect('intro-fish', pondId);
};

// Cuando cambia el tipo de acción
window.onActionTypeChange = () => {
  const t = document.getElementById('action-type').value;
  document.getElementById('mortality-fields').style.display = t === 'mortalidad'    ? 'block' : 'none';
  document.getElementById('birth-fields').style.display     = t === 'nacimiento'    ? 'block' : 'none';
  document.getElementById('intro-fields').style.display     = t === 'introducción'  ? 'block' : 'none';
};

// Cuando cambia especie en mortalidad — mostrar disponibles
window.onMortFishChange = () => {
  const fishId = document.getElementById('mort-fish').value;
  const f = fishCache.find(x => x.id === fishId);
  if (!f) return;
  // Nada extra por ahora — la validación se hace en saveAction
};

// Tipo de intro: nueva vs existente (radio buttons)
window.onIntroTypeChange = () => {
  const checked = document.querySelector('input[name="intro-type-radio"]:checked');
  const t = checked ? checked.value : 'nueva';
  document.getElementById('intro-type').value = t;
  document.getElementById('intro-new-fields').style.display      = t === 'nueva'     ? 'block' : 'none';
  document.getElementById('intro-existing-fields').style.display = t === 'existente' ? 'block' : 'none';
};

window.saveAction = async () => {
  const selGrp = document.getElementById('action-pond-selector-group');
  const pondId = selGrp.style.display !== 'none'
    ? document.getElementById('action-pond').value
    : document.getElementById('action-pond-fixed-name').dataset.pondId;
  const action = document.getElementById('action-type').value;
  const notes  = document.getElementById('action-notes').value.trim();
  if (!pondId) { showToast('Selecciona un estanque', 'err'); return; }

  // Validaciones específicas
  if (action === 'mortalidad') {
    if (!canManage()) { showToast('Sin permiso para registrar mortalidad', 'err'); return; }
    const fishId = document.getElementById('mort-fish').value;
    const cat    = document.getElementById('mort-cat').value;
    const qty    = Number(document.getElementById('mort-qty').value);
    if (!fishId || !qty) { showToast('Completa especie y cantidad', 'err'); return; }
    const f = fishCache.find(x => x.id === fishId);
    if (!f) { showToast('Especie no encontrada', 'err'); return; }
    const available = f[cat] || 0;
    if (qty > available) { showToast(`Solo hay ${available} ${cat} disponibles`, 'err'); return; }
    // Reducir conteo
    const upd = {}; upd[cat] = increment(-qty);
    await updateDoc(doc(db, 'fish', fishId), upd);
    // Registrar acción con detalle extra
    await addDoc(collection(db, 'actions'), {
      pondId, pondName: pondsCache.find(p => p.id === pondId)?.name || '?',
      action, notes: notes || `${qty} ${cat} de ${f.name} fallecidos`,
      extra: { fishId, fishName: f.name, category: cat, qty },
      userName: displayName(), username: displayUser(), userId: session.uid, timestamp: serverTimestamp()
    });
    closeModal('modal-action');
    showToast('Mortalidad registrada');
    await loadFishView();
    return;
  }

  if (action === 'nacimiento') {
    if (!canManage()) { showToast('Sin permiso para registrar nacimientos', 'err'); return; }
    const fishId = document.getElementById('birth-fish').value;
    const qty    = Number(document.getElementById('birth-qty').value);
    if (!fishId || !qty) { showToast('Completa especie y cantidad', 'err'); return; }
    const f = fishCache.find(x => x.id === fishId);
    if (!f) { showToast('Especie no encontrada', 'err'); return; }
    await updateDoc(doc(db, 'fish', fishId), { alevines: increment(qty) });
    await addDoc(collection(db, 'actions'), {
      pondId, pondName: pondsCache.find(p => p.id === pondId)?.name || '?',
      action, notes: notes || `${qty} alevines nacidos de ${f.name}`,
      extra: { fishId, fishName: f.name, category: 'alevines', qty },
      userName: displayName(), username: displayUser(), userId: session.uid, timestamp: serverTimestamp()
    });
    closeModal('modal-action');
    showToast('Nacimiento registrado');
    await loadFishView();
    return;
  }

  if (action === 'introducción') {
    if (!canManage()) { showToast('Sin permiso para registrar introducciones', 'err'); return; }
    const introType = document.getElementById('intro-type').value;
    const pond = pondsCache.find(p => p.id === pondId);

    if (introType === 'existente') {
      const fishId = document.getElementById('intro-fish').value;
      const cat    = document.getElementById('intro-cat').value;
      const qty    = Number(document.getElementById('intro-qty-existing').value);
      if (!fishId || !qty) { showToast('Completa especie y cantidad', 'err'); return; }
      const f = fishCache.find(x => x.id === fishId);
      if (!f) { showToast('Especie no encontrada', 'err'); return; }
      const upd = {}; upd[cat] = increment(qty);
      await updateDoc(doc(db, 'fish', fishId), upd);
      await addDoc(collection(db, 'actions'), {
        pondId, pondName: pond?.name || '?',
        action, notes: notes || `Introducción de ${qty} ${cat} de ${f.name}`,
        extra: { fishId, fishName: f.name, category: cat, qty },
        userName: displayName(), username: displayUser(), userId: session.uid, timestamp: serverTimestamp()
      });
    } else {
      // especie nueva
      const name   = document.getElementById('intro-name').value.trim();
      if (!name) { showToast('El nombre común es obligatorio', 'err'); return; }
      const alevines = Number(document.getElementById('intro-qty-alevin').value) || 0;
      const juveniles = Number(document.getElementById('intro-qty-juvenil').value) || 0;
      const adultos  = Number(document.getElementById('intro-qty-adulto').value) || 0;
      // Verificar duplicado
      const dup = fishCache.find(f => f.pondId === pondId && f.name.toLowerCase() === name.toLowerCase());
      if (dup) { showToast(`Ya existe "${name}" en este estanque. Usa "especie existente".`, 'err'); return; }
      const newFishRef = await addDoc(collection(db, 'fish'), {
        pondId, pondName: pond?.name || '?', name,
        species:  document.getElementById('intro-species').value.trim(),
        notes:    document.getElementById('intro-fish-notes').value.trim(),
        alevines, juveniles, adultos,
        addedBy: displayName(), addedByUser: displayUser(), addedAt: serverTimestamp()
      });
      await addDoc(collection(db, 'actions'), {
        pondId, pondName: pond?.name || '?',
        action, notes: notes || `Nueva especie introducida: ${name} (A:${alevines} J:${juveniles} Ad:${adultos})`,
        extra: { fishId: newFishRef.id, fishName: name, alevines, juveniles, adultos },
        userName: displayName(), username: displayUser(), userId: session.uid, timestamp: serverTimestamp()
      });
    }
    closeModal('modal-action');
    showToast('Introducción registrada');
    await loadFishView();
    return;
  }

  // Acción general
  const pond = pondsCache.find(p => p.id === pondId);
  await addDoc(collection(db, 'actions'), {
    pondId, pondName: pond?.name || '?',
    action, notes,
    userName: displayName(), username: displayUser(), userId: session.uid, timestamp: serverTimestamp()
  });
  closeModal('modal-action');
  showToast('Acción registrada');
  await loadPonds();
  if (detailPondId === pondId) openPondDetail(pondId);
};

// ── BITÁCORA ─────────────────────────────────────────
window.loadLog = async () => {
  const pf       = document.getElementById('filter-pond').value;
  const af       = document.getElementById('filter-action').value;
  const dateFrom = document.getElementById('filter-date-from').value;
  const dateTo   = document.getElementById('filter-date-to').value;

  const snap = await getDocs(query(collection(db, 'actions'), orderBy('timestamp','desc'), limit(500)));
  let rows   = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  // Filtro por rol: operador solo ve lo suyo
  if (isOperator()) rows = rows.filter(r => r.userId === session.uid);

  if (pf) rows = rows.filter(r => r.pondId === pf);
  if (af) rows = rows.filter(r => r.action === af);
  if (dateFrom) {
    const from = new Date(dateFrom); from.setHours(0,0,0,0);
    rows = rows.filter(r => { const t = r.timestamp?.toDate?.() ?? new Date(r.timestamp); return t >= from; });
  }
  if (dateTo) {
    const to = new Date(dateTo); to.setHours(23,59,59,999);
    rows = rows.filter(r => { const t = r.timestamp?.toDate?.() ?? new Date(r.timestamp); return t <= to; });
  }
  currentLogRows = rows;

  const tb = document.getElementById('log-tbody');
  if (!rows.length) {
    tb.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:2.5rem;color:var(--text-lt)">Sin registros con esos filtros</td></tr>`;
    return;
  }
  tb.innerHTML = rows.map((r, i) => {
    const hasDetail = r.extra || r.notes;
    const detailId  = `log-detail-${i}`;
    const extraHtml = buildLogExtraDetail(r);
    return `
      <tr>
        <td style="width:32px;text-align:center">
          ${hasDetail ? `<button class="log-expand-btn" onclick="toggleLogDetail('${detailId}')">▶</button>` : ''}
        </td>
        <td style="color:var(--text-lt);font-family:var(--ff-mono);font-size:.72rem;white-space:nowrap">${r.timestamp ? fmtDate(r.timestamp) : '—'}</td>
        <td style="font-weight:700">${r.pondName}</td>
        <td><span class="action-tag ${tagClass(r.action)}">${r.action}</span></td>
        <td style="color:var(--text-md);max-width:200px;font-size:.78rem">${r.notes || '—'}</td>
        <td style="font-weight:700;color:var(--brand)">@${r.username || r.userName}</td>
      </tr>
      ${hasDetail ? `<tr id="${detailId}" class="log-detail-row" style="display:none"><td colspan="6">${extraHtml}</td></tr>` : ''}
    `;
  }).join('');
};

function buildLogExtraDetail(r) {
  const parts = [];
  if (r.notes) parts.push(`<strong>Notas:</strong> ${r.notes}`);
  if (r.extra) {
    const e = r.extra;
    if (e.fishName) parts.push(`<strong>Especie:</strong> ${e.fishName}`);
    if (e.category) parts.push(`<strong>Categoría:</strong> ${e.category}`);
    if (e.qty != null) parts.push(`<strong>Cantidad:</strong> ${e.qty}`);
    if (e.alevines != null) parts.push(`Alevines: ${e.alevines}  Juveniles: ${e.juveniles}  Adultos: ${e.adultos}`);
  }
  return parts.join(' &nbsp;·&nbsp; ');
}

window.toggleLogDetail = id => {
  const row = document.getElementById(id);
  const btn = row.previousElementSibling.querySelector('.log-expand-btn');
  if (!row) return;
  const hidden = row.style.display === 'none';
  row.style.display = hidden ? 'table-row' : 'none';
  if (btn) btn.textContent = hidden ? '▼' : '▶';
};

window.downloadLogCSV = () => {
  if (!currentLogRows.length) { showToast('No hay registros', 'err'); return; }
  const esc = v => `"${String(v ?? '').replace(/"/g,'""')}"`;

  // Builds a plain-text detail string for the CSV (no HTML)
  const buildCsvDetail = r => {
    const parts = [];
    if (r.notes) parts.push(`Notas: ${r.notes}`);
    if (r.extra) {
      const e = r.extra;
      if (e.fishName)  parts.push(`Especie: ${e.fishName}`);
      if (e.category)  parts.push(`Categoría: ${e.category}`);
      if (e.qty != null) parts.push(`Cantidad: ${e.qty}`);
      if (e.alevines != null)
        parts.push(`Alevines: ${e.alevines}  Juveniles: ${e.juveniles}  Adultos: ${e.adultos}`);
    }
    return parts.join(' · ');
  };

  const lines = [
    ['Fecha/Hora','Estanque','Acción','Detalle completo','Responsable'].map(esc).join(','),
    ...currentLogRows.map(r => [
      r.timestamp ? fmtDate(r.timestamp) : '',
      r.pondName  || '',
      r.action    || '',
      buildCsvDetail(r),
      `@${r.username || r.userName || ''}`
    ].map(esc).join(','))
  ];
  const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), { href: url, download: `bitacora_fcb_${new Date().toISOString().slice(0,10)}.csv` });
  a.click(); URL.revokeObjectURL(url);
  showToast('CSV descargado');
};

// ── FAUNA ─────────────────────────────────────────────

// CREAR ESPECIE (nueva, con cantidades por categoría)
window.openCreateFish = () => {
  if (!canManage()) return;
  ['create-fish-name','create-fish-species','create-fish-notes'].forEach(id => document.getElementById(id).value = '');
  ['create-fish-alevin','create-fish-juvenil','create-fish-adulto'].forEach(id => document.getElementById(id).value = '0');
  document.getElementById('create-fish-edit-id').value = '';
  document.getElementById('create-fish-title').textContent  = 'Crear Especie';
  document.getElementById('btn-save-create-fish').textContent = 'Guardar especie';
  // Pre-seleccionar estanque si hay filtro activo
  const filterPondId = document.getElementById('filter-fish-pond').value;
  setTimeout(() => {
    const s = document.getElementById('create-fish-pond');
    if (filterPondId) {
      for (let i = 0; i < s.options.length; i++) {
        if (s.options[i].value === filterPondId) { s.selectedIndex = i; break; }
      }
    }
  }, 30);
  document.getElementById('modal-create-fish').classList.add('open');
};

window.saveCreateFish = async () => {
  if (!canManage()) return;
  const pondId  = document.getElementById('create-fish-pond').value;
  const name    = document.getElementById('create-fish-name').value.trim();
  const editId  = document.getElementById('create-fish-edit-id').value;
  if (!pondId || !name) { showToast('Estanque y nombre son obligatorios', 'err'); return; }

  // Verificar duplicado (nombre en mismo estanque)
  if (!editId) {
    const dup = fishCache.find(f => f.pondId === pondId && f.name.toLowerCase() === name.toLowerCase());
    if (dup) { showToast(`Ya existe "${name}" en este estanque`, 'err'); return; }
  }

  const pond     = pondsCache.find(p => p.id === pondId);
  const alevines = Number(document.getElementById('create-fish-alevin').value) || 0;
  const juveniles = Number(document.getElementById('create-fish-juvenil').value) || 0;
  const adultos  = Number(document.getElementById('create-fish-adulto').value) || 0;
  const data = {
    pondId, pondName: pond?.name || '?', name,
    species: document.getElementById('create-fish-species').value.trim(),
    notes:   document.getElementById('create-fish-notes').value.trim(),
    alevines, juveniles, adultos
  };
  try {
    if (editId) {
      await updateDoc(doc(db, 'fish', editId), data);
      showToast('Especie actualizada');
    } else {
      await addDoc(collection(db, 'fish'), { ...data, addedBy: displayName(), addedByUser: displayUser(), addedAt: serverTimestamp() });
      showToast('Especie creada');
    }
    closeModal('modal-create-fish');
    await loadFishView();
  } catch (e) { showToast('Error: ' + e.message, 'err'); }
};

// AGREGAR FAUNA (sumar unidades a especie existente)
window.openAddUnitsFish = () => {
  if (!canManage()) return;
  document.getElementById('add-units-fish').innerHTML = '<option value="">— Selecciona estanque primero —</option>';
  document.getElementById('add-units-cats').style.display = 'none';
  ['add-units-alevin','add-units-juvenil','add-units-adulto'].forEach(id => document.getElementById(id).value = '0');
  // Pre-seleccionar estanque según filtro
  const filterPondId = document.getElementById('filter-fish-pond').value;
  setTimeout(() => {
    const s = document.getElementById('add-units-pond');
    if (filterPondId) {
      for (let i = 0; i < s.options.length; i++) {
        if (s.options[i].value === filterPondId) { s.selectedIndex = i; onAddUnitsPondChange(); break; }
      }
    }
  }, 30);
  document.getElementById('modal-add-units-fish').classList.add('open');
};

window.onAddUnitsPondChange = () => {
  const pondId = document.getElementById('add-units-pond').value;
  populateFishSelect('add-units-fish', pondId);
  document.getElementById('add-units-cats').style.display = 'none';
};

window.onAddUnitsFishChange = () => {
  const fishId = document.getElementById('add-units-fish').value;
  const f = fishCache.find(x => x.id === fishId);
  if (!f) { document.getElementById('add-units-cats').style.display = 'none'; return; }
  document.getElementById('add-units-cats').style.display = 'block';
  document.getElementById('add-units-current').textContent =
    `Conteo actual — Alevines: ${f.alevines||0}  Juveniles: ${f.juveniles||0}  Adultos: ${f.adultos||0}  Total: ${totalQty(f)}`;
};

window.saveAddUnitsFish = async () => {
  if (!canManage()) return;
  const fishId   = document.getElementById('add-units-fish').value;
  const alevines = Number(document.getElementById('add-units-alevin').value) || 0;
  const juveniles = Number(document.getElementById('add-units-juvenil').value) || 0;
  const adultos  = Number(document.getElementById('add-units-adulto').value) || 0;
  if (!fishId) { showToast('Selecciona una especie', 'err'); return; }
  if (!alevines && !juveniles && !adultos) { showToast('Ingresa al menos una cantidad', 'err'); return; }
  try {
    await updateDoc(doc(db, 'fish', fishId), {
      alevines:  increment(alevines),
      juveniles: increment(juveniles),
      adultos:   increment(adultos)
    });
    closeModal('modal-add-units-fish');
    showToast('Fauna actualizada');
    await loadFishView();
  } catch (e) { showToast('Error: ' + e.message, 'err'); }
};

// EDITAR especie (desde detalle)
window.openEditFish = () => {
  if (!canManage() || !detailFishId) return;
  closeModal('modal-fish-detail');
  getDoc(doc(db, 'fish', detailFishId)).then(snap => {
    if (!snap.exists()) { showToast('Fauna no encontrada', 'err'); return; }
    const f = snap.data();
    document.getElementById('create-fish-edit-id').value  = detailFishId;
    document.getElementById('create-fish-name').value     = f.name    || '';
    document.getElementById('create-fish-species').value  = f.species || '';
    document.getElementById('create-fish-notes').value    = f.notes   || '';
    document.getElementById('create-fish-alevin').value   = f.alevines  || 0;
    document.getElementById('create-fish-juvenil').value  = f.juveniles || 0;
    document.getElementById('create-fish-adulto').value   = f.adultos   || 0;
    document.getElementById('create-fish-title').textContent       = 'Editar Especie';
    document.getElementById('btn-save-create-fish').textContent    = 'Actualizar especie';
    setTimeout(() => {
      const s = document.getElementById('create-fish-pond');
      for (let i = 0; i < s.options.length; i++) {
        if (s.options[i].value === f.pondId) { s.selectedIndex = i; break; }
      }
    }, 30);
    document.getElementById('modal-create-fish').classList.add('open');
  });
};

window.deleteFishFromDetail = async () => {
  if (!canManage() || !detailFishId) return;
  if (!confirm('¿Eliminar esta especie?')) return;
  try {
    await deleteDoc(doc(db, 'fish', detailFishId));
    showToast('Especie eliminada');
    closeModal('modal-fish-detail');
    await loadFishView();
  } catch (e) { showToast('Error: ' + e.message, 'err'); }
};

// DETALLE de fauna
window.openFishDetail = fishId => {
  const f = fishCache.find(x => x.id === fishId);
  if (!f) return;
  detailFishId = fishId;
  const total = totalQty(f);
  document.getElementById('fish-detail-body').innerHTML = `
    <div class="fish-detail-wrap">
      <div class="fish-detail-name">${f.name}</div>
      <div class="fish-detail-species">${f.species || 'Especie no especificada'}</div>
      <div class="fish-cats-detail">
        <div class="cat-detail-item cat-alevin"><div class="num">${f.alevines||0}</div><div class="lbl">Alevines</div></div>
        <div class="cat-detail-item cat-juvenil"><div class="num">${f.juveniles||0}</div><div class="lbl">Juveniles</div></div>
        <div class="cat-detail-item cat-adulto"><div class="num">${f.adultos||0}</div><div class="lbl">Adultos</div></div>
        <div class="cat-detail-item" style="background:var(--bg-main);border:1px solid var(--border)"><div class="num">${total}</div><div class="lbl">Total</div></div>
      </div>
      <div class="fish-detail-grid" style="margin-top:1rem">
        <div class="fd-row"><span class="fd-label">Estanque</span><span class="fd-value">${f.pondName}</span></div>
        ${f.notes ? `<div class="fd-row"><span class="fd-label">Notas</span><span class="fd-value">${f.notes}</span></div>` : ''}
        <div class="fd-row"><span class="fd-label">Registrado por</span><span class="fd-value">@${f.addedByUser||f.addedBy||'—'}</span></div>
        ${f.addedAt ? `<div class="fd-row"><span class="fd-label">Fecha</span><span class="fd-value">${fmtDate(f.addedAt)}</span></div>` : ''}
      </div>
    </div>`;
  const adminBtns = document.getElementById('fish-detail-admin-btns');
  if (adminBtns) adminBtns.style.display = canManage() ? 'flex' : 'none';
  document.getElementById('modal-fish-detail').classList.add('open');
};

// LISTA de fauna
window.loadFishView = async () => {
  const pf   = document.getElementById('filter-fish-pond').value;
  const snap = await getDocs(collection(db, 'fish'));
  fishCache  = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  let items  = pf ? fishCache.filter(f => f.pondId === pf) : fishCache;
  const c    = document.getElementById('fish-list');
  if (!items.length) {
    c.innerHTML = `<div class="empty"><div class="icon">·</div><p>No hay fauna registrada todavía.</p></div>`;
    return;
  }
  // Re-populate species selects para acciones
  const currentPondId = pf || null;
  populateFishSelect('mort-fish',  currentPondId || '');
  populateFishSelect('birth-fish', currentPondId || '');
  populateFishSelect('intro-fish', currentPondId || '');

  c.innerHTML = items.map(f => {
    const total = totalQty(f);
    return `
    <div class="fish-row" onclick="openFishDetail('${f.id}')">
      <div class="fish-info">
        <div class="fname">${f.name} <span style="color:var(--text-lt);font-size:.72rem;font-weight:600">· ${f.pondName}</span></div>
        <div class="fspec">${f.species || 'Especie no especificada'}</div>
        <div class="fish-cats">${catBadge(f)}</div>
      </div>
      <div class="fish-qty">${total.toLocaleString()}</div>
    </div>`;
  }).join('');
};

// ── CERRAR MODALES AL HACER CLIC EN FONDO ─────────────
document.querySelectorAll('.modal-bg').forEach(bg =>
  bg.addEventListener('click', e => { if (e.target === bg) bg.classList.remove('open'); })
);

// ── ARRANCAR ──────────────────────────────────────────
init();
