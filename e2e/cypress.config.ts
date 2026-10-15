import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'cypress';

const SAMPLES = path.resolve(__dirname, '..', 'samples');

export default defineConfig({
  // Cada ejecución deja su evidencia aquí (se reemplaza en la siguiente).
  videosFolder: 'evidencia/videos',
  screenshotsFolder: 'evidencia/capturas',
  video: true,
  screenshotOnRunFailure: true,
  viewportWidth: 1280,
  viewportHeight: 800,
  // El OCR pasa por Google Vision y puede tardar varios segundos.
  defaultCommandTimeout: 15000,
  // Generar los comprobantes renderiza unas 16 páginas con Edge.
  taskTimeout: 240000,
  e2e: {
    baseUrl: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    setupNodeEvents(on) {
      // La suite de QA (scripts/suite-qa.mjs) lee de aquí los resultados para su informe.
      on('after:run', (results) => {
        if (process.env.QA_CYPRESS_RESULTADOS) {
          writeFileSync(process.env.QA_CYPRESS_RESULTADOS, JSON.stringify(results, null, 2));
        }
      });

      on('task', {
        /**
         * Un comprobante válido suma una sola vez: si se reusara el mismo, la
         * prueba de carga válida fallaría por duplicado desde la segunda
         * ejecución. Cada ejecución genera un lote propio (números de ticket
         * nuevos) con el generador del proyecto, en samples/casos/e2e.
         */
        generarComprobantes({ producto }: { producto: string }) {
          const lote = 1000 + (Math.floor(Date.now() / 1000) % 1_000_000);
          const out = path.join(SAMPLES, 'casos', 'e2e');
          execFileSync(
            'python',
            [path.join(SAMPLES, 'generate_samples.py'), '--lote', String(lote), '--product', producto, '--out', out],
            { stdio: 'inherit' },
          );
          return out;
        },
      });
    },
  },
});
