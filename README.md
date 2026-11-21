# 3D Skikarte

Jedes Skigebiet in 3D – mit echter Steilheit, Routenplaner, Treffpunkt für Freunde und Wetter.

**App öffnen:** https://jason-marcus.github.io/skikarte/

## Funktionen
- Skigebiet suchen (weltweit) und in 3D auf echtem Gelände ansehen – mit Schnee, Wald unterhalb der Baumgrenze und präparierten Pisten
- Pisten nach Schwierigkeit oder nach berechnetem Gefälle einfärben, Pistennummern auf der Karte, Pistenprofil mit steilster Stelle
- Lifte als 3D-Modelle je Typ (Gondel, Sessel, Pendelbahn, Schlepplift) mit Stützen, Stationen und fahrenden Kabinen
- Routenplaner: Start und Ziel antippen oder eigenen Standort nehmen, Schwierigkeit wählen (nur blau / bis rot / auch schwarz), Schritte antippen zum Hinfliegen
- Navigation mit GPS: mitfahrende 3D-Ansicht mit Abbiege-Hinweisen, Neuberechnung bei Abweichung, Vorschau-Modus zum Ausprobieren zu Hause
- Treffpunkt: bis zu 4 Personen, eigene Route für jeden, „fairen Treffpunkt“ finden
- Offline: geladene Skigebiete werden gespeichert und funktionieren ohne Internet („Meine Skigebiete“)
- Wetter für Tal und Berg mit 3-Tage-Vorschau
- Eigene Linie übers Gelände messen

## Datenquellen
- Pisten & Lifte: © OpenStreetMap-Mitwirkende (ODbL), über [OpenSkiMap](https://openskimap.org) bzw. Overpass API
- Höhendaten: Terrain Tiles (Mapzen, AWS Open Data – Quellen siehe [tilezen/joerd](https://github.com/tilezen/joerd))
- Wetter: [Open-Meteo.com](https://open-meteo.com) (CC BY 4.0)

Gefälle und Fahrzeiten sind Schätzwerte, keine offiziellen Pistenangaben.

## Aufbau
- `index.html` – die komplette App in einer Datei (läuft auch lokal per Doppelklick)
- `sw.js` – Service Worker, damit die App auch ohne Netz startet
- `source/` – Quellcode (`boot.js`: Suche, Laden der Daten, Gelände, Wetter; `main.js`: 3D-Ansicht, Pisten, Lifte, Routenplaner, Treffpunkt)
- Neu bauen: im Ordner `source` `npm install`, dann `python3 build.py`
