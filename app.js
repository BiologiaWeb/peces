// ═══════════════════════════════════════════════════════
//  FCB — app.js  (Facultad de Ciencias Biológicas)
//  Login: usuario + contraseña hasheada en Firestore
//  El administrador crea y gestiona usuarios
// ═══════════════════════════════════════════════════════

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore,
  collection, addDoc, getDocs,
  query, orderBy, limit, where,
  doc, setDoc, updateDoc, getDoc, deleteDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ⚠️  Configuración Firebase — reemplaza si cambias proyecto
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

let session    = null;   // { uid, username, name, role }
let pondsCache = [];

// ─── estado para modal de detalle de estanque ───
let detailPondId   = null;
let detailPondName = null;

// ─── estado para detalle de fauna ───
let detailFishId   = null;

// ─────────────────────────────────────────────
//  SHA-256
// ─────────────────────────────────────────────
async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ─────────────────────────────────────────────
//  SESIÓN
// ─────────────────────────────────────────────
function saveSession(data) {
  session = data;
  localStorage.setItem('fcb_session', JSON.stringify(data));
}
function clearSession() {
  session = null;
  localStorage.removeItem('fcb_session');
}
function loadSession() {
  try {
    const raw = localStorage.getItem('fcb_session');
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

// ─────────────────────────────────────────────
//  INIT
// ─────────────────────────────────────────────
async function init() {
  await ensureAdminExists();
  const saved = loadSession();
  if (saved?.uid) {
    try {
      const snap = await getDoc(doc(db, 'users', saved.uid));
      if (snap.exists()) {
        session = saved;
        enterApp();
        return;
      }
    } catch { /* continuar a login */ }
  }
  showAuthScreen();
}

// Crea el admin inicial con usuario "administrador" y contraseña "Administrador$26"
async function ensureAdminExists() {
  try {
    const snap = await getDocs(query(collection(db, 'users'), limit(1)));
    if (!snap.empty) return;
    const hash = await sha256('Administrador$26');
    await setDoc(doc(db, 'users', 'administrador'), {
      username:  'administrador',
      name:      'Administrador',
      role:      'admin',
      password:  hash,
      createdAt: serverTimestamp()
    });
  } catch { /* sin conexión, se reintentará */ }
}

// ─────────────────────────────────────────────
//  LOGIN
// ─────────────────────────────────────────────
window.doLogin = async () => {
  const username = document.getElementById('login-user').value.trim().toLowerCase();
  const pass     = document.getElementById('login-pass').value;
  if (!username || !pass) { showToast('Completa usuario y contraseña', 'err'); return; }
  try {
    const q    = query(collection(db, 'users'), where('username', '==', username));
    const snap = await getDocs(q);
    if (snap.empty) { showToast('Usuario no encontrado', 'err'); return; }
    const userDoc  = snap.docs[0];
    const userData = userDoc.data();
    const hash     = await sha256(pass);
    if (hash !== userData.password) { showToast('Contraseña incorrecta', 'err'); return; }
    saveSession({ uid: userDoc.id, username: userData.username, name: userData.name, role: userData.role });
    enterApp();
  } catch (e) { showToast('Error al conectar: ' + e.message, 'err'); }
};

window.doLogout = () => {
  clearSession();
  showAuthScreen();
};

// ─────────────────────────────────────────────
//  PANTALLAS
// ─────────────────────────────────────────────
function showAuthScreen() {
  document.getElementById('login-user').value = '';
  document.getElementById('login-pass').value = '';
  document.getElementById('auth-screen').style.display = 'flex';
  document.getElementById('app-screen').style.display  = 'none';
}

async function enterApp() {
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('app-screen').style.display  = 'block';
  document.getElementById('user-avatar').textContent   = session.name.slice(0, 2).toUpperCase();
  document.getElementById('user-name-header').textContent = `${session.name} · @${session.username}`;

  // Tab de usuarios solo admin
  const usersTab = document.getElementById('tab-users');
  if (usersTab) usersTab.style.display = isAdmin() ? 'block' : 'none';

  // Botones admin en Estanques
  const pondAdminBtns = document.getElementById('pond-admin-btns');
  if (pondAdminBtns) pondAdminBtns.style.display = isAdmin() ? 'flex' : 'none';

  // Botón agregar fauna
  const btnAddFish = document.getElementById('btn-add-fish');
  if (btnAddFish) btnAddFish.style.display = isAdmin() ? 'inline-flex' : 'none';

  await loadPonds();
}

// ─────────────────────────────────────────────
//  NAVEGACIÓN
// ─────────────────────────────────────────────
window.switchTab = (e, tab) => {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  e.currentTarget.classList.add('active');
  document.getElementById('page-' + tab).classList.add('active');
  if (tab === 'log')   loadLog();
  if (tab === 'fish')  loadFishView();
  if (tab === 'users') loadUsers();
};

// ─────────────────────────────────────────────
//  HELPERS GLOBALES
// ─────────────────────────────────────────────
window.closeModal = id => document.getElementById(id).classList.remove('open');

window.showToast = (msg, type = 'ok') => {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `show toast-${type}`;
  clearTimeout(t._tid);
  t._tid = setTimeout(() => { t.className = ''; }, 2800);
};

function fmtDate(ts) {
  const d = ts?.toDate?.() ?? new Date(ts);
  return d.toLocaleDateString('es-MX', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

function tagClass(action) {
  return ({
    'alimentación':   'tag-feed',
    'limpieza':       'tag-clean',
    'medicamento':    'tag-medicine',
    'cambio de agua': 'tag-water',
    'medición':       'tag-measure'
  })[action] || 'tag-other';
}

function displayName()     { return session?.name     || 'Usuario'; }
function displayUsername() { return session?.username || '?'; }
function isAdmin()         { return session?.role === 'admin'; }

// ─────────────────────────────────────────────
//  GESTIÓN DE USUARIOS (solo admin)
// ─────────────────────────────────────────────
window.openAddUser = () => {
  if (!isAdmin()) { showToast('Solo el administrador puede crear usuarios', 'err'); return; }
  ['new-user-name', 'new-user-username', 'new-user-pass'].forEach(id => document.getElementById(id).value = '');
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
  if (pass.length < 6)             { showToast('La contraseña debe tener al menos 6 caracteres', 'err'); return; }
  if (!/^[a-z0-9_]+$/.test(username)) { showToast('Usuario solo puede tener letras, números y guión bajo', 'err'); return; }
  const q    = query(collection(db, 'users'), where('username', '==', username));
  const snap = await getDocs(q);
  if (!snap.empty) { showToast('Ese nombre de usuario ya existe', 'err'); return; }
  try {
    const hash = await sha256(pass);
    await addDoc(collection(db, 'users'), {
      username, name, role, password: hash,
      createdAt: serverTimestamp(),
      createdBy: displayUsername()
    });
    closeModal('modal-add-user');
    showToast(`✓ Usuario @${username} creado`);
    loadUsers();
  } catch (e) { showToast('Error: ' + e.message, 'err'); }
};

window.deleteUser = async (uid, username) => {
  if (!isAdmin()) return;
  if (uid === session.uid) { showToast('No puedes eliminar tu propio usuario', 'err'); return; }
  if (!confirm(`¿Eliminar al usuario @${username}?`)) return;
  try {
    await deleteDoc(doc(db, 'users', uid));
    showToast(`Usuario @${username} eliminado`);
    loadUsers();
  } catch (e) { showToast('Error: ' + e.message, 'err'); }
};

window.openChangePassword = (uid, username) => {
  if (!isAdmin()) return;
  document.getElementById('chpass-uid').value       = uid;
  document.getElementById('chpass-user').textContent = `@${username}`;
  document.getElementById('chpass-new').value       = '';
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
    showToast('✓ Contraseña actualizada');
  } catch (e) { showToast('Error: ' + e.message, 'err'); }
};

async function loadUsers() {
  if (!isAdmin()) return;
  const snap  = await getDocs(query(collection(db, 'users'), orderBy('createdAt', 'asc')));
  const users = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
  const roleBadge = r => ({
    admin:      '<span class="action-tag tag-measure">admin</span>',
    supervisor: '<span class="action-tag tag-clean">supervisor</span>',
    operador:   '<span class="action-tag tag-feed">operador</span>'
  })[r] || r;
  document.getElementById('users-tbody').innerHTML = users.map(u => `
    <tr>
      <td style="font-weight:700;color:var(--teal-dk)">@${u.username}</td>
      <td>${u.name}</td>
      <td>${roleBadge(u.role)}</td>
      <td style="color:var(--text-lt);font-size:.75rem">${u.createdAt ? fmtDate(u.createdAt) : '—'}</td>
      <td>
        <div style="display:flex;gap:.4rem">
          <button class="btn btn-ghost btn-sm" onclick="openChangePassword('${u.uid}','${u.username}')">🔑 Contraseña</button>
          ${u.uid !== session.uid ? `<button class="btn btn-sm" style="background:#fee2e2;color:#dc2626;border:none" onclick="deleteUser('${u.uid}','${u.username}')">✕</button>` : ''}
        </div>
      </td>
    </tr>`).join('');
}

// ─────────────────────────────────────────────
//  ESTANQUES
// ─────────────────────────────────────────────
window.openAddPond = () => {
  if (!isAdmin()) return;
  ['pond-name', 'pond-type', 'pond-cap', 'pond-notes'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('pond-edit-id').value = '';
  document.querySelector('#modal-add-pond .modal-title').textContent = '🌊 Nuevo Estanque';
  document.getElementById('btn-save-pond').textContent = 'Guardar estanque';
  document.getElementById('modal-add-pond').classList.add('open');
};

window.openEditPond = (id) => {
  if (!isAdmin()) return;
  const pond = pondsCache.find(p => p.id === id);
  if (!pond) return;
  document.getElementById('pond-edit-id').value  = id;
  document.getElementById('pond-name').value     = pond.name || '';
  document.getElementById('pond-type').value     = pond.type || '';
  document.getElementById('pond-cap').value      = pond.capacity || '';
  document.getElementById('pond-notes').value    = pond.notes || '';
  document.querySelector('#modal-add-pond .modal-title').textContent = '✏ Editar Estanque';
  document.getElementById('btn-save-pond').textContent = 'Actualizar estanque';
  document.getElementById('modal-add-pond').classList.add('open');
};

window.savePond = async () => {
  if (!isAdmin()) return;
  const name   = document.getElementById('pond-name').value.trim();
  const editId = document.getElementById('pond-edit-id').value;
  if (!name) { showToast('El nombre es obligatorio', 'err'); return; }
  const data = {
    name,
    type:     document.getElementById('pond-type').value.trim(),
    capacity: Number(document.getElementById('pond-cap').value) || 0,
    notes:    document.getElementById('pond-notes').value.trim()
  };
  try {
    if (editId) {
      await updateDoc(doc(db, 'ponds', editId), data);
      showToast('✓ Estanque actualizado');
    } else {
      await addDoc(collection(db, 'ponds'), {
        ...data,
        createdBy:     displayName(),
        createdByUser: displayUsername(),
        createdAt:     serverTimestamp(),
        lastFed:       null,
        lastFedBy:     null
      });
      showToast('✓ Estanque creado');
    }
    closeModal('modal-add-pond');
    await loadPonds();
  } catch (e) { showToast('Error: ' + e.message, 'err'); }
};

window.deletePond = async (id, name) => {
  if (!isAdmin()) return;
  if (!confirm(`¿Eliminar el estanque "${name}"? Esta acción no se puede deshacer.`)) return;
  try {
    await deleteDoc(doc(db, 'ponds', id));
    showToast(`Estanque "${name}" eliminado`);
    await loadPonds();
  } catch (e) { showToast('Error: ' + e.message, 'err'); }
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
    grid.innerHTML = `<div class="empty"><div class="icon">🌊</div><p>No hay estanques todavía.${isAdmin() ? '<br>Crea el primero.' : ''}</p></div>`;
    return;
  }
  grid.innerHTML = pondsCache.map(p => {
    const adminBtns = isAdmin() ? `
      <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();openEditPond('${p.id}')">✏ Editar</button>
      <button class="btn btn-sm" style="background:#fee2e2;color:#dc2626;border:none" onclick="event.stopPropagation();deletePond('${p.id}','${p.name.replace(/'/g,"\\'")}')">✕</button>
    ` : '';
    return `
    <div class="pond-card" onclick="openPondDetail('${p.id}')" style="cursor:pointer">
      <div class="pond-card-accent"></div>
      <div class="pond-header">
        <div>
          <div class="pond-name">${p.name}</div>
          <div class="pond-type">${p.type || 'Sin tipo especificado'}</div>
        </div>
      </div>
      <div class="pond-body">
        <div class="stat-row">
          <span class="stat-label">Capacidad</span>
          <span class="stat-value">${p.capacity ? p.capacity.toLocaleString() + ' L' : '—'}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Notas</span>
          <span class="stat-value">${p.notes || '—'}</span>
        </div>
      </div>
      ${isAdmin() ? `<div class="pond-footer" style="display:flex;gap:.4rem;flex-wrap:wrap">${adminBtns}</div>` : ''}
    </div>`;
  }).join('');
}

// ─────────────────────────────────────────────
//  DETALLE DE ESTANQUE (modal con bitácora)
// ─────────────────────────────────────────────
window.openPondDetail = async (pondId) => {
  const pond = pondsCache.find(p => p.id === pondId);
  if (!pond) return;
  detailPondId   = pondId;
  detailPondName = pond.name;

  document.getElementById('pond-detail-title').textContent = `🌊 ${pond.name}`;
  document.getElementById('pond-detail-info').innerHTML = `
    <div class="pond-detail-meta">
      <div class="pond-detail-row"><span class="pd-label">Tipo / uso</span><span class="pd-value">${pond.type || '—'}</span></div>
      <div class="pond-detail-row"><span class="pd-label">Capacidad</span><span class="pd-value">${pond.capacity ? pond.capacity.toLocaleString() + ' L' : '—'}</span></div>
      <div class="pond-detail-row"><span class="pd-label">Notas</span><span class="pd-value">${pond.notes || '—'}</span></div>
      <div class="pond-detail-row"><span class="pd-label">Creado por</span><span class="pd-value">${pond.createdBy || '—'}</span></div>
    </div>`;

  // Botones admin dentro del detalle
  const adminBtnsDiv = document.getElementById('pond-detail-admin-btns');
  if (adminBtnsDiv) adminBtnsDiv.style.display = isAdmin() ? 'flex' : 'none';

  // Cargar bitácora del día
  document.getElementById('pond-detail-log').innerHTML = '<p style="color:var(--text-lt);font-size:.82rem">Cargando…</p>';
  document.getElementById('modal-pond-detail').classList.add('open');

  try {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const snap  = await getDocs(query(
      collection(db, 'actions'),
      where('pondId', '==', pondId),
      orderBy('timestamp', 'desc')
    ));
    const todayActions = snap.docs
      .map(d => d.data())
      .filter(a => {
        const t = a.timestamp?.toDate?.() ?? new Date(a.timestamp);
        return t >= today;
      });

    if (!todayActions.length) {
      document.getElementById('pond-detail-log').innerHTML =
        '<p style="color:var(--text-lt);font-size:.82rem;padding:.5rem 0">Sin actividad registrada hoy.</p>';
    } else {
      document.getElementById('pond-detail-log').innerHTML = todayActions.map(a => `
        <div class="pond-log-entry">
          <span class="action-tag ${tagClass(a.action)}">${a.action}</span>
          <span class="pond-log-time">${fmtDate(a.timestamp)}</span>
          <span class="pond-log-user">@${a.username || a.userName}</span>
          ${a.notes ? `<span class="pond-log-notes">${a.notes}</span>` : ''}
        </div>`).join('');
    }
  } catch (e) {
    document.getElementById('pond-detail-log').innerHTML =
      `<p style="color:#dc2626;font-size:.82rem">Error al cargar: ${e.message}</p>`;
  }
};

window.openActionFromDetail = () => {
  closeModal('modal-pond-detail');
  openRegisterAction(detailPondId);
};

window.editPondFromDetail = () => {
  closeModal('modal-pond-detail');
  openEditPond(detailPondId);
};

window.deletePondFromDetail = async () => {
  closeModal('modal-pond-detail');
  await deletePond(detailPondId, detailPondName);
};

// ─────────────────────────────────────────────
//  ACCIONES
// ─────────────────────────────────────────────

// Abre el modal de acción desde el botón global (con selector de estanque)
window.openRegisterActionGlobal = () => {
  openRegisterAction(null);
};

// Abre el modal de acción con estanque fijo o con selector
window.openRegisterAction = (pondId) => {
  document.getElementById('action-notes').value = '';
  const selectorGroup = document.getElementById('action-pond-selector-group');
  const fixedGroup    = document.getElementById('action-pond-fixed-group');
  const fixedName     = document.getElementById('action-pond-fixed-name');

  if (pondId) {
    const pond = pondsCache.find(p => p.id === pondId);
    selectorGroup.style.display = 'none';
    fixedGroup.style.display    = 'block';
    fixedName.textContent       = pond ? pond.name : pondId;
    // Guardamos el id en un data attr para saveAction
    fixedName.dataset.pondId = pondId;
  } else {
    selectorGroup.style.display = 'block';
    fixedGroup.style.display    = 'none';
    // Aseguramos que el select tenga opciones
    const s = document.getElementById('action-pond');
    if (s.options.length <= 1) populatePondSelects();
  }
  document.getElementById('modal-action').classList.add('open');
};

window.saveAction = async () => {
  const selectorGroup = document.getElementById('action-pond-selector-group');
  let pondId;
  if (selectorGroup.style.display !== 'none') {
    pondId = document.getElementById('action-pond').value;
  } else {
    pondId = document.getElementById('action-pond-fixed-name').dataset.pondId;
  }
  const action = document.getElementById('action-type').value;
  const notes  = document.getElementById('action-notes').value.trim();
  if (!pondId) { showToast('Selecciona un estanque', 'err'); return; }
  const pond = pondsCache.find(p => p.id === pondId);
  try {
    await addDoc(collection(db, 'actions'), {
      pondId, pondName: pond?.name || '?',
      action, notes,
      userName:  displayName(),
      username:  displayUsername(),
      userId:    session.uid,
      timestamp: serverTimestamp()
    });
    closeModal('modal-action');
    showToast('✓ Acción registrada');
    await loadPonds();
    // Si el detalle estaba abierto, refrescar bitácora
    if (detailPondId === pondId) openPondDetail(pondId);
  } catch (e) { showToast('Error: ' + e.message, 'err'); }
};

// ─────────────────────────────────────────────
//  BITÁCORA
// ─────────────────────────────────────────────
let currentLogRows = [];  // filas visibles (con filtros aplicados)

window.loadLog = async () => {
  const pf       = document.getElementById('filter-pond').value;
  const af       = document.getElementById('filter-action').value;
  const dateFrom = document.getElementById('filter-date-from').value;
  const dateTo   = document.getElementById('filter-date-to').value;

  const snap = await getDocs(query(collection(db, 'actions'), orderBy('timestamp', 'desc'), limit(500)));
  let rows   = snap.docs.map(d => d.data());

  if (pf) rows = rows.filter(r => r.pondId === pf);
  if (af) rows = rows.filter(r => r.action === af);
  if (dateFrom) {
    const from = new Date(dateFrom); from.setHours(0, 0, 0, 0);
    rows = rows.filter(r => {
      const t = r.timestamp?.toDate?.() ?? new Date(r.timestamp);
      return t >= from;
    });
  }
  if (dateTo) {
    const to = new Date(dateTo); to.setHours(23, 59, 59, 999);
    rows = rows.filter(r => {
      const t = r.timestamp?.toDate?.() ?? new Date(r.timestamp);
      return t <= to;
    });
  }

  currentLogRows = rows;

  const tb = document.getElementById('log-tbody');
  if (!rows.length) {
    tb.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:2.5rem;color:var(--text-lt)">Sin registros con esos filtros</td></tr>`;
    return;
  }
  tb.innerHTML = rows.map(r => `
    <tr>
      <td style="color:var(--text-lt);font-family:var(--fm);font-size:.75rem">${r.timestamp ? fmtDate(r.timestamp) : '—'}</td>
      <td style="font-weight:700">${r.pondName}</td>
      <td><span class="action-tag ${tagClass(r.action)}">${r.action}</span></td>
      <td style="color:var(--text-md);max-width:240px;font-size:.78rem">${r.notes || '—'}</td>
      <td style="font-weight:700;color:var(--teal-dk)">@${r.username || r.userName}</td>
    </tr>`).join('');
};

window.downloadLogCSV = () => {
  if (!currentLogRows.length) { showToast('No hay registros para descargar', 'err'); return; }
  const headers = ['Fecha/Hora', 'Estanque', 'Acción', 'Detalle', 'Responsable'];
  const escape  = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines   = [
    headers.map(escape).join(','),
    ...currentLogRows.map(r => [
      r.timestamp ? fmtDate(r.timestamp) : '',
      r.pondName  || '',
      r.action    || '',
      r.notes     || '',
      `@${r.username || r.userName || ''}`
    ].map(escape).join(','))
  ];
  const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `bitacora_fcb_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('✓ CSV descargado');
};

// ─────────────────────────────────────────────
//  FAUNA
// ─────────────────────────────────────────────
window.openAddFish = () => {
  if (!isAdmin()) return;
  ['fish-name', 'fish-species', 'fish-qty', 'fish-notes'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('fish-edit-id').value = '';
  document.getElementById('fish-modal-title').textContent = '🐟 Agregar Fauna';
  document.getElementById('btn-save-fish').textContent = 'Agregar fauna';
  document.getElementById('modal-add-fish').classList.add('open');
};

window.openEditFish = () => {
  if (!isAdmin() || !detailFishId) return;
  closeModal('modal-fish-detail');
  // Se busca en Firestore para tener datos frescos
  getDoc(doc(db, 'fish', detailFishId)).then(snap => {
    if (!snap.exists()) { showToast('Fauna no encontrada', 'err'); return; }
    const f = snap.data();
    document.getElementById('fish-edit-id').value   = detailFishId;
    document.getElementById('fish-name').value      = f.name      || '';
    document.getElementById('fish-species').value   = f.species   || '';
    document.getElementById('fish-qty').value       = f.qty       || '';
    document.getElementById('fish-notes').value     = f.notes     || '';
    // Seleccionar el estanque correcto
    setTimeout(() => {
      const s = document.getElementById('fish-pond');
      for (let i = 0; i < s.options.length; i++) {
        if (s.options[i].value === f.pondId) { s.selectedIndex = i; break; }
      }
    }, 50);
    document.getElementById('fish-modal-title').textContent = '✏ Editar Fauna';
    document.getElementById('btn-save-fish').textContent    = 'Actualizar fauna';
    document.getElementById('modal-add-fish').classList.add('open');
  });
};

window.saveFish = async () => {
  if (!isAdmin()) return;
  const pondId = document.getElementById('fish-pond').value;
  const name   = document.getElementById('fish-name').value.trim();
  const editId = document.getElementById('fish-edit-id').value;
  if (!pondId || !name) { showToast('Estanque y nombre son obligatorios', 'err'); return; }
  const pond = pondsCache.find(p => p.id === pondId);
  const data = {
    pondId, pondName: pond?.name || '?', name,
    species:     document.getElementById('fish-species').value.trim(),
    qty:         Number(document.getElementById('fish-qty').value) || 0,
    notes:       document.getElementById('fish-notes').value.trim()
  };
  try {
    if (editId) {
      await updateDoc(doc(db, 'fish', editId), data);
      showToast('✓ Fauna actualizada');
    } else {
      await addDoc(collection(db, 'fish'), {
        ...data,
        addedBy:     displayName(),
        addedByUser: displayUsername(),
        addedAt:     serverTimestamp()
      });
      showToast('✓ Fauna agregada');
    }
    closeModal('modal-add-fish');
    loadFishView();
  } catch (e) { showToast('Error: ' + e.message, 'err'); }
};

window.deleteFishFromDetail = async () => {
  if (!isAdmin() || !detailFishId) return;
  if (!confirm('¿Eliminar esta fauna?')) return;
  try {
    await deleteDoc(doc(db, 'fish', detailFishId));
    showToast('✓ Fauna eliminada');
    closeModal('modal-fish-detail');
    loadFishView();
  } catch (e) { showToast('Error: ' + e.message, 'err'); }
};

window.openFishDetail = (fishId, fishData) => {
  detailFishId = fishId;
  const f = fishData;
  document.getElementById('fish-detail-body').innerHTML = `
    <div class="fish-detail-wrap">
      <div class="fish-detail-icon">🐟</div>
      <div class="fish-detail-name">${f.name}</div>
      <div class="fish-detail-species">${f.species || 'Especie no especificada'}</div>
      <div class="fish-detail-grid">
        <div class="fd-row"><span class="fd-label">Estanque</span><span class="fd-value">${f.pondName}</span></div>
        <div class="fd-row"><span class="fd-label">Cantidad</span><span class="fd-value">${(f.qty || 0).toLocaleString()}</span></div>
        ${f.notes ? `<div class="fd-row"><span class="fd-label">Notas</span><span class="fd-value">${f.notes}</span></div>` : ''}
        <div class="fd-row"><span class="fd-label">Registrado por</span><span class="fd-value">@${f.addedByUser || f.addedBy || '—'}</span></div>
        ${f.addedAt ? `<div class="fd-row"><span class="fd-label">Fecha</span><span class="fd-value">${fmtDate(f.addedAt)}</span></div>` : ''}
      </div>
    </div>`;
  const adminBtns = document.getElementById('fish-detail-admin-btns');
  if (adminBtns) adminBtns.style.display = isAdmin() ? 'flex' : 'none';
  document.getElementById('modal-fish-detail').classList.add('open');
};

window.loadFishView = async () => {
  const pf   = document.getElementById('filter-fish-pond').value;
  const snap = await getDocs(collection(db, 'fish'));
  let items  = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  if (pf) items = items.filter(f => f.pondId === pf);
  const c = document.getElementById('fish-list');
  if (!items.length) {
    c.innerHTML = `<div class="empty"><div class="icon">🐟</div><p>No hay fauna registrada todavía.</p></div>`;
    return;
  }
  c.innerHTML = items.map(f => `
    <div class="fish-row" onclick="openFishDetail('${f.id}', ${JSON.stringify(f).replace(/'/g,"\\'")})" style="cursor:pointer">
      <div class="fish-icon-wrap">🐟</div>
      <div class="fish-info">
        <div class="fname">${f.name} <span style="color:var(--text-lt);font-size:.72rem;font-weight:600">· ${f.pondName}</span></div>
        <div class="fspec">${f.species || 'Especie no especificada'} &nbsp;·&nbsp; Agregado por @${f.addedByUser || f.addedBy}</div>
      </div>
      <div class="fish-qty">${(f.qty || 0).toLocaleString()}</div>
    </div>`).join('');
};

// ─────────────────────────────────────────────
//  HELPERS SELECTS
// ─────────────────────────────────────────────
function populatePondSelects() {
  ['action-pond', 'fish-pond', 'filter-pond', 'filter-fish-pond'].forEach(id => {
    const sel      = document.getElementById(id);
    if (!sel) return;
    const isFilter = id.startsWith('filter');
    sel.innerHTML  =
      (isFilter ? '<option value="">Todos los estanques</option>' : '<option value="">— Selecciona —</option>') +
      pondsCache.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
  });
}

// Cierra modal al hacer clic en el fondo
document.querySelectorAll('.modal-bg').forEach(bg =>
  bg.addEventListener('click', e => { if (e.target === bg) bg.classList.remove('open'); })
);

// ─────────────────────────────────────────────
//  ARRANCAR
// ─────────────────────────────────────────────
init();
