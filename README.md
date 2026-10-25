# Obed v okolí 🍽️

PWA aplikácia: podľa aktuálnej polohy ukáže **dnešné obedové (aj večerné) menu do 15 minút pešo**,
s jedlami, cenami, navigáciou a odkazom na web reštaurácie. Celé zadarmo, bez AI.

Web: https://menu.repka.sk

## Ako to funguje
- `data/places.json` je zoznam reštaurácií, krčiem, jedální… na Slovensku z OpenStreetMap
  (~12 000, z toho ~3 200 s webom). Vyrába ho raz za čas `tools/build-places.mjs`.
- `tools/update-menus.mjs` (GitHub Actions, pracovné dni ráno):
  1. na webe každého podniku nájde stránku s denným menu (odkazy typu „denné menu“, „obed“…),
  2. pravidlami vystrihne **dnešný** úsek (podľa dňa v týždni alebo dátumu, staré menu zahodí)
     a rozdelí ho na jedlá a ceny,
  3. kde menu nie je čitateľné (PDF, obrázok), uloží aspoň odkaz,
  4. výsledok zapíše po dlaždiciach `app/data/t/*.json` a nasadí na GitHub Pages.
- Prvý beh ráno prejde všetky weby, ďalšie dva už len tie, kde menu býva a ešte nebolo.
  V `cache/` (GitHub Actions cache) si pamätá, kde mal podnik menu naposledy.
- Aplikácia načíta len dlaždice okolo polohy a ukáže podniky do ~900 m vzdušne (15 min pešo).

## Obnova zoznamu podnikov (napr. raz za pár mesiacov)
```
curl -L -o slovakia.osm.pbf https://download.geofabrik.de/europe/slovakia-latest.osm.pbf
npm install
node tools/build-places.mjs slovakia.osm.pbf
```
a commitnúť `data/places.json`.

## Lokálne
```
node tools/update-menus.mjs                          # MENU_LIMIT=200 na rýchly test, MENU_DATE=2026-10-26 iný deň
node tools/serve.mjs                                 # http://localhost:5174
```
