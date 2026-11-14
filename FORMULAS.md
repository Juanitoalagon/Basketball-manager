# Fórmulas y decisiones del motor (v0.6)

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
  × factor de edad (desde la v0.8: 1 hasta los 30 y −9 % por año a partir de ahí; ver «Economía y negociación»), ×1,1 si está descontento (moral < 40).
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

## Caras (v0.5, v0.7)
- Desde la 0.7 se elige el estilo en Datos: DiceBear Avataaars (por defecto), DiceBear Personas o facesjs. Mismo id → misma cara.
- Generadas (estilo clásico) con facesjs (Apache-2.0) usando como semilla el id del jugador: siempre la misma cara y no ocupa sitio en la partida.
- Tono de piel orientado por la nacionalidad; a partir de 31 años, canas progresivas y algunas entradas; los menores de 22, menos barba. La camiseta lleva los colores del club.
- Los jugadores reales importados no llevan cara inventada: se muestra su dorsal.

## Arquetipos (v0.6)
Cada arquetipo mira unos atributos clave; su nota es la media de esos atributos (algunos cuentan doble) y se queda el que más supera su umbral. Se muestran el principal y, si lo hay, un segundo.
- Anotador (creación, tiro de 2, penetración, finalización, tiro de 3) ≥ 63 · Tirador (tiro de 3 ×2, sin balón, libres) ≥ 66 · 3&D (tiro de 3 y defensa exterior ≥ 63) ≥ 65 · Director (pase, visión, manejo, IQ) ≥ 66 · Penetrador (penetración, finalización, velocidad, agilidad) ≥ 66 · Defensor (defensa exterior, robo, anticipación, agilidad, bloqueos) ≥ 65 · Protector del aro (tapón, intimidación, defensa interior, salto; 2,02 m o más, +0,4 por cm sobre 2,06) ≥ 66 · Reboteador ≥ 64 · Poste bajo (SF/PF/C) ≥ 66 · Pívot abierto (PF/C con tiro) ≥ 57 · Todoterreno ≥ 60 sin ningún punto débil (defensa, tiro y pase ≥ 52).
- Si no llega a ningún umbral: «Jugador de rol».

## Tendencias de jugador (v0.6)
Diez tendencias de 1 a 99: toques, tiro de 3, media distancia, penetración, poste, pase, esfuerzo defensivo, robos, tapones y rebote ofensivo.
- **Natural** = 50 + (nota del motor − centro) × escala, con la misma nota que usa el motor para esa acción (centro 55 y escala 1,6 en toques; centro 50 y escala 1,2 en el resto). Quien tira bien de tres tiene tendencia alta a tirar de tres.
- **Ajuste**: el motor suma (ajustada − natural) / escala a la nota que decide **cuánto** se hace cada cosa, no **lo bien** que se hace. Sin ajuste, el partido es idéntico al de antes.
- Toques: peso para ser quien acaba la posesión, e^(0,075·(uso − 55)). Tipos de tiro: e^(0,055·(nota − 50)) por tipo.
- Forzar cuesta: cada unidad de log(multiplicador) por encima de lo natural resta 0,18 en logit al acierto (y restringir lo sube).
- Esfuerzo defensivo: +defensa exterior e interior, y gasto de energía × (1 + ajuste/150) y algo más de faltas. Robos: más robos y pérdidas rivales, más faltas. Tapones: más tapones, más faltas en el tiro. Rebote ofensivo: más rebotes ofensivos, el rival sale más a la contra.

## Defensa de equipo (v0.6)
- Intensidad: conservadora (pérdidas rivales −0,22 logit, faltas ×0,85, cansancio ×0,93, acierto rival −0,03) · normal · presión (pérdidas +0,28, faltas ×1,25, cansancio ×1,12, acierto rival +0,05 cuando supera la presión).
- Prioridad: cerrar la pintura (el rival busca aro ×0,82, pintura ×0,85 y triple ×1,12; acierta −0,15 dentro y +0,08 de tres) o salir a tiradores (al revés: aro ×1,12, triple ×0,85; −0,12 de tres y +0,1 dentro).
- Marcaje especial (solo en directo): el elegido recibe un 40 % menos de balones y tira con −0,22 logit; el resto del rival, +0,04.

## Mercado (v0.6)
- **Mercado de traspasos**: abierto en verano y durante la liga regular hasta jugar la jornada 31, como en la ACB, donde se puede fichar hasta poco antes de los playoffs. Después, cerrado hasta el verano. Los agentes libres se pueden fichar siempre, salvo en playoffs. Ofertas de la IA por tus jugadores: 45 % de probabilidad diaria en verano y 16 % durante la temporada. La paciencia de las negociaciones se renueva tras la jornada 17.
- **Lo que pide un jugador para firmar contigo** = pide · moral · cláusula / (atractivo del club · encaje de años).
  - Atractivo = 1 + (reputación − 70)/200, + 0,06 si juegas EuroLeague, + 0,03 EuroCup, + 0,02 BCL.
  - Encaje de años = 1 − 0,05 × |años ofrecidos − preferidos|; prefiere 4 años con menos de 24, 3 hasta los 28, 2 hasta los 32 y 1 después.
  - Moral menor de 40: pide un 12 % más. Cláusula baja (menos de 1,5 veces su valor): pide un 4 % menos; muy alta (más de 4 veces): un 6 % más.
- **Paciencia**: empieza en 100 %. Cada oferta rechazada resta 20 (si te quedas a menos del 10 %), 30 (del 10 al 25 %) o 45 (más del 25 %). A 0, no vuelve a negociar contigo esa temporada. El club vendedor tiene su propia paciencia.
- **Club vendedor**: quiere su valor (× 1,3 si es de sus 3 mejores, × 1,05 si le quedan 2 o más años). Si pagas la cláusula, no puede negarse.
- **Cláusulas**: los contratos de la IA llevan una de 2,4 a 4 veces el valor del jugador. En los tuyos la eliges tú.
- **Ofertas que recibes**: en ventana, los clubes con dinero y sitio pujan por jugadores tuyos que entrarían en su rotación (80-115 % de su valor) y caducan en 3 días. Puedes aceptar, rechazar o pedir más una vez. Si tu jugador tiene una cláusula baja (≤ 2,2 veces su valor) y un club puede pagarla, a veces la pagan sin preguntar.
- **Intercambios**: el otro club valora a cada jugador que le das por su valor completo si entraría entre sus 8 mejores y por el 60 % si no; suma el dinero y lo compara con lo que pide por el suyo (+5 %).
- La IA también se traspasa jugadores entre sí y cubre en verano los puestos donde tiene menos de dos jugadores.

## Premios (v0.6)
Liga ACB y Primera FEB, fase regular, mínimo la mitad de los partidos y de los minutos posibles.
- MVP: VA + 0,12 × valoración por partido + 0,05 × victorias del equipo. Quinteto ideal: los mejores de esa puntuación en 2 exteriores (PG/SG), 2 aleros o ala-pívots y 1 pívot.
- Mejor joven (≤ 22 años) y sexto hombre (titular en menos de la mitad de sus partidos): por VA. Mejor defensor: DWS + 0,8 × (robos + tapones por partido) + 0,15 × rebotes defensivos por partido. Más mejorado: subida de media respecto al año anterior (+ 0,1 × VA para desempatar).
- MVP de la final: el jugador del campeón con más valoración sumada en la serie final (ACB) o en el partido final (Copa y Europa).

## Ojeo y canteras ajenas (v0.6)
- Ojear cuesta 25 mil €: el potencial estimado pasa a tener un error de ±2 como mucho (o menos con buenos ojeadores) y el jugador entra en tu seguimiento.
- En verano puedes llevarte a un juvenil de otra cantera pagando una compensación por formación = 40 mil € + 12 mil € por cada punto de potencial estimado por encima de 55 (máximo 8 juveniles en tu cantera).

## Calendario con fechas (v0.7)
- Liga: un partido por semana, los sábados, desde el primer sábado de octubre (34 jornadas).
- Europa: miércoles de las semanas impares 1-27 (14 jornadas); cruces en las semanas 30, 32 y 33. Copa del Rey: jueves, sábado y domingo de la semana siguiente a la jornada 17. Playoffs: un partido cada 2 días.
- Ningún club juega dos veces en la misma fecha (lo comprueba un test). Las partidas antiguas se recolocan respetando el orden.
- Mercado abierto en verano y hasta la jornada 30 de liga.

## Sistemas tácticos (v0.7)
- 8 sistemas de ataque y 8 de defensa. Cada uno cambia a qué zonas se tira, el acierto, pérdidas, asistencias, rebote ofensivo, desgaste y duración de la posesión.
- Algunos cruces tienen efecto propio (tabla VS). Por ejemplo, el Pick & Roll contra Drop da +0,06 de logit en media distancia, y el Pick & Pop contra Drop +0,08 en triples.
- Encaje: media de las valoraciones que pide el sistema en los cinco de pista (por ejemplo, Motion = 0,5·pase + 0,25·IQ + 0,25·juego sin balón).
- Bonificación = clamp(0,012·(encaje − centro), ±0,12) en logit. El centro de cada sistema es la media medida en las plantillas ACB, para que un equipo normal no gane ni pierda nada.
- Ritmo: lento = posesiones ×1,14 de duración y 0,7 de transición; rápido = ×0,88 y 1,35 de transición.
- IA: elige el sistema que mejor encaja (con algo de azar) y el ritmo según velocidad y resistencia de sus 8 primeros. Lo revisa cada 6 días.

## Emparejamientos, negar y 2 contra 1 (v0.7)
- Por defecto, tu mejor defensor exterior (o interior, si el rival es un pívot) defiende a su mayor peligro; el resto, por puesto. Los cambios manuales se guardan y se refrescan en cada fase de la posesión.
- Negar el balón: el marcado recibe ×0,62 tiros y ×0,5 balones, tira con −0,08 y su defensor se cansa ×1,2.
- 2x1: ×0,45 tiros y ×0,6 balones, −0,32 en su acierto y +0,25 de pérdidas si la tiene él. Sus compañeros tiran con +0,10 y el pasador doblado reparte ×1,8.
- La IA en el descanso niega al jugador que lleve 13 puntos o más, y le hace 2x1 si lleva 20 o más.

## Rachas y tiempos muertos (v0.7)
- Racha = puntos seguidos sin respuesta. Con 7 o más, el equipo en racha tira con +0,06 y el rival pierde más balones (+0,06).
- Tiempo muerto (FIBA 2 en la 1ª parte, 3 en la 2ª, 1 por prórroga): corta la racha rival, da +0,07 de energía a los de pista y +0,04 de concentración durante 6 posesiones.
- Automático: el ayudante lo pide si el rival hace el parcial que elijas (6-0 a 12-0) o si tus cinco están fundidos. La IA lo pide con 9-0.

## Cansancio acumulado y minutos (v0.7)
- Tras cada partido, cansancio += minutos·0,0073 (30 min ≈ 0,22). Se recupera ×0,72 por cada día sin jugar.
- Energía al empezar = 1 − 0,22·cansancio; desgaste en pista ×(1 + 0,25·cansancio). Riesgo de lesión ×(1 + 1,2·cansancio).
- Minutos objetivo: si pones X minutos a un jugador, el entrenador lo mete cuando va por debajo de X·(tiempo jugado/40) y lo sienta cuando va por encima. Con 0 minutos no juega salvo emergencia.
- Desarrollo por minutos (≤23 años): con ≥20 min por partido, +1 en 3 atributos de su puesto; con <6, −1 en 2.

## Roles, moral y química (v0.7)
- Rol esperado según su puesto en la plantilla por media: estrella (30 min), titular (25), rotación (17), suplente (9) o reserva (3). Los de 21 años o menos esperan un escalón menos.
- Moral tras cada partido: ±2,5 por el resultado (la mitad fuera del top 8), más clamp((min. recientes − esperados)/5, −2,2, +1,2), más (química − 50)/50. Luego vuelve un 5 % hacia 68.
- Química (15-95) = 50 + 30·(continuidad del top 8 − 0,5) + 0,35·(moral media − 65) + min(10, partidos/3).
- En el partido, la química da ±0,05 de logit en acierto y quita pérdidas en la misma medida.

## Directiva y presupuestos (v0.7)
- Objetivo según el presupuesto dentro de la liga. ACB: título (2 primeros), playoffs (3-8), mitad alta (9-13), salvación (resto). FEB: ascenso, top 6 o mitad.
- Al final: superado +12 % de presupuesto, cumplido +5 %, fallado −8 %. La confianza sube o baja, pero nunca te despiden.
- Presupuesto de la IA: también aplica su resultado y una reinversión de caja, con el factor limitado entre 0,82 y 1,22.

## Entrenamiento individual (v0.7)
- Plazas = 2 + nivel de instalaciones (cantera incluida). Planes: un atributo, un grupo, un arquetipo o un nuevo puesto (este se añade como segunda posición).
- Puntos extra por temporada = 7 (≤19 años), 6 (≤21), 4 (≤24), 2,5 (≤28) o 1, por la intensidad del entrenamiento. Se reparten entre los atributos del plan; un solo atributo recibe el 70 %.

## Cesiones (v0.7)
- Solo con el mercado abierto. Puedes ceder a jóvenes a clubes ACB o FEB, que pagan parte del sueldo. Allí juegan los minutos que les dé su rol y vuelven al acabar la temporada, o antes si los repescas.
- Pedir cedido: su club no cede a nadie de su top 8, ni si se queda con 11 o menos jugadores. Debes pagar al menos el 50 % del sueldo.
- Los cedidos no se pueden vender, renovar ni traspasar mientras dure la cesión.

## Economía y negociación (v0.8)
- Sueldo pedido: factor de edad = 1 hasta los 30 años y luego 1 − 0,09·(edad − 30), con un mínimo de 0,35. Por ejemplo, 0,73 a los 33 y 0,55 a los 35. Al renovar se calcula con la edad que tendrá al empezar el contrato nuevo. En los menores de 25 cuenta el 40 % de lo que le falta para llegar a su potencial.
- Regateo: si a la oferta le falta un 30 % o menos, la otra parte cede: cesión += 0,35·lo que falta + 2 %. Hay un tope:
  - Jugador: 10 % (12 % si está contento; 18 % con 32 años o más), y 3 puntos más si es una renovación.
  - Club vendedor: 15 % (8 % si es uno de sus 3 mejores).
- Si la oferta ofende (falta más de un 30 %), no cede nada y la paciencia baja 40. Si no, baja 14 o 22 según lo lejos que esté la oferta.
- Caja a salarios: puedes pasar dinero de la caja al presupuesto salarial de la temporada en curso, y devolver lo que no estés usando. Al cerrar la temporada, lo que sobra del presupuesto vuelve a la caja. El presupuesto nuevo se calcula desde el presupuesto base, sin lo que añadiste.
- Lesiones: al terminar la temporada, el verano resta 40 partidos de baja a cada lesión, lo que cura casi todas.

## Arquetipos nuevos (v0.8)
- Pívot pasador: media de pase, visión, IQ y poste ≥ 52, solo para PF o C y con pase ≥ 50.
- Tirador de media: media de 2× tiro de dos, creación y consistencia ≥ 62, con tiro de dos ≥ 64.
- Atleta: media de velocidad, salto, agilidad y resistencia ≥ 64.
- Líder: media de liderazgo, experiencia, IQ y disciplina ≥ 62, con liderazgo ≥ 64.
- Cerrador: media de 2× sangre fría, creación y tiros libres ≥ 63, con sangre fría ≥ 66.

## Cambios en directo (v0.8)
- Al elegir a quién cambiar, el banquillo sale ordenado así: primero los que juegan en su posición (principal o secundaria), por su media en ese puesto; luego el resto, por media.

## Ligas de otros países: simulación rápida (v0.9)
- **Ligas:**
  - Francia, Italia, Alemania, Turquía y Grecia: los clubes que juegan en Europa más otros de su país.
  - NBA: 30 equipos.
  - NCAA: 16 universidades de las más conocidas.
  - Nombres públicos y plantillas inventadas. En Europa, la mitad de cada plantilla es del país; en la NBA, el 72 %; en la NCAA, la mitad son de EE. UU. y el resto de fuera, también españoles.
- **Fechas:**
  - Las ligas europeas juegan en los sábados de la ACB (Europa va en miércoles): ningún club juega dos veces el mismo día.
  - La NBA juega de mediados de octubre a mediados de abril, y la NCAA de noviembre a principios de marzo.
  - Todas se juegan a doble vuelta (la NBA, 58 partidos) y luego tienen playoffs: los 8 primeros (16 en la NBA, al mejor de 7). La NCAA hace un cuadro a partido único.
- **Nivel de un equipo:** media ponderada de la media de sus 9 mejores jugadores sanos, con peso 1 para los cinco primeros y 0,7, 0,55, 0,4 y 0,3 para los cuatro siguientes.
- **Resultado:**
  - diferencia = 1,1·(nivel local − nivel visitante) + factor cancha (3; 2,5 en la NBA; 3,5 en la NCAA) + azar (desviación ≈ 11).
  - total de puntos = 2·media de la liga + azar (≈ 11).
  - Si empatan, se juega prórroga de 5 a 12 puntos por equipo.
- **Estadísticas:**
  - Minutos según el orden por media (32, 30, 29, 27, 25, 20, 16, 12 y 9 por cada 40, escalados a 200 o 240).
  - Los puntos del equipo se reparten con un peso de minutos·e^(0,035·(ataque − 60)).
  - Rebotes, asistencias, robos y tapones se reparten igual con sus atributos.
  - Se guarda el total de la temporada, no cada partido: no hay hoja de partido.
- **NCAA → NBA:**
  - En verano dejan la universidad los de 23 años, los de 21-22 con media 64 o más y los de 20 con 69 o más.
  - Los de media 58 o más entran en la NBA por un draft de dos rondas, en el que eligen primero los peores.
  - El resto sale al mercado como agente libre: los puede fichar cualquiera, también tú.
  - Los universitarios no tienen contrato ni se pueden fichar ni ceder mientras están en la NCAA.
- **Salir de la NBA:** para irse a otra liga, un jugador de la NBA pide ×1,6 de sueldo.

## Economía (v0.9)
- **Sueldo de mercado:** 72.000 € · e^(0,11·(media − 45)). Son unos 210.000 € con 55 de media, 1,1 M€ con 70, 3,4 M€ con 80 y 10 M€ con 90. Las partidas antiguas se convierten solas, contrato a contrato.
- **Presupuestos:** masa salarial × (1,04-1,14) al crear la partida. La ACB de media tabla queda en 5-8 M€ y los grandes en 11-14 M€.
- **Taquilla** (en cada partido en casa): B · 0,0095 · ocupación / 0,7 · fase.
  - ocupación = 0,5 + 0,2·(reputación − 60)/30 + 0,35·(% victorias − 0,5) + 0,05·(reputación rival − 60)/30, entre 0,3 y 1.
  - fase: playoffs ×1,4, cruces europeos ×1,5, Europa ×1,1. En la Copa, ×0,6 para cada club.
- **Patrocinio:** B · (0,06 + 0,10 · % de victorias). **Gastos fijos:** B · 0,26.
- **Presupuesto siguiente:** B · (1 + 0,5·(taquilla + patrocinio + premios − gastos)/B + objetivo + reinversión), entre ×0,82 y ×1,25. B es el presupuesto base, sin la caja pasada a salarios.
- **Ascensos y descensos:** suben los 2 primeros de la Primera FEB y bajan los 2 últimos de la ACB.
  - El recién ascendido recibe al menos el 85 % del presupuesto más bajo de la ACB.
  - El que baja pierde el 40 % del suyo.

## Promesas, peticiones de salida y extracomunitarios (v0.9)
- **Promesas:** prometer un papel rebaja lo que pide el jugador. Titular (25 min) −10 %, rotación (17 min) −5 %, o unos minutos concretos (−10 % con 25 o más, −5 % con 17 o más, −2 % con 10 o más).
  - Tras cada partido se miran sus minutos de los 5 últimos: si juega 4 o más por debajo de lo prometido, suma un aviso y pierde 3 de moral.
  - Con 5 avisos la promesa se rompe: −15 de moral, pide salir y ya no se cree tus promesas.
- **Peticiones de salida:** el jugador pide salir tras 8 partidos seguidos con la moral por debajo de 35, o al romperle una promesa. Mientras tanto rinde 3 puntos menos en todos sus atributos.
  - Ponerlo en venta: le llegan más ofertas, un 10 % más baratas.
  - Prometerle minutos.
  - Hablar con él: sale bien con probabilidad 0,35 + liderazgo/200 + moral/300, una vez cada 6 días.
- **Extracomunitarios:** puedes tener los que quieras en plantilla, pero en ACB, Primera FEB y Copa solo se convocan dos por partido.
  - Primero los titulares del Quinteto; después, los de más media. Los marcados «fuera» son los últimos.
  - En Europa se convocan todos. La IA no pasa de tres.

## Informe del rival, quintetos y planes (v0.9)
- **Informe del rival:**
  - Peligro: su máximo anotador por partido (o el de más media, si aún no ha jugado).
  - Emparejamiento: tu mejor defensor sobre él, de entre tus 8 de más media. Si es exterior, por 0,7·defensa exterior + 0,3·agilidad; si es interior, por 0,6·defensa interior + 0,4·tapón.
  - Negarle el balón si promedia 15 puntos o más; 2 contra 1 si promedia 20 o más.
  - Prioridad: salir a tiradores si tira de tres 4 puntos más que la liga; cerrar la pintura si tira 4 menos.
  - Sistema defensivo: el que más suma entre el encaje con tu plantilla y su efecto contra el ataque rival.
- **Quintetos:** minutos, puntos a favor y en contra de cada combinación de cinco jugadores en tus partidos completos. +/- por 40 = (a favor − en contra) · 2400 / segundos juntos. En «Mejores» y «Peores» solo cuentan los de 10 minutos o más.
- **Planes guardados:** hasta 3. Guardan ataque, ritmo, plan de tiro, defensa y tiempos muertos, pero no los emparejamientos, que dependen del rival.
