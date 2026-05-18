import { useEffect, useMemo, useRef, useState } from 'react'
import MapView, { type MapViewHandle } from './components/MapView'
import LabelTray from './components/LabelTray'
import {
  HELP_DRAG_LABEL,
  findCountryMode,
  loadGameMode,
  modeRefs,
  worldMode,
  type Country,
  type GameMode,
  type GameModeRef,
} from './data/modes'
import './App.css'

type DragState = {
  label: Country
  x: number
  y: number
  offsetY: number
}

type HighScore = {
  id?: number
  name: string
  score: number
  duration?: number
  mode: string
  date: string
}

const FALLBACK_DURATION = 3600

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

type Phase = 'start' | 'playing' | 'complete'

const NAME_KEY = 'geography-test:lastName'
const START_SCORE = 0
const START_MULTIPLIER = 1

function shuffle<T>(arr: T[]): T[] {
  const copy = arr.slice()
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

async function fetchHighScores(modeId: string): Promise<HighScore[]> {
  try {
    const resp = await fetch(
      `/api/highscores?mode=${encodeURIComponent(modeId)}`,
    )
    if (!resp.ok) return []
    const data = (await resp.json()) as { scores?: HighScore[] }
    return data.scores ?? []
  } catch {
    return []
  }
}

async function postHighScore(entry: {
  name: string
  score: number
  duration: number
  mode: string
}): Promise<HighScore | null> {
  try {
    const resp = await fetch('/api/highscores', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(entry),
    })
    if (!resp.ok) return null
    const data = (await resp.json()) as { entry?: HighScore }
    return data.entry ?? null
  } catch {
    return null
  }
}

export default function App() {
  const [phase, setPhase] = useState<Phase>('start')
  const [playerName, setPlayerName] = useState<string>(
    () => localStorage.getItem(NAME_KEY) ?? '',
  )
  const [mode, setMode] = useState<GameMode>(worldMode)
  const [modeLoading, setModeLoading] = useState(false)
  const [order, setOrder] = useState<Country[]>(() => shuffle(worldMode.countries))
  const [placed, setPlaced] = useState<Record<string, string>>({})
  const [drag, setDrag] = useState<DragState | null>(null)
  const [wrongIso, setWrongIso] = useState<string | null>(null)
  const [offScreenIso, setOffScreenIso] = useState<string | null>(null)
  const [score, setScore] = useState(START_SCORE)
  const [multiplier, setMultiplier] = useState(START_MULTIPLIER)
  const [highScores, setHighScores] = useState<HighScore[]>([])
  const [myEntryId, setMyEntryId] = useState<number | null>(null)
  const [labelsHidden, setLabelsHidden] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [lastDuration, setLastDuration] = useState<number | null>(null)
  const mapRef = useRef<MapViewHandle>(null)

  useEffect(() => {
    if (phase !== 'playing') return
    const id = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(id)
  }, [phase])

  useEffect(() => {
    let cancelled = false
    fetchHighScores(mode.id).then((scores) => {
      if (!cancelled) setHighScores(scores)
    })
    return () => {
      cancelled = true
    }
  }, [mode.id])

  const elapsedSec =
    phase === 'playing' && startedAt
      ? Math.max(0, Math.floor((now - startedAt) / 1000))
      : lastDuration ?? 0

  const remaining = useMemo(() => order.filter((c) => !placed[c.iso]), [order, placed])
  const topIso = remaining.length > 0 ? remaining[0].iso : null
  const total = mode.countries.length
  const done = Object.keys(placed).length

  const completeGame = () => {
    const duration = startedAt ? Math.round((Date.now() - startedAt) / 1000) : 0
    setLastDuration(duration)
    setMyEntryId(null)
    setPhase('complete')
    const payload = {
      name: playerName.trim() || 'anoniem',
      score,
      duration,
      mode: mode.id,
    }
    postHighScore(payload).then(async (saved) => {
      if (saved?.id !== undefined) {
        setMyEntryId(saved.id)
        const fresh = await fetchHighScores(payload.mode)
        setHighScores(fresh)
      } else {
        console.error('Highscore opslaan mislukt')
      }
    })
  }

  useEffect(() => {
    if (phase !== 'playing') return
    if (total === 0 || done < total) return
    completeGame()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, done, total])

  const handleStop = () => {
    if (phase !== 'playing') return
    completeGame()
  }

  const handleDragStart = (label: Country, x: number, y: number, offsetY: number) => {
    setDrag({ label, x, y, offsetY })
  }

  const handleDragMove = (x: number, y: number) => {
    setDrag((prev) => (prev ? { ...prev, x, y } : null))
  }

  const flashOffScreen = (iso: string) => {
    setOffScreenIso(iso)
    window.setTimeout(() => {
      setOffScreenIso((w) => (w === iso ? null : w))
    }, 800)
  }

  const handleDragEnd = () => {
    if (!drag) return
    const el = document.elementFromPoint(drag.x, drag.y + drag.offsetY) as Element | null
    const isHelpDrag = drag.label.iso === HELP_DRAG_LABEL.iso

    if (isHelpDrag) {
      const iso = el?.getAttribute('data-iso') ?? null
      if (iso) {
        const country = mode.countries.find((c) => c.iso === iso)
        if (country && !placed[iso]) {
          setMultiplier(START_MULTIPLIER)
          setPlaced((prev) => ({ ...prev, [iso]: country.name }))
        }
      }
      setDrag(null)
      return
    }

    const helpEl = el?.closest('[data-help-target="true"]')
    if (helpEl) {
      setMultiplier((m) => Math.max(1, m - 1))
      const visible = mapRef.current?.isCountryVisible(drag.label.iso) ?? true
      if (visible) {
        mapRef.current?.zoomToCountry(drag.label.iso)
      } else {
        mapRef.current?.resetZoom()
        flashOffScreen(drag.label.iso)
      }
      setDrag(null)
      return
    }

    const iso = el?.getAttribute('data-iso') ?? null
    if (iso && iso === drag.label.iso) {
      setScore((s) => s + multiplier)
      const isTop = drag.label.iso === topIso
      setMultiplier((m) => m + (isTop ? 2 : 1))
      setPlaced((prev) => ({ ...prev, [iso]: drag.label.name }))
    } else if (iso) {
      setMultiplier((m) => Math.max(1, m - 1))
      const wrong = drag.label.iso
      setWrongIso(wrong)
      window.setTimeout(() => {
        setWrongIso((w) => (w === wrong ? null : w))
      }, 500)
    }
    setDrag(null)
  }

  const resetGameState = (nextMode: GameMode) => {
    setPlaced({})
    setOrder(shuffle(nextMode.countries))
    setWrongIso(null)
    setOffScreenIso(null)
    setScore(START_SCORE)
    setMultiplier(START_MULTIPLIER)
    setDrag(null)
  }

  const handleReset = () => {
    resetGameState(mode)
  }

  const handleBrowseClick = (iso: string) => {
    const country = findCountryMode(iso)
    if (!country) return
    void handleSelectModeRef(country)
  }

  const handleNavigateModeId = (id: string) => {
    if (id === mode.id) return
    const ref = modeRefs.find((m) => m.id === id)
    if (ref) void handleSelectModeRef(ref)
  }

  const handleSelectModeRef = async (next: GameModeRef) => {
    if (next.id === mode.id) return
    setModeLoading(true)
    try {
      const loaded = await loadGameMode(next.id)
      setMode(loaded)
      resetGameState(loaded)
      if (phase === 'complete') setPhase('start')
    } catch (err) {
      console.error('Mode laden mislukt:', err)
    } finally {
      setModeLoading(false)
    }
  }

  const handleStart = () => {
    const trimmed = playerName.trim()
    try {
      localStorage.setItem(NAME_KEY, trimmed)
    } catch {
      // ignore
    }
    resetGameState(mode)
    setStartedAt(Date.now())
    setLastDuration(null)
    setNow(Date.now())
    setPhase('playing')
  }

  const handleBackToStart = () => {
    resetGameState(mode)
    setPhase('start')
  }

  const hint =
    mode.interaction === 'rotate'
      ? 'Sleep om de globe te draaien, scroll om te zoomen. Sleep een naam op een land.'
      : 'Scroll om te zoomen, sleep om te pannen. Sleep een naam op een land.'

  const modeHighScores = highScores

  return (
    <div
      className={`app${drag ? ' app--dragging' : ''}${
        labelsHidden ? ' app--labels-hidden' : ''
      }`}
    >
      <header className={`topbar${menuOpen ? ' topbar--menu-open' : ''}`}>
        <h1 className="topbar__title topbar__title--main">Geografie test</h1>
        {phase === 'playing' && (
          <div className="topbar__inline">
            <span className="score">
              {done} / {total}
            </span>
            <span
              className={`score score--points${score < 0 ? ' score--negative' : ''}`}
              title="Score: goed land voegt teller toe"
            >
              score {score}
            </span>
            <span
              className="score score--multiplier"
              title="Teller: +1 goed, -1 fout, -1 zoom-hulp, reset bij antwoord"
            >
              +{multiplier}
            </span>
            <span className="score score--timer" title="Speeltijd">
              {formatDuration(elapsedSec)}
            </span>
          </div>
        )}
        <button
          type="button"
          className="hamburger"
          aria-label="Menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
        >
          <span aria-hidden="true">☰</span>
        </button>
        <div className="topbar__menu">
          <h2 className="topbar__title topbar__title--menu">Geografie test</h2>
          <nav className="modes" aria-label="Spelmodus">
            <select
              className="mode-select"
              value={mode.id}
              disabled={modeLoading}
              onChange={(e) => {
                const next = modeRefs.find((m) => m.id === e.target.value)
                if (next) handleSelectModeRef(next)
              }}
            >
              <optgroup label="Continenten">
                {modeRefs
                  .filter((m) => m.category === 'continent')
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
              </optgroup>
              <optgroup label="Landen / regio's">
                {modeRefs
                  .filter((m) => m.category === 'region')
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
              </optgroup>
            </select>
          </nav>
          <div className="topbar__meta">
            {phase === 'playing' && (
              <>
                <button
                  type="button"
                  onClick={() => setLabelsHidden((v) => !v)}
                  className="reset"
                  title="Verberg/toon namen op geplaatste landen"
                >
                  {labelsHidden ? 'Toon namen' : 'Verberg namen'}
                </button>
                <button type="button" onClick={handleReset} className="reset">
                  Opnieuw
                </button>
                <button
                  type="button"
                  onClick={handleStop}
                  className="reset reset--stop"
                  title="Stop het spel nu en sla de huidige score op"
                >
                  Stop
                </button>
              </>
            )}
            {phase !== 'playing' && playerName && (
              <span className="score">speler: {playerName}</span>
            )}
          </div>
        </div>
      </header>
      {phase === 'start' && (
        <section className="screen screen--start">
          <div className="start__nav">
            <Breadcrumb modeId={mode.id} onNavigate={handleNavigateModeId} />
            <div className="start__map">
              <MapView
                mode={mode}
                placed={{}}
                onCountryClick={handleBrowseClick}
              />
              {modeLoading && (
                <div className="start__map-loading">Bezig met laden…</div>
              )}
            </div>
            <p className="start__hint">
              {mode.id === 'world'
                ? 'Klik op een land om in te zoomen op zijn provincies/staten, of klik op Start om de wereldtest te beginnen.'
                : 'Klik op een gebied om dieper te gaan, of start de test op het huidige niveau.'}
            </p>
          </div>
          <div className="screen__panel">
            <h2>Welkom</h2>
            <p className="screen__lead">
              Modus: <strong>{mode.label}</strong> ({mode.countries.length} items)
            </p>
            <label className="field">
              <span>Naam</span>
              <input
                type="text"
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleStart()
                }}
                placeholder="je naam"
                maxLength={20}
                autoFocus
              />
            </label>
            <button
              type="button"
              className="primary"
              onClick={handleStart}
              disabled={modeLoading}
            >
              Start test op {mode.label}
            </button>
          </div>
          <HighScores entries={modeHighScores} modeLabel={mode.label} />
        </section>
      )}
      {phase === 'playing' && (
        <main className="layout">
          <div className="map-wrap">
            <MapView ref={mapRef} mode={mode} placed={placed} />
            <p className="hint">{hint}</p>
          </div>
          <LabelTray
            labels={remaining}
            draggingIso={drag?.label.iso ?? null}
            wrongIso={wrongIso}
            offScreenIso={offScreenIso}
            topIso={topIso}
            onDragStart={handleDragStart}
            onDragMove={handleDragMove}
            onDragEnd={handleDragEnd}
          />
        </main>
      )}
      {phase === 'complete' && (
        <section className="screen screen--complete">
          <div className="screen__panel">
            <h2>Klaar!</h2>
            <p className="screen__lead">
              {playerName || 'anoniem'} — score <strong>{score}</strong> in{' '}
              <strong>{formatDuration(lastDuration ?? 0)}</strong>
            </p>
            <p className="screen__lead screen__lead--muted">
              Modus: {mode.label} ({total} landen)
            </p>
            <button type="button" className="primary" onClick={handleBackToStart}>
              Nieuw spel
            </button>
          </div>
          <HighScores
            entries={modeHighScores}
            modeLabel={mode.label}
            highlightId={myEntryId}
          />
        </section>
      )}
      {drag && (
        <>
          <div
            className="ghost-dot"
            style={{ left: drag.x, top: drag.y + drag.offsetY }}
            aria-hidden="true"
          />
          <div
            className={`ghost${drag.label.iso === HELP_DRAG_LABEL.iso ? ' ghost--help' : ''}`}
            style={{ left: drag.x, top: drag.y + drag.offsetY }}
            aria-hidden="true"
          >
            {drag.label.name}
          </div>
        </>
      )}
    </div>
  )
}

type BreadcrumbProps = {
  modeId: string
  onNavigate: (id: string) => void
}

function Breadcrumb({ modeId, onNavigate }: BreadcrumbProps) {
  const path: GameModeRef[] = []
  let cursor: GameModeRef | undefined = modeRefs.find((m) => m.id === modeId)
  while (cursor) {
    path.unshift(cursor)
    const parentId: string | null = cursor.parent
    cursor = parentId ? modeRefs.find((m) => m.id === parentId) : undefined
  }
  return (
    <nav className="breadcrumb" aria-label="Navigatie">
      {path.map((m, i) => {
        const isCurrent = i === path.length - 1
        return (
          <span key={m.id} className="breadcrumb__item">
            {i > 0 && <span className="breadcrumb__sep" aria-hidden="true">›</span>}
            {isCurrent ? (
              <span className="breadcrumb__current">{m.label}</span>
            ) : (
              <button
                type="button"
                className="breadcrumb__link"
                onClick={() => onNavigate(m.id)}
              >
                {m.label}
              </button>
            )}
          </span>
        )
      })}
    </nav>
  )
}

type HighScoresProps = {
  entries: HighScore[]
  modeLabel: string
  highlightId?: number | null
}

function HighScores({ entries, modeLabel, highlightId }: HighScoresProps) {
  return (
    <div className="highscores">
      <h3>Top 10 — {modeLabel}</h3>
      {entries.length === 0 ? (
        <p className="highscores__empty">Nog geen scores.</p>
      ) : (
        <ol className="highscores__list">
          {entries.map((e, i) => {
            const isHighlight =
              highlightId !== undefined &&
              highlightId !== null &&
              e.id === highlightId
            const dur = e.duration ?? FALLBACK_DURATION
            return (
              <li
                key={e.id ?? `${e.date}-${i}`}
                className={`highscores__item${isHighlight ? ' highscores__item--me' : ''}`}
              >
                <span className="highscores__rank">{i + 1}.</span>
                <span className="highscores__name">{e.name}</span>
                <span className="highscores__time">{formatDuration(dur)}</span>
                <span className="highscores__score">{e.score}</span>
              </li>
            )
          })}
        </ol>
      )}
      <div className="highscores__rules">
        <h4>Hoe werkt de score?</h4>
        <ul>
          <li>Score start op 0, teller op +1.</li>
          <li>
            <strong>Goed land</strong>: score += teller, teller +1.
          </li>
          <li>
            <strong>Bovenste label</strong> (badge +2): teller +2 i.p.v. +1.
          </li>
          <li>
            <strong>Fout land</strong>: teller −1 (min. 1).
          </li>
          <li>
            <strong>Label op hulp</strong> (zoom): teller −1.
          </li>
          <li>
            <strong>Hulp op land</strong> (antwoord): teller terug naar 1, land geplaatst.
          </li>
          <li>
            Bij gelijke score wint de snelste tijd. Oudere entries zonder tijd tellen als 1 uur.
          </li>
        </ul>
      </div>
    </div>
  )
}
