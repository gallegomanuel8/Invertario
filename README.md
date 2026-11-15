# Invertario

Web sencilla para consultar fondos indexados, ETFs y planes de pensiones disponibles en plataformas españolas, y para hacer seguimiento privado de tu cartera.

## Funcionalidades

- **Catálogo**: datos de la [hoja de cálculo mantenida por la comunidad](https://docs.google.com/spreadsheets/d/1qTBkH0K5zE-e5OXsUo6Prmo2QGmYNWf63Y-iLQqdBaA). Búsqueda, filtros por tipo de activo, región/plazo y plataforma, orden por coste y rentabilidad.
- **Cripto y materias primas**: pestaña con ETN de bitcoin/ethereum, ETC de oro, plata, platino y paladio, y ETF/ETC de materias primas y petróleo. No están en la hoja comunitaria: es una lista curada en `scripts/alternatives.json` (ISIN, coste, estructura, respaldo, ticker y bolsa, verificados en justETF) que el sync añade al catálogo. El mismo archivo añade a la pestaña ETFs monetarios (€STR) e inmobiliarios (REIT), que la hoja no incluye (`curated: true`). Sin datos de plataformas. El simulador usa hipótesis propias (cripto 5 %, metales 4 %, materias primas 3 % al año; volatilidad 70 %, 16 % y 20 %).
- **Productos nuevos**: cada producto guarda la fecha en que apareció por primera vez en la hoja (`addedAt`). Se marca como «Nuevo» durante 30 días (`NEW_DAYS` en `src/data.ts`).
- **Simulador**: crea carteras simuladas con fondos del catálogo (desde su ficha o con el buscador) y proyecta su valor con interés compuesto: capital inicial, aportación mensual con subida anual, plazo, inflación, objetivo, costes reales de cada fondo e hipótesis de rentabilidad (prudente, histórica 5 años o personalizada), con escenarios favorable/desfavorable, tabla anual y exportación CSV. Se guardan solo en el navegador.
- **Mi cartera**: importa los CSV de plusvalías/minusvalías (uno por fondo, con el ISIN en el nombre del archivo). Todo se procesa y guarda en el navegador (`localStorage`); no hay backend ni se envía nada a ningún servidor.

- **Fondos no catalogados**: al importar un CSV de un fondo que no está en el catálogo, la web consulta automáticamente `GET /api/fund?isin=…` (función serverless en `api/`, que lee la ficha pública de FT.com y, si no la encuentra, OpenFIGI) para obtener nombre, categoría, gastos corrientes y tipo de activo. Solo se envía el ISIN; el resultado se guarda en el navegador. Los ETF y ETC se buscan en FT.com por su cotización en bolsa (preferiblemente en euros), así que también tienen coste y precio.
- **ISIN fuera del catálogo**: si buscas en el catálogo o en el simulador un ISIN que no está, el botón «Buscar este ISIN fuera del catálogo» lo consulta en la misma función y crea una ficha «No catalogado» (coste, categoría, domicilio) que se puede comparar y añadir al simulador. Se guarda solo en el navegador y entra en la copia de seguridad.

- **Varias carteras**: «+ Cartera» crea otra cartera independiente (pestañas, renombrar, eliminar); cada una con sus CSV. Se guardan en `invertario.portfolios.v1` (migra la cartera única anterior) y entran en la copia de seguridad.
- **Reimportar sin duplicar**: si se importan a la vez varias versiones del mismo fondo (p. ej. «… 2.csv»), se usa la más reciente (fecha del archivo, luego último lote); un CSV más antiguo que el importado se ignora. La fecha de descarga del archivo se usa como fecha de valoración del CSV.
- **Traspasos**: un fondo cuyas aportaciones (fecha fiscal e importe) reaparecen todas en otro fondo exportado después se trata como traspasado: sale de los totales y la tarjeta «Traspasos detectados» compara lo que valen hoy esos lotes en el fondo nuevo con lo que valdrían si siguieran en el de origen (su valor del CSV movido con su valor liquidativo). Botón «No es un traspaso» para descartarlo.
- **Valores actualizados**: el CSV es una foto del día en que se descargó. Al abrir Mi cartera (como mucho cada 6 h) o con «Actualizar valores», cada fondo se revalora con su valor liquidativo: `valor hoy = valor del CSV × VL actual / VL del día anterior a la importación` (`GET /api/fund?isin=…&since=AAAA-MM-DD`, datos de FT.com). Solo se envían el ISIN y esa fecha.
- **Tus datos** (botón ⇅ de la cabecera o enlace del pie): exporta todo lo guardado en el navegador (cartera, carteras simuladas, tema) a un `.json`, impórtalo en otro navegador (combinando o reemplazando) o bórralo todo, con aviso de que no se puede recuperar sin copia.

## Actualización diaria

`.github/workflows/sync-funds.yml` se ejecuta cada día (05:30 UTC) y también manualmente desde la pestaña *Actions*:

1. `scripts/sync-funds.mjs` descarga las pestañas *Fondos*, *ETFs* y *Planes pensiones* como CSV y añade los productos de `scripts/alternatives.json`.
2. Genera `src/data/funds.json`, conservando `addedAt` de los productos ya conocidos y poniendo la fecha de hoy a los nuevos.
3. Si hay cambios, hace commit y push → Vercel redespliega automáticamente.

En la primera sincronización todos los productos tienen `addedAt: null` (no se marcan como nuevos).

## Desarrollo

```bash
npm install
npm run dev     # http://localhost:5173
npm run sync    # sincroniza los datos manualmente
npm run build
```

## Despliegue en Vercel

Importa el repositorio en Vercel; detecta Vite automáticamente (build `npm run build`, salida `dist`). No requiere variables de entorno.

En GitHub, el workflow necesita permiso de escritura: *Settings → Actions → General → Workflow permissions → Read and write permissions*.
