import { feature } from 'topojson-client'
import { geoIdentity, geoMercator, geoPath, type GeoProjection } from 'd3-geo'
import worldData from 'world-atlas/countries-50m.json'
import countries from 'i18n-iso-countries'
import nlLocale from 'i18n-iso-countries/langs/nl.json'
import {
  countries as countriesData,
  type ICountry,
  type TContinentCode,
  type TCountryCode,
} from 'countries-list'
import type { Feature, FeatureCollection, Geometry } from 'geojson'
import type { GeoSphere } from 'd3-geo'
import type { Topology } from 'topojson-specification'
import regionsManifest from './regions-manifest.json'

type ManifestEntry = {
  id: string
  level: 'country' | 'province'
  parent: string
  clickIso: string
  label: string
  unitCount: number
  url: string
}

const manifest = regionsManifest as ManifestEntry[]

countries.registerLocale(nlLocale)

export type Country = {
  iso: string
  name: string
}

export const HELP_DRAG_LABEL: Country = { iso: '__help__', name: 'Hulp' }

export type Interaction = 'pan' | 'rotate'

export type Category = 'continent' | 'region'

export type GameMode = {
  id: string
  label: string
  category: Category
  countries: Country[]
  markers: Record<string, [number, number]>
  createProjection: () => GeoProjection
  fitBbox?: Feature<Geometry> | GeoSphere
  excludeFromMap: Set<string>
  interaction: Interaction
  sourceFeatures?: FeatureCollection<Geometry>
  /** Niet-interactieve features die op de achtergrond gerenderd worden voor oriëntatie. */
  contextFeatures?: FeatureCollection<Geometry>
}

const padIso = (id: unknown): string => {
  const s = String(id)
  return /^\d+$/.test(s) ? s.padStart(3, '0') : s
}

const topo = worldData as unknown as Topology
const rawFc = feature(topo, topo.objects.countries) as unknown as FeatureCollection<Geometry>

const cleanerProj = geoMercator().fitSize(
  [1000, 760],
  {
    type: 'Polygon',
    coordinates: [
      [
        [-180, -60],
        [180, -60],
        [180, 84],
        [-180, 84],
        [-180, -60],
      ],
    ],
  } as Feature<Geometry>['geometry'],
)
const cleanerPath = geoPath(cleanerProj)

const isCorruptPolygon = (rings: number[][][]): boolean => {
  const outer = rings[0]
  if (!outer || outer.length < 4) return false
  let minLon = Infinity
  let maxLon = -Infinity
  let minLat = Infinity
  let maxLat = -Infinity
  for (const [lon, lat] of outer) {
    if (lon < minLon) minLon = lon
    if (lon > maxLon) maxLon = lon
    if (lat < minLat) minLat = lat
    if (lat > maxLat) maxLat = lat
  }
  if (maxLon - minLon >= 1 || maxLat - minLat >= 1) return false
  const b = cleanerPath.bounds({ type: 'Polygon', coordinates: rings })
  const projW = b[1][0] - b[0][0]
  const projH = b[1][1] - b[0][1]
  return projW >= 100 || projH >= 100
}

const scaleRing = (ring: number[][], cx: number, cy: number, factor: number): number[][] =>
  ring.map(([x, y]) => [cx + (x - cx) * factor, cy + (y - cy) * factor])

const scaleRings = (rings: number[][][], factor: number): number[][][] => {
  const outer = rings[0]
  let sumX = 0
  let sumY = 0
  for (const [x, y] of outer) {
    sumX += x
    sumY += y
  }
  const cx = sumX / outer.length
  const cy = sumY / outer.length
  return rings.map((r) => scaleRing(r, cx, cy, factor))
}

const VATICAN_SCALE = 3

const cleanedFeatures = rawFc.features
  .map((f) => {
    const name = (f.properties as { name?: string } | null)?.name
    if (name === 'Kosovo' && (f.id == null || String(f.id) === 'undefined')) {
      f = { ...f, id: 'XK' }
    }
    let geom = f.geometry
    if (geom.type === 'MultiPolygon') {
      const good = geom.coordinates.filter((p) => !isCorruptPolygon(p))
      if (good.length === 0) return null
      geom = { ...geom, coordinates: good }
    } else if (geom.type === 'Polygon') {
      if (isCorruptPolygon(geom.coordinates)) return null
    }
    if (padIso(f.id) === '336') {
      if (geom.type === 'Polygon') {
        geom = { ...geom, coordinates: scaleRings(geom.coordinates, VATICAN_SCALE) }
      } else if (geom.type === 'MultiPolygon') {
        geom = {
          ...geom,
          coordinates: geom.coordinates.map((p) => scaleRings(p, VATICAN_SCALE)),
        }
      }
    }
    return { ...f, geometry: geom }
  })
  .filter((f): f is typeof rawFc.features[number] => f !== null)

const roughBboxArea = (geom: Geometry): number => {
  let minLon = Infinity
  let maxLon = -Infinity
  let minLat = Infinity
  let maxLat = -Infinity
  const visit = (rings: number[][][]) => {
    for (const ring of rings) {
      for (const [lon, lat] of ring) {
        if (lon < minLon) minLon = lon
        if (lon > maxLon) maxLon = lon
        if (lat < minLat) minLat = lat
        if (lat > maxLat) maxLat = lat
      }
    }
  }
  if (geom.type === 'Polygon') visit(geom.coordinates)
  else if (geom.type === 'MultiPolygon') for (const p of geom.coordinates) visit(p)
  if (!Number.isFinite(minLon)) return 0
  return (maxLon - minLon) * (maxLat - minLat)
}

cleanedFeatures.sort((a, b) => roughBboxArea(b.geometry) - roughBboxArea(a.geometry))

const fc: FeatureCollection<Geometry> = { type: 'FeatureCollection', features: cleanedFeatures }

export const countryFeatures: FeatureCollection<Geometry> = fc

const nlAlias = (iso: string): string | null => {
  const a2 = countries.numericToAlpha2(iso)
  if (!a2) return null
  return countries.getName(a2, 'nl', { select: 'alias' }) ?? countries.getName(a2, 'nl') ?? null
}

const curatedEuropeIsos: string[] = [
  '008', '020', '040', '056', '070', '100', '112', '191', '196', '203',
  '208', '233', '246', '250', '276', '300', '336', '348', '352', '372',
  '380', '428', '438', '440', '442', '470', '492', '498', '499', '528',
  '578', '616', '620', '642', '674', '688', '703', '705', '724', '752',
  '756', '792', '804', '807', '826', 'XK',
]

const nameOverrides: Record<string, string> = {
  '826': 'Verenigd Koninkrijk',
  '528': 'Nederland',
  '276': 'Duitsland',
  '250': 'Frankrijk',
  '724': 'Spanje',
  '380': 'Italië',
  '300': 'Griekenland',
  '703': 'Slowakije',
  '203': 'Tsjechië',
  '643': 'Rusland',
  '840': 'Verenigde Staten',
  '156': 'China',
  '484': 'Mexico',
  '076': 'Brazilië',
  '032': 'Argentinië',
  '356': 'India',
  '392': 'Japan',
  '764': 'Thailand',
  '410': 'Zuid-Korea',
  '408': 'Noord-Korea',
  '124': 'Canada',
  '036': 'Australië',
  '554': 'Nieuw-Zeeland',
  '710': 'Zuid-Afrika',
  '818': 'Egypte',
  '566': 'Nigeria',
  '404': 'Kenia',
  '231': 'Ethiopië',
  XK: 'Kosovo',
}

const buildCountry = (iso: string): Country | null => {
  const name = nameOverrides[iso] ?? nlAlias(iso)
  if (!name) return null
  return { iso, name }
}

const europeCountries: Country[] = curatedEuropeIsos
  .map(buildCountry)
  .filter((c): c is Country => c !== null)
  .sort((a, b) => a.name.localeCompare(b.name, 'nl'))

const featureIsos = Array.from(
  new Set(
    fc.features
      .map((f) => padIso(f.id))
      .filter((iso) => iso !== 'undefined' && iso !== '-99'),
  ),
)

const worldExclude = new Set<string>(['010'])

const worldCountries: Country[] = featureIsos
  .filter((iso) => !worldExclude.has(iso))
  .map((iso) => ({ iso, name: nameOverrides[iso] ?? nlAlias(iso) ?? '' }))
  .filter((c) => c.name !== '')
  .sort((a, b) => a.name.localeCompare(b.name, 'nl'))

const continentCountries = (cont: TContinentCode): Country[] => {
  const list: Country[] = []
  for (const entry of Object.entries(countriesData) as [TCountryCode, ICountry][]) {
    const [a2, info] = entry
    if (info.continent !== cont) continue
    const num = countries.alpha2ToNumeric(a2)
    if (!num) continue
    if (!featureIsos.includes(num)) continue
    const name = nameOverrides[num] ?? nlAlias(num)
    if (!name) continue
    list.push({ iso: num, name })
  }
  return list.sort((a, b) => a.name.localeCompare(b.name, 'nl'))
}

export const seasMode: GameMode = {
  id: 'seas',
  label: 'Zeeën & oceanen',
  category: 'continent',
  countries: [
    { iso: 'sea-atlantic', name: 'Atlantische Oceaan' },
    { iso: 'sea-pacific', name: 'Stille Oceaan' },
    { iso: 'sea-indian', name: 'Indische Oceaan' },
    { iso: 'sea-arctic', name: 'Noordelijke IJszee' },
    { iso: 'sea-southern', name: 'Zuidelijke Oceaan' },
    { iso: 'sea-mediterranean', name: 'Middellandse Zee' },
    { iso: 'sea-north', name: 'Noordzee' },
    { iso: 'sea-baltic', name: 'Oostzee' },
    { iso: 'sea-black', name: 'Zwarte Zee' },
    { iso: 'sea-red', name: 'Rode Zee' },
    { iso: 'sea-caspian', name: 'Kaspische Zee' },
    { iso: 'sea-arabian', name: 'Arabische Zee' },
    { iso: 'sea-southchina', name: 'Zuid-Chinese Zee' },
    { iso: 'sea-eastchina', name: 'Oost-Chinese Zee' },
    { iso: 'sea-japan', name: 'Japanse Zee' },
    { iso: 'sea-bengal', name: 'Golf van Bengalen' },
    { iso: 'sea-caribbean', name: 'Caribische Zee' },
    { iso: 'sea-mexico', name: 'Golf van Mexico' },
    { iso: 'sea-hudson', name: 'Hudsonbaai' },
    { iso: 'sea-bering', name: 'Beringzee' },
    { iso: 'sea-tasman', name: 'Tasmanzee' },
    { iso: 'sea-coral', name: 'Koraalzee' },
  ].sort((a, b) => a.name.localeCompare(b.name, 'nl')),
  markers: {
    'sea-atlantic': [-30, 15],
    'sea-pacific': [-150, 5],
    'sea-indian': [75, -20],
    'sea-arctic': [0, 80],
    'sea-southern': [0, -65],
    'sea-mediterranean': [17, 37],
    'sea-north': [3, 56],
    'sea-baltic': [20, 58],
    'sea-black': [35, 43],
    'sea-red': [38, 22],
    'sea-caspian': [50, 41],
    'sea-arabian': [65, 15],
    'sea-southchina': [115, 15],
    'sea-eastchina': [125, 30],
    'sea-japan': [135, 40],
    'sea-bengal': [88, 15],
    'sea-caribbean': [-75, 15],
    'sea-mexico': [-90, 25],
    'sea-hudson': [-85, 60],
    'sea-bering': [-175, 60],
    'sea-tasman': [160, -40],
    'sea-coral': [155, -15],
  },
  createProjection: () => geoMercator(),
  excludeFromMap: new Set(),
  interaction: 'pan',
}

export const worldMode: GameMode = {
  id: 'world',
  label: 'Wereld',
  category: 'continent',
  countries: worldCountries,
  markers: {},
  createProjection: () => geoMercator(),
  excludeFromMap: worldExclude,
  interaction: 'pan',
}

export const europeMode: GameMode = {
  id: 'europe',
  label: 'Europa',
  category: 'continent',
  countries: europeCountries,
  markers: {},
  createProjection: () => geoMercator(),
  excludeFromMap: new Set(),
  interaction: 'pan',
}

export const africaMode: GameMode = {
  id: 'africa',
  label: 'Afrika',
  category: 'continent',
  countries: continentCountries('AF'),
  markers: {},
  createProjection: () => geoMercator(),
  excludeFromMap: new Set(),
  interaction: 'pan',
}

export const asiaMode: GameMode = {
  id: 'asia',
  label: 'Azië',
  category: 'continent',
  countries: continentCountries('AS'),
  markers: {},
  createProjection: () => geoMercator(),
  excludeFromMap: new Set(),
  interaction: 'pan',
}

export const northAmericaMode: GameMode = {
  id: 'north-america',
  label: 'Noord-Amerika',
  category: 'continent',
  countries: continentCountries('NA'),
  markers: {},
  createProjection: () => geoMercator(),
  excludeFromMap: new Set(),
  interaction: 'pan',
}

export const southAmericaMode: GameMode = {
  id: 'south-america',
  label: 'Zuid-Amerika',
  category: 'continent',
  countries: continentCountries('SA'),
  markers: {},
  createProjection: () => geoMercator(),
  excludeFromMap: new Set(),
  interaction: 'pan',
}

export const oceaniaMode: GameMode = {
  id: 'oceania',
  label: 'Oceanië',
  category: 'continent',
  countries: continentCountries('OC'),
  markers: {},
  createProjection: () => geoMercator(),
  excludeFromMap: new Set(),
  interaction: 'pan',
}

const buildRegionalFc = (
  raw: { features: { id?: unknown; properties: Record<string, unknown>; geometry: Geometry }[] },
  getId: (f: { id?: unknown; properties: Record<string, unknown> }) => string,
): FeatureCollection<Geometry> => ({
  type: 'FeatureCollection',
  features: raw.features.map((f) => ({
    type: 'Feature',
    id: getId(f),
    properties: f.properties,
    geometry: f.geometry,
  })),
})

const countriesFromFc = (
  fc: FeatureCollection<Geometry>,
  getName: (f: Feature<Geometry>) => string,
  overrides: Record<string, string> = {},
): Country[] =>
  fc.features
    .map((f) => {
      const iso = String(f.id)
      const name = overrides[iso] ?? getName(f)
      return { iso, name }
    })
    .filter((c) => c.name)
    .sort((a, b) => a.name.localeCompare(b.name, 'nl'))

type RegionDef = {
  id: string
  label: string
  url: string
  interaction?: Interaction
  createProjection?: () => GeoProjection
  getId: (f: { id?: unknown; properties: Record<string, unknown> }) => string
  getName: (f: Feature<Geometry>) => string
  nameOverrides?: Record<string, string>
  postProcessFc?: (fc: FeatureCollection<Geometry>) => FeatureCollection<Geometry>
}

const regionDefs: Record<string, RegionDef> = {
  'nl-provinces': {
    id: 'nl-provinces',
    label: 'Nederland — provincies',
    url: '/regions/nl-provinces.json',
    getId: (f) => String(f.id ?? (f.properties.statcode as string | undefined) ?? ''),
    getName: (f) =>
      (f.properties as { statnaam?: string } | null)?.statnaam ?? String(f.id),
  },
  'be-provinces': {
    id: 'be-provinces',
    label: 'België — provincies',
    url: '/regions/be-provinces.json',
    getId: (f) => String((f.properties as Record<string, unknown>).NUTS_ID),
    getName: (f) => {
      const p = f.properties as Record<string, unknown>
      return String(p.NUTS_NAME ?? p.NAME_LATN ?? f.id)
    },
    nameOverrides: {
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
    },
  },
  'de-states': {
    id: 'de-states',
    label: 'Duitsland — deelstaten',
    url: '/regions/de-states.json',
    getId: (f) => String((f.properties as Record<string, unknown>).id ?? f.id),
    getName: (f) => String((f.properties as Record<string, unknown>).name ?? f.id),
    nameOverrides: {
      'DE-BW': 'Baden-Württemberg',
      'DE-BY': 'Beieren',
      'DE-BE': 'Berlijn',
      'DE-BB': 'Brandenburg',
      'DE-HB': 'Bremen',
      'DE-HH': 'Hamburg',
      'DE-HE': 'Hessen',
      'DE-MV': 'Mecklenburg-Voor-Pommeren',
      'DE-NI': 'Nedersaksen',
      'DE-NW': 'Noordrijn-Westfalen',
      'DE-RP': 'Rijnland-Palts',
      'DE-SL': 'Saarland',
      'DE-SN': 'Saksen',
      'DE-ST': 'Saksen-Anhalt',
      'DE-SH': 'Sleeswijk-Holstein',
      'DE-TH': 'Thüringen',
    },
  },
  'fr-regions': {
    id: 'fr-regions',
    label: 'Frankrijk — regio’s',
    url: '/regions/fr-regions.json',
    getId: (f) => `fr-${(f.properties as Record<string, unknown>).cartodb_id}`,
    getName: (f) => String((f.properties as Record<string, unknown>).name ?? f.id),
    nameOverrides: {
      'fr-8336': 'Corsica',
      'fr-8385': 'Elzas',
      'fr-8386': 'Lotharingen',
    },
  },
  'es-communities': {
    id: 'es-communities',
    label: 'Spanje — regio’s',
    url: '/regions/es-communities.json',
    getId: (f) => `es-${(f.properties as Record<string, unknown>).cartodb_id}`,
    getName: (f) => String((f.properties as Record<string, unknown>).name ?? f.id),
  },
  'cn-provinces': {
    id: 'cn-provinces',
    label: 'China — provincies',
    url: '/regions/cn-provinces.json',
    getId: (f) => `cn-${(f.properties as Record<string, unknown>).cartodb_id}`,
    getName: (f) => String((f.properties as Record<string, unknown>).name ?? f.id),
  },
  'it-regions': {
    id: 'it-regions',
    label: 'Italië — regio’s',
    url: '/regions/it-regions.json',
    getId: (f) => String(f.id ?? (f.properties as Record<string, unknown>).shapeID),
    getName: (f) => {
      const overrides: Record<string, string> = {
        Piemonte: 'Piëmont',
        Lombardia: 'Lombardije',
        'Trentino-Alto Adige': 'Trentino-Zuid-Tirol',
        Veneto: 'Veneto',
        'Friuli-Venezia Giulia': 'Friuli-Venezia Giulia',
        Liguria: 'Ligurië',
        'Emilia-Romagna': 'Emilia-Romagna',
        Toscana: 'Toscane',
        Umbria: 'Umbrië',
        Marche: 'Marche',
        Lazio: 'Latium',
        Abruzzo: 'Abruzzen',
        Molise: 'Molise',
        Campania: 'Campanië',
        Puglia: 'Apulië',
        Basilicata: 'Basilicata',
        Calabria: 'Calabrië',
        Sicilia: 'Sicilië',
        Sardegna: 'Sardinië',
        "Valle d'Aosta": 'Valle d’Aosta',
      }
      const name = (f.properties as { name?: string } | null)?.name ?? String(f.id)
      return overrides[name] ?? name
    },
  },
  'usa-states': {
    id: 'usa-states',
    label: 'VS — staten',
    url: '/regions/usa-states.json',
    createProjection: () => geoIdentity() as unknown as GeoProjection,
    getId: (f) => String(f.id).padStart(3, '0'),
    getName: (f) => String((f.properties as Record<string, unknown>).name ?? f.id),
    nameOverrides: {
      '004': 'Arizona',
      '005': 'Arkansas',
      '006': 'Californië',
      '008': 'Colorado',
      '037': 'Noord-Carolina',
      '038': 'Noord-Dakota',
      '045': 'Zuid-Carolina',
      '046': 'Zuid-Dakota',
      '054': 'West Virginia',
      '035': 'Nieuw-Mexico',
    },
    postProcessFc: (fc) => ({
      type: 'FeatureCollection',
      features: fc.features.filter((f) => String(f.id) !== '011'),
    }),
  },
}

async function fetchJson<T>(url: string): Promise<T> {
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`fetch ${url}: ${resp.status}`)
  return (await resp.json()) as T
}

async function buildRegionMode(
  def: RegionDef,
  contextDef?: RegionDef,
): Promise<GameMode> {
  const raw = await fetchJson<Parameters<typeof buildRegionalFc>[0]>(def.url)
  let fc = buildRegionalFc(raw, def.getId)
  if (def.postProcessFc) fc = def.postProcessFc(fc)
  const list = countriesFromFc(fc, def.getName, def.nameOverrides ?? {})

  let contextFc: FeatureCollection<Geometry> | undefined
  if (contextDef) {
    const ctxRaw = await fetchJson<Parameters<typeof buildRegionalFc>[0]>(
      contextDef.url,
    )
    contextFc = buildRegionalFc(ctxRaw, contextDef.getId)
    if (contextDef.postProcessFc) contextFc = contextDef.postProcessFc(contextFc)
  }

  return {
    id: def.id,
    label: def.label,
    category: 'region',
    countries: list,
    markers: {},
    createProjection: def.createProjection ?? (() => geoMercator()),
    excludeFromMap: new Set(),
    interaction: def.interaction ?? 'pan',
    sourceFeatures: fc,
    contextFeatures: contextFc,
  }
}

export type ModeLevel = 'world' | 'continent' | 'country' | 'province'

export type GameModeRef = {
  id: string
  label: string
  category: Category
  parent: string | null
  level: ModeLevel
  /**
   * Feature-id in de parent map die deze modus opent bij browse-click.
   * Voor country-modi: numeric ISO; voor province-modi: het provincie-id.
   */
  clickIso?: string
}

const eagerModes: Record<string, GameMode> = {
  world: worldMode,
  europe: europeMode,
  africa: africaMode,
  asia: asiaMode,
  'north-america': northAmericaMode,
  'south-america': southAmericaMode,
  oceania: oceaniaMode,
  seas: seasMode,
}

const cache = new Map<string, GameMode>()

function autoGenRegionDef(entry: ManifestEntry): RegionDef {
  return {
    id: entry.id,
    label: entry.label,
    url: entry.url,
    getId: (f) =>
      String(
        f.id ??
          (f.properties as Record<string, unknown>).adm1_code ??
          (f.properties as Record<string, unknown>).name ??
          '',
      ),
    getName: (f) => {
      const p = f.properties as Record<string, unknown>
      return String(p.name ?? p.statnaam ?? p.name_local ?? f.id)
    },
  }
}

function findRegionDef(id: string): RegionDef | undefined {
  const curated = regionDefs[id]
  if (curated) return curated
  const entry = manifest.find((e) => e.id === id)
  if (entry) return autoGenRegionDef(entry)
  return undefined
}

export async function loadGameMode(id: string): Promise<GameMode> {
  const eager = eagerModes[id]
  if (eager) return eager
  const cached = cache.get(id)
  if (cached) return cached
  const def = findRegionDef(id)
  if (!def) throw new Error(`unknown mode: ${id}`)
  // Voor province-modi: parent's features als context-laag (lichtgroen).
  let contextDef: RegionDef | undefined
  const meRef = modeRefs.find((m) => m.id === id)
  if (meRef?.level === 'province' && meRef.parent) {
    contextDef = findRegionDef(meRef.parent)
  }
  const mode = await buildRegionMode(def, contextDef)
  cache.set(id, mode)
  return mode
}

const curatedModeRefs: GameModeRef[] = [
  { id: 'world', label: 'Wereld', category: 'continent', parent: null, level: 'world' },
  { id: 'europe', label: 'Europa', category: 'continent', parent: 'world', level: 'continent' },
  { id: 'africa', label: 'Afrika', category: 'continent', parent: 'world', level: 'continent' },
  { id: 'asia', label: 'Azië', category: 'continent', parent: 'world', level: 'continent' },
  { id: 'north-america', label: 'Noord-Amerika', category: 'continent', parent: 'world', level: 'continent' },
  { id: 'south-america', label: 'Zuid-Amerika', category: 'continent', parent: 'world', level: 'continent' },
  { id: 'oceania', label: 'Oceanië', category: 'continent', parent: 'world', level: 'continent' },
  { id: 'seas', label: 'Zeeën & oceanen', category: 'continent', parent: 'world', level: 'continent' },
  { id: 'nl-provinces', label: 'Nederland — provincies', category: 'region', parent: 'europe', level: 'country', clickIso: '528' },
  { id: 'be-provinces', label: 'België — provincies', category: 'region', parent: 'europe', level: 'country', clickIso: '056' },
  { id: 'de-states', label: 'Duitsland — deelstaten', category: 'region', parent: 'europe', level: 'country', clickIso: '276' },
  { id: 'fr-regions', label: 'Frankrijk — regio’s', category: 'region', parent: 'europe', level: 'country', clickIso: '250' },
  { id: 'es-communities', label: 'Spanje — regio’s', category: 'region', parent: 'europe', level: 'country', clickIso: '724' },
  { id: 'usa-states', label: 'VS — staten', category: 'region', parent: 'north-america', level: 'country', clickIso: '840' },
  { id: 'cn-provinces', label: 'China — provincies', category: 'region', parent: 'asia', level: 'country', clickIso: '156' },
  { id: 'it-regions', label: 'Italië — regio’s', category: 'region', parent: 'europe', level: 'country', clickIso: '380' },
]

const autoModeRefs: GameModeRef[] = manifest.map((e) => ({
  id: e.id,
  label: e.label,
  category: 'region',
  parent: e.parent,
  level: e.level,
  clickIso: e.clickIso,
}))

export const modeRefs: GameModeRef[] = [...curatedModeRefs, ...autoModeRefs]

/** Find the country-level mode for a numeric country ISO, or undefined if none exists. */
export function findCountryMode(iso: string): GameModeRef | undefined {
  return modeRefs.find((m) => m.level === 'country' && m.clickIso === iso)
}

/** Find a direct-child mode under `parentModeId` that matches a clicked feature iso. */
export function findChildMode(
  parentModeId: string,
  iso: string,
): GameModeRef | undefined {
  return modeRefs.find((m) => m.parent === parentModeId && m.clickIso === iso)
}

/** Direct children of a mode in the navigation tree. */
export function modeChildren(id: string): GameModeRef[] {
  return modeRefs.filter((m) => m.parent === id)
}
