# Invertario

Web sencilla para consultar fondos indexados, ETFs y planes de pensiones disponibles en plataformas españolas, y para hacer seguimiento privado de tu cartera.

## Funcionalidades

- **Catálogo**: datos de la [hoja de cálculo mantenida por la comunidad](https://docs.google.com/spreadsheets/d/1qTBkH0K5zE-e5OXsUo6Prmo2QGmYNWf63Y-iLQqdBaA). Búsqueda, filtros por tipo de activo, región/plazo y plataforma, orden por coste y rentabilidad.
- **Productos nuevos**: cada producto guarda la fecha en que apareció por primera vez en la hoja (`addedAt`). Se marca como «Nuevo» durante 30 días (`NEW_DAYS` en `src/data.ts`).
- **Simulador**: crea carteras simuladas con fondos del catálogo (desde su ficha o con el buscador) y proyecta su valor con interés compuesto: capital inicial, aportación mensual con subida anual, plazo, inflación, objetivo, costes reales de cada fondo e hipótesis de rentabilidad (prudente, histórica 5 años o personalizada), con escenarios favorable/desfavorable, tabla anual y exportación CSV. Se guardan solo en el navegador.
- **Mi cartera**: importa los CSV de plusvalías/minusvalías (uno por fondo, con el ISIN en el nombre del archivo). Todo se procesa y guarda en el navegador (`localStorage`); no hay backend ni se envía nada a ningún servidor.

- **Fondos no catalogados**: al importar un CSV de un fondo que no está en el catálogo, la web consulta automáticamente `GET /api/fund?isin=…` (función serverless en `api/`, que lee la ficha pública de FT.com y, si no la encuentra, OpenFIGI) para obtener nombre, categoría, gastos corrientes y tipo de activo. Solo se envía el ISIN; el resultado se guarda en el navegador.

## Actualización diaria

`.github/workflows/sync-funds.yml` se ejecuta cada día (05:30 UTC) y también manualmente desde la pestaña *Actions*:

1. `scripts/sync-funds.mjs` descarga las pestañas *Fondos*, *ETFs* y *Planes pensiones* como CSV.
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
