# Basketball Manager Advanced

Simulador y gestión de baloncesto para móvil. Todo se guarda en el dispositivo; no hay servidor.

**Estado: versión 0.2.0 (fases 0 a 4, primera versión jugable).**

- Nueva partida con un universo generado: Liga ACB y Primera FEB, 36 clubes y 432 jugadores ficticios.
- Eliges club y simulas jornada a jornada, de 5 en 5, hasta los playoffs o hasta final de temporada.
- Motor posesión a posesión (reglas FIBA) con fatiga, cambios automáticos, faltas, tapones, rebotes, asistencias y tiros con coordenadas. Mismo partido con la misma semilla.
- Hoja estadística, jugada a jugada (partidos de tu equipo), mapa de tiros del partido y cuatro factores.
- Plantilla con estadísticas básicas, de tiro y avanzadas (USG%, TS%, Win Shares...). Ficha de jugador con atributos, carrera, partidos y mapa de tiro por zonas comparado con la liga.
- Clasificación, líderes, estadísticas de equipo, playoffs de la ACB (1-8, 4-5, 2-7, 3-6), historial, ascenso y descenso, y temporadas sin fin.
- Datos: exportar e importar partidas, copias internas, inspector de la base y prueba de rendimiento.

Las fórmulas y la calibración están en `FORMULAS.md`.

## Publicar en GitHub Pages (una sola vez)

1. En GitHub, crea un repositorio nuevo (por ejemplo `basketball-manager`). Público, sin añadir nada más.
2. Dentro del repositorio: **Add file > Upload files**. Arrastra TODO el contenido de esta carpeta
   (incluida la carpeta `docs`) y pulsa **Commit changes**.
3. **Settings > Pages**. En *Build and deployment* elige **Deploy from a branch**, rama **main** y carpeta **/docs**. Guarda.
4. Espera uno o dos minutos. La dirección será `https://TU-USUARIO.github.io/basketball-manager/`.

## Instalar en el móvil

1. Abre esa dirección en **Chrome** en el móvil.
2. Menú de los tres puntos > **Añadir a pantalla de inicio** > **Instalar**.
3. Ábrela desde el icono. A partir de ahí funciona sin conexión.

## Actualizar a una versión nueva

Sube los archivos nuevos encima de los anteriores (mismo paso 2). El móvil se actualiza solo la próxima
vez que abras la app con conexión. Tu partida no se toca.

## Para desarrollo

```
npm install
npm test        # pruebas automáticas
npm run build   # genera la carpeta docs/
npm run dev     # servidor local de desarrollo
```

- `src/core/` núcleo del juego en TypeScript puro (sin navegador): semillas, esquema, formato de partida.
- `src/db/` hilo de trabajo con SQLite (OPFS) y cliente de mensajes.
- `src/ui/` interfaz React.
- `docs/` la app compilada, lista para GitHub Pages.
