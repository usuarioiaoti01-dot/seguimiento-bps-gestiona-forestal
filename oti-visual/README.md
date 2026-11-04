# OTI Visual: paquete de traspaso a Claude Code

Contiene el sistema de diseño **OTI Visual** (tokens y guía) y el componente **VigenciaTimeline** (vigencia contractual vs. término probable del plan) listos para integrarse en la aplicación. El componente no tiene dependencias: JavaScript ES2020 + SVG + CSS custom properties.

## Estructura

```
oti-visual/
├── CLAUDE_CODE.md                     ← instrucciones y prompt para Claude Code (empezar aquí)
├── package.json                       ← solo scripts: npm test / npm run demo
├── design-system/
│   ├── README.md                      ← principios, voz, tokens, umbrales de estado
│   ├── tokens.json                    ← fuente de verdad (claro + oscuro)
│   ├── tokens.css                     ← variables CSS generadas desde tokens.json
│   └── components/
│       ├── VigenciaTimeline.md        ← anatomía, reglas, antes/después
│       └── BrechaBadge.md             ← estados y textos de la insignia
├── src/vigencia-timeline/
│   ├── compute.js                     ← lógica pura: brecha, estado, agrupación, resumen
│   ├── vigencia-timeline.js           ← render (SVG + HTML), API imperativa
│   ├── vigencia-timeline.css          ← estilos (prefijo .vt-) + .badge-brecha
│   ├── vigencia-timeline.d.ts         ← contrato de datos y API tipada
│   └── VigenciaTimeline.jsx           ← envoltorio React opcional
├── demo/
│   ├── index.html                     ← demo funcional (servir por HTTP)
│   └── datos-ejemplo.json             ← 11 contratos de la captura original
└── tests/compute.test.js              ← 8 pruebas (node:test, sin dependencias)
```

## Probar en 1 minuto

```bash
npm test          # 8 pruebas de la lógica de brecha
npx serve .       # abrir http://localhost:3000/demo/
```

## Uso

```js
import { renderVigenciaTimeline } from './src/vigencia-timeline/vigencia-timeline.js';
// Cargar antes: design-system/tokens.css y src/vigencia-timeline/vigencia-timeline.css
const vt = renderVigenciaTimeline(document.getElementById('vigencias'), {
  data,                    // ContratoVigencia[]
  corte: '2026-11-04',     // normalmente la fecha de hoy
  umbralAtencion: -7,      // opcional
  onRowClick: (fila) => abrirDetalle(fila.id),
});
vt.update({ data: nuevos }); vt.setModo('adenda'); vt.destroy();
```

## Contrato de datos

| Campo | Tipo | Obligatorio | Significado |
|---|---|---|---|
| `id` | string | sí | Código visible de la fila |
| `descripcion` | string | no | Texto adicional en el tooltip |
| `inicio` | `AAAA-MM-DD` | sí | Inicio de la vigencia |
| `fin` | `AAAA-MM-DD` | sí | Fin de la vigencia firmada (con adendas ya firmadas) |
| `adenda` | `AAAA-MM-DD` \| null | no | Nuevo fin de una adenda anunciada / en trámite |
| `terminoProbable` | `AAAA-MM-DD` \| null | no | Término probable del plan de trabajo |

**Brecha** = fin de vigencia efectiva − término probable, en días calendario. Crítico < −7; atención −7 a −1; en plazo ≥ 0; sin dato si no hay término probable.

## Pendientes de definir

1. **Umbral de 7 días**: es una propuesta. Confirmar con el área usuaria o volverlo configurable.
2. **Origen de `terminoProbable`**: ¿se registra a mano o se calcula a partir del avance del plan?
3. **Días calendario o hábiles**: hoy se usan días calendario.
4. **Datos de ejemplo**: se estimaron desde una captura (±1 día) y solo sirven para la demo.
