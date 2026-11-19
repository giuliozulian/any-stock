import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { DropdownMenu } from '@/components/DropdownMenu'

const menu = () => (
  <DropdownMenu label="Filtri" count={2}>
    <a href="/?andamento=su">Oggi in rialzo</a>
  </DropdownMenu>
)

describe('DropdownMenu', () => {
  it('is closed at first and shows how many filters are on', () => {
    render(menu())
    const button = screen.getByRole('button', { name: /filtri/i })
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(button).toHaveTextContent('2')
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('opens on click and closes after a click outside', () => {
    render(menu())
    fireEvent.click(screen.getByRole('button', { name: /filtri/i }))
    expect(screen.getByRole('link', { name: 'Oggi in rialzo' })).toBeInTheDocument()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('closes with Escape and when a choice is followed', () => {
    render(menu())
    const button = screen.getByRole('button', { name: /filtri/i })
    fireEvent.click(button)
    fireEvent.keyDown(button, { key: 'Escape' })
    expect(screen.queryByRole('link')).not.toBeInTheDocument()

    fireEvent.click(button)
    fireEvent.click(screen.getByRole('link', { name: 'Oggi in rialzo' }))
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})
