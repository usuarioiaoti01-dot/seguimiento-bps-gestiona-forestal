# Integración en la aplicación con Claude Code

## Cómo usar este paquete

1. Copia la carpeta `oti-visual/` en la raíz del repositorio de la aplicación (o en `docs/handoff/oti-visual/`).
2. Abre Claude Code en el repositorio.
3. Pega el prompt de la sección siguiente y reemplaza lo que está entre `‹ ›`.

---

## Prompt para Claude Code

```
Lee oti-visual/README.md, oti-visual/design-system/README.md y
oti-visual/design-system/components/VigenciaTimeline.md antes de tocar código.

Objetivo: integrar el componente VigenciaTimeline y los tokens del sistema de diseño
"OTI Visual" en esta aplicación, en la vista ‹nombre de la vista / ruta›.

Pasos:
1. Explora el repo y dime en 5 líneas: framework, cómo se gestionan estilos (CSS global,
   módulos, Tailwind…), dónde vive la capa de datos y si ya hay soporte de tema oscuro.
   Espera mi confirmación antes de seguir.
2. Tokens: incorpora oti-visual/design-system/tokens.css como hoja global (o, si usamos
   Tailwind, mapea las variables en theme.extend.colors sin duplicar valores).
   tokens.json es la fuente de verdad; no edites tokens.css a mano.
3. Componente: copia src/vigencia-timeline/ a ‹ruta de componentes›. Si la app es React
   usa VigenciaTimeline.jsx (convertir a .tsx si el proyecto es TypeScript, tipando con
   vigencia-timeline.d.ts); si no, usa la API renderVigenciaTimeline(). No reescribas la
   lógica de compute.js: impórtala.
4. Datos: crea un adaptador que transforme ‹tabla/endpoint/modelo de contratos› al contrato
   ContratoVigencia (id, descripcion, inicio, fin, adenda, terminoProbable; fechas
   AAAA-MM-DD). Valida fechas y reporta los registros descartados en consola, sin romper
   la vista. La fecha de corte es la fecha actual en America/Lima.
5. onRowClick debe abrir ‹el detalle existente del contrato›.
6. Lleva tests/compute.test.js al runner de pruebas del proyecto y agrega pruebas para el
   adaptador. Todas deben pasar.
7. Verifica visualmente la vista en tema claro y oscuro y a 390 px de ancho; compárala con
   oti-visual/demo/index.html.

Restricciones:
- No cambies colores, textos de estado ni umbrales fuera de tokens.json /
  umbralAtencion: son decisiones de diseño documentadas.
- Mantén el escape de HTML (función esc) en todo dato que venga de la base de datos.
- No agregues dependencias nuevas sin consultarme.
- Al terminar, entrega un resumen de archivos creados/modificados y los pendientes.
```

---

## Criterios de aceptación

- [ ] Las filas se agrupan en Sin cobertura → Desfase menor → En plazo → Sin término probable, ordenadas por brecha.
- [ ] Con los datos de ejemplo: KPI 4 / 2 / 3 / 2 y aviso "Firmar adendas antes del 13 nov — quedan 9 días".
- [ ] Al pulsar "Con adendas en trámite" se recalcula: 0 / 2 / 7 / 2.
- [ ] El tramo rayado rojo aparece solo cuando el término probable supera la vigencia efectiva.
- [ ] La insignia muestra la consecuencia ("16 d sin cobertura", "+1 d de margen"), nunca el signo solo.
- [ ] Se puede llegar a cada fila con Tab y ver su tooltip; "Ver como tabla" muestra los mismos datos.
- [ ] Tema oscuro legible; en móvil el gráfico se desplaza en horizontal y los KPI quedan en 2 columnas.
- [ ] `npm test` (o el runner del proyecto) en verde.

## Decisiones de diseño (no reabrir sin motivo)

| Decisión | Razón |
|---|---|
| Marca de término probable en tinta, no en color de estado | Un color = un significado; el estado lo comunican el tramo y la insignia |
| Línea de corte azul (`today`), único elemento azul | Se distingue de cualquier estado |
| Brecha expresada como consecuencia | El signo solo es ambiguo para la lectura directiva |
| Grupo crítico primero, con plazo de firma | El tablero debe responder "qué decido hoy" |
| Ícono + texto en todo estado | Accesibilidad (daltonismo, impresión en B/N) |

## Si después cambias el diseño

El sistema de diseño también está publicado como artefacto "OTI Visual" en Claude. Si cambias tokens o reglas allí, vuelve a exportar `tokens.json` y regenera `tokens.css`. Si el cambio nace en el código, actualiza `tokens.json` aquí y deja anotado el motivo en `design-system/README.md`.
