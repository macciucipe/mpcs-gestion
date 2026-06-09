// api/crear-usuario-portal.js
// Serverless function de Vercel para crear usuarios en Supabase Auth
// Usa la service role key de forma segura (solo en el servidor)

const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  // Solo POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  // Verificar variables de entorno
  const supabaseUrl     = process.env.SUPABASE_URL;
  const serviceRoleKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey         = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return res.status(500).json({ error: 'Variables de entorno no configuradas' });
  }

  const { email, nombre, id_empleado, ruc_empresa } = req.body;

  if (!email || !nombre || !id_empleado) {
    return res.status(400).json({ error: 'Faltan datos requeridos' });
  }

  // Verificar que quien llama es admin (con anon key)
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  try {
    // Cliente con anon key para verificar el perfil del admin
    const sbAnon = createClient(supabaseUrl, anonKey);
    const token  = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authErr } = await sbAnon.auth.getUser(token);
    if (authErr || !user) return res.status(401).json({ error: 'Token inválido' });

    // Verificar que es admin
    const { data: perfil } = await sbAnon
      .from('perfiles')
      .select('rol')
      .eq('user_id', user.id)
      .single();
    if (!perfil || perfil.rol !== 'admin') {
      return res.status(403).json({ error: 'Solo el administrador puede crear accesos' });
    }

    // Cliente admin con service role key
    const sbAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    // Verificar si el usuario ya existe
    const { data: existing } = await sbAdmin
      .from('perfiles')
      .select('user_id')
      .eq('email', email)
      .single();

    if (existing) {
      return res.status(409).json({ error: 'Este email ya tiene acceso al portal' });
    }

    // Crear usuario en Supabase Auth con invitación
    const { data: newUser, error: createErr } = await sbAdmin.auth.admin.inviteUserByEmail(email, {
      redirectTo: 'https://mi.mpcs.pe/nueva-password.html',
      data: {
        nombre:      nombre,
        id_empleado: id_empleado,
        ruc_empresa: ruc_empresa,
      }
    });

    if (createErr) {
      return res.status(400).json({ error: createErr.message });
    }

    // Crear perfil en tabla perfiles
    const { error: perfilErr } = await sbAdmin.from('perfiles').insert([{
      user_id:     newUser.user.id,
      nombre:      nombre,
      email:       email,
      rol:         'empleado',
      estado:      'activo',
      id_empleado: id_empleado,
      ruc_empresa: ruc_empresa,
    }]);

    if (perfilErr) {
      return res.status(500).json({ error: 'Usuario creado pero error al guardar perfil: ' + perfilErr.message });
    }

    return res.status(200).json({
      success: true,
      message: `Acceso creado. Se envió un email a ${email} para establecer la contraseña.`,
      user_id: newUser.user.id,
    });

  } catch (err) {
    return res.status(500).json({ error: 'Error interno: ' + err.message });
  }
};
