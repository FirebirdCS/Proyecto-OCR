/**
 * Comandos compartidos. Las pruebas son de caja negra: solo usan lo que ve una
 * persona en el navegador (textos, campos y botones), nunca la API directa.
 */

import { leerEnv } from './env';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Cypress {
    interface Chainable {
      /** Abre una página del sitio sin ninguna sesión guardada. */
      visitarSinSesion(path: string): Chainable<void>;
      /** Llena el formulario de acceso y lo envía. */
      ingresar(email: string, password: string): Chainable<void>;
      /** Inicia sesión con una cuenta de prueba ('USR1' o 'ADM1') y espera al Panel. */
      iniciarSesionComo(cuenta: 'USR1' | 'ADM1'): Chainable<void>;
      /** Cierra la sesión desde el menú de usuario. */
      cerrarSesion(): Chainable<void>;
    }
  }
}

Cypress.Commands.add('visitarSinSesion', (path: string) => {
  cy.visit(path, {
    // Firebase guarda la sesión en IndexedDB, que Cypress no borra entre pruebas.
    // Se elimina antes de que cargue la aplicación, así ninguna prueba hereda la anterior.
    onBeforeLoad(win) {
      win.indexedDB.deleteDatabase('firebaseLocalStorageDb');
    },
  });
});

Cypress.Commands.add('ingresar', (email: string, password: string) => {
  cy.get('#login-email').clear().type(email);
  cy.get('#login-password').clear().type(password, { log: false });
  cy.contains('button', 'Iniciar sesión').click();
});

Cypress.Commands.add('iniciarSesionComo', (cuenta: 'USR1' | 'ADM1') => {
  leerEnv([`${cuenta}_EMAIL`, `${cuenta}_PASSWORD`]).then((v) => {
    cy.visitarSinSesion('/login');
    cy.ingresar(v[`${cuenta}_EMAIL`], v[`${cuenta}_PASSWORD`]);
  });
  cy.location('pathname').should('eq', '/');
  cy.get('[aria-label="Menú de usuario"]').should('be.visible');
});

Cypress.Commands.add('cerrarSesion', () => {
  cy.get('[aria-label="Menú de usuario"]').click();
  cy.contains('button', 'Cerrar sesión').click();
  cy.location('pathname').should('eq', '/login');
});
