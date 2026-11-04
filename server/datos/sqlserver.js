'use strict';
/**
 * Repositorio SQL Server (producción). Usa el paquete `mssql` (driver tedious).
 * - Toda escritura de entidad va en una transacción junto con su registro en
 *   sgf.bitacora; el historial de valores lo guarda la tabla temporal.
 * - Concurrencia optimista: UPDATE ... WHERE revision = @revision.
 * - Los pronósticos se persisten en un solo viaje con OPENJSON + MERGE.
 */
const sql = require('mssql');
const { ENTIDADES, COLUMNAS_FECHA } = require('./entidades');

function normalizar(fila, fechas = COLUMNAS_FECHA) {
  if (!fila) return fila;
  const out = {};
  for (const [k, v] of Object.entries(fila)) {
    if (v instanceof Date) out[k] = fechas.has(k) ? v.toISOString().slice(0, 10) : v.toISOString();
    else if (typeof v === 'boolean') out[k] = v ? 1 : 0;
    else out[k] = v;
  }
  return out;
}
const normalizarTodas = (filas, fechas) => filas.map((f) => normalizar(f, fechas));
const SIN_FECHAS = new Set();

async function crearRepositorioSqlServer(config) {
  const pool = await new sql.ConnectionPool({
    server: config.servidor,
    port: config.puerto,
    database: config.base,
    user: config.usuario,
    password: config.clave,
    pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
    options: { encrypt: config.cifrar, trustServerCertificate: config.confiarCertificado, enableArithAbort: true },
  }).connect();

  const consulta = async (texto, params = {}, tx = null) => {
    const req = tx ? new sql.Request(tx) : pool.request();
    for (const [k, v] of Object.entries(params)) req.input(k, v);
    return req.query(texto);
  };

  async function insertarBitacora(e, tx) {
    await consulta(
      `INSERT INTO sgf.bitacora (usuario, entidad, entidad_id, consultor_id, accion, cambios_json, motivo, origen)
       VALUES (@usuario, @entidad, @entidad_id, @consultor_id, @accion, @cambios_json, @motivo, @origen);`,
      {
        usuario: e.usuario, entidad: e.entidad, entidad_id: e.entidad_id ?? null, consultor_id: e.consultor_id ?? null,
        accion: e.accion, cambios_json: e.cambios_json ? (typeof e.cambios_json === 'string' ? e.cambios_json : JSON.stringify(e.cambios_json)) : null,
        motivo: e.motivo ?? null, origen: e.origen || 'UI',
      }, tx);
  }

  async function enTransaccion(fn) {
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      const r = await fn(tx);
      await tx.commit();
      return r;
    } catch (err) {
      try { await tx.rollback(); } catch { /* ya revertida */ }
      throw err;
    }
  }

  return {
    tipo: 'sqlserver',

    async cargarTodo() {
      const r = await consulta(`
        SELECT * FROM sgf.consultor WHERE activo = 1;
        SELECT * FROM sgf.contrato WHERE activo = 1;
        SELECT * FROM sgf.adenda WHERE activo = 1;
        SELECT * FROM sgf.plan_trabajo WHERE activo = 1;
        SELECT * FROM sgf.actividad WHERE activo = 1 ORDER BY plan_id, orden;
        SELECT * FROM sgf.actividad_dependencia WHERE activo = 1;
        SELECT * FROM sgf.linea_base_entregable WHERE activo = 1;
        SELECT * FROM sgf.control_cambio WHERE activo = 1;
        SELECT CONVERT(CHAR(10), fecha, 23) AS fecha, descripcion, tipo FROM sgf.feriado ORDER BY fecha;
        SELECT codigo, valor, descripcion FROM sgf.parametro;`);
      const [consultores, contratos, adendas, planes, actividades, dependencias, linea_base, controles_cambio, feriados, parametros] = r.recordsets.map((rs) => normalizarTodas(rs));
      for (const a of actividades) a.avance = Number(a.avance);
      for (const e of linea_base) e.avance_corte = Number(e.avance_corte);
      return { consultores, contratos, adendas, planes, actividades, dependencias, linea_base, controles_cambio, feriados, parametros };
    },

    async crear(entidad, fila, { usuario, motivo, origen = 'UI', consultor_id = null } = {}) {
      const meta = ENTIDADES[entidad];
      const cols = Object.keys(fila).filter((c) => meta.columnas.includes(c));
      return enTransaccion(async (tx) => {
        const params = Object.fromEntries(cols.map((c) => [c, fila[c]]));
        params.__usuario = usuario;
        const r = await consulta(
          `INSERT INTO ${meta.tabla} (${[...cols, 'modificado_por'].join(', ')})
           OUTPUT INSERTED.*
           VALUES (${[...cols.map((c) => `@${c}`), '@__usuario'].join(', ')});`, params, tx);
        const nueva = normalizar(r.recordset[0]);
        await insertarBitacora({ usuario, entidad, entidad_id: nueva[meta.pk], consultor_id, accion: 'CREAR', cambios_json: { despues: fila }, motivo, origen }, tx);
        return nueva;
      });
    },

    async actualizar(entidad, id, cambios, { revision, usuario, motivo, origen = 'UI', consultor_id = null, accion = 'MODIFICAR' } = {}) {
      const meta = ENTIDADES[entidad];
      const cols = Object.keys(cambios).filter((c) => meta.columnas.includes(c));
      return enTransaccion(async (tx) => {
        const previo = await consulta(`SELECT * FROM ${meta.tabla} WITH (UPDLOCK, ROWLOCK) WHERE ${meta.pk} = @id;`, { id: Number(id) }, tx);
        if (!previo.recordset.length) throw Object.assign(new Error('Registro no encontrado'), { estado: 404 });
        const fila = normalizar(previo.recordset[0]);
        if (!meta.sinRevision && revision !== undefined && revision !== null && Number(revision) !== fila.revision) {
          throw Object.assign(new Error('Otro usuario modificó este registro. Recargue y vuelva a intentar.'), { estado: 409, actual: fila });
        }
        const antes = {};
        const despues = {};
        for (const c of cols) if (String(fila[c] ?? '') !== String(cambios[c] ?? '')) { antes[c] = fila[c] ?? null; despues[c] = cambios[c]; }
        if (!Object.keys(despues).length) return { fila, sinCambios: true };
        const params = Object.fromEntries(Object.keys(despues).map((c) => [c, despues[c]]));
        params.__id = Number(id);
        params.__usuario = usuario;
        const sets = [...Object.keys(despues).map((c) => `${c} = @${c}`), 'modificado_por = @__usuario'];
        if (!meta.sinRevision) sets.push('revision = revision + 1');
        const r = await consulta(`UPDATE ${meta.tabla} SET ${sets.join(', ')} OUTPUT INSERTED.* WHERE ${meta.pk} = @__id;`, params, tx);
        await insertarBitacora({ usuario, entidad, entidad_id: Number(id), consultor_id, accion, cambios_json: { antes, despues }, motivo, origen }, tx);
        return { fila: normalizar(r.recordset[0]), antes, despues };
      });
    },

    async historialEntidad(entidad, id) {
      const meta = ENTIDADES[entidad];
      const r = await consulta(
        `SELECT *, valido_desde, valido_hasta FROM ${meta.tabla} FOR SYSTEM_TIME ALL WHERE ${meta.pk} = @id ORDER BY valido_desde;`, { id: Number(id) });
      return normalizarTodas(r.recordset).map((f) => ({ ...f, valido_hasta: String(f.valido_hasta).startsWith('9999') ? null : f.valido_hasta }));
    },

    async registrarBitacora(e) { await insertarBitacora(e); },

    async listarBitacora({ consultor_id, entidad, entidad_id, limite = 200 } = {}) {
      const r = await consulta(
        `SELECT TOP (@limite) * FROM sgf.bitacora
         WHERE (@consultor_id IS NULL OR consultor_id = @consultor_id)
           AND (@entidad IS NULL OR entidad = @entidad)
           AND (@entidad_id IS NULL OR entidad_id = @entidad_id)
         ORDER BY bitacora_id DESC;`,
        { limite: Math.min(Number(limite) || 200, 1000), consultor_id: consultor_id ? Number(consultor_id) : null, entidad: entidad || null, entidad_id: entidad_id ? Number(entidad_id) : null });
      return normalizarTodas(r.recordset, SIN_FECHAS);
    },

    async guardarRecalculo(estado, { usuario, motivo }) {
      const actividades = [];
      const planes = [];
      for (const it of estado.consultores) {
        if (!it.pronostico) continue;
        for (const a of Object.values(it.pronostico.actividades)) {
          actividades.push({ actividad_id: a.actividad_id, inicio_probable: a.inicio_probable, fin_probable: a.fin_probable, desvio_dias: a.desvio_dias, avance_esperado: a.avance_esperado, situacion: a.situacion, critica: a.critica ? 1 : 0 });
        }
        planes.push({ plan_id: it.plan.plan_id, inicio_plan: it.pronostico.inicio_plan, fin_plan: it.pronostico.fin_plan, fin_probable: it.pronostico.fin_probable, avance_ponderado: it.pronostico.avance_ponderado, avance_esperado: it.pronostico.avance_esperado, spi: it.pronostico.spi, fin_vigencia: it.vigencia.fin_vigencia, holgura_dias: it.vigencia.holgura_dias, semaforo: it.vigencia.semaforo });
      }
      return enTransaccion(async (tx) => {
        const r = await consulta(
          `INSERT INTO sgf.recalculo (fecha_corte, metodo, ejecutado_por, motivo, resumen_json)
           OUTPUT INSERTED.recalculo_id VALUES (@corte, @metodo, @usuario, @motivo, @resumen);`,
          { corte: estado.corte, metodo: estado.metodo, usuario, motivo: motivo || null, resumen: JSON.stringify(estado.indicadores) }, tx);
        const recalculo_id = r.recordset[0].recalculo_id;
        await consulta(`
          MERGE sgf.actividad_pronostico AS t
          USING (SELECT * FROM OPENJSON(@j) WITH (actividad_id INT, inicio_probable DATE, fin_probable DATE, desvio_dias INT,
                 avance_esperado DECIMAL(5,2), situacion VARCHAR(20), critica BIT)) AS s
             ON t.actividad_id = s.actividad_id
          WHEN MATCHED THEN UPDATE SET recalculo_id = @rid, inicio_probable = s.inicio_probable, fin_probable = s.fin_probable,
               desvio_dias = s.desvio_dias, avance_esperado = s.avance_esperado, situacion = s.situacion, critica = s.critica, calculado_en = SYSDATETIME()
          WHEN NOT MATCHED BY TARGET THEN INSERT (actividad_id, recalculo_id, inicio_probable, fin_probable, desvio_dias, avance_esperado, situacion, critica)
               VALUES (s.actividad_id, @rid, s.inicio_probable, s.fin_probable, s.desvio_dias, s.avance_esperado, s.situacion, s.critica)
          WHEN NOT MATCHED BY SOURCE THEN DELETE;

          MERGE sgf.plan_pronostico AS t
          USING (SELECT * FROM OPENJSON(@p) WITH (plan_id INT, inicio_plan DATE, fin_plan DATE, fin_probable DATE, avance_ponderado DECIMAL(5,2),
                 avance_esperado DECIMAL(5,2), spi DECIMAL(6,3), fin_vigencia DATE, holgura_dias INT, semaforo VARCHAR(8))) AS s
             ON t.plan_id = s.plan_id
          WHEN MATCHED THEN UPDATE SET recalculo_id = @rid, fecha_corte = @corte, inicio_plan = s.inicio_plan, fin_plan = s.fin_plan,
               fin_probable = s.fin_probable, avance_ponderado = s.avance_ponderado, avance_esperado = s.avance_esperado, spi = s.spi,
               fin_vigencia = s.fin_vigencia, holgura_dias = s.holgura_dias, semaforo = s.semaforo, calculado_en = SYSDATETIME()
          WHEN NOT MATCHED BY TARGET THEN INSERT (plan_id, recalculo_id, fecha_corte, inicio_plan, fin_plan, fin_probable, avance_ponderado, avance_esperado, spi, fin_vigencia, holgura_dias, semaforo)
               VALUES (s.plan_id, @rid, @corte, s.inicio_plan, s.fin_plan, s.fin_probable, s.avance_ponderado, s.avance_esperado, s.spi, s.fin_vigencia, s.holgura_dias, s.semaforo);

          INSERT INTO sgf.plan_pronostico_historial (recalculo_id, plan_id, fecha_corte, fin_probable, avance_ponderado, avance_esperado, spi, holgura_dias, semaforo)
          SELECT @rid, plan_id, @corte, fin_probable, avance_ponderado, avance_esperado, spi, holgura_dias, semaforo
          FROM OPENJSON(@p) WITH (plan_id INT, fin_probable DATE, avance_ponderado DECIMAL(5,2), avance_esperado DECIMAL(5,2), spi DECIMAL(6,3), holgura_dias INT, semaforo VARCHAR(8));`,
          { j: JSON.stringify(actividades), p: JSON.stringify(planes), rid: recalculo_id, corte: estado.corte }, tx);
        return recalculo_id;
      });
    },

    async ultimoRecalculo() {
      const r = await consulta('SELECT TOP (1) * FROM sgf.recalculo ORDER BY recalculo_id DESC;');
      return r.recordset.length ? normalizar(r.recordset[0]) : null;
    },

    async historialPronostico(plan_id) {
      const r = await consulta('SELECT * FROM sgf.plan_pronostico_historial WHERE plan_id = @id ORDER BY recalculo_id;', { id: Number(plan_id) });
      return normalizarTodas(r.recordset);
    },

    async guardarParametro(codigo, valor, usuario) {
      return enTransaccion(async (tx) => {
        const r = await consulta(
          `UPDATE sgf.parametro SET valor = @valor, actualizado_por = @usuario, actualizado_en = SYSDATETIME()
           OUTPUT DELETED.valor AS antes, INSERTED.* WHERE codigo = @codigo;`, { codigo, valor: String(valor), usuario }, tx);
        if (!r.recordset.length) throw Object.assign(new Error('Parámetro no existe'), { estado: 404 });
        await insertarBitacora({ usuario, entidad: 'parametro', accion: 'MODIFICAR', cambios_json: { codigo, antes: r.recordset[0].antes, despues: String(valor) } }, tx);
        return normalizar(r.recordset[0], SIN_FECHAS);
      });
    },

    async guardarFeriado(f, usuario) {
      await enTransaccion(async (tx) => {
        await consulta(
          `MERGE sgf.feriado AS t USING (SELECT CAST(@fecha AS DATE) AS fecha) AS s ON t.fecha = s.fecha
           WHEN MATCHED THEN UPDATE SET descripcion = @descripcion, tipo = @tipo
           WHEN NOT MATCHED THEN INSERT (fecha, descripcion, tipo) VALUES (s.fecha, @descripcion, @tipo);`,
          { fecha: f.fecha, descripcion: f.descripcion, tipo: f.tipo || 'FERIADO' }, tx);
        await insertarBitacora({ usuario, entidad: 'feriado', accion: 'CREAR', cambios_json: f }, tx);
      });
    },

    async eliminarFeriado(fecha, usuario) {
      await enTransaccion(async (tx) => {
        await consulta('DELETE FROM sgf.feriado WHERE fecha = @fecha;', { fecha }, tx);
        await insertarBitacora({ usuario, entidad: 'feriado', accion: 'ANULAR', cambios_json: { fecha } }, tx);
      });
    },

    // ---------- usuarios
    async contarUsuarios() { return (await consulta('SELECT COUNT(*) AS n FROM sgf.usuario;')).recordset[0].n; },
    async buscarUsuario(correo) {
      const r = await consulta('SELECT * FROM sgf.usuario WHERE correo = @correo;', { correo });
      return r.recordset.length ? normalizar(r.recordset[0], SIN_FECHAS) : null;
    },
    async buscarUsuarioId(id) {
      const r = await consulta('SELECT * FROM sgf.usuario WHERE usuario_id = @id;', { id: Number(id) });
      return r.recordset.length ? normalizar(r.recordset[0], SIN_FECHAS) : null;
    },
    async listarUsuarios() {
      const r = await consulta('SELECT usuario_id, correo, nombre, rol, consultor_id, debe_cambiar_clave, activo, creado_en, ultimo_acceso FROM sgf.usuario ORDER BY nombre;');
      return normalizarTodas(r.recordset, SIN_FECHAS);
    },
    async crearUsuario(u) {
      try {
        const r = await consulta(
          `INSERT INTO sgf.usuario (correo, nombre, rol, consultor_id, clave_hash, debe_cambiar_clave)
           OUTPUT INSERTED.usuario_id, INSERTED.correo, INSERTED.nombre, INSERTED.rol, INSERTED.consultor_id, INSERTED.activo, INSERTED.debe_cambiar_clave
           VALUES (@correo, @nombre, @rol, @consultor_id, @clave_hash, @debe_cambiar_clave);`,
          { correo: u.correo, nombre: u.nombre, rol: u.rol, consultor_id: u.consultor_id ?? null, clave_hash: u.clave_hash, debe_cambiar_clave: u.debe_cambiar_clave ?? 1 });
        return normalizar(r.recordset[0], SIN_FECHAS);
      } catch (err) {
        if (err.number === 2627 || err.number === 2601) throw Object.assign(new Error(/consultor/i.test(err.message) ? 'Ese profesional ya tiene una cuenta' : 'Ya existe un usuario con ese correo'), { estado: 409 });
        throw err;
      }
    },
    async actualizarUsuario(id, cambios) {
      const permitidas = ['nombre', 'rol', 'consultor_id', 'clave_hash', 'debe_cambiar_clave', 'activo', 'ultimo_acceso'];
      const cols = Object.keys(cambios).filter((c) => permitidas.includes(c));
      if (!cols.length) return this.buscarUsuarioId(id);
      const params = Object.fromEntries(cols.map((c) => [c, cambios[c]]));
      params.__id = Number(id);
      const r = await consulta(
        `UPDATE sgf.usuario SET ${cols.map((c) => `${c} = @${c}`).join(', ')}
         OUTPUT INSERTED.usuario_id, INSERTED.correo, INSERTED.nombre, INSERTED.rol, INSERTED.consultor_id, INSERTED.activo, INSERTED.debe_cambiar_clave
         WHERE usuario_id = @__id;`, params);
      if (!r.recordset.length) throw Object.assign(new Error('Usuario no encontrado'), { estado: 404 });
      return normalizar(r.recordset[0], SIN_FECHAS);
    },

    // ---------- asistente de IA
    async crearConversacion(usuario, titulo) {
      const r = await consulta(
        'INSERT INTO sgf.ia_conversacion (usuario, titulo) OUTPUT INSERTED.* VALUES (@usuario, @titulo);', { usuario, titulo: (titulo || '').slice(0, 200) });
      return normalizar(r.recordset[0], SIN_FECHAS);
    },
    async obtenerConversacion(id) {
      const r = await consulta('SELECT * FROM sgf.ia_conversacion WHERE conversacion_id = @id;', { id });
      return r.recordset.length ? normalizar(r.recordset[0], SIN_FECHAS) : null;
    },
    async agregarMensaje(m) {
      await consulta(
        `INSERT INTO sgf.ia_mensaje (conversacion_id, rol, contenido_json, modelo, tokens_entrada, tokens_salida)
         VALUES (@conversacion_id, @rol, @contenido_json, @modelo, @tokens_entrada, @tokens_salida);`,
        { conversacion_id: m.conversacion_id, rol: m.rol, contenido_json: typeof m.contenido_json === 'string' ? m.contenido_json : JSON.stringify(m.contenido_json), modelo: m.modelo || null, tokens_entrada: m.tokens_entrada ?? null, tokens_salida: m.tokens_salida ?? null });
    },
    async listarMensajes(conversacion_id) {
      const r = await consulta('SELECT * FROM sgf.ia_mensaje WHERE conversacion_id = @id ORDER BY mensaje_id;', { id: conversacion_id });
      return normalizarTodas(r.recordset, SIN_FECHAS).map((m) => ({ ...m, contenido: JSON.parse(m.contenido_json) }));
    },
    async usoIA() {
      const r = await consulta('SELECT CONVERT(CHAR(10), dia, 23) AS dia, SUM(respuestas) AS respuestas, SUM(tokens_entrada) AS tokens_entrada, SUM(tokens_salida) AS tokens_salida FROM sgf.v_uso_ia GROUP BY dia ORDER BY dia;');
      return r.recordset;
    },
    async cerrar() { await pool.close(); },
  };
}

module.exports = { crearRepositorioSqlServer };
