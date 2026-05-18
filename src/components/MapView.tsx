import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import { geoDistance, geoGraticule10, geoPath } from 'd3-geo'
import { select } from 'd3-selection'
import 'd3-transition'
import {
  zoom,
  zoomIdentity,
  zoomTransform as readZoomTransform,
  type ZoomBehavior,
  type ZoomTransform,
} from 'd3-zoom'
import type { Feature, Geometry } from 'geojson'
import { countryFeatures, type GameMode } from '../data/modes'

export type MapViewHandle = {
  isCountryVisible: (iso: string) => boolean
  zoomToCountry: (iso: string) => void
  resetZoom: () => void
}

type Props = {
  mode: GameMode
  placed: Record<string, string>
  onZoomChange?: (k: number) => void
  /** When set, country/region clicks call this with the iso. Used for browse/drill-down. */
  onCountryClick?: (iso: string) => void
}

const WIDTH = 1000
const HEIGHT = 760

const padIso = (id: unknown): string => {
  const s = String(id)
  return /^\d+$/.test(s) ? s.padStart(3, '0') : s
}

const isInvalidIso = (iso: string): boolean =>
  iso === 'undefined' || iso === 'null' || iso === '-99'

const SPHERE = { type: 'Sphere' as const }

const MapView = forwardRef<MapViewHandle, Props>(function MapView(
  { mode, placed, onZoomChange, onCountryClick },
  ref,
) {
  const svgRef = useRef<SVGSVGElement>(null)
  const zoomBehaviorRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null)

  const [transform, setTransform] = useState<ZoomTransform>(zoomIdentity)
  const [rotation, setRotation] = useState<[number, number, number]>([0, 0, 0])
  const [scale, setScale] = useState(1)

  useEffect(() => {
    setTransform(zoomIdentity)
    setRotation([0, 0, 0])
    setScale(1)
  }, [mode.id])

  useEffect(() => {
    onZoomChange?.(transform.k)
  }, [transform.k, onZoomChange])

  const { features, contextFeatures, fixedPlaced, baseProjection, baseScale, worldWidthPx, wrapEnabled } = useMemo(() => {
    const fc = mode.sourceFeatures ?? countryFeatures
    const allowed = new Set(mode.countries.map((c) => c.iso))
    const isMultiContinent = !mode.sourceFeatures && mode.category === 'continent'
    const filtered = fc.features.filter((f) => {
      const iso = padIso(f.id)
      if (mode.excludeFromMap.has(iso)) return false
      if (isMultiContinent) return true
      return allowed.has(iso)
    })
    const fixedPlaced = new Set<string>()
    if (isMultiContinent) {
      for (const f of filtered) {
        const iso = padIso(f.id)
        if (isInvalidIso(iso)) continue
        if (!allowed.has(iso)) fixedPlaced.add(iso)
      }
    }
    const fitFeatures = isMultiContinent
      ? filtered.filter((f) => allowed.has(padIso(f.id)))
      : filtered
    const fitFc = fitFeatures.length > 0 ? fitFeatures : filtered
    const ctxFeatures = mode.contextFeatures?.features ?? []
    // Fit op de unie van quiz-features + context, zodat de hele context zichtbaar is.
    const fitUnion = ctxFeatures.length > 0 ? [...fitFc, ...ctxFeatures] : fitFc
    const proj = mode.createProjection()
    const fitTarget =
      mode.fitBbox ??
      ({ type: 'FeatureCollection', features: fitUnion } as const)
    proj.fitExtent(
      [
        [10, 10],
        [WIDTH - 10, HEIGHT - 10],
      ],
      fitTarget,
    )
    const wrapEnabled = !mode.sourceFeatures && mode.interaction === 'pan'
    const worldWidthPx = wrapEnabled ? proj.scale() * 2 * Math.PI : 0
    return {
      features: filtered,
      contextFeatures: ctxFeatures,
      fixedPlaced,
      baseProjection: proj,
      baseScale: proj.scale(),
      worldWidthPx,
      wrapEnabled,
    }
  }, [mode])

  const projection = useMemo(() => {
    if (mode.interaction === 'rotate') {
      baseProjection.rotate(rotation)
      baseProjection.scale(baseScale * scale)
    }
    return baseProjection
  }, [baseProjection, baseScale, mode.interaction, rotation, scale])

  const pathGen = useMemo(() => geoPath(projection), [projection])

  const precomputed = useMemo(() => {
    return features.map((f) => {
      const iso = padIso(f.id)
      const d = pathGen(f) ?? ''
      let centroidTarget: Feature<Geometry> | { type: 'Polygon'; coordinates: number[][][] } = f
      if (f.geometry.type === 'MultiPolygon') {
        let bestArea = -Infinity
        for (const polyCoords of f.geometry.coordinates) {
          const sub = { type: 'Polygon' as const, coordinates: polyCoords }
          const a = Math.abs(pathGen.area({ type: 'Feature', properties: {}, geometry: sub }))
          if (a > bestArea) {
            bestArea = a
            centroidTarget = sub
          }
        }
      }
      const [cx, cy] = pathGen.centroid(centroidTarget as never)
      return { iso, d, cx, cy, hasCentroid: Number.isFinite(cx) && Number.isFinite(cy) }
    })
  }, [features, pathGen, rotation, scale])

  const isoToName = useMemo(
    () => new Map(mode.countries.map((c) => [c.iso, c.name])),
    [mode],
  )

  const contextPathElements = useMemo(() => {
    if (contextFeatures.length === 0) return null
    return contextFeatures.map((f, i) => {
      const d = pathGen(f) ?? ''
      if (!d) return null
      return (
        <path
          key={`ctx-${i}`}
          d={d}
          className="country country--fixed"
          vectorEffect="non-scaling-stroke"
        />
      )
    })
  }, [contextFeatures, pathGen])

  const countryPathElements = useMemo(
    () =>
      precomputed.map(({ iso, d }, i) => {
        if (!d) return null
        const isFixed = fixedPlaced.has(iso)
        const invalid = isInvalidIso(iso)
        const isPlaced = !!placed[iso] || isFixed
        const interactive = !isFixed && !invalid
        return (
          <path
            key={`${iso}-${i}`}
            d={d}
            data-iso={interactive ? iso : undefined}
            className={`country${isPlaced ? ' country--placed' : ''}${
              isFixed ? ' country--fixed' : ''
            }`}
            vectorEffect="non-scaling-stroke"
          />
        )
      }),
    [precomputed, placed, fixedPlaced],
  )

  const projectedMarkers = useMemo(() => {
    const isGlobe = mode.interaction === 'rotate'
    const center: [number, number] = isGlobe ? [-rotation[0], -rotation[1]] : [0, 0]
    return Object.entries(mode.markers)
      .map(([iso, lonLat]) => {
        if (isGlobe && geoDistance(lonLat, center) > Math.PI / 2) return null
        const xy = projection(lonLat)
        if (!xy || !Number.isFinite(xy[0]) || !Number.isFinite(xy[1])) return null
        return { iso, x: xy[0], y: xy[1] }
      })
      .filter((m): m is { iso: string; x: number; y: number } => m !== null)
  }, [projection, mode.markers, mode.interaction, rotation])

  useEffect(() => {
    if (mode.interaction !== 'pan') return
    const svgEl = svgRef.current
    if (!svgEl) return
    const sel = select(svgEl)
    const z = zoom<SVGSVGElement, unknown>()
      .scaleExtent([1, 500])
      .translateExtent(
        wrapEnabled
          ? [
              [-worldWidthPx, 0],
              [worldWidthPx + WIDTH, HEIGHT],
            ]
          : [
              [0, 0],
              [WIDTH, HEIGHT],
            ],
      )
      .on('zoom', (event) => {
        setTransform(event.transform)
      })
    sel.call(z)
    sel.call(z.transform, zoomIdentity)
    zoomBehaviorRef.current = z
    return () => {
      sel.on('.zoom', null)
      zoomBehaviorRef.current = null
    }
  }, [mode.id, mode.interaction, wrapEnabled, worldWidthPx])

  useImperativeHandle(
    ref,
    () => {
      const locateCentroid = (iso: string): [number, number] | null => {
        const f = features.find((feat) => padIso(feat.id) === iso)
        if (f) {
          let target: { type: 'Polygon'; coordinates: number[][][] } | typeof f = f
          if (f.geometry.type === 'MultiPolygon') {
            let bestArea = -Infinity
            for (const polyCoords of f.geometry.coordinates) {
              const sub = { type: 'Polygon' as const, coordinates: polyCoords }
              const a = Math.abs(pathGen.area({ type: 'Feature', properties: {}, geometry: sub }))
              if (a > bestArea) {
                bestArea = a
                target = sub
              }
            }
          }
          const [cx, cy] = pathGen.centroid(target as never)
          if (Number.isFinite(cx) && Number.isFinite(cy)) return [cx, cy]
        }
        const m = projectedMarkers.find((mk) => mk.iso === iso)
        if (m) return [m.x, m.y]
        return null
      }
      const wrapOffsetsX = wrapEnabled ? [-worldWidthPx, 0, worldWidthPx] : [0]
      const pickNearestX = (cx: number, viewCenterX: number): number => {
        let bestDx = wrapOffsetsX[0]
        let bestDist = Math.abs(cx + bestDx - viewCenterX)
        for (const dx of wrapOffsetsX) {
          const dist = Math.abs(cx + dx - viewCenterX)
          if (dist < bestDist) {
            bestDist = dist
            bestDx = dx
          }
        }
        return cx + bestDx
      }
      return {
        isCountryVisible: (iso) => {
          const svgEl = svgRef.current
          if (!svgEl) return false
          const pos = locateCentroid(iso)
          if (!pos) return false
          const [cx, cy] = pos
          const cur = readZoomTransform(svgEl)
          return wrapOffsetsX.some((dx) => {
            const sx = cur.k * (cx + dx) + cur.x
            const sy = cur.k * cy + cur.y
            return sx >= 0 && sx <= WIDTH && sy >= 0 && sy <= HEIGHT
          })
        },
        zoomToCountry: (iso) => {
          const svgEl = svgRef.current
          const z = zoomBehaviorRef.current
          if (!svgEl || !z) return
          const pos = locateCentroid(iso)
          if (!pos) return
          const [cx, cy] = pos
          const cur = readZoomTransform(svgEl)
          const viewCenterX = (WIDTH / 2 - cur.x) / cur.k
          const targetX = pickNearestX(cx, viewCenterX)
          const newK = Math.min(500, Math.max(cur.k * 2.5, 4))
          const offsetX = (Math.random() - 0.5) * WIDTH * 0.6
          const offsetY = (Math.random() - 0.5) * HEIGHT * 0.6
          const tx = WIDTH / 2 + offsetX - newK * targetX
          const ty = HEIGHT / 2 + offsetY - newK * cy
          const target = zoomIdentity.translate(tx, ty).scale(newK)
          select(svgEl).transition().duration(450).call(z.transform, target)
        },
        resetZoom: () => {
          const svgEl = svgRef.current
          const z = zoomBehaviorRef.current
          if (!svgEl || !z) return
          select(svgEl).transition().duration(450).call(z.transform, zoomIdentity)
        },
      }
    },
    [features, pathGen, projectedMarkers, wrapEnabled, worldWidthPx],
  )

  const dragStart = useRef<
    { x: number; y: number; rotation: [number, number, number] } | null
  >(null)

  const handlePointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if (mode.interaction !== 'rotate') return
    if (event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    dragStart.current = { x: event.clientX, y: event.clientY, rotation }
  }

  const handlePointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    if (mode.interaction !== 'rotate' || !dragStart.current) return
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    const dx = event.clientX - dragStart.current.x
    const dy = event.clientY - dragStart.current.y
    const sens = 0.25 / scale
    const lambda = dragStart.current.rotation[0] + dx * sens
    const phi = Math.max(-90, Math.min(90, dragStart.current.rotation[1] - dy * sens))
    setRotation([lambda, phi, 0])
  }

  const handlePointerUp = (event: React.PointerEvent<SVGSVGElement>) => {
    if (mode.interaction !== 'rotate') return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    dragStart.current = null
  }

  useEffect(() => {
    if (mode.interaction !== 'rotate') return
    const svgEl = svgRef.current
    if (!svgEl) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const factor = Math.exp(-event.deltaY * 0.0015)
      setScale((s) => Math.max(1, Math.min(8, s * factor)))
    }
    svgEl.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      svgEl.removeEventListener('wheel', onWheel)
    }
  }, [mode.interaction])

  const inverseScale = mode.interaction === 'pan' ? 1 / transform.k : 1

  const labelFontSize =
    mode.interaction === 'pan'
      ? Math.min(2, 16 / Math.max(transform.k, 1))
      : 2

  const labelElements = useMemo(
    () =>
      precomputed.map(({ iso, cx, cy, hasCentroid }, i) => {
        if (!placed[iso]) return null
        if (mode.markers[iso]) return null
        if (!hasCentroid) return null
        return (
          <g key={`${iso}-${i}`} transform={`translate(${cx} ${cy})`}>
            <text
              className="country-label"
              textAnchor="middle"
              dominantBaseline="middle"
              style={{ fontSize: `${labelFontSize}px` }}
            >
              {isoToName.get(iso) ?? placed[iso]}
            </text>
          </g>
        )
      }),
    [precomputed, placed, isoToName, mode.markers, labelFontSize],
  )

  const markerElements = useMemo(() => {
    const r = 5 * inverseScale
    return projectedMarkers.map((m) => {
      const isPlaced = !!placed[m.iso]
      return (
        <g key={m.iso} transform={`translate(${m.x} ${m.y})`}>
          <circle
            r={r}
            data-iso={m.iso}
            className={`marker${isPlaced ? ' marker--placed' : ''}`}
            vectorEffect="non-scaling-stroke"
          />
          {isPlaced && (
            <g
              transform={`translate(${8 * inverseScale} ${-8 * inverseScale}) scale(${inverseScale})`}
            >
              <text className="country-label" textAnchor="start" dominantBaseline="middle">
                {isoToName.get(m.iso) ?? placed[m.iso]}
              </text>
            </g>
          )}
        </g>
      )
    })
  }, [projectedMarkers, placed, isoToName, inverseScale])

  if (mode.interaction === 'rotate') {
    const spherePath = pathGen(SPHERE) ?? ''
    const graticulePath = pathGen(geoGraticule10()) ?? ''
    return (
      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="map map--globe"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <path d={spherePath} className="globe__sphere" />
        <path d={graticulePath} className="globe__graticule" />
        <g className="map__countries">{countryPathElements}</g>
        <path d={spherePath} className="globe__outline" />
        <g className="map__labels">{labelElements}</g>
        <g className="map__markers">{markerElements}</g>
      </svg>
    )
  }

  const wrapOffsets = wrapEnabled ? [-1, 0, 1] : [0]

  const handleClick = onCountryClick
    ? (e: React.MouseEvent<SVGSVGElement>) => {
        const el = (e.target as Element).closest('[data-iso]')
        const iso = el?.getAttribute('data-iso')
        if (iso) onCountryClick(iso)
      }
    : undefined

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className={`map${onCountryClick ? ' map--browse' : ''}`}
      onClick={handleClick}
    >
      <rect width={WIDTH} height={HEIGHT} className="map__sea" />
      <g className="map__zoomable" transform={transform.toString()}>
        {wrapOffsets.map((offset) => (
          <g key={offset} transform={`translate(${offset * worldWidthPx} 0)`}>
            {contextPathElements && (
              <g className="map__context">{contextPathElements}</g>
            )}
            <g className="map__countries">{countryPathElements}</g>
            <g className="map__labels">{labelElements}</g>
            <g className="map__markers">{markerElements}</g>
          </g>
        ))}
      </g>
    </svg>
  )
})

export default MapView
