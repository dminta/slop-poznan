# Fara north-front gable finial evidence & geometry note, 2026-11-15

Evidence check and geometry update for the 40.0 m finial atop the north-front gable of the Poznań Fara (*Bazylika kolegiacka Matki Bożej Nieustającej Pomocy, św. Marii Magdaleny i św. Stanisława Biskupa*, ul. Świętosławska / Gołębia 1a) in [`js/landmarks-heritage.js`](../../js/landmarks-heritage.js).

## Sources

1. **Wikimedia Commons — `File:20230614 ScheWo Poznań view to parish church.jpg`**
   - URL: https://commons.wikimedia.org/wiki/File:20230614_ScheWo_Pozna%C5%84_view_to_parish_church.jpg (4032 × 3024 px, 2023-06-14)
   - Shows a straight-on street-level view down ul. Świętosławska. The arched central cornice of the north gable (above the gilded IHS gloria relief) is crowned directly by a dark patinated metal Latin/budded cross — the same dark metal tone as the flanking tower helms — with **no tall stone pedestal or obelisk**. A small flared gilt base collar sits directly on the arched cornice apex; the cross has a dark shaft and crossbar, a gilt central medallion/sunburst at the crossing, and gilt trefoil/budded end-knobs on the top, left, and right arm tips.
   - Measured pixel proportions against the `19.4 m` upper-storey wall (`~1030 px` → `~53 px/m`): cross height `105 px` (`~2.0–2.2 m`, consistent with the `40.0 m` total height above the `37.8 m` gable apex), crossbar span `81 px` (`~1.53–1.65 m`, `~0.77×` height), shaft width `10 px` (`~0.19 m`), crossbar centre `~37%` down from the top (`~63%` up from the base), central boss and arm-tip knobs `~20–22 px` (`~0.38–0.40 m`), base collar `~21 px` wide × `~6 px` tall (`~0.40 × 0.12 m`).
2. **Wikimedia Commons — `File:Fara Poznan Fasada.jpg`**
   - URL: https://commons.wikimedia.org/wiki/File:Fara_Poznan_Fasada.jpg (960 × 1280 px)
   - Confirms the same cross profile directly on the arched gable crown, with a small base collar, central crossing boss, and budded arm tips.
3. **Zabytek.pl — Kościół jezuitów, ob. farny pw. św. Marii Magdaleny i św. Stanisława Biskupa**
   - URL: https://zabytek.pl/pl/obiekty/poznan-kosciol-jezuitow-ob-farny-pw-sw-marii-magdaleny-i-sw-717013 (register no. A-149)
   - Identifies the monument and its baroque north facade at ul. Świętosławska / Gołębia 1a.
4. **Archidiecezja Poznańska**
   - URL: https://archpoznan.pl
   - Describes Bartłomiej Nataniel Wąsowski's baroque north facade, the IHS monogram in the central gable, and the cross crowning the gable.
5. **Height calibration**
   - [`landmark-heights-2026-11-03.md`](landmark-heights-2026-11-03.md) and [`landmark-heights-2026-11-15.md`](landmark-heights-2026-11-15.md): north front cornice `33.0 m`, gable apex `37.8 m`, cross top `40.0 m` (`2.2 m` cross height; 1 m GUGiK lidar grid reads `39.0–39.2 m` on the thin cross).

## Model update

- Replaced the `1 × 2.2 × 1 m` `M.sandstone` post at `F.frontUpper + 4.8` (`37.8 m`) in `buildFara` (`js/landmarks-heritage.js`) with a 2.2 m dark-metal Latin cross (`M.darkMetal` shaft `0.18 × 2.04 × 0.14 m` and crossbar `1.56 × 0.16 × 0.14 m` centred at `63%` height) on a small gilt base collar (`0.42 × 0.12 × 0.26 m`), with a gilt crossing boss (`0.34 × 0.34 × 0.18 m`) and gilt budded arm-end knobs (`0.26 × 0.16 × 0.16 m` top, `0.16 × 0.26 × 0.16 m` sides) using `nicheMaterials.gold`.
- Preserves the `40.0 m` total height (`F.top`), existing colliders, and draws with **0 new draw calls** (both `M.darkMetal` and `nicheMaterials.gold` batch into existing meshes).
