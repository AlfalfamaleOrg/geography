import { feature } from 'topojson-client'
import fs from 'node:fs/promises'
import path from 'node:path'

const outDir = 'public/regions'
await fs.mkdir(outDir, { recursive: true })

async function copyJson(from, to) {
  const raw = await fs.readFile(from, 'utf8')
  const data = JSON.parse(raw)
  await fs.writeFile(path.join(outDir, to), JSON.stringify(data))
  console.log(`copied: ${from} -> ${outDir}/${to}`)
}

async function convertTopo(from, to, objectKey) {
  const raw = await fs.readFile(from, 'utf8')
  const topo = JSON.parse(raw)
  const key = objectKey ?? Object.keys(topo.objects)[0]
  const fc = feature(topo, topo.objects[key])
  await fs.writeFile(path.join(outDir, to), JSON.stringify(fc))
  console.log(`converted: ${from} (object=${key}) -> ${outDir}/${to}`)
}

await convertTopo('src/data/nl-provinces.topojson.json', 'nl-provinces.json')
await convertTopo('node_modules/us-atlas/states-albers-10m.json', 'usa-states.json', 'states')
await copyJson('src/data/belgium-provinces.json', 'be-provinces.json')
await copyJson('src/data/germany-states.json', 'de-states.json')
await copyJson('src/data/france-regions.json', 'fr-regions.json')
await copyJson('src/data/spain-communities.json', 'es-communities.json')
await copyJson('src/data/china-provinces.json', 'cn-provinces.json')

console.log('done')
