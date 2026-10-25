// Sign in: real password login (SR-11 lockout) and the quick demo login (SR-12).
import { state, h, api, clear, notice, pageHead, errorText, busy } from '../core.js'
import { startSession, renderSessionBar, roleName } from '../session.js'

const HOME_FOR_ROLE = { voter: '/vote', admin: '/recount', auditor: '/audit' }

async function finish(token, role) {
  await startSession(token)
  renderSessionBar()
  location.hash = '#' + (HOME_FOR_ROLE[role] || '/')
}

export default function signIn(main) {
  main.append(pageHead('Sign in',
    'Use your account to vote or to open the official and auditor screens.',
    ['SR-11', 'SR-12']))

  if (state.notice) {
    main.append(notice('info', null, state.notice))
    state.notice = null
  }
  if (state.user) {
    main.append(notice('ok', `You are signed in as ${roleName(state.user.role)} (user ${state.user.userId}).`,
      h('p', null, h('a', { href: '#' + (HOME_FOR_ROLE[state.user.role] || '/') }, 'Continue'), ' or sign out from the top bar to switch account.')))
  }

  // ---- real login -------------------------------------------------------
  const username = h('input', { type: 'text', id: 'username', autocomplete: 'username', required: true, maxlength: '64' })
  const password = h('input', { type: 'password', id: 'password', autocomplete: 'current-password', required: true, maxlength: '256' })
  const loginMsg = h('div', { 'aria-live': 'polite' })
  let failures = 0

  const loginForm = h('form', { class: 'panel stack', onsubmit: async (e) => {
    e.preventDefault()
    const done = busy(e.submitter || loginForm.querySelector('button'), 'Checking…')
    const res = await api('/api/auth/login', { method: 'POST', body: { username: username.value, password: password.value } })
    done()
    if (res.ok) return finish(res.data.token, res.data.role)

    password.value = ''
    if (res.status === 423) {
      failures = 0
      const until = new Date(res.data.lockedUntil).toLocaleTimeString('en-AU')
      return clear(loginMsg, notice('warn', `This account is locked until ${until}.`,
        'Three wrong passwords within five minutes lock the account for 15 minutes, and the Security Operations Centre is alerted. The correct password will not work until the lock ends.'))
    }
    if (res.status === 401) {
      failures += 1
      return clear(loginMsg, notice('bad', 'Wrong username or password.',
        `Attempt ${failures} of 3. After three wrong attempts within five minutes the account is locked for 15 minutes.`))
    }
    clear(loginMsg, notice('bad', 'Sign-in failed.', errorText(res)))
  } },
  h('h2', null, 'Sign in with your account'),
  h('label', { class: 'field', for: 'username' }, 'Username', username),
  h('label', { class: 'field', for: 'password' }, 'Password', password),
  h('div', { class: 'row' }, h('button', { class: 'btn', type: 'submit' }, 'Sign in')),
  loginMsg)

  // ---- demo login -------------------------------------------------------
  const userId = h('input', { type: 'number', id: 'demo-user', min: '1', value: '1', required: true })
  const role = h('select', { id: 'demo-role' },
    h('option', { value: 'voter' }, 'Voter'),
    h('option', { value: 'admin' }, 'Election official'),
    h('option', { value: 'auditor' }, 'Auditor'))
  const demoMsg = h('div', { 'aria-live': 'polite' })

  const demoForm = h('form', { class: 'panel stack', onsubmit: async (e) => {
    e.preventDefault()
    const res = await api('/api/session/demo-login', { method: 'POST', body: { userId: Number(userId.value), role: role.value } })
    if (res.ok) return finish(res.data.token, role.value)
    clear(demoMsg, notice('bad', res.status === 404 ? 'Quick demo sign-in is turned off.' : 'Could not sign in.',
      res.status === 404 ? 'Set ENABLE_DEMO_LOGIN=true in the .env file and restart the server.' : errorText(res)))
  } },
  h('h2', null, 'Quick demo sign-in'),
  h('p', { class: 'lead' }, 'Skips the password so you can try any role during a demo. Voter user 1 is the same person as V0001 on the electoral roll.'),
  h('div', { class: 'grid-2' },
    h('label', { class: 'field', for: 'demo-user' }, 'User ID', userId),
    h('label', { class: 'field', for: 'demo-role' }, 'Role', role)),
  h('div', { class: 'row' }, h('button', { class: 'btn secondary', type: 'submit' }, 'Sign in for the demo')),
  demoMsg)

  // Demo accounts: one click fills the form
  const fill = (u, p) => () => { username.value = u; password.value = p; password.focus() }
  const accounts = h('p', { class: 'side-note' }, 'Demo accounts: ',
    h('button', { class: 'btn secondary', type: 'button', onclick: fill('voter1', 'VoterPass123!') }, 'voter1'), ' ',
    h('button', { class: 'btn secondary', type: 'button', onclick: fill('admin1', 'AdminPass123!') }, 'admin1'), ' ',
    h('button', { class: 'btn secondary', type: 'button', onclick: fill('auditor1', 'AuditPass123!') }, 'auditor1'))
  loginForm.insertBefore(accounts, loginForm.children[1])

  main.append(h('div', { class: 'grid-2' }, loginForm, demoForm))
  username.focus()
}
