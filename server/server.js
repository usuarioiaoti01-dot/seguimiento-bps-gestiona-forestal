'use strict';
/**
 * Seguimiento de Consultores BPS – Gestiona Forestal
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
  app.use('/api', seg.exigirCabeceraApp);

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
    res.json({ usuario: { correo: req.usuario.correo, nombre: req.usuario.nombre, rol: req.usuario.rol, cambiarClave: !!req.usuario.cambiar }, ia: !!config.ia.claveApi, modo: repo.tipo });
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

  // ------------------------------------------------------------ usuarios (ADMIN)
  app.get('/api/usuarios', seg.requiere('ADMIN'), h(() => repo.listarUsuarios()));
  app.post('/api/usuarios', seg.requiere('ADMIN'), h(async (req) => {
    const { correo, nombre, rol } = req.body || {};
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo || '') || !nombre || !['ADMIN', 'EDITOR', 'LECTOR'].includes(rol)) throw Object.assign(new Error('Correo, nombre y rol válidos son obligatorios'), { estado: 400 });
    const temporal = seg.generarClaveTemporal();
    const u = await repo.crearUsuario({ correo: correo.trim().toLowerCase(), nombre, rol, clave_hash: await seg.bcrypt.hash(temporal, 11), debe_cambiar_clave: 1 });
    await repo.registrarBitacora({ usuario: req.usuario.correo, entidad: 'usuario', entidad_id: u.usuario_id, accion: 'CREAR', cambios_json: { correo: u.correo, rol } });
    return { usuario: u, clave_temporal: temporal };
  }));
  app.patch('/api/usuarios/:id', seg.requiere('ADMIN'), h(async (req) => {
    const cambios = {};
    if (req.body.rol) cambios.rol = req.body.rol;
    if (req.body.activo !== undefined) cambios.activo = req.body.activo ? 1 : 0;
    if (req.body.nombre) cambios.nombre = req.body.nombre;
    let temporal = null;
    if (req.body.restablecer) { temporal = seg.generarClaveTemporal(); cambios.clave_hash = await seg.bcrypt.hash(temporal, 11); cambios.debe_cambiar_clave = 1; }
    const u = await repo.actualizarUsuario(req.params.id, cambios);
    await repo.registrarBitacora({ usuario: req.usuario.correo, entidad: 'usuario', entidad_id: Number(req.params.id), accion: 'MODIFICAR', cambios_json: { ...cambios, clave_hash: cambios.clave_hash ? '(restablecida)' : undefined } });
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
        plan: it.plan && { plan_id: it.plan.plan_id, estado: it.plan.estado, nombre: it.plan.nombre },
        pronostico: it.pronostico && { ...it.pronostico, actividades: undefined },
        atrasadas: it.pronostico ? Object.values(it.pronostico.actividades).filter((a) => ['ATRASADA', 'SIN_INICIAR_VENCIDA'].includes(a.situacion)).length : 0,
        alertas: e.alertas.filter((a) => a.consultor_id === it.consultor.consultor_id).length,
      })),
    };
  }));
  app.get('/api/consultores/:id', seg.requiere('LECTOR'), h((req) => servicio.detalleConsultor(req.params.id, { verPersonales: req.usuario.rol === 'ADMIN', corte: req.query.corte })));
  app.get('/api/linea-base', seg.requiere('LECTOR'), h(() => servicio.lineaBase()));
  app.get('/api/adendas', seg.requiere('LECTOR'), h(async () => {
    const d = await servicio.datos();
    return d.adendas.map((a) => {
      const k = d.contratos.find((x) => x.contrato_id === a.contrato_id) || {};
      const c = d.consultores.find((x) => x.consultor_id === k.consultor_id) || {};
      return { ...a, contrato: k.numero, consultor_id: c.consultor_id, clave: c.clave, nombres: c.nombres };
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
  app.get('/api/ia/uso', seg.requiere('ADMIN'), h(() => repo.usoIA()));

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
  app.patch('/api/actividades/:id', seg.requiere('EDITOR'), h((req) => servicio.actualizarActividad(req.params.id, req.body, ctx(req))));
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
  app.put('/api/parametros/:codigo', seg.requiere('ADMIN'), h(async (req) => {
    const r = await repo.guardarParametro(req.params.codigo, req.body.valor ?? '', req.usuario.correo);
    await servicio.recalcularYGuardar(req.usuario.correo, `Parámetro ${req.params.codigo} actualizado`);
    return r;
  }));
  app.post('/api/feriados', seg.requiere('ADMIN'), h(async (req) => {
    const { fecha, descripcion, tipo } = req.body || {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha || '') || !descripcion) throw Object.assign(new Error('Fecha (AAAA-MM-DD) y descripción son obligatorias'), { estado: 400 });
    await repo.guardarFeriado({ fecha, descripcion, tipo: tipo === 'NO_LABORABLE' ? 'NO_LABORABLE' : 'FERIADO' }, req.usuario.correo);
    await servicio.recalcularYGuardar(req.usuario.correo, 'Calendario actualizado');
  }));
  app.delete('/api/feriados/:fecha', seg.requiere('ADMIN'), h(async (req) => {
    await repo.eliminarFeriado(req.params.fecha, req.usuario.correo);
    await servicio.recalcularYGuardar(req.usuario.correo, 'Calendario actualizado');
  }));

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
    const estado = err.estado || (err.codigo === 'CICLO_DEPENDENCIAS' ? 400 : 500);
    if (estado >= 500) console.error('[error]', err);
    res.status(estado).json({ error: estado >= 500 && config.produccion ? 'Error interno. Revise el registro del servidor.' : err.message, requiereMotivo: err.requiereMotivo, actual: err.actual });
  });

  return { app, repo, servicio };
}

if (require.main === module) {
  crearApp().then(({ app, repo }) => {
    app.listen(config.puerto, () => {
      console.log(`Seguimiento BPS · Gestiona Forestal → http://localhost:${config.puerto}  (datos: ${repo.tipo}${config.ia.claveApi ? ', asistente IA activo' : ', asistente IA sin clave'})`);
    });
  }).catch((err) => { console.error('No se pudo iniciar:', err.message); process.exit(1); });
}

module.exports = { crearApp };
