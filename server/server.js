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
const { hoyLima } = require('./motor/calendario');
const { crearPlanesPdf } = require('./planes-pdf');
const { crearDocumentos } = require('./documentos');
const { plantillaXlsx } = require('./documentos/plantilla');

async function crearApp() {
  const repo = await crearRepositorio();
  const servicio = crearServicio(repo);
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
      if (m === 'POST' && p === '/ia/mensaje') return next();
      if (m === 'GET' && (g = p.match(/^\/consultores\/(\d+)$/))) return Number(g[1]) === mio ? next() : denegar();
      if (m === 'GET' && p === '/bitacora') return String(req.query.consultor_id) === String(mio) ? next() : denegar();
      if (m === 'GET' && (g = p.match(/^\/planes\/(\d+)\/pdf$/))) {
        const plan = (await servicio.datos()).planes.find((x) => x.plan_id === Number(g[1]));
        return plan && plan.consultor_id === mio ? next() : denegar();
      }
      if (m === 'PATCH' && (g = p.match(/^\/actividades\/(\d+)$/))) {
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

  const planesPdf = crearPlanesPdf({ dir: config.planesPdf });
  const adendasPdf = crearPlanesPdf({ dir: config.adendasPdf, prefijo: 'adenda' });
  const documentos = crearDocumentos({ servicio, repo, dir: config.documentos, extraerConIA: (a) => agente.extraerDocumento(a) });
  const ctx = (req) => ({ usuario: req.usuario.correo, nombre: req.usuario.nombre, rol: req.usuario.rol, origen: 'UI', motivo: (req.body && req.body.motivo) || null });
  const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).then((r) => { if (!res.headersSent) res.json(r ?? { ok: true }); }).catch(next);

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
  app.get('/api/auth/yo', (req, res) => {
    if (!req.usuario) return res.status(401).json({ error: 'Sesión no iniciada' });
    res.json({ usuario: { correo: req.usuario.correo, nombre: req.usuario.nombre, rol: req.usuario.rol, consultor_id: req.usuario.consultor_id ?? null, cambiarClave: !!req.usuario.cambiar }, ia: !!config.ia.claveApi, modo: repo.tipo });
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
  app.get('/api/estado', seg.requiere('LECTOR'), h(async (req) => {
    const e = await servicio.estado({ corte: req.query.corte });
    return {
      corte: e.corte, metodo: e.metodo, indicadores: e.indicadores, alertas: e.alertas,
      consultores: e.consultores.map((it) => ({
        consultor_id: it.consultor.consultor_id, clave: it.consultor.clave, nombres: it.consultor.nombres, perfil: it.consultor.perfil,
        contrato: it.contrato && it.contrato.numero, expediente: it.contrato && it.contrato.expediente,
        vigencia: { ...it.vigencia },
        historial_adendas: it.adendas.filter((a) => a.estado === 'CONCLUIDA').sort((a, b) => a.numero - b.numero)
          .map((a) => ({ numero: a.numero, fecha_inicio: a.fecha_inicio, fecha_fin: a.fecha_fin, plazo_dias: a.plazo_dias ?? null, plazo_solicitado_dias: a.plazo_solicitado_dias ?? null })),
        cobertura: it.cobertura,
        plan: it.plan && { plan_id: it.plan.plan_id, estado: it.plan.estado, nombre: it.plan.nombre },
        pronostico: it.pronostico && { ...it.pronostico, actividades: undefined },
        atrasadas: it.pronostico ? Object.values(it.pronostico.actividades).filter((a) => ['ATRASADA', 'SIN_INICIAR_VENCIDA'].includes(a.situacion)).length : 0,
        alertas: e.alertas.filter((a) => a.consultor_id === it.consultor.consultor_id).length,
      })),
    };
  }));
  app.get('/api/consultores/:id', seg.requiere('LECTOR'), h(async (req) => {
    const det = await servicio.detalleConsultor(req.params.id, { verPersonales: req.usuario.rol === 'ADMIN', corte: req.query.corte });
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
  app.put('/api/planes/:id/pdf', seg.requiere('EDITOR'), express.raw({ type: 'application/pdf', limit: planesPdf.MAX_BYTES }), h(async (req) => {
    const plan = await planDe(req.params.id);
    let motivo = '';
    try { motivo = decodeURIComponent(req.get('X-Motivo') || '').trim(); } catch { /* cabecera mal codificada */ }
    if (motivo.length < 5) throw Object.assign(new Error('Indique el motivo (mínimo 5 caracteres)'), { estado: 400, requiereMotivo: true });
    const r = planesPdf.guardar(plan.plan_id, req.body);
    await repo.registrarBitacora({ usuario: req.usuario.correo, entidad: 'plan_trabajo', entidad_id: plan.plan_id, consultor_id: plan.consultor_id, accion: 'MODIFICAR', cambios_json: { plan_pdf: { bytes: r.bytes, sha256: r.sha256, reemplaza: r.reemplaza } }, motivo, origen: 'UI' });
    return { ok: true, ...planesPdf.info(plan.plan_id) };
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
  app.put('/api/adendas/:id/pdf', seg.requiere('EDITOR'), express.raw({ type: 'application/pdf', limit: adendasPdf.MAX_BYTES }), h(async (req) => {
    const { a, consultor_id } = await adendaDe(req.params.id);
    let motivo = '';
    try { motivo = decodeURIComponent(req.get('X-Motivo') || '').trim(); } catch { /* cabecera mal codificada */ }
    if (motivo.length < 5) throw Object.assign(new Error('Indique el motivo (mínimo 5 caracteres)'), { estado: 400, requiereMotivo: true });
    const r = adendasPdf.guardar(a.adenda_id, req.body);
    await repo.registrarBitacora({ usuario: req.usuario.correo, entidad: 'adenda', entidad_id: a.adenda_id, consultor_id, accion: 'MODIFICAR', cambios_json: { adenda_pdf: { bytes: r.bytes, sha256: r.sha256, reemplaza: r.reemplaza } }, motivo, origen: 'UI' });
    return { ok: true, ...adendasPdf.info(a.adenda_id) };
  }));
  app.get('/api/linea-base', seg.requiere('LECTOR'), h(() => servicio.lineaBase()));
  app.get('/api/adendas', seg.requiere('LECTOR'), h(async () => {
    const d = await servicio.datos();
    return d.adendas.map((a) => {
      const k = d.contratos.find((x) => x.contrato_id === a.contrato_id) || {};
      const c = d.consultores.find((x) => x.consultor_id === k.consultor_id) || {};
      return { ...a, contrato: k.numero, consultor_id: c.consultor_id, clave: c.clave, nombres: c.nombres, tiene_pdf: adendasPdf.info(a.adenda_id).existe };
    }).sort((x, y) => (x.clave || '').localeCompare(y.clave || '') || x.numero - y.numero);
  }));
  app.get('/api/bitacora', seg.requiere('LECTOR'), h(async (req) => {
    const filas = await repo.listarBitacora({ consultor_id: req.query.consultor_id, entidad: req.query.entidad, entidad_id: req.query.entidad_id, limite: req.query.limite });
    return servicio.sanearBitacora(filas, { verPersonales: req.usuario.rol === 'ADMIN' });
  }));
  app.get('/api/historial/:entidad/:id', seg.requiere('LECTOR'), h(async (req) => {
    const filas = await repo.historialEntidad(req.params.entidad, req.params.id);
    if (req.usuario.rol !== 'ADMIN') for (const f of filas) { delete f.dni; delete f.telefono; delete f.correo_personal; }
    return filas;
  }));
  app.get('/api/parametros', seg.requiere('LECTOR'), h(async () => { const d = await servicio.datos(); return { parametros: d.parametros, feriados: d.feriados, corte_vigente: await servicio.corteVigente() }; }));
  app.get('/api/ia/uso', seg.requiere('JEFE_PROYECTO'), h(() => repo.usoIA()));

  // Exportación CSV (abre en Excel con separador ;)
  app.get('/api/exportar/actividades.csv', seg.requiere('LECTOR'), async (req, res, next) => {
    try {
      const e = await servicio.estado();
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
  app.put('/api/actividades/:id/predecesoras', seg.requiere('EDITOR'), h((req) => servicio.definirDependencias(req.params.id, req.body.predecesoras, ctx(req))));
  app.post('/api/planes/:id/adoptar-pronostico', seg.requiere('EDITOR'), h((req) => servicio.adoptarPronostico(req.params.id, ctx(req))));
  app.post('/api/simular', seg.requiere('LECTOR'), h((req) => servicio.simular(req.body.cambios, { corte: req.body.corte })));
  app.post('/api/recalcular', seg.requiere('EDITOR'), h((req) => servicio.recalcularYGuardar(req.usuario.correo, (req.body && req.body.motivo) || 'Recálculo manual')));

  const RUTAS_ENTIDAD = { adendas: 'adenda', contratos: 'contrato', planes: 'plan_trabajo', 'linea-base': 'linea_base_entregable', 'controles-cambio': 'control_cambio', consultores: 'consultor' };
  for (const [ruta, entidad] of Object.entries(RUTAS_ENTIDAD)) {
    app.patch(`/api/${ruta}/:id`, seg.requiere('EDITOR'), h((req) => servicio.actualizarEntidad(entidad, req.params.id, req.body, ctx(req))));
    if (entidad !== 'consultor' && entidad !== 'linea_base_entregable' && entidad !== 'contrato') {
      app.post(`/api/${ruta}`, seg.requiere('EDITOR'), h((req) => servicio.crearEntidad(entidad, req.body, ctx(req))));
    }
  }

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
  const MAX_DOCUMENTO = 15 * 1024 * 1024;
  app.get('/api/documentos/plantilla.xlsx', seg.requiere('JEFE_PROYECTO'), (req, res, next) => {
    plantillaXlsx().then((buf) => {
      res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': 'attachment; filename="plantilla-actualizacion.xlsx"', 'Cache-Control': 'no-store' });
      res.send(buf);
    }).catch(next);
  });
  app.post('/api/documentos/previsualizar', seg.requiere('JEFE_PROYECTO'), express.raw({ type: 'application/octet-stream', limit: MAX_DOCUMENTO }), h(async (req) => {
    let nombre = '';
    try { nombre = decodeURIComponent(req.get('X-Nombre') || '').trim(); } catch { /* cabecera mal codificada */ }
    if (!nombre) throw Object.assign(new Error('Falta el nombre del archivo'), { estado: 400 });
    return documentos.previsualizar({ buffer: req.body, nombre: nombre.slice(0, 200), usuario: req.usuario, consultor_id: req.get('X-Profesional') || null, tipo: req.get('X-Tipo') === 'adenda' ? 'adenda' : null });
  }));
  app.post('/api/documentos/aplicar', seg.requiere('JEFE_PROYECTO'), h((req) => documentos.aplicar({ carga_id: req.body && req.body.carga_id, ids: req.body && req.body.ids, ajustes: req.body && req.body.ajustes, usuario: req.usuario })));

  // ------------------------------------------------------------ asistente de IA
  app.post('/api/ia/mensaje', seg.requiere('LECTOR'), h(async (req) => {
    const texto = String((req.body && req.body.texto) || '').trim();
    if (!texto) throw Object.assign(new Error('Escriba una consulta'), { estado: 400 });
    if (texto.length > 4000) throw Object.assign(new Error('La consulta es demasiado larga'), { estado: 400 });
    return agente.conversar({ conversacion_id: req.body.conversacion_id, texto, usuario: req.usuario, consultor_id: req.body.consultor_id });
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

  return { app, repo, servicio };
}

if (require.main === module) {
  crearApp().then(({ app, repo }) => {
    app.listen(config.puerto, () => {
      console.log(`Seguimiento Actividades Gestiona Forestal 2026 → http://localhost:${config.puerto}  (datos: ${repo.tipo}${config.ia.claveApi ? ', asistente IA activo' : ', asistente IA sin clave'})`);
    });
  }).catch((err) => { console.error('No se pudo iniciar:', err.message); process.exit(1); });
}

module.exports = { crearApp };
