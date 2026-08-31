# QB Labores — PWA móvil + Google Sheets

App de reporte de labores en campo (celular/tablet), offline-first, sincronización a Google Sheets vía Apps Script.

## Publicar el front (HTTPS)

1. Sube el repo a Netlify (o cualquier host HTTPS estático).
2. Asegura que `config.js` tenga `API_URL` (Web App de Apps Script) y `API_TOKEN`.
3. Abre `https://tu-dominio/form.html` en el celular.

## Deploy de `code.gs`

1. Abre el Spreadsheet → Extensiones → Apps Script.
2. Pega el contenido de `code.gs` (y actualiza token / IDs si aplica).
3. Ejecuta una vez `setupSheets()` (o la función de encabezados del proyecto) desde el editor.
4. Implementar → Nueva implementación → Tipo **Aplicación web**:
   - Ejecutar como: **Yo**
   - Quién tiene acceso: **Cualquiera**
5. Copia la URL `/exec` a `QB_CONFIG.API_URL` en `config.js`.

## Instalar en Android

1. Chrome → menú → **Instalar app** / **Añadir a la pantalla de inicio**.
2. O usa la tarjeta de instalación dentro de `form.html` si aparece.

En PC de escritorio la app muestra bloqueo (“usa el celular”); no basta con achicar la ventana.

## Offline + sync — cómo probar

1. Llena un reporte y toca **Guardar** con modo avión / sin Wi‑Fi.
2. Debe quedar **pendiente** (cola local) y verse en Recientes.
3. Reactiva la red: la cola se reenvía sola (`online`) o al volver a la app.
4. Reintentar el mismo `localId` no crea otra fila (`duplicate: true` en el servidor).

## Notas de producto

- Cada guardado lleva un `localId` (UUID). El servidor lo marca **después** de escribir en la hoja.
- Labores: upsert por lote/semana/labor (actualiza el avance del mapa), no un historial infinito de filas.
- Historial en el celular: TTL ~48 h para enviados; pendientes y cola no se borran al limpiar borrador.
