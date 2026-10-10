# Comprobantes de prueba

Muestras para probar el escáner con la campaña **Farmacia** (producto
**Paracetamol**, 2 pts por unidad). Los puntos esperados de abajo suponen esa
configuración: si el producto vale otra cantidad, multiplica las unidades por
su valor.

## Generarlas

```powershell
python samples\generate_samples.py
```

Crea `samples\casos\` con 15 archivos fechados respecto a **hoy**. Si la campaña
cambia de fechas o de producto:

```powershell
python samples\generate_samples.py --date 2026-09-18 --product PARACETAMOL
```

Solo necesita Python y Microsoft Edge; no hay que instalar nada más.

Con `--limites` también crea `samples\casos\limites\` con los valores límite
del diseño de pruebas (ver «Valores límite» al final).

## Antes de escanear

- Escanea con una cuenta de rol **Usuario** que participe en la campaña.
- **Límite diario:** 20 escaneos por usuario en 24 horas, incluidos los
  rechazados. Si ya escaneaste otros hoy, usa dos cuentas o sube
  `SCAN_DAILY_LIMIT` con `scripts\deploy-api.ps1 -SkipSetup -ScanDailyLimit 50`.
- **A partir del sexto escaneo** en 24 horas (con cinco ya hechos), los comprobantes que sumen
  puntos aparecerán además como *Revisar* en Comprobantes («El usuario envió
  muchos comprobantes en 24 horas»). Es lo esperado.
- Cada comprobante válido suma **una sola vez**. Para repetir la prueba,
  vuelve a generarlas con otra fecha (`--date`), o anula el escaneo en
  Comprobantes (anular no libera el comprobante: sigue bloqueado).

## Qué debe pasar con cada uno

### Válidos (suman puntos)

| Archivo | Qué prueba | Resultado esperado |
|---|---|---|
| `valido-cantidad-x.png` | Cantidad escrita como «2 X 45.00» | 2 u → **4 pts** |
| `valido-cantidad-abajo.png` | Cantidad en una línea aparte, debajo del producto; fecha de ayer | 3 u → **6 pts** |
| `valido-unidades-fecha-corta.png` | Cantidad «4 UN» y fecha corta `dd-mm-aa` | 4 u → **8 pts** |
| `valido-error-de-lectura.png` | Nombre con una letra mal impresa («PARACETAMOI») | 2 u → **4 pts** |
| `valido-foto-celular.png` | Foto inclinada, en perspectiva y con luz desigual | 3 u → **6 pts** |
| `valido-factura.pdf` | Factura A4 en columnas, folio y fecha en palabras («16 de septiembre de 2026»), «TOTAL A PAGAR» | 6 u → **12 pts** |

### Suman, pero quedan para revisar

| Archivo | Qué prueba | Resultado esperado |
|---|---|---|
| `revisar-cantidad-grande.png` | 12 unidades en una línea | 12 u → **24 pts**, marcado *Revisar*: «Muchas unidades en una sola línea» |
| `revisar-tope-de-unidades.png` | 60 unidades, más que el máximo | Se cuentan 50 → **100 pts**, aviso de máximo de unidades y marcado *Revisar* |

### Rechazados (0 puntos)

| Archivo | Qué prueba | Resultado esperado |
|---|---|---|
| `rechazo-sin-total.png` | Solo SUBTOTAL, sin línea de TOTAL | «No encontramos el total del comprobante…» |
| `rechazo-sin-fecha.png` | Sin fecha impresa | «No pudimos leer la fecha del comprobante…» |
| `rechazo-fecha-futura.png` | Fechado dentro de una semana | «La fecha del comprobante (…) está fuera de las fechas de la campaña.» |
| `rechazo-sin-precio.png` | Paracetamol sin importe en su línea | «Estos productos no muestran su precio en el comprobante y no se contaron: Paracetamol.» |
| `rechazo-sin-productos.png` | Ningún producto de la campaña | «No encontramos productos de esta campaña en el comprobante.» |
| `rechazo-nombre-abreviado.png` | Producto abreviado («PARACET») | No se reconoce → sin productos de la campaña. Muestra por qué conviene registrar el nombre tal como sale en los tickets |

### Duplicado

| Archivo | Qué prueba | Resultado esperado |
|---|---|---|
| `duplicado-foto-nueva.png` | El mismo ticket que `valido-cantidad-x.png`, fotografiado de nuevo | **Escanéalo después** de `valido-cantidad-x.png`: «Este comprobante ya fue registrado…» |

## Cómo nombrar los productos

Probado el 2026-10-10 contra una factura FEL real de farmacia, cuyo renglón sale
del OCR partido en tres líneas:

```
DAKENX DEXKETOPROFENO 25MG X
AMPOLLA BEBIBLE
2 UN X 13.89920      Q27.80
```

| Nombre registrado | Resultado |
|---|---|
| `Dakenx Dexketoprofeno 25mg Ampolla Bebible` | 2 u ✅ (el nombre cruza el salto de línea) |
| `DAKENX DEXKETOPROFENO 25MG` | 2 u ✅ |
| `Dexketoprofeno 25mg` | 2 u ✅ |
| `Dexketoprofeno` | 2 u ✅ |
| `Dakenz Dexketoprofeno 25mg…` (una letra mal) | 2 u ✅ (tolera 1 error en nombres de 12+) |
| `Dakenx 25mg` | ❌ — las palabras tienen que ir **seguidas** tal como se imprimen |
| `Dakenx Dexketoprofeno 50mg…` | ❌ — los dígitos deben coincidir exactos (50 ≠ 25) |

En la práctica:

- **Copia el nombre como sale impreso en el ticket**, en el orden en que sale.
  No intercales ni quites palabras intermedias.
- **La dosis tiene que ser exacta.** `25mg` nunca va a casar con `50mg`; eso es
  deliberado, no un fallo.
- **Evita nombres genéricos** (`Ampolla Bebible`, `Tabletas`). Casan con casi
  cualquier renglón de la farmacia y le quitan el punto al producto correcto.
- Si dudas, pasa el comprobante por el script de diagnóstico: imprime las líneas
  tal como las reconstruye el OCR, que es lo que el matcher lee de verdad.

  ```powershell
  pnpm --filter @ocr/server exec tsx src/scripts/diagnose-receipt.ts rutal	icket.pdf "Nombre del producto"
  ```

## Regresión

```powershell
pnpm --filter @ocr/server exec tsx src/scripts/check-samples.ts samples\casos
```

Pasa los 15 archivos por Vision real y los compara con las unidades de este
documento. No escribe nada ni suma puntos. **Córrelo después de tocar
`receiptMatching.ts` o `receiptChecks.ts`.**

### Valores límite (`--limites`)

| Archivo | Qué prueba | Resultado esperado |
|---|---|---|
| `limite-linea-09.png` / `-10` / `-11` | 9, 10 y 11 unidades en una línea | 18, 20 y 22 pts; los de 10 y 11 quedan para revisar |
| `limite-tope-49.png` / `-50` / `-51` | 49, 50 y 51 unidades, en líneas de 9 como máximo | 98, 100 y 100 pts; el de 51 cuenta 50, avisa y queda para revisar |
| `tamano-10MB-menos-1B.png` | 10 485 759 bytes | Se lee (0 pts: no trae productos de la campaña) |
| `tamano-10MB-exacto.png` | 10 485 760 bytes | Según el criterio «hasta 10 MB», se lee |
| `tamano-10MB-mas-1B.png` | 10 485 761 bytes | Se rechaza por tamaño |
| `vacio.png` | 0 bytes | Se rechaza con un mensaje claro |

Los de tamaño son `rechazo-sin-productos.png` rellenado hasta el tamaño exacto,
así que se pueden repetir. Para no mezclar la marca de usuario frecuente, reparte
los seis tickets entre dos cuentas con pocos escaneos ese día.

## Muestras anteriores

`ticket-farmacia`, `ticket-fuera-de-fecha` y `nota-sin-ticket` (en esta
carpeta) son las primeras muestras, con fechas fijas de septiembre de 2026.
`ticket-farmacia` ya se usó, así que hoy dará «ya fue registrado».
