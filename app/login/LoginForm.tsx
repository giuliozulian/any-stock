'use client'

import { useActionState, useId, useState } from 'react'
import { login } from './actions'
import type { LoginState } from './state'
import styles from './LoginForm.module.css'

export function LoginForm({ next, action = login }: { next: string; action?: (previous: LoginState, formData: FormData) => Promise<LoginState> }) {
  const [state, formAction, pending] = useActionState(action, { error: null })
  const [showPassword, setShowPassword] = useState(false)
  const errorId = useId()
  const invalid = state.error ? { 'aria-invalid': true, 'aria-describedby': errorId } : {}

  return (
    <form action={formAction} className={styles.form}>
      <input type="hidden" name="next" value={next} />
      <label className={styles.field}>
        <span>Email</span>
        <input name="email" type="email" autoComplete="email" inputMode="email" autoCapitalize="none" spellCheck={false} autoFocus required className={styles.input} {...invalid} />
      </label>
      <label className={styles.field}>
        <span>Password</span>
        <span className={styles.passwordWrap}>
          <input name="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" required className={`${styles.input} ${styles.passwordInput}`} {...invalid} />
          <button type="button" className={styles.toggle} aria-pressed={showPassword} onClick={() => setShowPassword((v) => !v)}>
            {showPassword ? 'Nascondi password' : 'Mostra password'}
          </button>
        </span>
      </label>
      {state.error && (
        <p role="alert" id={errorId} className={styles.error}>
          {state.error}
        </p>
      )}
      <button type="submit" disabled={pending} className={styles.button}>
        {pending ? 'Entro…' : 'Entra'}
      </button>
    </form>
  )
}
