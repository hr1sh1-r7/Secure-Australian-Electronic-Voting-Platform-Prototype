// Sign-in state and the SR-12 inactivity timeout, shown in the top bar.
// The server enforces the 10-minute limit; this only shows it and logs out cleanly.
import { state, api, h, clear } from './core.js'

const KEEPALIVE_MS = 60 * 1000
const WARN_MS = 60 * 1000
let lastActivity = Date.now()
let lastKeepAlive = 0
let ticker = null

export async function checkSession() {
  if (!state.token) {
    state.user = null
    return null
  }
  const res = await api('/api/session/status', { auth: 'session' })
  if (!res.ok) {
    forget(res.data && res.data.reason === 'idle_timeout' ? 'timeout' : 'expired')
    return null
  }
  state.user = res.data
  lastKeepAlive = Date.now()
  startIdleTimer()
  return state.user
}

export function startSession(token) {
  state.token = token
  sessionStorage.setItem('sessionToken', token)
  lastActivity = Date.now()
  return checkSession()
}

const ENDED = {
  timeout: 'You were signed out after 10 minutes without activity (SR-12).',
  expired: 'Your session has ended. Please sign in again.',
  logout: 'You have signed out.'
}

function forget(reason) {
  state.token = null
  state.user = null
  sessionStorage.removeItem('sessionToken')
  stopIdleTimer()
  if (reason) state.notice = ENDED[reason]
  renderSessionBar()
}

export async function signOut(reason = 'logout') {
  if (state.token) await api('/api/session/logout', { method: 'POST', auth: 'session' })
  forget(reason)
  location.hash = '#/sign-in'
}

// ---- SR-12 idle timer ---------------------------------------------------
function onActivity() {
  lastActivity = Date.now()
  document.getElementById('idle-warning').hidden = true
  if (state.token && Date.now() - lastKeepAlive > KEEPALIVE_MS) {
    lastKeepAlive = Date.now()
    api('/api/session/status', { auth: 'session' }).then((res) => {
      if (res.status === 401) {
        forget('expired')
        location.hash = '#/sign-in'
      }
    })
  }
}

;['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'].forEach((ev) =>
  document.addEventListener(ev, onActivity, { passive: true }))

function startIdleTimer() {
  if (ticker) return
  ticker = setInterval(() => {
    if (!state.user) return
    const remaining = state.user.idleTimeoutMs - (Date.now() - lastActivity)
    const idleEl = document.getElementById('idle-time')
    if (idleEl) idleEl.textContent = formatRemaining(remaining)
    const warn = document.getElementById('idle-warning')
    if (remaining <= 0) {
      signOut('timeout')
    } else if (remaining <= WARN_MS) {
      warn.textContent = `You will be signed out in ${Math.ceil(remaining / 1000)} seconds because of inactivity. Move the mouse or press a key to stay signed in.`
      warn.hidden = false
    }
  }, 1000)
}

function stopIdleTimer() {
  clearInterval(ticker)
  ticker = null
  document.getElementById('idle-warning').hidden = true
}

function formatRemaining(ms) {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

const ROLE_NAMES = { voter: 'Voter', admin: 'Election official', auditor: 'Auditor' }
export const roleName = (role) => ROLE_NAMES[role] || role

export function renderSessionBar() {
  const bar = document.getElementById('session-bar')
  if (!state.user) {
    return clear(bar, h('a', { class: 'btn-light', href: '#/sign-in' }, 'Sign in'))
  }
  clear(bar,
    h('span', { class: 'who' }, `${roleName(state.user.role)} (user ${state.user.userId})`),
    h('span', { class: 'idle', title: 'Automatic sign-out after inactivity (SR-12)' },
      'Signs out in ', h('span', { id: 'idle-time' }, formatRemaining(state.user.idleTimeoutMs))),
    h('button', { class: 'btn-light', type: 'button', onclick: () => signOut('logout') }, 'Sign out'))
}
