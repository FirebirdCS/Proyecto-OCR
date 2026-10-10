/**
 * Runs one receipt file through the real pipeline — Vision, line rebuilding,
 * the plausibility checks and the matcher — and prints what each stage saw.
 *
 * It is the only way to tell a matcher bug from an OCR one: the rebuilt lines
 * are what `matchReceipt` actually reads, and they rarely look like the paper.
 *
 *   pnpm --filter @ocr/server exec tsx src/scripts/diagnose-receipt.ts <file> ["Product name" ...]
 */
import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';

import { extractText } from '../services/ocr.service.js';
import { findReceiptDates, findTicketNumber, findTime, findTotalCents, hasTotal } from '../utils/receiptChecks.js';
import { matchReceipt, type MatchCandidate } from '../utils/receiptMatching.js';

const MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

const [path, ...names] = process.argv.slice(2);
if (!path) throw new Error('Usage: diagnose-receipt.ts <file> ["Product name" ...]');

const mimeType = MIME[extname(path).toLowerCase()];
if (!mimeType) throw new Error(`Unsupported file type: ${extname(path)}`);

const file = await readFile(path);
console.log(`=== ${basename(path)} (${mimeType}, ${(file.length / 1024).toFixed(0)} KB) ===\n`);

const result = await extractText(file, mimeType);

console.log('--- rebuilt lines (what the matcher reads) ---');
result.lines.forEach((line, index) => console.log(String(index).padStart(3), '|', line));

console.log('\n--- checks ---');
const text = result.lines.join('\n');
console.log('hasTotal      :', hasTotal(text));
console.log('totalCents    :', findTotalCents(text));
console.log('dates         :', findReceiptDates(text));
console.log('time          :', findTime(text));
console.log('ticketNumber  :', findTicketNumber(text));

if (names.length > 0) {
  const candidates: MatchCandidate[] = names.map((name, index) => ({
    productId: `p${index + 1}`,
    name,
  }));
  console.log('\n--- matcher ---');
  console.log('candidates    :', candidates.map((c) => `${c.productId}=${c.name}`).join(', '));
  const matches = matchReceipt(text, candidates);
  if (matches.length === 0) console.log('NO MATCH');
  for (const match of matches) {
    console.log(`${match.productId}: quantity=${match.quantity}`);
    for (const line of match.lines) {
      console.log(`   qty=${line.quantity} priced=${line.priced} <- ${JSON.stringify(line.text)}`);
    }
  }
}
