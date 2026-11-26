# Handoff — Seguimiento de Proyectos (OTI – SERFOR)

Estado al **24/11/2026**. Este documento reúne todo el contexto de la aplicación: negocio, arquitectura, modelo de datos, reglas,
permisos, API, interfaz, IA, despliegue, historia y pendientes. Complementa a `CLAUDE.md` (contrato de trabajo y reglas invariantes),
que sigue siendo la referencia para escribir código.

---

## 1. Resumen ejecutivo

Aplicación web de la **Oficina de Tecnologías de la Información (OTI) del SERFOR** para dar seguimiento a proyectos y a su personal
contratado. Nació para un solo proyecto —**Gestiona Forestal 2026** (Proyecto Bosques PI 2, UE 003, KfW), con 11 consultores BPS que
desarrollan sus aplicativos— y hoy gestiona **varios proyectos**, cada uno con sus propias características.

Qué resuelve:

- **Contratación y vigencia:** contrato u Orden de Servicio → adendas; la vigencia es el fin de la última adenda **FIRMADA** (o el fin del periodo de la Orden de Servicio).
- **Planes de trabajo:** se formulan en la aplicación (o desde un documento ya elaborado), pasan por revisión del Jefe de Proyecto y aprobación del Administrador, y recién entonces empieza el seguimiento.
- **Fecha probable de término:** un motor de recálculo compara el plan con la vigencia (holgura y semáforo).
- **Línea base 2026:** entregables del cronograma MS Project v3 (corte 17/08/2026) y su cobertura por los planes.
- **Alertas** de vigencia, plan, actividades vencidas, línea base y control de cambios.
- **Asistente de IA** (Claude Haiku): consulta, simula y **propone**; nunca escribe.
- **Trazabilidad:** tablas temporales de SQL Server (valores) + bitácora (usuario, motivo, origen).

Usuarios: Director de TI (perfil **ADMIN**, «Dirección OTI»), Jefes de Proyecto y los profesionales contratados.

---

## 2. Estado actual de cada cosa

| Dónde | Qué contiene |
|---|---|
| **Producción** — rama `seguimiento-bps-gestiona-forestal-v.02`, commit `53c92f0` (Etapa 1) | La base `SGF_SEGUIMIENTO` se **reinstaló a propósito** el 24/11/2026 a las 19:20 (cuentas y bitácora anteriores no se conservan) y el DBA ejecutó `db/12`–`db/18` el 25/11/2026 (verificado: 51/51). El servicio se reinició el 25/11/2026 y existe la cuenta del administrador principal (debe cambiar su clave). Faltan las cuentas de los Jefes de Proyecto, sus equipos y desplegar las Etapas 2–5 (sin commit). |
| **Solo en el equipo local, sin commit** | Todo lo de «Proyectos»: `db/12`, `db/13`, menú lateral por proyecto, características del proyecto, Orden de Servicio y TDR, registro del plan desde documento, nueva denominación, este handoff, `PLAN_DE_MEJORAS.md` y la **Etapa 1** (24/11/2026): `db/14` almacén documental, `db/15` equipo por proyecto y permisos, transacciones compuestas, migración de documentos. |

- Repositorio: `https://github.com/usuarioiaoti01-dot/seguimiento-bps-gestiona-forestal` (cuenta institucional de la OTI; público por decisión del usuario). 16 commits en `main`.
- Pruebas: **152** (`npm test`), todas pasando, y **4 de integración con SQL Server real** (`npm run test:sqlserver`, base local en Docker; pasan las 4 el 25/11/2026). `db/16` se instala ahora en una base limpia: su lote 10 (modalidad NOT NULL) fallaba por el historial temporal; en producción también falló y la columna quedó NULL-able, que es lo que el script deja ahora. Código ≈ 7 000 líneas de JS (servidor + cliente).
- Modo de trabajo acordado: el usuario prueba en `localhost:3080`; **solo se sube a GitHub cuando dice «sube los cambios al gh»**; no se pide aprobación de un plan antes de ejecutar (prevalece sobre `CLAUDE.md` §5). Los cambios llegan a producción con `git pull` + reinicio del servicio.

---

## 3. Dominio y glosario

- **BPS:** consultores/personal contratado que desarrolla los aplicativos del proyecto.
- **Gestiona Forestal:** conjunto de aplicativos de SERFOR; proyecto inicial (`GF2026`).
- **Contrato / Orden de Servicio (OS):** instrumento de contratación del profesional. Con `con_orden_servicio` el instrumento es una OS y su periodo es la vigencia.
- **Adenda:** ampliación de plazo. Estados: `ANUNCIADA`, `EN_TRAMITE`, `FIRMADA`, `ANULADA`, `CONCLUIDA` (histórica). Solo `FIRMADA` amplía la vigencia; `CONCLUIDA` cuenta para la cobertura histórica pero no cambia la vigencia.
- **Vigencia:** fin de la última adenda firmada. Holgura = fin de vigencia − fin probable del plan.
- **Plan de trabajo:** cronograma de actividades de un profesional para un periodo (el de su adenda/OS vigente). Actividad = descripción + producto/evidencia + días hábiles + subactividades.
- **Línea base (LB) / EDT:** entregables del cronograma MS Project v3 con su código EDT (p. ej. `1.1.1`); una actividad puede ser `ALINEADA`, `REASIGNADA`, `NUEVA` (exige Acta de Control de Cambios) o `TRANSVERSAL`.
- **Corte:** fecha a la que se calcula el estado (parámetro `FECHA_CORTE`; vacío = hoy en hora de Lima; la barra superior permite verla a otra fecha solo para consulta).
- **SPI:** índice de desempeño usado por el método de pronóstico RENDIMIENTO (acotado a `[SPI_MINIMO, 1,5]`).
- **TDR:** Términos de Referencia del personal. **CUI/UE:** códigos presupuestales (ya no se piden en el registro de proyectos).

---

## 4. Arquitectura

```
public/ (HTML + CSS + módulos ES sin compilación)
   └─ fetch /api  ──►  server/server.js (Express: sesión, permisos, rutas)
                           ├─ server/servicio.js        reglas de negocio; TODA escritura pasa por aquí
                           ├─ server/formulacion.js     flujo del plan de trabajo
                           ├─ server/documentos/*       lectura de archivos y propuestas de cambios
                           ├─ server/ia/agente.js       asistente (consulta / propone)
                           ├─ server/motor/*            cálculo puro: calendario, recálculo, estado, cobertura
                           └─ server/datos/*            repositorios: memoria.js (demo/pruebas) · sqlserver.js (producción)
```

- **Repositorios intercambiables** con la misma interfaz (`MODO_DATOS=memoria|sqlserver`). `entidades.js` es la lista blanca de columnas editables y la fuente de la que se derivan tablas, claves y colecciones.
- **Una escritura** = validar en `servicio.js` → `repo.crear/actualizar` (que registra la **bitácora en la misma transacción**, con usuario, motivo y origen `UI`/`IA`/`SCRIPT`/`SISTEMA`) → recalcular y guardar el pronóstico.
- **Concurrencia optimista:** las tablas editables tienen `revision`; la UI la envía y el servidor responde 409 si cambió.
- **Motor puro:** `server/motor` no toca la base; recibe los datos y devuelve el estado (`construirEstado`). El pronóstico se calcula **solo en el servidor**; la UI únicamente muestra.
- **Caché de datos:** `servicio.datos()` mantiene en memoria la foto de la base; `datos(true)` fuerza relectura; las escrituras invalidan la caché.
- **Recálculo diario:** la primera consulta de cada día dispara el recálculo del corte vigente.
- **Cliente:** una vista por ruta hash (`app.js` → `RUTAS`), componentes en `public/js/vistas`, helper `util.js` (`api`, `modal`, `esc`, formateos). El componente `VigenciaTimeline` (gráfico del tablero) viene del paquete `oti-visual/`; `public/tokens.css` y `public/js/vigencia-timeline/` son copias idénticas (no se editan a mano).
- **Mapa de directorios:** `db/` (DDL T-SQL, fuente de verdad del modelo), `server/`, `public/`, `herramientas/` (semilla, historial, instalación de BD, reinicio de planes), `deploy/iis/` (guía y scripts de IIS), `test/`, `oti-visual/`, `data/` (semilla y demo; no se versiona lo generado), `.github/workflows/ci.yml` (corre `npm test`), `Dockerfile`.

---

## 5. Modelo de datos (esquema `sgf`)

Todas las tablas editables son **temporales** (`SYSTEM_VERSIONING`, historial en `*_historial`) y llevan `activo`, `revision` y `modificado_por`. Nada se borra físicamente: bajas lógicas con `activo = 0` o `estado = 'ANULADA'`.

| Tabla | Para qué sirve (campos relevantes) |
|---|---|
| `proyecto` | `codigo` (único, `PRY-AAAA-NNN`), `nombre`, `financiador`, `area_tecnica`, `jefe_proyecto`, `fecha_inicio/fin`, `descripcion`, `estado` (ACTIVO/CERRADO) y banderas `con_profesionales`, `con_adendas`, `con_linea_base`, `con_orden_servicio`, `con_tdr`. |
| `consultor` | El profesional: `clave` (2–5 letras, única), `nombres`, `perfil`, `sede`, `estado` (ACTIVO/NO_RENOVADO/CULMINADO), `proyecto_id`, `proyecto` (texto heredado, obligatorio), datos personales (`dni`, `telefono`, `correo_personal`: solo ADMIN). |
| `contrato` | Contrato u OS del consultor: `numero` (único), `tipo_documento` (CONTRATO/ORDEN_SERVICIO), `expediente`, `fecha_inicio`. |
| `adenda` | Periodos del contrato: `numero`, `fecha_inicio/fin`, `estado`, `plazo_dias`, `plazo_solicitado_dias`, `fecha_suscripcion`, `documento_ref`, `inicio_calculado`. |
| `plan_trabajo` | Plan del consultor para una adenda: `estado` (POR_REGISTRAR, EN_FORMULACION, EN_REVISION_JEFE, EN_REVISION_ADMIN, OBSERVADO, APROBADO), `area_usuaria`, `supuestos`, fechas de envío/aprobación, `aprobado_jefe_por`, `observacion_revision`, `fecha_subsanacion`, `documento_origen`, `tipo_dias` (HABILES). |
| `actividad` | `numero`, `descripcion`, `producto`, `dias_plan`, `subactividades` (JSON `[{t,d,p,a}]` = texto, días, producto, avance), `inicio_plan/fin_plan`, fechas reales, `avance`, `estado`, `clasificacion`, `entregable_id`, `control_cambio_id`, `agregada_por` (NULL = profesional; JEFE_PROYECTO/ADMIN), `evidencia`, `observacion`. |
| `actividad_dependencia` | Predecesoras fin→inicio con desfase (negativo = solapamiento). |
| `linea_base_entregable` | Entregables del cronograma: `edt` (único), `inicio_lb/fin_lb`, `avance_corte`, `situacion`, `situacion_oti`, `consultor_id`. |
| `control_cambio` | Actas (BORRADOR/APROBADO/RECHAZADO) que sustentan las actividades `NUEVA`. |
| `feriado`, `parametro` | Calendario y parámetros (ver §10). Los feriados se pueden borrar físicamente. |
| `usuario` | Cuentas: `correo`, `rol`, `consultor_id` (vínculo del PROFESIONAL), `clave_hash` (bcrypt), `debe_cambiar_clave`, `activo`. |
| `bitacora` | Registro inmutable (sin UPDATE): usuario, entidad, acción, `cambios_json`, motivo, origen. |
| `recalculo`, `plan_pronostico(_historial)`, `actividad_pronostico` | Resultados del motor (se pueden recrear). |
| `ia_conversacion`, `ia_mensaje` | Conversaciones y uso del asistente (tokens). |

Relaciones: `proyecto 1—N consultor 1—N contrato 1—N adenda`; `consultor 1—N plan_trabajo 1—N actividad`. Contratos, adendas, planes y actividades **heredan el proyecto del consultor**.

**Scripts** (`db/`, todos idempotentes; el DBA los ejecuta porque `usSgfSeguimiento` no es `db_owner`):

| Script | Contenido | En producción |
|---|---|---|
| 01–05 | Esquema, vistas, seguridad (rol `sgf_app`), datos iniciales, verificación | Sí |
| 06 | Historial de adendas concluidas (generado desde `db/fuentes/historial_adendas_01_02.csv`) | Sí |
| 07 | Perfiles de usuario y vínculo cuenta↔consultor | Sí |
| 08–09 | Aprobación del plan; formulación (estados y cabecera) | Sí |
| 10–11 | `dias_plan` y `subactividades`; `agregada_por` | Sí |
| 12 | `proyecto`, `consultor.proyecto_id` (pasa los consultores a `GF2026`) | Sí (24/11/2026) |
| 13 | Banderas del proyecto, `contrato.tipo_documento`, `plan_trabajo.documento_origen` | Sí (24/11/2026) |
| 14 | `sgf.documento`: metadatos del almacén documental (SHA-256, versión, confidencial) | Sí (24/11/2026) |
| 15 | `sgf.proyecto_miembro`: equipo de cada proyecto (migra a los JEFE_PROYECTO activos a todos los proyectos) | Sí (24/11/2026) |
| 16 | Modalidad y estados del proyecto (GF2026 = CONTRATO_ADENDAS atípico; ACTIVO → EN_EJECUCION) | Sí (25/11/2026) |
| 17 | Orden de Servicio con notificación, monto y estado; `sgf.entregable_servicio`; `adenda.tipo_periodo`; parámetros de entregables | Sí (25/11/2026) |
| 18 | Partes diarios (solo inserción), `entregable_servicio.fecha_subsanacion`, parámetros de supervisión | Sí (25/11/2026) |

Regla: todo cambio de estructura = nuevo script `NN_descripcion.sql` + actualizar `entidades.js`, ambos repositorios y las pruebas; no se editan scripts ya ejecutados en producción. `herramientas/bd.js` instala `01`–`13` en una base vacía y `npm run bd:probar` verifica conexión y permisos. `data/semilla.json` y `db/04` se generan desde `herramientas/matriz_control.xlsx` (`npm run semilla`).

---

## 6. Reglas de negocio

**Vigencia y adendas**
- Vigencia = fin de la última adenda `FIRMADA`. Una adenda nueva nace `EN_TRAMITE`; `FIRMADA` exige referencia de documento.
- Cobertura entre adendas (`cobertura.js`): solo cuentan `CONCLUIDA` y `FIRMADA` activas. Hueco > 0 → alerta ALTA `ADENDAS_SIN_COBERTURA`; < 0 → superposición, alerta MEDIA `ADENDAS_SUPERPUESTAS`.
- Sin fechas pero con plazo, el inicio de una adenda se calcula desde el fin de la última firmada/concluida (`inicio_calculado = 1`) y se advierte.

**Motor de recálculo** (`motor/recalculo.js`)
- R1 resúmenes (`2` con hijas `2.1`) = mín. inicio, máx. fin, avance ponderado por duración · R2 dependencias fin→inicio con desfase · R3 concluida → fin probable = fin real · R4 sin iniciar y vencida → se reprograma desde el corte conservando su duración · R5 iniciada → faltante = duración × (1 − avance) / SPI (RENDIMIENTO) o sin SPI (LINEAL) · R6 desvío = fin probable − fin del plan · R7 ruta crítica.
- Semáforo: VERDE (holgura ≥ `UMBRAL_HOLGURA_DIAS`), ÁMBAR, ROJO (< 0 o vigencia vencida), GRIS (sin plan). El motor **ignora las actividades de planes no aprobados**.
- Días CALENDARIO por defecto (plazos contractuales); HÁBILES por plan, con `feriado`.

**Cambios y consistencia**
- Cambiar `inicio_plan`/`fin_plan` de una actividad es **reprogramación**: exige motivo (≥ 5 caracteres); la API responde 400 con `requiereMotivo: true`.
- Avance 0–100; al llegar a 100 la actividad pasa a `CONCLUIDA` (fin real asumido si falta); con avance > 0 una `PENDIENTE` pasa a `EN_CURSO`.
- Con subactividades, el avance de la actividad = promedio ponderado por días de sus subactividades (no se edita directamente).

**Plan de trabajo** (`formulacion.js`)
- Etapas: `POR_REGISTRAR` → `EN_FORMULACION` (profesional) → `EN_REVISION_JEFE` (queda fijo para el profesional; el Jefe puede modificar, agregar actividades marcadas y aprobar) → `EN_REVISION_ADMIN` (el Administrador aprueba u observa con comentarios; `OBSERVADO` vuelve al Jefe, con plazo de subsanación) → `APROBADO` (fijo; arranca el seguimiento).
- Periodo = el de la adenda/OS vigente (no editable); la suma de días de las actividades no puede exceder los días hábiles del periodo.
- Actividad: 1–99 días hábiles; producto/evidencia obligatorio (por subactividad si las hay); hasta 20 subactividades; la suma de sus días no excede los de la actividad. Las fechas las calcula la aplicación (una actividad tras otra, en días hábiles) y son **referenciales** hasta la aprobación del Administrador, que las recalcula desde ese día.
- Al aprobar el Jefe y de nuevo el Administrador se genera y guarda el PDF del plan. El plan aprobado se ve como «Plan Aprobado» en Contratos y adendas.
- **Registro desde documento:** Excel/CSV por columnas (N.°, Actividad, Producto/evidencia, Inicio/Fin o Días; filas `1.1` = subactividades) o PDF/Word leídos por el asistente; vista previa y confirmación; solo se toman días (las fechas del documento no se copian).

**Proyectos**
- Código autogenerado `PRY-AAAA-NNN`, no editable. Solo el **Administrador** crea y edita proyectos y designa la gestión (Equipo de Desarrollo, Equipo de Infraestructura, Seguridad de la Información, Equipo de Base de Datos) y el jefe de proyecto (Alex Tantachuco, Iván Rengifo, Martín Chocce, José Carlos Gallardo).
- Sin `con_profesionales` no hay adendas, línea base, OS ni TDR. Las tres primeras banderas no cambian con profesionales registrados. No se cierra un proyecto con profesionales ACTIVOS.
- Con `con_orden_servicio`: la OS se registra con su periodo (obligatorio) y su PDF (obligatorio); con `con_tdr`, también el PDF de los TDR. Sin adendas, «Renovar» agrega el periodo siguiente (`ampliarOrdenServicio`).
- Alertas de vigencia para OS: «Orden de Servicio vencida / vence en N días».

---

## 7. Seguridad y permisos

- **Autenticación:** usuario y clave (bcrypt) con sesión en cookie httpOnly firmada (JWT, `SESION_SECRETO`, `SESION_HORAS`; `COOKIE_SEGURA=true` con HTTPS). Clave ≥ 10 caracteres con letras y números; la temporal se muestra una vez y obliga a cambiarla en el primer ingreso. Límite de intentos de ingreso (`limitarIngreso`) y cabecera obligatoria `X-SGF` en `/api` (mitigación CSRF). Cabeceras de seguridad y CSP en todas las respuestas; los PDF se sirven con `frame-ancestors 'self'`.
- **El perfil, el vínculo y el estado de la cuenta se leen de la base en cada petición** (desactivar o restablecer clave surte efecto inmediato). Las cuentas no se eliminan. El administrador principal (`ADMIN_CORREO`) no se degrada ni se desactiva.
- **Perfiles y niveles:** PROFESIONAL (1) < JEFE_PROYECTO (2) < ADMIN (3); `LECTOR`/`EDITOR` son alias de nivel que usan las rutas.

| Acción | ADMIN | JEFE_PROYECTO | PROFESIONAL |
|---|---|---|---|
| Crear usuarios, cambiar perfiles, ver datos personales | ✔ | ✘ | ✘ |
| Crear/editar proyectos | ✔ | ✘ | ✘ |
| Registrar profesionales, OS/TDR, renovar OS | ✔ | ✔ | ✘ |
| Todo el seguimiento, adendas, línea base, bitácora, configuración | ✔ | ✔ | ✘ |
| Cargar documentos / Actualizar Desde Archivo | ✔ | ✔ | ✘ |
| Aprobar el plan por el Jefe | ✔ | ✔ | ✘ |
| Aprobar u observar el plan (final) | ✔ | ✘ | ✘ |
| Formular su propio plan | ✔ | ✔ | ✔ (el suyo) |
| Estado de sus actividades, avance de sus subactividades | ✔ | ✔ | ✔ (las suyas) |

- **Alcance del PROFESIONAL:** impuesto en el servidor (`server.js`, lista blanca de rutas y campos): su ficha, su bitácora, su PDF, `/formulacion/*`, el asistente acotado y el PATCH de avance/estado de sus actividades.
- **Datos personales** (`dni`, `telefono`, `correo_personal`): solo ADMIN los ve o edita; jamás se envían al modelo de IA ni a la bitácora de otros roles (`sanearBitacora`, `redactarPersonales`).
- **Secretos:** todo en `.env` (no versionado); no se imprimen claves en registros.

---

## 8. API (resumen por área; nivel mínimo entre corchetes)

- **Sesión y cuentas:** `POST /api/auth/ingresar|salir|cambiar-clave`, `GET /api/auth/yo` · `GET/POST/PATCH /api/usuarios`, `POST /api/usuarios/profesionales` [ADMIN].
- **Consulta:** `GET /api/estado`, `/api/consultores/:id`, `/api/adendas`, `/api/linea-base`, `/api/bitacora`, `/api/historial/:entidad/:id`, `/api/parametros`, `/api/exportar/actividades.csv` (todas aceptan `proyecto_id` donde aplica).
- **Proyectos:** `GET /api/proyectos` (+ `/jefes`, `/areas`, `/:id/profesionales`) · `POST/PATCH /api/proyectos` [ADMIN] · `POST /api/proyectos/:id/profesionales` y `/:cid/renovar` [EDITOR] · `GET/POST /api/contratos/:id/documento|tdr` (PDF de la OS y de los TDR).
- **Formulación:** `GET /api/formulacion/:id`, `PUT …/cabecera`, `POST …/actividades`, `PATCH /api/formulacion/actividades/:id`, `…/quitar`, `…/documentos`, `POST …/transicion`, `POST …/pdf` [ADMIN], `…/plan-documento/previsualizar|aplicar` y `GET …/plan-documento`.
- **Seguimiento:** `PATCH /api/actividades/:id`, `…/subactividades/:k` (avance), `POST …/anular`, `PUT …/predecesoras`, `POST /api/planes/:id/actividades|adoptar-pronostico`, `POST /api/simular|recalcular`, PDF de plan y de adenda.
- **CRUD genérico** (`PATCH/POST /api/{adendas,contratos,planes,linea-base,controles-cambio,consultores,proyectos}`) sobre `actualizarEntidad`/`crearEntidad`.
- **Configuración:** `PUT /api/parametros/:codigo`, `POST/DELETE /api/feriados` [JEFE_PROYECTO].
- **Documentos:** `GET /api/documentos/plantilla.xlsx`, `POST /api/documentos/previsualizar|aplicar`, `POST/GET /api/actualizar-archivo` (+ `/:id/contenido`, `/:id/archivo`).
- **Asistente:** `POST /api/ia/mensaje`, `POST /api/ia/aplicar` [EDITOR], `GET /api/ia/uso` [JEFE_PROYECTO].

---

## 9. Interfaz

- **Menú lateral** (Jefe/Administrador): grupo **Proyectos** → cada proyecto con sus opciones (solo las que le aplican): *Adendas - Plazos* (o *Plazos - Vencimientos* si no usa adendas), *Contratos y adendas*, *Formular Plan de Trabajo*, *Seguimiento Actividades*, *Línea base 2026*, *Actualizar Desde Archivo*; luego **Administrar proyectos**, **Bitácora** y **Configuración**. El Profesional solo ve «Mi información» y «Formular Plan de Trabajo».
- **Adendas - Plazos / Plazos - Vencimientos** (`tablero.js`): tarjetas con indicadores, ventana de alertas (una vez por ingreso), gráfico `VigenciaTimeline` («GESTIÓN DE LAS ADENDAS Y CONTRATOS 2026», `umbralAtencion: 0`, sin columna BRECHA) y la lista de profesionales del proyecto con vencimiento, PDF de OS/TDR y «Renovar».
- **Contratos y adendas** (`adendas.js`): adendas por profesional, visor de PDF, «Agregar adenda», «Subir documento de adenda», «Plan Aprobado».
- **Seguimiento Actividades** (`seguimiento.js`) y ficha del profesional (`consultor.js`): tabla de actividades con diagrama de Gantt, subactividades anidadas con su línea de tiempo y avance, alertas, línea base, simulador, historial; «Cargar documento».
- **Formular Plan de Trabajo** (`formulacion.js`): datos generales, actividades (tabla desplegable con subactividades), comentarios, etapas del flujo; con el plan vacío ofrece **cargar un documento** o **registrar actividad por actividad**.
- **Administrar proyectos** (`proyectos.js`): alta/edición con las características, datos de cada proyecto y «Registrar profesional».
- **Actualizar Desde Archivo** (`actualizar-archivo.js`): carga múltiple, ventana de inconsistencias o de éxito, y visor de los documentos usados.
- **Línea base**, **Bitácora**, **Configuración** (parámetros, feriados, cuentas) y el **asistente de IA** (panel flotante).
- Convenciones de texto: español formal, fechas dd/mm/aaaa, coma decimal.

---

## 10. Configuración

**Variables de entorno** (`.env`, ver `.env.example`): `MODO_DATOS`, `PUERTO`, `NODE_ENV`, `SESION_SECRETO`, `SESION_HORAS`, `COOKIE_SEGURA`, `TRUST_PROXY`, `ADMIN_CORREO`, `ADMIN_NOMBRE`, `ADMIN_CLAVE_INICIAL`, `SQL_SERVIDOR`, `SQL_PUERTO`, `SQL_BASE`, `SQL_USUARIO`, `SQL_CLAVE`, `SQL_CIFRAR`, `SQL_CONFIAR_CERTIFICADO`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODELO`, `IA_MAX_TOKENS`, `IA_MAX_ITERACIONES`, `ARCHIVO_DEMO`, y las carpetas de documentos: `PLANES_PDF_DIR`, `ADENDAS_PDF_DIR`, `ACTIVIDADES_PDF_DIR`, `DOCUMENTOS_DIR`, **`CONTRATOS_PDF_DIR`** y **`PLANES_ORIGEN_DIR`** (nuevas). Ninguna de esas carpetas se versiona; en producción apuntan a `C:\datos\seguimiento\…`.

**Parámetros** (tabla `parametro`, editables en Configuración): `FECHA_CORTE` (vacío = hoy), `METODO_PRONOSTICO` (RENDIMIENTO), `SPI_MINIMO` (0,4), `UMBRAL_VIGENCIA_DIAS` (15), `UMBRAL_HOLGURA_DIAS` (5), `MODELO_IA` (claude-haiku-5-5).

---

## 11. Documentos y almacenamiento

- **Lector** (`documentos/lector.js`): Excel `.xlsx`, CSV, XML de MS Project, Word `.docx` (mammoth) y PDF (`pdf-parse` en un **proceso aparte**, `pdf-trabajador.js`, con tiempo límite). No se leen `.xls`, `.doc` ni `.mpp`. Un PDF escaneado (sin texto) no se puede leer. Máx. 5 000 filas por hoja.
- **Intérprete** (`interprete.js`, función pura): convierte tablas o filas de la IA en cambios propuestos (actividades, adendas, planes) con diferencias, advertencias y rechazos.
- **Plantilla Excel** (`plantilla.js`) para actualizar actividades, adendas y planes.
- **Flujos:** «Cargar documento» (vista previa + confirmación; también `tipo: 'adenda'`), «Actualizar Desde Archivo» (aplica directo, ver §14) y «Registrar plan desde documento» (vista previa + confirmación).
- **Almacenamiento en disco (no en SQL Server):** PDF del plan (`plan-<id>.pdf`), de adenda, de actividad, de OS/contrato y TDR (`contrato-<id>`, `tdr-<id>`), documentos de origen de planes y originales de cargas (con `indice.json`). Al reemplazar un PDF, la versión anterior se conserva con la fecha en el nombre. Límites: **50 MB** para documentos a leer (y en IIS); **15 MB** para los PDF de plan, adenda, actividad, OS y TDR. Queda pendiente decidir si conviene guardarlos en SQL Server.

---

## 12. Asistente de IA

- Cliente `@anthropic-ai/sdk`, modelo `MODELO_IA` (Haiku). Herramientas de consulta: `resumen_portafolio`, `detalle_consultor`, `listar_alertas`, `simular_cambios`, `consultar_historial_adendas`, `consultar_bitacora`; y `proponer_cambios`, que **solo propone**: un Jefe/Administrador lo aplica con `/api/ia/aplicar` (origen `IA`). Para un PROFESIONAL solo consulta su propia información y no tiene `proponer_cambios`.
- **Lectura de documentos** (PDF/Word): herramientas de extracción `registrar_actualizaciones`, `registrar_adenda` y `registrar_plan` (esta última nueva) con prompts propios; antes se quitan DNI, teléfonos y correos; texto hasta 60 000 caracteres; el contenido del documento se trata como dato, no como instrucciones.
- Sin `ANTHROPIC_API_KEY` la lectura de PDF/Word no está disponible (Excel/CSV/XML sí). **Pendiente:** abrir la salida a `api.anthropic.com:443` desde el servidor de producción.

---

## 13. Despliegue y operación

**Producción** — https://serforia.serfor.gob.pe, servidor SERFORLIMIIS02 (10.6.1.77, Windows Server 2019): IIS (proxy a `localhost:3080`) → servicio **WinSW** `SerforiaNodeBackend` (no es NSSM; `SerforiaService.xml` con respaldo `.respaldo`).
- Código en `C:\apps\seguimiento-actividades` (clon del repositorio; `git fetch` a GitHub funciona). Datos en `C:\datos\seguimiento\` (la unidad D no tiene espacio).
- Base SQL Server 2022 en 10.6.1.112, `SGF_SEGUIMIENTO`, usuario `usSgfSeguimiento` (los scripts de `db/` los ejecuta el DBA).
- `web.config` del sitio es el del administrador (no el de `deploy/iis/`); ya admite 50 MB. `.env` del servidor ya tiene `ACTIVIDADES_PDF_DIR`.
- **Actualizar:** (1) DBA ejecuta los scripts nuevos; (2) `cd C:\apps\seguimiento-actividades; git pull; npm ci --omit=dev`; (3) variables nuevas en el `.env`; (4) `Restart-Service SerforiaNodeBackend`; (5) Ctrl+F5 en el navegador.

**Local** — `npm run dev` usa `MODO_DATOS` del `.env` (hoy `sqlserver`, la misma base 10.6.1.112). Para la demo sin tocar la base: `MODO_DATOS=memoria` (persiste en `data/demo-estado.json`; bórralo para reiniciar). En esta máquina la demo se levanta como proceso aparte (`Start-Process node server/server.js` con `MODO_DATOS=memoria`), porque las herramientas de vista previa detienen los servidores al terminar cada turno.

**Otros** — `Dockerfile` y `.dockerignore` (contenedor), `.github/workflows/ci.yml` (corre `npm test`), `deploy/iis/` (guía, `instalar-servicio.ps1` con NSSM —no aplica en el servidor actual— y `revisar-servidor.ps1`). Despliegue en Google Cloud: en pausa, no retomar sin pedido del usuario.

**Probar la interfaz** — usar una instancia temporal en otro puerto (`PUERTO`, `ARCHIVO_DEMO`, `CONTRATOS_PDF_DIR`, `PLANES_ORIGEN_DIR`, `ADMIN_CORREO` y `ADMIN_CLAVE_INICIAL` de prueba). **No leer las credenciales reales de `.env` ni ponerlas en el chat.**

---

## 14. Pruebas

`npm test` (`node --test "test/*.test.js"`): `motor` (18), `documentos` (27), `vigencia-timeline` (25), `perfiles` (17: cuentas, alcance, cargas, proyectos, OS y documentos), `api` (6), `agente` (5, con cliente simulado), `formulacion` (2: flujo completo y plan desde documento), `historial` (2), `proxy` (2). Toda regla nueva del motor lleva su prueba en `test/motor.test.js`. Las pruebas usan memoria y carpetas temporales.

---

## 15. Historia del proyecto

1. **Base:** versión inicial del seguimiento BPS (motor, API, repos memoria/SQL Server), GitHub Actions, `TRUST_PROXY`, Dockerfile, sistema de diseño OTI Visual y guía de despliegue.
2. **Tablero y perfiles:** tablero de adendas, historial de adendas concluidas, PDF del plan, perfiles de usuario (ADMIN/JEFE_PROYECTO/PROFESIONAL).
3. **Seguimiento y documentos:** Seguimiento Actividades, carga de documentos (Excel/CSV/XML/PDF/Word), corrección de la lectura de PDF en Node 22.
4. **Producción:** guía y archivos de IIS; publicación el 05/11/2026 (WinSW, SQL Server 10.6.1.112).
5. **Adendas:** carga de documentos de adenda, «Agregar adenda», visor de PDF por adenda, reorganización de alertas y de Contratos y adendas.
6. **Formular Plan de Trabajo (commit `a3e6890`, 17/11/2026):** etapas, subactividades, PDF del plan, marca de actividades del Jefe, Actualizar Desde Archivo; despliegue y verificación de `db/08`–`db/11`.
7. **Varios proyectos (sin commit):** `db/12`, menú por proyecto, registro solo por el Administrador, código autogenerado, gestión y jefe de proyecto por lista, nueva denominación «SEGUIMIENTO DE PROYECTOS DE LA OFICINA DE TECNOLOGIAS DE LA INFORMACION».
8. **Características del proyecto (sin commit):** `db/13`, Orden de Servicio y TDR con control de vencimiento y renovación, lista de profesionales en «Plazos - Vencimientos», registro del plan desde documento.

---

## 16. Pendientes inmediatos (en este orden)

> **Actualización de producción a la rama v.02 actual:** por decisión del usuario (25/11/2026) se hace empezando de cero, sin proyectos: `docs/DESPLIEGUE_v02.md`, parte F (respaldo, `db/mantenimiento/reinicio_sin_proyectos.sql`, archivo de los PDF).

> La hoja de ruta de la siguiente fase (etapas 0–5) está en `PLAN_DE_MEJORAS.md`; los puntos 1–3 de abajo son su Etapa 0.

1. **Probar localmente** lo no subido y, con un documento real, la lectura de **PDF/Word por el asistente** (solo se probó con datos simulados).
2. **Commit y push** cuando el usuario diga «sube los cambios al gh».
3. **Producción:** el DBA ejecuta `db/12` a `db/15` → `git pull` + `npm ci --omit=dev` → agregar `CONTRATOS_PDF_DIR`, `PLANES_ORIGEN_DIR` y `DOCUMENTOS_RAIZ` al `.env` (p. ej. `C:\datos\seguimiento\contratos-pdf`, `…\planes-origen` y `…\almacen`) → `Restart-Service` → `npm run documentos:migrar` (revisar) y `npm run documentos:migrar -- --aplicar` → el Administrador revisa los equipos en «Administrar proyectos → Equipo».
4. **Certificado `*.serfor.gob.pe`: vencía el 18/11/2026.** Verificar que ya se renovó.
5. Crear las **11 cuentas de profesionales** (sin ellas no formulan su plan) y, si se desea, las de los cuatro jefes de proyecto (hoy solo son opciones de un desplegable; se necesitan sus correos institucionales).

## 17. Backlog

- **Operativo:** abrir `api.anthropic.com:443` y `github.com:443` desde 10.6.1.77; respaldo de `SGF_SEGUIMIENTO` y de `C:\datos\seguimiento`; redirección HTTP → HTTPS; usuario SQL solo con rol `sgf_app`; anular las adendas de prueba en producción; borrar `C:\temp\verificar-ia.js` del servidor; avisar al administrador del servidor de la corrección del WinSW.
- **Datos por verificar** (`CLAUDE.md` §6): contratos 026/029 ↔ 057/064 (K. Atuncar, J. Correa); fecha de suscripción de la Adenda 01 (04–05/06/2026); contrato 123 (J. Montalbán: 02/10 o 31/10); plazos de la Adenda 02 de A. Sosa y E. Barreto (90 días frente a 180 solicitados); registrar los planes de A. Sosa y J. Montalbán (adjuntos solo en Gmail).
- **Producto:** inicio de sesión con Google Workspace (SSO), activar en producción el envío del reporte mensual por correo, exportación del informe situacional, vista consolidada «Todos los proyectos» si se necesita, línea base propia por proyecto, decidir si los PDF van a SQL Server, S1–S5 (barras semanales) de la plantilla Word, legibilidad de las subactividades en la Bitácora.

## 18. Decisiones y límites que conviene conocer

- **Actualizar Desde Archivo aplica sin vista previa** (excepción a la regla 12 original, por decisión del usuario); no crea actividades nuevas, las informa. «Cargar documento» y «Registrar plan desde documento» sí piden vista previa y confirmación.
- `clave` del profesional y `contrato.numero` son **únicos en toda la base**, no por proyecto; `edt` de la línea base también.
- La línea base se filtra por proyecto, pero cargar una propia para un proyecto nuevo no está resuelto.
- Ya **no hay vista consolidada** de todos los proyectos: cada pantalla se ve por proyecto. Con un proyecto elegido, Configuración (cuentas) solo lista los profesionales de ese proyecto.
- `GF2026` conserva como «gestión del proyecto» el valor antiguo («Oficina de Tecnologías de la Información – OTI»), que no está entre las cuatro opciones; solo se reemplaza por una de ellas al editarlo.
- `consultor.proyecto` (texto) sigue siendo obligatorio en la tabla; al registrar profesionales se llena con el nombre del proyecto. El vínculo real es `proyecto_id`.
- Si el DBA ya corrió una versión anterior de `db/12` (con `cui` y `unidad_ejecutora`), esas columnas quedaron y no estorban.
- El título de «Línea base 2026» todavía menciona Gestiona Forestal (la línea base solo existe para GF2026). El asistente y la plantilla Excel ya se adaptan a cada proyecto.
- Los nombres de las áreas y de los jefes de proyecto se escribieron con tildes y artículos; se pueden ajustar en `servicio.js` (`AREAS_TECNICAS`, `JEFES_PROYECTO`).
- Las pruebas de `perfiles.test.js` ya no escriben en `data/` salvo `ADENDAS_PDF_DIR`; hay archivos de pruebas anteriores en `data/adendas-pdf` (ignorados por git).
- Cuentas e identidades en el repositorio: la cuenta de GitHub es institucional (`usuarioiaoti01-dot`); el correo del administrador y las claves **no** están en el repositorio.

## 19. Convenciones de trabajo

- Código y nombres en español; CommonJS en el servidor; módulos ES en `public/js` sin dependencias de compilación; interfaz en español formal.
- Reglas invariantes (en `CLAUDE.md` §3): modelo en `db/`; nada se borra; bitácora en la misma transacción; concurrencia optimista; reprogramar exige motivo; el pronóstico solo en el servidor; la IA nunca escribe; datos personales solo para ADMIN; alcance del PROFESIONAL en el servidor; sin secretos en el código; `npm test` pasa antes de cada entrega.
- Mapa de archivos de la etapa de proyectos: servidor — `servicio.js` (proyectos, `registrarProfesional`, `ampliarOrdenServicio`), `server.js` (rutas), `formulacion.js` (`previsualizarPlan`, `aplicarPlan`, `rutaOrigen`), `documentos/plan.js`, `ia/agente.js` (`modo: 'plan'`), `motor/estado.js` (filtro por proyecto y alertas de OS), `datos/*`; cliente — `app.js` (menú), `proyectos.js`, `profesionales-proyecto.js`, `tablero.js`, `formulacion.js`, `actualizar-archivo.js`; pruebas — `perfiles.test.js`, `formulacion.test.js`.
