# Deporclub Dashboard — Copa de Natación

Dashboard web para visualizar los resultados de la Copa de Natación. Muestra podios por categoría, tabla completa de resultados, filtros y buscador.

## Archivos del proyecto

| Archivo | Descripción |
|---|---|
| `index.html` | Dashboard web responsive |
| `styles.css` | Estilos del dashboard |
| `app.js` | Lógica de filtros, búsqueda y podios |
| `records.json` | Datos extraídos del PDF en formato estructurado |
| `data.js` | Datos embebidos como constante JS (generado desde records.json) |
| `pdf-usados/` | PDFs ya procesados — solo local, no sube a git |
| `pdf-nuevos/` | PDFs nuevos a procesar — solo local, no sube a git |

## Cómo usar

Abrir `index.html` directamente en el navegador. **No requiere servidor.**

---

## Actualizar con una nueva fecha

1. Colocar el nuevo PDF en la carpeta `pdf-nuevos/`
2. Extraer los datos al `records.json` (acumulando con los anteriores)
3. Regenerar `data.js` ejecutando en la terminal:
   ```bash
   node -e "const fs=require('fs'); const j=fs.readFileSync('records.json','utf8'); fs.writeFileSync('data.js','const RECORDS = '+j+';\n');"
   ```
4. Mover el PDF procesado a `pdf-usados/`
5. Abrir `index.html` — el dashboard se actualiza automáticamente
