# CLAUDE.md

Project context for future Claude sessions. Pas dit aan als architectuur of conventies veranderen.

## Wat is dit

Een drag-and-drop geografie quiz. Sleep landnamen vanuit de tray op de juiste positie op de kaart. Hosted op GitHub Pages onder `/geography/`. Hoofdtaal: Nederlands.

## Stack

- **Vite + React 19 + TypeScript** (strict)
- **d3-geo, d3-zoom, d3-selection, d3-transition, topojson-client** voor map rendering en interactie
- **world-atlas** (50m resolution) voor wereldlandgeometrie
- **us-atlas** (states-albers-10m) voor VS-staten, pre-projected Albers via `geoIdentity()`
- **i18n-iso-countries** voor Nederlandse landnamen (alias-vorm)
- **countries-list** voor continent-classificatie
- **Custom GeoJSON in `src/data/`** voor NL/BE/DE/FR/ES/CN regio's (gedownload van click_that_hood, cartomap, Eurostat NUTS, isellsoap)
- **GitHub Actions** workflow (`.github/workflows/deploy.yml`) publiceert naar Pages bij push naar main
- **Vite `base: '/geography/'`** voor de Pages subpath

## Belangrijke architectuur

### Modes

Een `GameMode` (zie `src/data/modes.ts`) beschrijft een speel-set:
- `id`, `label`, `category: 'continent' | 'region'`
- `countries: Country[]` (te plaatsen items met `iso` en Dutch `name`)
- `markers: Record<iso, [lon, lat]>` voor losse drop-points (zeeën etc.)
- `createProjection`, optionele `fitBbox`, `excludeFromMap`, `interaction: 'pan' | 'rotate'`
- `sourceFeatures?` voor regio-modi met eigen TopoJSON/GeoJSON (overschrijft `countryFeatures`)

**Continent-modi** renderen de hele wereld; landen die NIET in `mode.countries` zitten krijgen `country--fixed` (lichtgroen) en geen `data-iso` zodat ze niet interactief zijn. Helpt bij oriëntatie zonder dat ze meetellen voor de quiz.

**Regio-modi** renderen alleen de eigen `sourceFeatures` (NL provincies, VS staten, etc.).

### Data-cleaning (modes.ts)

- **Corrupte sub-polygonen filteren**: d3-geo heeft een bug bij degenerate polygonen die een sphere-spanning sub-polygoon produceert. Detectie: kleine geo-bbox (<1° in beide dimensies) maar projected bbox ≥100px. Maldives heeft zo'n polygoon op iso 462.
- **Australia (036)** komt twee keer voor in world-atlas (mainland + territorium): dedupe via `Set` op `featureIsos`.
- **Kosovo** krijgt synthetische id `XK` (geen officiële ISO numeric) zodat 'ie als gewoon land werkt.
- **Vaticaanstad (336)** is in 50m data 0.78 km² maar render-grootte sub-pixel. Polygon-coördinaten worden 3× geschaald rond centroïde (`VATICAN_SCALE`).
- **Onbekende features** (Somaliland, N. Cyprus, Indian Ocean Ter., Siachen Glacier) krijgen geen `data-iso` → beige, niet-interactief, geen "groen" als fixed-placed.
- **Render-volgorde**: features sorteren op afnemende bbox-grootte zodat microstaten boven Italië/etc. komen.

### Map rendering (`MapView.tsx`)

- SVG-based, `viewBox="0 0 1000 760"`, schaalt naar container.
- Path-elementen gememoized met `useMemo` op `[features, placed, fixedPlaced]` → re-render alleen bij echte verandering, niet bij elke zoom-event.
- `vector-effect="non-scaling-stroke"` op country paths zodat lijnen 0.7px blijven ongeacht zoom.
- `will-change: transform` op `.map__zoomable` voor GPU-compositing.
- **Label-grootte**: `font-size = min(2px, 16/k)` (SVG-units). Tot zoom 8× groeit visuele grootte lineair tot 16px, daarna stagneert.
- **Wrap horizontal**: continent/world-modi renderen 3 kopieën van de feature-group (`offset × worldWidthPx`); `translateExtent` is verbreed tot `[-worldWidthPx, 2×worldWidthPx]`. Region-modi: 1 kopie.
- **Zoom-extent**: `[1, 500]`. Initial fit via `fitExtent` op de mode's countries (of `mode.fitBbox` als gezet, voor Globe = `Sphere`).
- **Imperative handle** (`forwardRef + useImperativeHandle`) exposeert `isCountryVisible`, `zoomToCountry`, `resetZoom`. Centroïde wordt berekend op de **grootste sub-polygoon** (voor MultiPolygons als Kiribati, Russia, USA waarvan de gemiddelde centroïde op rare plekken landt). Ook werkt het voor seas-modi door eerst de marker-positie te checken.
- Voor wrap-modi probeert `zoomToCountry` de kopie van het land dat het dichtst bij het huidige view-center ligt te kiezen.

### Score-systeem

- Start: `score = 0`, `multiplier = 1`
- **Goed land**: `score += multiplier`, `multiplier += 1` (of `+2` als het de bovenste label is — krijgt een `+2`-badge)
- **Fout land**: `multiplier = max(1, multiplier - 1)`, geen score-verandering, rode shake
- **Label → hulp-zone (zoom-hulp)**: `multiplier = max(1, multiplier - 1)`, zoom in op land (of resetZoom als off-screen, blauwe pulse)
- **Hulp → land (antwoord onthullen)**: `multiplier = 1`, `placed[iso] = name`, zoom op land
- **Drop op niet-land** (tray, zee, fixed country, eigen label): cancel, geen penalty
- Score-uitleg wordt zichtbaar onder de Top 10 lijst.

### Highscores (localStorage)

- Key `geography-test:highscores`: lijst van `{name, score, duration?, mode, date}`
- Key `geography-test:lastName`: laatst gebruikte naam (auto-fill)
- Schrijven alleen bij phase = 'complete' (game over). "Stop" knop forceert complete.
- Sorteren op score desc; bij gelijke score op `duration` asc (snelste eerst). Oude entries zonder `duration` krijgen fallback van **3600 sec (1 uur)**.

### Phases

1. **start**: naam-input, Start-knop, Top 10 + uitleg
2. **playing**: map + tray + topbar
3. **complete**: score + Top 10 (eigen entry gehighlighted), "Nieuw spel" knop

Mode-switch tijdens spelen reset het spel. Vanuit complete-screen springt mode-switch terug naar start.

### Help-zone

- Gele dashed box bovenin de tray, sticky boven de scroll-list (niet binnen `.tray__inner`).
- Werkt twee kanten op via `data-help-target="true"` + drag-handle:
  - Drop label erop = zoom-help
  - Sleep hem zelf naar een land = antwoord onthullen (`HELP_DRAG_LABEL` = `{iso:'__help__', name:'Hulp'}`)

## Mobiel (responsive ≤720px)

- **Layout**: 1-kolom grid, tray onder map met `max-height: 40dvh`
- **Topbar**: titel verhuist naar het menu; hamburger knop opent menu (slide-down panel). Scores/timer/multiplier blijven inline zichtbaar.
- **Label 75/25 split**: links 75% is `label__drag` (`touch-action: none`, pointer-handlers), rechts 25% is `label__scroll` (`touch-action: pan-y`, lichtgrijze vlak met ↕ icoon en gestreepte linker-rand om visueel duidelijk te maken).
- **Hulp-zone**: zelfde 75/25 split, scroll-zone in oranje variant.
- **Drag-aim offset**: op touch staat de aim-dot + ghost-label **88px boven de vinger**. Hit-test wordt op die offset-positie gedaan. Op desktop/pen: offset 0 (cursor zelf is het mikpunt).
- **`100dvh` ipv `100vh`** voor app-hoogte + tray max-height — past zich aan op de actuele zichtbare viewport (URL-bar en home-indicator).
- **`env(safe-area-inset-bottom)`** padding op `.tray__inner` voor iOS home-indicator.
- **`overscroll-behavior: contain`** voorkomt pull-to-refresh in de map.
- Cursor wordt verborgen tijdens drag (`cursor: none`); harmless op touch, voorkomt verwarrende muiscursor op desktop.

## Files map

```
src/
  App.tsx              # Phases, drag-state, score-logic, highscores, hamburger menu
  App.css              # All styling; media query (≤720px) onderaan om specificity-volgorde te respecteren
  components/
    MapView.tsx        # SVG map, projection, zoom, wrap, imperative handle
    LabelTray.tsx      # Label list, drag handle, help-zone (drag source + drop target)
  data/
    modes.ts           # GameMode definitions, feature cleaning, name overrides
    nl-provinces.topojson.json
    belgium-provinces.json
    germany-states.json
    france-regions.json
    spain-communities.json
    china-provinces.json
.github/workflows/deploy.yml   # Build + deploy to Pages
vite.config.ts         # base: '/geography/'
```

## Conventies die in deze codebase gelden

- **Nederlandse naamgeving** voor user-facing strings, English voor code.
- **Geen co-authored-by trailer** in commits (zie globale CLAUDE.md).
- **Geen emojis** in code/comments tenzij expliciet gevraagd.
- Drag-en-drop interactie via pointer events (niet HTML5 DnD) i.v.m. SVG-transform support.
- `data-iso` attribute op interactieve country-paths en sea-markers is de "drop-target identifier"; hit-test via `document.elementFromPoint(x, y).getAttribute('data-iso')`.
- Feature IDs: `String(f.id)`; padIso pad numeric strings tot 3 chars (`'8' → '008'`), strings als `'XK'` of `'PV20'` blijven onveranderd.

## Bekende open punten

- Frankrijk-regio's data is ~2.5MB en bevat de oude 22-regio's indeling (pre-2016 hervorming). Vervangen door een 13-regio bestand zou de bundle verkleinen.
- Performance van wrap-rendering: 3 kopieën × 250 features op continent-modi. Werkt vlot maar zou kunnen schalen.
- Globe-modus (geoOrthographic + rotate) is in de codebase aanwezig maar wordt door geen enkele mode gebruikt — kan later teruggehaald worden.
- Help-zone sleep heeft 75/25 split nu ook op desktop, drag-zone is 75% breed. Misschien revert naar 100% op desktop.

## Workflow voor wijzigingen

1. Werk op een feature-branch (zoals `mobile-support`), test lokaal via `npm run dev` (port 5174).
2. Commits direct naar main pushen na review/test; CI verifieert build, deploy naar Pages automatisch.
3. Voor visuele verificatie: playwright lokaal met `chromium` (zonder `--with-deps`). Snapshots in `/tmp/`.

## Origin

- Remote: `https://github.com/AlfalfamaleOrg/geography.git`
- Default branch: `main`
- Pages site: `https://alfalfamaleorg.github.io/geography/`
