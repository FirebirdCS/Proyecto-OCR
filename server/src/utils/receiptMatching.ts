/**
 * Finds campaign products in the OCR text of a receipt and works out how many
 * units of each were bought.
 *
 * Receipts are noisy: names get abbreviated, OCR swaps a letter, columns land
 * on separate lines. The matcher is deliberately conservative — whenever the
 * quantity is ambiguous it counts one unit, because over-awarding points is the
 * failure nobody reports.
 */

import { hasAmount } from './receiptChecks.js';

export interface MatchCandidate {
  productId: string;
  name: string;
  sku?: string;
}

export interface MatchedLine {
  /** The receipt line the product was read from, kept as evidence. */
  text: string;
  quantity: number;
  /**
   * Whether an amount was printed for it — on the line itself, or on the
   * "2 x 15.00" line its quantity came from. A product name with no price
   * next to it is what a hand-written note looks like.
   */
  priced: boolean;
}

export interface ReceiptMatch {
  productId: string;
  /** Units across every line, priced or not; callers decide what counts. */
  quantity: number;
  lines: MatchedLine[];
}

/** Anything above this on one line is far likelier a price or a code than a count. */
export const MAX_LINE_QUANTITY = 999;

interface Token {
  raw: string;
  norm: string;
}

interface Key {
  productId: string;
  text: string;
  /** SKUs are codes — a near miss is a different product, not an OCR slip. */
  exactOnly: boolean;
}

interface LineHit {
  productId: string;
  start: number;
  end: number;
  score: number;
}

const UNIT_WORD = '(?:u|un|und|unid|unids|unidad|unidades|ud|uds|pz|pza|pzas|pieza|piezas)';
// Quantities may be printed with three zero decimals ("2.000"); prices use two,
// which is what keeps "15.00 x 2" from reading as fifteen units.
const QTY = '([1-9]\\d{0,2})(?:[.,]000)?';

const SAME_LINE_PATTERNS = [
  new RegExp(`(?:^|\\s)${QTY}\\s*[x×*](?=\\s|\\d|\\$|$)`), // "2 x 15.00", "2x"
  new RegExp(`(?:^|\\s)[x×]\\s?([1-9]\\d{0,2})(?=\\s|$)`), // "x2", "15.00 x 2"
  new RegExp(`(?:^|\\s)${QTY}\\s*${UNIT_WORD}\\.?(?=\\s|$)`), // "2 un", "3 pzas"
  new RegExp(`cant(?:idad)?\\.?:?\\s*${QTY}(?=\\s|$)`), // "cant: 2"
];

const LEADING_QTY = /^[1-9]\d{0,2}(?:[.,]000)?$/;
const QTY_ONLY_LINE = new RegExp(`^${QTY}\\s*(?:${UNIT_WORD}\\.?\\s*)?[x×*]`);

export function normalizeToken(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** Whitespace- and punctuation-insensitive form of a whole text, for fingerprinting. */
export function normalizeText(text: string): string {
  return text.split(/\s+/).map(normalizeToken).filter(Boolean).join(' ');
}

function tokenize(line: string): Token[] {
  return line
    .split(/\s+/)
    .filter(Boolean)
    .map((raw) => ({ raw: raw.toLowerCase(), norm: normalizeToken(raw) }));
}

function buildKeys(candidates: MatchCandidate[]): Key[] {
  const keys: Key[] = [];
  for (const candidate of candidates) {
    const name = normalizeToken(candidate.name);
    if (name) keys.push({ productId: candidate.productId, text: name, exactOnly: false });

    const sku = candidate.sku ? normalizeToken(candidate.sku) : '';
    if (sku.length >= 3) keys.push({ productId: candidate.productId, text: sku, exactOnly: true });
  }
  return keys;
}

function levenshtein(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        previous[j]! + 1,
        current[j - 1]! + 1,
        previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length]!;
}

const digitsOf = (value: string) => value.replace(/\D/g, '');

/**
 * Compares a window of the line against a key with spacing already squeezed
 * out, so "COCA-COLA" and "coca cola" agree. Short keys and anything with
 * different digits must match exactly: "500ml" is not an OCR slip of "600ml".
 */
function compare(window: string, key: Key): 'exact' | 'fuzzy' | null {
  if (window === key.text) return 'exact';
  if (key.exactOnly || key.text.length < 5) return null;
  if (digitsOf(window) !== digitsOf(key.text)) return null;

  const budget = key.text.length >= 12 ? 2 : 1;
  if (Math.abs(window.length - key.text.length) > budget) return null;
  return levenshtein(window, key.text) <= budget ? 'fuzzy' : null;
}

/**
 * The most specific product on a line. Longer keys win, so a line reading
 * "Coca Cola Zero" goes to that product rather than to plain "Coca Cola".
 */
function bestHit(tokens: Token[], keys: Key[]): LineHit | null {
  let best: LineHit | null = null;

  for (const key of keys) {
    for (let start = 0; start < tokens.length; start++) {
      if (!tokens[start]!.norm) continue;

      let window = '';
      for (let end = start + 1; end <= tokens.length; end++) {
        window += tokens[end - 1]!.norm;
        if (window.length > key.text.length + 2) break;

        const kind = compare(window, key);
        if (!kind) continue;

        const score = key.text.length * 2 + (kind === 'exact' ? 1 : 0);
        if (!best || score > best.score) {
          best = { productId: key.productId, start, end, score };
        }
        break;
      }
    }
  }

  return best;
}

/** A quantity printed on the same line as the product, outside the product's own name. */
function sameLineQuantity(tokens: Token[], hit: LineHit): number | null {
  const before = tokens.slice(0, hit.start).map((token) => token.raw);
  const after = tokens.slice(hit.end).map((token) => token.raw);

  for (const text of [before.join(' '), after.join(' ')]) {
    for (const pattern of SAME_LINE_PATTERNS) {
      const found = pattern.exec(text);
      if (found) return Number(found[1]);
    }
  }

  // "2 COCA COLA 600ML 36.00" — a bare count heading the line.
  if (before.length === 1 && LEADING_QTY.test(before[0]!)) {
    return Number.parseInt(before[0]!, 10);
  }

  return null;
}

/** A line that holds nothing but "2 x 15.00": the count for a neighbouring item. */
function quantityOnlyLine(line: string): number | null {
  const lower = line.toLowerCase().trim();
  // Units and the quetzal sign ("2 UN X 13.89920 Q27.80") are the only letters allowed.
  const withoutUnits = lower
    .replace(new RegExp(`\\b${UNIT_WORD}\\b\\.?`, 'g'), ' ')
    .replace(/(^|\s)q\.?(?=\s?\d)/g, ' ');
  if (/[a-wyz]/.test(withoutUnits)) return null;

  const found = QTY_ONLY_LINE.exec(lower);
  return found ? Number(found[1]) : null;
}

/**
 * Some receipts print the "2 x 15.00" line above its item, some below. Vote
 * with the lines that are known to be items; a tie means nobody can tell, and
 * then the neighbouring counts are ignored rather than guessed.
 */
function quantityLineSide(
  hits: (LineHit | null)[],
  quantities: (number | null)[],
  wrapped: boolean[],
): 'above' | 'below' | null {
  let above = 0;
  let below = 0;

  quantities.forEach((quantity, index) => {
    if (quantity === null || hits[index]) return;
    if (hits[index + 1]) above++;
    if (hits[index - 1] || (wrapped[index - 1] && hits[index - 2])) below++;
  });

  if (above === below) return null;
  return above > below ? 'above' : 'below';
}

export function matchReceipt(text: string, candidates: MatchCandidate[]): ReceiptMatch[] {
  const keys = buildKeys(candidates);
  if (keys.length === 0) return [];

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const tokens = lines.map(tokenize);
  const hits = tokens.map((lineTokens) => bestHit(lineTokens, keys));
  const quantities = lines.map((line, index) => (hits[index] ? null : quantityOnlyLine(line)));

  // A description that wraps onto a second line with no digits, price or count of
  // its own ("DAKENX DEXKETOPROFENO 25MG X" / "AMPOLLA BEBIBLE"), as Guatemalan FEL
  // receipts print it. The name may span both lines, and the count sits below them.
  // Note this is the line's *shape* only: a line that matched a product on its own
  // still qualifies, because on a wrapped description the tail often is a product
  // name ("Ampolla Bebible") without being a second item.
  const isContinuation = (index: number) =>
    index < lines.length &&
    quantities[index] === null &&
    !hasAmount(lines[index]!) &&
    /[a-z]/i.test(lines[index]!) &&
    !/\d/.test(lines[index]!);
  const wrapped = lines.map(() => false);
  for (let index = 0; index + 1 < lines.length; index++) {
    if (wrapped[index] || !isContinuation(index + 1)) continue;

    const firstLength = tokens[index]!.length;
    const joined = bestHit([...tokens[index]!, ...tokens[index + 1]!], keys);
    // Only a name that really crosses the break; a hit wholly on one side is not
    // this item. It also has to beat what either line matched alone, or a short
    // "Dakenx" — or a generic "Ampolla Bebible" sitting on the tail — would shadow
    // the "Dakenx ... Ampolla Bebible" that can only be seen once both lines are
    // joined. Longest-match-wins has to hold across the break too.
    const crosses = joined !== null && joined.start < firstLength && joined.end > firstLength;
    const alone = Math.max(hits[index]?.score ?? 0, hits[index + 1]?.score ?? 0);
    if (crosses && joined!.score > alone) {
      hits[index] = { ...joined!, end: firstLength };
    }

    // The two lines are one item. Whatever matched the tail on its own does not
    // score again, or a single 2-unit line would award a product for each half.
    if (hits[index]) {
      hits[index + 1] = null;
      wrapped[index + 1] = true;
    }
  }

  const side = quantityLineSide(hits, quantities, wrapped);
  const byProduct = new Map<string, ReceiptMatch>();

  hits.forEach((hit, index) => {
    if (!hit) return;

    const below = wrapped[index + 1] ? index + 2 : index + 1;
    const neighbour = side === 'above' ? index - 1 : side === 'below' ? below : -1;
    const own = sameLineQuantity(tokens[index]!, hit);
    const borrowed = own === null ? (quantities[neighbour] ?? null) : null;
    const quantity = Math.min(own ?? borrowed ?? 1, MAX_LINE_QUANTITY);
    const priced = hasAmount(lines[index]!) || (borrowed !== null && hasAmount(lines[neighbour]!));

    const entry = byProduct.get(hit.productId) ?? { productId: hit.productId, quantity: 0, lines: [] };
    entry.quantity += quantity;
    entry.lines.push({ text: lines[index]!, quantity, priced });
    byProduct.set(hit.productId, entry);
  });

  return [...byProduct.values()];
}
