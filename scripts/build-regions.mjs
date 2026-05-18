// Splits Natural Earth Admin 1 in per-land GeoJSON-files en bouwt manifest.json.
// Voert geen download uit — verwacht scripts/data/ne_10m_admin_1.geojson lokaal.
//
// Uitvoer:
//  - public/regions/<alpha2>-provinces.json per land (niet voor curated)
//  - public/regions/manifest.json met metadata voor alle landen-modi
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const countries = require('i18n-iso-countries')
const nlLocale = require('i18n-iso-countries/langs/nl.json')
const { countries: cl } = await import('countries-list')

countries.registerLocale(nlLocale)

const SRC = 'scripts/data/ne_10m_admin_1.geojson'
const SRC_URL =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces.geojson'
const OUT_DIR = 'public/regions'

// Download bron-data als hij nog niet lokaal staat.
try {
  await fs.access(SRC)
} catch {
  console.log(`fetching ${SRC_URL}`)
  await fs.mkdir(path.dirname(SRC), { recursive: true })
  const resp = await fetch(SRC_URL)
  if (!resp.ok) throw new Error(`download failed: ${resp.status}`)
  await fs.writeFile(SRC, Buffer.from(await resp.arrayBuffer()))
}

// Curated landen — sla deze over (eigen GeoJSON + namen).
// Alpha-2 → curated mode id.
const CURATED = new Set(['NL', 'BE', 'DE', 'FR', 'ES', 'CN', 'US'])

// Maximum aantal admin-1 features. Boven dit aantal wordt het land
// niet als spelmodus aangemaakt (te veel om in één quiz te plaatsen).
const MAX_UNITS = 60

const CONTINENT_TO_MODE = {
  EU: 'europe',
  AF: 'africa',
  AS: 'asia',
  NA: 'north-america',
  SA: 'south-america',
  OC: 'oceania',
  AN: 'world', // Antarctica → hang aan wereld (geen apart continent in modeRefs)
}

const raw = JSON.parse(await fs.readFile(SRC, 'utf8'))

// Groepeer features per alpha-2.
const byA2 = new Map()
for (const f of raw.features) {
  const a2 = (f.properties.iso_a2 || '').toUpperCase()
  if (!a2 || a2 === '-99') continue
  if (!byA2.has(a2)) byA2.set(a2, [])
  byA2.get(a2).push(f)
}

await fs.mkdir(OUT_DIR, { recursive: true })

const manifest = []
const skipped = []

for (const [a2, features] of byA2) {
  if (CURATED.has(a2)) continue
  if (features.length > MAX_UNITS) {
    skipped.push({ a2, count: features.length, reason: 'too many' })
    continue
  }

  const numeric = countries.alpha2ToNumeric(a2)
  if (!numeric) {
    skipped.push({ a2, count: features.length, reason: 'no numeric ISO' })
    continue
  }

  const dutchName =
    countries.getName(a2, 'nl', { select: 'alias' }) ??
    countries.getName(a2, 'nl') ??
    countries.getName(a2, 'en')
  if (!dutchName) {
    skipped.push({ a2, count: features.length, reason: 'no name' })
    continue
  }

  const info = cl[a2]
  const continent = info?.continent ?? 'AN'
  const parent = CONTINENT_TO_MODE[continent] ?? 'world'

  // Slank elke feature af: alleen de velden die we runtime nodig hebben.
  const slimFeatures = features.map((f) => ({
    type: 'Feature',
    id: f.properties.adm1_code ?? f.properties.iso_3166_2 ?? f.properties.name,
    properties: {
      name: f.properties.name,
      name_local: f.properties.name_local,
      type_en: f.properties.type_en,
    },
    geometry: f.geometry,
  }))

  const fc = { type: 'FeatureCollection', features: slimFeatures }
  const fname = `${a2.toLowerCase()}-provinces.json`
  await fs.writeFile(path.join(OUT_DIR, fname), JSON.stringify(fc))

  manifest.push({
    id: `${a2.toLowerCase()}-provinces`,
    alpha2: a2,
    numeric,
    label: dutchName,
    parent,
    unitCount: features.length,
  })
}

manifest.sort((a, b) => a.label.localeCompare(b.label, 'nl'))

await fs.writeFile(
  'src/data/regions-manifest.json',
  JSON.stringify(manifest, null, 0),
)

console.log(`wrote ${manifest.length} country modes, skipped ${skipped.length}`)
console.log('skipped (top 20):')
skipped
  .sort((a, b) => b.count - a.count)
  .slice(0, 20)
  .forEach((s) => console.log(`  ${s.a2}: ${s.count} (${s.reason})`))
