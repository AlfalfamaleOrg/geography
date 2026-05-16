import { HELP_DRAG_LABEL, type Country } from '../data/modes'

type Props = {
  labels: Country[]
  draggingIso: string | null
  wrongIso: string | null
  offScreenIso: string | null
  topIso: string | null
  onDragStart: (label: Country, clientX: number, clientY: number, offsetY: number) => void
  onDragMove: (clientX: number, clientY: number) => void
  onDragEnd: () => void
}

const computeOffsetY = (pointerType: string): number =>
  pointerType === 'touch' ? -44 : 0

export default function LabelTray({
  labels,
  draggingIso,
  wrongIso,
  offScreenIso,
  topIso,
  onDragStart,
  onDragMove,
  onDragEnd,
}: Props) {
  const handlePointerDown = (label: Country) => (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    onDragStart(label, event.clientX, event.clientY, computeOffsetY(event.pointerType))
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    onDragMove(event.clientX, event.clientY)
  }

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    onDragEnd()
  }

  return (
    <aside className="tray" aria-label="Te plaatsen landen">
      <div
        className="help-zone"
        data-help-target="true"
        aria-label="Hulp-zone: sleep een land hier, of pak de handle om het antwoord te onthullen"
      >
        <strong>Hulp</strong>
        <span
          className="label__handle help-zone__handle"
          aria-label="Sleep om antwoord te onthullen"
          onPointerDown={handlePointerDown(HELP_DRAG_LABEL)}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          ≡
        </span>
      </div>
      <div className="tray__inner">
        {labels.map((label) => {
          const isDragging = draggingIso === label.iso
          const isWrong = wrongIso === label.iso
          const isOffScreen = offScreenIso === label.iso
          const isTop = topIso === label.iso
          const cls = [
            'label',
            isDragging ? 'label--dragging' : '',
            isWrong ? 'label--wrong' : '',
            isOffScreen ? 'label--offscreen' : '',
            isTop ? 'label--top' : '',
          ]
            .filter(Boolean)
            .join(' ')
          return (
            <div key={label.iso} className={cls}>
              <span className="label__text">{label.name}</span>
              {isTop && <span className="label__bonus">+2</span>}
              <span
                className="label__handle"
                aria-label="Sleep om te plaatsen"
                onPointerDown={handlePointerDown(label)}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
              >
                ≡
              </span>
            </div>
          )
        })}
        {labels.length === 0 && <p className="tray__done">Klaar! Alle landen geplaatst.</p>}
      </div>
    </aside>
  )
}
