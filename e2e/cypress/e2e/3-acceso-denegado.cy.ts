const SECCIONES_ADMIN = ['/admin/campanas', '/admin/productos', '/admin/comprobantes', '/admin/usuarios'];

describe('Acceso a administración', () => {
  it('niega a un Usuario las secciones de administración', () => {
    // Si alguna llamada a /api/admin llegara a responder 200, la prueba falla.
    cy.intercept('/api/admin/**').as('apiAdmin');
    cy.iniciarSesionComo('USR1');

    SECCIONES_ADMIN.forEach((seccion) => {
      // Como escribir la dirección en la barra: carga la página completa.
      cy.visit(seccion);
      cy.location('pathname').should('eq', '/forbidden');
      cy.contains('h1', 'No permitido').should('be.visible');
      cy.screenshot(`acceso-denegado${seccion.replace(/\//g, '-')}`);
    });

    cy.get('@apiAdmin.all').then((llamadas) => {
      const permitidas = (llamadas as unknown as { response?: { statusCode: number } }[]).filter(
        (llamada) => llamada.response?.statusCode === 200,
      );
      expect(permitidas, 'llamadas a /api/admin con respuesta 200').to.have.length(0);
    });
  });
});
