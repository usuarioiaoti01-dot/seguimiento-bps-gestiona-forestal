# BrechaBadge

Insignia que expresa la brecha entre el fin de la vigencia contractual y el término probable del plan, en palabras y con ícono, para que el estado nunca dependa solo del color.

## Estados

| Estado | Regla | Ícono | Texto | Tokens |
|---|---|---|---|---|
| Crítico | brecha < −7 d | ▲ | `N d sin cobertura` | `risk-fill` / `risk-ink` |
| Atención | −7 ≤ brecha < 0 | ● | `N d sin cobertura` | `warn-fill` / `warn-ink` |
| En plazo | brecha = 0 | ✓ | `Justo al cierre` | `ok-fill` / `ok-ink` |
| En plazo | brecha > 0 | ✓ | `+N d de margen` | `ok-fill` / `ok-ink` |
| Sin dato | sin término probable | – | `Sin dato` | `neutral-fill` / `ink-muted` |

## Reglas

- Nunca mostrar el signo solo (`-16 d`): la lectura correcta exige saber si negativo es bueno o malo. Escribir la consecuencia: "sin cobertura" o "de margen".
- El umbral de 7 días es un parámetro del tablero, no del sistema; si cambia, cambia también el texto de la tarjeta KPI "Desfase menor".
- Altura 24px, radio `radius-pill`, cifras con `font-variant-numeric: tabular-nums` para que las columnas alineen.
- El consumidor provee: la brecha en días (entero o `null`) y el umbral.
