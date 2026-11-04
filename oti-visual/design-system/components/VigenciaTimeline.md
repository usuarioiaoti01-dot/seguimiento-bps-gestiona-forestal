# VigenciaTimeline

Cronograma que compara la vigencia contractual de cada contrato con el término probable de su plan de trabajo, agrupado por nivel de riesgo para que lo urgente se lea primero.

## Qué resuelve frente a la versión anterior

| Problema | Antes | Ahora |
|---|---|---|
| Orden | Filas en orden arbitrario | Agrupadas por estado (sin cobertura → desfase menor → en plazo → sin dato) y ordenadas por brecha |
| La brecha era un número suelto | `-16 d` en una columna | Tramo con trama roja entre fin de vigencia y término probable: la brecha se ve como longitud |
| Signo ambiguo | `-2 d`, `+1 d`, `0 d` | Texto con consecuencia: "2 d sin cobertura", "+1 d de margen", "Justo al cierre" |
| Marca de término con dos colores sin explicar | Rojo y ámbar sobre la barra | Marca única en tinta (`marker`); el estado lo dicen el tramo y la insignia |
| Corte sin fecha | Línea azul sin rótulo | Píldora "Corte 04 nov" sobre el eje |
| Eje pobre | 6 fechas sueltas | Meses rotulados, bandas alternas, ticks semanales |
| Sin síntesis | — | Fila KPI con el conteo por estado y el plazo para firmar adendas |
| Escenario adenda | Solo visible como barra punteada | Control "Solo firmadas / Con adendas en trámite" que recalcula brechas y grupos |
| Accesibilidad | Color como único código | Ícono + texto en insignias, tooltip por fila, vista de tabla |

## Anatomía

1. Encabezado: título, subtítulo con fecha de corte y número de contratos, control segmentado del escenario.
2. Fila KPI (4 tarjetas): la de "Sin cobertura" se resalta con `risk-fill` solo si su conteo es > 0.
3. Leyenda en una línea, encima del gráfico.
4. Eje: mes en `overline`, ticks 1/8/15/22 en `axis`, bandas `surface-band` en meses alternos.
5. Grupos: punto de estado + título en mayúsculas + conteo; el grupo crítico añade el plazo de firma.
6. Fila: código (`label`), marca "por iniciar" si el inicio es posterior al corte, barra de vigencia (`bar-fill`/`bar-stroke`), adenda en trámite (`pending`, discontinua), tramo sin cobertura (trama `risk`), término probable (`marker` con anillo `surface`), insignia [[BrechaBadge]].
7. Pie: definición de brecha y enlace "Ver como tabla".

## Reglas

- Brecha = fin de vigencia efectiva − término probable, en días calendario. Con el escenario "Con adendas en trámite", la vigencia efectiva es la de la adenda.
- La línea de corte usa `today` y se dibuja encima de las barras; es el único elemento azul.
- Barras de 14px de alto en filas de 34px; extremos con `radius-sm`.
- Más de ~25 filas: paginar por grupo o colapsar "En plazo" por defecto.
- En móvil el gráfico se desplaza en horizontal (ancho mínimo 820px); las tarjetas KPI pasan a 2 columnas.
- Tooltip: opción `tooltip`. `'completo'` (por defecto) muestra brecha, inicio, fin, adenda, término probable y días para firmar; `'vigencia'` muestra solo inicio y fin de vigencia y, únicamente si hay una adenda que amplía la vigencia, su vencimiento y el plazo para firmarla (este último solo en el escenario "Solo firmadas"). Lógica pura en `filasTooltip()` de `compute.js`.
- Presentación opcional (por defecto todo se muestra): `mostrarBrecha: false` quita la columna BRECHA (insignias) y el gráfico ocupa todo el ancho; `tramoSinCobertura: false` quita el tramo rayado y su ítem de la leyenda; `anchoEtiqueta` ensancha la columna de nombres; `etiqueta` (por fila) reemplaza al `id` como nombre visible; `mostrarTerminoProbable: false` quita la marca del término probable (leyenda, gráfico, eje y tabla).
- Historial (opcional): cada fila admite `historial: [{ numero, inicio, fin, plazoDias?, plazoSolicitadoDias? }]` (adendas concluidas), `brechas: [{ inicio, fin, dias }]` (días sin cobertura) y `superposiciones` (inconsistencia). Con `mostrarHistorial: true` las concluidas se dibujan en gris antes de la vigencia actual, los días sin cobertura en rojo y las superposiciones en ámbar; `ejeDesde: 'AAAA-MM-DD'` hace que el eje arranque en esa fecha. El tooltip lista cada adenda con su plazo otorgado y solicitado. Se cambia con `update({ mostrarHistorial, ejeDesde })`.

## Qué provee el consumidor

Por contrato: `id`, `ini`, `fin` (vigencia firmada), `adenda` (fin propuesto o `null`), `prob` (término probable o `null`), y la fecha de corte. Fechas ISO `AAAA-MM-DD`.
