/**
 * Jest runs the TypeScript sources through ts-jest as CommonJS, which avoids
 * Node's experimental VM-modules flag. The sources import siblings with a
 * `.js` extension (NodeNext style); the mapper strips it so Jest finds the `.ts`.
 */
/** @type {import('jest').Config} */
export default {
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  transform: {
    '^.+\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.test.json' }],
  },
  // Cobertura de los módulos que tienen pruebas unitarias (lectura y comprobación de facturas).
  collectCoverageFrom: ['src/utils/receiptChecks.ts', 'src/utils/receiptMatching.ts'],
  moduleNameMapper: {
    '^(\.{1,2}/.*)\.js$': '$1',
  },
};
