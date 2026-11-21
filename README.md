# 3D Skikarte

Jedes Skigebiet in 3D – mit echter Steilheit, Routenplaner, Treffpunkt für Freunde und Wetter.

**App öffnen:** https://jason-marcus.github.io/skikarte/

## Funktionen
- Skigebiet suchen (weltweit) und in 3D auf echtem Gelände ansehen
- Pisten nach Schwierigkeit oder nach berechnetem Gefälle einfärben, Pistenprofil mit steilster Stelle
- Lifte mit animierten Kabinen und Eckdaten
- Routenplaner: Start und Ziel antippen, Schwierigkeit wählen (nur blau / bis rot / auch schwarz)
- Treffpunkt: bis zu 4 Personen, eigene Route für jeden, „fairen Treffpunkt“ finden
- Wetter für Tal und Berg mit 3-Tage-Vorschau
- Eigene Linie übers Gelände messen

## Datenquellen
- Pisten & Lifte: © OpenStreetMap-Mitwirkende (ODbL), über [OpenSkiMap](https://openskimap.org) bzw. Overpass API
- Höhendaten: Terrain Tiles (Mapzen, AWS Open Data – Quellen siehe [tilezen/joerd](https://github.com/tilezen/joerd))
- Wetter: [Open-Meteo.com](https://open-meteo.com) (CC BY 4.0)

Gefälle und Fahrzeiten sind Schätzwerte, keine offiziellen Pistenangaben.

## Aufbau
- `index.html` – die komplette App in einer Datei (läuft auch lokal per Doppelklick)
- `source/` – Quellcode (`boot.js`: Suche, Laden der Daten, Gelände, Wetter; `main.js`: 3D-Ansicht, Pisten, Lifte, Routenplaner, Treffpunkt)
- Neu bauen: im Ordner `source` `npm install`, dann `python3 build.py`
