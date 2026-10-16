import {
  matchReceipt,
  normalizeText,
  normalizeToken,
  type MatchCandidate,
} from '../src/utils/receiptMatching.js';

const IBUPROFENO: MatchCandidate = { productId: 'ibu', name: 'Ibuprofeno 400mg' };
const VITAMINA_C: MatchCandidate = { productId: 'vitc', name: 'Vitamina C 1g Eferv' };

/** Units matched per product, which is what most assertions care about. */
function quantities(text: string, candidates: MatchCandidate[]): Record<string, number> {
  return Object.fromEntries(matchReceipt(text, candidates).map((m) => [m.productId, m.quantity]));
}

describe('normalizeToken / normalizeText', () => {
  it('quita acentos, mayúsculas y signos', () => {
    expect(normalizeToken('Café-Olé!')).toBe('cafeole');
  });

  it('normaliza un texto completo palabra por palabra', () => {
    expect(normalizeText('  Coca-Cola   600ML ')).toBe('cocacola 600ml');
  });
});

describe('matchReceipt', () => {
  it('devuelve vacío sin productos de campaña', () => {
    expect(matchReceipt('1 IBUPROFENO 400MG 58.00', [])).toEqual([]);
  });

  it('encuentra los productos del ticket de ejemplo con su cantidad', () => {
    const ticket = [
      'FARMACIA EJEMPLO',
      'CANT DESCRIPCION IMPORTE',
      '1 IBUPROFENO 400MG 58.00',
      '1 VITAMINA C 1G EFERV 89.50',
      '1 GEL ANTIBACTERIAL 42.00',
      'TOTAL $189.50',
    ].join('\n');

    const result = matchReceipt(ticket, [IBUPROFENO, VITAMINA_C]);

    expect(result).toEqual([
      { productId: 'ibu', quantity: 1, lines: [{ text: '1 IBUPROFENO 400MG 58.00', quantity: 1, priced: true }] },
      { productId: 'vitc', quantity: 1, lines: [{ text: '1 VITAMINA C 1G EFERV 89.50', quantity: 1, priced: true }] },
    ]);
  });

  describe('cantidad en la misma línea', () => {
    it.each([
      ['3 IBUPROFENO 400MG 174.00', 3],
      ['IBUPROFENO 400MG x2 116.00', 2],
      ['IBUPROFENO 400MG 2 x 58.00', 2],
      ['IBUPROFENO 400MG 58.00 x 2', 2],
      ['IBUPROFENO 400MG 3 PZAS', 3],
      ['IBUPROFENO 400MG CANT: 4', 4],
      ['2.000 x IBUPROFENO 400MG', 2],
    ])('%p cuenta %p unidades', (line, expected) => {
      expect(quantities(line, [IBUPROFENO])).toEqual({ ibu: expected });
    });

    it('no toma un precio como cantidad', () => {
      expect(quantities('IBUPROFENO 400MG 15.00', [IBUPROFENO])).toEqual({ ibu: 1 });
    });
  });

  describe('cantidad en una línea aparte', () => {
    it('la toma de la línea de abajo', () => {
      const result = matchReceipt('IBUPROFENO 400MG\n2 x 58.00\nTOTAL 116.00', [IBUPROFENO]);
      expect(result[0]).toMatchObject({ quantity: 2, lines: [{ quantity: 2, priced: true }] });
    });

    it('la toma de la línea de arriba', () => {
      expect(quantities('2 x 58.00\nIBUPROFENO 400MG', [IBUPROFENO])).toEqual({ ibu: 2 });
    });

    it('cuenta una sola unidad cuando no se sabe de qué lado va', () => {
      const ticket = '2 x 10.00\nIBUPROFENO 400MG\n3 x 10.00';
      expect(quantities(ticket, [IBUPROFENO])).toEqual({ ibu: 1 });
    });
  });

  it('suma las unidades del mismo producto en varias líneas', () => {
    const result = matchReceipt('1 IBUPROFENO 400MG 58.00\n2 IBUPROFENO 400MG 116.00', [IBUPROFENO]);
    expect(result).toHaveLength(1);
    expect(result[0]!.quantity).toBe(3);
    expect(result[0]!.lines).toHaveLength(2);
  });

  it('marca como sin precio un producto escrito sin importe', () => {
    const result = matchReceipt('IBUPROFENO 400MG', [IBUPROFENO]);
    expect(result[0]!.lines[0]).toEqual({ text: 'IBUPROFENO 400MG', quantity: 1, priced: false });
  });

  describe('coincidencia del nombre', () => {
    it('tolera un error de OCR en una letra', () => {
      expect(quantities('1 IBUPROFENQ 400MG 58.00', [IBUPROFENO])).toEqual({ ibu: 1 });
    });

    it('no confunde presentaciones con otro número', () => {
      expect(matchReceipt('1 IBUPROFENO 600MG 58.00', [IBUPROFENO])).toEqual([]);
    });

    it('ignora espacios y guiones en el nombre', () => {
      const coca = { productId: 'coca', name: 'Coca Cola' };
      expect(quantities('1 COCA-COLA 18.00', [coca])).toEqual({ coca: 1 });
    });

    it('elige el producto más específico', () => {
      const coca = { productId: 'coca', name: 'Coca Cola' };
      const zero = { productId: 'zero', name: 'Coca Cola Zero' };
      expect(quantities('1 COCA COLA ZERO 18.00', [coca, zero])).toEqual({ zero: 1 });
    });

    it('exige el SKU exacto', () => {
      const product = { productId: 'p', name: 'Producto Largo', sku: 'ABC123' };
      expect(quantities('ABC123 10.00', [product])).toEqual({ p: 1 });
      expect(matchReceipt('ABD123 10.00', [product])).toEqual([]);
    });
  });

  it('une una descripción partida en dos líneas (factura FEL)', () => {
    const dakenx = { productId: 'dak', name: 'Dakenx Dexketoprofeno 25mg x Ampolla Bebible' };
    const ticket = ['DAKENX DEXKETOPROFENO 25MG X', 'AMPOLLA BEBIBLE', '2 UN X 13.90 Q27.80'].join('\n');

    const result = matchReceipt(ticket, [dakenx]);

    expect(result).toEqual([
      { productId: 'dak', quantity: 2, lines: [{ text: 'DAKENX DEXKETOPROFENO 25MG X', quantity: 2, priced: true }] },
    ]);
  });
});
