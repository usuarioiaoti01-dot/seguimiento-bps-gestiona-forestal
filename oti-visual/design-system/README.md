# OTI Visual

Lenguaje visual para los tableros de seguimiento de la Oficina de Tecnologías de la Información del SERFOR: contratos, plazos, expedientes e incidencias. Su objetivo es que un directivo identifique en cinco segundos qué requiere decisión hoy.

## Principios

1. **Lo urgente arriba.** Ordenar y agrupar por riesgo, no por código ni por orden de carga.
2. **Consecuencia, no signo.** "16 d sin cobertura" en lugar de "-16 d".
3. **Una marca, un significado.** El color de estado se reserva para el estado; la marca de dato va en tinta.
4. **Síntesis antes del detalle.** Toda vista abre con una fila de KPI que responde "¿cuántos y para cuándo?".
5. **Nunca solo color.** Cada estado lleva ícono y texto; cada gráfico tiene vista de tabla.

## Voz y contenido

- Español, frases cortas, verbos de acción: "Firmar adendas antes del 13 nov — quedan 9 días".
- Fechas cortas en ejes y textos (`04 nov`), completas en tooltip y tabla (`04/11/2026`).
- Días calendario con `d` (`20 d`); cifras tabulares.
- Mayúsculas solo en encabezados de grupo (`overline`).

## Fundamentos visuales

| Rol | Token | Uso |
|---|---|---|
| Fondo | `surface-page`, `surface` | Página y tarjetas; las tarjetas tienen borde `line-strong`, no sombra |
| Texto | `ink`, `ink-muted` | Texto y cifras; el color de serie nunca tiñe el texto |
| Marca institucional | `brand` | Controles activos, enlaces, foco |
| Vigencia | `bar-fill` + `bar-stroke` | Barra sólida del periodo firmado |
| En trámite | `pending` + `pending-fill` | Borde discontinuo; pasa a continuo si el escenario lo da por firmado |
| Estados | `risk`, `warn`, `ok` (+ `-fill`, `-ink`) | Crítico, atención, en plazo |
| Corte | `today` | Solo la línea/píldora de fecha de corte |

Tipografía: Inter (Google Fonts), con `Segoe UI` y `system-ui` de respaldo. Estilos `display`, `title`, `body`, `label`, `axis`, `overline`.

Espaciado en múltiplos de 4px (`space-1` a `space-8`); radios `radius-sm` (barras), `radius-md` (KPI, tooltip), `radius-lg` (tarjeta), `radius-pill` (insignias).

Contraste verificado: texto ≥ 4.5:1 y marcas gráficas ≥ 3:1 en tema claro y oscuro.

## Umbrales de estado (tableros de vigencia)

| Estado | Brecha (fin − término probable) |
|---|---|
| Sin cobertura (crítico) | < −7 días |
| Desfase menor (atención) | −7 a −1 días |
| En plazo | ≥ 0 días |
| Sin dato | sin término probable registrado |

## Componentes

- **VigenciaTimeline**: cronograma de vigencia vs. término probable, agrupado por riesgo.
- **BrechaBadge**: insignia de estado con ícono y texto.

## Iconografía

Sin librería de íconos: los estados usan glifos tipográficos (▲ ● ✓ –) en el color `-ink` del estado. No hay logotipo cargado en este sistema.
