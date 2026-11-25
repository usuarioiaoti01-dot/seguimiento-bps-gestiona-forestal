# Pendientes del rediseño OTI Visual v2

Aplicado el 25/11/2026 según `REDISENO-TABLERO-OTI.md` (v2) y `referencia-tablero-general.html`. Aquí se anota lo
que el diseño pide y la aplicación no puede mostrar con los datos actuales, o se resolvió de otra forma, sin
inventar campos ni cambiar la lógica de negocio.

## Datos que el modelo no trae

| Elemento del diseño | Qué se muestra | Por qué |
|---|---|---|
| Menú «Agenda de entregables» con insignia | No se agregó | La vista no existe y el diseño pide no crear vistas nuevas. Si se quiere, es una vista nueva (lista de entregables por fecha límite) que sale de `/api/portafolio` y `/api/estado`. |
| Atención: «Vigencia de {profesional} vence en {d} d» | «{código} · N vigencia(s) por vencer» | El tablero general (`/api/portafolio`) trae el conteo por proyecto, no el nombre ni los días de cada profesional. |
| Atención: «Conformidad de «{entregable}» fuera de plazo» | «{código} · N conformidad(es) fuera de plazo» | El tablero general trae el conteo, no el nombre del entregable. |
| Atención: «Entregable «{nombre}» vencido hace {d} d» | Se muestra con el próximo entregable del proyecto (que es el vencido más antiguo) y «(y N más)» | Solo viene un entregable por proyecto (`proximo_entregable`). |
| Alertas «19 de 47» | «**N** de M» con la etiqueta «alertas de prioridad alta de un total» | En el modelo, N = alertas de prioridad ALTA y M = total de alertas vigentes del proyecto; no son «pendientes». Se documenta en «Cómo leer este tablero». |
| Saludo «Buenas tardes, {cargo}» | Primer nombre de la cuenta | Las cuentas no tienen cargo; en la demo coincide («Director»). |

## Decisiones de implementación

- **Logo y título en la banda de resumen (decisión del usuario, 25/11/2026):** el §1 de la v2 deja el logo solo en el menú; por pedido del usuario la banda lleva arriba el logo del SERFOR y el título «SEGUIMIENTO DE PROYECTOS DE LA OFICINA DE TECNOLOGÍAS DE LA INFORMACIÓN», con el estilo de la v2 (color sólido, sin degradados ni ondas) y las cuatro cifras debajo.

- **Tokens:** los colores nuevos (menú institucional, `--progress`, `--brand-soft`, `--on-brand`, `--today-fill`, `--scrim`, etc.) se agregaron a `oti-visual/design-system/tokens.json` y se regeneró `tokens.css` (paquete y copia idéntica en `public/`). `estilos.css` no tiene hexadecimales ni degradados y mantiene alias de los nombres antiguos (`--marca`, `--verde`…) para no tocar el contenido de las vistas.
- **`--on-brand` y `--today-fill`** no están en la tabla del §3: hacen falta para el texto del botón primario en tema oscuro (el verde de marca oscuro es claro) y para la insignia azul «Registrado / En trámite» que ya usaban las vistas.
- **Reporte PDF:** pdfkit no lee variables CSS; los colores del PDF copian los valores de los tokens en `server/reporte-mensual.js`. Su semáforo va en texto («En riesgo», «Atención»…) porque Helvetica no tiene los glifos ▲ ● ✓.
- **Tema oscuro:** sigue la preferencia del sistema (y `data-theme="dark"`); no hay selector manual.
- **Variante del menú:** institucional por defecto; «Menú claro» se elige en el menú ⋮ de la cuenta y se recuerda en el navegador (no en la base).
- **Menú colapsado (1024–1279 px):** riel de 72 px que se expande al pasar el puntero o al recibir el foco (sin botón propio).
- **Inter** se carga de Google Fonts (permitido por la CSP); sin acceso a internet cae a Segoe UI. Para no depender de Google, se puede alojar la fuente en `public/`.
- **Animación:** conteo de cifras y trazado de dona, medidor, anillos y barras (CSS y `requestAnimationFrame`); nada con `prefers-reduced-motion`.
- **Filtros en la URL** solo en el Tablero general (`#/?situacion=…&sem=…&tema=…`).

## Fuera de lo hecho (fase 8 parcial)

- Las demás vistas tomaron el shell, los tokens, los botones, las tablas y las insignias, pero conservan su contenido y sus títulos (varios en MAYÚSCULAS, p. ej. «SUPERVISIÓN DIARIA»). Normalizar esos títulos es un cambio de texto vista por vista.
- El componente `VigenciaTimeline` (paquete OTI Visual) conserva su hoja propia; ya usa los mismos tokens.
- Esqueletos de carga genéricos (tres bloques), no uno por vista.
