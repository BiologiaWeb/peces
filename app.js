// ═══════════════════════════════════════════════════════
//  AquaLog — app.js
//  Auth: usuario + contraseña (sin correo real)
//  Firebase: Firestore + Authentication (email fake interno)
// ═══════════════════════════════════════════════════════

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
  updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore,
  collection, addDoc, getDocs,
  query, orderBy, limit,
  doc, setDoc, updateDoc, getDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ═══════════════════════════════════════════════════════
//  ⚠️  REEMPLAZA CON TU CONFIGURACIÓN DE FIREBASE
//  console.firebase.google.com → tu proyecto → Configuración → app web
const firebaseConfig = {
  apiKey:            "AIzaSyBkawcfBFAugbhfs6R3lDuyDmhlhx832N8",
  authDomain:        "peces-3fa4d.firebaseapp.com",
  projectId:         "peces-3fa4d",
  storageBucket:     "peces-3fa4d.firebasestorage.app",
  messagingSenderId: "1053419003639",
  appId:             "1:1053419003639:web:ab162a748a2f187ad27df2"
};
// ═══════════════════════════════════════════════════════

const FAKE_DOMAIN = "@aqualog.internal"; // dominio ficticio para Firebase Auth

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

let currentUser  = null;
let currentProfile = null; // datos extra del usuario (nombre, rol)
let pondsCache   = [];

// ─────────────────────────────────────────────
//  HELPERS GLOBALES
// ─────────────────────────────────────────────
window.closeModal = id => document.getElementById(id).classList.remove('open');

window.showToast = (msg, type = 'ok') => {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `show toast-${type}`;
  clearTimeout(t._tid);
  t._tid = setTimeout(() => { t.className = ''; }, 2600);
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

// Convierte username → email falso para Firebase Auth
function toFakeEmail(username) {
  return username.toLowerCase().trim().replace(/\s+/g, '_') + FAKE_DOMAIN;
}

// ─────────────────────────────────────────────
//  AUTH — con usuario en vez de correo
// ─────────────────────────────────────────────
window.switchAuthTab = tab => {
  document.querySelectorAll('.auth-tab').forEach((t, i) =>
    t.classList.toggle('active', (i === 0 && tab === 'login') || (i === 1 && tab === 'register'))
  );
  document.getElementById('login-form').style.display    = tab === 'login'    ? 'block' : 'none';
  document.getElementById('register-form').style.display = tab === 'register' ? 'block' : 'none';
};

window.doLogin = async () => {
  const username = document.getElementById('login-user').value.trim();
  const pass     = document.getElementById('login-pass').value;
  if (!username || !pass) { showToast('Completa todos los campos', 'err'); return; }
  try {
    await signInWithEmailAndPassword(auth, toFakeEmail(username), pass);
  } catch (e) {
    showToast('Usuario o contraseña incorrectos', 'err');
  }
};

window.doRegister = async () => {
  const username = document.getElementById('reg-user').value.trim();
  const name     = document.getElementById('reg-name').value.trim();
  const pass     = document.getElementById('reg-pass').value;
  const role     = document.getElementById('reg-role').value;

  if (!username || !name || !pass) { showToast('Completa todos los campos', 'err'); return; }
  if (pass.length < 6)             { showToast('La contraseña debe tener mínimo 6 caracteres', 'err'); return; }

  // Verifica que el username no exista ya
  const q = query(collection(db, 'users'));
  const snap = await getDocs(q);
  const exists = snap.docs.some(d => d.data().username === username.toLowerCase());
  if (exists) { showToast('Ese nombre de usuario ya está en uso', 'err'); return; }

  try {
    const cred = await createUserWithEmailAndPassword(auth, toFakeEmail(username), pass);
    await updateProfile(cred.user, { displayName: name });
    await setDoc(doc(db, 'users', cred.user.uid), {
      username: username.toLowerCase(),
      name,
      role,
      createdAt: serverTimestamp()
    });
  } catch (e) {
    showToast('Error al registrar: ' + e.message, 'err');
  }
};

window.doLogout = () => signOut(auth);

// Reacciona a cambios de sesión
onAuthStateChanged(auth, async user => {
  if (user) {
    currentUser = user;
    // Cargar perfil del usuario desde Firestore
    try {
      const snap = await getDoc(doc(db, 'users', user.uid));
      currentProfile = snap.exists() ? snap.data() : { name: user.displayName || 'Usuario', username: '?', role: 'operador' };
    } catch {
      currentProfile = { name: user.displayName || 'Usuario', username: '?', role: 'operador' };
    }

    document.getElementById('auth-screen').style.display = 'none';
    document.getElementById('app-screen').style.display  = 'block';
    document.getElementById('user-avatar').textContent   = (currentProfile.name).slice(0, 2).toUpperCase();
    document.getElementById('user-name-header').textContent = `${currentProfile.name} (${currentProfile.username || '?'})`;
    await loadPonds();
  } else {
    currentUser    = null;
    currentProfile = null;
    document.getElementById('auth-screen').style.display = 'flex';
    document.getElementById('app-screen').style.display  = 'none';
  }
});

function displayName() {
  return currentProfile?.name || currentUser?.displayName || 'Usuario';
}
function displayUsername() {
  return currentProfile?.username || '?';
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
  if (tab === 'stats') loadStats();
};

// ─────────────────────────────────────────────
//  ESTANQUES
// ─────────────────────────────────────────────
window.openAddPond = () => {
  ['pond-name', 'pond-type', 'pond-cap', 'pond-notes'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('modal-add-pond').classList.add('open');
};

window.savePond = async () => {
  const name = document.getElementById('pond-name').value.trim();
  if (!name) { showToast('El nombre es obligatorio', 'err'); return; }
  try {
    await addDoc(collection(db, 'ponds'), {
      name,
      type:       document.getElementById('pond-type').value.trim(),
      capacity:   Number(document.getElementById('pond-cap').value) || 0,
      notes:      document.getElementById('pond-notes').value.trim(),
      createdBy:  displayName(),
      createdByUser: displayUsername(),
      createdAt:  serverTimestamp(),
      lastFed:    null,
      lastFedBy:  null
    });
    closeModal('modal-add-pond');
    showToast('✓ Estanque creado');
    await loadPonds();
  } catch (e) { showToast('Error: ' + e.message, 'err'); }
};

async function loadPonds() {
  try {
    const snap = await getDocs(query(collection(db, 'ponds'), orderBy('createdAt', 'asc')));
    pondsCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch {
    pondsCache = [];
  }
  renderPonds();
  populatePondSelects();
}

function renderPonds() {
  const grid = document.getElementById('pond-grid');
  if (!pondsCache.length) {
    grid.innerHTML = `<div class="empty"><div class="icon">🌊</div><p>No hay estanques todavía.<br>Crea el primero con el botón.</p></div>`;
    return;
  }
  const today = new Date().toDateString();
  grid.innerHTML = pondsCache.map(p => {
    const lastFedDate = p.lastFed ? new Date(p.lastFed.toDate?.() ?? p.lastFed) : null;
    const fedToday = lastFedDate?.toDateString() === today;
    return `
    <div class="pond-card ${fedToday ? 'fed' : ''}">
      <div class="pond-card-accent"></div>
      <div class="pond-header">
        <div>
          <div class="pond-name">${p.name}</div>
          <div class="pond-type">${p.type || 'Sin tipo especificado'}</div>
        </div>
        <span class="status-badge ${fedToday ? 'badge-fed' : 'badge-unfed'}">
          ${fedToday ? '✓ Alimentado' : 'Sin alimentar'}
        </span>
      </div>
      <div class="pond-body">
        <div class="stat-row">
          <span class="stat-label">Capacidad</span>
          <span class="stat-value">${p.capacity ? p.capacity.toLocaleString() + ' L' : '—'}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Última alimentación</span>
          <span class="stat-value ${fedToday ? 'hl' : ''}">${lastFedDate ? fmtDate(lastFedDate) : 'Nunca'}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Alimentado por</span>
          <span class="stat-value">${p.lastFedBy || '—'}</span>
        </div>
      </div>
      <div class="pond-footer">
        <button class="btn btn-success btn-sm" onclick="quickFeed('${p.id}','${p.name.replace(/'/g, "\\'")}')">🟢 Alimentar</button>
        <button class="btn btn-ghost btn-sm"   onclick="openRegisterAction('${p.id}')">+ Acción</button>
      </div>
    </div>`;
  }).join('');
}

window.quickFeed = async (pondId, pondName) => {
  try {
    await addDoc(collection(db, 'actions'), {
      pondId, pondName,
      action:   'alimentación',
      notes:    'Alimentación rápida',
      userName: displayName(),
      username: displayUsername(),
      userId:   currentUser.uid,
      timestamp: serverTimestamp()
    });
    await updateDoc(doc(db, 'ponds', pondId), {
      lastFed:   new Date(),
      lastFedBy: `${displayName()} (@${displayUsername()})`
    });
    showToast('✓ Alimentación registrada');
    await loadPonds();
  } catch (e) { showToast('Error: ' + e.message, 'err'); }
};

// ─────────────────────────────────────────────
//  ACCIONES
// ─────────────────────────────────────────────
window.openRegisterAction = pondId => {
  document.getElementById('action-notes').value = '';
  document.getElementById('modal-action').classList.add('open');
  if (pondId) {
    setTimeout(() => {
      const s = document.getElementById('action-pond');
      for (let i = 0; i < s.options.length; i++) {
        if (s.options[i].value === pondId) { s.selectedIndex = i; break; }
      }
    }, 50);
  }
};

window.saveAction = async () => {
  const pondId = document.getElementById('action-pond').value;
  const action = document.getElementById('action-type').value;
  const notes  = document.getElementById('action-notes').value.trim();
  if (!pondId) { showToast('Selecciona un estanque', 'err'); return; }
  const pond = pondsCache.find(p => p.id === pondId);
  try {
    await addDoc(collection(db, 'actions'), {
      pondId, pondName: pond?.name || '?',
      action, notes,
      userName: displayName(),
      username: displayUsername(),
      userId:   currentUser.uid,
      timestamp: serverTimestamp()
    });
    if (action === 'alimentación') {
      await updateDoc(doc(db, 'ponds', pondId), {
        lastFed:   new Date(),
        lastFedBy: `${displayName()} (@${displayUsername()})`
      });
    }
    closeModal('modal-action');
    showToast('✓ Acción registrada');
    await loadPonds();
  } catch (e) { showToast('Error: ' + e.message, 'err'); }
};

// ─────────────────────────────────────────────
//  BITÁCORA
// ─────────────────────────────────────────────
window.loadLog = async () => {
  const pf = document.getElementById('filter-pond').value;
  const af = document.getElementById('filter-action').value;
  const snap = await getDocs(query(collection(db, 'actions'), orderBy('timestamp', 'desc'), limit(300)));
  let rows = snap.docs.map(d => d.data());
  if (pf) rows = rows.filter(r => r.pondId === pf);
  if (af) rows = rows.filter(r => r.action === af);
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

// ─────────────────────────────────────────────
//  FAUNA
// ─────────────────────────────────────────────
window.openAddFish = () => {
  ['fish-name', 'fish-species', 'fish-qty', 'fish-notes'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('modal-add-fish').classList.add('open');
};

window.saveFish = async () => {
  const pondId = document.getElementById('fish-pond').value;
  const name   = document.getElementById('fish-name').value.trim();
  if (!pondId || !name) { showToast('Estanque y nombre son obligatorios', 'err'); return; }
  const pond = pondsCache.find(p => p.id === pondId);
  try {
    await addDoc(collection(db, 'fish'), {
      pondId, pondName: pond?.name || '?', name,
      species: document.getElementById('fish-species').value.trim(),
      qty:     Number(document.getElementById('fish-qty').value) || 0,
      notes:   document.getElementById('fish-notes').value.trim(),
      addedBy: displayName(),
      addedByUser: displayUsername(),
      addedAt: serverTimestamp()
    });
    closeModal('modal-add-fish');
    showToast('✓ Fauna agregada');
    loadFishView();
  } catch (e) { showToast('Error: ' + e.message, 'err'); }
};

window.loadFishView = async () => {
  const pf = document.getElementById('filter-fish-pond').value;
  const snap = await getDocs(collection(db, 'fish'));
  let items = snap.docs.map(d => d.data());
  if (pf) items = items.filter(f => f.pondId === pf);
  const c = document.getElementById('fish-list');
  if (!items.length) {
    c.innerHTML = `<div class="empty"><div class="icon">🐟</div><p>No hay fauna registrada todavía.</p></div>`;
    return;
  }
  c.innerHTML = items.map(f => `
    <div class="fish-row">
      <div class="fish-icon-wrap">🐟</div>
      <div class="fish-info">
        <div class="fname">${f.name} <span style="color:var(--text-lt);font-size:.72rem;font-weight:600">· ${f.pondName}</span></div>
        <div class="fspec">${f.species || 'Especie no especificada'} &nbsp;·&nbsp; Agregado por @${f.addedByUser || f.addedBy}</div>
      </div>
      <div class="fish-qty">${(f.qty || 0).toLocaleString()}</div>
    </div>`).join('');
};

// ─────────────────────────────────────────────
//  ESTADÍSTICAS
// ─────────────────────────────────────────────
window.loadStats = async () => {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const actSnap  = await getDocs(collection(db, 'actions'));
  const all      = actSnap.docs.map(d => d.data());
  const todayActs = all.filter(a => {
    const t = a.timestamp?.toDate?.() ?? new Date(a.timestamp);
    return t >= today;
  });
  const fishSnap  = await getDocs(collection(db, 'fish'));
  const totalFish = fishSnap.docs.reduce((s, d) => s + (d.data().qty || 0), 0);
  const fedPonds  = new Set(todayActs.filter(a => a.action === 'alimentación').map(a => a.pondId));

  document.getElementById('stat-ponds').textContent   = pondsCache.length;
  document.getElementById('stat-fish').textContent    = totalFish.toLocaleString();
  document.getElementById('stat-actions').textContent = todayActs.length;
  document.getElementById('stat-fed').textContent     = fedPonds.size;

  // Actividad últimos 7 días
  const week = new Date(); week.setDate(week.getDate() - 7);
  const recent = all.filter(a => {
    const t = a.timestamp?.toDate?.() ?? new Date(a.timestamp);
    return t >= week;
  });
  const byUser = {};
  recent.forEach(a => {
    const key = a.username ? `@${a.username}` : a.userName;
    byUser[key] = (byUser[key] || 0) + 1;
  });
  const sorted = Object.entries(byUser).sort((a, b) => b[1] - a[1]);
  const max    = sorted[0]?.[1] || 1;

  document.getElementById('user-activity-list').innerHTML = sorted.length
    ? sorted.map(([u, c]) => `
        <div class="activity-row">
          <div class="activity-row-header">
            <span class="uname">${u}</span>
            <span class="ucount">${c} acciones</span>
          </div>
          <div class="activity-bar-bg">
            <div class="activity-bar-fill" style="width:${(c / max) * 100}%"></div>
          </div>
        </div>`).join('')
    : `<p style="color:var(--text-lt);font-size:.82rem">Sin actividad en los últimos 7 días.</p>`;
};

// ─────────────────────────────────────────────
//  HELPERS DE SELECTS
// ─────────────────────────────────────────────
function populatePondSelects() {
  ['action-pond', 'fish-pond', 'filter-pond', 'filter-fish-pond'].forEach(id => {
    const sel = document.getElementById(id);
    const isFilter = id.startsWith('filter');
    sel.innerHTML =
      (isFilter ? '<option value="">Todos los estanques</option>' : '<option value="">— Selecciona —</option>') +
      pondsCache.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
  });
}

// Cierra modal al hacer clic en el fondo
document.querySelectorAll('.modal-bg').forEach(bg =>
  bg.addEventListener('click', e => { if (e.target === bg) bg.classList.remove('open'); })
);
