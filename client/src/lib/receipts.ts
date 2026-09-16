import type { ReceiptIssue, ScanFlag, ScanStatus } from '../types/scoring';

/** `YYYY-MM-DD` -> `DD/MM/YYYY`, without letting the browser's time zone move the day. */
export function formatDay(key: string): string {
  const [year, month, day] = key.split('-');
  return `${day}/${month}/${year}`;
}

export function describeIssue(issue: ReceiptIssue): string {
  switch (issue.code) {
    case 'no_total':
      return 'No encontramos el total del comprobante. Asegúrate de que se vea la línea de TOTAL con su importe.';
    case 'no_date':
      return 'No pudimos leer la fecha del comprobante. Toma la foto de nuevo con la fecha visible.';
    case 'date_outside_campaign':
      return `La fecha del comprobante${issue.detail ? ` (${formatDay(issue.detail)})` : ''} está fuera de las fechas de la campaña.`;
    case 'unpriced_products':
      return `Estos productos no muestran su precio en el comprobante y no se contaron: ${issue.detail ?? ''}.`;
    case 'units_capped':
      return `Un comprobante puede sumar como máximo ${issue.detail ?? ''} unidades por campaña; las demás no se contaron.`;
  }
}

export const SCAN_FLAG_LABELS: Record<ScanFlag, string> = {
  units_capped: 'Superó el máximo de unidades por comprobante',
  large_line_quantity: 'Muchas unidades en una sola línea',
  frequent_scanner: 'El usuario envió muchos comprobantes en 24 horas',
  file_not_stored: 'No se pudo guardar el archivo como evidencia',
};

export const SCAN_STATUS_LABELS: Record<ScanStatus, string> = {
  scored: 'Con puntos',
  unscored: 'Sin puntos',
  voided: 'Anulado',
};
