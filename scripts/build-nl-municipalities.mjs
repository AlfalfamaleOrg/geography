// Genereert per-provincie GeoJSON met de gemeenten daarbinnen.
// Centroïde van elke gemeente bepaalt in welke provincie hij valt.
import fs from 'node:fs/promises'
import path from 'node:path'
import { feature } from 'topojson-client'
import { geoCentroid, geoContains } from 'd3-geo'

const GEMEENTE_SRC = 'scripts/data/nl-gemeente-2020.topojson'
const PROVINCE_SRC = 'public/regions/nl-provinces.json'
const OUT_DIR = 'public/regions'

const topo = JSON.parse(await fs.readFile(GEMEENTE_SRC, 'utf8'))
const gemKey = Object.keys(topo.objects)[0]
const gemFc = feature(topo, topo.objects[gemKey])

const provFc = JSON.parse(await fs.readFile(PROVINCE_SRC, 'utf8'))

// Groepeer gemeenten per provincie via centroïde-containment.
const byProvince = new Map()
for (const prov of provFc.features) {
  byProvince.set(prov.id, { prov, gems: [] })
}

let unmatched = 0
for (const gem of gemFc.features) {
  const c = geoCentroid(gem)
  let found = null
  for (const prov of provFc.features) {
    if (geoContains(prov, c)) {
      found = prov.id
      break
    }
  }
  if (found) {
    byProvince.get(found).gems.push(gem)
  } else {
    unmatched++
    console.warn(`unmatched: ${gem.properties?.statnaam} (${gem.id})`)
  }
}

const newEntries = []
for (const [provId, { prov, gems }] of byProvince) {
  if (gems.length === 0) continue
  const provinceName = prov.properties?.statnaam ?? provId
  const slimFeatures = gems.map((g) => ({
    type: 'Feature',
    id: g.id,
    properties: { name: g.properties?.statnaam ?? g.id },
    geometry: g.geometry,
  }))
  const fc = { type: 'FeatureCollection', features: slimFeatures }
  const fname = `nl-${provId.toLowerCase()}-municipalities.json`
  await fs.writeFile(path.join(OUT_DIR, fname), JSON.stringify(fc))
  newEntries.push({
    id: `nl-${provId.toLowerCase()}-municipalities`,
    level: 'province',
    parent: 'nl-provinces',
    clickIso: provId,
    label: provinceName,
    unitCount: gems.length,
    url: `/regions/nl-${provId.toLowerCase()}-municipalities.json`,
  })
  console.log(`  ${provId} ${provinceName.padEnd(20)} ${gems.length} gemeenten`)
}

if (unmatched > 0) console.warn(`${unmatched} gemeenten ongematched`)

// Append op bestaand manifest. Sorteer aan het eind.
const manifestPath = 'src/data/regions-manifest.json'
const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
// Verwijder oude nl-pv*-municipalities entries (idempotent re-run)
const filtered = manifest.filter(
  (e) => !e.id.startsWith('nl-') || !e.id.endsWith('-municipalities'),
)
filtered.push(...newEntries)
filtered.sort((a, b) => a.label.localeCompare(b.label, 'nl'))
await fs.writeFile(manifestPath, JSON.stringify(filtered))

console.log(`\ntotal: ${newEntries.length} NL provincie-modi toegevoegd`)
