# Seguimiento BPS · Gestiona Forestal — contrato para Claude Code

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

Usuario principal: Director de TI (rol ADMIN). Colaboradores: EDITOR (registran seguimiento) y LECTOR.

## 2. Estructura

| Ruta | Contenido |
|---|---|
| `db/01_esquema.sql` … `04_datos_iniciales.sql` | DDL T-SQL (esquema `sgf`), vistas, roles y carga inicial. **Fuente de verdad del modelo de datos.** |
| `herramientas/generar_semilla.py` | Regenera `data/semilla.json` y `db/04_datos_iniciales.sql` desde la matriz de control (Excel). |
| `server/motor/` | `calendario.js`, `recalculo.js` (pronóstico), `estado.js` (vigencia, alertas, indicadores). Funciones **puras**. |
| `server/datos/` | Repositorios con la misma interfaz: `sqlserver.js` (producción) y `memoria.js` (demo/pruebas). `entidades.js` = lista blanca de columnas. |
| `server/servicio.js` | Reglas de negocio y validaciones. **Toda escritura pasa por aquí** (API y asistente). |
| `server/ia/agente.js` | Herramientas del asistente, prompt de sistema y aplicación de propuestas. |
| `server/server.js` | Rutas Express, sesión y seguridad. |
| `public/` | Interfaz (HTML + CSS + módulos ES sin compilación). |
| `test/` | Pruebas `node:test` (motor, API completa y agente con cliente simulado). |

## 3. Reglas invariantes (no negociables)

1. **El modelo de datos vive en `db/`.** Todo cambio de estructura: nuevo script `db/NN_descripcion.sql` idempotente + actualizar `entidades.js`, ambos repositorios y las pruebas. No editar scripts ya ejecutados en producción.
2. **Nada se borra físicamente** (salvo resultados de recálculo y feriados). Bajas lógicas con `activo = 0` o `estado = 'ANULADA'`.
3. **Toda escritura registra bitácora** con usuario, motivo y origen (`UI`, `IA`, `SCRIPT`, `SISTEMA`) en la **misma transacción**.
4. **Concurrencia optimista**: las tablas editables tienen `revision`; la UI envía la revisión leída y el servidor responde 409 si cambió.
5. **Cambiar `inicio_plan` o `fin_plan` es reprogramación**: exige motivo (≥ 5 caracteres). La API responde 400 con `requiereMotivo: true`.
6. **El pronóstico se calcula en el servidor** (`server/motor`). La UI solo muestra. No duplicar la lógica en el cliente.
7. **El asistente de IA nunca escribe**: solo propone (`proponer_cambios`); se aplica con `/api/ia/aplicar` por un EDITOR/ADMIN, con origen `IA`.
8. **Datos personales** (`dni`, `telefono`, `correo_personal`): solo ADMIN los ve o edita; jamás se envían al modelo de IA ni a la bitácora de otros roles.
9. **Sin secretos en el código**: todo en `.env` (no versionado). No imprimir claves en registros.
10. Toda regla nueva del motor lleva una prueba en `test/motor.test.js`. `npm test` debe pasar antes de cada entrega.

## 4. Motor de recálculo (resumen; detalle en `server/motor/recalculo.js`)

- R1 Resúmenes (p. ej. "2" con hijas "2.1") = mínimo inicio, máximo fin, avance ponderado por duración.
- R2 Dependencias fin→inicio con desfase (negativo = solapamiento). La semilla calcula el desfase para reproducir el plan exacto.
- R3 Concluida → fin probable = fin real.
- R4 Sin iniciar con inicio vencido → se reprograma desde la fecha de corte conservando su duración.
- R5 Iniciada → faltante = duración × (1 − avance) / SPI (método RENDIMIENTO; SPI acotado a [SPI_MINIMO, 1,5]) o sin SPI (LINEAL).
- R6 Desvío = fin probable − fin del plan. R7 Ruta crítica = cadena que determina el fin probable del plan.
- Vigencia: holgura = fin de vigencia − fin probable; semáforo VERDE (≥ UMBRAL_HOLGURA_DIAS), ÁMBAR, ROJO (< 0 o vigencia vencida), GRIS (sin plan).
- Días CALENDARIO por defecto (plazos contractuales); HÁBILES por plan, usando `sgf.feriado`.

## 5. Cómo trabajar

```bash
npm install
npm run dev          # http://localhost:3080 (modo según MODO_DATOS del .env)
npm test             # pruebas
npm run semilla      # regenera la semilla desde herramientas/matriz_control.xlsx
npm run bd:probar    # prueba la conexión a SQL Server (.env)
npm run bd:instalar  # instala db/01–05 en una base vacía
```

- Antes de modificar un módulo, presenta el plan de archivos y espera confirmación del usuario.
- Para probar contra SQL Server: `MODO_DATOS=sqlserver` y credenciales en `.env`. El modo `memoria` persiste en `data/demo-estado.json` (bórralo para reiniciar la demo).
- Convenciones: código y nombres en español, CommonJS en el servidor, módulos ES en `public/js`, sin dependencias de compilación en el cliente.
- Textos de la interfaz: español formal, fechas dd/mm/aaaa, números con coma decimal en textos.

## 6. Pendientes sugeridos (backlog)

- Registrar las actividades de los planes de **A. Sosa** y **J. Montalbán** (adjuntos solo en Gmail).
- Corregir en origen la V.03 (contratos 026/029 → 057/064 de K. Atuncar y J. Correa) — la semilla ya usa los números verificados.
- Inicio de sesión con Google Workspace (SSO) institucional en lugar de clave local.
- Reporte mensual en PDF/correo para Gerencia y exportación del informe situacional.
- Despliegue en servidor institucional con HTTPS (IIS/ARR o Nginx como proxy inverso) y `COOKIE_SEGURA=true`.
