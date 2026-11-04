# Short-link tram trace, 2026-11-04

At `−1136, 127`, car 46's calculated left-turn yield point is −0.5 m: it cannot advance into this connector and
wait clear of oncoming lanes. The 65 s signal cycle gives it green at 148–165 and 213–230 s. The following is sampled
once per second; R means a forecast reservation, B means the tram body overlaps the mapped conflict span (which already
has 1.5 m of padding), and the reason is the binding car-entry check. Times are simulation seconds.

| Second(s) | Car 46's blocker; tram reservations and body overlaps |
|---|---|
| 148–149 | Junction box |
| 150–153 | Tram 3 R |
| 154 | Tram 3 R, tram 20 R |
| 155–159 | Tram 20 R |
| 160–162 | Tram 20 B |
| 163–164 | Tram 3 R, tram 20 B |
| 165 | Tram 3 B, tram 20 B |
| 213–214 | Oncoming traffic |
| 215–219 | Tram 14 R |
| 220 | Oncoming traffic |
| 221–222 | Tram 14 R |
| 223–224 | Tram 14 B |
| 225–228 | Tram 14 B, tram 4 R |
| 229–230 | Tram 4 R |

Tram 3 (line 13, Starołęka PKM) reserved 149.3–154.5 s while braking for a switch and 162.4–169.9 s after
its gate cleared; its body entered at 164.3 s and cleared at 169.9 s. Tram 20 (line 5, Górczyn PKM) reserved
153.8–165.7 s, with body overlap 159.7–165.7 s. Tram 14 (line 3, Unii Lubelskiej) reserved 214.3–219.5 and
220.7–228.3 s, with body overlap 222.9–228.3 s; it was braking for a downstream queue during the first interval.
Tram 4 (line 13, Starołęka PKM) reserved 225.0–232.3 s while braking for a queue, without body overlap during that
interval. None was stationary in these reservations; a `stop` wait reason during movement means approaching a stop,
not dwelling. In addition, tram 14 forecast-reserved 167.5–170.0 s while braking for an amber/red signal 6–10 m
before the conflict. The tram's green-time reservations ahead of queue/switch gates, rather than a missing left-turn
phase, are the actionable fault. Trams 3 and 4 are the same line and direction, but their reservation start times
are not measured departures and cannot establish a headway. The simulation has no timetable; for context ZTM's
[line 13 timetable](https://www.ztm.poznan.pl/rozklad-jazdy/?data=20261027&kierunek=1&linia=13&przystanek=199)
lists ten-minute intervals in the 15:00 hour at Starołęka PKM, not a measured headway at this junction.

