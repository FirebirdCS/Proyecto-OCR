/**
 * Regression run over `samples/casos`: every fixture through real Vision, the
 * checks and the matcher, compared against the units `samples/README.md`
 * documents. Run it after touching the matcher or the checks.
 *
 *   pnpm --filter @ocr/server exec tsx src/scripts/check-samples.ts [dir]
 *
 * It only reads — nothing is written to Firestore and no points are scored.
 */
import { readFile, readdir } from 'node:fs/promises';
import { extname, join } from 'node:path';

import { extractText } from '../services/ocr.service.js';
import { findReceiptDates, hasTotal } from '../utils/receiptChecks.js';
import { matchReceipt } from '../utils/receiptMatching.js';

/** Units the matcher should report, before the 50-unit cap scoring applies. */
const EXPECTED: Record<string, number> = {
  'valido-cantidad-x': 2,
  'valido-cantidad-abajo': 3,
  'valido-unidades-fecha-corta': 4,
  'valido-error-de-lectura': 2,
  'valido-foto-celular': 3,
  'valido-factura': 6,
  'revisar-cantidad-grande': 12,
  'revisar-tope-de-unidades': 60,
  'duplicado-foto-nueva': 2,
  // Rejected for a reason the matcher does not decide; it still reads the units.
  'rechazo-sin-total': 2,
  'rechazo-sin-fecha': 2,
  'rechazo-fecha-futura': 2,
  // The units are read; what makes this one score nothing is pricedLines=0,
  // so scoring drops the line as `unpriced_products`.
  'rechazo-sin-precio': 2,
  'rechazo-sin-productos': 0,
  'rechazo-nombre-abreviado': 0,
};

const MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};

const dir = process.argv[2] ?? 'samples/casos';
const files = (await readdir(dir)).filter((name) => MIME[extname(name).toLowerCase()]).sort();

let failed = 0;
for (const name of files) {
  const key = name.replace(/\.[^.]+$/, '');
  const expected = EXPECTED[key];
  if (expected === undefined) {
    console.log(`?  ${key}: not in the expected table, skipped`);
    continue;
  }

  const file = await readFile(join(dir, name));
  const result = await extractText(file, MIME[extname(name).toLowerCase()]!);
  const text = result.lines.join('\n');
  const matches = matchReceipt(text, [{ productId: 'p', name: 'Paracetamol' }]);
  const units = matches.reduce((sum, match) => sum + match.quantity, 0);
  const priced = matches.flatMap((match) => match.lines).filter((line) => line.priced).length;

  const ok = units === expected;
  if (!ok) failed++;
  console.log(
    `${ok ? 'OK ' : 'FAIL'} ${key.padEnd(28)} units=${String(units).padStart(2)} (esperado ${expected})` +
      `  pricedLines=${priced} total=${hasTotal(text)} dates=${findReceiptDates(text).length}`,
  );
}

console.log(`\n${files.length} archivos, ${failed} fallo(s).`);
if (failed > 0) process.exitCode = 1;
