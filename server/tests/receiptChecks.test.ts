import {
  findReceiptDates,
  findTicketNumber,
  findTime,
  findTotalCents,
  hasAmount,
  hasTotal,
} from '../src/utils/receiptChecks.js';

describe('hasAmount', () => {
  it.each([
    '135.00',
    'TOTAL $1,234.50',
    'IMPORTE 1.234,50',
    'EFECTIVO $ 99.50',
    '2 UN X 13.90 Q27.80',
    'Total: Q. 27.80',
  ])('reconoce un importe en %p', (line) => {
    expect(hasAmount(line)).toBe(true);
  });

  it.each([
    'IBUPROFENO 400MG',
    '2.000', // una cantidad con tres decimales, no un precio
    'ARTICULOS: 3',
    'PARACETAMOL12.50', // pegado a una palabra no cuenta
  ])('no confunde %p con un importe', (line) => {
    expect(hasAmount(line)).toBe(false);
  });
});

describe('findTotalCents', () => {
  it('lee el importe de la línea TOTAL en centavos', () => {
    expect(findTotalCents('SUBTOTAL 189.50\nTOTAL $189.50\nEFECTIVO $200.00')).toBe(18950);
  });

  it('ignora SUB TOTAL escrito con espacio', () => {
    expect(findTotalCents('SUB TOTAL 100.00\nTOTAL 120.00')).toBe(12000);
  });

  it('toma el último importe cuando la línea TOTAL trae varios', () => {
    expect(findTotalCents('TOTAL 3 ART 50.00 189.50')).toBe(18950);
  });

  it('busca el importe en las dos líneas siguientes si TOTAL va solo', () => {
    expect(findTotalCents('TOTAL\nQ\n27.80')).toBe(2780);
  });

  it('no mira más allá de dos líneas debajo de TOTAL', () => {
    expect(findTotalCents('TOTAL\nEFECTIVO\nCAMBIO\n10.50')).toBeNull();
  });

  it('entiende el formato con coma decimal', () => {
    expect(findTotalCents('TOTAL 1.234,50')).toBe(123450);
  });

  it('devuelve null si no hay TOTAL', () => {
    expect(findTotalCents('PARACETAMOL 500MG')).toBeNull();
  });
});

describe('hasTotal', () => {
  it('es true solo cuando hay un TOTAL con importe', () => {
    expect(hasTotal('TOTAL $45.00')).toBe(true);
    expect(hasTotal('TOTAL')).toBe(false);
    expect(hasTotal('compré PARACETAMOL')).toBe(false);
  });
});

describe('findTicketNumber', () => {
  it('lee el número de ticket', () => {
    expect(findTicketNumber('FARMACIA EJEMPLO\nTICKET: 000513\nCAJA: 02')).toBe('000513');
  });

  it('normaliza folios con letras y guiones', () => {
    expect(findTicketNumber('FOLIO A-1234')).toBe('A1234');
  });

  it('combina serie y número en facturas FEL de Guatemala', () => {
    const fel = 'FACTURA\nFARMACIA X\nSerie: 22C1EE21\nNumero: 1,428,178,504';
    expect(findTicketNumber(fel)).toBe('22C1EE211428178504');
  });

  it('usa solo el número FEL cuando la serie no se lee', () => {
    expect(findTicketNumber('FACTURA\nNúmero: 1,428,178,504')).toBe('1428178504');
  });

  it('devuelve null si no hay número', () => {
    expect(findTicketNumber('PARACETAMOL 500MG\nTOTAL 45.00')).toBeNull();
  });
});

describe('findTime', () => {
  it('lee la hora como HH:MM', () => {
    expect(findTime('18/09/2026 11:42')).toBe('11:42');
  });

  it('rellena con cero y descarta los segundos', () => {
    expect(findTime('HORA 9:05:33')).toBe('09:05');
  });

  it('rechaza horas imposibles', () => {
    expect(findTime('25:00')).toBeNull();
    expect(findTime('sin hora')).toBeNull();
  });
});

describe('findReceiptDates', () => {
  it('lee fechas con el día primero', () => {
    expect(findReceiptDates('18/09/2026 11:42')).toEqual(['2026-09-18']);
  });

  it('acepta el año con dos dígitos', () => {
    expect(findReceiptDates('18-09-26')).toEqual(['2026-09-18']);
  });

  it('prueba mes primero solo si día primero es imposible', () => {
    expect(findReceiptDates('09/15/2026')).toEqual(['2026-09-15']);
  });

  it('lee fechas ISO', () => {
    expect(findReceiptDates('2026-09-18')).toEqual(['2026-09-18']);
  });

  it('lee fechas con el mes en palabras', () => {
    expect(findReceiptDates('18 de septiembre de 2026')).toEqual(['2026-09-18']);
    expect(findReceiptDates('18-SEP-2026')).toEqual(['2026-09-18']);
    expect(findReceiptDates('12 de octubre del 2026')).toEqual(['2026-10-12']);
  });

  it('descarta fechas que no existen o fuera de rango', () => {
    expect(findReceiptDates('31/02/2026')).toEqual([]);
    expect(findReceiptDates('18/09/1999')).toEqual([]);
  });

  it('no repite la misma fecha escrita de dos formas', () => {
    expect(findReceiptDates('18/09/2026\n2026-09-18')).toEqual(['2026-09-18']);
  });
});
