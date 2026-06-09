// ============================================================
// js/auth.js — MPCS Gestión
// ============================================================

async function signIn(email, password) {
  const { data, error } = await sbClient.auth.signInWithPassword({ email, password });
  return { data, error };
}

async function signOut() {
  await sbClient.auth.signOut();
}

async function checkSession() {
  const { data } = await sbClient.auth.getSession();
  return data?.session || null;
}

async function getPerfil() {
  const session = await checkSession();
  if (!session) return null;
  const { data: perfil } = await sbClient
    .from('perfiles')
    .select('*, empresas(razon_social, abreviatura)')
    .eq('user_id', session.user.id)
    .single();
  if (!perfil) return null;

  // Cargar permisos y empresas
  const [permRes, empRes] = await Promise.all([
    sbClient.from('usuario_permisos').select('*').eq('user_id', session.user.id),
    sbClient.from('usuario_empresas').select('ruc_empresa').eq('user_id', session.user.id),
  ]);

  perfil._permisos  = {};
  (permRes.data || []).forEach(p => { perfil._permisos[p.modulo] = p; });
  perfil._empresas  = new Set((empRes.data || []).map(e => e.ruc_empresa));

  return perfil;
}

// ── HELPER DE PERMISOS ────────────────────────────────────────────────────────
// Uso: puedeVer(perfil, 'rrhh_planilla')
// Uso: puedeEditar(perfil, 'compras_oc')
function puedeVer(perfil, modulo) {
  if (perfil.rol === 'admin') return true;
  return !!perfil._permisos?.[modulo]?.puede_ver;
}
function puedeCrear(perfil, modulo) {
  if (perfil.rol === 'admin') return true;
  return !!perfil._permisos?.[modulo]?.puede_crear;
}
function puedeEditar(perfil, modulo) {
  if (perfil.rol === 'admin') return true;
  return !!perfil._permisos?.[modulo]?.puede_editar;
}
function puedeEliminar(perfil, modulo) {
  if (perfil.rol === 'admin') return true;
  return !!perfil._permisos?.[modulo]?.puede_eliminar;
}
function tieneEmpresa(perfil, ruc) {
  if (perfil.rol === 'admin') return true;
  return perfil._empresas?.has(ruc);
}

async function requireAuth(allowedRoles = null, moduloRequerido = null) {
  const session = await checkSession();
  if (!session) { window.location.href = '/index.html'; return null; }
  const perfil = await getPerfil();
  if (!perfil) { window.location.href = '/index.html'; return null; }

  // Admin pasa siempre
  if (perfil.rol === 'admin') return perfil;

  // Verificar rol
  if (allowedRoles && !allowedRoles.includes(perfil.rol)) {
    window.location.href = '/pages/dashboard.html';
    return null;
  }

  // Verificar permiso de módulo si se especifica
  if (moduloRequerido && !puedeVer(perfil, moduloRequerido)) {
    window.location.href = '/pages/dashboard.html';
    return null;
  }

  return perfil;
}

// Devuelve solo las empresas a las que el usuario tiene acceso
function empresasPermitidas(perfil) {
  if (perfil.rol === 'admin') return null; // null = todas
  return [...(perfil._empresas || new Set())];
}

// Aplica restricción de empresas a un selector <select>
async function aplicarFiltroEmpresas(perfil, selectId) {
  const sel = document.getElementById(selectId);
  if (!sel) return;

  if (perfil.rol === 'admin') return; // admin ve todo, no tocar

  const permitidas = empresasPermitidas(perfil);
  // Ocultar opciones que no tiene acceso
  Array.from(sel.options).forEach(opt => {
    if (opt.value && !permitidas.includes(opt.value)) {
      opt.remove();
    }
  });

  // Si solo tiene acceso a una empresa, seleccionarla y deshabilitar
  if (permitidas.length === 1) {
    sel.value = permitidas[0];
    sel.disabled = true;
  } else if (permitidas.length === 0) {
    sel.innerHTML = '<option value="">Sin acceso a empresas</option>';
    sel.disabled = true;
  }
}

// ── AUDITORÍA ─────────────────────────────────────────────────────────────────
async function auditar(perfil, accion, modulo, detalle) {
  try {
    await sbClient.from('auditoria').insert({
      user_id:       perfil?.user_id || null,
      usuario_email: perfil?.email   || null,
      accion, modulo, detalle,
    });
  } catch(e) {
    console.warn('Auditoría fallida:', e.message);
  }
}

// ── ROLES Y BADGES ────────────────────────────────────────────────────────────
function getRolBadge(rol) {
  const map = {
    admin:      '<span class="badge badge-purple">Admin</span>',
    rrhh:       '<span class="badge badge-blue">RRHH</span>',
    gerencia:   '<span class="badge badge-green">Gerencia</span>',
    compras:    '<span class="badge badge-yellow">Compras</span>',
    supervisor: '<span class="badge badge-gray">Supervisor</span>',
    local:      '<span class="badge badge-gray">Local</span>',
  };
  return map[rol] || `<span class="badge badge-gray">${rol}</span>`;
}

function getEstadoBadge(estado) {
  const map = {
    activo:       '<span class="badge badge-green">Activo</span>',
    inactivo:     '<span class="badge badge-gray">Inactivo</span>',
    activa:       '<span class="badge badge-green">Activa</span>',
    inactiva:     '<span class="badge badge-gray">Inactiva</span>',
    pendiente:    '<span class="badge badge-yellow">Pendiente</span>',
    atendida:     '<span class="badge badge-blue">Atendida</span>',
    recepcionada: '<span class="badge badge-blue">Recepcionada</span>',
    conforme:     '<span class="badge badge-green">Conforme</span>',
    anulada:      '<span class="badge badge-red">Anulada</span>',
    en_revision:  '<span class="badge badge-blue">En revisión</span>',
    resuelto:     '<span class="badge badge-green">Resuelto</span>',
    archivado:    '<span class="badge badge-gray">Archivado</span>',
    cesado:       '<span class="badge badge-red">Cesado</span>',
  };
  return map[estado] || `<span class="badge badge-gray">${estado}</span>`;
}

// ── SIDEBAR ───────────────────────────────────────────────────────────────────
function renderSidebar(perfil, activePage) {
  const isAdmin = perfil.rol === 'admin';
  const initials = perfil.nombre.split(' ').map(n => n[0]).join('').toUpperCase().slice(0,2);

  // Secciones visibles según permisos
  const showRrhh = isAdmin ||
    puedeVer(perfil,'rrhh_empleados') || puedeVer(perfil,'rrhh_asistencia') ||
    puedeVer(perfil,'rrhh_candidatos') || puedeVer(perfil,'rrhh_disciplinario') ||
    puedeVer(perfil,'rrhh_planilla') || puedeVer(perfil,'rrhh_costo') ||
    puedeVer(perfil,'rrhh_pasivos') || puedeVer(perfil,'rrhh_horarios');

  const showCompras = isAdmin ||
    puedeVer(perfil,'compras_pedidos') || puedeVer(perfil,'compras_oc') ||
    puedeVer(perfil,'compras_recepciones') || puedeVer(perfil,'compras_proveedores') ||
    puedeVer(perfil,'compras_productos') || puedeVer(perfil,'compras_catalogo');

  const nav = `
    <aside class="sidebar" id="sidebar">
      <div class="sidebar-header">
        <div class="sidebar-logo">
          <span class="mpc">MPC</span>
          <span class="sol">Soluciones</span>
        </div>
        <div class="sidebar-tagline">Portal de gestión</div>
      </div>
      <nav class="sidebar-nav">
        <div class="nav-section">
          <div class="nav-section-label">Principal</div>
          <a href="/pages/dashboard.html" class="nav-item ${activePage==='dashboard'?'active':''}">
            ${icons.dashboard} Dashboard
          </a>
        </div>

        ${showRrhh ? `
        <div class="nav-section">
          <div class="nav-section-label">RRHH</div>
          ${puedeVer(perfil,'rrhh_empleados') ? `<a href="/pages/rrhh/empleados.html" class="nav-item ${activePage==='empleados'?'active':''}">${icons.users} Empleados</a>` : ''}
          ${puedeVer(perfil,'rrhh_horarios') ? `<a href="/pages/rrhh/horarios.html" class="nav-item ${activePage==='horarios'?'active':''}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><path d="M8 14h.01M12 14h.01"/></svg> Horarios</a>` : ''}
          ${puedeVer(perfil,'rrhh_asistencia') ? `<a href="/pages/rrhh/asistencia.html" class="nav-item ${activePage==='asistencia'?'active':''}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> Asistencia</a>` : ''}
          ${puedeVer(perfil,'rrhh_candidatos') ? `<a href="/pages/rrhh/candidatos.html" class="nav-item ${activePage==='candidatos'?'active':''}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="23" y1="11" x2="17" y2="11"/><line x1="20" y1="8" x2="20" y2="14"/></svg> Candidatos</a>` : ''}
          ${puedeVer(perfil,'rrhh_disciplinario') ? `<a href="/pages/rrhh/disciplinario.html" class="nav-item ${activePage==='disciplinario'?'active':''}">${icons.alert} Medidas disciplinarias</a>` : ''}
          ${puedeVer(perfil,'rrhh_planilla') ? `<a href="/pages/rrhh/planilla.html" class="nav-item ${activePage==='planilla'?'active':''}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg> Planilla</a>` : ''}
          ${puedeVer(perfil,'rrhh_costo') ? `<a href="/pages/rrhh/costo-laboral.html" class="nav-item ${activePage==='costo-laboral'?'active':''}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg> Costo laboral</a>` : ''}
          ${puedeVer(perfil,'rrhh_pasivos') ? `<a href="/pages/rrhh/pasivos-laborales.html" class="nav-item ${activePage==='pasivos-laborales'?'active':''}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg> Pasivos laborales</a>` : ''}
        </div>` : ''}

        ${showCompras ? `
        <div class="nav-section">
          <div class="nav-section-label">Compras</div>
          ${puedeVer(perfil,'compras_pedidos') ? `<a href="/pages/compras/pedidos.html" class="nav-item ${activePage==='pedidos'?'active':''}">${icons.clipboard} Pedidos internos (OP)</a>` : ''}
          ${puedeVer(perfil,'compras_oc') ? `<a href="/pages/compras/ordenes-compra.html" class="nav-item ${activePage==='oc'?'active':''}">${icons.cart} Órdenes de compra</a>` : ''}
          ${puedeVer(perfil,'compras_recepciones') ? `<a href="/pages/compras/recepciones.html" class="nav-item ${activePage==='or'?'active':''}">${icons.package} Recepciones (OR)</a>` : ''}
          ${puedeVer(perfil,'compras_proveedores') ? `<a href="/pages/compras/proveedores.html" class="nav-item ${activePage==='proveedores'?'active':''}">${icons.users} Proveedores</a>` : ''}
          ${puedeVer(perfil,'compras_productos') ? `<a href="/pages/compras/productos.html" class="nav-item ${activePage==='productos'?'active':''}">${icons.box} Catálogo de compra</a>` : ''}
          ${puedeVer(perfil,'compras_catalogo') ? `<a href="/pages/compras/catalogo-local.html" class="nav-item ${activePage==='catalogo-local'?'active':''}">${icons.clipboard} Catálogo de solicitud</a>` : ''}

        </div>` : ''}

        ${isAdmin ? `
        <div class="nav-section">
          <div class="nav-section-label">Administración</div>
          <a href="/pages/admin/empresas.html" class="nav-item ${activePage==='empresas'?'active':''}">${icons.building} Empresas</a>
          <a href="/pages/admin/locales.html" class="nav-item ${activePage==='locales'?'active':''}">${icons.map} Locales</a>
          <a href="/pages/admin/usuarios.html" class="nav-item ${activePage==='usuarios'?'active':''}">${icons.shield} Usuarios</a>
          <a href="/pages/admin/auditoria.html" class="nav-item ${activePage==='auditoria'?'active':''}">${icons.eye} Auditoría</a>
        </div>` : ''}
      </nav>
      <div class="sidebar-footer">
        <div class="sidebar-user">
          <div class="sidebar-avatar">${initials}</div>
          <div class="sidebar-user-info">
            <div class="sidebar-user-name">${perfil.nombre}</div>
            <div class="sidebar-user-role">${perfil.rol}</div>
          </div>
          <button class="sidebar-logout" onclick="handleLogout()" title="Cerrar sesión">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
          </button>
        </div>
      </div>
    </aside>`;
  document.body.insertAdjacentHTML('afterbegin', nav);
}

const icons = {
  dashboard: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>`,
  users:     `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
  alert:     `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
  cart:      `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>`,
  building:  `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`,
  map:       `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`,
  shield:    `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
  plus:      `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
  edit:      `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`,
  trash:     `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`,
  search:    `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
  refresh:   `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>`,
  eye:       `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`,
  clipboard: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>`,
  briefcase: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>`,
  package:   `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>`,
  check:     `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`,
  box:       `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>`,
  truck:     `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>`,
  download:  `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
};

async function handleLogout() {
  const session = await checkSession();
  if (session) {
    const perfil = await getPerfil();
    if (perfil) await auditar(perfil, 'LOGOUT', 'sistema', 'Cerró sesión');
  }
  await signOut();
  window.location.href = '/index.html';
}
