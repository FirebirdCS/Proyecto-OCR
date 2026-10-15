"""CP-17/CP-18 inputs: the 0-point receipt padded to exact byte sizes.

Usage: python samples/generate_cp17_cp18.py
The padding is a private PNG chunk / PDF comments, so the files stay valid.
"""
import struct, sys, zlib, re
from pathlib import Path
from PIL import Image

here = Path(__file__).parent
src = here / "casos" / "scrum57" / "compatibilidad"
out = here / "casos" / "cp17-cp18"
out.mkdir(exist_ok=True)
MB = 1024 * 1024

def png_of_size(target, name):
    data = (src / "rechazo-sin-productos.png").read_bytes()
    iend = data.rindex(b"IEND") - 4          # start of the IEND chunk (length field)
    pad_len = target - len(data) - 12        # 12 = length + type + crc of the new chunk
    ctype = b"paDd"                          # private ancillary chunk: decoders skip it
    body = b"\0" * pad_len
    chunk = struct.pack(">I", pad_len) + ctype + body + struct.pack(">I", zlib.crc32(ctype + body))
    blob = data[:iend] + chunk + data[iend:]
    assert len(blob) == target
    (out / name).write_bytes(blob)
    Image.open(out / name).load()            # still a valid PNG

def pdf_of_size(target, name):
    data = (src / "rechazo-sin-productos.pdf").read_bytes()
    sx = re.findall(rb"startxref\s+(\d+)", data)[-1]
    tail = b"\nstartxref\n" + sx + b"\n%%EOF\n"
    room = target - len(data) - len(tail)
    line = b"%" + b"0" * 98 + b"\n"          # PDF comment lines
    pad = line * (room // len(line))
    pad += b"%" + b"0" * (room - len(pad) - 2) + b"\n" if room - len(pad) >= 2 else b"\n" * (room - len(pad))
    blob = data + pad + tail
    assert len(blob) == target, (len(blob), target)
    (out / name).write_bytes(blob)

png_of_size(int(9.9 * MB), "cp18-ds1-9.9MB.png")
png_of_size(10 * MB, "cp18-limite-exacto-10MB.png")
png_of_size(10 * MB + 1024, "cp18-ds2-10MB-mas-1KB.png")
pdf_of_size(15 * MB, "cp18-ds3-15MB.pdf")
Image.open(src / "rechazo-sin-productos.png").convert("RGB").save(out / "cp17-factura.gif")
for f in sorted(out.iterdir()): print(f.name, f.stat().st_size)
