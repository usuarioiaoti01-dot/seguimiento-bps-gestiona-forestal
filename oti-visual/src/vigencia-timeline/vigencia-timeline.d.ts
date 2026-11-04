/** Contrato de datos de entrada (una fila por contrato). Fechas ISO 'AAAA-MM-DD', días calendario. */
export interface ContratoVigencia {
  /** Código visible en la fila (p. ej. iniciales o N° de orden). */
  id: string;
  /** Texto opcional para el tooltip (nombre, objeto del contrato). */
  descripcion?: string;
  /** Adendas concluidas (se dibujan en gris antes de la vigencia actual si `mostrarHistorial`). */
  historial?: TramoHistorial[];
  /** Días sin cobertura entre adendas (en rojo con `mostrarHistorial`). */
  brechas?: Tramo[];
  /** Vigencias superpuestas: inconsistencia (en ámbar con `mostrarHistorial`). */
  superposiciones?: Tramo[];
  /** Texto que se muestra como nombre de la fila (p. ej. nombre y primer apellido). Por defecto, `id`. */
  etiqueta?: string;
  /** Inicio de la vigencia contractual. */
  inicio: string;
  /** Fin de la vigencia firmada (incluye adendas ya firmadas). */
  fin: string;
  /** Nuevo fin propuesto por una adenda anunciada / en trámite; null si no hay. */
  adenda?: string | null;
  /** Término probable del plan de trabajo; null si no se ha estimado. */
  terminoProbable?: string | null;
}

/** Periodo 'AAAA-MM-DD'. `dias` = días del tramo. */
export interface Tramo { inicio: string; fin: string; dias?: number }
export interface TramoHistorial extends Tramo { numero: number; plazoDias?: number | null; plazoSolicitadoDias?: number | null }

export type ModoBrecha = 'firmada' | 'adenda';
export type EstadoBrecha = 'critical' | 'warn' | 'ok' | 'none';

export interface VigenciaTimelineOptions {
  data: ContratoVigencia[];
  /** Fecha de corte 'AAAA-MM-DD' (normalmente hoy). */
  corte: string;
  titulo?: string;
  /** 'firmada' (por defecto) o 'adenda' (asume firmadas las adendas en trámite). */
  modo?: ModoBrecha;
  /** Brecha (días) por debajo de la cual el estado es crítico. Por defecto -7. */
  umbralAtencion?: number;
  /** Sustantivo plural para el subtítulo. Por defecto 'contratos'. */
  etiquetaFila?: string;
  /**
   * Contenido del tooltip de cada fila. 'completo' (por defecto): brecha, inicio, fin, adenda, término probable y
   * días para firmar. 'vigencia': solo inicio y fin de vigencia; si hay una adenda que amplía la vigencia, su
   * vencimiento y el plazo para firmarla.
   */
  tooltip?: 'completo' | 'vigencia';
  /** false: sin la columna BRECHA (insignias); el gráfico ocupa todo el ancho. Por defecto true. */
  mostrarBrecha?: boolean;
  /** true: adendas concluidas en gris antes de la vigencia actual y días sin cobertura en rojo. Por defecto false. */
  mostrarHistorial?: boolean;
  /** 'AAAA-MM-DD': con `mostrarHistorial`, el eje arranca en esta fecha si es anterior a los datos. */
  ejeDesde?: string | null;
  /** false: sin la marca del término probable (leyenda, gráfico, eje y tabla). Por defecto true. */
  mostrarTerminoProbable?: boolean;
  /** false: sin el tramo rayado entre el fin de vigencia y el término probable. Por defecto true. */
  tramoSinCobertura?: boolean;
  /** Ancho de la columna de nombres de fila, en unidades del gráfico (viewBox de 1060). Por defecto 76. */
  anchoEtiqueta?: number;
  onModoChange?: (modo: ModoBrecha) => void;
  onRowClick?: (row: FilaCalculada) => void;
}

export interface FilaCalculada extends ContratoVigencia {
  ini: number; fin: number; ad: number | null; prob: number | null; end: number;
  /** fin efectivo − término probable, en días; null sin término probable. */
  brecha: number | null;
  status: EstadoBrecha;
  porIniciar: boolean;
  diasParaFirmarAdenda: number | null;
}

export interface VigenciaTimelineInstance {
  update(patch: Partial<VigenciaTimelineOptions>): void;
  setModo(modo: ModoBrecha): void;
  getModo(): ModoBrecha;
  destroy(): void;
}

export function renderVigenciaTimeline(container: HTMLElement, options: VigenciaTimelineOptions): VigenciaTimelineInstance;
