#!/usr/bin/env python3
"""Generates test receipts for the scanner, one per behaviour worth checking.

Every receipt is dated relative to --date (default: today), so the set stays
inside a running campaign however late it is regenerated. Tickets come out as
PNG, the invoice as PDF, both rendered through Microsoft Edge in headless mode,
so nothing beyond the standard library is needed.

    python samples/generate_samples.py
    python samples/generate_samples.py --date 2026-09-18 --product PARACETAMOL

samples/README.md lists what each file tests and what the scanner should answer.
"""
from __future__ import annotations

import argparse
import datetime as dt
import html
import os
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path

MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
          'septiembre', 'octubre', 'noviembre', 'diciembre']

EDGE_PATHS = [
    Path(os.environ.get('ProgramFiles(x86)', r'C:\Program Files (x86)')) / 'Microsoft/Edge/Application/msedge.exe',
    Path(os.environ.get('ProgramFiles', r'C:\Program Files')) / 'Microsoft/Edge/Application/msedge.exe',
]


@dataclass
class Item:
    qty: int
    desc: str
    price: float
    # False prints the line with no amount, the way a hand-written note would.
    priced: bool = True


@dataclass
class Ticket:
    file: str
    number: str
    date: str | None
    items: list[Item]
    # How the quantity is printed: "leading" (3 PRODUCT), "x" (PRODUCT 2 X 45.00),
    # "units" (PRODUCT 4 UN) or "below" (a "3 X 45.00" line under the item).
    style: str = 'leading'
    time: str = '11:42'
    total: bool = True
    photo: bool = False


def money(value: float) -> str:
    return f'{value:,.2f}'


def dmy(day: dt.date) -> str:
    return day.strftime('%d/%m/%Y')


# ------------------------------------------------------------------ tickets

TICKET_CSS = """
  .ticket { width: 340px; box-sizing: border-box; padding: 22px 18px; background: #fff; color: #111;
            font: 12.5px/1.45 'Courier New', Courier, monospace; }
  .c { text-align: center; }
  .t { font-weight: bold; font-size: 16px; }
  .r { display: flex; justify-content: space-between; gap: 10px; }
  .r span:last-child { white-space: nowrap; }
  .s { font-weight: bold; font-size: 14px; }
  .rule { border-top: 1px dashed #000; margin: 6px 0; }
"""


def ticket_lines(ticket: Ticket) -> list[tuple[str, str, str]]:
    lines = [
        ('t', 'FARMACIA EJEMPLO', ''),
        ('c', 'Av. Siempre Viva 123, Centro', ''),
        ('c', 'Tel. 555 123 4567', ''),
        ('rule', '', ''),
        ('r', f'TICKET: {ticket.number}', ' '.join(part for part in (ticket.date, ticket.time) if part)),
        ('r', 'CAJA: 02', 'CAJERO: ANA'),
        ('rule', '', ''),
        ('r', 'CANT DESCRIPCION' if ticket.style == 'leading' else 'DESCRIPCION', 'IMPORTE'),
        ('rule', '', ''),
    ]

    for item in ticket.items:
        amount = money(item.qty * item.price) if item.priced else ''
        if ticket.style == 'leading':
            lines.append(('r', f'{item.qty} {item.desc}', amount))
        elif ticket.style == 'x':
            lines.append(('r', f'{item.desc} {item.qty} X {money(item.price)}', amount))
        elif ticket.style == 'units':
            lines.append(('r', f'{item.desc} {item.qty} UN', amount))
        elif ticket.style == 'below':
            lines.append(('r', item.desc, ''))
            lines.append(('r', f'  {item.qty} X {money(item.price)}', amount))

    subtotal = sum(item.qty * item.price for item in ticket.items if item.priced)
    lines += [
        ('rule', '', ''),
        ('r', f'ARTICULOS: {sum(item.qty for item in ticket.items)}', ''),
        ('r', 'SUBTOTAL', money(subtotal)),
    ]
    if ticket.total:
        paid = (int(subtotal) // 100 + 1) * 100
        lines += [
            ('s', 'TOTAL', f'${money(subtotal)}'),
            ('r', 'EFECTIVO', f'${money(paid)}'),
            ('r', 'CAMBIO', f'${money(paid - subtotal)}'),
        ]
    lines += [('rule', '', ''), ('c', 'COMPROBANTE DE PRUEBA', ''), ('c', 'SIN VALOR FISCAL', '')]
    return lines


def ticket_markup(ticket: Ticket) -> str:
    rows = []
    for kind, left, right in ticket_lines(ticket):
        if kind == 'rule':
            rows.append('<div class="rule"></div>')
        elif kind in ('r', 's'):
            rows.append(f'<div class="r{" s" if kind == "s" else ""}"><span>{html.escape(left)}</span>'
                        f'<span>{html.escape(right)}</span></div>')
        else:
            rows.append(f'<div class="c{" t" if kind == "t" else ""}">{html.escape(left)}</div>')
    return '<div class="ticket">' + ''.join(rows) + '</div>'


def ticket_page(ticket: Ticket) -> str:
    if not ticket.photo:
        return (f'<!doctype html><meta charset="utf-8"><style>html,body{{margin:0;background:#fff}}{TICKET_CSS}'
                f'</style>{ticket_markup(ticket)}')

    # A phone photo: the ticket on a table, tilted, in perspective, lit unevenly.
    return f"""<!doctype html><meta charset="utf-8"><style>
  html, body {{ margin: 0; height: 100%; }}
  body {{ display: flex; align-items: center; justify-content: center;
          background: radial-gradient(ellipse at 30% 20%, #8c7b66 0%, #5f5245 60%, #463b31 100%); }}
  .shot {{ position: relative; transform: perspective(1100px) rotateX(9deg) rotateZ(-6deg);
           box-shadow: 0 24px 40px rgba(0, 0, 0, 0.45); }}
  .shot::after {{ content: ''; position: absolute; inset: 0; pointer-events: none;
                  background: linear-gradient(115deg, rgba(255,255,255,.18) 0%, rgba(0,0,0,0) 40%, rgba(0,0,0,.2) 100%); }}
  {TICKET_CSS}
</style><div class="shot">{ticket_markup(ticket)}</div>"""


# ------------------------------------------------------------------ invoice

def invoice_page(number: str, issued: dt.date, items: list[Item]) -> str:
    rows = ''.join(
        f'<tr><td class="n">{item.qty}</td><td>{html.escape(item.desc)}</td>'
        f'<td class="n">{money(item.price)}</td><td class="n">{money(item.qty * item.price)}</td></tr>'
        for item in items
    )
    total = sum(item.qty * item.price for item in items)
    issued_text = f'{issued.day} de {MONTHS[issued.month - 1]} de {issued.year}'
    return f"""<!doctype html><meta charset="utf-8"><style>
  @page {{ size: A4; margin: 18mm; }}
  body {{ font: 11pt/1.5 Arial, Helvetica, sans-serif; color: #111; margin: 0; }}
  header {{ display: flex; justify-content: space-between; gap: 24px; margin-bottom: 28px; }}
  .company b {{ font-size: 15pt; }}
  .box {{ border: 1.5px solid #111; padding: 10px 16px; min-width: 220px; }}
  .box h1 {{ margin: 0 0 6px; font-size: 18pt; letter-spacing: .08em; }}
  table {{ width: 100%; border-collapse: collapse; margin-bottom: 18px; }}
  th, td {{ padding: 8px 10px; border-bottom: 1px solid #999; text-align: left; }}
  th {{ background: #eee; font-size: 9.5pt; text-transform: uppercase; }}
  .n {{ text-align: right; white-space: nowrap; }}
  .totals {{ margin-left: auto; width: 280px; }}
  .totals div {{ display: flex; justify-content: space-between; padding: 3px 0; }}
  .totals .grand {{ border-top: 1.5px solid #111; margin-top: 4px; padding-top: 6px; font-weight: bold; font-size: 13pt; }}
  footer {{ margin-top: 40px; font-size: 9pt; color: #555; }}
</style>
<header>
  <div class="company"><b>DISTRIBUIDORA DE PRUEBA</b><br>Calle Industria 45, Zona Norte<br>Tel. 555 987 6543</div>
  <div class="box"><h1>FACTURA</h1>Folio: {html.escape(number)}<br>Fecha de emisión: {issued_text}</div>
</header>
<table>
  <thead><tr><th class="n">Cantidad</th><th>Descripción</th><th class="n">Precio unitario</th><th class="n">Importe</th></tr></thead>
  <tbody>{rows}</tbody>
</table>
<div class="totals">
  <div><span>Subtotal</span><span>{money(total)}</span></div>
  <div><span>IVA 0%</span><span>0.00</span></div>
  <div class="grand"><span>TOTAL A PAGAR</span><span>$ {money(total)}</span></div>
</div>
<footer>Documento de prueba sin validez fiscal.</footer>"""


# ---------------------------------------------------------------- rendering

def find_edge() -> Path:
    for path in EDGE_PATHS:
        if path.exists():
            return path
    found = shutil.which('msedge')
    if found:
        return Path(found)
    sys.exit('No se encontró Microsoft Edge; hace falta para convertir las muestras en imagen o PDF.')


def render(edge: Path, profile: Path, page: str, out: Path, *, size: tuple[int, int] | None, scale: float = 2) -> None:
    with tempfile.TemporaryDirectory() as tmp:
        source = Path(tmp) / 'page.html'
        source.write_text(page, encoding='utf-8')
        args = [str(edge), '--headless=new', '--disable-gpu', '--no-first-run',
                f'--user-data-dir={profile}', '--hide-scrollbars']
        if size is None:
            args += ['--no-pdf-header-footer', f'--print-to-pdf={out}']
        else:
            args += [f'--force-device-scale-factor={scale}', f'--window-size={size[0]},{size[1]}', f'--screenshot={out}']
        args.append(source.as_uri())
        subprocess.run(args, check=True, capture_output=True, timeout=120)
    if not out.exists():
        sys.exit(f'Edge no generó {out.name}.')


# -------------------------------------------------------------------- cases

def cases(today: dt.date, product: str) -> list[Ticket]:
    p = f'{product} 500MG'
    ibu, vit, gel = Item(1, 'IBUPROFENO 400MG', 58), Item(1, 'VITAMINA C 1G EFERV', 89.5), Item(1, 'GEL ANTIBACTERIAL', 42)
    yesterday = today - dt.timedelta(days=1)
    return [
        Ticket('valido-cantidad-x.png', '000501', dmy(today), [Item(2, p, 45), ibu], style='x'),
        Ticket('valido-cantidad-abajo.png', '000502', dmy(yesterday), [Item(3, p, 45), ibu, vit], style='below'),
        Ticket('valido-unidades-fecha-corta.png', '000503', yesterday.strftime('%d-%m-%y'), [Item(4, p, 45), gel],
               style='units'),
        # One letter misread (L as I): the matcher tolerates it in long names.
        Ticket('valido-error-de-lectura.png', '000504', dmy(today), [Item(2, f'{product[:-1]}I 500MG', 45), ibu]),
        Ticket('valido-foto-celular.png', '000506', dmy(today), [Item(3, p, 45), vit, gel], photo=True),
        Ticket('revisar-cantidad-grande.png', '000507', dmy(today), [Item(12, p, 45)]),
        Ticket('revisar-tope-de-unidades.png', '000508', dmy(today), [Item(60, p, 45)]),
        Ticket('rechazo-sin-total.png', '000509', dmy(today), [Item(2, p, 45), ibu], total=False),
        Ticket('rechazo-sin-fecha.png', '000510', None, [Item(2, p, 45), ibu]),
        Ticket('rechazo-fecha-futura.png', '000511', dmy(today + dt.timedelta(days=7)), [Item(2, p, 45), ibu]),
        Ticket('rechazo-sin-precio.png', '000512', dmy(today), [Item(2, p, 45, priced=False), ibu]),
        Ticket('rechazo-sin-productos.png', '000513', dmy(today), [ibu, vit, gel]),
        Ticket('rechazo-nombre-abreviado.png', '000514', dmy(today), [Item(3, f'{product[:7]} 500MG', 45), ibu]),
        # The same paper as valido-cantidad-x, photographed again: must be refused.
        Ticket('duplicado-foto-nueva.png', '000501', dmy(today), [Item(2, p, 45), ibu], style='x', photo=True),
    ]


def main() -> None:
    parser = argparse.ArgumentParser(description='Genera comprobantes de prueba para el escáner.')
    parser.add_argument('--date', type=dt.date.fromisoformat, default=dt.date.today(),
                        help='Fecha "de hoy" para las muestras (AAAA-MM-DD). Por defecto, hoy.')
    parser.add_argument('--product', default='PARACETAMOL',
                        help='Nombre del producto de la campaña, tal como está registrado.')
    parser.add_argument('--out', type=Path, default=Path(__file__).resolve().parent / 'casos',
                        help='Carpeta de salida. Por defecto, samples/casos.')
    args = parser.parse_args()

    product = args.product.strip().upper()
    args.out.mkdir(parents=True, exist_ok=True)
    edge = find_edge()

    with tempfile.TemporaryDirectory() as profile_dir:
        profile = Path(profile_dir)
        for ticket in cases(args.date, product):
            lines = len(ticket_lines(ticket))
            height = int(lines * 19 + 90)
            size = (760, height + 300) if ticket.photo else (340, height)
            render(edge, profile, ticket_page(ticket), args.out / ticket.file,
                   size=size, scale=1.6 if ticket.photo else 2)
            print(f'  {ticket.file}')

        invoice = args.out / 'valido-factura.pdf'
        render(edge, profile,
               invoice_page('F-2045', args.date - dt.timedelta(days=2),
                            [Item(6, f'{product} 500MG CAJA C/10 TABLETAS', 45),
                             Item(2, 'IBUPROFENO 400MG CAJA C/10', 58),
                             Item(1, 'ALCOHOL ETILICO 250ML', 32)]),
               invoice, size=None)
        print(f'  {invoice.name}')

    print(f'\nListo: 15 comprobantes en {args.out}, fechados alrededor del {dmy(args.date)}.')
    print('Qué debe responder el escáner con cada uno: samples/README.md')


if __name__ == '__main__':
    main()
