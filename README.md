# Siljesreiser

Personlig reisekart. Ren statisk nettside (HTML/CSS/JS), ingen bygg-steg.

- **Kart**: verdenskart med landegrenser. Søk etter land eller byer, og merk dem som
  «Har vært» (petroleumsgrønt land / mørkegrønn prikk) eller «Ønsker å reise»
  (cerise land / mørkerød prikk). Du kan også trykke direkte på et land eller en prikk.
- **Stats**: antall byer/steder, land og verdensdeler du har vært i og ønsker å besøke.
  Et land telles også med når du har markert en by i det.

Alt lagres i nettleseren (localStorage) på enheten du bruker. Bruk «Last ned sikkerhetskopi»
på Stats-siden for å ta vare på dataene eller flytte dem til en annen enhet.

## Kjøre lokalt

```sh
python3 -m http.server
```

Åpne http://localhost:8000.

## Data

- Landegrenser: [Natural Earth](https://www.naturalearthdata.com/) 1:50m (public domain), forenklet til `data/countries.json`.
- Bysøk: [OpenStreetMap Nominatim](https://nominatim.openstreetmap.org/).
- Kartbibliotek: [Leaflet](https://leafletjs.com/) 1.9.4 (ligger i `lib/leaflet`).
