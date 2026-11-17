import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('@/app/login/actions', () => ({ login: vi.fn() }))

import { LoginForm } from '@/app/login/LoginForm'
import type { LoginState } from '@/app/login/state'

const fill = (email: string, password: string) => {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } })
}

describe('LoginForm', () => {
  it('has labelled email and password fields and carries the destination in a hidden field', () => {
    const { container } = render(<LoginForm next="/scanner" action={vi.fn()} />)
    expect(screen.getByLabelText('Email')).toHaveAttribute('type', 'email')
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password')
    expect(container.querySelector('input[name="next"]')).toHaveValue('/scanner')
    expect(screen.getByRole('button', { name: 'Entra' })).toBeEnabled()
  })

  it('submits the typed values to the action', async () => {
    const action = vi.fn<(prev: LoginState, data: FormData) => Promise<LoginState>>(async () => ({ error: null }))
    render(<LoginForm next="/scanner" action={action} />)
    fill('me@example.com', 'pw')
    fireEvent.click(screen.getByRole('button', { name: 'Entra' }))
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1))
    const data = action.mock.calls[0][1]
    expect(data.get('email')).toBe('me@example.com')
    expect(data.get('password')).toBe('pw')
    expect(data.get('next')).toBe('/scanner')
  })

  it('shows the error from the action as an alert', async () => {
    const action = vi.fn(async (): Promise<LoginState> => ({ error: 'Email o password errati.' }))
    render(<LoginForm next="/" action={action} />)
    fill('me@example.com', 'bad')
    fireEvent.click(screen.getByRole('button', { name: 'Entra' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Email o password errati.')
  })

  it('disables the button while signing in', async () => {
    let release: (s: LoginState) => void = () => {}
    const action = vi.fn(() => new Promise<LoginState>((resolve) => { release = resolve }))
    render(<LoginForm next="/" action={action} />)
    fill('me@example.com', 'pw')
    fireEvent.click(screen.getByRole('button', { name: 'Entra' }))
    expect(await screen.findByRole('button', { name: 'Entro…' })).toBeDisabled()
    release({ error: null })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Entra' })).toBeEnabled())
  })

  it('shows no alert before anything is submitted', () => {
    render(<LoginForm next="/" action={vi.fn()} />)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('puts the cursor in the email field, with the attributes a password manager and a phone keyboard expect', () => {
    render(<LoginForm next="/" action={vi.fn()} />)
    const email = screen.getByLabelText('Email')
    expect(email).toHaveFocus()
    expect(email).toHaveAttribute('autocomplete', 'email')
    expect(email).toHaveAttribute('inputmode', 'email')
    expect(email).toHaveAttribute('autocapitalize', 'none')
    expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'current-password')
  })

  it('lets the visitor show and hide the password', () => {
    render(<LoginForm next="/" action={vi.fn()} />)
    const field = screen.getByLabelText('Password')
    const toggle = screen.getByRole('button', { name: 'Mostra password' })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    expect(field).toHaveAttribute('type', 'password')

    fireEvent.click(toggle)
    expect(field).toHaveAttribute('type', 'text')
    expect(screen.getByRole('button', { name: 'Nascondi password' })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'Nascondi password' }))
    expect(field).toHaveAttribute('type', 'password')
  })

  it('keeps the typed password when it is shown or hidden', () => {
    render(<LoginForm next="/" action={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret-pw' } })
    fireEvent.click(screen.getByRole('button', { name: 'Mostra password' }))
    expect(screen.getByLabelText('Password')).toHaveValue('secret-pw')
  })

  it('does not submit the form when the toggle is pressed', () => {
    const action = vi.fn()
    render(<LoginForm next="/" action={action} />)
    fireEvent.click(screen.getByRole('button', { name: 'Mostra password' }))
    expect(action).not.toHaveBeenCalled()
  })

  it('ties the error to both fields for screen readers', async () => {
    const action = vi.fn(async (): Promise<LoginState> => ({ error: 'Email o password errati.' }))
    render(<LoginForm next="/" action={action} />)
    fill('me@example.com', 'bad')
    fireEvent.click(screen.getByRole('button', { name: 'Entra' }))
    const alert = await screen.findByRole('alert')
    for (const field of [screen.getByLabelText('Email'), screen.getByLabelText('Password')]) {
      expect(field).toHaveAttribute('aria-invalid', 'true')
      expect(field).toHaveAttribute('aria-describedby', alert.id)
    }
  })

  it('does not mark the fields invalid before an error', () => {
    render(<LoginForm next="/" action={vi.fn()} />)
    expect(screen.getByLabelText('Email')).not.toHaveAttribute('aria-invalid', 'true')
  })
})
