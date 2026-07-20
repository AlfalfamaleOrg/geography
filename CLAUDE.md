# CLAUDE.md

Project context, toekomstige Claude-sessies. Aanpassen bij architectuur/conventie-wijziging.

## Wat is dit

Drag-and-drop geografie quiz. Sleep landnamen vanuit tray naar juiste positie op kaart. Hosted op `geografie.vdhout.cc` als **Cloudflare Worker met Static Assets** (Worker `geografie`, account `ac18a7e1557b0ab6eae7d92704ebefbd`). Hoofdtaal Nederlands.

## Stack

- **Vite + React 19 + TypeScript** (strict)
- **d3-geo, d3-zoom, d3-selection, d3-transition, topojson-client** voor map rendering/interactie
- **world-atlas** (50m resolution) voor wereldlandgeometrie
- **us-atlas** (states-albers-10m) voor VS-staten, pre-projected Albers via `geoIdentity()`
- **i18n-iso-countries** voor Nederlandse landnamen (alias-vorm)
- **countries-list** voor continent-classificatie
- **Region-data lazy-loaded uit `public/regions/`**: per land/provincie aparte GeoJSON, gefetched bij modus-selectie (initial bundle klein blijft). Curated landen (NL/BE/DE/FR/ES/CN/US/IT) hebben handmatige NL-namen; ~220 andere via Natural Earth Admin 1 (auto-gen)
- **Sub-province drill-down**: per-provincie gemeente/distrikt/Kreis bestanden voor NL/BE/DE/FR/ES/IT/GB/PL/IN/AR/JP/AU/ID/KR/TH/VN/UA/ZA/NZ, gegenereerd door `scripts/build-municipalities.mjs` via geometrische centroïde-containment (zie data-pipeline)
- **Cloudflare Workers Builds** CI: elke push naar main → CF draait zelf `npm run build` + `npx wrangler deploy` (git-integration op Worker, geen GH Actions)
- **Cloudflare D1** database `geografie-highscores` voor globale leaderboard. Worker (`worker/index.ts`) routet `/api/highscores` (GET/POST), rest via `env.ASSETS.fetch(request)` naar Vite-build (`dist/`). Bindings in `wrangler.toml` (`DB` voor D1, `ASSETS` voor static). Schema in `migrations/0001_init.sql`
- **Custom domain** `geografie.vdhout.cc` gekoppeld aan Pages project (proxied CNAME → `geografie.pages.dev`, Universal SSL); Vite `base: '/'`

## Belangrijke architectuur

### Modes

`GameMode` (zie `src/data/modes.ts`) beschrijft speel-set:
- `id`, `label`, `category: 'continent' | 'region'`
- `countries: Country[]` (te plaatsen items, `iso` + Dutch `name`)
- `markers: Record<iso, [lon, lat]>` voor losse drop-points (zeeën etc.)
- `createProjection`, optioneel `fitBbox`, `excludeFromMap`, `interaction: 'pan' | 'rotate'`
- `sourceFeatures?` voor regio-modi met eigen TopoJSON/GeoJSON (overschrijft `countryFeatures`)
- `contextFeatures?`: optionele niet-interactieve achtergrond-laag (rest v/h land bij provincie-quiz)

Modes niet meer statisch geëxporteerd. `modeRefs: GameModeRef[]` = lightweight lijst (id, label, parent, level, clickIso) in bundle. `loadGameMode(id)` doet fetch + hydratatie on-demand: bouwt `sourceFeatures` + `countries[]` uit gefetchte GeoJSON, cache voor instant tweede selectie.

**Tree-structuur** (`parent`, `level`, `clickIso`):
- `level: 'world' | 'continent' | 'country' | 'province'`
- `parent`: modus boven in hiërarchie
- `clickIso`: feature-id binnen parent-kaart die naar deze modus drilt (numeric ISO voor country-modi, province-feature-id voor province-modi)

`findCountryMode(iso)` en `findChildMode(parentId, iso)`: lookups voor browse-clicks (zie `handleBrowseClick` in App.tsx).

**Continent-modi** renderen hele wereld; landen niet in `mode.countries` krijgen `country--fixed` (lichtgroen), geen `data-iso` → niet-interactief, tellen niet mee voor quiz.

**Regio-modi** renderen alleen eigen `sourceFeatures` (NL provincies, VS staten, etc.).

**Province-modi** (level='province', bv. nl-pv30-municipalities) renderen eigen features (gemeenten) + `contextFeatures` van parent-modus (lichtgroene rest NL) onder hoofd-paths. `fitExtent` fit op quiz-features zelf (bounded op provincie); context offscreen geprojecteerd, zichtbaar bij uitzoomen (`scaleExtent` min 0.3 i.p.v. 1 voor modi met context).

### Data-pipeline

Build-scripts in `scripts/`:

- **`build-regions.mjs`**: bouwt landen-modi uit Natural Earth 10m Admin 1:
  - Downloadt `ne_10m_admin_1_states_provinces.geojson` (40MB raw) + `ne_10m_admin_0_map_subunits.geojson` naar `scripts/data/` (gitignored)
  - Groepeert per land (`iso_a2`), slankt features af tot {id, name, name_local, type_en}, schrijft per land `public/regions/<alpha2>-provinces.json`
  - `MAX_UNITS = 90`: landen met meer admin-1 features geskipped (te veel voor één quiz)
  - `SUBUNIT_OVERRIDES`: GB gebruikt NE's `map_subunits` (Engeland/Wales/Schotland/N-Ierland als 4 features i.p.v. 232 council areas)
  - `CURATED` set: skipt landen met eigen GeoJSON-source in modes.ts (NL/BE/DE/FR/ES/CN/US/IT)
  - Manifest: `src/data/regions-manifest.json` met `{id, level, parent, clickIso, label, unitCount, url}` per land (gebundled, niet gefetched)
  - Behoudt bestaande province-level entries bij re-run

- **`build-municipalities.mjs`**: splitst sub-province data per provincie:
  - Config-driven: per land entry in `CONFIGS` met parentFile, munSrc, getId/getName functies, outId template
  - **Planaire ray-casting** point-in-polygon i.p.v. d3's geoContains — geoBoundaries-data heeft andere winding-orientatie dan d3 verwacht, geoContains geeft daar foute resultaten
  - **Representative point**: arithmetisch gemiddelde outer ring grootste sub-polygoon (robuuste centroïde-benadering)
  - Output: per provincie `public/regions/<land>-<prov>-municipalities.json` + manifest entry (`level: 'province'`, `parent: '<land>-provinces'`, `clickIso: <provincie-feature-id>`)
  - Geometries pre-gesimplificeerd via `@turf/simplify` (tolerance 0.005, ~95% size-reductie)

- **`build-nl-municipalities.mjs`**: oudere NL-specifieke variant (cartomap topojson source). Functioneel gelijk, gebruikt d3 geoContains (NL-data heeft correcte winding, dus daar wél veilig).

- **`convert-regions.mjs`**: eenmalige migratie src/data/ TopoJSON → public/regions/ GeoJSON voor 7 oorspronkelijke curated landen.

### Data-cleaning (modes.ts)

- **Corrupte sub-polygonen filteren**: d3-geo bug bij degenerate polygonen → sphere-spanning sub-polygoon. Detectie: kleine geo-bbox (<1° beide dimensies) maar projected bbox ≥100px. Maldives heeft zo'n polygoon op iso 462.
- **Australia (036)** komt 2x voor in world-atlas (mainland + territorium): dedupe via `Set` op `featureIsos`.
- **Kosovo**: synthetische id `XK` (geen officiële ISO numeric), werkt zo als gewoon land.
- **Vaticaanstad (336)**: in 50m data 0.78 km² maar render-grootte sub-pixel. Polygon-coördinaten 3× geschaald rond centroïde (`VATICAN_SCALE`).
- **Onbekende features** (Somaliland, N. Cyprus, Indian Ocean Ter., Siachen Glacier): geen `data-iso` → beige, niet-interactief, niet "groen" als fixed-placed.
- **Render-volgorde**: features gesorteerd op afnemende bbox-grootte, microstaten boven Italië/etc.

### Map rendering (`MapView.tsx`)

- SVG-based, `viewBox="0 0 1000 760"`, schaalt naar container.
- Path-elementen gememoized met `useMemo` op `[features, placed, fixedPlaced]`: re-render alleen bij echte verandering, niet elk zoom-event.
- `vector-effect="non-scaling-stroke"` op country paths: lijnen blijven 0.7px ongeacht zoom.
- `will-change: transform` op `.map__zoomable` voor GPU-compositing.
- **Label-grootte**: `font-size = min(2px, 16/k)` (SVG-units). Tot zoom 8× groeit visuele grootte lineair tot 16px, daarna stagneert.
- **Wrap horizontal**: continent/world-modi renderen 3 kopieën feature-group (`offset × worldWidthPx`); `translateExtent` verbreed tot `[-worldWidthPx, 2×worldWidthPx]`. Region-modi: 1 kopie.
- **Zoom-extent**: `[1, 500]`. Initial fit via `fitExtent` op mode's countries (of `mode.fitBbox` indien gezet, Globe = `Sphere`).
- **Imperative handle** (`forwardRef + useImperativeHandle`) exposeert `isCountryVisible`, `zoomToCountry`, `resetZoom`. Centroïde berekend op **grootste sub-polygoon** (voor MultiPolygons als Kiribati, Russia, USA waarvan gemiddelde centroïde op rare plekken landt). Werkt ook voor seas-modi door eerst marker-positie te checken.
- Wrap-modi: `zoomToCountry` kiest kopie van land dichtst bij huidige view-center.

### Score-systeem

- Start: `score = 0`, `multiplier = 1`
- **Goed land**: `score += multiplier`, `multiplier += 1` (`+2` als bovenste label, `+2`-badge)
- **Fout land**: `multiplier = max(1, multiplier - 1)`, geen score-verandering, rode shake
- **Label → hulp-zone (zoom-hulp)**: `multiplier = max(1, multiplier - 1)`, zoom in op land (of resetZoom als off-screen, blauwe pulse)
- **Hulp → land (antwoord onthullen)**: `multiplier = 1`, `placed[iso] = name`, zoom op land
- **Drop op niet-land** (tray, zee, fixed country, eigen label): cancel, geen penalty
- Score-uitleg zichtbaar onder Top 10 lijst.

### Highscores (Cloudflare D1)

- Globale leaderboard in D1 database `geografie-highscores` (binding `DB`).
- Tabel `highscores(id, name, score, duration, mode, created_at)`, index `(mode, score DESC, duration ASC)`. Schema in `migrations/0001_init.sql`.
- API (`worker/index.ts`):
  - `GET /api/highscores?mode=<id>` → top 10 voor die modus.
  - `POST /api/highscores` body `{name, score, duration, mode}` → server valideert + insert + returnt volledige row.
- Frontend (`App.tsx`) fetcht bij mount + mode-switch via `fetchHighScores`. Bij `completeGame` POST in achtergrond; bij succes re-fetch top 10, stash `myEntryId` voor highlight.
- Key `geography-test:lastName`: laatst gebruikte naam in localStorage (UI-gemak).
- "Stop"-knop forceert complete + POST.
- Sorteren SQL: `score DESC, duration ASC`. Oude entries kunnen ontbrekende `duration` hebben → UI-fallback **3600 sec (1 uur)**.
- Anti-abuse: alleen server-side validatie (`name ≤ 30`, `score 0-100000`, `duration 0-86400`, `mode` regex `[a-z0-9-]{1,32}`). Curl-trivial te omzeilen; Turnstile optionele follow-up als spam probleem wordt.

### Phases

1. **start**: naam-input, Start-knop, Top 10 + uitleg
2. **playing**: map + tray + topbar
3. **complete**: score + Top 10 (eigen entry gehighlight), "Nieuw spel" knop

Mode-switch tijdens spelen reset spel. Vanuit complete-screen springt mode-switch terug naar start.

### Help-zone

- Gele dashed box bovenin tray, sticky boven scroll-list (niet binnen `.tray__inner`).
- Werkt 2 kanten op via `data-help-target="true"` + drag-handle:
  - Drop label erop = zoom-help
  - Sleep hem zelf naar land = antwoord onthullen (`HELP_DRAG_LABEL` = `{iso:'__help__', name:'Hulp'}`)

## Mobiel (responsive ≤720px)

- **Layout**: 1-kolom grid, tray onder map, `max-height: 40dvh`
- **Topbar**: titel naar menu; hamburger-knop opent menu (slide-down panel). Scores/timer/multiplier blijven inline zichtbaar.
- **Label 75/25 split**: links 75% `label__drag` (`touch-action: none`, pointer-handlers), rechts 25% `label__scroll` (`touch-action: pan-y`, lichtgrijs vlak met ↕ icoon + gestreepte linker-rand, visuele scroll-hint).
- **Hulp-zone**: zelfde 75/25 split, scroll-zone oranje variant.
- **Drag-aim offset**: op touch staat aim-dot + ghost-label **88px boven vinger**; hit-test op die offset-positie. Desktop/pen: offset 0 (cursor = mikpunt).
- **`100dvh` i.p.v. `100vh`** voor app-hoogte + tray max-height: past zich aan actuele zichtbare viewport (URL-bar, home-indicator).
- **`env(safe-area-inset-bottom)`** padding op `.tray__inner` voor iOS home-indicator.
- **`overscroll-behavior: contain`**: voorkomt pull-to-refresh in map.
- Cursor verborgen tijdens drag (`cursor: none`); harmless op touch, voorkomt verwarrende muiscursor op desktop.

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
worker/index.ts                # Worker fetch handler: /api/highscores routing + ASSETS fallback
migrations/0001_init.sql       # D1 schema (highscores tabel + index)
wrangler.toml                  # Worker config: main, [assets], [[d1_databases]]
vite.config.ts                 # base: '/' (custom domain)
public/regions/                # Per-land + per-provincie GeoJSON files (lazy fetched)
src/data/regions-manifest.json # Manifest (bundled): id/level/parent/clickIso/url per niet-curated modus
scripts/build-regions.mjs      # NE Admin 1 → per-land bestanden + manifest
scripts/build-municipalities.mjs # Per-land config → sub-provincie bestanden
scripts/data/                  # Raw NE/geoBoundaries downloads (gitignored)
```

## Conventies

- **Nederlandse naamgeving** voor user-facing strings, English voor code.
- Geen co-authored-by trailer in commits.
- Geen emojis in code/comments tenzij expliciet gevraagd.
- Drag-en-drop via pointer events (niet HTML5 DnD) i.v.m. SVG-transform support.
- `data-iso` attribute op interactieve country-paths + sea-markers = "drop-target identifier"; hit-test via `document.elementFromPoint(x, y).getAttribute('data-iso')`.
- Feature IDs: `String(f.id)`; padIso pad numeric strings tot 3 chars (`'8' → '008'`), strings als `'XK'`/`'PV20'` ongewijzigd.

## Bekende open punten

- Frankrijk-regio's data ~2.5MB, oude 22-regio's indeling (pre-2016 hervorming). Vervangen door 13-regio bestand verkleint bundle.
- Performance wrap-rendering: 3 kopieën × 250 features op continent-modi. Vlot maar kan schalen-probleem worden.
- Globe-modus (geoOrthographic + rotate) in codebase aanwezig maar door geen enkele mode gebruikt; later terug te halen.
- Help-zone sleep heeft 75/25 split nu ook op desktop, drag-zone 75% breed. Evt. revert naar 100% op desktop.

## Workflow voor wijzigingen

1. Werk op feature-branch (zoals `mobile-support`), test lokaal via `npm run dev` (port 5174).
2. Commits direct naar main pushen na review/test; Cloudflare Workers Builds bouwt + deployt automatisch op push.
3. Voor visuele verificatie: playwright lokaal met `chromium` (zonder `--with-deps`). Snapshots in `/tmp/`.

## Origin

- Remote: `https://github.com/AlfalfamaleOrg/geography.git`
- Default branch: `main`
- Live site: `https://geografie.vdhout.cc` (Cloudflare Worker `geografie.workers.dev`)
