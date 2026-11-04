# Seguimiento Actividades Gestiona Forestal 2026 — contrato para Claude Code

Léelo completo antes de escribir código. Este archivo es la referencia de trabajo en este repositorio.

## 1. Qué es

Aplicación web de la **Oficina de Tecnologías de la Información (OTI) del SERFOR** para dar seguimiento a los
consultores BPS que desarrollan los aplicativos del **Gestiona Forestal** (Proyecto PI2 Bosques – UE 003, KfW):

- **Contratación y vigencia**: contrato → adendas (ANUNCIADA, EN_TRAMITE, FIRMADA, ANULADA). La vigencia es el fin de la última adenda **FIRMADA**.
- **Planes de trabajo**: actividades con fechas del plan, fechas reales, avance, estado, clasificación frente a la línea base y dependencias.
- **Fecha probable de término**: motor de recálculo que se ejecuta tras cada cambio y se compara con la vigencia (holgura y semáforo).
- **Línea base 2026**: entregables del cronograma MS Project v3 (corte 17/08/2026) y su cobertura por los planes.
- **Asistente de IA** (Claude Haiku): consulta, simula y **propone**; el usuario aprueba.
- **Trazabilidad**: tablas temporales de SQL Server (valores) + `sgf.bitacora` (usuario, motivo, origen).

Usuario principal: Director de TI (perfil ADMIN, `mmontoya@serfor.gob.pe`). Perfiles: **ADMIN** (Administrador: acceso total; es el único que crea usuarios y modifica perfiles), **JEFE_PROYECTO** (todo, menos crear usuarios, modificar perfiles y ver datos personales) y **PROFESIONAL** (una cuenta por consultor; solo su propia ficha; modifica el estado de sus actividades y, en «Editar», el avance; nada más).

## 2. Estructura

| Ruta | Contenido |
|---|---|
| `db/01_esquema.sql` … `04_datos_iniciales.sql`, `06_historial_adendas.sql`, `07_perfiles_usuario.sql` | DDL T-SQL (esquema `sgf`), vistas, roles y cargas. **Fuente de verdad del modelo de datos.** `06` (historial de adendas concluidas) se genera desde `db/fuentes/historial_adendas_01_02.csv`; `04` no se toca. `07`: perfiles y vínculo cuenta↔consultor (`sgf.usuario.consultor_id`). |
| `herramientas/generar_semilla.py` | Regenera `data/semilla.json` y `db/04_datos_iniciales.sql` desde la matriz de control (Excel); al final vuelve a fusionar el historial. |
| `herramientas/generar_historial.py` | Lee el CSV del historial de adendas, lo fusiona en `data/semilla.json` y genera `db/06_historial_adendas.sql`. |
| `server/motor/` | `calendario.js`, `recalculo.js` (pronóstico), `estado.js` (vigencia, alertas, indicadores), `cobertura.js` (días sin cobertura y superposiciones entre adendas). Funciones **puras**. |
| `server/datos/` | Repositorios con la misma interfaz: `sqlserver.js` (producción) y `memoria.js` (demo/pruebas). `entidades.js` = lista blanca de columnas. |
| `server/documentos/` | Carga de documentos (Excel/CSV/XML de MS Project/PDF/Word): `lector.js`, `interprete.js` (cambios propuestos, función pura), `index.js` (vista previa y aplicación), `plantilla.js`, `pdf-trabajador.js` (PDF en proceso aparte). |
| `server/servicio.js` | Reglas de negocio y validaciones. **Toda escritura pasa por aquí** (API y asistente). |
| `server/ia/agente.js` | Herramientas del asistente, prompt de sistema y aplicación de propuestas. |
| `server/server.js` | Rutas Express, sesión y seguridad. |
| `public/` | Interfaz (HTML + CSS + módulos ES sin compilación). |
| `oti-visual/` | Paquete del sistema de diseño **OTI Visual** (tokens, componente `VigenciaTimeline`, demo). `design-system/tokens.json` es la fuente de verdad. |
| `public/tokens.css`, `public/js/vigencia-timeline/` | Copias **idénticas** del paquete (no editar a mano: se cambia en `oti-visual/` y se vuelve a copiar). |
| `public/js/vigencia-adaptador.js` | Convierte `/api/estado` al contrato del componente; valida fechas y reporta en consola los profesionales descartados. |
| `test/` | Pruebas `node:test` (motor, API completa y agente con cliente simulado). |

## 3. Reglas invariantes (no negociables)

1. **El modelo de datos vive en `db/`.** Todo cambio de estructura: nuevo script `db/NN_descripcion.sql` idempotente + actualizar `entidades.js`, ambos repositorios y las pruebas. No editar scripts ya ejecutados en producción.
2. **Nada se borra físicamente** (salvo resultados de recálculo y feriados). Bajas lógicas con `activo = 0` o `estado = 'ANULADA'`.
3. **Toda escritura registra bitácora** con usuario, motivo y origen (`UI`, `IA`, `SCRIPT`, `SISTEMA`) en la **misma transacción**.
4. **Concurrencia optimista**: las tablas editables tienen `revision`; la UI envía la revisión leída y el servidor responde 409 si cambió.
5. **Cambiar `inicio_plan` o `fin_plan` es reprogramación**: exige motivo (≥ 5 caracteres). La API responde 400 con `requiereMotivo: true`.
6. **El pronóstico se calcula en el servidor** (`server/motor`). La UI solo muestra. No duplicar la lógica en el cliente.
7. **El asistente de IA nunca escribe**: solo propone (`proponer_cambios`); se aplica con `/api/ia/aplicar` por un JEFE_PROYECTO/ADMIN, con origen `IA`. Para un PROFESIONAL el asistente solo consulta su propia información y no dispone de `proponer_cambios`.
8. **Datos personales** (`dni`, `telefono`, `correo_personal`): solo ADMIN los ve o edita; jamás se envían al modelo de IA ni a la bitácora de otros roles.
9. **Perfiles y alcance**: el perfil, el vínculo con el consultor y el estado de la cuenta se leen de la base en cada petición (desactivar una cuenta o restablecer su clave surte efecto de inmediato). El alcance del PROFESIONAL se impone en el servidor (`server.js`, lista blanca de rutas y campos); la interfaz solo lo refleja. Las cuentas no se eliminan: se desactivan. Toda clave temporal se muestra una sola vez y obliga a cambiarla en el primer ingreso. El administrador principal (`ADMIN_CORREO`) no se degrada ni se desactiva.
10. **Sin secretos en el código**: todo en `.env` (no versionado). No imprimir claves en registros.
11. Toda regla nueva del motor lleva una prueba en `test/motor.test.js`. `npm test` debe pasar antes de cada entrega.
12. **Carga de documentos** (Seguimiento Actividades → «Cargar documento», solo JEFE_PROYECTO/ADMIN): nunca cambia datos sin **vista previa y confirmación**; cada cambio pasa por `servicio.js` (validaciones, revisión optimista, recálculo) con el nombre del documento como motivo y el original se conserva (`DOCUMENTOS_DIR`, fuera del repositorio). Excel/CSV/XML de MS Project se interpretan sin IA; PDF/Word los lee el asistente, que solo devuelve filas (origen `IA`) y **antes se le quitan DNI, teléfonos y correos** (`redactarPersonales`). Los PDF se leen en un proceso aparte (`pdf-trabajador.js`).

## 4. Motor de recálculo (resumen; detalle en `server/motor/recalculo.js`)

- R1 Resúmenes (p. ej. "2" con hijas "2.1") = mínimo inicio, máximo fin, avance ponderado por duración.
- R2 Dependencias fin→inicio con desfase (negativo = solapamiento). La semilla calcula el desfase para reproducir el plan exacto.
- R3 Concluida → fin probable = fin real.
- R4 Sin iniciar con inicio vencido → se reprograma desde la fecha de corte conservando su duración.
- R5 Iniciada → faltante = duración × (1 − avance) / SPI (método RENDIMIENTO; SPI acotado a [SPI_MINIMO, 1,5]) o sin SPI (LINEAL).
- R6 Desvío = fin probable − fin del plan. R7 Ruta crítica = cadena que determina el fin probable del plan.
- Vigencia: holgura = fin de vigencia − fin probable; semáforo VERDE (≥ UMBRAL_HOLGURA_DIAS), ÁMBAR, ROJO (< 0 o vigencia vencida), GRIS (sin plan).
- Cobertura entre adendas (`cobertura.js`): solo cuentan las adendas CONCLUIDA y FIRMADA activas. Hueco = inicio de la siguiente − fin acumulado − 1: > 0 son días sin cobertura (alerta ALTA `ADENDAS_SIN_COBERTURA`); < 0 es superposición, una inconsistencia (alerta MEDIA `ADENDAS_SUPERPUESTAS`). Las adendas CONCLUIDA no cambian la vigencia, que sigue siendo el fin de la última FIRMADA.
- Días CALENDARIO por defecto (plazos contractuales); HÁBILES por plan, usando `sgf.feriado`.

## 5. Cómo trabajar

```bash
npm install
npm run dev          # http://localhost:3080 (modo según MODO_DATOS del .env)
npm test             # pruebas
npm run semilla      # regenera la semilla desde herramientas/matriz_control.xlsx
npm run bd:probar    # prueba la conexión a SQL Server (.env)
npm run bd:instalar  # instala db/01–07 en una base vacía
npm run historial    # regenera db/06 y la semilla desde db/fuentes/historial_adendas_01_02.csv
```

- Antes de modificar un módulo, presenta el plan de archivos y espera confirmación del usuario.
- Para probar contra SQL Server: `MODO_DATOS=sqlserver` y credenciales en `.env`. El modo `memoria` persiste en `data/demo-estado.json` (bórralo para reiniciar la demo).
- Convenciones: código y nombres en español, CommonJS en el servidor, módulos ES en `public/js`, sin dependencias de compilación en el cliente.
- Textos de la interfaz: español formal, fechas dd/mm/aaaa, números con coma decimal en textos.
- Gráfico de vigencia del Tablero: usa `VigenciaTimeline` con `umbralAtencion: 0` (el diseño propone −7). Así "sin cobertura" coincide con el semáforo ROJO del servidor (holgura < 0) y la tabla y el gráfico no se contradicen. Su fila KPI se oculta por CSS (`.vt .vt-kpis`) porque el Tablero tiene sus propias tarjetas. Se muestra sin columna BRECHA ni tramo rayado (`mostrarBrecha: false`, `tramoSinCobertura: false`), con "nombre y primer apellido" como nombre de fila (`etiqueta`, ver `nombreCorto()` del adaptador) y el título "GESTIÓN DE LAS ADENDAS Y CONTRATOS 2026". El tooltip usa `tooltip: 'vigencia'` (solo inicio, fin de vigencia y, si hay adenda, su vencimiento y plazo de firma); es una opción añadida al paquete, el valor por defecto no cambia.

## 6. Pendientes sugeridos (backlog)

**Pendientes de verificación (no corregidos a propósito):**
- Contratos **026 y 029** del Excel de Adendas 03: parecen corresponder a **057 (K. Atuncar)** y **064 (J. Correa)**. El historial ya usa 057/064; corregir en origen.
- Adenda 01 de todos los contratos: la fecha de suscripción exacta está por confirmar (entre el 04 y el 05/06/2026); el inicio figura como calculado (`inicio_calculado = 1`).
- Contrato 123 (J. Montalbán): el Excel de Adendas 03 indica que la siguiente adenda inicia el 02/10; el sistema usa el 31/10 (probable; verificar).
- Alfred Sosa y Edgard Barreto: Adenda 02 de 90 días frente a 180 solicitados; el resto recibió 60 (Erick Laura, 30). Confirmar con los documentos.

- Registrar las actividades de los planes de **A. Sosa** y **J. Montalbán** (adjuntos solo en Gmail).
- Corregir en origen la V.03 (contratos 026/029 → 057/064 de K. Atuncar y J. Correa) — la semilla ya usa los números verificados.
- Inicio de sesión con Google Workspace (SSO) institucional en lugar de clave local.
- Reporte mensual en PDF/correo para Gerencia y exportación del informe situacional.
- Despliegue en servidor institucional con HTTPS (IIS/ARR o Nginx como proxy inverso) y `COOKIE_SEGURA=true`.
