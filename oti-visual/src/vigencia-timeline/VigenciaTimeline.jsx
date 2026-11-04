// Envoltorio React OPCIONAL. Úsalo solo si la app es React; si no, borra este archivo.
// Importa los estilos una vez en la app:  import '../../design-system/tokens.css'; import './vigencia-timeline.css';
import { useEffect, useRef } from 'react';
import { renderVigenciaTimeline } from './vigencia-timeline.js';

export default function VigenciaTimeline({ data, corte, titulo, modo, umbralAtencion, etiquetaFila, onModoChange, onRowClick }) {
  const ref = useRef(null);
  const inst = useRef(null);

  useEffect(() => {
    inst.current = renderVigenciaTimeline(ref.current, { data, corte, titulo, modo, umbralAtencion, etiquetaFila, onModoChange, onRowClick });
    return () => inst.current?.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    inst.current?.update({ data, corte, titulo, umbralAtencion, etiquetaFila, onModoChange, onRowClick, ...(modo ? { modo } : {}) });
  }, [data, corte, titulo, modo, umbralAtencion, etiquetaFila, onModoChange, onRowClick]);

  return <section ref={ref} aria-label={titulo ?? 'Vigencia contractual'} />;
}
