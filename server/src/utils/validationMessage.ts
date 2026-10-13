import type { ZodError, ZodIssue } from 'zod';

/**
 * The admin panel prints an API error's message as-is, so a failed validation has
 * to come back as a sentence an admin can act on, in Spanish. Zod's own messages
 * are English ("String must contain at least 3 character(s)"); this words the
 * issue from its code instead. Custom issues (`superRefine`) are already written
 * in Spanish where they are raised.
 */
const FIELD_LABELS: Record<string, string> = {
  name: 'el nombre',
  sku: 'el SKU',
  points: 'los puntos',
  active: 'el estado activo',
  description: 'la descripción',
  startsAt: 'la fecha de inicio',
  endsAt: 'la fecha de fin',
  products: 'los productos',
  productId: 'el producto',
  minQuantity: 'la cantidad mínima',
  milestones: 'los hitos',
  targetPoints: 'la meta de puntos',
  reward: 'el premio',
  participantUids: 'los participantes',
  reason: 'el motivo',
  email: 'el correo',
  displayName: 'el nombre',
  role: 'el rol',
  disabled: 'el estado de la cuenta',
  status: 'el estado',
  campaignId: 'la campaña',
};

function fieldOf(issue: ZodIssue): string {
  const key = [...issue.path].reverse().find((part): part is string => typeof part === 'string');
  return (key && FIELD_LABELS[key]) ?? 'un dato';
}

function describe(issue: ZodIssue): string {
  const field = fieldOf(issue);

  // Worded around the field ("Revisa el nombre", "El mínimo para los puntos")
  // so the sentence agrees whatever the field's gender and number.
  switch (issue.code) {
    case 'custom':
      return issue.message;
    case 'invalid_type':
      if (issue.received === 'undefined') return `Falta ${field}.`;
      if (issue.expected === 'integer') return `Revisa ${field}: debe ser un número entero.`;
      return `Revisa ${field}: el formato no es válido.`;
    case 'too_small':
      if (issue.type === 'string') {
        return Number(issue.minimum) <= 1
          ? `Completa ${field}.`
          : `Escribe al menos ${issue.minimum} caracteres en ${field}.`;
      }
      if (issue.type === 'array') return `Agrega al menos ${issue.minimum} en ${field}.`;
      return `El mínimo para ${field} es ${issue.minimum}.`;
    case 'too_big':
      if (issue.type === 'string') return `Escribe como máximo ${issue.maximum} caracteres en ${field}.`;
      if (issue.type === 'array') return `Se admiten como máximo ${issue.maximum} en ${field}.`;
      return `El máximo para ${field} es ${issue.maximum}.`;
    case 'invalid_string':
      if (issue.validation === 'email') return 'El correo no es válido.';
      if (issue.validation === 'datetime') return `Revisa ${field}: no es una fecha válida.`;
      return `Revisa ${field}: el formato no es válido.`;
    case 'invalid_enum_value':
      return `Revisa ${field}: no es un valor permitido.`;
    default:
      return `Revisa ${field}.`;
  }
}

/** The first problem only: one clear sentence beats a list the admin has to decode. */
export function validationMessage(error: ZodError): string {
  const issue = error.issues[0];
  return issue ? `Datos no válidos: ${describe(issue)}` : 'Datos no válidos.';
}
