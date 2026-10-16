/**
 * Lee variables de cypress.env.json y falla con un mensaje claro si alguna falta.
 * En Cypress 16 las variables se piden con cy.env(), así que esto es un comando encadenable.
 */
export function leerEnv<K extends string>(keys: K[]): Cypress.Chainable<Record<K, string>> {
  return cy.env(keys, { log: false }).then((values) => {
    const missing = keys.filter((key) => !values[key]);
    if (missing.length > 0) {
      throw new Error(
        `Falta ${missing.join(', ')} en e2e/cypress.env.json (copia cypress.env.example.json y complétalo).`,
      );
    }
    return values as Record<K, string>;
  });
}
