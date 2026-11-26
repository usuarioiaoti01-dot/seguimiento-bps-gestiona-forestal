'use strict';
/**
 * Seguimiento Actividades Gestiona Forestal 2026
 * Servidor web: API REST + interfaz estática (carpeta public/).
 */
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const config = require('./config');
const { crearRepositorio } = require('./datos');
const { crearServicio } = require('./servicio');
const { crearAgente } = require('./ia/agente');
const seg = require('./seguridad');
const { hoyLima, aDia } = require('./motor/calendario');
const { crearPlanesPdf } = require('./planes-pdf');
const { crearDocumentos } = require('./documentos');
const { leer: leerArchivo } = require('./documentos/lector');
const { crearFormulacion } = require('./formulacion');
const { crearActividadDocs } = require('./actividad-docs');
const { plantillaXlsx } = require('./documentos/plantilla');
const { crearAlmacen } = require('./documentos/almacen');
const permisos = require('./permisos');
const modalidades = require('./modalidades');
const { crearContrataciones } = require('./contrataciones');
const { crearProyectos } = require('./proyectos');
const { crearLectorEntregables } = require('./documentos/entregable');
const { crearSupervision } = require('./supervision');
const { construirPortafolio, totalesMonto } = require('./motor/portafolio');
const { crearCierre } = require('./cierre');
const { construirReporte, generarPdfReporte, rangoMes } = require('./reporte-mensual');
const { construirExpediente } = require('./documentos/expediente');
const { crearAlertasCorreo, crearReporteCorreo } = require('./correo');
const { crearSsoGoogle, COOKIE_OAUTH } = require('./sso-google');

async function crearApp() {
  // El repositorio va envuelto: toda escritura respeta el alcance por proyecto del usuario (permisos.js, db/15)
  let servicio = null;
  const proyectoDeConsultor = async (id) => {
    let d = await servicio.datos();
    let c = d.consultores.find((x) => x.consultor_id === Number(id));
    if (!c) { d = await servicio.datos(true); c = d.consultores.find((x) => x.consultor_id === Number(id)); }
    return c && c.proyecto_id ? Number(c.proyecto_id) : null;
  };
  const repo = permisos.envolverRepositorio(await crearRepositorio(), { proyectoDeConsultor, datos: (forzar) => servicio.datos(forzar) });
  servicio = crearServicio(repo);
  const agente = crearAgente({ servicio });
  await seg.asegurarAdministrador(repo);
  await servicio.recalculoDiario();

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.confiarProxy);
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'same-origin',
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; frame-ancestors 'none'",
    });
    next();
  });
  app.use(seg.leerSesion);
  // El perfil, el vínculo con el profesional y el estado de la cuenta se leen de la base en cada petición:
  // desactivar una cuenta, cambiar su perfil o restablecer su clave surte efecto de inmediato.
  app.use('/api', async (req, res, next) => {
    if (!req.usuario) return next();
    try {
      const u = await repo.buscarUsuarioId(req.usuario.id);
      if (!u || !u.activo) { res.clearCookie(seg.COOKIE, { path: '/' }); req.usuario = null; return next(); }
      Object.assign(req.usuario, { correo: u.correo, nombre: u.nombre, rol: u.rol, consultor_id: u.consultor_id ?? null, cambiar: !!u.debe_cambiar_clave });
      // proyectos de su equipo: un Jefe de Proyecto solo escribe en ellos (se leen en cada petición, como el perfil)
      req.usuario.proyectos = u.rol === 'JEFE_PROYECTO' ? await repo.proyectosDeUsuario(u.usuario_id) : [];
      next();
    } catch (err) { next(err); }
  });
  app.use('/api', seg.exigirCabeceraApp);

  // Perfil PROFESIONAL: solo su ficha, el PDF de su plan, su bitácora, el asistente (acotado a su información)
  // y el estado y el avance de sus propias actividades. Todo lo demás se rechaza aquí, antes de llegar a la ruta.
  const CAMPOS_PROFESIONAL = ['avance', 'estado', 'revision', 'motivo'];
  app.use('/api', async (req, res, next) => {
    if (!req.usuario || req.usuario.rol !== 'PROFESIONAL' || req.path.startsWith('/auth/')) return next();
    const mio = req.usuario.consultor_id;
    const denegar = (msg = 'Su perfil solo permite consultar y actualizar su propia información') => res.status(403).json({ error: msg });
    try {
      if (!mio) return denegar('Su cuenta no está vinculada a un profesional');
      const p = req.path; const m = req.method; let g;
      if (m === 'GET' && p === '/parametros') return next();
      if (p.startsWith('/formulacion/')) return next(); // formular su plan; el servicio exige que sea el suyo y su etapa
      if (m === 'POST' && p === '/ia/mensaje') return next();
      if (m === 'GET' && (g = p.match(/^\/consultores\/(\d+)$/))) return Number(g[1]) === mio ? next() : denegar();
      if (m === 'GET' && p === '/bitacora') return String(req.query.consultor_id) === String(mio) ? next() : denegar();
      if (m === 'GET' && (g = p.match(/^\/planes\/(\d+)\/pdf$/))) {
        const plan = (await servicio.datos()).planes.find((x) => x.plan_id === Number(g[1]));
        return plan && plan.consultor_id === mio ? next() : denegar();
      }
      if (m === 'PATCH' && (g = p.match(/^\/actividades\/(\d+)(?:\/subactividades\/\d+)?$/))) {
        const d = await servicio.datos();
        const act = d.actividades.find((x) => x.actividad_id === Number(g[1]));
        const plan = act && d.planes.find((x) => x.plan_id === act.plan_id);
        if (!plan || plan.consultor_id !== mio) return denegar();
        if (Object.keys(req.body || {}).some((k) => !CAMPOS_PROFESIONAL.includes(k))) return denegar('Solo puede modificar el avance y el estado de sus actividades');
        return next();
      }
      return denegar();
    } catch (err) { return next(err); }
  });

  // Almacén documental único (db/14): los PDF nuevos van a DOCUMENTOS_RAIZ con sus metadatos en sgf.documento;
  // los que ya estaban en las carpetas anteriores se siguen encontrando (adaptador `coleccion`).
  const almacen = crearAlmacen({
    repo, resolverProyecto: proyectoDeConsultor,
    raices: { ALMACEN: config.almacen, PLANES_PDF: config.planesPdf, ADENDAS_PDF: config.adendasPdf, ACTIVIDADES_PDF: config.actividadesPdf, CONTRATOS_PDF: config.contratosPdf, PLANES_ORIGEN: config.planesOrigen, DOCUMENTOS: config.documentos },
  });
  await almacen.cargar();
  const planesPdf = almacen.coleccion({ tipo: 'PLAN_TRABAJO', entidad: 'plan_trabajo', legado: crearPlanesPdf({ dir: config.planesPdf }) });
  const adendasPdf = almacen.coleccion({ tipo: 'ADENDA', entidad: 'adenda', legado: crearPlanesPdf({ dir: config.adendasPdf, prefijo: 'adenda' }) });
  // Orden de Servicio o contrato del personal: confidencial (monto, datos del contratado), decisión D4 y criterio C10
  const contratosPdf = almacen.coleccion({ tipos: ['ORDEN_SERVICIO', 'CONTRATO'], entidad: 'contrato', legado: crearPlanesPdf({ dir: config.contratosPdf, prefijo: 'contrato' }), confidencial: true });
  const tdrPdf = almacen.coleccion({ tipo: 'TDR', entidad: 'contrato', legado: crearPlanesPdf({ dir: config.contratosPdf, prefijo: 'tdr' }) }); // Términos de Referencia
  const documentos = crearDocumentos({ servicio, repo, dir: config.documentos, adendasPdf, almacen, extraerConIA: (a) => agente.extraerDocumento(a) });
  const actividadDocs = crearActividadDocs({ dir: config.actividadesPdf });
  const formulacion = crearFormulacion({ servicio, repo, docs: actividadDocs, planesPdf, almacen, leerDocumento: leerArchivo, extraerPlanConIA: (a) => agente.extraerDocumento({ ...a, modo: 'plan' }), dirOrigen: config.planesOrigen });
  const ctxF = (req) => ({ ...ctx(req), consultor_id: req.usuario.consultor_id, proyectos: req.usuario.rol === 'JEFE_PROYECTO' ? req.usuario.proyectos || [] : undefined });
  const ctx = (req) => ({ usuario: req.usuario.correo, nombre: req.usuario.nombre, rol: req.usuario.rol, origen: 'UI', motivo: (req.body && req.body.motivo) || null });
  // Cada manejador corre dentro del alcance del usuario (permisos.js): el repositorio rechaza escrituras fuera de su equipo
  const h = (fn) => (req, res, next) => permisos.ejecutarConAlcance(permisos.alcanceDe(req.usuario), () => Promise.resolve().then(() => fn(req, res)))
    .then((r) => { if (!res.headersSent) res.json(r ?? { ok: true }); }).catch(next);
  const contrataciones = crearContrataciones({ servicio, repo, almacen, leerDocumento: leerArchivo, extraerTdrConIA: (a) => agente.extraerDocumento({ ...a, modo: 'tdr' }) });
  const supervision = crearSupervision({ servicio, repo, almacen, contrataciones });
  const proyectos = crearProyectos({ servicio, almacen, contrataciones, leerDocumento: leerArchivo, extraerConIA: config.ia.claveApi ? (a, modo = 'proyecto') => agente.extraerDocumento({ ...a, modo }) : null });
  const lectorEntregables = crearLectorEntregables({ servicio, contrataciones, leerDocumento: leerArchivo, extraerConIA: config.ia.claveApi ? (a, modo) => agente.extraerDocumento({ ...a, modo }) : null });
  const cierre = crearCierre({ servicio, repo, almacen, contrataciones });
  // El monto de la Orden de Servicio es confidencial (D4): solo el Administrador y el equipo del proyecto lo ven
  const verMonto = async (req, consultorId) => permisos.puedeVerConfidencial(req.usuario, consultorId ? await proyectoDeConsultor(consultorId) : null);
  const sinMonto = (k) => { if (k) delete k.monto; return k; };
  const motivoDe = (req) => { let m = ''; try { m = decodeURIComponent(req.get('X-Motivo') || '').trim(); } catch { /* cabecera mal codificada */ } return m; };
  const nombreDe = (req) => { let n = ''; try { n = decodeURIComponent(req.get('X-Nombre') || '').trim(); } catch { /* cabecera mal codificada */ } return n.slice(0, 200); };

  // Recalcular una vez al día con la primera consulta
  let ultimoDia = hoyLima();
  app.use('/api', (req, _res, next) => {
    const hoy = hoyLima();
    if (hoy !== ultimoDia) { ultimoDia = hoy; servicio.recalculoDiario().catch((e) => console.error('[recalculo diario]', e.message)); }
    next();
  });

  // ------------------------------------------------------------ autenticación
  app.post('/api/auth/ingresar', seg.limitarIngreso, h(async (req, res) => {
    const { correo, clave } = req.body || {};
    const u = correo ? await repo.buscarUsuario(String(correo).trim()) : null;
    const ok = u && u.activo && (await seg.bcrypt.compare(String(clave || ''), u.clave_hash));
    if (!ok) { res.status(401).json({ error: 'Correo o clave incorrectos' }); return; }
    req.limpiarIntentos();
    await repo.actualizarUsuario(u.usuario_id, { ultimo_acceso: new Date() });
    seg.emitirSesion(res, u);
    await repo.registrarBitacora({ usuario: u.correo, entidad: 'sesion', accion: 'ACCESO', origen: 'UI' });
    return { usuario: { correo: u.correo, nombre: u.nombre, rol: u.rol, cambiarClave: !!u.debe_cambiar_clave } };
  }));
  app.post('/api/auth/salir', (req, res) => { res.clearCookie(seg.COOKIE, { path: '/' }); res.json({ ok: true }); });

  // Ingreso con Google Workspace (sso-google.js). Solo cuentas ya creadas por el Administrador y activas.
  const sso = crearSsoGoogle({ config: config.sso, secreto: seg.claveDerivada('oauth') });
  const COOKIE_SSO = { path: '/api/auth/google' };
  app.get('/api/auth/opciones', (req, res) => res.json({ google: sso.activo(), dominio: config.sso.dominio }));
  app.get('/api/auth/google', (req, res) => {
    if (!sso.activo()) return res.status(404).json({ error: 'El ingreso con Google no está habilitado' });
    const { url, cookie } = sso.iniciar();
    res.cookie(COOKIE_OAUTH, cookie, { ...COOKIE_SSO, httpOnly: true, sameSite: 'lax', secure: config.sesion.cookieSegura, maxAge: 10 * 60000 });
    return res.redirect(302, url);
  });
  app.get('/api/auth/google/retorno', seg.limitarIngreso, async (req, res) => {
    const volver = (codigo) => res.redirect(302, `/?sso_error=${encodeURIComponent(codigo)}`);
    const cookie = req.cookies && req.cookies[COOKIE_OAUTH];
    res.clearCookie(COOKIE_OAUTH, COOKIE_SSO);
    try {
      const g = await sso.retorno({ code: req.query.code, state: req.query.state, error: req.query.error, cookie });
      const u = await repo.buscarUsuario(g.correo);
      if (!u || !u.activo) {
        await repo.registrarBitacora({ usuario: g.correo, entidad: 'sesion', accion: 'ACCESO_RECHAZADO', origen: 'UI', motivo: `Ingreso con Google: ${u ? 'cuenta desactivada' : 'cuenta no registrada en la aplicación'}` });
        return volver(u ? 'inactivo' : 'no_registrado');
      }
      req.limpiarIntentos();
      const cambios = { ultimo_acceso: new Date() };
      // Si tenía una clave temporal sin cambiar, deja de valer: quien entra con Google no la necesita y nadie más debe usarla
      if (u.debe_cambiar_clave) Object.assign(cambios, { clave_hash: await seg.bcrypt.hash(require('crypto').randomBytes(32).toString('hex'), 11), debe_cambiar_clave: 0 });
      await repo.actualizarUsuario(u.usuario_id, cambios);
      seg.emitirSesion(res, { ...u, debe_cambiar_clave: 0 });
      await repo.registrarBitacora({ usuario: u.correo, entidad: 'sesion', accion: 'ACCESO', origen: 'UI', motivo: 'Ingreso con Google Workspace' });
      return res.redirect(302, '/');
    } catch (err) {
      if (!err.codigo || err.codigo === 'google') console.warn('[sso google]', err.message);
      return volver(err.codigo || 'google');
    }
  });
  app.get('/api/auth/yo', (req, res) => {
    if (!req.usuario) return res.status(401).json({ error: 'Sesión no iniciada' });
    res.json({ usuario: { correo: req.usuario.correo, nombre: req.usuario.nombre, rol: req.usuario.rol, consultor_id: req.usuario.consultor_id ?? null, proyectos: req.usuario.proyectos || [], cambiarClave: !!req.usuario.cambiar }, ia: !!config.ia.claveApi, modo: repo.tipo });
  });
  app.post('/api/auth/cambiar-clave', seg.requiere('LECTOR'), h(async (req, res) => {
    const { actual, nueva } = req.body || {};
    const u = await repo.buscarUsuarioId(req.usuario.id);
    if (!u || !(await seg.bcrypt.compare(String(actual || ''), u.clave_hash))) { res.status(400).json({ error: 'La clave actual no es correcta' }); return; }
    if (!seg.claveValida(nueva)) { res.status(400).json({ error: 'La nueva clave debe tener al menos 10 caracteres, con letras y números' }); return; }
    const act = await repo.actualizarUsuario(u.usuario_id, { clave_hash: await seg.bcrypt.hash(nueva, 11), debe_cambiar_clave: 0 });
    seg.emitirSesion(res, { ...u, ...act, debe_cambiar_clave: 0 });
    return { ok: true };
  }));

  // ------------------------------------------------------------ usuarios (solo el Administrador)
  const esAdminPrincipal = (correo) => !!config.admin.correo && String(correo).toLowerCase() === config.admin.correo.trim().toLowerCase();
  const correoValido = (c) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(c || '').trim());
  const err400 = (msg, estado = 400) => Object.assign(new Error(msg), { estado });
  /** Perfil PROFESIONAL: exige un consultor existente y sin otra cuenta; los demás perfiles no se vinculan. */
  async function vinculo(rol, consultorId, exceptoUsuarioId = null) {
    if (rol !== 'PROFESIONAL') return null;
    const id = Number(consultorId);
    const c = id && (await servicio.datos()).consultores.find((x) => x.consultor_id === id && x.activo !== 0 && x.activo !== false);
    if (!c) throw err400('Seleccione el profesional al que pertenece la cuenta');
    if ((await repo.listarUsuarios()).some((u) => u.consultor_id === id && u.usuario_id !== exceptoUsuarioId)) throw err400('Ese profesional ya tiene una cuenta', 409);
    return c;
  }
  app.get('/api/usuarios', seg.requiere('ADMIN'), h(() => repo.listarUsuarios()));
  app.post('/api/usuarios', seg.requiere('ADMIN'), h(async (req) => {
    const { correo, rol, consultor_id } = req.body || {};
    if (!correoValido(correo) || !seg.PERFILES.includes(rol)) throw err400('Correo y perfil válidos son obligatorios');
    const c = await vinculo(rol, consultor_id);
    const nombre = String((req.body && req.body.nombre) || (c && c.nombres) || '').trim();
    if (!nombre) throw err400('El nombre es obligatorio');
    const temporal = seg.generarClaveTemporal();
    const u = await repo.crearUsuario({ correo: correo.trim().toLowerCase(), nombre, rol, consultor_id: c ? c.consultor_id : null, clave_hash: await seg.bcrypt.hash(temporal, 11), debe_cambiar_clave: 1 });
    await repo.registrarBitacora({ usuario: req.usuario.correo, entidad: 'usuario', entidad_id: u.usuario_id, accion: 'CREAR', cambios_json: { correo: u.correo, rol, consultor_id: u.consultor_id ?? null } });
    return { usuario: u, clave_temporal: temporal };
  }));
  // Alta de varias cuentas PROFESIONAL a la vez (una por consultor, con su correo). Se valida todo antes de crear nada.
  app.post('/api/usuarios/profesionales', seg.requiere('ADMIN'), h(async (req) => {
    const cuentas = Array.isArray(req.body && req.body.cuentas) ? req.body.cuentas : [];
    if (!cuentas.length || cuentas.length > 50) throw err400('Indique entre 1 y 50 cuentas');
    const existentes = new Set((await repo.listarUsuarios()).map((u) => u.correo.toLowerCase()));
    const vistos = new Set();
    const plan = [];
    for (const x of cuentas) {
      const correo = String(x.correo || '').trim().toLowerCase();
      const c = await vinculo('PROFESIONAL', x.consultor_id);
      if (!correoValido(correo)) throw err400(`Correo no válido para ${c.nombres}`);
      if (existentes.has(correo) || vistos.has(correo)) throw err400(`El correo ${correo} ya está en uso`, 409);
      if (plan.some((p) => p.c.consultor_id === c.consultor_id)) throw err400(`${c.nombres} aparece dos veces`);
      vistos.add(correo); plan.push({ c, correo });
    }
    const creadas = [];
    for (const { c, correo } of plan) {
      const temporal = seg.generarClaveTemporal();
      const u = await repo.crearUsuario({ correo, nombre: c.nombres, rol: 'PROFESIONAL', consultor_id: c.consultor_id, clave_hash: await seg.bcrypt.hash(temporal, 11), debe_cambiar_clave: 1 });
      await repo.registrarBitacora({ usuario: req.usuario.correo, entidad: 'usuario', entidad_id: u.usuario_id, accion: 'CREAR', cambios_json: { correo, rol: 'PROFESIONAL', consultor_id: c.consultor_id } });
      creadas.push({ usuario_id: u.usuario_id, consultor_id: c.consultor_id, clave: c.clave, nombre: c.nombres, correo, clave_temporal: temporal });
    }
    return { cuentas: creadas };
  }));
  app.patch('/api/usuarios/:id', seg.requiere('ADMIN'), h(async (req) => {
    const id = Number(req.params.id);
    const destino = await repo.buscarUsuarioId(id);
    if (!destino) throw err400('Usuario no encontrado', 404);
    const b = req.body || {};
    const cambios = {};
    const principal = esAdminPrincipal(destino.correo);
    const propio = destino.usuario_id === req.usuario.id;
    if (b.rol !== undefined && b.rol !== destino.rol) {
      if (!seg.PERFILES.includes(b.rol)) throw err400('Perfil no válido');
      if (principal || propio) throw err400('No puede cambiar el perfil del administrador principal ni el de su propia cuenta');
      cambios.rol = b.rol;
    }
    const rolFinal = cambios.rol || destino.rol;
    if (b.activo !== undefined) {
      const activo = b.activo ? 1 : 0;
      if (!activo && (principal || propio)) throw err400('No puede desactivar al administrador principal ni su propia cuenta');
      if (activo !== (destino.activo ? 1 : 0)) cambios.activo = activo;
    }
    if (b.nombre && b.nombre !== destino.nombre) cambios.nombre = String(b.nombre).trim();
    // vínculo con el profesional: solo el perfil PROFESIONAL lo tiene
    const activoFinal = cambios.activo ?? (destino.activo ? 1 : 0);
    if (rolFinal === 'PROFESIONAL') {
      const nuevo = b.consultor_id !== undefined ? Number(b.consultor_id) || null : (destino.consultor_id ?? null);
      if (nuevo || activoFinal) await vinculo(rolFinal, nuevo, id);
      if (nuevo !== (destino.consultor_id ?? null)) cambios.consultor_id = nuevo;
    } else if (destino.consultor_id) cambios.consultor_id = null;
    let temporal = null;
    if (b.restablecer) { temporal = seg.generarClaveTemporal(); cambios.clave_hash = await seg.bcrypt.hash(temporal, 11); cambios.debe_cambiar_clave = 1; }
    const { clave_hash: _h, ...sinClave } = destino;
    const u = Object.keys(cambios).length ? await repo.actualizarUsuario(id, cambios) : sinClave;
    await repo.registrarBitacora({ usuario: req.usuario.correo, entidad: 'usuario', entidad_id: id, accion: 'MODIFICAR', cambios_json: { correo: destino.correo, ...cambios, clave_hash: cambios.clave_hash ? '(restablecida)' : undefined } });
    return { usuario: u, clave_temporal: temporal };
  }));

  // ------------------------------------------------------------ consultas
  // Entregables de la OS vigente (para la tarjeta del profesional y la línea de vigencia): sin montos
  const listaEntregables = (it) => it.entregables.filter((x) => !it.contrato || x.contrato_id === it.contrato.contrato_id).map((x) => ({
    numero: x.numero, nombre: x.nombre, estado: x.estado, fecha_limite: x.fecha_limite || null, fecha_presentacion: x.fecha_presentacion || null,
    fecha_subsanacion: x.fecha_subsanacion || null, fecha_conformidad: x.fecha_conformidad || null, porcentaje_pago: x.porcentaje_pago ?? null,
    semaforo: x.semaforo, vencido: !!x.vencido, dias_atraso: x.dias_atraso ?? null,
  }));
  app.get('/api/estado', seg.requiere('LECTOR'), h(async (req) => {
    const e = await servicio.estado({ corte: req.query.corte, proyecto_id: req.query.proyecto_id });
    return {
      corte: e.corte, metodo: e.metodo, indicadores: e.indicadores, alertas: e.alertas, resumen_entregables: e.entregables,
      consultores: e.consultores.map((it) => ({
        consultor_id: it.consultor.consultor_id, clave: it.consultor.clave, nombres: it.consultor.nombres, perfil: it.consultor.perfil, proyecto_id: it.consultor.proyecto_id ?? null,
        contrato: it.contrato && it.contrato.numero, expediente: it.contrato && it.contrato.expediente,
        vigencia: { ...it.vigencia },
        historial_adendas: it.adendas.filter((a) => a.estado === 'CONCLUIDA').sort((a, b) => a.numero - b.numero)
          .map((a) => ({ numero: a.numero, fecha_inicio: a.fecha_inicio, fecha_fin: a.fecha_fin, plazo_dias: a.plazo_dias ?? null, plazo_solicitado_dias: a.plazo_solicitado_dias ?? null })),
        cobertura: it.cobertura,
        plan: it.plan && { plan_id: it.plan.plan_id, estado: it.plan.estado, nombre: it.plan.nombre, fecha_aprobacion: it.plan.fecha_aprobacion || null, fecha_subsanacion: it.plan.fecha_subsanacion || null, observacion_revision: it.plan.observacion_revision || null, tiene_pdf: planesPdf.info(it.plan.plan_id).existe,
          dias_aprobacion: (() => { const a = it.plan.fecha_aprobacion && it.adendas.find((x) => x.adenda_id === it.plan.adenda_id); return a && a.fecha_suscripcion ? aDia(it.plan.fecha_aprobacion) - aDia(a.fecha_suscripcion) : null; })() },
        pronostico: it.pronostico && { ...it.pronostico, actividades: undefined },
        atrasadas: it.pronostico ? Object.values(it.pronostico.actividades).filter((a) => ['ATRASADA', 'SIN_INICIAR_VENCIDA'].includes(a.situacion)).length : 0,
        alertas: e.alertas.filter((a) => a.consultor_id === it.consultor.consultor_id).length,
        estado_contratacion: it.contrato ? it.contrato.estado_contratacion || null : null,
        entregables: { total: it.entregables.length, vencidos: it.entregables.filter((x) => x.vencido).length, semaforo: it.semaforo_entregables, lista: listaEntregables(it) },
      })),
    };
  }));
  app.get('/api/consultores/:id', seg.requiere('LECTOR'), h(async (req) => {
    const det = await servicio.detalleConsultor(req.params.id, { verPersonales: req.usuario.rol === 'ADMIN', corte: req.query.corte });
    if (!(await verMonto(req, det.consultor.consultor_id))) { det.contrato = sinMonto(det.contrato && { ...det.contrato }); det.contrataciones = (det.contrataciones || []).map((k) => sinMonto({ ...k })); }
    return { ...det, plan_pdf: det.plan ? planesPdf.info(det.plan.plan_id) : { existe: false } };
  }));

  // PDF del plan aprobado: se muestra en el visor de la ficha (iframe del mismo origen) y lo adjunta un EDITOR.
  const planDe = async (id) => {
    const plan = (await servicio.datos()).planes.find((p) => p.plan_id === Number(id) && p.activo !== 0 && p.activo !== false);
    if (!plan) throw Object.assign(new Error('Plan no encontrado'), { estado: 404 });
    return plan;
  };
  app.get('/api/planes/:id/pdf', seg.requiere('LECTOR'), (req, res, next) => {
    planDe(req.params.id).then((plan) => {
      if (!planesPdf.info(plan.plan_id).existe) throw Object.assign(new Error('El plan no tiene un PDF adjunto'), { estado: 404 });
      res.set({
        'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="plan-${plan.plan_id}.pdf"`, 'Cache-Control': 'private, no-store',
        'X-Frame-Options': 'SAMEORIGIN', 'Content-Security-Policy': "default-src 'self'; frame-ancestors 'self'",
      });
      res.sendFile(planesPdf.ruta(plan.plan_id), (err) => { if (err && !res.headersSent) next(err); });
    }).catch(next);
  });
  // PUT y POST: algunos IIS (módulo WebDAV) rechazan PUT; el cliente usa POST
  const guardarPdfPlan = h(async (req) => {
    const plan = await planDe(req.params.id);
    const motivo = motivoDe(req);
    if (motivo.length < 5) throw Object.assign(new Error('Indique el motivo (mínimo 5 caracteres)'), { estado: 400, requiereMotivo: true });
    await planesPdf.guardar(plan.plan_id, req.body, { usuario: req.usuario.correo, motivo, origen: 'UI', consultor_id: plan.consultor_id, nombre: nombreDe(req) || `plan-${plan.plan_id}.pdf` });
    return { ok: true, ...planesPdf.info(plan.plan_id) };
  });
  for (const metodo of ['put', 'post']) app[metodo]('/api/planes/:id/pdf', seg.requiere('EDITOR'), express.raw({ type: 'application/pdf', limit: planesPdf.MAX_BYTES }), guardarPdfPlan);
  // Formulación del plan de trabajo (plantilla del cronograma): cada dato se graba al registrarlo; el flujo y los permisos los impone el servicio.
  app.get('/api/formulacion/historial', seg.requiere('EDITOR'), h((req) => formulacion.historialGeneral(ctxF(req))));
  app.get('/api/formulacion/:id', seg.requiere('LECTOR'), h((req) => formulacion.detalle(req.params.id, ctxF(req))));
  app.put('/api/formulacion/:id/cabecera', seg.requiere('LECTOR'), h((req) => formulacion.guardarCabecera(req.params.id, req.body || {}, ctxF(req))));
  // Registrar un plan ya elaborado en un documento (Excel/CSV, PDF o Word): vista previa y confirmación
  app.post('/api/formulacion/:id/plan-documento/previsualizar', seg.requiere('LECTOR'), express.raw({ type: 'application/octet-stream', limit: 50 * 1024 * 1024 }), h((req) => {
    let nombre = '';
    try { nombre = decodeURIComponent(req.get('X-Nombre') || '').trim(); } catch { /* cabecera mal codificada */ }
    if (!nombre) throw Object.assign(new Error('Falta el nombre del archivo'), { estado: 400 });
    return formulacion.previsualizarPlan(req.params.id, { buffer: req.body, nombre: nombre.slice(0, 200) }, ctxF(req));
  }));
  app.post('/api/formulacion/:id/plan-documento/aplicar', seg.requiere('LECTOR'), h((req) => formulacion.aplicarPlan(req.params.id, req.body || {}, ctxF(req))));
  app.get('/api/formulacion/:id/plan-documento', seg.requiere('LECTOR'), (req, res, next) => {
    formulacion.rutaOrigen(req.params.id, ctxF(req)).then(({ archivo, nombre }) => {
      const pdf = /\.pdf$/i.test(archivo);
      res.set({ 'Content-Type': pdf ? 'application/pdf' : 'application/octet-stream', 'Content-Disposition': `${pdf ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(nombre)}`, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store' });
      res.sendFile(archivo, (err) => { if (err && !res.headersSent) next(err); });
    }).catch(next);
  });
  app.post('/api/formulacion/:id/actividades', seg.requiere('LECTOR'), h((req) => formulacion.agregarActividad(req.params.id, req.body || {}, ctxF(req))));
  app.patch('/api/formulacion/actividades/:id', seg.requiere('LECTOR'), h((req) => formulacion.modificarActividad(req.params.id, req.body || {}, ctxF(req))));
  // Documentos PDF de respaldo de cada actividad
  app.post('/api/formulacion/actividades/:id/documentos', seg.requiere('LECTOR'), express.raw({ type: 'application/pdf', limit: actividadDocs.MAX_BYTES }), h((req) => {
    let nombre = ''; try { nombre = decodeURIComponent(req.get('X-Nombre') || ''); } catch { /* cabecera mal codificada */ }
    return formulacion.agregarDocumento(req.params.id, req.body, nombre, ctxF(req));
  }));
  app.post('/api/formulacion/actividades/:id/documentos/:n/quitar', seg.requiere('LECTOR'), h((req) => formulacion.quitarDocumento(req.params.id, req.params.n, ctxF(req))));
  app.get('/api/formulacion/actividades/:id/documentos/:n', seg.requiere('LECTOR'), (req, res, next) => {
    formulacion.rutaDocumento(req.params.id, req.params.n, ctxF(req)).then((r) => {
      res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${encodeURIComponent(r.nombre)}"`, 'Cache-Control': 'private, no-store', 'X-Frame-Options': 'SAMEORIGIN', 'Content-Security-Policy': "default-src 'self'; frame-ancestors 'self'" });
      res.sendFile(r.archivo, (err) => { if (err && !res.headersSent) next(err); });
    }).catch(next);
  });
  app.post('/api/formulacion/actividades/:id/quitar', seg.requiere('LECTOR'), h((req) => formulacion.quitarActividad(req.params.id, ctxF(req))));
  app.post('/api/formulacion/:id/transicion', seg.requiere('LECTOR'), h((req) => formulacion.transicion(req.params.id, (req.body || {}).accion, (req.body || {}).comentario, ctxF(req))));
  // PDF del plan aprobado: lo genera solo el Administrador y queda como el PDF del plan (versión anterior conservada)
  app.post('/api/formulacion/:id/pdf', seg.requiere('ADMIN'), h(async (req) => {
    const g = await formulacion.generarPdf(req.params.id, ctxF(req));
    await planesPdf.guardar(g.plan_id, g.buffer, { usuario: req.usuario.correo, motivo: 'PDF del plan de trabajo aprobado generado por el Administrador', origen: 'UI', consultor_id: g.consultor_id, nombre: `plan-trabajo-${g.plan_id}.pdf` });
    return { ok: true, plan_id: g.plan_id, ...planesPdf.info(g.plan_id) };
  }));
  // Revisión del plan: aprobarlo u observarlo (con observación y plazo para subsanar). Exige el PDF del plan.
  app.post('/api/planes/:id/revision', seg.requiere('EDITOR'), h(async (req) => {
    const plan = await planDe(req.params.id);
    if (!planesPdf.info(plan.plan_id).existe) throw Object.assign(new Error('Cargue primero el PDF del plan de trabajo'), { estado: 400 });
    return servicio.revisarPlan(plan.plan_id, req.body || {}, ctx(req));
  }));
  // PDF de cada adenda: lo muestra el visor de Contratos y adendas y lo adjunta un EDITOR (mismo mecanismo que el plan).
  const adendaDe = async (id) => {
    const d = await servicio.datos();
    const a = d.adendas.find((x) => x.adenda_id === Number(id) && x.activo !== 0 && x.activo !== false);
    if (!a) throw Object.assign(new Error('Adenda no encontrada'), { estado: 404 });
    return { a, consultor_id: (d.contratos.find((k) => k.contrato_id === a.contrato_id) || {}).consultor_id };
  };
  app.get('/api/adendas/:id/pdf', seg.requiere('LECTOR'), (req, res, next) => {
    adendaDe(req.params.id).then(({ a }) => {
      if (!adendasPdf.info(a.adenda_id).existe) throw Object.assign(new Error('SIN ADENDA REGISTRADA EN EL SISTEMA'), { estado: 404 });
      res.set({
        'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="adenda-${a.adenda_id}.pdf"`, 'Cache-Control': 'private, no-store',
        'X-Frame-Options': 'SAMEORIGIN', 'Content-Security-Policy': "default-src 'self'; frame-ancestors 'self'",
      });
      res.sendFile(adendasPdf.ruta(a.adenda_id), (err) => { if (err && !res.headersSent) next(err); });
    }).catch(next);
  });
  const guardarPdfAdenda = h(async (req) => {
    const { a, consultor_id } = await adendaDe(req.params.id);
    const motivo = motivoDe(req);
    if (motivo.length < 5) throw Object.assign(new Error('Indique el motivo (mínimo 5 caracteres)'), { estado: 400, requiereMotivo: true });
    await adendasPdf.guardar(a.adenda_id, req.body, { usuario: req.usuario.correo, motivo, origen: 'UI', consultor_id, nombre: nombreDe(req) || `adenda-${a.adenda_id}.pdf` });
    return { ok: true, ...adendasPdf.info(a.adenda_id) };
  });
  // PUT y POST: algunos IIS (módulo WebDAV) rechazan PUT con 405; la interfaz usa POST.
  for (const metodo of ['put', 'post']) app[metodo]('/api/adendas/:id/pdf', seg.requiere('EDITOR'), express.raw({ type: 'application/pdf', limit: adendasPdf.MAX_BYTES }), guardarPdfAdenda);
  app.get('/api/linea-base', seg.requiere('LECTOR'), h((req) => servicio.lineaBase({ proyecto_id: req.query.proyecto_id })));
  // Plan de trabajo aprobado de la adenda (si su PDF existe): la lista de adendas lo muestra en «Documento»
  const planAprobadoDe = (d, a) => {
    const p = d.planes.filter((x) => x.adenda_id === a.adenda_id && x.estado === 'APROBADO' && x.activo !== 0 && x.activo !== false).sort((x, y) => y.plan_id - x.plan_id)[0];
    return p && planesPdf.info(p.plan_id).existe ? { plan_aprobado: { plan_id: p.plan_id, fecha_aprobacion: p.fecha_aprobacion || null } } : {};
  };
  app.get('/api/adendas', seg.requiere('LECTOR'), h(async (req) => {
    const d = await servicio.datos();
    const pid = req.query.proyecto_id ? Number(req.query.proyecto_id) : null;
    const enProyecto = (a) => { if (!pid) return true; const k = d.contratos.find((x) => x.contrato_id === a.contrato_id); const c = k && d.consultores.find((x) => x.consultor_id === k.consultor_id); return !!c && c.proyecto_id === pid; };
    return d.adendas.filter(enProyecto).map((a) => {
      const k = d.contratos.find((x) => x.contrato_id === a.contrato_id) || {};
      const c = d.consultores.find((x) => x.consultor_id === k.consultor_id) || {};
      return { ...a, contrato: k.numero, consultor_id: c.consultor_id, clave: c.clave, nombres: c.nombres, tiene_pdf: adendasPdf.info(a.adenda_id).existe, ...planAprobadoDe(d, a) };
    }).sort((x, y) => (x.clave || '').localeCompare(y.clave || '') || x.numero - y.numero);
  }));
  app.get('/api/bitacora', seg.requiere('LECTOR'), h(async (req) => {
    const filas = await repo.listarBitacora({ consultor_id: req.query.consultor_id, entidad: req.query.entidad, entidad_id: req.query.entidad_id, proyecto_id: req.query.proyecto_id, limite: req.query.limite });
    const d = await servicio.datos();
    const proyectoDe = new Map(d.consultores.map((c) => [c.consultor_id, c.proyecto_id]));
    return servicio.sanearBitacora(filas, { verPersonales: req.usuario.rol === 'ADMIN', verMonto: (f) => permisos.puedeVerConfidencial(req.usuario, f.consultor_id ? proyectoDe.get(f.consultor_id) ?? null : null) });
  }));
  app.get('/api/historial/:entidad/:id', seg.requiere('LECTOR'), h(async (req) => {
    const filas = await repo.historialEntidad(req.params.entidad, req.params.id);
    if (req.usuario.rol !== 'ADMIN') for (const f of filas) { delete f.dni; delete f.telefono; delete f.correo_personal; }
    if (req.params.entidad === 'contrato' && filas.length && !(await verMonto(req, filas[0].consultor_id))) for (const f of filas) delete f.monto;
    return filas;
  }));
  app.get('/api/parametros', seg.requiere('LECTOR'), h(async () => { const d = await servicio.datos(); return { parametros: d.parametros, feriados: d.feriados, corte_vigente: await servicio.corteVigente() }; }));
  app.get('/api/ia/uso', seg.requiere('JEFE_PROYECTO'), h(() => repo.usoIA()));

  // Exportación CSV (abre en Excel con separador ;)
  app.get('/api/exportar/actividades.csv', seg.requiere('LECTOR'), async (req, res, next) => {
    try {
      const e = await servicio.estado({ proyecto_id: req.query.proyecto_id });
      const cols = ['clave', 'consultor', 'numero', 'descripcion', 'clasificacion', 'edt', 'inicio_plan', 'fin_plan', 'inicio_real', 'fin_real', 'avance', 'estado', 'inicio_probable', 'fin_probable', 'desvio_dias', 'situacion', 'critica', 'fin_vigencia'];
      const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const filas = [cols.join(';')];
      for (const it of e.consultores) for (const a of it.actividades) {
        const p = it.pronostico && it.pronostico.actividades[a.actividad_id];
        filas.push([it.consultor.clave, it.consultor.nombres, a.numero, a.descripcion, a.clasificacion, a.edt_ref, a.inicio_plan, a.fin_plan, a.inicio_real, a.fin_real, a.avance, a.estado, p && p.inicio_probable, p && p.fin_probable, p && p.desvio_dias, p && p.situacion, p && p.critica ? 'SI' : '', it.vigencia.fin_vigencia].map(esc).join(';'));
      }
      res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="actividades_corte_${e.corte}.csv"` });
      res.send(`﻿${filas.join('\r\n')}`);
    } catch (err) { next(err); }
  });

  // ------------------------------------------------------------ escrituras (EDITOR)
  app.patch('/api/actividades/:id', seg.requiere('PROFESIONAL'), (req, res, next) => (req.usuario.rol === 'PROFESIONAL' ? next() : seg.requiere('JEFE_PROYECTO')(req, res, next)), h((req) => servicio.actualizarActividad(req.params.id, req.body, ctx(req))));
  app.post('/api/planes/:id/actividades', seg.requiere('EDITOR'), h((req) => servicio.crearActividad(req.params.id, req.body, ctx(req))));
  app.post('/api/actividades/:id/anular', seg.requiere('EDITOR'), h((req) => servicio.anularActividad(req.params.id, ctx(req))));
  app.patch('/api/actividades/:id/subactividades/:k', seg.requiere('PROFESIONAL'), (req, res, next) => (req.usuario.rol === 'PROFESIONAL' ? next() : seg.requiere('JEFE_PROYECTO')(req, res, next)), h((req) => servicio.actualizarSubactividad(req.params.id, req.params.k, req.body.avance, req.body.revision, ctx(req))));
  app.put('/api/actividades/:id/predecesoras', seg.requiere('EDITOR'), h((req) => servicio.definirDependencias(req.params.id, req.body.predecesoras, ctx(req))));
  app.post('/api/planes/:id/adoptar-pronostico', seg.requiere('EDITOR'), h((req) => servicio.adoptarPronostico(req.params.id, ctx(req))));
  app.post('/api/simular', seg.requiere('LECTOR'), h((req) => servicio.simular(req.body.cambios, { corte: req.body.corte })));
  app.post('/api/recalcular', seg.requiere('EDITOR'), h((req) => servicio.recalcularYGuardar(req.usuario.correo, (req.body && req.body.motivo) || 'Recálculo manual')));

  // Proyectos: lista con sus cifras y alta de profesionales dentro de un proyecto (Jefe de Proyecto y Administrador)
  app.get('/api/proyectos', seg.requiere('LECTOR'), h(async (req) => {
    const d = await servicio.datos();
    const e = await servicio.estado();
    const alcance = permisos.alcanceDe(req.usuario);
    const vivos = d.proyectos.filter((p) => p.activo !== 0 && p.activo !== false);
    const equipos = Object.fromEntries(await Promise.all(vivos.map(async (p) => [p.proyecto_id, await servicio.equipoDe(p.proyecto_id)])));
    return vivos.map((p) => {
      const items = e.consultores.filter((it) => it.consultor.proyecto_id === p.proyecto_id);
      const equipo = equipos[p.proyecto_id].map(({ miembro_id, usuario_id, nombre, es_responsable }) => ({ miembro_id, usuario_id, nombre, es_responsable }));
      // Documentos del proyecto (TDR y Orden de Servicio, la versión vigente); la OS es confidencial (D4)
      const documentos = ['TDR', 'ORDEN_SERVICIO'].map((t) => almacen.vigente(t, 'proyecto', p.proyecto_id)).filter(Boolean)
        .map((f) => (f.confidencial && !permisos.puedeVerConfidencial(req.usuario, p.proyecto_id) ? { tipo: f.tipo, oculto: true } : { documento_id: f.documento_id, tipo: f.tipo, nombre_original: f.nombre_original, version: f.version, subido_en: f.subido_en }));
      return {
        ...p, documentos, profesionales: items.length, activos: items.filter((it) => it.consultor.estado === 'ACTIVO').length, planes_aprobados: items.filter((it) => it.plan && it.plan.estado === 'APROBADO').length,
        equipo, responsable: (equipo.find((m) => m.es_responsable) || {}).nombre || null, escribe: req.usuario.rol !== 'PROFESIONAL' && permisos.puedeEscribirProyecto(alcance, p.proyecto_id),
      };
    });
  }));
  // Equipo del proyecto (db/15): lo ven todos los perfiles de la OTI; solo el Administrador lo define
  app.get('/api/proyectos/:id/equipo', seg.requiere('EDITOR'), h((req) => servicio.equipoDe(req.params.id)));
  app.post('/api/proyectos/:id/equipo', seg.requiere('ADMIN'), h((req) => servicio.agregarMiembro(req.params.id, req.body || {}, ctx(req))));
  app.patch('/api/proyectos/:id/equipo/:mid', seg.requiere('ADMIN'), h((req) => servicio.actualizarMiembro(req.params.id, req.params.mid, req.body || {}, ctx(req))));
  app.post('/api/proyectos/:id/equipo/:mid/quitar', seg.requiere('ADMIN'), h((req) => servicio.quitarMiembro(req.params.id, req.params.mid, { ...ctx(req), revision: req.body?.revision })));
  // Documentos del almacén (db/14): lista por entidad y descarga con control de permiso (los confidenciales, solo el equipo)
  const docPublico = (f) => ({ documento_id: f.documento_id, tipo: f.tipo, entidad: f.entidad, entidad_id: f.entidad_id, proyecto_id: f.proyecto_id, nombre_original: f.nombre_original, tipo_mime: f.tipo_mime, bytes: f.bytes, sha256: f.sha256, version: f.version, confidencial: !!f.confidencial, subido_por: f.subido_por, subido_en: f.subido_en });
  app.get('/api/documentos', seg.requiere('EDITOR'), h((req) => {
    if (!req.query.entidad) throw Object.assign(new Error('Indique la entidad'), { estado: 400 });
    return almacen.deEntidad(String(req.query.entidad), req.query.entidad_id ? Number(req.query.entidad_id) : null).filter(f => !f.confidencial || permisos.puedeVerConfidencial(req.usuario, f.proyecto_id)).map(docPublico);
  }));
  app.get('/api/documentos/:id(\\d+)/archivo', seg.requiere('EDITOR'), (req, res, next) => {
    try {
      const f = almacen.buscar(req.params.id);
      if (!f) throw Object.assign(new Error('Documento no encontrado'), { estado: 404 });
      if (f.confidencial && !permisos.puedeVerConfidencial(req.usuario, f.proyecto_id)) throw Object.assign(new Error('Documento confidencial: solo lo ven el Administrador y el equipo del proyecto'), { estado: 403 });
      const archivo = almacen.rutaAbsoluta(f);
      if (!archivo) throw Object.assign(new Error('Ubicación del documento no válida'), { estado: 404 });
      const enLinea = /^(application\/pdf|image\/)/.test(f.tipo_mime) && req.query.descargar !== '1';
      res.set({ 'Content-Type': f.tipo_mime, 'Content-Disposition': `${enLinea ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.nombre_original)}`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'SAMEORIGIN', 'Content-Security-Policy': "default-src 'self'; frame-ancestors 'self'" });
      res.sendFile(archivo, (err) => { if (err && !res.headersSent) next(Object.assign(new Error('El archivo no está en disco'), { estado: 404 })); });
    } catch (e) { next(e); }
  });
  // Expediente del proyecto (§8 del plan): todos sus documentos por tipo, con lo que respalda cada uno y su versión
  app.get('/api/proyectos/:id/expediente', seg.requiere('EDITOR'), h(async (req) => {
    const d = await servicio.datos();
    const proy = d.proyectos.find((p) => p.proyecto_id === Number(req.params.id) && p.activo !== 0 && p.activo !== false);
    if (!proy) throw Object.assign(new Error('Proyecto no encontrado'), { estado: 404 });
    const docs = almacen.deProyecto(proy.proyecto_id);
    const partes = docs.some((f) => f.entidad === 'parte_diario') ? await repo.listarPartes({ proyecto_id: proy.proyecto_id, limite: 1000 }) : [];
    const r = construirExpediente({ documentos: docs, datos: d, proyecto_id: proy.proyecto_id, partes, verConfidencial: permisos.puedeVerConfidencial(req.usuario, proy.proyecto_id) });
    return { proyecto: { proyecto_id: proy.proyecto_id, codigo: proy.codigo, nombre: proy.nombre }, ...r };
  }));
  app.get('/api/proyectos/jefes', seg.requiere('LECTOR'), h(() => servicio.JEFES_PROYECTO));
  app.get('/api/proyectos/areas', seg.requiere('LECTOR'), h(() => servicio.AREAS_TECNICAS));
  // Profesionales de un proyecto con el vencimiento de su Orden de Servicio / contrato y sus documentos
  app.get('/api/proyectos/:id/profesionales', seg.requiere('LECTOR'), h(async (req) => {
    const d = await servicio.datos();
    const proy = d.proyectos.find((p) => p.proyecto_id === Number(req.params.id) && p.activo !== 0);
    if (!proy) throw Object.assign(new Error('Proyecto no encontrado'), { estado: 404 });
    const e = await servicio.estado({ proyecto_id: proy.proyecto_id });
    const conMonto = permisos.puedeVerConfidencial(req.usuario, proy.proyecto_id);
    return e.consultores.map((it) => {
      const k = it.contrato; const v = it.vigencia;
      const dias = v.dias_restantes;
      const situacion = k && k.estado_contratacion === 'REGISTRADA' && dias === null ? 'SIN_NOTIFICAR' : dias === null || dias === undefined ? 'SIN_PERIODO' : dias < 0 ? 'VENCIDA' : dias <= e.umbralVigencia ? 'POR_VENCER' : 'VIGENTE';
      const pendientes = it.entregables.filter((x) => !['CONFORME', 'ANULADO'].includes(x.estado) && (!k || x.contrato_id === k.contrato_id));
      const notif = k && almacen.vigente('NOTIFICACION', 'contrato', k.contrato_id);
      return {
        consultor_id: it.consultor.consultor_id, clave: it.consultor.clave, nombres: it.consultor.nombres, perfil: it.consultor.perfil, estado: it.consultor.estado,
        contrato_id: k ? k.contrato_id : null, numero: k ? k.numero : null, tipo_documento: (k && k.tipo_documento) || 'CONTRATO',
        estado_contratacion: k ? k.estado_contratacion || null : null, fecha_registro: k ? k.fecha_registro || null : null,
        fecha_notificacion: k ? k.fecha_notificacion || null : null, medio_notificacion: k ? k.medio_notificacion || null : null,
        plazo_dias: k ? k.plazo_dias ?? null : null, fecha_inicio: k ? k.fecha_inicio || null : null, fecha_fin: k ? k.fecha_fin || null : null,
        monto: conMonto && k ? k.monto ?? null : undefined, contrataciones: it.contratos.length, revision: k ? k.revision : null,
        fin_vigencia: v.fin_vigencia, dias_restantes: dias ?? null, situacion,
        documento: k ? contratosPdf.info(k.contrato_id) : { existe: false }, tdr: k ? tdrPdf.info(k.contrato_id) : { existe: false },
        notificacion: notif ? { existe: true, documento_id: notif.documento_id } : { existe: false },
        entregables: { total: it.entregables.filter((x) => !k || x.contrato_id === k.contrato_id).length, pendientes: pendientes.length, vencidos: pendientes.filter((x) => x.vencido).length, semaforo: it.semaforo_entregables,
          lista: listaEntregables(it),
          proximo: pendientes.filter((x) => x.fecha_limite && ['PENDIENTE', 'OBSERVADO'].includes(x.estado)).sort((a, b) => a.fecha_limite.localeCompare(b.fecha_limite)).map((x) => ({ numero: x.numero, nombre: x.nombre, fecha_limite: x.fecha_limite, semaforo: x.semaforo, motivo: x.motivo }))[0] || null },
      };
    });
  }));
  // ------------------------------------------------------------ contrataciones por Orden de Servicio (Etapa 2, db/17)
  app.get('/api/modalidades', seg.requiere('LECTOR'), h(() => modalidades.publico()));
  // PDF que se sube antes de registrar la OS o la notificación (queda en memoria una hora; se guarda al registrar)
  // ?formato=evidencia admite también imágenes, Word y Excel (partes diarios y entregables, Etapa 3)
  app.post('/api/documentos/temporales', seg.requiere('EDITOR'), express.raw({ type: () => true, limit: 15 * 1024 * 1024 }), h((req) => contrataciones.subirTemporal(req.body, nombreDe(req), ctx(req), { evidencia: req.query.formato === 'evidencia' })));
  // Lectura del TDR con IA para precargar el registro (no escribe nada; el usuario revisa y confirma)
  app.post('/api/contrataciones/leer-tdr', seg.requiere('EDITOR'), h((req) => contrataciones.leerTdr((req.body || {}).documento, ctx(req))));
  // Lee la OS y el TDR (los del proyecto o PDF temporales) y propone los datos del registro; no escribe. La OS es
  // confidencial: solo el Administrador y el equipo del proyecto la leen (y reciben el monto que declara).
  app.post('/api/proyectos/:id/contrataciones/leer-documentos', seg.requiere('EDITOR'), h((req) => {
    if (!permisos.puedeVerConfidencial(req.usuario, Number(req.params.id))) throw Object.assign(new Error('Solo el Administrador y el equipo del proyecto leen su Orden de Servicio'), { estado: 403 });
    return proyectos.leerOrdenServicio(req.params.id, (req.body || {}).documentos, ctx(req));
  }));
  app.post('/api/proyectos/:id/contrataciones', seg.requiere('EDITOR'), h(async (req) => {
    const r = await contrataciones.registrar(req.params.id, req.body || {}, ctx(req));
    return { ...r, contrato: { ...r.contrato } };
  }));
  app.get('/api/contratos/:id/entregables', seg.requiere('EDITOR'), h(async (req) => {
    const d = await servicio.datos();
    const k = d.contratos.find((x) => x.contrato_id === Number(req.params.id) && x.activo !== 0);
    if (!k) throw Object.assign(new Error('Orden de Servicio no encontrada'), { estado: 404 });
    const e = await servicio.estado();
    const it = e.consultores.find((x) => x.consultor.consultor_id === k.consultor_id);
    const contrato = { ...k };
    if (!(await verMonto(req, k.consultor_id))) delete contrato.monto;
    const docs = (x) => almacen.deEntidad('entregable_servicio', x.entregable_servicio_id).map((f) => ({ documento_id: f.documento_id, tipo: f.tipo, nombre: f.nombre_original, subido_en: f.subido_en }));
    return { contrato, entregables: it ? it.entregables.filter((x) => x.contrato_id === k.contrato_id).map((x) => ({ ...x, documentos: docs(x) })) : [], corte: e.corte };
  }));
  app.post('/api/contratos/:id/entregables', seg.requiere('EDITOR'), h((req) => contrataciones.reemplazarEntregables(req.params.id, (req.body || {}).entregables, (req.body || {}).revision, ctx(req))));
  app.post('/api/contratos/:id/notificacion/previsualizar', seg.requiere('EDITOR'), h((req) => contrataciones.previsualizarNotificacion(req.params.id, req.body || {})));
  app.post('/api/contratos/:id/notificacion', seg.requiere('EDITOR'), h((req) => contrataciones.notificar(req.params.id, req.body || {}, ctx(req))));
  // ------------------------------------------------------------ tablero general (Etapa 4): todos los proyectos
  // Lo ven el Administrador y los Jefes de Proyecto (D2: todos los proyectos). El monto, solo en los proyectos propios (D4).
  async function portafolio(req, corte = req.query.corte) {
    const d = await servicio.datos();
    const e = await servicio.estado({ corte });
    const vivos = d.proyectos.filter((p) => p.activo !== 0 && p.activo !== false);
    const equipos = Object.fromEntries(await Promise.all(vivos.map(async (p) => [p.proyecto_id, await servicio.equipoDe(p.proyecto_id)])));
    const r = construirPortafolio(d, e, { equipos });
    const alcance = permisos.alcanceDe(req.usuario);
    for (const f of r.proyectos) {
      f.escribe = permisos.puedeEscribirProyecto(alcance, f.proyecto_id);
      f.mio = req.usuario.rol === 'ADMIN' || (req.usuario.proyectos || []).includes(f.proyecto_id);
      if (!permisos.puedeVerConfidencial(req.usuario, f.proyecto_id)) { delete f.monto_comprometido; delete f.monto_conforme; }
    }
    return { ...r, montos: totalesMonto(r.proyectos), datos: d, estado: e };
  }
  const sinInternos = ({ datos, estado, ...r }) => r; // la foto y el estado completos no salen por la API
  app.get('/api/portafolio', seg.requiere('EDITOR'), h(async (req) => sinInternos(await portafolio(req))));
  // Reporte mensual para Gerencia (Etapa 5): corte al último día del mes (o hoy si el mes está en curso)
  // sinMontos: quita los montos del reporte aunque el usuario pueda verlos (envío por correo sin REPORTE_MENSUAL_MONTOS)
  async function reporteMensual(usuario, mesPedido, { sinMontos = false } = {}) {
    const hoy = hoyLima();
    const mes = mesPedido || hoy.slice(0, 7);
    const { desde, hasta } = rangoMes(mes);
    if (desde > hoy) throw Object.assign(new Error('El mes aún no empieza'), { estado: 400 });
    const p = await portafolio({ usuario, query: {} }, hasta < hoy ? hasta : hoy);
    if (sinMontos) { for (const f of p.proyectos) { delete f.monto_comprometido; delete f.monto_conforme; } p.montos = null; }
    const partes = await repo.listarPartes({ desde, hasta, limite: 1000 });
    return construirReporte({ mes, datos: p.datos, estado: p.estado, portafolio: p, partes, montos: p.montos, generado_por: usuario.nombre || usuario.correo, generado_en: new Date().toLocaleString('es-PE', { timeZone: 'America/Lima' }) });
  }
  app.get('/api/reportes/mensual', seg.requiere('EDITOR'), h((req) => reporteMensual(req.usuario, req.query.mes)));
  app.get('/api/reportes/mensual.pdf', seg.requiere('EDITOR'), (req, res, next) => {
    permisos.ejecutarConAlcance(permisos.alcanceDe(req.usuario), () => reporteMensual(req.usuario, req.query.mes)).then(generarPdfReporte).then((buf) => {
      res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="reporte-mensual-${req.query.mes || hoyLima().slice(0, 7)}.pdf"`, 'Cache-Control': 'private, no-store', 'X-Frame-Options': 'SAMEORIGIN', 'Content-Security-Policy': "default-src 'self'; frame-ancestors 'self'" });
      res.send(buf);
    }).catch(next);
  });
  app.get('/api/portafolio.csv', seg.requiere('EDITOR'), (req, res, next) => {
    permisos.ejecutarConAlcance(permisos.alcanceDe(req.usuario), () => portafolio(req)).then((r) => {
      const cols = ['codigo', 'proyecto', 'modalidad', 'estado', 'gestion', 'unidad_usuaria', 'responsable', 'avance', 'semaforo', 'os_en_ejecucion', 'os_sin_notificar', 'entregables_pendientes', 'entregables_vencidos', 'conformidades_fuera_de_plazo', 'proximo_entregable', 'fecha_limite', 'ultimo_parte', 'alertas_altas', 'monto_comprometido', 'monto_conforme'];
      const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const num = (n) => (n === null || n === undefined ? '' : String(n).replace('.', ','));
      const filas = [cols.join(';'), ...r.proyectos.map((f) => [f.codigo, f.nombre, f.modalidad, f.estado, f.area_tecnica, f.unidad_usuaria, f.responsable, num(f.avance), f.semaforo, f.os_en_ejecucion, f.os_sin_notificar,
        f.entregables.pendientes, f.entregables.vencidos, f.entregables.revision_vencida, f.proximo_entregable ? `${f.proximo_entregable.numero}. ${f.proximo_entregable.nombre}` : '', f.proximo_entregable ? f.proximo_entregable.fecha_limite : '',
        f.ultimo_parte, f.alertas.altas, num(f.monto_comprometido), num(f.monto_conforme)].map(esc).join(';'))];
      res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="tablero_general_${r.resumen.corte}.csv"`, 'Cache-Control': 'private, no-store' });
      res.send(`\ufeff${filas.join('\r\n')}`);
    }).catch(next);
  });

  // ------------------------------------------------------------ supervisión diaria y entregables (Etapa 3, db/18)
  app.get('/api/proyectos/:id/partes', seg.requiere('EDITOR'), h((req) => supervision.listarPartes(req.params.id, { consultor_id: req.query.consultor_id, desde: req.query.desde, hasta: req.query.hasta, limite: req.query.limite })));
  app.post('/api/proyectos/:id/partes', seg.requiere('EDITOR'), h((req) => supervision.registrarParte(req.params.id, req.body || {}, ctx(req))));
  // Lee el documento del entregable (temporal) y propone la fecha de presentación y la observación; no escribe
  app.post('/api/entregables/:id/leer-documento', seg.requiere('EDITOR'), h((req) => lectorEntregables.leer(req.params.id, (req.body || {}).documento, ctx(req))));
  app.post('/api/entregables/:id/presentar', seg.requiere('EDITOR'), h((req) => supervision.presentar(req.params.id, req.body || {}, ctx(req))));
  app.post('/api/entregables/:id/observar', seg.requiere('EDITOR'), h((req) => supervision.observar(req.params.id, req.body || {}, ctx(req))));
  app.post('/api/entregables/:id/conformidad', seg.requiere('EDITOR'), h((req) => supervision.conformidad(req.params.id, req.body || {}, ctx(req))));
  // término anticipado de una OS y cierre formal del proyecto (Etapa 5)
  app.post('/api/contratos/:id/resolver', seg.requiere('EDITOR'), h((req) => contrataciones.resolver(req.params.id, req.body || {}, ctx(req))));
  app.post('/api/contratos/:id/anular', seg.requiere('EDITOR'), h((req) => contrataciones.anular(req.params.id, req.body || {}, ctx(req))));
  app.get('/api/proyectos/:id/cierre', seg.requiere('EDITOR'), h((req) => cierre.evaluar(req.params.id)));
  app.post('/api/proyectos/:id/cierre', seg.requiere('EDITOR'), h((req) => cierre.cerrar(req.params.id, req.body || {}, ctx(req))));
  app.post('/api/contratos/:id/ampliacion', seg.requiere('EDITOR'), h((req) => contrataciones.ampliarPlazo(req.params.id, req.body || {}, ctx(req))));
  // PDF de la Orden de Servicio (o contrato) y de los Términos de Referencia de cada profesional: contrato_id
  const contratoDe = async (id) => {
    const d = await servicio.datos();
    const k = d.contratos.find((x) => x.contrato_id === Number(id) && x.activo !== 0 && x.activo !== false);
    if (!k) throw Object.assign(new Error('Contrato u Orden de Servicio no encontrado'), { estado: 404 });
    return k;
  };
  for (const [ruta, coleccion, rotulo] of [['documento', contratosPdf, 'documento de contratación'], ['tdr', tdrPdf, 'Términos de Referencia']]) {
    const guardar = h(async (req) => {
      const k = await contratoDe(req.params.id);
      const previo = coleccion.info(k.contrato_id).existe;
      const tipo = ruta === 'tdr' ? 'TDR' : k.tipo_documento === 'ORDEN_SERVICIO' ? 'ORDEN_SERVICIO' : 'CONTRATO';
      await coleccion.guardar(k.contrato_id, req.body, { tipo, usuario: req.usuario.correo, motivo: `${previo ? 'Reemplazo' : 'Carga'} del PDF: ${rotulo} (${k.numero})`, origen: 'UI', consultor_id: k.consultor_id, nombre: nombreDe(req) || `${ruta}-${k.numero}.pdf` });
      return { ok: true, ...coleccion.info(k.contrato_id) };
    });
    for (const metodo of ['put', 'post']) app[metodo](`/api/contratos/:id/${ruta}`, seg.requiere('EDITOR'), express.raw({ type: 'application/pdf', limit: coleccion.MAX_BYTES }), guardar);
    app.get(`/api/contratos/:id/${ruta}`, seg.requiere('LECTOR'), (req, res, next) => {
      contratoDe(req.params.id).then(async (k) => {
        if (!coleccion.info(k.contrato_id).existe) throw Object.assign(new Error('Aún no se adjuntó este documento'), { estado: 404 });
        // la Orden de Servicio / contrato es confidencial: solo el Administrador y el equipo del proyecto (D4, C10)
        if (ruta === 'documento' && !permisos.puedeVerConfidencial(req.usuario, await proyectoDeConsultor(k.consultor_id))) throw Object.assign(new Error('Documento confidencial: solo lo ven el Administrador y el equipo del proyecto'), { estado: 403 });
        res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${ruta}-${k.contrato_id}.pdf"`, 'Cache-Control': 'private, no-store', 'X-Frame-Options': 'SAMEORIGIN', 'Content-Security-Policy': "default-src 'self'; frame-ancestors 'self'" });
        res.sendFile(coleccion.ruta(k.contrato_id), (err) => { if (err && !res.headersSent) next(err); });
      }).catch(next);
    });
  }
  app.post('/api/proyectos/:id/profesionales/:cid/renovar', seg.requiere('EDITOR'), h((req) => servicio.ampliarOrdenServicio(req.params.cid, req.body, ctx(req))));
  app.post('/api/proyectos/:id/profesionales', seg.requiere('EDITOR'), h((req) => servicio.registrarProfesional({ ...(req.body || {}), proyecto_id: req.params.id }, ctx(req))));
  // Proyectos (solo la Dirección OTI): el periodo se calcula con inicio y plazo; la OS y el TDR quedan como documentos del proyecto
  app.post('/api/proyectos/leer-documentos', seg.requiere('ADMIN'), h((req) => proyectos.leerDocumentos((req.body || {}).documentos, ctx(req))));
  app.post('/api/proyectos', seg.requiere('ADMIN'), h((req) => proyectos.registrar(req.body, ctx(req))));
  app.patch('/api/proyectos/:id', seg.requiere('ADMIN'), h((req) => proyectos.actualizar(req.params.id, req.body, ctx(req))));
  const RUTAS_ENTIDAD = { proyectos: 'proyecto', adendas: 'adenda', contratos: 'contrato', planes: 'plan_trabajo', 'linea-base': 'linea_base_entregable', 'controles-cambio': 'control_cambio', consultores: 'consultor' };
  for (const [ruta, entidad] of Object.entries(RUTAS_ENTIDAD)) {
    const nivel = entidad === 'proyecto' ? 'ADMIN' : 'EDITOR'; // los proyectos los crea y modifica solo la Dirección OTI (Administrador)
    if (entidad === 'proyecto') continue; // rutas propias, arriba
    app.patch(`/api/${ruta}/:id`, seg.requiere(nivel), h((req) => servicio.actualizarEntidad(entidad, req.params.id, req.body, ctx(req))));
    if (entidad !== 'consultor' && entidad !== 'linea_base_entregable' && entidad !== 'contrato') {
      app.post(`/api/${ruta}`, seg.requiere(nivel), h((req) => servicio.crearEntidad(entidad, req.body, ctx(req))));
    }
  }

  // ------------------------------------------------------------ correo diario de alertas (P11, Google Workspace; solo el Administrador)
  const alertasCorreo = crearAlertasCorreo({ config: config.correo, servicio, repo });
  alertasCorreo.programar();
  const sinHtml = ({ html, ...c }) => c;
  app.get('/api/alertas-correo', seg.requiere('ADMIN'), h(async (req) => ({
    configuracion: alertasCorreo.publico(), ultimo_envio: await alertasCorreo.ultimoEnvio(),
    correos: (await alertasCorreo.vistaPrevia()).map(req.query.html === '1' ? (c) => c : sinHtml),
  })));
  app.post('/api/alertas-correo/probar-conexion', seg.requiere('ADMIN'), h(() => alertasCorreo.probarConexion()));
  // prueba: solo el correo que le tocaría al Administrador que la pide (no se registra como envío del día)
  app.post('/api/alertas-correo/enviar', seg.requiere('ADMIN'), h((req) => alertasCorreo.enviar((req.body || {}).prueba ? { soloA: req.usuario.correo } : { usuario: req.usuario.correo, origen: 'UI' })));

  // ------------------------------------------------------------ reporte mensual para Gerencia por correo (solo el Administrador)
  // Lo arma el sistema con alcance de Administrador (todos los proyectos); los montos solo con REPORTE_MENSUAL_MONTOS=true.
  const USUARIO_REPORTE = { rol: 'ADMIN', correo: 'sistema/reporte', nombre: 'Envío automático del Seguimiento de Proyectos', proyectos: [] };
  const generarReporteCorreo = (mes) => permisos.ejecutarConAlcance(permisos.alcanceDe(USUARIO_REPORTE), async () => {
    const reporte = await reporteMensual(USUARIO_REPORTE, mes, { sinMontos: !config.reporte.montos });
    return { reporte, pdf: await generarPdfReporte(reporte) };
  });
  const reporteCorreo = crearReporteCorreo({ config: config.reporte, correo: alertasCorreo, generar: generarReporteCorreo, servicio, repo });
  reporteCorreo.programar();
  app.get('/api/reporte-correo', seg.requiere('ADMIN'), h(async () => {
    const p = await reporteCorreo.programacion();
    return { configuracion: reporteCorreo.publico(), destinatarios: await reporteCorreo.destinatarios(), ultimo_envio: await reporteCorreo.ultimoEnvio(), ...p, enviado: await reporteCorreo.enviadoMes(p.mes) };
  }));
  // prueba: solo al Administrador que la pide (no se registra); envío: a los destinatarios, queda como el del mes
  app.post('/api/reporte-correo/enviar', seg.requiere('ADMIN'), h((req) => {
    const b = req.body || {};
    if (b.mes) rangoMes(b.mes);
    return reporteCorreo.enviar(b.prueba ? { mes: b.mes, soloA: req.usuario.correo } : { mes: b.mes, usuario: req.usuario.correo, origen: 'UI' });
  }));

  // ------------------------------------------------------------ configuración (ADMIN)
  app.put('/api/parametros/:codigo', seg.requiere('JEFE_PROYECTO'), h(async (req) => {
    const r = await repo.guardarParametro(req.params.codigo, req.body.valor ?? '', req.usuario.correo);
    await servicio.recalcularYGuardar(req.usuario.correo, `Parámetro ${req.params.codigo} actualizado`);
    return r;
  }));
  app.post('/api/feriados', seg.requiere('JEFE_PROYECTO'), h(async (req) => {
    const { fecha, descripcion, tipo } = req.body || {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha || '') || !descripcion) throw Object.assign(new Error('Fecha (AAAA-MM-DD) y descripción son obligatorias'), { estado: 400 });
    await repo.guardarFeriado({ fecha, descripcion, tipo: tipo === 'NO_LABORABLE' ? 'NO_LABORABLE' : 'FERIADO' }, req.usuario.correo);
    await servicio.recalcularYGuardar(req.usuario.correo, 'Calendario actualizado');
  }));
  app.delete('/api/feriados/:fecha', seg.requiere('JEFE_PROYECTO'), h(async (req) => {
    await repo.eliminarFeriado(req.params.fecha, req.usuario.correo);
    await servicio.recalcularYGuardar(req.usuario.correo, 'Calendario actualizado');
  }));

  // ------------------------------------------------------------ carga de documentos (Jefe de Proyecto y Administrador)
  const MAX_DOCUMENTO = 50 * 1024 * 1024;
  // ?proyecto_id=: plantilla del proyecto (su nombre, sus profesionales y, sin adendas, sin esa hoja)
  app.get('/api/documentos/plantilla.xlsx', seg.requiere('JEFE_PROYECTO'), (req, res, next) => {
    (async () => {
      const d = await servicio.datos();
      const proyecto = req.query.proyecto_id ? d.proyectos.find((p) => p.proyecto_id === Number(req.query.proyecto_id) && p.activo !== 0 && p.activo !== false) || null : null;
      const profesionales = proyecto ? d.consultores.filter((c) => c.proyecto_id === proyecto.proyecto_id && c.activo !== 0 && c.activo !== false).sort((a, b) => a.clave.localeCompare(b.clave)).map((c) => ({ clave: c.clave, nombres: c.nombres })) : [];
      const buf = await plantillaXlsx({ proyecto, profesionales });
      const archivo = `plantilla-actualizacion${proyecto ? `-${String(proyecto.codigo).replace(/[^A-Za-z0-9-]/g, '')}` : ''}.xlsx`;
      res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${archivo}"`, 'Cache-Control': 'no-store' });
      res.send(buf);
    })().catch(next);
  });
  app.post('/api/documentos/previsualizar', seg.requiere('JEFE_PROYECTO'), express.raw({ type: 'application/octet-stream', limit: MAX_DOCUMENTO }), h(async (req) => {
    let nombre = '';
    try { nombre = decodeURIComponent(req.get('X-Nombre') || '').trim(); } catch { /* cabecera mal codificada */ }
    if (!nombre) throw Object.assign(new Error('Falta el nombre del archivo'), { estado: 400 });
    return documentos.previsualizar({ buffer: req.body, nombre: nombre.slice(0, 200), usuario: req.usuario, consultor_id: req.get('X-Profesional') || null, tipo: req.get('X-Tipo') === 'adenda' ? 'adenda' : null });
  }));
  app.post('/api/documentos/aplicar', seg.requiere('JEFE_PROYECTO'), h((req) => documentos.aplicar({ carga_id: req.body && req.body.carga_id, ids: req.body && req.body.ids, ajustes: req.body && req.body.ajustes, usuario: req.usuario })));

  // ------------------------------------------------------------ Actualizar desde archivo (Jefe de Proyecto y Administrador)
  app.post('/api/actualizar-archivo', seg.requiere('JEFE_PROYECTO'), express.raw({ type: 'application/octet-stream', limit: MAX_DOCUMENTO }), h(async (req) => {
    let nombre = '';
    try { nombre = decodeURIComponent(req.get('X-Nombre') || '').trim(); } catch { /* cabecera mal codificada */ }
    if (!nombre) throw Object.assign(new Error('Falta el nombre del archivo'), { estado: 400 });
    return documentos.actualizarDesdeArchivo({ buffer: req.body, nombre: nombre.slice(0, 200), usuario: req.usuario });
  }));
  app.get('/api/actualizar-archivo', seg.requiere('JEFE_PROYECTO'), h(() => documentos.listarArchivos()));
  app.get('/api/actualizar-archivo/:id/contenido', seg.requiere('JEFE_PROYECTO'), h((req) => documentos.contenidoArchivo(req.params.id)));
  app.get('/api/actualizar-archivo/:id/archivo', seg.requiere('JEFE_PROYECTO'), (req, res, next) => {
    try {
      const { entrada, archivo } = documentos.buscarArchivo(req.params.id);
      const inline = entrada.formato === 'pdf' && req.query.descargar !== '1';
      res.set({ 'Content-Type': entrada.formato === 'pdf' ? 'application/pdf' : 'application/octet-stream', 'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(entrada.archivo)}`, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
      res.sendFile(archivo);
    } catch (e) { next(e); }
  });

  // ------------------------------------------------------------ asistente de IA
  app.post('/api/ia/mensaje', seg.requiere('LECTOR'), h(async (req) => {
    const texto = String((req.body && req.body.texto) || '').trim();
    if (!texto) throw Object.assign(new Error('Escriba una consulta'), { estado: 400 });
    if (texto.length > 4000) throw Object.assign(new Error('La consulta es demasiado larga'), { estado: 400 });
    return agente.conversar({ conversacion_id: req.body.conversacion_id, texto, usuario: req.usuario, consultor_id: req.body.consultor_id, proyecto_id: req.body.proyecto_id });
  }));
  app.post('/api/ia/aplicar', seg.requiere('EDITOR'), h((req) => agente.aplicarPropuesta(req.body.propuesta_id, req.usuario)));

  // ------------------------------------------------------------ estáticos y errores
  app.use(express.static(path.join(config.raiz, 'public'), { index: 'index.html', maxAge: config.produccion ? '1h' : 0 }));
  app.use('/api', (req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    const estado = err.estado || (err.status >= 400 && err.status < 500 ? err.status : 0) || (err.codigo === 'CICLO_DEPENDENCIAS' ? 400 : 500);
    if (estado >= 500) console.error('[error]', err);
    res.status(estado).json({ error: estado >= 500 && config.produccion ? 'Error interno. Revise el registro del servidor.' : err.message, requiereMotivo: err.requiereMotivo, actual: err.actual });
  });

  return { app, repo, servicio, generarReporteCorreo };
}

if (require.main === module) {
  crearApp().then(({ app, repo }) => {
    app.listen(config.puerto, () => {
      console.log(`Seguimiento Actividades Gestiona Forestal 2026 → http://localhost:${config.puerto}  (datos: ${repo.tipo}${config.ia.claveApi ? ', asistente IA activo' : ', asistente IA sin clave'})`);
    });
  }).catch((err) => { console.error('No se pudo iniciar:', err.message); process.exit(1); });
}

module.exports = { crearApp };
