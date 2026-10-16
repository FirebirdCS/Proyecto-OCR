import { leerEnv } from '../support/env';

const MENU_ADMIN = ['Campañas', 'Productos', 'Comprobantes', 'Usuarios'];
const MENSAJE_GENERICO = 'Esa combinación de correo y contraseña no funcionó.';

describe('Inicio de sesión', () => {
  it('CP-01 · entra con credenciales válidas (USR1 y ADM1)', () => {
    // USR1: Panel con sus campañas y el escáner, sin el menú de administración.
    cy.iniciarSesionComo('USR1');
    cy.contains('h2', 'Escanear comprobante').should('be.visible');
    cy.get('.sidebar-nav').within(() => {
      cy.contains('Panel').should('be.visible');
      MENU_ADMIN.forEach((item) => cy.contains(item).should('not.exist'));
    });
    cy.screenshot('CP-01-USR1-panel');
    cy.cerrarSesion();

    // ADM1: tablero de indicadores y el menú de administración completo.
    leerEnv(['ADM1_EMAIL', 'ADM1_PASSWORD']).then((v) => cy.ingresar(v.ADM1_EMAIL, v.ADM1_PASSWORD));
    cy.location('pathname').should('eq', '/');
    cy.get('.sidebar-nav').within(() => {
      MENU_ADMIN.forEach((item) => cy.contains(item).should('be.visible'));
    });
    cy.contains('h2', 'Unidades vendidas').should('be.visible');
    cy.screenshot('CP-01-ADM1-tablero');
    cy.cerrarSesion();
  });

  it('CP-02 · rechaza credenciales inválidas con un mensaje genérico', () => {
    cy.visitarSinSesion('/login');

    // DS1: correo de USR1 con contraseña incorrecta.
    leerEnv(['USR1_EMAIL']).then((v) => cy.ingresar(v.USR1_EMAIL, 'contrasena-incorrecta-e2e'));
    cy.contains('.error', MENSAJE_GENERICO).should('be.visible');
    cy.location('pathname').should('eq', '/login');
    cy.screenshot('CP-02-DS1-contrasena-incorrecta');

    // DS2: correo que no existe. El mensaje es exactamente el mismo que en DS1,
    // así no se puede averiguar qué correos tienen cuenta.
    cy.ingresar('noexiste@prueba.com', 'cualquier-contrasena');
    cy.contains('.error', MENSAJE_GENERICO).should('be.visible');
    cy.location('pathname').should('eq', '/login');
    cy.screenshot('CP-02-DS2-correo-inexistente');

    // DS3: correo con formato inválido. El navegador no deja enviar el formulario.
    cy.get('#login-email').clear().type('usuario@');
    cy.get('#login-password').clear().type('cualquier-contrasena');
    cy.contains('button', 'Iniciar sesión').click();
    cy.get('#login-email').then(($input) => {
      const input = $input[0] as HTMLInputElement;
      expect(input.checkValidity(), 'el correo «usuario@» es válido').to.equal(false);
      expect(input.validationMessage).not.to.equal('');
    });
    cy.location('pathname').should('eq', '/login');
    cy.screenshot('CP-02-DS3-formato-invalido');
  });
});
