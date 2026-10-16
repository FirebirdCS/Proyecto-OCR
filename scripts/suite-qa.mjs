#!/usr/bin/env node
/**
 * Suite de QA: ejecuta juntas todas las pruebas automatizadas y escribe un único
 * informe con sus resultados y evidencias.
 *
 *   pnpm qa            Jest + Cypress, más los últimos resultados de JMeter.
 *   pnpm qa --carga    Además vuelve a ejecutar la prueba de carga (10 escaneos reales).
 *
 * Cada ejecución crea qa/informes/<fecha>/ con index.html y las evidencias
 * ordenadas en jest/, cypress/, jmeter/ y logs/. Los enlaces del informe son
 * relativos, así que la carpeta se puede entregar o comprimir tal cual.
 *
 * Si el sitio (5173) y la API (4000) no están en marcha, la suite los levanta
 * con `pnpm dev` y los detiene al terminar.
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'http://localhost:5173';
const API = 'http://localhost:4000/api/health';
const UMBRAL_ESCANEO_MS = 15000;
const conCarga = process.argv.includes('--carga');

const inicio = new Date();
const sello = inicio.toLocaleString('sv-SE').replace(' ', '_').replace(/:/g, '');
const OUT = path.join(ROOT, 'qa', 'informes', sello);
const dir = (...parts) => {
  const full = path.join(OUT, ...parts);
  fs.mkdirSync(full, { recursive: true });
  return full;
};
const DIRS = {
  jest: dir('jest'),
  cypress: dir('cypress'),
  videos: dir('cypress', 'videos'),
  capturas: dir('cypress', 'capturas'),
  jmeter: dir('jmeter'),
  logs: dir('logs'),
};

// ------------------------------------------------------------------ utilidades

const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;
const rel = (target) => path.relative(OUT, target).split(path.sep).join('/');
const readJson = (file) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')) : null);
const titulo = (texto) => console.log(`\n\x1b[36m━━ ${texto}\x1b[0m`);

/** Ejecuta un comando mostrando su salida y copiándola (sin colores) a un log. */
function ejecutar(cmd, args, { log, env = process.env, cwd = ROOT } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    const file = log ? fs.createWriteStream(log) : null;
    const child = spawn(cmd, args.map((a) => (/\s/.test(a) ? `"${a}"` : a)), { cwd, env, shell: true });
    const tee = (chunk, stream) => {
      stream.write(chunk);
      file?.write(chunk.toString().replace(ANSI, ''));
    };
    child.stdout.on('data', (c) => tee(c, process.stdout));
    child.stderr.on('data', (c) => tee(c, process.stderr));
    child.on('close', (code) => {
      file?.end();
      resolve({ code, ms: Date.now() - started });
    });
  });
}

async function responde(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    return res.status < 500;
  } catch {
    return false;
  }
}

async function levantarServidores() {
  if ((await responde(SITE)) && (await responde(API))) return null;

  console.log('El sitio o la API no están en marcha: se inicia `pnpm dev`.');
  const log = fs.createWriteStream(path.join(DIRS.logs, 'servidores.log'));
  const child = spawn('pnpm', ['dev'], { cwd: ROOT, shell: true });
  child.stdout.on('data', (c) => log.write(c.toString().replace(ANSI, '')));
  child.stderr.on('data', (c) => log.write(c.toString().replace(ANSI, '')));

  const limite = Date.now() + 120000;
  while (Date.now() < limite) {
    if ((await responde(SITE)) && (await responde(API))) return child;
    await new Promise((r) => setTimeout(r, 1000));
  }
  detener(child);
  throw new Error('El sitio o la API no arrancaron en 2 minutos; ver logs/servidores.log.');
}

function detener(child) {
  if (!child?.pid) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F']);
  else child.kill('SIGTERM');
}

// ------------------------------------------------------------------ etapas

async function etapaJest() {
  titulo('1/3 · Pruebas unitarias (Jest)');
  const resultados = path.join(DIRS.jest, 'resultados.json');
  const cobertura = path.join(DIRS.jest, 'cobertura');
  const { ms } = await ejecutar(
    'pnpm',
    [
      '--filter', '@ocr/server', 'exec', 'jest', '--coverage',
      '--coverageDirectory', cobertura,
      '--coverageReporters=html', '--coverageReporters=json-summary', '--coverageReporters=text-summary',
      '--json', '--outputFile', resultados,
    ],
    { log: path.join(DIRS.logs, 'jest.log') },
  );
  return { ms, resultados: readJson(resultados), cobertura: readJson(path.join(cobertura, 'coverage-summary.json')) };
}

async function etapaCypress() {
  titulo('2/3 · Pruebas de extremo a extremo (Cypress)');
  const servidores = await levantarServidores();
  const resultados = path.join(DIRS.cypress, 'resultados.json');
  // VS Code pasa ELECTRON_RUN_AS_NODE a sus procesos hijos, y con ella Cypress no arranca.
  const env = { ...process.env, QA_CYPRESS_RESULTADOS: resultados };
  delete env.ELECTRON_RUN_AS_NODE;
  try {
    const carpetas = `videosFolder=${DIRS.videos.replace(/\\/g, '/')},screenshotsFolder=${DIRS.capturas.replace(/\\/g, '/')}`;
    const { ms } = await ejecutar('pnpm', ['--filter', '@ocr/e2e', 'exec', 'cypress', 'run', '--config', carpetas], {
      env,
      log: path.join(DIRS.logs, 'cypress.log'),
    });
    return { ms, resultados: readJson(resultados), servidoresIniciados: Boolean(servidores) };
  } finally {
    detener(servidores);
  }
}

async function etapaJmeter() {
  titulo(`3/3 · Prueba de carga (JMeter)${conCarga ? '' : ': últimos resultados'}`);
  let ms = null;
  if (conCarga) {
    ({ ms } = await ejecutar(
      'powershell',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(ROOT, 'carga', 'ejecutar.ps1')],
      { log: path.join(DIRS.logs, 'jmeter-ejecucion.log') },
    ));
  }

  const base = path.join(ROOT, 'carga', 'resultados');
  const ultima = fs.existsSync(base)
    ? fs
        .readdirSync(base)
        .filter((name) => fs.existsSync(path.join(base, name, 'informe', 'statistics.json')))
        .sort()
        .at(-1)
    : undefined;
  if (!ultima) {
    console.log('No hay resultados de JMeter. Ejecuta `pnpm qa --carga` o .\\carga\\ejecutar.ps1.');
    return null;
  }

  const origen = path.join(base, ultima);
  fs.cpSync(path.join(origen, 'informe'), path.join(DIRS.jmeter, 'informe'), { recursive: true });
  for (const file of ['resultados.jtl', 'jmeter.log', 'parametros.json']) {
    if (fs.existsSync(path.join(origen, file))) fs.copyFileSync(path.join(origen, file), path.join(DIRS.jmeter, file));
  }
  console.log(`Resultados de la ejecución ${ultima} copiados a jmeter/.`);

  return {
    ms,
    ejecucion: ultima,
    nueva: conCarga,
    estadisticas: readJson(path.join(DIRS.jmeter, 'informe', 'statistics.json')),
    parametros: readJson(path.join(DIRS.jmeter, 'parametros.json')) ?? parametrosDesdeJtl(path.join(DIRS.jmeter, 'resultados.jtl')),
  };
}

/** Para ejecuciones anteriores a parametros.json: usuarios concurrentes según el .jtl. */
function parametrosDesdeJtl(file) {
  if (!fs.existsSync(file)) return null;
  const [header, ...rows] = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/);
  const columnas = header.split(',');
  const hilos = columnas.indexOf('threadName');
  const usuarios = new Set(rows.map((row) => row.split(',')[hilos]).filter((name) => name?.startsWith('Usuarios')));
  return { usuarios: usuarios.size };
}

// ------------------------------------------------------------------ informe

const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const seg = (ms) => (ms == null ? '—' : ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1).replace('.', ',')} s`);
const pct = (n) => (n == null ? '—' : `${Number(n).toFixed(1).replace('.', ',')} %`);
const msNum = (n) => `${Math.round(n).toLocaleString('es-MX')} ms`;
const estado = (ok, texto) => `<span class="badge ${ok ? 'ok' : 'fail'}">${esc(texto ?? (ok ? 'Aprobada' : 'Fallida'))}</span>`;

function resumirJest(jest) {
  const r = jest?.resultados;
  if (!r) return { ok: false, total: 0, aprobadas: 0, fallidas: 0 };
  return { ok: r.success, total: r.numTotalTests, aprobadas: r.numPassedTests, fallidas: r.numFailedTests };
}

function resumirCypress(cy) {
  const r = cy?.resultados;
  if (!r) return { ok: false, total: 0, aprobadas: 0, fallidas: 0 };
  return { ok: r.totalFailed === 0 && r.totalTests > 0, total: r.totalTests, aprobadas: r.totalPassed, fallidas: r.totalFailed };
}

function resumirJmeter(jm) {
  const s = jm?.estadisticas?.['Escanear factura'];
  if (!s) return { ok: false };
  const ok = s.errorCount === 0 && s.meanResTime <= UMBRAL_ESCANEO_MS && s.pct2ResTime <= UMBRAL_ESCANEO_MS;
  return { ok, promedio: s.meanResTime, p95: s.pct2ResTime };
}

function seccionJest(jest) {
  const r = jest?.resultados;
  if (!r) return '<p class="fail-text">Jest no produjo resultados; ver <a href="logs/jest.log">logs/jest.log</a>.</p>';

  const suites = r.testResults
    .map((suite) => {
      const archivo = path.relative(path.join(ROOT, 'server'), suite.name).split(path.sep).join('/');
      const pruebas = suite.assertionResults
        .map(
          (t) => `<tr><td>${esc([...t.ancestorTitles, t.title].join(' › '))}</td><td>${estado(t.status === 'passed')}</td>
            <td class="num">${seg(t.duration)}</td></tr>${
              t.failureMessages?.length ? `<tr><td colspan="3"><pre>${esc(t.failureMessages.join('\n').replace(ANSI, ''))}</pre></td></tr>` : ''
            }`,
        )
        .join('');
      const pasaron = suite.assertionResults.filter((t) => t.status === 'passed').length;
      return `<details${suite.status === 'passed' ? '' : ' open'}>
        <summary><code>${esc(archivo)}</code> · ${pasaron}/${suite.assertionResults.length} aprobadas · ${seg(suite.endTime - suite.startTime)}</summary>
        <table><thead><tr><th>Prueba</th><th>Estado</th><th class="num">Tiempo</th></tr></thead><tbody>${pruebas}</tbody></table>
      </details>`;
    })
    .join('');

  const cov = jest.cobertura;
  const filas = cov
    ? Object.entries(cov)
        .map(([file, m]) => {
          const nombre = file === 'total' ? '<strong>Total</strong>' : `<code>${esc(path.basename(file))}</code>`;
          return `<tr><td>${nombre}</td>${['statements', 'branches', 'functions', 'lines']
            .map((k) => `<td class="num">${pct(m[k].pct)} <span class="muted">(${m[k].covered}/${m[k].total})</span></td>`)
            .join('')}</tr>`;
        })
        .sort((a) => (a.includes('Total') ? 1 : -1))
        .join('')
    : '';

  return `
    <p>${r.numPassedTests} de ${r.numTotalTests} pruebas aprobadas en ${r.numTotalTestSuites} suites ·
      tiempo total ${seg(jest.ms)} · <a href="logs/jest.log">log</a> · <a href="jest/resultados.json">resultados JSON</a></p>
    ${suites}
    <h3>Cobertura de código</h3>
    <p class="muted">Alcance: los módulos con pruebas unitarias, <code>receiptChecks.ts</code> y <code>receiptMatching.ts</code>
      (lectura y comprobación de facturas).</p>
    <table><thead><tr><th>Archivo</th><th class="num">Sentencias</th><th class="num">Ramas</th><th class="num">Funciones</th><th class="num">Líneas</th></tr></thead>
      <tbody>${filas}</tbody></table>
    <p><a href="jest/cobertura/index.html">Informe de cobertura detallado (línea por línea)</a></p>`;
}

function seccionCypress(cy) {
  const r = cy?.resultados;
  if (!r) return '<p class="fail-text">Cypress no produjo resultados; ver <a href="logs/cypress.log">logs/cypress.log</a>.</p>';

  const specs = r.runs
    .map((run) => {
      const pruebas = run.tests
        .map((t) => {
          const nombre = t.title.at(-1);
          const error = t.displayError ? `<tr><td colspan="3"><pre>${esc(t.displayError.replace(ANSI, ''))}</pre></td></tr>` : '';
          return `<tr><td>${esc(nombre)}</td><td>${estado(t.state === 'passed', t.state === 'passed' ? 'Aprobada' : t.state === 'failed' ? 'Fallida' : 'Omitida')}</td>
            <td class="num">${seg(t.duration)}</td></tr>${error}`;
        })
        .join('');
      const capturas = run.screenshots
        .map((s) => {
          const href = rel(s.path);
          return `<a class="shot" href="${esc(href)}"><img src="${esc(href)}" alt="" loading="lazy"><span>${esc(path.basename(s.path, '.png'))}</span></a>`;
        })
        .join('');
      const video = run.video ? `<a href="${esc(rel(run.video))}">▶ Video de la ejecución</a>` : '<span class="muted">Sin video</span>';
      return `<article class="spec">
        <h3><code>${esc(run.spec.relative.split(path.sep).join('/'))}</code> ${estado(run.stats.failures === 0)}</h3>
        <p class="muted">${run.stats.passes}/${run.stats.tests} aprobadas · ${seg(run.stats.duration)} · ${video}</p>
        <table><thead><tr><th>Prueba</th><th>Estado</th><th class="num">Tiempo</th></tr></thead><tbody>${pruebas}</tbody></table>
        ${capturas ? `<div class="shots">${capturas}</div>` : ''}
      </article>`;
    })
    .join('');

  return `
    <p>${r.totalPassed} de ${r.totalTests} pruebas aprobadas · tiempo total ${seg(r.totalDuration)} ·
      navegador ${esc(r.browserName)} ${esc(r.browserVersion)} · Cypress ${esc(r.cypressVersion)} ·
      <a href="logs/cypress.log">log</a> · <a href="cypress/resultados.json">resultados JSON</a></p>
    <p class="muted">Cobertura funcional: los cinco flujos principales desde el navegador (inicio de sesión válido CP-01,
      inválido CP-02, factura válida, factura duplicada y acceso denegado a administración).</p>
    ${specs}`;
}

function seccionJmeter(jm) {
  if (!jm) {
    return '<p class="fail-text">No hay resultados de JMeter. Ejecuta <code>pnpm qa --carga</code> para incluirlos.</p>';
  }
  const filas = ['Consultar campañas', 'Escanear factura']
    .map((nombre) => {
      const s = jm.estadisticas?.[nombre];
      if (!s) return '';
      const criterio =
        nombre === 'Escanear factura'
          ? estado(s.errorCount === 0 && s.meanResTime <= UMBRAL_ESCANEO_MS && s.pct2ResTime <= UMBRAL_ESCANEO_MS, s.meanResTime <= UMBRAL_ESCANEO_MS && s.pct2ResTime <= UMBRAL_ESCANEO_MS ? 'Cumple ≤ 15 s' : 'No cumple')
          : '<span class="muted">Sin umbral</span>';
      return `<tr><td>${esc(nombre)}</td><td class="num">${s.sampleCount}</td><td class="num">${s.errorCount}</td>
        <td class="num">${msNum(s.meanResTime)}</td><td class="num">${msNum(s.pct1ResTime)}</td><td class="num"><strong>${msNum(s.pct2ResTime)}</strong></td>
        <td class="num">${msNum(s.maxResTime)}</td><td>${criterio}</td></tr>`;
    })
    .join('');

  const fecha = jm.ejecucion.replace(/^(\d{4}-\d{2}-\d{2})_(\d{2})(\d{2})(\d{2})$/, '$1 $2:$3');
  const p = jm.parametros ?? {};
  return `
    <p>${jm.nueva ? 'Ejecutada en esta suite' : `Última ejecución disponible: <strong>${esc(fecha)}</strong> (no se repitió en esta suite para no gastar escaneos; usa <code>pnpm qa --carga</code>)`}.
      ${p.usuarios ? `${p.usuarios} usuarios concurrentes` : ''}${p.escaneosPorUsuario ? ` × ${p.escaneosPorUsuario} escaneos` : ''} contra la API publicada.</p>
    <p class="muted">Criterio de aceptación: el escaneo completo tarda 15 s o menos en promedio y en el percentil 95.
      Cada escaneo usa una factura distinta y debe sumar puntos.</p>
    <table><thead><tr><th>Operación</th><th class="num">Muestras</th><th class="num">Errores</th><th class="num">Promedio</th>
      <th class="num">P90</th><th class="num">P95</th><th class="num">Máximo</th><th>Criterio</th></tr></thead><tbody>${filas}</tbody></table>
    <p><a href="jmeter/informe/index.html">Informe HTML de JMeter</a> · <a href="jmeter/resultados.jtl">resultados crudos (.jtl)</a> ·
      <a href="jmeter/jmeter.log">log de JMeter</a></p>`;
}

function arbolEvidencias() {
  const lineas = [];
  const recorrer = (carpeta, nivel) => {
    const entradas = fs.readdirSync(carpeta, { withFileTypes: true }).sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
    for (const e of entradas) {
      const full = path.join(carpeta, e.name);
      if (e.name === 'index.html' && carpeta === OUT) continue;
      // Los informes generados (cobertura, JMeter) tienen cientos de archivos: se enlaza su portada.
      const generado = ['cobertura', 'informe'].includes(e.name);
      const sangria = '&nbsp;&nbsp;'.repeat(nivel * 2);
      if (e.isDirectory()) {
        const portada = path.join(full, 'index.html');
        lineas.push(`${sangria}📁 ${generado && fs.existsSync(portada) ? `<a href="${esc(rel(portada))}">${esc(e.name)}/</a> <span class="muted">(informe generado)</span>` : `${esc(e.name)}/`}`);
        if (!generado) recorrer(full, nivel + 1);
      } else {
        lineas.push(`${sangria}📄 <a href="${esc(rel(full))}">${esc(e.name)}</a>`);
      }
    }
  };
  recorrer(OUT, 0);
  return `<div class="tree">${lineas.join('<br>')}</div>`;
}

function informe({ jest, cypress, jmeter, fin }) {
  const rj = resumirJest(jest);
  const rc = resumirCypress(cypress);
  const rm = resumirJmeter(jmeter);
  const total = jest?.cobertura?.total;
  const todoOk = rj.ok && rc.ok && rm.ok;

  const tarjeta = (titulo, ok, valor, detalle) => `<div class="card ${ok ? 'ok' : 'fail'}">
      <div class="card-title">${titulo}</div><div class="card-value">${valor}</div><div class="card-detail">${detalle}</div></div>`;

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Informe de pruebas</title>
<style>
  :root { --bg:#f6f7f9; --panel:#fff; --text:#1d2330; --muted:#5d6675; --line:#dfe3ea; --ok:#13795b; --ok-bg:#e3f4ec; --fail:#b42318; --fail-bg:#fde8e7; --accent:#2f5bd3; }
  @media (prefers-color-scheme: dark) { :root { --bg:#12151b; --panel:#1b2029; --text:#e6e9ef; --muted:#9aa3b2; --line:#2d3441; --ok:#4cc38a; --ok-bg:#16352a; --fail:#f97066; --fail-bg:#3d1d1b; --accent:#8fb0ff; } }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font:15px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width:1080px; margin:0 auto; padding:32px 16px 64px; }
  header h1 { margin:0 0 4px; font-size:26px; }
  h2 { margin:40px 0 12px; font-size:20px; border-bottom:1px solid var(--line); padding-bottom:6px; }
  h3 { font-size:16px; margin:20px 0 6px; display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
  a { color:var(--accent); }
  code { font:13px ui-monospace, Consolas, monospace; }
  .muted { color:var(--muted); }
  .verdict { margin:20px 0; padding:14px 18px; border-radius:10px; font-weight:600; }
  .verdict.ok { background:var(--ok-bg); color:var(--ok); } .verdict.fail { background:var(--fail-bg); color:var(--fail); }
  .cards { display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:12px; }
  .card { background:var(--panel); border:1px solid var(--line); border-left:4px solid; border-radius:10px; padding:14px 16px; }
  .card.ok { border-left-color:var(--ok); } .card.fail { border-left-color:var(--fail); }
  .card-title { color:var(--muted); font-size:13px; }
  .card-value { font-size:24px; font-weight:700; margin:2px 0; }
  .card-detail { font-size:13px; color:var(--muted); }
  .scroll { overflow-x:auto; margin:8px 0; border:1px solid var(--line); border-radius:8px; background:var(--panel); }
  table { width:100%; border-collapse:collapse; font-size:14px; }
  th, td { text-align:left; padding:7px 10px; border-bottom:1px solid var(--line); vertical-align:top; }
  th { font-weight:600; color:var(--muted); font-size:13px; }
  .num { text-align:right; white-space:nowrap; }
  .badge { display:inline-block; padding:1px 8px; border-radius:999px; font-size:12px; font-weight:600; white-space:nowrap; }
  .badge.ok { background:var(--ok-bg); color:var(--ok); } .badge.fail { background:var(--fail-bg); color:var(--fail); }
  .fail-text { color:var(--fail); }
  details { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:8px 12px; margin:8px 0; }
  summary { cursor:pointer; }
  pre { white-space:pre-wrap; font-size:12px; color:var(--fail); margin:0; }
  .spec { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:4px 16px 14px; margin:12px 0; }
  .shots { display:grid; grid-template-columns:repeat(auto-fill, minmax(180px, 1fr)); gap:10px; margin-top:10px; }
  .shot { display:block; text-decoration:none; color:var(--muted); font-size:12px; }
  .shot img { width:100%; height:120px; object-fit:cover; object-position:top; border:1px solid var(--line); border-radius:6px; display:block; }
  .tree { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:12px 16px; font:13px/1.8 ui-monospace, Consolas, monospace; overflow-x:auto; }
  dl { display:grid; grid-template-columns:max-content 1fr; gap:4px 16px; margin:12px 0; }
  dt { color:var(--muted); }
</style>
</head>
<body>
<main>
  <header>
    <h1>Informe de resultados de pruebas automatizadas</h1>
    <div class="muted">Plataforma OCR · ${esc(inicio.toLocaleString('es-MX', { dateStyle: 'long', timeStyle: 'short' }))}</div>
  </header>

  <div class="verdict ${todoOk ? 'ok' : 'fail'}">${todoOk ? '✔ Todas las pruebas aprobadas y el criterio de rendimiento se cumple.' : '✖ Hay pruebas fallidas o criterios sin cumplir: ver el detalle de cada sección.'}</div>

  <div class="cards">
    ${tarjeta('Unitarias · Jest', rj.ok, `${rj.aprobadas}/${rj.total}`, `${rj.fallidas} fallidas · ${seg(jest?.ms)}`)}
    ${tarjeta('Cobertura · líneas', total?.lines.pct >= 80, pct(total?.lines.pct), `Ramas ${pct(total?.branches.pct)} · funciones ${pct(total?.functions.pct)}`)}
    ${tarjeta('Extremo a extremo · Cypress', rc.ok, `${rc.aprobadas}/${rc.total}`, `${rc.fallidas} fallidas · ${seg(cypress?.ms)}`)}
    ${tarjeta('Carga · JMeter (escaneo)', rm.ok, rm.p95 != null ? `P95 ${seg(rm.p95)}` : '—', rm.promedio != null ? `Promedio ${seg(rm.promedio)} · umbral 15 s` : 'Sin resultados')}
  </div>

  <dl>
    <dt>Comando</dt><dd><code>pnpm qa${conCarga ? ' --carga' : ''}</code></dd>
    <dt>Duración total</dt><dd>${seg(fin - inicio)}</dd>
    <dt>Entorno</dt><dd>Node ${esc(process.version)} · ${esc(os.type())} ${esc(os.release())}</dd>
    <dt>Sitio y API (Cypress)</dt><dd>${SITE} · http://localhost:4000${cypress?.servidoresIniciados ? ' (iniciados por la suite)' : ''}</dd>
    <dt>API (JMeter)</dt><dd>API publicada en Cloud Run</dd>
  </dl>

  <h2>1. Pruebas unitarias (Jest)</h2>
  ${seccionJest(jest)}

  <h2>2. Pruebas de extremo a extremo (Cypress)</h2>
  ${seccionCypress(cypress)}

  <h2>3. Prueba de carga (JMeter)</h2>
  ${seccionJmeter(jmeter)}

  <h2>4. Evidencias</h2>
  <p class="muted">Todo queda en esta carpeta; los enlaces son relativos, así que se puede comprimir y entregar tal cual.</p>
  ${arbolEvidencias()}
</main>
</body>
</html>
`;
}

// ------------------------------------------------------------------ principal

const jest = await etapaJest();
const cypress = await etapaCypress();
const jmeter = await etapaJmeter();
const fin = new Date();

const index = path.join(OUT, 'index.html');
// Cada tabla va en un contenedor con desplazamiento horizontal, para pantallas angostas.
const html = informe({ jest, cypress, jmeter, fin }).replace(/<table>/g, '<div class="scroll"><table>').replace(/<\/table>/g, '</table></div>');
fs.writeFileSync(index, html);

const rj = resumirJest(jest);
const rc = resumirCypress(cypress);
const rm = resumirJmeter(jmeter);
titulo('Resumen');
console.log(`Jest     ${rj.aprobadas}/${rj.total} aprobadas · cobertura de líneas ${pct(jest?.cobertura?.total?.lines.pct)}`);
console.log(`Cypress  ${rc.aprobadas}/${rc.total} aprobadas`);
console.log(`JMeter   ${rm.promedio != null ? `escaneo: promedio ${seg(rm.promedio)}, P95 ${seg(rm.p95)} → ${rm.ok ? 'cumple' : 'NO cumple'}` : 'sin resultados'}`);
console.log(`\nInforme: ${index}`);

process.exitCode = rj.ok && rc.ok && rm.ok ? 0 : 1;
