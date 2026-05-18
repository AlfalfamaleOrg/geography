// Generieke per-provincie municipality-splitter.
// Voor elk land in CONFIGS: groepeert features uit een municipalities-file
// per provincie (via centroïde + geoContains op de provinces-FC), schrijft
// per-provincie GeoJSON-files en appendt manifest-entries.
import fs from 'node:fs/promises'
import path from 'node:path'
import { feature } from 'topojson-client'
import { createRequire } from 'node:module'

// Planaire point-in-polygon (negeert winding-orientatie — robuust voor
// gemengde data-sources zoals geoBoundaries vs Eurostat).
function pointInRing(point, ring) {
  let inside = false
  const [x, y] = point
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    const intersect =
      yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / (yj - yi) + xi
    if (intersect) inside = !inside
  }
  return inside
}

function polyContains(point, rings) {
  if (!pointInRing(point, rings[0])) return false
  for (let i = 1; i < rings.length; i++) {
    if (pointInRing(point, rings[i])) return false // gat
  }
  return true
}

function geomContains(geom, point) {
  if (geom.type === 'Polygon') return polyContains(point, geom.coordinates)
  if (geom.type === 'MultiPolygon') {
    return geom.coordinates.some((r) => polyContains(point, r))
  }
  return false
}

function repPoint(geom) {
  // Centroïde van grootste sub-polygoon via gemiddelde van outer ring.
  let best = null
  let bestArea = -Infinity
  const consider = (ring) => {
    let area = 0
    for (let i = 0; i < ring.length - 1; i++) {
      area += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]
    }
    area = Math.abs(area) / 2
    if (area > bestArea) {
      bestArea = area
      let sx = 0,
        sy = 0
      for (const [x, y] of ring) {
        sx += x
        sy += y
      }
      best = [sx / ring.length, sy / ring.length]
    }
  }
  if (geom.type === 'Polygon') consider(geom.coordinates[0])
  else if (geom.type === 'MultiPolygon') {
    for (const rings of geom.coordinates) consider(rings[0])
  }
  return best
}

const require = createRequire(import.meta.url)
const countries = require('i18n-iso-countries')
const nlLocale = require('i18n-iso-countries/langs/nl.json')
countries.registerLocale(nlLocale)

const OUT_DIR = 'public/regions'
const MANIFEST_PATH = 'src/data/regions-manifest.json'

const CONFIGS = {
  nl: {
    alpha2: 'NL',
    parentMode: 'nl-provinces',
    parentFile: 'public/regions/nl-provinces.json',
    munSrc: { type: 'topojson', path: 'scripts/data/nl-gemeente-2020.topojson' },
    munId: (f) => String(f.id),
    munName: (f) => f.properties?.statnaam ?? String(f.id),
    provinceId: (f) => String(f.id),
    provinceName: (f) => f.properties?.statnaam ?? String(f.id),
    outId: (pid) => `nl-${pid.toLowerCase()}-municipalities`,
  },
  be: {
    alpha2: 'BE',
    parentMode: 'be-provinces',
    parentFile: 'public/regions/be-provinces.json',
    munSrc: { type: 'geojson', path: 'scripts/data/be-municipalities.geojson' },
    munId: (f) => String(f.properties?.shapeID ?? f.id),
    munName: (f) => String(f.properties?.shapeName ?? f.id),
    provinceId: (f) => String(f.properties?.NUTS_ID ?? f.id),
    provinceName: (f) => {
      const overrides = {
        BE10: 'Brussel',
        BE21: 'Antwerpen',
        BE22: 'Limburg',
        BE23: 'Oost-Vlaanderen',
        BE24: 'Vlaams-Brabant',
        BE25: 'West-Vlaanderen',
        BE31: 'Waals-Brabant',
        BE32: 'Henegouwen',
        BE33: 'Luik',
        BE34: 'Luxemburg',
        BE35: 'Namen',
      }
      const pid = f.properties?.NUTS_ID
      return overrides[pid] ?? f.properties?.NUTS_NAME ?? String(f.id)
    },
    outId: (pid) => `be-${pid.toLowerCase()}-municipalities`,
  },
}

async function loadFc(src) {
  const raw = await fs.readFile(src.path, 'utf8')
  const data = JSON.parse(raw)
  if (src.type === 'topojson') {
    const key = Object.keys(data.objects)[0]
    return feature(data, data.objects[key])
  }
  return data
}

const args = process.argv.slice(2)
const targets = args.length > 0 ? args : Object.keys(CONFIGS)

const manifest = JSON.parse(await fs.readFile(MANIFEST_PATH, 'utf8'))
// Verwijder bestaande entries voor de gevraagde targets (idempotent re-run).
const targetPrefixes = targets.map((t) => `${t}-`).filter((p) => p.length > 0)
const filtered = manifest.filter(
  (e) =>
    !(
      e.level === 'province' &&
      targetPrefixes.some(
        (p) => e.id.startsWith(p) && e.id.endsWith('-municipalities'),
      )
    ),
)

for (const target of targets) {
  const cfg = CONFIGS[target]
  if (!cfg) {
    console.warn(`unknown target: ${target}`)
    continue
  }
  console.log(`\n=== ${target.toUpperCase()} ===`)

  const munFc = await loadFc(cfg.munSrc)
  const provFc = JSON.parse(await fs.readFile(cfg.parentFile, 'utf8'))

  const byProv = new Map()
  for (const prov of provFc.features) {
    byProv.set(cfg.provinceId(prov), { prov, muns: [] })
  }

  let unmatched = 0
  for (const mun of munFc.features) {
    const c = repPoint(mun.geometry)
    if (!c) {
      unmatched++
      continue
    }
    let found = null
    for (const prov of provFc.features) {
      if (geomContains(prov.geometry, c)) {
        found = cfg.provinceId(prov)
        break
      }
    }
    if (found && byProv.has(found)) {
      byProv.get(found).muns.push(mun)
    } else {
      unmatched++
      console.warn(`  unmatched: ${cfg.munName(mun)}`)
    }
  }

  for (const [pid, { prov, muns }] of byProv) {
    if (muns.length === 0) continue
    const provName = cfg.provinceName(prov)
    const slim = muns.map((m) => ({
      type: 'Feature',
      id: cfg.munId(m),
      properties: { name: cfg.munName(m) },
      geometry: m.geometry,
    }))
    const id = cfg.outId(pid)
    const fname = `${id}.json`
    await fs.writeFile(
      path.join(OUT_DIR, fname),
      JSON.stringify({ type: 'FeatureCollection', features: slim }),
    )
    filtered.push({
      id,
      level: 'province',
      parent: cfg.parentMode,
      clickIso: pid,
      label: provName,
      unitCount: muns.length,
      url: `/regions/${fname}`,
    })
    console.log(`  ${pid.padEnd(6)} ${provName.padEnd(22)} ${muns.length}`)
  }

  if (unmatched > 0) console.warn(`  ${unmatched} unmatched`)
}

filtered.sort((a, b) => a.label.localeCompare(b.label, 'nl'))
await fs.writeFile(MANIFEST_PATH, JSON.stringify(filtered))
console.log(`\nmanifest entries: ${filtered.length}`)
