/**
 * Plausibility checks that separate a real receipt from a photo of a note that
 * happens to name a product. None is proof on its own; together they make
 * "write PARACETAMOL on a napkin" worth nothing.
 */

// "135.00", "$1,234.50", "1.234,50", "$ 99.50", and quetzales: "Q27.80", "Q. 27.80".
// Two decimals is what separates an amount from a quantity ("2.000") or a pack size.
const AMOUNT = /(?:^|[\s$:])(?:\$|q\.?)?\s?\d{1,3}(?:[.,]\d{3})*[.,]\d{2}(?=\s|$)/i;

export function hasAmount(line: string): boolean {
  return AMOUNT.test(line);
}

const AMOUNT_VALUE = /(?:^|[\s$:])(?:\$|q\.?)?\s?(\d{1,3}(?:[.,]\d{3})*[.,]\d{2})(?=\s|$)/gi;

/** Every amount always carries two decimals, so the digits alone are the value in cents. */
function amountsIn(line: string): number[] {
  return [...line.matchAll(AMOUNT_VALUE)].map((found) => Number(found[1]!.replace(/\D/g, '')));
}

// "subtotal" has no word boundary before "total", so only "sub total" needs excluding.
const TOTAL_WORD = /\btotal\b/i;
const SUBTOTAL = /\bsub[\s.-]*total\b/i;

/** The TOTAL amount in cents: the last amount on the TOTAL line, else the first on the two lines below. */
export function findTotalCents(text: string): number | null {
  const lines = text.split(/\r?\n/);

  for (const [index, line] of lines.entries()) {
    if (!TOTAL_WORD.test(line) || SUBTOTAL.test(line)) continue;

    const own = amountsIn(line);
    if (own.length > 0) return own.at(-1)!;

    for (const next of lines.slice(index + 1, index + 3)) {
      const found = amountsIn(next);
      if (found.length > 0) return found[0]!;
    }
  }

  return null;
}

export function hasTotal(text: string): boolean {
  return findTotalCents(text) !== null;
}

const TICKET_NUMBER =
  /\b(?:ticket|folio|factura|boleta|recibo|transacci[oó]n|trx|operaci[oó]n)\b\s*(?:n[°º.]?|no\.?|num\.?|#)?\s*[:.#-]?\s*([a-z]{0,3}-?\d[\d-]{2,})/i;

// Guatemalan FEL invoices print the word FACTURA on a line of its own and the
// document's identity several lines below, as "Serie: 22C1EE21" / "Numero:
// 1,428,178,504" — too far apart for TICKET_NUMBER, which wants them adjacent.
// The serie repeats across a till's whole roll, so the correlative is what
// identifies the document; the serie only narrows it further when it is legible.
const FEL_NUMBER = /\bn[uú]mero\b\s*:?\s*(\d[\d,.]{3,})/i;
const FEL_SERIE = /\bserie\b\s*:?\s*([a-z0-9-]{4,})/i;

/** The receipt's own number ("TICKET: 000482", "FOLIO A-1234"), normalized, or null. */
export function findTicketNumber(text: string): string | null {
  const found = TICKET_NUMBER.exec(text);
  if (found) return found[1]!.toUpperCase().replace(/[^A-Z0-9]/g, '');

  const number = FEL_NUMBER.exec(text);
  if (!number) return null;

  const serie = FEL_SERIE.exec(text);
  const raw = `${serie ? serie[1]! : ''}${number[1]!}`;
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

const TIME = /(?<!\d)([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?(?!\d)/;

/** The time printed on the receipt as `HH:MM`, or null. */
export function findTime(text: string): string | null {
  const found = TIME.exec(text);
  return found ? `${found[1]!.padStart(2, '0')}:${found[2]}` : null;
}

const MONTHS: Record<string, number> = {
  ene: 1, enero: 1, jan: 1,
  feb: 2, febrero: 2,
  mar: 3, marzo: 3,
  abr: 4, abril: 4, apr: 4,
  may: 5, mayo: 5,
  jun: 6, junio: 6,
  jul: 7, julio: 7,
  ago: 8, agosto: 8, aug: 8,
  sep: 9, sept: 9, set: 9, septiembre: 9, setiembre: 9,
  oct: 10, octubre: 10,
  nov: 11, noviembre: 11,
  dic: 12, diciembre: 12, dec: 12,
};

const NUMERIC_DATE = /(?<!\d)(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})(?!\d)/g;
const ISO_DATE = /(?<!\d)(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})(?!\d)/g;
const WORDY_DATE = /(?<!\d)(\d{1,2})(?:\s*de)?[\s/.-]*([a-z]{3,10})\.?(?:\s*de(?:l)?)?[\s/.-]*(\d{4}|\d{2})(?!\d)/g;

function toKey(year: number, month: number, day: number): string | null {
  const fullYear = year < 100 ? 2000 + year : year;
  if (fullYear < 2000 || fullYear > 2099 || month < 1 || month > 12 || day < 1) return null;

  const date = new Date(Date.UTC(fullYear, month - 1, day));
  if (date.getUTCMonth() !== month - 1) return null; // 31/02 and friends
  return date.toISOString().slice(0, 10);
}

/**
 * Every calendar date printed on the receipt, as `YYYY-MM-DD`. Day-first, as
 * receipts are written in Spanish; month-first is tried only when day-first is
 * impossible (09/15/2026).
 */
export function findReceiptDates(text: string): string[] {
  const found = new Set<string>();

  for (const [, a, b, year] of text.matchAll(NUMERIC_DATE)) {
    const key = toKey(Number(year), Number(b), Number(a)) ?? toKey(Number(year), Number(a), Number(b));
    if (key) found.add(key);
  }

  for (const [, year, month, day] of text.matchAll(ISO_DATE)) {
    const key = toKey(Number(year), Number(month), Number(day));
    if (key) found.add(key);
  }

  const plain = text
    .split(/\s+/)
    .map((word) => word.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase())
    .join(' ');
  for (const [, day, name, year] of plain.matchAll(WORDY_DATE)) {
    const month = MONTHS[name!];
    const key = month ? toKey(Number(year), month, Number(day)) : null;
    if (key) found.add(key);
  }

  return [...found];
}
