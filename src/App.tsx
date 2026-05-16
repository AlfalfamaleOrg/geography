import { useEffect, useMemo, useRef, useState } from 'react'
import MapView, { type MapViewHandle } from './components/MapView'
import LabelTray from './components/LabelTray'
import { HELP_DRAG_LABEL, modes, worldMode, type Country, type GameMode } from './data/modes'
import './App.css'

type DragState = {
  label: Country
  x: number
  y: number
  offsetY: number
}

type HighScore = {
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

const STORAGE_KEY = 'geography-test:highscores'
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

function loadHighScores(): HighScore[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as HighScore[]) : []
  } catch {
    return []
  }
}

function saveHighScores(list: HighScore[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
  } catch {
    // ignore
  }
}

export default function App() {
  const [phase, setPhase] = useState<Phase>('start')
  const [playerName, setPlayerName] = useState<string>(
    () => localStorage.getItem(NAME_KEY) ?? '',
  )
  const [mode, setMode] = useState<GameMode>(worldMode)
  const [order, setOrder] = useState<Country[]>(() => shuffle(worldMode.countries))
  const [placed, setPlaced] = useState<Record<string, string>>({})
  const [drag, setDrag] = useState<DragState | null>(null)
  const [wrongIso, setWrongIso] = useState<string | null>(null)
  const [offScreenIso, setOffScreenIso] = useState<string | null>(null)
  const [score, setScore] = useState(START_SCORE)
  const [multiplier, setMultiplier] = useState(START_MULTIPLIER)
  const [highScores, setHighScores] = useState<HighScore[]>(() => loadHighScores())
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
    const entry: HighScore = {
      name: playerName.trim() || 'anoniem',
      score,
      duration,
      mode: mode.id,
      date: new Date().toISOString(),
    }
    const updated = [...highScores, entry]
    setHighScores(updated)
    saveHighScores(updated)
    setPhase('complete')
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

  const handleSelectMode = (nextMode: GameMode) => {
    if (nextMode.id === mode.id) return
    setMode(nextMode)
    resetGameState(nextMode)
    if (phase === 'complete') setPhase('start')
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

  const modeHighScores = useMemo(
    () =>
      highScores
        .filter((h) => h.mode === mode.id)
        .sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score
          const da = a.duration ?? FALLBACK_DURATION
          const db = b.duration ?? FALLBACK_DURATION
          return da - db
        })
        .slice(0, 10),
    [highScores, mode.id],
  )

  return (
    <div
      className={`app${drag ? ' app--dragging' : ''}${
        labelsHidden ? ' app--labels-hidden' : ''
      }`}
    >
      <header className={`topbar${menuOpen ? ' topbar--menu-open' : ''}`}>
        <h1>Geografie test</h1>
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
        <div className="topbar__menu" onClick={() => setMenuOpen(false)}>
          <nav className="modes" aria-label="Spelmodus">
            <select
              className="mode-select"
              value={mode.id}
              onChange={(e) => {
                const next = modes.find((m) => m.id === e.target.value)
                if (next) handleSelectMode(next)
              }}
            >
              <optgroup label="Continenten">
                {modes
                  .filter((m) => m.category === 'continent')
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
              </optgroup>
              <optgroup label="Landen / regio's">
                {modes
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
                <span
                  className="score score--multiplier"
                  title="Teller: +1 goed, -1 fout, -1 zoom-hulp, reset bij antwoord"
                >
                  +{multiplier}
                </span>
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
          <div className="screen__panel">
            <h2>Welkom</h2>
            <p className="screen__lead">
              Modus: <strong>{mode.label}</strong> ({mode.countries.length} landen)
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
            <button type="button" className="primary" onClick={handleStart}>
              Start
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
            highlightName={playerName}
            highlightScore={score}
            highlightDuration={lastDuration ?? undefined}
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

type HighScoresProps = {
  entries: HighScore[]
  modeLabel: string
  highlightName?: string
  highlightScore?: number
  highlightDuration?: number
}

function HighScores({
  entries,
  modeLabel,
  highlightName,
  highlightScore,
  highlightDuration,
}: HighScoresProps) {
  return (
    <div className="highscores">
      <h3>Top 10 — {modeLabel}</h3>
      {entries.length === 0 ? (
        <p className="highscores__empty">Nog geen scores.</p>
      ) : (
        <ol className="highscores__list">
          {entries.map((e, i) => {
            const isHighlight =
              highlightName !== undefined &&
              e.name === highlightName &&
              highlightScore !== undefined &&
              e.score === highlightScore &&
              (highlightDuration === undefined || e.duration === highlightDuration)
            const dur = e.duration ?? FALLBACK_DURATION
            return (
              <li
                key={`${e.date}-${i}`}
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
