# Fórmulas y decisiones del motor (v0.2)

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

PER, BPM, VORP y PIE llegan en la fase de estadísticas avanzadas.

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
