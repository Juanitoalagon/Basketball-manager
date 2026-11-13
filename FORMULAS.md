# Fórmulas y decisiones del motor (v0.5)

Todo lo que aparece en las pantallas sale de aquí. Las mismas fórmulas valen para datos reales y simulados.

## Estadísticas de jugador

| Estadística | Fórmula |
| --- | --- |
| TC% | (T2 anotados + T3 anotados) / (T2 intentados + T3 intentados) |
| eFG% | (TC anotados + 0,5 · T3 anotados) / TC intentados |
| TS% | PTS / (2 · (TC intentados + 0,44 · TL intentados)) |
| VAL (PIR) | (PTS + REB + AST + ROB + TAP + faltas recibidas) − (TC fallados + TL fallados + PÉR + tapones recibidos + faltas cometidas) |
| Posesiones usadas | TC intentados + 0,44 · TL intentados + PÉR |
| USG% | 100 · posesiones usadas · (minutos del equipo / 5) / (minutos · posesiones usadas del equipo) |
| AST% | 100 · AST / ((minutos / (minutos del equipo / 5)) · TC anotados del equipo − TC anotados propios) |
| REB% | 100 · REB · (minutos del equipo / 5) / (minutos · (REB del equipo + REB del rival)) |
| PÉR% | 100 · PÉR / posesiones usadas |

Ejemplo: 20 PTS con 15 TC intentados y 6 TL intentados → TS% = 20 / (2 · (15 + 2,64)) = 56,7 %.

## Estadísticas de equipo

Las posesiones no se estiman: el motor las cuenta (una posesión empieza cuando el equipo recibe el balón y
termina en canasta, pérdida, rebote defensivo rival o tiros libres finales; un rebote ofensivo no abre otra).

| Estadística | Fórmula |
| --- | --- |
| ORtg / DRtg | 100 · puntos anotados (recibidos) / posesiones propias (del rival) |
| Net | ORtg − DRtg |
| Ritmo | posesiones por 40 minutos |
| Four Factors | eFG%, PÉR / posesiones usadas, RO / (RO + RD del rival), TL anotados / TC intentados |

## Win Shares (versión 1)

Puntos por victoria: PPW = K · PPG_liga · (ritmo del equipo / ritmo de la liga).

- El método original de Basketball-Reference usa K = 0,32 (NBA).
- En el universo simulado se midió, con 6 temporadas, que cada victoria por encima del 50 % cuesta 0,42 · PPG puntos de diferencia. Se usa **K = 0,42** y se revisará con datos reales.
- Los umbrales de reemplazo pasan a ser (1 − K/4) en ataque y (1 + K/4) en defensa; con K = 0,32 coinciden con el 0,92 y 1,08 originales.

Ataque, dentro de cada equipo:

```
bruto_i = PTS_i + 0,5 · AST_i · (PTS_equipo / TC anotados_equipo)
PProd_i = bruto_i · PTS_equipo / Σ bruto
Pos_i   = posesiones usadas_i · Pos_equipo / Σ posesiones usadas
OWS_i   = (PProd_i − (1 − K/4) · PPP_liga · Pos_i) / PPW
```

Defensa: el total del equipo es `DWS = Pos_rival · ((1 + K/4) · PPP_liga − DRtg/100) / PPW`, repartido por minutos y
corregido por acciones defensivas por minuto (ROB + 0,7 · TAP + 0,3 · RD − 0,25 · FC) frente a la media del equipo,
con el factor limitado entre 0,4 y 1,6.

Consecuencia comprobada por una prueba automática: OWS + DWS de cada equipo queda cerca de sus victorias
(en la prueba, error medio por debajo de 2,5 victorias en 34 partidos).

## Victorias añadidas (VA)

Victorias que aporta un jugador por encima de un suplente de nivel mínimo (reemplazo) en sus mismos minutos.
Un equipo entero de reemplazo ganaría el 20 % de sus partidos, así que:

```
VA_i = WS_i − 0,20 · partidos del equipo · (segundos del jugador / segundos de jugador del equipo)
```

PER, BPM, VORP y PIE llegan en la fase de estadísticas avanzadas.

## Órdenes del entrenador

- Quinteto: el titular elegido para un puesto sale de inicio y tiene preferencia en ese puesto (+6 de valor al decidir cambios).
- Rotación: «pocos minutos» resta 9 de valor; «fuera» resta 80 (solo juega si no queda nadie).
- Plan de tiro del equipo y libertad de tiro por jugador: «más» multiplica por 1,6 la frecuencia, «menos» por 0,55.
  Forzar empeora el acierto: logit − 0,18 · ln(multiplicador) (con «más» ≈ −8 % relativo; con «menos» ≈ +11 %).

## Importación desde SuperManagerLab

Los ficheros traen, por jugador y partido, minutos y valoración (más puntos SuperManager, precio y predicción).
No traen tiros, rebotes ni asistencias, ni edad ni altura. El nivel de cada jugador real se estima así:

```
ritmo  = (valoración + 300 · 0,8 · media del grupo de posición) / (minutos + 300)   [temporada anterior con peso 0,5]
nivel  = 59 + 7,5 · (0,6 · z(ritmo) + 0,4 · z(minutos por partido)), entre 38 y 86
```

Después se generan sus atributos para su posición y se ajustan hasta que su media coincide con ese nivel.
Atributos, posición concreta, edad, altura y peso quedan marcados como estimados. El cupo (nacional, comunitario,
extracomunitario) es real; el país no se inventa. Las estadísticas reales se guardan en su propia tabla.

## Motor de partido

Cada probabilidad tiene la forma `P = sigmoide(logit(base) + β · (ataque − defensa) / 20 + contexto)`.
Con ataque igual a defensa sale la media de la liga. Las constantes están en `src/core/engine.ts` (objeto `TUNE`).

Contextos: tiro tras pase, transición, campo propio, triple de esquina, bocina, rebote y canasta, sangre fría en
los dos últimos minutos igualados, fatiga, forma del día (según consistencia), tiempo de la basura y regresión del
marcador (quien va por delante baja algo la intensidad; sin ella los marcadores salían demasiado dispersos).

Calibración provisional (objetivos aproximados de la liga española, por equipo y partido; se sustituirán por los
calculados con datos reales):

| Medida | Objetivo | Simulado (1.500 partidos) |
| --- | --- | --- |
| Puntos | 76–86 | 82,9 |
| Posesiones | 69–76 | 72,0 |
| T2% | 51–56 % | 52,4 % |
| T3% | 33–38 % | 34,4 % |
| TL% | 72–79 % | 76,8 % |
| Triples / TC | 36–45 % | 39,8 % |
| TL / TC | 0,22–0,33 | 0,28 |
| Pérdidas | 11–14,5 | 12,7 |
| Rebote ofensivo % | 26–33 % | 28,3 % |
| Asistencias | 15–19,5 | 16,5 |
| Robos | 5,5–8,5 | 7,5 |
| Tapones | 1,8–3,5 | 2,0 |
| Faltas | 18–23 | 19,0 |
| Victorias locales | 54–66 % | 58,7 % |
| Minutos del más usado | 28–34 | 32,1 |

## Mapas de tiro

Media pista FIBA en decímetros con el origen en el aro: triple a 6,75 m y 6,60 m en las esquinas, zona de 4,90 m,
semicírculo restringido de 1,25 m. 14 zonas. Cada tiro guarda sus coordenadas redondeadas y la zona se calcula
sobre esas mismas coordenadas, así que el mapa, la tabla por zonas y la hoja estadística cuentan los mismos tiros.

## Universo generado

36 clubes ficticios (18 en la Liga ACB y 18 en la Primera FEB) con 12 jugadores inventados cada uno. Atributos de
1 a 99 a partir de un nivel por jugador, un perfil por posición y un estilo propio aleatorio. Evolución anual,
retiradas y cantera son provisionales (la fase 10 las sustituirá). Asciende el primero de la FEB y desciende el
último de la ACB.


## Mercado y economía (v0.4)

- **Sueldo de mercado** por media: 50.000 € · e^(0,085 · (media − 45)) → 45: 50 mil €, 60: 180 mil €, 70: 420 mil €, 80: 980 mil €.
- **Lo que pide un jugador**: ese sueldo con su media (si tiene menos de 25 años, media + 40 % de lo que le falta hasta su potencial estimado),
  ×0,8 con 32-33 años, ×0,6 con 34 o más, ×1,1 si está descontento (moral < 40).
- **Valor de traspaso**: lo que pediría × factor de edad (3 hasta 21 años, 2,5 hasta 24, 2 hasta 27, 1,5 hasta 30, 0,9 hasta 32, 0,4 después)
  × 0,5 si su contrato acaba esta temporada y × 0,8 si acaba la siguiente.
- **Comprar**: el club vendedor acepta desde el valor de mercado (+30 % si es uno de sus 3 mejores) y si se queda con al menos 11 jugadores;
  el jugador acepta desde el 95 % de lo que pide. El traspaso sale de la caja; el sueldo debe caber en el presupuesto salarial.
- **Vender**: pujan los clubes con caja, presupuesto y sitio en la plantilla para los que el jugador estaría entre sus 9 mejores;
  ofrecen entre el 72 % y el 112 % de su valor.
- **Rescindir**: la mitad de lo que le queda de contrato.
- **Renovar**: solo en el último año; se suman los años nuevos.
- **Plantillas**: entre 10 y 16 jugadores.
- **Cuentas al acabar la temporada**: caja += presupuesto − sueldos pagados + premios (título ACB 800 mil €, FEB 250 mil €,
  finalista 300 mil €, playoffs 150 mil €). El presupuesto siguiente sube con los premios y baja un 10 % si la caja queda en negativo.
- **Pretemporada de la IA**: renueva a quien está entre sus 7 mejores, tiene 33 años o menos y cabe en el presupuesto; el resto queda
  libre. Después completa hasta 12 jugadores con los mejores agentes libres que pueda pagar. Cada verano llegan 24 agentes libres nuevos.

## Lesiones y moral

- **Lesión**: por partido, 1,5 % · (minutos / 30) · (1,25 − resistencia / 200). Gravedad de 1 a 34 partidos de baja
  (de «molestias musculares» a «rotura de ligamento»). En verano se recuperan 12 partidos.
- **Moral** (0-100): +3 al ganar, −3 al perder, ±2 según los minutos que juega frente a los que espera por su nivel en el club,
  y vuelve un 5 % hacia 70 en cada partido. En el motor suma o resta hasta 1,5 puntos de atributo.

## Partido en directo

El motor simula el partido completo con tus órdenes y la pantalla lo muestra posesión a posesión. Una orden nueva
(cambio, tiempo muerto, plan de tiro, cambios automáticos) se aplica al empezar la posesión actual y el resto se vuelve
a simular: lo ya jugado es idéntico porque la secuencia aleatoria no cambia hasta ese punto (lo comprueba una prueba).
Un tiempo muerto devuelve un 7 % de energía a los cinco en pista. Al guardar, el partido se graba con las mismas órdenes,
así que el resultado guardado es el que has visto.

## Cupos (v0.5)
- Cupo por nacionalidad: **NAC** = España; **COM** = Unión Europea y asimilados (FR, IT, LT, DE, GR, SI, HR, PT, Senegal y Nigeria por el acuerdo de Cotonú; «UE» en jugadores reales importados); **EXT** = el resto.
- Regla simplificada para los clubes españoles: **mínimo 4 nacionales y máximo 2 extracomunitarios** con contrato.
- Se comprueba al fichar, comprar, vender, despedir y subir canteranos. La IA también la respeta (en pretemporada busca nacionales si le faltan).
- Las plantillas generadas se corrigen al crearlas (se cambia la nacionalidad y el nombre de los que sobran). Los clubes extranjeros no tienen cupo.

## Calendario y competiciones (v0.5)
Un «día» del calendario es una semana.
- **Liga**: días 1-34 (jornadas). Playoffs ACB desde el día 35.
- **Copa del Rey**: los 8 primeros de la ACB tras la jornada 17. Cuartos día 18 (1-8, 4-5, 2-7, 3-6), semis día 19, final día 20. Partido único en casa del mejor clasificado.
- **Europa** (EuroLeague, EuroCup, Basketball Champions League): 16 equipos cada una (4 españoles + 12 extranjeros), dos grupos de 8 equilibrados por nivel, doble vuelta en los días pares 2-28. Los 4 primeros de cada grupo: cuartos A1-B4, B2-A3, B1-A4, A2-B3 y después semis y final, a partido único.
- Plazas españolas: licencias fijas de EuroLeague (Real Madrid, Barça, Baskonia, Valencia; en un universo importado, los 4 de más reputación); los 4 siguientes de la última ACB a la EuroCup y los 4 siguientes a la BCL.
- Los 36 clubes extranjeros llevan nombres públicos reales, pero **sus plantillas son inventadas** (la mitad con jugadores del país del club).
- Premios (título / final): ACB 800/300 mil €, FEB 250 mil, Copa 400/150 mil, EuroLeague 1,5 M/600 mil, EuroCup 600/250 mil, BCL 500/200 mil.

## Entrenamiento, instalaciones y ojeadores (v0.5)
- Cada verano, además de la evolución natural: con foco, +1,5 (≤ 24 años), +0,8 (25-29) o +0,3 (30+) en los atributos del foco; con «equilibrado», 0,4·(base/1,5) en todos los atributos ofensivos, defensivos y físicos.
- Todo × intensidad (suave 0,7 · normal 1 · duro 1,4) × (1 + 0,15·(instalaciones − 3)). Los decimales se redondean al azar (0,4 → 40 % de +1).
- Intensidad durante la temporada: lesiones ×0,8 / ×1 / ×1,3 y moral +0,2 / 0 / −0,4 por partido.
- Mejoras: instalaciones 500 mil € × nivel actual; ojeadores 150 mil € × nivel actual; máximo 5.

## Cantera (v0.5)
- Cada club español recibe juveniles de 16-17 años cada verano (3 el tuyo, 2 los demás). Calidad 40-48 (ACB) o 36-44 (FEB); potencial = media + 14-32 y un 8 % de «joyas» con +10.
- **Potencial estimado** = potencial + (u1 + u2 − 1)·(9,5 − 1,5·ojeadores): ±8 puntos con ojeadores de nivel 1, ±2 con nivel 5.
- Subir a un juvenil: contrato de formación de 30 mil € por 4 temporadas. A los 19 años, si no ha subido, se marcha (la IA sube a los suyos con potencial estimado ≥ 60 si tiene sitio).

## IA durante la temporada (v0.5)
- Cada 4 días, un club con menos de 10 jugadores sanos y menos de 16 en plantilla ficha al mejor agente libre que pueda pagar y le quepa en el cupo.

## Caras (v0.5)
- Generadas con facesjs (Apache-2.0) usando como semilla el id del jugador: siempre la misma cara y no ocupa sitio en la partida.
- Tono de piel orientado por la nacionalidad; a partir de 31 años, canas progresivas y algunas entradas; los menores de 22, menos barba. La camiseta lleva los colores del club.
- Los jugadores reales importados no llevan cara inventada: se muestra su dorsal.
