# Rediseño visual – App «Seguimiento de Proyectos de la OTI» · v2

**Alcance:** shell de la aplicación (menú lateral + cabecera) y vista **Tablero general**, con tokens y componentes reutilizables para extender el diseño a las vistas del proyecto (*Contratos y adendas, Adendas – plazos, Formular plan de trabajo, Línea base, Actualizar desde archivo, Seguimiento de actividades, Supervisión diaria, Expediente, Bitácora*), *Administrar proyectos* y *Configuración*.
**Sistema de diseño base:** OTI Visual (tema claro/oscuro, Inter, semáforo accesible).
**Referencia visual adjunta:** `referencia-tablero-general.html` (maqueta estática v2; abrir en el navegador).
**Versión:** 2.0 · 25/11/2026. Reemplaza a la v1: incorpora la banda de resumen, la dona de semáforo, el medidor de avance, el ciclo de la OS, la vista de tarjetas y el submenú del proyecto de la versión actual de la app.

---

## 0. Prompt para pegar en Claude Code

> Copia `REDISENO-TABLERO-OTI.md` y `referencia-tablero-general.html` en `docs/diseno/` del repositorio (reemplaza la v1 si ya estaba) y pega esto en **Claude Code**:

```text
Lee docs/diseno/REDISENO-TABLERO-OTI.md (v2) completo y abre docs/diseno/referencia-tablero-general.html
como referencia visual. Aplica el rediseño siguiendo el plan por fases de la sección 11.

Reglas:
1. Antes de tocar código, identifica el stack (framework, sistema de estilos, router, dónde están el
   layout, el menú lateral, el Tablero general y sus bloques actuales: banda SERFOR, dona, medidor,
   ciclo de la OS, "¿Qué requiere atención hoy?" y vista Tarjetas/Tabla). Propónme en 10 líneas cómo
   mapearás los tokens y qué componentes existentes reutilizarás. Espera mi OK.
2. NO cambies lógica de negocio: cálculos de KPI, semáforo, avance, ciclo de la OS, alertas, consultas
   a la base de datos ni contratos de API. Solo presentación, layout, orden de bloques y microcopy.
3. Reutiliza el logo SERFOR que ya existe en el repositorio; no lo redibujes.
4. Una fase por commit, con mensaje en español. Al cerrar cada fase muéstrame archivos cambiados y
   cómo verlo en local.
5. Si un dato del diseño no existe en el modelo, calcúlalo en la capa de presentación con datos
   existentes; si no es posible, muestra "—" y anótalo en docs/diseno/PENDIENTES.md. No inventes campos.
6. Al terminar, recorre la checklist de la sección 12 y repórtame cada punto como Cumple / No cumple.
```

---

## 1. Qué cambia respecto de la versión actual de la app

| # | Hoy | Propuesta v2 |
|---|---|---|
| 1 | Banda verde con degradado, logo grande y chips de resumen (≈120 px de alto sin datos accionables) | **Banda de resumen sólida** `--sidebar-inst` con 4 cifras: proyectos en curso, OS en ejecución, monto comprometido (barra de conformidad) y avance promedio. El logo vive solo en el menú; el saludo pasa a la cabecera |
| 2 | Dona, medidor y ciclo de la OS **antes** de «¿Qué requiere atención hoy?» | **«¿Qué requiere atención hoy?» primero** (lo urgente arriba); las tres tarjetas analíticas debajo |
| 3 | Atención en 4 mosaicos horizontales; no incluye alertas ni proyectos sin responsable | **Lista de acciones** ordenada por riesgo, con botón por fila (Ver alertas, Ver, Notificar, Asignar) + una línea «✓ Al día» que agrupa lo que no tiene pendientes. El mosaico de montos sube a la banda |
| 4 | Medidor de avance en ámbar | Avance en verde `--progress`: el ámbar queda reservado para «requiere atención» |
| 5 | Submenú del proyecto con 9 ítems planos y todos los proyectos desplegables | Submenú **agrupado** (Contratación · Planificación · Ejecución · Registro); solo el proyecto activo se despliega |
| 6 | Tarjetas de proyecto con borde superior de color y textos cortados | Tarjeta con insignia de semáforo (ícono + texto), anillo de avance, próximo entregable con plazo relativo, datos clave en 3 columnas y accesos directos |
| 7 | Filtros sin etiqueta; «En curso» como desplegable | Control segmentado **En curso / Terminados / Todos** con conteos, filtros etiquetados y conmutador **Tarjetas / Tabla** |
| 8 | «Cómo leer este tablero» junto a los filtros; «Asistente IA» flotando sobre el contenido | Ambos en la cabecera |
| 9 | «Cambiar clave» y «Cerrar sesión» como botones grandes | Menú ⋮ de la tarjeta de usuario |

---

## 2. Principios (OTI Visual)

1. **Lo urgente arriba.** Ordenar por riesgo, no por código.
2. **Consecuencia, no signo.** «vence en 15 d», «vencido hace 3 d»; nunca «-3».
3. **Una marca, un significado.** Rojo/ámbar/verde solo para estado (semáforo, alertas, plazos). El estado del proyecto (Registrado, En ejecución, Terminado) y el avance **no** usan colores de semáforo.
4. **Síntesis antes del detalle.** Resumen → atención → análisis → proyectos.
5. **Nunca solo color.** Todo estado lleva ícono y texto.
6. **Tarjetas con borde, sin sombra ni degradados.**

---

## 3. Tokens de color

Un único archivo de tokens (p. ej. `src/styles/tokens.css`); **ningún hexadecimal suelto** en el resto del código.

```css
:root {
  /* Superficies */
  --surface-page: #f5f6f2;   /* fondo de página */
  --surface:      #ffffff;   /* tarjetas, cabecera, menú en variante clara */
  --surface-band: #f3f5f1;   /* cabecera de tabla, hover */
  --surface-sunk: #fafbf8;   /* barra de filtros */
  --neutral-fill: #eef0ec;   /* chips neutros, pistas de barras/anillos, segmentado */

  /* Texto */
  --ink:       #1b2620;
  --ink-muted: #55655b;

  /* Líneas */
  --line:        #e2e6df;
  --line-strong: #c9d1c7;

  /* Marca institucional (NO codifica estado) */
  --brand:      #1e6b45;     /* botón primario, enlaces, foco */
  --brand-ink:  #155c39;
  --brand-soft: #dbeadf;     /* ítem activo (menú claro), conmutador activo */
  --progress:   #3d8a5f;     /* avance, conformidad, anillos */

  /* Institucional oscuro: menú lateral y banda de resumen */
  --sidebar-inst:        #164f35;
  --sidebar-inst-line:   #2b6649;
  --on-inst:             #ffffff;
  --on-inst-muted:       #c9ddd1;  /* 7:1 sobre #164f35 */
  --on-inst-progress:    #9fe3bd;
  --on-inst-risk:        #ffb4ab;  /* glifo de semáforo sobre fondo institucional */
  --on-inst-ok:          #9fe3bd;

  /* Semáforo */
  --risk: #c02d22;  --risk-fill: #fde7e4;  --risk-ink: #8f1d14;
  --warn: #b46a00;  --warn-fill: #fdf0d8;  --warn-ink: #7a4600;  --warn-line: #f0d9a8;
  --ok:   #1f7a4d;  --ok-fill:   #e2f2e8;  --ok-ink:   #155c39;
  --none: #9aa79f;  /* «sin seguimiento» en gráficos */

  --today: #1f4fd1;  /* solo fecha de corte y estado «Registrado» */

  --shadow-pop: 0 4px 16px rgba(27, 38, 32, .14);
  --focus-ring: 0 0 0 3px rgba(30, 107, 69, .35);
}

[data-theme="dark"] {
  --surface-page: #0e1511;  --surface: #141d18;  --surface-band: #18221c;
  --surface-sunk: #121a16;  --neutral-fill: #1d2721;
  --ink: #e6eee8;  --ink-muted: #9db0a3;
  --line: #26332b;  --line-strong: #36463c;
  --brand: #6cc896;  --brand-ink: #9fe3bd;  --brand-soft: #1d3a2a;  --progress: #4fa477;
  --sidebar-inst: #0f2a1d;  --sidebar-inst-line: #1f3d2c;
  --risk: #f0776b;  --risk-fill: #3f1a17;  --risk-ink: #ffb4ab;
  --warn: #e8a33a;  --warn-fill: #3a2a0e;  --warn-ink: #ffd08a;  --warn-line: #5a4316;
  --ok:   #5cc48d;  --ok-fill:   #173226;  --ok-ink:   #9fe3bd;
  --none: #5d6b62;  --today: #7fa2ff;
  --shadow-pop: 0 4px 16px rgba(0, 0, 0, .5);
}
```

El tema oscuro es **opcional en esta entrega**: dejar los tokens listos. Si el proyecto usa Tailwind, mapear `theme.extend.colors` a las variables.

---

## 4. Tipografía, espaciado y radios

Fuente **Inter** (400/500/600/700), respaldo `"Segoe UI", system-ui, sans-serif`; cifras con `font-variant-numeric: tabular-nums`.

| Estilo | Tamaño / interlínea | Peso | Uso |
|---|---|---|---|
| display | 28 / 34 px, `-0.01em` | 650 | Cifras de la banda, centro de dona y medidor |
| page-title | 24 / 30 px | 650 | Título de la vista |
| title | 18 / 24 px | 650 | Título de sección (Atención, Proyectos) |
| card-title | 16 / 22 px | 650 | Título de tarjeta analítica |
| project-title | 15 / 20 px | 650 | Nombre en tarjeta de proyecto |
| body | 14 / 20 px | 400 | Texto general |
| small | 13 / 18 px | 400–600 | Subtextos, leyendas, enlaces |
| caption | 12 / 16 px | 400–600 | Metadatos, chips |
| overline | 11 / 14 px, `+0.06em`, MAYÚSCULAS | 650 | Encabezados de grupo, etiquetas (10 px en submenú y tarjetas) |

Espaciado en múltiplos de 4 px. Radios: 4 (barras), 8 (botones, inputs, ítems de menú), 10 (caja del logo), 12 (tarjetas y banda), 999 (chips, segmentado). Alturas: botones 40 px (36 en filas de atención), filtros 36 px, ítems de menú 40 px, subítems 32 px.

---

## 5. Shell de la aplicación

### 5.1 Menú lateral (264 px)
Dos variantes por configuración: **Institucional** (por defecto, fondo `--sidebar-inst`, texto `--on-inst`) y **Claro** (fondo `--surface`, borde `--line-strong`, texto `--ink`).

1. **Logo SERFOR** existente, sobre caja blanca de 64 px de alto, radio 10.
2. Nombre de la app en 2 líneas como máximo: «Seguimiento de Proyectos OTI» (13/18, 700) + «Oficina de Tecnologías de la Información» (12, muted). Reemplaza el bloque de 4 líneas en mayúsculas.
3. **Navegación general:** Tablero general · Agenda de entregables (insignia ámbar con nº por vencer) · Bitácora general.
4. **Proyectos** (overline + enlace «Ver todos ›»): un ítem por proyecto = chevron + glifo de semáforo (▲ / ● / ✓ / –) + código en negrita + nombre truncado. **Solo el proyecto activo se despliega**; al abrir otro se pliega el anterior. Submenú agrupado con encabezados overline de 10 px y sangría de 40 px:
   - **Contratación:** Contratos y adendas · Adendas – plazos
   - **Planificación:** Formular plan de trabajo · Línea base {año} · Actualizar desde archivo
   - **Ejecución:** Seguimiento de actividades · Supervisión diaria
   - **Registro:** Expediente · Bitácora
   > Para proyectos con OS (no contrato con adendas), mostrar solo los ítems que existan hoy para ese tipo; no crear vistas nuevas.
5. **Administración:** Administrar proyectos · Configuración.
6. **Pie:** aviso «Modo demostración · datos en memoria» (chip ámbar, solo si aplica) + tarjeta de usuario (iniciales, nombre, rol) con botón ⋮ que abre *Cambiar clave* y *Cerrar sesión*.
- **Ítem activo:** institucional = fondo blanco + texto `--brand-ink`; claro = `--brand-soft` + `--brand-ink`. Hover: `rgba(120,140,128,.16)`.
- Colapsable a 72 px (íconos + tooltip) en pantallas < 1280 px.

### 5.2 Cabecera (blanca, borde inferior `--line-strong`, padding 16/32)
- Izquierda: «Tablero general» (page-title) y debajo el saludo dinámico: «Buenas {días|tardes|noches}, {cargo}. Así van los proyectos de la OTI al **{fecha de corte}**.»
- Derecha: botón ghost **«? Cómo leer este tablero»**, botón secundario **«Corte al dd/mm/aaaa»** (ícono calendario en `--today`, abre el selector actual) y botón contorno marca **«✦ Asistente IA»** (abre el panel lateral existente). Se elimina el botón flotante.

---

## 6. Tablero general – bloques en este orden

### 6.1 Banda de resumen
Contenedor `--sidebar-inst`, radio 12, padding 18/24, grid `repeat(auto-fit, minmax(200px,1fr))`. Cada celda: overline `--on-inst-muted` → cifra display blanca → subtexto 13 `--on-inst-muted`.

| Celda | Cifra | Subtexto / apoyo |
|---|---|---|
| Proyectos en curso | nº | «N terminado(s) en {año}» |
| Órdenes de servicio en ejecución | nº | «N registrada(s) sin notificar» (u otra cifra del ciclo de OS si aplica) |
| Monto comprometido | S/ total | barra 6 px `--on-inst-progress` sobre blanco 20 % + «S/ X con conformidad · NN.N %» |
| Avance promedio | NN.N % | «De los proyectos en curso» |

### 6.2 ¿Qué requiere atención hoy?
Tarjeta blanca. Título + «N acciones, ordenadas por riesgo · «Ver» filtra los proyectos». Cada fila: insignia de 118 px (▲ En riesgo / ● Atención) · título 14/600 · subtítulo 13 muted · botón a la derecha (secundario; **primario** solo para la acción que se ejecuta ahí mismo, p. ej. *Notificar*). Orden: severidad y luego fecha.

| Regla (datos existentes) | Severidad | Título | Botón |
|---|---|---|---|
| Proyecto atrasado o en riesgo con alertas | En riesgo | «{código} · {n} alertas pendientes de {total}» | Ver alertas |
| Entregable vencido sin presentar | En riesgo | «Entregable «{nombre}» vencido hace {d} d» | Ver |
| Conformidad fuera de plazo | En riesgo | «Conformidad de «{entregable}» fuera de plazo» | Ver |
| Entregable por vencer sin presentar | Atención | «{n} entregable(s) vence(n) en {d} d y aún no se presenta(n)» | Ver |
| OS registrada sin notificar | Atención | «{n} orden(es) de servicio registrada(s) sin notificar» · sub: «El plazo no empieza hasta notificarla al profesional» | Notificar |
| Vigencia de OS/adenda por vencer | Atención | «Vigencia de {profesional} vence en {d} d» | Ver |
| Sin parte diario / supervisión atrasada | Atención | «{código} sin supervisión desde {fecha}» | Ver |
| Proyecto en curso sin responsable | Atención | «{código} sin responsable asignado» | Asignar |

Última línea fija: chip «✓ Al día» + «Sin pendientes en {lista de controles en 0}». Si no hay ninguna acción: «✓ No hay acciones pendientes al {fecha de corte}». Máximo 6 filas + «Ver las N acciones».

### 6.3 Tres tarjetas analíticas
Grid `repeat(auto-fit, minmax(320px,1fr))`, gap 16. Título card-title + subtítulo 13 muted.

**a) ¿Cómo están los proyectos en curso?** — Dona 132 px (radio 44, grosor 14) con el total y «EN CURSO» al centro; segmentos `--risk`, `--warn`, `--ok`, `--none`. Leyenda a la derecha, cada fila **es un enlace que filtra la lista de proyectos**: «▲ 2 Atrasado o en riesgo», «● 0 Requiere atención», «✓ 0 En plazo», «– 1 Sin seguimiento». Las filas en 0 en muted. Las descripciones largas de cada estado pasan al tooltip y a «Cómo leer este tablero».

**b) ¿Cuánto se ha avanzado?** — Medidor semicircular 200×112, grosor 16, pista `--neutral-fill`, relleno `--progress` (no ámbar), cifra display al centro. Debajo, barra por proyecto (código 92 px · barra 6 px · % alineado a la derecha), ordenadas de mayor a menor. Nota al pie (12 muted): cómo se calcula el avance en OS y en contratos con plan de trabajo.

**c) Ciclo de la orden de servicio** — Lista ordenada (`<ol>`) de 5 pasos: Registrada → En ejecución → Entregables en revisión → Entregables conformes → OS culminadas. Cada paso: círculo de 30 px con la cifra (fondo `--warn-fill` si el paso exige acción —p. ej. Registrada sin notificar—, `--brand-soft` si tiene valor, `--neutral-fill` si es 0) + nombre 13/600 + descripción 12 muted (en `--warn-ink` cuando exige acción). Cada paso con valor > 0 es clicable y filtra.

### 6.4 Proyectos
**Barra superior:** «Proyectos» + segmentado **En curso N · Terminados N · Todos N** + conmutador **Tarjetas | Tabla** (activo `--brand-soft`/`--brand-ink`, `aria-pressed`). Derecha: select **Periodo**, botón primario **Reporte mensual (PDF)**, botón secundario **Exportar CSV**. La vista elegida se recuerda por usuario.

**Barra de filtros** (`--surface-sunk`): Buscar (código, nombre o responsable) · Gestión · Responsable · Año · Semáforo, cada uno con etiqueta overline; a la derecha «X de Y proyectos». Filtros reflejados en la URL.

**Vista Tarjetas** (por defecto) — grid `repeat(auto-fill, minmax(320px,1fr))`, gap 16, padding 20. Tarjeta: borde `--line-strong`, radio 12, padding 16/18, gap 12, **sin borde superior de color**:
1. Fila: código (enlace 13/700) · chip de estado neutro (○ Registrado / ● En ejecución / ✓ Terminado) · chip «Atípico» ámbar si aplica.
2. Nombre completo (project-title, sin truncar) + línea muted: modalidad · unidad/equipo · monto.
3. Insignia de semáforo con ícono + texto.
4. Anillo de avance 56 px (`--progress`, % al centro; «—» sin dato) + bloque «Próximo entregable»: nombre 13/600, fecha · responsable 12 muted, chip de plazo relativo. Sin entregables: texto muted explicativo.
5. Datos clave en 3 columnas sobre separador `--line`: Responsable («Sin asignar» en `--warn-ink`) · Profesionales u OS · Alertas («**19** de 47», cifra en `--risk-ink`).
6. Accesos directos (13/600, enlaces): Expediente · Bitácora · {acción principal del tipo: Plan de trabajo / Entregables / Iniciar seguimiento}.
Orden por defecto: semáforo (riesgo primero) y luego próximo vencimiento.

**Vista Tabla** — columnas: Semáforo · Proyecto (código + nombre + chips) · Unidad usuaria · Responsable · Estado · Avance (barra + %) · Próximo entregable (+ plazo relativo) · Supervisión · OS · Alertas («N de M»). Cabecera overline sobre `--surface-band`, celdas 14/12, separador `--line`, fila clicable, `overflow-x:auto` con `min-width:1080px`.

> **Alertas:** conservar exactamente la semántica actual de los dos números (p. ej. 19 y 47) y mostrarlos como «**19** de 47». Si el primero no significa «pendientes», ajustar la etiqueta y documentarlo.

---

## 7. Componentes a crear o adaptar

| Componente | Props clave | Notas |
|---|---|---|
| `AppShell` | `sidebarVariant: 'institucional' \| 'claro'` | Menú + cabecera + contenido |
| `SidebarNav`, `NavItem`, `ProjectNavItem`, `NavSubGroup` | `icon`, `label`, `count?`, `badge?`, `active`, `status`, `expanded` | Solo un proyecto expandido |
| `PageHeader` | `title`, `greeting`, `actions` | Saludo según hora y cargo |
| `SummaryBand` / `SummaryStat` | `label`, `value`, `sub`, `progress?` | |
| `AttentionList` / `AttentionItem` / `AllClearRow` | `severity`, `title`, `subtitle`, `action{label, href, primary?}` | |
| `StatusDonut` | `segments[{level,count,label,href}]`, `total` | `role="img"` + `aria-label` con el desglose; leyenda como enlaces |
| `ProgressGauge` | `value`, `items[{code,value}]`, `note` | Relleno `--progress` |
| `OsCycle` | `steps[{label,count,description,needsAction}]` | `<ol>` |
| `ProjectCard` | `project`, `links[]` | |
| `StatusBadge` | `level: 'risk' \| 'warn' \| 'ok' \| 'none'`, `label` | Siempre glifo + texto |
| `ProjectStateChip`, `DueChip`, `ProgressBar`, `ProgressRing` | — | `DueChip` calcula «vence en N d / hoy / vencido hace N d» desde la fecha de corte |
| `SegmentedControl`, `ViewToggle`, `FilterBar`, `Button` | — | Botón: `primary`, `secondary`, `brand-outline`, `ghost` |

---

## 8. Interacción

- La **fecha de corte** recalcula todos los bloques (lógica actual).
- Clic en: fila de atención, segmento/leyenda de la dona, paso del ciclo de la OS o celda de la banda → **filtra la lista de proyectos** (con scroll suave a la sección) o navega al registro.
- «Cómo leer este tablero» abre un panel lateral con la definición de cada estado del semáforo, del avance y del ciclo de la OS (mover ahí los textos explicativos largos de la versión actual).
- Asistente IA: panel lateral derecho de 400 px; no tapa el contenido.
- Reporte PDF y CSV: misma lógica; el PDF hereda paleta y semáforo con texto.
- Carga con *skeletons* `--neutral-fill`; estados vacíos con mensaje + acción.

---

## 9. Responsive

| Ancho | Comportamiento |
|---|---|
| ≥ 1280 px | Completo; tarjetas analíticas en 3 columnas |
| 1024–1279 px | Menú colapsado a 72 px; analíticas en 2 + 1 |
| 768–1023 px | Menú como *drawer* (☰ en cabecera); banda en 2×2; analíticas apiladas |
| < 768 px | Banda en 1 columna; filas de atención con botón debajo; solo vista Tarjetas; filtros en panel «Filtros (n)» |

---

## 10. Accesibilidad

- Contraste ≥ 4.5:1 en texto y ≥ 3:1 en marcas gráficas (los tokens cumplen; no aclarar los `-ink` ni `--on-inst-muted`).
- Semáforo, plazos, alertas y pasos que exigen acción: glifo + texto, nunca solo color.
- Gráficos SVG con `role="img"` y `aria-label` que describa los valores; la leyenda de la dona es texto real.
- Controles reales (`<button>`, `<a href>`, `<label>`); conmutadores con `aria-pressed`; submenú con `aria-expanded`.
- Foco visible `var(--focus-ring)`; botones solo-ícono con `aria-label`.

---

## 11. Plan de implementación por fases

| Fase | Entregable | Commit sugerido |
|---|---|---|
| 0 | Diagnóstico del stack y mapeo de tokens/componentes existentes (esperar OK) | — |
| 1 | `tokens.css` (+ Tailwind si aplica), Inter, eliminación de hex sueltos | `estilo: tokens OTI Visual v2 y tipografía Inter` |
| 2 | Shell: menú institucional/claro con logo, submenú agrupado y un solo proyecto expandido; cabecera con saludo, «Cómo leer», corte y Asistente IA; menú de usuario | `layout: menú lateral agrupado y cabecera` |
| 3 | Componentes base: Button, StatusBadge, ProjectStateChip, DueChip, ProgressBar/Ring, SegmentedControl, ViewToggle | `ui: componentes base OTI Visual` |
| 4 | Banda de resumen + «¿Qué requiere atención hoy?» (lista + fila «Al día») | `tablero: resumen y acciones de atención` |
| 5 | StatusDonut, ProgressGauge y OsCycle con interacción de filtro | `tablero: tarjetas analíticas` |
| 6 | Proyectos: barra, filtros en URL, vista Tarjetas y vista Tabla | `tablero: proyectos en tarjetas y tabla` |
| 7 | Panel «Cómo leer este tablero», responsive y accesibilidad | `ui: ayuda, responsive y accesibilidad` |
| 8 | Aplicar shell, tokens y componentes a las vistas del proyecto y de administración (sin rediseñar su contenido) | `ui: extender diseño al resto de vistas` |

---

## 12. Criterios de aceptación

- [ ] Ningún color hexadecimal fuera del archivo de tokens; sin degradados.
- [ ] Inter cargada; cifras tabulares.
- [ ] Menú con logo SERFOR existente, nombre en ≤ 2 líneas, variantes Institucional/Claro y submenú agrupado en 4 bloques; solo el proyecto activo expandido.
- [ ] Cabecera con saludo dinámico y fecha de corte; «Cómo leer este tablero» y «Asistente IA» en la cabecera; nada flota sobre el contenido.
- [ ] Orden de bloques: banda → atención → analíticas → proyectos.
- [ ] Banda con las 4 cifras y barra de conformidad.
- [ ] «¿Qué requiere atención hoy?» incluye alertas y proyectos sin responsable, ordenado por riesgo, con botón funcional por fila y fila «✓ Al día».
- [ ] Dona, medidor y ciclo de la OS filtran la lista al hacer clic.
- [ ] Avance en verde `--progress` en todo el sistema (medidor, barras, anillos).
- [ ] Semáforo con glifo + texto en menú, dona, tarjetas, tabla y atención.
- [ ] Tarjetas de proyecto sin borde superior de color, nombre completo visible, plazo relativo correcto y accesos directos.
- [ ] Segmentado con conteos, filtros etiquetados en la URL y conmutador Tarjetas/Tabla recordado por usuario.
- [ ] Cifras idénticas a la versión anterior con los mismos datos (regresión de KPI, semáforo, avance, ciclo de OS y alertas).
- [ ] PDF y CSV funcionan.
- [ ] Navegable por teclado con foco visible; contraste verificado.
- [ ] Funcional a 1440, 1280, 1024, 768 y 390 px.

---

## 13. Fuera de alcance (no modificar)

Cálculo de semáforo, avance, ciclo de la OS y alertas · reglas de entregables, conformidades y vigencias · modelo de datos, SQL y API · autenticación y roles · lógica del Asistente IA (solo cambia dónde se abre) · contenido del Reporte mensual (solo su estilo) · contenido funcional de las vistas del proyecto.
