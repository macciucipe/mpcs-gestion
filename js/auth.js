// ============================================================
// js/auth.js — MPCS Gestión
// ============================================================

// ── CONTEXTO GLOBAL (empresa y locales activos) ──────────────────────────────
let _contextoEmpresa    = null;  // { ruc, razon_social, abreviatura }
let _contextoLocales    = [];    // array de { id_local, nombre }
let _localesDisponibles = [];

// Persistencia en sessionStorage
function _saveContexto() {
  try {
    sessionStorage.setItem('mpcs_ctx', JSON.stringify({
      empresa: _contextoEmpresa,
      locales: _contextoLocales,
    }));
  } catch(e) {}
}

function _loadContexto() {
  try {
    const raw = sessionStorage.getItem('mpcs_ctx');
    if (!raw) return;
    const ctx = JSON.parse(raw);
    _contextoEmpresa = ctx.empresa || null;
    _contextoLocales = ctx.locales || [];
  } catch(e) {}
}

function getContexto() {
  return {
    empresa:  _contextoEmpresa,
    locales:  _contextoLocales,
    ruc:      _contextoEmpresa?.ruc || null,
    // idLocal: primer local seleccionado (retrocompatibilidad)
    idLocal:  _contextoLocales.length === 1 ? _contextoLocales[0].id_local : null,
    // idLocales: array de ids para filtros múltiples
    idLocales: _contextoLocales.map(l => l.id_local),
  };
}

function onContextoChange(callback) {
  window._contextoCallbacks = window._contextoCallbacks || [];
  window._contextoCallbacks.push(callback);
}

function _notificarContexto() {
  _saveContexto();
  (window._contextoCallbacks || []).forEach(fn => { try { fn(getContexto()); } catch(e) {} });
}

function _renderChipsLocales() {
  const wrap = document.getElementById('ctx-locales-wrap');
  if (!wrap) return;
  if (!_localesDisponibles.length) { wrap.style.display = 'none'; return; }
  wrap.style.display = 'block';
  wrap.innerHTML = '';

  // Chip "Todos"
  const todosSelected = _contextoLocales.length === 0;
  const chipTodos = document.createElement('div');
  chipTodos.className = 'ctx-chip' + (todosSelected ? ' ctx-chip-on' : '');
  chipTodos.textContent = 'Todos';
  chipTodos.onclick = () => { _contextoLocales = []; _renderChipsLocales(); _notificarContexto(); };
  wrap.appendChild(chipTodos);

  _localesDisponibles.forEach(l => {
    const sel = _contextoLocales.some(x => x.id_local === l.id_local);
    const chip = document.createElement('div');
    chip.className = 'ctx-chip' + (sel ? ' ctx-chip-on' : '');
    chip.textContent = l.nombre;
    chip.onclick = () => {
      if (sel) {
        _contextoLocales = _contextoLocales.filter(x => x.id_local !== l.id_local);
      } else {
        _contextoLocales.push(l);
      }
      _renderChipsLocales();
      _notificarContexto();
    };
    wrap.appendChild(chip);
  });
}

async function setEmpresa(ruc, empresas) {
  const emp = empresas.find(e => e.ruc === ruc);
  _contextoEmpresa = emp || null;
  _contextoLocales = [];

  // Cargar locales de esta empresa
  const { data } = await sbClient.from('locales')
    .select('id_local,nombre')
    .eq('ruc_empresa', ruc)
    .eq('estado','activo')
    .order('nombre');
  _localesDisponibles = data || [];

  _renderChipsLocales();
  _notificarContexto();
}

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

// ── PERMISOS DE UI ───────────────────────────────────────────────────────────
// Oculta botones de acción según permisos del perfil
// Uso: aplicarPermisosUI(perfil, 'rrhh_empleados')
function aplicarPermisosUI(perfil, modulo) {
  if (perfil.rol === 'admin') return; // admin ve todo

  // Botones de crear (clase .btn-nuevo o id btn-nuevo o primer .btn-primary del header)
  if (!puedeCrear(perfil, modulo)) {
    document.querySelectorAll('#btn-nuevo, .btn-nuevo, .page-header-right .btn-primary').forEach(el => {
      el.style.display = 'none';
    });
  }

  // Botones de editar
  if (!puedeEditar(perfil, modulo)) {
    document.querySelectorAll('.btn-edit, [data-action="editar"]').forEach(el => {
      el.style.display = 'none';
    });
  }

  // Botones de eliminar
  if (!puedeEliminar(perfil, modulo)) {
    document.querySelectorAll('.btn-delete, [data-action="eliminar"]').forEach(el => {
      el.style.display = 'none';
    });
  }

  // Solo lectura — deshabilitar formularios si no puede editar ni crear
  if (!puedeEditar(perfil, modulo) && !puedeCrear(perfil, modulo)) {
    document.querySelectorAll('.modal input, .modal select, .modal textarea').forEach(el => {
      el.disabled = true;
    });
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
      <style>
        .ctx-chip { display:inline-block; font-size:11px; padding:3px 8px; border-radius:20px; border:1px solid rgba(255,255,255,0.25); color:rgba(255,255,255,0.6); cursor:pointer; margin:2px 2px 2px 0; transition:all .15s; }
        .ctx-chip:hover { border-color:rgba(255,255,255,0.5); color:#fff; }
        .ctx-chip-on { background:rgba(255,255,255,0.15); border-color:rgba(255,255,255,0.6); color:#fff; font-weight:500; }
      </style>
      <div class="sidebar-context" id="sidebar-context" style="padding:8px 12px;border-bottom:1px solid rgba(255,255,255,0.08)">
        <div style="font-size:10px;font-weight:600;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:.06em;margin-bottom:5px">Operando en</div>
        <select id="ctx-empresa" onchange="window._onCtxEmpresaChange(this.value)" style="width:100%;font-size:12px;padding:5px 8px;border-radius:6px;border:1px solid rgba(255,255,255,0.3);background:#1B3A5C;color:#fff;margin-bottom:6px;cursor:pointer">
          <option value="" style="background:#1B3A5C">Seleccionar empresa...</option>
        </select>
        <div id="ctx-locales-wrap" style="display:none;margin-top:2px">
          <div style="font-size:10px;color:rgba(255,255,255,0.4);margin-bottom:4px">Locales</div>
        </div>
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
          ${puedeVer(perfil,'compras_productos') ? `<a href="/pages/compras/vinculacion.html" class="nav-item ${activePage==='vinculacion'?'active':''}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg> Vinculación catálogos</a>` : ''}
          ${puedeVer(perfil,'compras_catalogo') ? `<a href="/pages/compras/catalogo-local.html" class="nav-item ${activePage==='catalogo-local'?'active':''}">${icons.clipboard} Catálogo de solicitud</a>` : ''}

        </div>` : ''}

        ${(isAdmin || perfil.rol === 'gerencia') ? `
        <div class="nav-section">
          <div class="nav-section-label">Reservas</div>
          <a href="/pages/reservas/reservas.html" class="nav-item ${activePage==='reservas'?'active':''}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            Reservas
          </a>
        </div>

        <div class="nav-section">
          <div class="nav-section-label">Finanzas</div>
          <a href="/pages/administracion/facturas.html" class="nav-item ${activePage==='facturas'?'active':''}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
            Facturas
          </a>
          <a href="/pages/administracion/pagos.html" class="nav-item ${activePage==='pagos'?'active':''}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
            Pagos a proveedores
          </a>
          <a href="/pages/administracion/estado-cuenta.html" class="nav-item ${activePage==='estado-cuenta'?'active':''}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
            Estado de cuenta
          </a>
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

  // Inicializar selector de empresa en sidebar
  (async () => {
    const { data: todasEmpresas } = await sbClient.from('empresas')
      .select('ruc,razon_social,abreviatura')
      .eq('estado','activa')
      .order('razon_social');

    const empDisponibles = perfil.rol === 'admin'
      ? (todasEmpresas || [])
      : (todasEmpresas || []).filter(e => perfil._empresas?.has(e.ruc));

    const selEmp = document.getElementById('ctx-empresa');
    if (!selEmp) return;

    empDisponibles.forEach(e => {
      const o = document.createElement('option');
      o.value = e.ruc;
      o.textContent = `${e.abreviatura} — ${e.razon_social}`;
      selEmp.appendChild(o);
    });

    // Restaurar contexto previo de sessionStorage
    _loadContexto();
    if (_contextoEmpresa) {
      const empPrev = empDisponibles.find(e => e.ruc === _contextoEmpresa.ruc);
      if (empPrev) {
        selEmp.value = empPrev.ruc;
        const { data: locData } = await sbClient.from('locales')
          .select('id_local,nombre').eq('ruc_empresa', empPrev.ruc).eq('estado','activo').order('nombre');
        _localesDisponibles = locData || [];
        _renderChipsLocales();
        // Restaurar locales seleccionados
        if (_contextoLocales.length) {
          _contextoLocales = _contextoLocales.filter(l =>
            _localesDisponibles.some(x => x.id_local === l.id_local)
          );
          _renderChipsLocales();
        }
        // Notificar para que las páginas carguen con el contexto restaurado
        setTimeout(() => _notificarContexto(), 100);
      }
    }

    // Si solo tiene una empresa, seleccionarla automáticamente
    if (empDisponibles.length === 1 && !_contextoEmpresa) {
      selEmp.value = empDisponibles[0].ruc;
      selEmp.disabled = true;
      await setEmpresa(empDisponibles[0].ruc, empDisponibles);
    }

    window._empDisponibles = empDisponibles;
    window._onCtxEmpresaChange = async (ruc) => {
      if (ruc) await setEmpresa(ruc, empDisponibles);
      else { _contextoEmpresa = null; _contextoLocales = []; _localesDisponibles = []; _renderChipsLocales(); _notificarContexto(); }
    };
  })();
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
