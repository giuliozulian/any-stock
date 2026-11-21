import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

let dnd: { onDragEnd?: (e: { active: { id: string }; over: { id: string } | null }) => void } = {}
vi.mock('@dnd-kit/core', async (orig) => ({
  ...(await orig<typeof import('@dnd-kit/core')>()),
  DndContext: (props: typeof dnd & { children: React.ReactNode }) => {
    dnd = props
    return <>{props.children}</>
  },
}))

import { SortableWatchlist } from '@/components/SortableWatchlist'

const rows = ['AAA', 'BBB', 'CCC'].map((symbol) => ({ symbol, node: <span>{`riga ${symbol}`}</span> }))
const order = () => screen.getAllByText(/^riga /).map((n) => n.textContent!.replace('riga ', ''))
const drop = (active: string, over: string | null) => act(() => dnd.onDragEnd!({ active: { id: active }, over: over ? { id: over } : null }))

describe('SortableWatchlist', () => {
  const fetchMock = vi.fn()
  beforeEach(() => {
    fetchMock.mockReset().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)
  })

  it('shows the rows in the given order, each with a handle named after the stock', () => {
    render(<SortableWatchlist rows={rows} canReorder />)
    expect(order()).toEqual(['AAA', 'BBB', 'CCC'])
    expect(screen.getByRole('button', { name: 'Sposta AAA' })).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
  })

  it('moves a row on drop and saves the whole order', async () => {
    render(<SortableWatchlist rows={rows} canReorder />)
    await drop('AAA', 'CCC')
    expect(order()).toEqual(['BBB', 'CCC', 'AAA'])
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/stocks/order')
    expect(init.method).toBe('PUT')
    expect(JSON.parse(init.body)).toEqual({ symbols: ['BBB', 'CCC', 'AAA'] })
  })

  it('does nothing when dropped on itself or outside the list', async () => {
    render(<SortableWatchlist rows={rows} canReorder />)
    await drop('BBB', 'BBB')
    await drop('BBB', null)
    expect(order()).toEqual(['AAA', 'BBB', 'CCC'])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    ['the server refuses', () => fetchMock.mockResolvedValue({ ok: false })],
    ['the network fails', () => fetchMock.mockRejectedValue(new Error('offline'))],
  ])('puts the row back and says so when %s', async (_name, fail) => {
    fail()
    render(<SortableWatchlist rows={rows} canReorder />)
    await drop('AAA', 'CCC')
    expect(await screen.findByRole('alert')).toHaveTextContent(/non sono riuscito a salvare l’ordine/i)
    expect(order()).toEqual(['AAA', 'BBB', 'CCC'])
  })

  it('has no handles when the list is sorted or filtered', () => {
    render(<SortableWatchlist rows={rows} canReorder={false} />)
    expect(order()).toEqual(['AAA', 'BBB', 'CCC'])
    expect(screen.queryByRole('button', { name: /Sposta/ })).not.toBeInTheDocument()
  })

  it('follows the order the server sends after a reload', () => {
    const { rerender } = render(<SortableWatchlist rows={rows} canReorder />)
    rerender(<SortableWatchlist rows={[rows[2], rows[0], rows[1]]} canReorder />)
    expect(order()).toEqual(['CCC', 'AAA', 'BBB'])
  })
})
