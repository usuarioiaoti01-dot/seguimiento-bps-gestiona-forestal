# Plan de mejoras — Seguimiento de Proyectos OTI-SERFOR

Elaborado el **24/11/2026** a partir de `HANDOFF.md`, `CLAUDE.md` y la revisión del código actual (incluidos los cambios aún sin commit).
Recoge el proceso real de la OTI: profesionales contratados uno por uno, con su TDR y su Orden de Servicio, para proyectos
específicos, supervisados día a día por el Equipo de Desarrollo, más un tablero general de todos los proyectos.

Cómo usarlo: las secciones 1 a 8 dicen **qué** se construye y **por qué**; la sección 9 da los **criterios de programación**;
la 10 es la **hoja de ruta** con las instrucciones y el pedido listo para cada etapa; la 11 registra las **decisiones del usuario**
(tomadas el 24/11/2026; solo queda pendiente la D8).

**Decisión que más pesa en el diseño (D1):** el Equipo de Desarrollo entra con el perfil **JEFE_PROYECTO**; no se crea un perfil
supervisor. Cada proyecto tiene un equipo de uno o más Jefes de Proyecto (uno de ellos marcado como responsable), todos con los
mismos permisos dentro del proyecto. En este documento, «supervisar» es lo que hace ese equipo.
Si este documento choca con `CLAUDE.md`, prevalece `CLAUDE.md` en las reglas invariantes (§3) y este documento en el alcance funcional.

---

## 1. Diagnóstico: qué hay y qué falta

La aplicación nació para un caso (Gestiona Forestal: contratos con adendas, línea base de MS Project y planes formulados en la
aplicación) y luego se amplió a varios proyectos con «banderas». El proceso estándar de la OTI es otro: **un TDR y una Orden de
Servicio por profesional, con entregables a plazo fijo contados desde la notificación**. Las brechas:

| # | Lo que pide el proceso | Cómo está hoy | Brecha |
|---|---|---|---|
| B1 | Al registrar el proyecto se exigen **TDR, Orden de Servicio y la notificación** (PDF) | Se piden la OS y, opcionalmente, el TDR, después de registrar al profesional. La notificación no existe. | **Alta** |
| B2 | El plazo **inicia al día siguiente de la notificación** | El inicio se escribe a mano (`adenda_inicio`). No hay `fecha_notificacion`. | **Alta** |
| B3 | Seguimiento de los **productos/entregables del TDR** con su plazo de entrega | Solo la vigencia de la OS y las actividades del plan. La única tabla de entregables (`linea_base_entregable`) es la del MS Project de GF2026. | **Alta** |
| B4 | El **Equipo de Desarrollo supervisa**: registra avances a diario y sube evidencias | No hay equipo por proyecto ni un registro diario. JEFE_PROYECTO lo puede todo en todos los proyectos y el «jefe de proyecto» del proyecto es solo un nombre de un desplegable (`JEFES_PROYECTO`), no un usuario. Solo se adjuntan PDF a las actividades durante la formulación. | **Alta** |
| B5 | **Tablero general** de todos los proyectos, en curso y terminados | Se quitó la vista consolidada: cada pantalla se ve por proyecto. El proyecto solo tiene los estados ACTIVO/CERRADO. | **Alta** |
| B6 | Conformidad de cada entregable (presentado → observado → subsanado → conforme) | No existe. | Media |
| B7 | Una nueva OS (renovación) es una contratación nueva: otro número, TDR y notificación | «Renovar» agrega un periodo a la **misma** OS (`ampliarOrdenServicio`) y se pierde la trazabilidad de cada OS. | Media |
| B8 | GF2026 es la **excepción**, no la regla | GF2026 es el caso por defecto (las banderas nacen con adendas y línea base activas) y las reglas de la OS son el caso especial (`if (porOS)` repartidos en el código). | Media |
| B9 | Documentos ordenados y verificables | Seis carpetas con convenciones distintas (`PLANES_PDF_DIR`, `ADENDAS_PDF_DIR`, `ACTIVIDADES_PDF_DIR`, `CONTRATOS_PDF_DIR`, `PLANES_ORIGEN_DIR`, `DOCUMENTOS_DIR`), sin tabla de metadatos ni huella (hash). | Media |
| B10 | Operaciones compuestas atómicas | `registrarProfesional` escribe consultor, contrato y adenda en **tres transacciones separadas**: si falla la tercera, quedan datos a medias. | Media (técnica) |
| B11 | Separar pruebas de producción | El `.env` local usa `MODO_DATOS=sqlserver` contra **la misma base de producción** (10.6.1.112). | **Alta** (riesgo) |

Lo que **sí** se reutiliza sin cambios: el motor de recálculo y vigencia, la bitácora en la misma transacción, la concurrencia
optimista, las tablas temporales, el flujo de formulación del plan, el lector de documentos y la extracción con IA, la seguridad
(sesión, CSRF, CSP, límite de intentos) y el despliegue en IIS.

---

## 2. Proceso objetivo de un proyecto estándar (modalidad Orden de Servicio)

```
 1 REGISTRO         2 INICIO              3 PLAN DE TRABAJO      4 EJECUCIÓN Y SUPERVISIÓN     5 ENTREGABLES             6 CIERRE
 ───────────        ──────────            ─────────────────      ─────────────────────────     ─────────────             ────────
 Administrador      Automático al         Profesional (o el      Equipo de Desarrollo          Profesional presenta      Jefe de Proyecto /
 o Jefe:            subir la              Jefe) formula;         (Jefes de Proyecto del        → el Jefe revisa          Administrador:
 datos + TDR +      notificación:         Jefe revisa;           equipo) registra el parte     → CONFORME u OBSERVADO    última conformidad,
 OS (borrador)      inicio = día          Administrador          diario y sube evidencias;     → subsanación             informe de cierre,
 + notificación     siguiente; fechas     aprueba (flujo         el avance alimenta el         → conformidad             proyecto CONCLUIDO
 (3 PDF para        límite de cada        actual), con las       pronóstico y las alertas      (con fecha y documento)   → CERRADO
 ejecutar)          entregable            actividades agrupadas
                    calculadas            por entregable
```

**Estados del proyecto:** `REGISTRADO` → `EN_EJECUCION` → `CONCLUIDO` (todos los entregables conformes) → `CERRADO` (cierre
documentado). También pueden darse `SUSPENDIDO` (en espera, con motivo) y `ANULADO` (no llegó a ejecutarse, con motivo).
Un proyecto pasa a `EN_EJECUCION` automáticamente cuando su primera OS tiene notificación; en el tablero, «en curso» =
`REGISTRADO`, `EN_EJECUCION` o `SUSPENDIDO`, y «terminado» = `CONCLUIDO` o `CERRADO`.

**Estados de cada contratación (OS):** `REGISTRADA` (sin notificación) → `EN_EJECUCION` → `CULMINADA` (último entregable conforme)
o `RESUELTA` (resolución de la OS, con documento) o `ANULADA`.

**Estados de cada entregable:** `PENDIENTE` → `PRESENTADO` → `EN_REVISION` → `OBSERVADO` → `SUBSANADO` → `CONFORME`.
Un entregable `PENDIENTE` cuya fecha límite ya pasó se muestra como **vencido** (es un cálculo, no un estado que se guarda).

---

## 3. El caso atípico: Dirección de Control – Gestiona Forestal (GF2026)

- Se registra como **modalidad `CONTRATO_ADENDAS`** con `es_atipico = 1` y un motivo escrito: «Equipo de 11 profesionales BPS
  contratados desde 2025 con contrato y adendas sucesivas; cronograma propio (MS Project v3) financiado por KfW».
- **Conserva todo lo que funciona hoy:** contratos, adendas (`ANUNCIADA`…`CONCLUIDA`), vigencia por la última adenda FIRMADA,
  cobertura entre adendas, línea base 2026, actas de control de cambios y el «Adendas - Plazos» con el gráfico `VigenciaTimeline`.
- **No se le exigen** la notificación ni los PDF de forma retroactiva; sus plazos salen de las fechas de las adendas, no de una notificación.
- **La excepción no se replica:** solo el Administrador puede crear un proyecto con modalidad `CONTRATO_ADENDAS`, y el motivo es obligatorio.
  Todo proyecto nuevo nace con la modalidad `ORDEN_SERVICIO`.
- Una **prueba de regresión** fija el estado calculado de GF2026 (semilla) antes de cada etapa: ninguna mejora puede cambiarlo.
- En el tablero general, GF2026 aparece como un proyecto más, con una etiqueta «Atípico» y sus indicadores propios (vigencia y holgura en lugar de entregables).

---

## 4. Mejoras de proceso

| Código | Mejora | Qué resuelve |
|---|---|---|
| **P1** | **Expediente mínimo obligatorio.** Para registrar un proyecto de modalidad OS se suben el TDR y la OS (PDF), con número de OS, plazo total, monto y entregables: queda en borrador (`REGISTRADA`, sin fechas). Al subir el cargo o constancia de notificación (PDF), con su fecha y medio, la OS pasa a ejecución y se calculan todas las fechas. Sin los tres documentos no hay seguimiento. | B1 |
| **P2** | **La fecha de notificación es la única fuente del inicio.** El inicio y todas las fechas límite se calculan; nadie las escribe. Corregir la fecha de notificación es una reprogramación contractual: pide motivo y recalcula todo. | B2 |
| **P3** | **Entregables del TDR como columna vertebral del seguimiento.** Cada OS lleva sus entregables (número, nombre, plazo en días desde la notificación, peso o % de pago). Las actividades del plan se agrupan por entregable, y el semáforo compara el fin probable de esas actividades con la fecha límite del entregable. | B3 |
| **P4** | **Parte diario del Equipo de Desarrollo.** Cada día hábil un Jefe de Proyecto del equipo registra qué se hizo, el avance de cada actividad y las incidencias o riesgos, y adjunta evidencias. El parte no se edita: se corrige con otro parte que lo rectifica. Es la fuente del avance y queda en la bitácora. | B4 |
| **P5** | **Conformidad trazable.** Por cada entregable se registran la fecha de presentación (mesa de partes o correo), la revisión, las observaciones con su plazo de subsanación y la conformidad con su documento. Los plazos de revisión y de subsanación son parámetros. | B6 |
| **P6** | **Renovar = nueva contratación.** Una OS nueva para el mismo profesional crea un nuevo registro de contratación (con su TDR, OS, notificación y entregables) enlazado a la anterior. La «ampliación de plazo» de la misma OS es otra acción, con su documento de aprobación. | B7 |
| **P7** | **Equipo por proyecto.** El Administrador asigna a cada proyecto uno o más usuarios con perfil JEFE_PROYECTO del Equipo de Desarrollo (usuarios reales, no nombres de un desplegable) y marca a uno como responsable. Todos ven todos los proyectos, pero cada uno solo escribe en los suyos. | B4 |
| **P8** | **Tablero general (portafolio)** como pantalla de inicio de la Dirección y de los Jefes, con los proyectos en curso y los terminados, más el detalle por proyecto. | B5 |
| **P9** | **Cierre formal.** Para pasar a `CERRADO`: todas las OS culminadas o resueltas, todos los entregables conformes (o justificados), un informe de cierre (PDF) y lecciones aprendidas (texto). | B5 |
| **P10** | **Ambiente de pruebas separado.** Una base `SGF_SEGUIMIENTO_QA` (o el modo memoria) para el desarrollo local; la base de producción solo la usa el servidor de producción. | B11 |
| **P11** | **Alertas que llegan solas (etapa 5).** Correo diario a los Jefes de Proyecto del equipo: entregables que vencen en N días, partes no registrados, conformidades fuera de plazo, OS por vencer. | — |

---

## 5. Modelo de datos objetivo

Todo en scripts nuevos, idempotentes y aditivos (regla invariante 1). `db/12` y `db/13` todavía **no** están en producción: no se
editan (pudieron ejecutarse en la base que se usa localmente) y se despliegan junto con los nuevos.

### 5.1 Cambios a tablas existentes

| Tabla | Cambio |
|---|---|
| `sgf.proyecto` | `modalidad` (`ORDEN_SERVICIO` \| `CONTRATO_ADENDAS` \| `GESTION_INTERNA`), `es_atipico` BIT, `motivo_atipico`, `unidad_usuaria` (dirección o unidad que requiere), `objetivo`, `fecha_cierre`, `lecciones_aprendidas`. Se **amplía** el CHECK de `estado` a `REGISTRADO, EN_EJECUCION, SUSPENDIDO, CONCLUIDO, CERRADO, ANULADO` y se migra `ACTIVO` → `EN_EJECUCION`. Las banderas `con_*` se **mantienen**, pero se derivan de la modalidad (ver C3). GF2026 → `CONTRATO_ADENDAS`, `es_atipico = 1`. El texto `jefe_proyecto` queda como dato histórico: el responsable real sale de `sgf.proyecto_miembro`. |
| `sgf.contrato` (la contratación) | `fecha_notificacion` DATE, `medio_notificacion` (`CORREO`, `PRESENCIAL`, `MESA_PARTES`, `SISTEMA`), `plazo_dias` INT (siempre días calendario), `fecha_fin` (calculada y guardada), `monto` DECIMAL(12,2) NOT NULL en la modalidad OS (confidencial), `estado_contratacion`, `contrato_anterior_id` (renovación), `fecha_culminacion`. |
| `sgf.adenda` | `tipo_periodo` (`ORIGINAL`, `AMPLIACION`, `ADENDA`). En la modalidad OS el periodo `ORIGINAL` lo **genera el sistema** desde la notificación y el plazo (así el motor de vigencia no se toca) y no se edita a mano. |
| `sgf.actividad` | `entregable_servicio_id` (FK): la actividad aporta a ese entregable. |
| `sgf.usuario` | Sin cambios de perfiles: el Equipo de Desarrollo usa JEFE_PROYECTO (D1). |

### 5.2 Tablas nuevas (temporales, con `activo`, `revision` y `modificado_por`, salvo que se indique)

| Tabla | Campos principales | Notas |
|---|---|---|
| `sgf.entregable_servicio` | `contrato_id`, `numero`, `nombre`, `descripcion`, `plazo_dias` (desde la notificación), `fecha_limite` (calculada), `peso` o `porcentaje_pago`, `estado`, `fecha_presentacion`, `fecha_observacion`, `plazo_subsanacion_dias`, `fecha_limite_subsanacion`, `fecha_conformidad`, `conformidad_ref`, `observacion` | Producto del TDR. No confundir con `linea_base_entregable` (MS Project de GF2026). |
| `sgf.proyecto_miembro` | `proyecto_id`, `usuario_id` (perfil JEFE_PROYECTO), `es_responsable` BIT, `desde`, `hasta` | Equipo y alcance de escritura por proyecto. Un solo responsable activo por proyecto (aparece en el PDF del plan y en el tablero). Baja lógica con `hasta`/`activo`. Reemplaza la lista fija `JEFES_PROYECTO` de `servicio.js`. |
| `sgf.parte_diario` | `proyecto_id`, `contrato_id`, `fecha`, `descripcion`, `incidencias`, `riesgos`, `registrado_por`, `rectifica_parte_id`, `anulado` | **Sin UPDATE** (como la bitácora): se rectifica con otro parte. No es temporal. |
| `sgf.parte_diario_item` | `parte_id`, `actividad_id`, `subactividad_indice`, `avance_reportado`, `estado_reportado`, `comentario` | Cada ítem se aplica por `servicio.actualizarActividad` / `actualizarSubactividad`. |
| `sgf.documento` | `tipo` (`TDR`, `ORDEN_SERVICIO`, `NOTIFICACION`, `ENTREGABLE`, `CONFORMIDAD`, `OBSERVACION`, `EVIDENCIA`, `PLAN_APROBADO`, `ADENDA`, `INFORME_CIERRE`, `ORIGEN_PLAN`, `CARGA`, `OTRO`), `entidad`, `entidad_id`, `proyecto_id`, `nombre_original`, `ruta_relativa`, `tipo_mime`, `bytes`, `sha256`, `version`, `reemplaza_id`, `confidencial` BIT, `subido_por`, `subido_en`, `activo` | Metadatos en SQL Server y archivo en disco. Resuelve el pendiente «¿los PDF van a SQL Server?»: **no**, solo sus metadatos y su huella. |

Scripts sugeridos (en el orden de la hoja de ruta): `14_documento.sql`, `15_equipo_proyecto.sql`,
`16_modalidad_proyecto.sql`, `17_orden_servicio_entregables.sql`, `18_parte_diario.sql`. Cada uno se agrega a
`herramientas/bd.js`, a `entidades.js` y a ambos repositorios, y trae su consulta de verificación al final
(`05_verificacion.sql` ya corrió en producción y no se edita).

---

## 6. Reglas de negocio y cálculo de plazos

**R-OS1 Inicio.** `inicio = fecha_notificacion + 1 día calendario`, aunque ese día sea sábado, domingo o feriado (un plazo
contractual en días calendario corre igual). **Los plazos de la OS y de sus entregables siempre se cuentan en días calendario**
(D5); los feriados no los afectan. Las actividades del plan de trabajo siguen en días hábiles, como hoy.

**R-OS2 Fin de la OS.** En días calendario: `fin = fecha_notificacion + plazo_dias` (es decir, `inicio + plazo_dias − 1`).

**R-OS3 Fecha límite de cada entregable.** `fecha_limite = fecha_notificacion + plazo_dias_entregable` (el plazo del entregable
se cuenta desde el mismo día que el de la OS). Ningún entregable puede vencer después del fin de la OS; los plazos de los
entregables son crecientes y el último coincide con el plazo total (si no coincide, se advierte, no se bloquea).

> Ejemplo: notificada el **24/11/2026**, plazo de 60 días calendario → inicio **25/11/2026**, fin **23/01/2027**.
> Entregable 1 a 30 días → **24/12/2026**; Entregable 2 a 60 días → **23/01/2027**.

**R-OS4 Documentos obligatorios (D6).** Para **registrar** una OS: TDR y OS (PDF, ≤ 15 MB, con la firma `%PDF` verificada), número
de OS, monto, plazo y entregables; queda `REGISTRADA`, sin fechas, y no entra al semáforo ni al motor. Para **ejecutarla**: la
fecha y el medio de notificación y el PDF de la notificación; al guardarlos, en una sola transacción, se calculan el inicio, el
fin y las fechas límite, se genera el periodo `ORIGINAL` y la OS pasa a `EN_EJECUCION` (y el proyecto también, si era su primera
OS). El tablero muestra las OS en borrador con más de `UMBRAL_BORRADOR_DIAS` (parámetro, 5) días sin notificación.

**R-OS5 Semáforo del entregable** (calculado en `server/motor`, nunca en el cliente):
- **ROJO:** vencido sin presentar; o observado con el plazo de subsanación vencido; o fin probable de sus actividades > fecha límite.
- **ÁMBAR:** vence en ≤ `UMBRAL_ENTREGABLE_DIAS` (parámetro, 7 por defecto) y no se ha presentado; o holgura entre 0 y el umbral.
- **VERDE:** en plazo y con holgura suficiente. **AZUL/GRIS:** conforme (cerrado).
- El semáforo de la OS es el peor de sus entregables pendientes; el del proyecto, el peor de sus OS en ejecución.

**R-OS6 Días de atraso.** `fecha_presentacion − fecha_limite` (si es mayor que 0). Hoy sirve como dato; el monto de la penalidad
queda como **cálculo referencial y opcional**: la fórmula usual de penalidad diaria por mora es `0,10 × monto / (F × plazo en días)`,
con F = 0,40 para plazos ≤ 60 días y 0,25 para plazos mayores, con tope del 10 % del monto. **Antes de programarla, confirmar la
fórmula y el tope con el Reglamento de la Ley N.° 32069 vigente y con Abastecimiento (OGA)**, y respetar lo que diga cada TDR.
Los factores van como parámetros (`PENALIDAD_F_CORTO`, `PENALIDAD_F_LARGO`, `PENALIDAD_TOPE`). La aplicación informa; no aplica penalidades.

**R-OS7 Conformidad.** Presentado un entregable, el equipo del proyecto tiene `PLAZO_REVISION_DIAS` (parámetro) para dar la
conformidad u observar; vencido ese plazo sin pronunciamiento, se genera una alerta para el responsable del proyecto y para el Administrador. Una observación fija `plazo_subsanacion_dias`
(lo dice el TDR; si no, el parámetro `PLAZO_SUBSANACION_DIAS`). Conforme el último entregable, la OS pasa a `CULMINADA`.

**R-OS8 Avance.** Avance de un entregable = avance ponderado por duración de sus actividades (el motor ya lo hace para los
resúmenes, regla R1); `CONFORME` = 100 %. Avance de la OS = suma ponderada por `peso` (o partes iguales). Avance del proyecto =
promedio ponderado por `monto` de sus OS en ejecución o culminadas (el monto es obligatorio en la modalidad OS, D4).

**R-PD1 Parte diario.** Fecha ≤ hoy y como máximo `PARTE_DIAS_ATRAS` (parámetro, 3) días hábiles hacia atrás sin justificación;
más atrás exige motivo. Puede haber varios partes por día. El avance reportado no puede bajar sin motivo. Solo se cargan partes
de proyectos en ejecución y por miembros del proyecto.

**R-PY1 Fechas del proyecto.** En la modalidad OS, el inicio y el fin reales del proyecto se derivan de sus contrataciones (menor
inicio y mayor fin); los que escribe el usuario son los **planificados**.

**R-PY2 Cierre.** `CONCLUIDO` es automático cuando todas sus OS están culminadas o resueltas. `CERRADO` lo marca el Jefe o el
Administrador con el informe de cierre. Se mantiene la regla actual: no se cierra con profesionales ACTIVOS.

---

## 7. Perfiles y alcance por proyecto

El Equipo de Desarrollo usa el perfil **JEFE_PROYECTO** (D1). «Sus proyectos» = los proyectos en los que el usuario es miembro
activo de `sgf.proyecto_miembro`.

| Acción | ADMIN | JEFE_PROYECTO (Equipo de Desarrollo) | PROFESIONAL |
|---|---|---|---|
| Tablero general y vista de cualquier proyecto (lectura) | ✔ | ✔ todos (D2) | ✘ |
| Crear o editar proyectos, modalidad, atípico, equipo del proyecto | ✔ | ✘ | ✘ |
| Registrar una OS (TDR, OS, monto, entregables) y su notificación | ✔ | ✔ en sus proyectos | ✘ |
| Parte diario, evidencias, avance de actividades | ✔ | ✔ en sus proyectos | Avance de sus actividades (como hoy) |
| Registrar la presentación de un entregable, observarlo o dar la conformidad | ✔ | ✔ en sus proyectos | ✘ |
| Aprobar el plan (Jefe / final) | ✔ / ✔ | ✔ en sus proyectos / ✘ | ✘ |
| Cerrar el proyecto | ✔ | ✔ en sus proyectos | ✘ |
| Ver el monto y los documentos `confidencial` (OS, notificación con domicilio o DNI) | ✔ | ✔ en sus proyectos | ✘ |
| Datos personales, cuentas y perfiles | ✔ | ✘ | ✘ |
| Su propio plan, sus entregables y su avance (cuenta opcional, D3) | — | — | ✔ |

En un proyecto donde el usuario no es miembro, el Jefe de Proyecto solo lee; la interfaz oculta los botones de escritura y el
servidor responde 403 si se intenta. Los proyectos sin equipo asignado (p. ej. GF2026 al migrar) los edita solo el Administrador
hasta que asigne su equipo; el script de migración puede asignar a GF2026 los Jefes que hoy trabajan en él.

El alcance se impone **en el servidor** (regla invariante 9) con una única función `puede(usuario, accion, { proyecto_id })`,
que lee la membresía de la base en cada petición, igual que hoy se leen el perfil y el vínculo.

---

## 8. Tablero general (portafolio)

**Pantalla de inicio** para ADMIN y JEFE_PROYECTO (todos los proyectos, con un filtro rápido «Mis proyectos»). Se calcula en el servidor con
una función pura `construirPortafolio(datos, { corte })` que reutiliza `construirEstado` por proyecto.

- **Tarjetas:** proyectos en curso, terminados en el año, OS en ejecución, entregables que vencen en 7 días, entregables vencidos
  sin presentar, conformidades fuera de plazo, OS por vencer en 15 días, OS en borrador sin notificar y monto comprometido frente a monto con conformidad (solo para
  ADMIN y, en sus proyectos, para el Jefe).
- **Tabla de proyectos:** código, nombre, modalidad (etiqueta «Atípico»), gestión, responsable y equipo, estado, avance %, semáforo, próximo
  entregable y su fecha, último parte diario (alerta si pasaron más de N días hábiles sin uno), N.° de OS. Filtros: estado
  (en curso / terminados / todos), gestión, Jefe, año y semáforo. Al hacer clic se abre el proyecto.
- **Línea de tiempo** (reutiliza `VigenciaTimeline` o una variante): una barra por OS en ejecución, con hitos en las fechas límite de los entregables.
- **Exportación** a Excel/CSV y, en la etapa 5, el reporte mensual en PDF para Gerencia.
- El tablero **no** reemplaza la vista por proyecto: la complementa (se recupera la vista consolidada que se quitó, §18 del handoff).

**Vista por proyecto (modalidad OS):** pestañas *Resumen* (datos, equipo, semáforo), *Contrataciones y entregables*, *Plan de
trabajo*, *Partes diarios*, *Documentos* (expediente con todos los PDF por tipo) y *Bitácora*. En GF2026 se conservan las opciones actuales.

---

## 9. Criterios de programación

Se suman a las reglas invariantes de `CLAUDE.md` §3, que siguen vigentes.

- **C1 Cálculo puro de plazos.** Nuevo `server/motor/plazos.js` con `calcularPlazosContratacion({ fecha_notificacion, plazo_dias, entregables })` → `{ inicio, fin, entregables: [{ numero, fecha_limite }], advertencias }`, siempre en días calendario (D5). Es la única fuente de esas fechas; el servidor las guarda y el cliente solo las muestra. Lleva pruebas en `test/motor.test.js` (fin de mes, cambio de año, año bisiesto, notificación en viernes o en víspera de feriado, entregables con plazos no crecientes o mayores que el plazo total).
- **C2 Cálculo puro de entregables y portafolio.** `server/motor/entregables.js` (estado efectivo, semáforo, días de atraso, penalidad referencial) y `server/motor/portafolio.js` (indicadores agregados). Sin acceso a la base, con pruebas.
- **C3 Modalidad como configuración, no como `if`.** Nuevo `server/modalidades.js`:
  ```js
  const MODALIDADES = {
    ORDEN_SERVICIO:   { documentos: ['TDR', 'ORDEN_SERVICIO', 'NOTIFICACION'], inicio: 'NOTIFICACION', adendas: false, lineaBase: false, entregables: true,  atipico: false },
    CONTRATO_ADENDAS: { documentos: [],                                        inicio: 'ADENDA',       adendas: true,  lineaBase: true,  entregables: false, atipico: true  },
    GESTION_INTERNA:  { documentos: [],                                        inicio: 'MANUAL',       adendas: false, lineaBase: false, entregables: false, profesionales: false },
  };
  ```
  Validaciones, menú y pantallas leen esta tabla (el cliente la recibe en `/api/proyectos`). Las banderas `con_*` se rellenan desde la modalidad al crear el proyecto, para no romper el código existente; luego se dejan de leer de forma gradual.
- **C4 Transacciones compuestas.** Exponer `repo.transaccion(async (tx) => …)` en ambos repositorios (en `sqlserver.js` ya existe `enTransaccion`; en `memoria.js`, copia y restauración ante error). `crear`/`actualizar` aceptan `{ tx }`. Toda operación de varios pasos (registrar una OS con sus entregables y documentos, parte diario con sus ítems, conformidad) va en **una** transacción con su bitácora. Primero se corrige `registrarProfesional`.
- **C5 Almacén documental único.** `server/documentos/almacen.js`: `guardar({ tipo, entidad, entidad_id, proyecto_id, buffer, nombre }, ctx)` valida el tipo por su contenido (firma `%PDF`, ZIP de Office, JPEG/PNG), el tamaño (15 MB por defecto, 50 MB para documentos que se leen), calcula el SHA-256 y escribe en `DOCUMENTOS_RAIZ/<proyecto>/<entidad>/<id>/<tipo>-<aaaammdd-hhmmss>-<sha8>.<ext>`: primero en un temporal; luego la fila en `sgf.documento` y la bitácora (misma transacción) y, al final, el renombrado. Reemplazar = nueva versión (`reemplaza_id`); nada se borra. Una herramienta `herramientas/migrar_documentos.js` indexa las seis carpetas actuales sin moverlas (registra la `ruta_relativa` existente). Las variables actuales siguen funcionando hasta terminar la migración.
- **C6 Permisos centralizados.** `server/permisos.js` con la matriz de la §7 y `puede(usuario, accion, { proyecto_id })`. Las rutas usan `seg.permite('accion')` y el `proyecto_id` se resuelve **en el servidor** a partir del recurso (actividad → plan → consultor → proyecto), nunca de lo que envía el cliente. La lista blanca del PROFESIONAL se mantiene. `test/perfiles.test.js` cubre cada celda de la matriz, incluidos un Jefe de Proyecto que lee un proyecto ajeno (200) y que intenta escribir en él (403).
- **C7 Sin regresión en GF2026.** Antes de la primera línea de la etapa 1, `test/regresion-gf2026.test.js` guarda una instantánea de `construirEstado` sobre la semilla (vigencias, holguras, semáforos, alertas). Toda etapa la debe pasar sin cambios.
- **C8 El cliente no calcula.** Fechas límite, semáforos, avances y días de atraso llegan del servidor. Las vistas nuevas usan `util.js` (`api`, `modal`, `esc`, formateos) y respetan los textos en español formal, dd/mm/aaaa y coma decimal.
- **C9 Bitácora con el lenguaje del negocio.** Motivos automáticos legibles: «Registro de la OS N.° 0123-2026 (notificada el 24/11/2026)», «Parte diario N.° 45: avance de la actividad 2.1 de 40 % a 60 %», «Conformidad del Entregable 2». Origen `UI`, `IA`, `SCRIPT` o `SISTEMA`, como hoy.
- **C10 Privacidad.** La OS y la notificación pueden traer DNI, RUC, domicilio y monto: se guardan como `confidencial = 1`, no se envían al modelo de IA (salvo el TDR, al que antes se le aplica `redactarPersonales`) y solo los ven los perfiles de la §7. El monto es visible para ADMIN y para el Jefe del proyecto.
- **C11 API coherente.** Rutas nuevas bajo el recurso del que dependen: `/api/proyectos/:id/contrataciones`, `/api/contrataciones/:id/entregables`, `/api/entregables/:id/presentar|observar|conformidad`, `/api/proyectos/:id/partes`, `/api/documentos/:id` (descarga con control de permiso y `Content-Disposition`), `/api/portafolio`. Respuestas de error como hoy (`{ error }`, 400/403/404/409, `requiereMotivo`).
- **C12 Fechas.** Fechas de negocio como `DATE` (texto `aaaa-mm-dd` en JS); los cálculos con `aDia`/`diaAFecha` y el calendario de `server/motor/calendario.js`; «hoy» siempre es `hoyLima()`. Nada de `new Date()` suelto en las reglas.
- **C13 Pruebas por etapa.** Cada etapa agrega pruebas del motor (reglas nuevas), de la API (flujo completo con modo memoria y carpetas temporales) y de perfiles. `npm test` pasa antes de cada entrega y la CI (`.github/workflows/ci.yml`) lo vuelve a correr.
- **C14 Scripts de base de datos.** Uno por etapa, idempotente (`IF COL_LENGTH… IS NULL`, `IF OBJECT_ID… IS NULL`), con migración de datos incluida (p. ej. `ACTIVO` → `EN_EJECUCION`; GF2026 → `CONTRATO_ADENDAS`) y con el texto de instalación al inicio. Se prueban primero en `SGF_SEGUIMIENTO_QA`. El DBA los ejecuta en producción.
- **C15 Documentación viva.** Al cerrar cada etapa se actualizan `CLAUDE.md` (estructura y reglas), `HANDOFF.md` (estado, API, pendientes) y este plan (se marca la etapa como hecha).

---

## 10. Hoja de ruta e instrucciones para continuar

**Forma de trabajo** (acordada, se mantiene): el usuario prueba en `localhost:3080`; se sube a GitHub solo cuando dice «sube los
cambios al gh»; no se pide aprobación del plan antes de ejecutar. Para probar la interfaz se usa una instancia temporal en otro
puerto con datos de prueba; **no se leen las credenciales reales del `.env`**.

### Etapa 0 — Estabilizar lo actual (antes de programar)
1. Probar localmente lo que está sin commit (proyectos, OS/TDR, plan desde documento) y una lectura real de PDF/Word con el asistente.
2. Commit y push cuando el usuario lo indique (hoy hay ~23 archivos modificados y 6 nuevos: es mucho trabajo sin respaldo).
3. **P10:** pedir al DBA una base `SGF_SEGUIMIENTO_QA` (copia de la estructura y de los datos de producción, sin datos personales
   si es posible) y apuntar el `.env` local a ella. Mientras tanto, desarrollar en modo memoria.
4. **Desplegar ya** `db/12` y `db/13` con el código actual (D7), después del commit y push: el DBA ejecuta los scripts →
   `git pull` + `npm ci --omit=dev` → agregar `CONTRATOS_PDF_DIR` y `PLANES_ORIGEN_DIR` al `.env` del servidor →
   `Restart-Service SerforiaNodeBackend` → Ctrl+F5. Verificar que GF2026 se ve igual que antes.
5. Reunir los nombres y correos del Equipo de Desarrollo (D8) para crear sus cuentas JEFE_PROYECTO en la etapa 1.

### Etapa 1 — Cimientos: transacciones, documentos y equipo por proyecto — ✔ HECHA (24/11/2026, sin commit)

Resultado: `db/14_documento.sql`, `db/15_equipo_proyecto.sql`, `server/documentos/almacen.js`, `server/permisos.js`,
`repo.transaccion` en ambos repositorios, equipo del proyecto (API y ventana «Equipo»), `herramientas/migrar_documentos.js`
(`npm run documentos:migrar`, simula por defecto) y 111 pruebas (`test/regresion-gf2026.test.js`, `test/equipo-documentos.test.js`).
Ajustes respecto de lo planeado:
- **Orden de escritura del almacén:** el archivo se escribe primero con un nombre único (nunca sobrescribe) y luego la fila
  y la bitácora; si la base falla, el archivo recién escrito se elimina. Así nunca queda una fila apuntando a un archivo inexistente.
- **Alcance:** se impone en el repositorio envuelto (`permisos.envolverRepositorio`), dentro del «alcance» de cada petición
  (AsyncLocalStorage); cubre API, asistente, cargas y formulación. Un Jefe de Proyecto no modifica ninguna ficha de proyecto,
  ni siquiera las suyas (eso es del Administrador).
- **Migración de db/15:** si la tabla está vacía, cada JEFE_PROYECTO activo queda en el equipo de todos los proyectos existentes
  (nadie pierde acceso al desplegar). El Administrador ajusta luego los equipos.
- Los PDF de plan, adenda, OS/contrato y TDR ya van al almacén; las evidencias de actividades, los documentos de origen de
  planes y los originales de cargas siguen en su carpeta, pero quedan registrados en `sgf.documento`.
- `05_verificacion.sql` no se tocó (ya corrió en producción): cada script nuevo trae su verificación al final.
- La Orden de Servicio / contrato es confidencial: solo la ven el Administrador y el equipo del proyecto.

- **Archivos:** `server/datos/sqlserver.js` y `memoria.js` (`transaccion`), `server/servicio.js` (`registrarProfesional` en una
  transacción), `server/documentos/almacen.js`, `server/permisos.js`, `server/server.js`, `db/14_documento.sql`,
  `db/15_equipo_proyecto.sql`, `herramientas/migrar_documentos.js`, `public/js/vistas/proyectos.js` (pestaña *Equipo*: agregar
  o quitar Jefes de Proyecto y marcar al responsable; reemplaza el desplegable fijo `JEFES_PROYECTO`), `public/js/app.js` (botones de escritura solo en «mis proyectos»).
- **Pruebas:** regresión GF2026 (C7), transacción que falla a mitad y no deja nada, almacén (tipo falso, tamaño, versión), matriz de permisos.
- **Hecho cuando:** el Administrador asigna dos Jefes de Proyecto a un proyecto (uno responsable); ambos escriben en él y solo leen
  los demás; los PDF nuevos quedan en `sgf.documento` con su SHA-256; `npm test` pasa.
- **Pedido para Claude Code:**
  > Lee `PLAN_DE_MEJORAS.md` y ejecuta la Etapa 1 completa siguiendo los criterios C4, C5, C6, C7, C13 y C14. Empieza por la prueba de regresión de GF2026.

### Etapa 2 — Modalidad y registro estándar con Orden de Servicio — ✔ HECHA (24/11/2026, sin commit)

Resultado: `db/16_modalidad_proyecto.sql`, `db/17_orden_servicio_entregables.sql`, `server/modalidades.js`,
`server/motor/plazos.js`, `server/motor/entregables.js`, `server/contrataciones.js`, alertas de entregables en `estado.js`,
vista `public/js/vistas/orden-servicio.js` (registro de la OS, notificación con vista previa de fechas, ampliación y
entregables) y 117 pruebas (`test/contrataciones.test.js` y reglas R-OS1 a R-OS5 en `test/motor.test.js`).
Ajustes respecto de lo planeado:
- Los PDF del TDR y de la OS se suben antes de registrar a un **área temporal** (`/api/documentos/temporales`, en memoria
  una hora) y el registro los toma por su ficha; así el registro exige ambos documentos sin cargar archivos grandes en JSON.
- Se agregó `contrato.fecha_registro` (para la alerta de OS sin notificar) y la alerta `ENTREGABLE_EN_RIESGO`
  (las actividades del plan terminarían después de la fecha límite).
- Un profesional puede tener varias OS: la vigente es la más reciente y la vigencia sale de los periodos de todas
  (así también se ven los días sin cobertura entre una OS y la siguiente). No puede tener dos OS sin notificar a la vez.
- La ampliación de plazo no mueve las fechas límite de los entregables (se advierte); corregir la notificación sí
  corre las ampliaciones ya registradas.
- Las características `con_*` ya no se eligen: se derivan de la modalidad. El registro antiguo con fechas a mano
  (`/profesionales`) y «Renovar» solo quedan para la modalidad Contrato con adendas.
- La penalidad referencial (R-OS6) **no** se programó: falta confirmar la fórmula con Abastecimiento.
- Pendiente para la Etapa 3: presentación, observación, subsanación y conformidad de entregables; paso automático
  a CONCLUIDO; vincular actividades del plan a sus entregables desde la formulación.

- **Archivos:** `db/16_modalidad_proyecto.sql`, `db/17_orden_servicio_entregables.sql`, `server/modalidades.js`,
  `server/motor/plazos.js`, `server/motor/entregables.js`, `server/servicio.js` (`registrarContratacion` reemplaza a
  `registrarProfesional` en la modalidad OS; `renovarContratacion` reemplaza a `ampliarOrdenServicio`; `ampliarPlazo` aparte),
  `server/motor/estado.js` (alertas de entregables), `entidades.js`, `public/js/vistas/proyectos.js` (asistente de registro en
  3 pasos: *Proyecto* → *Profesional y OS* (TDR, OS, monto, plazo) → *Entregables*; queda en borrador) y la acción
  **«Registrar notificación»** (fecha, medio y PDF, con las fechas calculadas a la vista antes de confirmar), `public/js/app.js` (menú según la modalidad).
- **Pruebas:** R-OS1 a R-OS5 en `motor.test.js`; flujo completo (sin TDR u OS → 400; borrador sin fechas y fuera del motor;
  notificación sin PDF → 400; con notificación → fechas correctas y OS en ejecución); renovación = nueva OS enlazada; monto oculto para quien no es del equipo; GF2026 intacto.
- **Hecho cuando:** un proyecto nuevo no se registra sin TDR y OS; no entra en seguimiento sin la notificación; el inicio es el día
  siguiente de la notificación; los entregables muestran su fecha límite y su semáforo.
- **Pedido para Claude Code:**
  > Lee `PLAN_DE_MEJORAS.md` y ejecuta la Etapa 2 (secciones 2, 3, 5, 6 y criterios C1–C3, C8–C12). Mantén GF2026 como modalidad CONTRATO_ADENDAS sin cambios en su comportamiento.

### Etapa 3 — Supervisión diaria y conformidad de entregables — ✔ HECHA (24/11/2026, sin commit)

Resultado: `db/18_parte_diario.sql`, `server/supervision.js`, alertas `SIN_PARTE_DIARIO` y `CONFORMIDAD_FUERA_DE_PLAZO`,
vista `public/js/vistas/supervision.js` (opción «Supervisión diaria» de cada proyecto), acciones de cada entregable en la
ventana «Entregables», entregable de cada actividad en «Formular Plan de Trabajo» y 118 pruebas (`test/supervision.test.js`).
Ajustes respecto de lo planeado:
- No se creó `server/supervision.js` «por servicio.js»: lee todo ANTES de abrir la transacción y escribe con el
  repositorio (en SQL Server una lectura completa dentro de la transacción esperaría a sus propios bloqueos). Usa las
  mismas reglas del avance (`servicio.consolidarActividad`, `avanceDeSubs`).
- El parte solo registra avance de actividades del plan APROBADO; sin plan aprobado admite solo la descripción.
- La alerta de parte faltante se limita a la modalidad Orden de Servicio (GF2026 puede registrar partes, pero no se le
  exige; así su estado calculado no cambia).
- Conforme el último entregable: OS CULMINADA, profesional CULMINADO (si no tiene otra OS abierta) y, si era la última OS
  del proyecto, proyecto CONCLUIDO (cambio automático con origen SISTEMA).
- `permisos.js`: se corrigió la versión que releía toda la base en cada escritura (se colgaría dentro de una transacción
  en SQL Server); ahora resuelve el proyecto con la foto tomada antes de la transacción y los registros creados en ella.
- Pendiente: cierre formal (P9: informe de cierre y lecciones aprendidas) y el tablero general (Etapa 4).

- **Archivos:** `db/18_parte_diario.sql`, `server/supervision.js` (partes diarios, presentación, observación, subsanación y
  conformidad, todo por `servicio.js` y en una transacción), rutas en `server.js`, `public/js/vistas/partes.js` (formulario
  rápido: actividades del plan con su avance actual, evidencias por arrastre de archivos, historial del proyecto),
  `public/js/vistas/entregables.js`, alertas nuevas en `estado.js` (`ENTREGABLE_POR_VENCER`, `ENTREGABLE_VENCIDO`,
  `CONFORMIDAD_FUERA_DE_PLAZO`, `SUBSANACION_VENCIDA`, `SIN_PARTE_DIARIO`).
- **Pruebas:** parte que actualiza el avance y la bitácora en una transacción; parte de otro proyecto → 403; rectificación; ciclo observado → subsanado → conforme; OS culminada al quedar conforme el último entregable.
- **Hecho cuando:** un Jefe de Proyecto del equipo registra su parte del día con evidencias en menos de un minuto y el pronóstico y el semáforo se actualizan.

### Etapa 4 — Tablero general — ✔ HECHA (24/11/2026, sin commit)

Resultado: `server/motor/portafolio.js` (función pura sobre `construirEstado`), `GET /api/portafolio` y
`/api/portafolio.csv`, vista `public/js/vistas/portafolio.js` («Tablero general», pantalla de inicio `#/` del
Administrador y de los Jefes de Proyecto) y 120 pruebas (`test/portafolio.test.js`). Sin scripts de base de datos.
Ajustes respecto de lo planeado:
- El tablero de cada proyecto pasó a `#/plazos` y ya no dice «Gestiona Forestal 2026» en los proyectos nuevos
  (GF2026 conserva su título y el gráfico «GESTIÓN DE LAS ADENDAS Y CONTRATOS 2026»).
- La línea de tiempo es propia (una barra por OS en ejecución con sus entregables como hitos y la fecha de corte);
  no se reutilizó `VigenciaTimeline`, pensado para la vigencia de los profesionales.
- Semáforo del proyecto = el peor entre sus entregables pendientes y la vigencia de sus profesionales activos.
- El monto solo aparece (tarjeta, tabla y CSV) en los proyectos del equipo del usuario; el Administrador ve todos.
- Pendiente: el reporte mensual en PDF para Gerencia (Etapa 5).

- **Archivos:** `server/motor/portafolio.js`, `GET /api/portafolio`, `public/js/vistas/portafolio.js` (ruta `#/` para
  ADMIN/JEFE; el actual «Adendas - Plazos» pasa a ser una opción de GF2026), exportación a CSV/Excel, `app.js` (menú: *Tablero
  general* arriba del grupo *Proyectos*).
- **Pruebas:** indicadores con proyectos en cada estado; el Jefe ve todos y el filtro «Mis proyectos» funciona; el monto solo aparece en los proyectos propios; el PROFESIONAL no accede; GF2026 con sus indicadores de vigencia.
- **Hecho cuando:** la Dirección ve en una pantalla todos los proyectos en curso y los terminados, con semáforo, avance y próximos vencimientos.

### Etapa 5 — Complementos — en curso (25/11/2026, sin commit)

Hecho (127 pruebas; sin scripts de base de datos nuevos). Revisión de código del 25/11/2026: la edición genérica de la OS ya no toca sus datos de contratación ni sus periodos, la corrección de entregables sube la revisión de la OS, una OS culminada o resuelta no genera alertas de vencimiento y el cierre no retira el informe si falla el recálculo posterior:
- **Cierre formal (P9):** `server/cierre.js`, `GET/POST /api/proyectos/:id/cierre`, botón «Cerrar proyecto». Exige: ninguna
  OS abierta, entregables con conformidad (o anulados por resolución), ningún profesional ACTIVO, informe de cierre (PDF,
  tipo INFORME_CIERRE en el almacén) y lecciones aprendidas. Lo hacen el Administrador o el equipo; ya no se cierra
  editando el proyecto (`servicio.js` lo rechaza).
- **Término anticipado de una OS:** «Resolver» (en ejecución → RESUELTA; anula los entregables pendientes con el motivo;
  culmina al profesional y, si era la última OS abierta, concluye el proyecto) y «Anular» (registrada sin notificar →
  ANULADA; el profesional queda NO_RENOVADO si no tiene otra contratación).
- **Reporte mensual para Gerencia:** `server/reporte-mensual.js`, `GET /api/reportes/mensual(.pdf)?mes=AAAA-MM` (corte al
  último día del mes, o hoy si está en curso): resumen, proyectos, hechos del mes (OS notificadas, culminadas o resueltas;
  entregables presentados, observados y conformes; partes; cierres) y alertas altas. Botón en el Tablero general.
  El monto, solo de los proyectos que el usuario puede ver.
- **Lectura del TDR con IA:** herramienta `registrar_tdr` del asistente, `POST /api/contrataciones/leer-tdr` y botón «Leer
  el TDR con IA» en el registro de la OS: precarga objeto, perfil, plazo y entregables (con % de pago) para que el usuario
  los revise; no escribe nada y no envía datos personales. Requiere `ANTHROPIC_API_KEY` y la salida a api.anthropic.com.

Bitácora por proyecto (§8, pestaña «Bitácora»), 25/11/2026: filtro por proyecto en la API y en la vista, y opción «Bitácora» en el menú de cada proyecto. Con esto la vista por proyecto del §8 queda completa.

Ficha del profesional con su Orden de Servicio y entregables (D3), 25/11/2026: la ven el equipo y el PROFESIONAL con cuenta (sin el monto); los periodos de la OS ya no se rotulan como adendas.

Expediente del proyecto (§8, pestaña «Documentos»), 25/11/2026: opción «Expediente» en cada proyecto con todos sus documentos por tipo, a qué pertenece cada uno, versión vigente y anteriores, y la regla de confidencialidad (`test/expediente.test.js`).

Integración con SQL Server real (25/11/2026): `test/integracion-sqlserver.test.js` recorre registro, corrección de entregables, notificación y su corrección, plan aprobado, partes con evidencia y rectificación, ciclo de entregables, culminación, cierre, anulación, resolución, ampliación, tablero, CSV y reporte PDF; verifica la reversión de transacciones, el 403 dentro de la transacción y operaciones simultáneas (200 o 409, sin bloqueos). Pasa contra una base limpia instalada con `bd:instalar`.

Pendiente:
- **Correo de alertas** diario (P11): requiere definir el servidor de correo institucional (SMTP o Google Workspace),
  la cuenta remitente y agregar una dependencia de envío; además, abrir la salida desde el servidor de aplicaciones.
- **Penalidad referencial** (R-OS6): confirmar la fórmula y el tope con Abastecimiento antes de programarla.
- Inicio de sesión con Google Workspace (SSO).
---

## 11. Decisiones del usuario (24/11/2026)

| # | Pregunta | Decisión |
|---|---|---|
| D1 | ¿Cómo entra el Equipo de Desarrollo que supervisa? | **Con el perfil JEFE_PROYECTO**, sin perfil nuevo. Dentro de sus proyectos también registra OS y aprueba planes (aprobación del Jefe). |
| D2 | ¿Qué alcance tiene un Jefe sobre los proyectos que no tiene asignados? | **Ve todos, escribe solo en los suyos.** |
| D3 | ¿El profesional contratado por OS tendrá cuenta? | **Sí, opcional:** formula su plan y ve sus entregables y su avance; los partes diarios los registra el equipo. |
| D4 | ¿Se registra el monto de la OS? | **Sí, obligatorio y confidencial** (ADMIN y el equipo del proyecto). |
| D5 | ¿En qué días se cuentan los plazos de los entregables? | **Siempre en días calendario**, sin opción de hábiles. |
| D6 | ¿Se puede registrar una OS emitida y aún no notificada? | **Sí, en borrador** (`REGISTRADA`, sin fechas); la notificación y su PDF se exigen para pasar a ejecución. |
| D7 | ¿Cuándo se despliegan `db/12` y `db/13`? | **Ya**, con el código actual (Etapa 0). |
| D8 | Nombres y correos del Equipo de Desarrollo y de los cuatro Jefes de Proyecto. | **Pendiente:** se necesitan para crear sus cuentas y asignarlos a los proyectos en la Etapa 1. |
| D9 | ¿Se mantiene la modalidad `GESTION_INTERNA`? | **Sí.** |

---

## 12. Riesgos y cómo se mitigan

| Riesgo | Mitigación |
|---|---|
| Romper GF2026, que está en producción y en uso | Prueba de regresión (C7), scripts aditivos, modalidad propia. |
| Con D1, la misma persona registra el avance y da la conformidad del entregable | La bitácora deja constancia de quién hizo cada cosa; el tablero muestra quién dio cada conformidad. Si más adelante se quiere separar funciones, basta con exigir que la conformidad la dé el responsable del proyecto (una línea en `permisos.js`). |
| Probar contra la base de producción | Base QA o modo memoria (P10). |
| Datos a medias por fallas en operaciones compuestas | Transacciones compuestas (C4). |
| Documentos perdidos o sin respaldo | `sgf.documento` + SHA-256 + respaldo programado de `C:\datos\seguimiento` (pendiente operativo del handoff). |
| Fórmula de penalidad mal aplicada | Solo referencial, parametrizada y validada con OGA (R-OS6). |
| Exposición de datos personales de la notificación o de la OS | Documentos confidenciales (C10) y fuera del alcance de la IA. |
| Mucho código sin commit | Etapa 0: commit y push antes de empezar. |
