# Basketball Manager Advanced

Simulador y gestión de baloncesto para móvil. Todo se guarda en el dispositivo; no hay servidor.

**Estado: versión 0.9.0.** Novedades de la 0.9: ligas de Francia, Italia, Alemania, Turquía y Grecia, NBA y NCAA con simulación rápida (clasificación, playoffs, campeones y estadísticas de temporada; los universitarios acaban con 22-23 años, los mejores van a la NBA por el draft y el resto sale al mercado); sueldos y presupuestos más realistas (ACB de media tabla entre 5 y 8 M€); taquilla, patrocinio y gastos que dependen de los resultados; dos ascensos y dos descensos; promesas al fichar o renovar; jugadores que piden salir; extracomunitarios sin límite en plantilla pero solo dos convocados en las competiciones españolas; informe del rival con consejos aplicables; quintetos con +/-; planes tácticos guardados (también en directo); y resumen de fin de temporada.

**Versión 0.8.0.** Novedades de la 0.8: búsqueda de jugadores por varias posiciones, rango de edad, media, atributos, arquetipo, traspaso y sueldo; cinco arquetipos nuevos; tamaños fijos en el directo y avisos flotantes para que nada salte en pantalla; puntos por cuarto en el marcador; banquillo ordenado por posición y luego por media; defensa exterior e interior al elegir emparejamientos; la caja se puede pasar a salarios; renovaciones según la edad; negociaciones en las que el jugador y el club rebajan; el verano cura las lesiones; estadísticas por temporada con el club y la trayectoria del jugador; sin WS/40; y el próximo partido arriba en Inicio.

**Versión 0.7.0.** Novedades de la 0.7: calendario con fechas reales (nunca dos partidos el mismo día) y vista de calendario; sistemas tácticos de ataque y defensa con encaje de la plantilla; ritmo; emparejamientos, negar el balón y 2 contra 1; rachas y tiempos muertos automáticos que las cortan; cansancio acumulado y minutos objetivo; roles, moral y química; objetivos de la directiva que suben o bajan el presupuesto (sin despido); bandeja de entrada; entrenamiento individual; cesiones; análisis ofensivo y defensivo y evolución de cada jugador; tácticas de la IA; caras nuevas (DiceBear) y un directo nuevo con marcador fijo, jugada animada y pestañas.

**Versión 0.6.0.** Novedades de la 0.6: tendencias por jugador (1-99) ajustables y arquetipos; tácticas de equipo separadas (plan de tiro y defensa); previa de cada partido; defensa y marcaje especial en directo; mapa de tiro por zonas al estilo NBA; mercado abierto en verano y hasta la jornada 30, negociación con contraoferta y paciencia, cláusulas de rescisión, ofertas que recibes, intercambios y traspasos entre clubes de la IA; premios de temporada, récords, historia de cada club, informe de jóvenes con ojeo y seguimiento; comparar jugadores; y muchos arreglos de manejo (se recuerda dónde estabas, nombres abreviados, mínimo dos jugadores por puesto, posición editable).

**Versión 0.5.0.** Novedades de la 0.5: cupos (mínimo 4 nacionales, máximo 2 extracomunitarios) con etiquetas NAC/COM/EXT y filtro en Jugadores; Copa del Rey; EuroLeague, EuroCup y Basketball Champions League con 36 clubes extranjeros (nombres públicos, plantillas inventadas); entrenamiento (foco e intensidad), instalaciones y ojeadores; cantera con juveniles que puedes subir; fichajes de urgencia de la IA durante la temporada; caras generadas para los jugadores inventados; y un directo más visual (pista con los tiros, evolución del marcador, cambios tocando las caras).

**Versión 0.4.0.** Novedades de la 0.4: clubes reales de la Liga ACB y la Primera FEB 2026-27 (plantillas inventadas), pestaña Jugadores con las estadísticas de toda la liga y agentes libres, mercado (fichar, comprar, vender, renovar, rescindir), contratos y finanzas, IA de los clubes en pretemporada, lesiones, moral, noticias y partido en directo con cambios, tiempos muertos y plan de tiro.

**Versión 0.3.0.** Novedades de la 0.3: Liga ACB real desde el zip de SuperManagerLab, quinteto, rotación y plan de tiro, tendencias de tiro, T2% y T1%, victorias añadidas y marcador de victorias en directo al simular.

**Versión 0.2.0 (fases 0 a 4, primera versión jugable).**

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

## Créditos y licencias de terceros

- Caras de los jugadores: [DiceBear](https://www.dicebear.com) (MIT) con los estilos Avataaars de Pablo Stanley (libre para uso personal y comercial) y Personas de Draftbit (CC BY 4.0); y [facesjs](https://github.com/zengm-games/facesjs), de ZenGM, licencia Apache-2.0.
- Base de datos: SQLite (dominio público) compilado a WebAssembly.
- Nombres de clubes: nombres públicos de los clubes reales. Sus plantillas, jugadores y estadísticas en el juego son inventados.
