import { leerEnv } from '../support/env';

/** Escanear lleva a Google Vision; se espera hasta un minuto y medio. */
const OCR_TIMEOUT = 90000;

describe('Carga de comprobantes', () => {
  let carpeta: string;
  let campana: string;

  before(() => {
    leerEnv(['CAMPAIGN', 'PRODUCT']).then((v) => {
      campana = v.CAMPAIGN;
      // Lote nuevo en cada ejecución: ver generarComprobantes en cypress.config.ts.
      cy.task<string>('generarComprobantes', { producto: v.PRODUCT }).then((out) => {
        carpeta = out;
      });
    });
  });

  function escanear(archivo: string) {
    cy.iniciarSesionComo('USR1');
    cy.contains('h2', 'Escanear comprobante').should('be.visible');
    cy.contains('label', 'Campaña').find('select').select(campana);
    cy.get('input[type=file]').selectFile(`${carpeta}/${archivo}`, { force: true });
  }

  it('carga una factura válida y suma puntos', () => {
    // «2 X 45.00» de Paracetamol: 2 unidades.
    escanear('valido-cantidad-x.png');

    cy.contains('.notice-ok', '¡Sumaste', { timeout: OCR_TIMEOUT })
      .should('be.visible')
      .and('contain', `«${campana}»`);
    cy.get('table tbody tr').first().find('td').eq(1).should('have.text', '2');
    cy.screenshot('carga-valida');
  });

  it('rechaza la misma factura enviada otra vez (duplicada)', () => {
    // El mismo ticket de la prueba anterior, fotografiado de nuevo.
    escanear('duplicado-foto-nueva.png');

    cy.contains('.error', 'Este comprobante ya fue registrado', { timeout: OCR_TIMEOUT }).should('be.visible');
    cy.get('.notice-ok').should('not.exist');
    cy.screenshot('carga-duplicada');
  });
});
