'use client'

import { useState, type CSSProperties, type ReactNode } from 'react'
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import styles from './SortableWatchlist.module.css'

export interface SortableRow {
  symbol: string
  node: ReactNode
}

interface Props {
  rows: SortableRow[]
  // False while the list is sorted or filtered: a position inside a subset means nothing.
  canReorder: boolean
  listClassName?: string
  rowClassName?: string
}

function Handle({ symbol, ref, ...rest }: { symbol: string; ref?: React.Ref<HTMLButtonElement> } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button ref={ref} type="button" className={styles.handle} aria-label={`Sposta ${symbol}`} {...rest}>
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="currentColor">
        {[4, 8, 12].flatMap((y) => [5, 11].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.3" />))}
      </svg>
    </button>
  )
}

function SortableItem({ row, className }: { row: SortableRow; className?: string }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: row.symbol })
  const style: CSSProperties = { transform: CSS.Transform.toString(transform), transition, position: 'relative' }
  return (
    <li ref={setNodeRef} style={style} className={[className, isDragging ? styles.dragging : ''].filter(Boolean).join(' ')} data-sortable>
      <Handle symbol={row.symbol} ref={setActivatorNodeRef} {...attributes} {...listeners} />
      {row.node}
    </li>
  )
}

export function SortableWatchlist({ rows, canReorder, listClassName, rowClassName }: Props) {
  const incoming = rows.map((r) => r.symbol)
  const key = incoming.join(',')
  const [order, setOrder] = useState(incoming)
  const [seen, setSeen] = useState(key)
  const [error, setError] = useState<string | null>(null)
  // The server sent another list (a reload, an addition, a removal): follow it.
  if (key !== seen) {
    setSeen(key)
    setOrder(incoming)
  }

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))
  const bySymbol = new Map(rows.map((r) => [r.symbol, r]))
  const shown = order.map((s) => bySymbol.get(s)).filter((r): r is SortableRow => Boolean(r))

  if (!canReorder) {
    return (
      <ul className={listClassName}>
        {shown.map((r) => (
          <li key={r.symbol} className={rowClassName}>
            {r.node}
          </li>
        ))}
      </ul>
    )
  }

  async function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return
    const previous = order
    const next = arrayMove(previous, previous.indexOf(String(active.id)), previous.indexOf(String(over.id)))
    setOrder(next)
    setError(null)
    try {
      const res = await fetch('/api/stocks/order', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ symbols: next }) })
      if (!res.ok) throw new Error(String(res.status))
    } catch {
      setOrder(previous)
      setError('Non sono riuscito a salvare l’ordine: riprova.')
    }
  }

  return (
    <>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <DndContext id="watchlist-order" sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={order} strategy={verticalListSortingStrategy}>
          <ul className={listClassName}>
            {shown.map((r) => (
              <SortableItem key={r.symbol} row={r} className={rowClassName} />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
    </>
  )
}
