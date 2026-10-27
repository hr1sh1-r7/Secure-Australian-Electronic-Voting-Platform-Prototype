// Shared helpers for every screen.
// Security note: all text goes into the page with textContent / text nodes.
// innerHTML is never used, so nothing returned by the server can run as code.

export const state = {
  token: sessionStorage.getItem('sessionToken'), // same key the team's pages use
  user: null,              // { userId, role, idleTimeoutMs } once checked with the server
  auditorToken: null,      // kept in memory only, never stored in the browser
  lastReceipt: null,       // passed from the ballot screen to the receipt check
  notice: null             // one-off message for the next screen (e.g. after logout)
}

// h('p', { class: 'x', onclick: fn }, 'text', child, [more])
export function h(tag, props, ...children) {
  const el = document.createElement(tag)
  for (const [key, value] of Object.entries(props || {})) {
    if (value === null || value === undefined || value === false) continue
    if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value)
    else if (key === 'class') el.className = value
    else if (key === 'dataset') Object.assign(el.dataset, value)
    else if (value === true) el.setAttribute(key, '')
    else el.setAttribute(key, value)
  }
  append(el, children)
  return el
}

function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue
    el.append(child instanceof Node ? child : document.createTextNode(String(child)))
  }
}

export function clear(el, ...children) {
  el.replaceChildren()
  append(el, children)
  return el
}

// Call the backend. auth: 'session' (logged-in user), 'auditor' (AUDITOR_TOKEN) or null.
export async function api(path, { method = 'GET', body, auth = null } = {}) {
  const headers = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (auth === 'session' && state.token) headers.Authorization = 'Bearer ' + state.token
  if (auth === 'auditor' && state.auditorToken) headers.Authorization = 'Bearer ' + state.auditorToken
  let res
  try {
    res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  } catch {
    return { ok: false, status: 0, data: { error: 'The server is not reachable. Check that it is running (npm start in the backend folder).' } }
  }
  const type = res.headers.get('content-type') || ''
  const data = type.includes('json') ? await res.json().catch(() => ({})) : await res.text()
  return { ok: res.ok, status: res.status, data }
}

export function notice(kind, title, ...body) {
  return h('div', { class: 'notice ' + kind, role: kind === 'bad' ? 'alert' : 'status' },
    title ? h('strong', null, title) : null, ...body.map((b) => (typeof b === 'string' ? h('p', null, b) : b)))
}

export function reqs(...codes) {
  return h('div', { class: 'reqs-line', 'aria-label': 'Requirements' }, codes.map((c) => h('span', { class: 'req' }, c)))
}

export function pageHead(title, intro, codes = []) {
  return h('header', { class: 'page-head' }, h('h1', null, title), intro ? h('p', null, intro) : null, codes.length ? reqs(...codes) : null)
}

let toastTimer
export function toast(message) {
  const el = document.getElementById('toast')
  el.textContent = message
  el.hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { el.hidden = true }, 3500)
}

export function fmtTime(value) {
  if (value === null || value === undefined) return ''
  const d = typeof value === 'number' ? new Date(value) : new Date(String(value))
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString('en-AU')
}

export function shortHash(hash, n = 10) {
  return typeof hash === 'string' && hash.length > n * 2 ? `${hash.slice(0, n)}…${hash.slice(-4)}` : hash
}

// Error text for a failed API call, including SR-10 field errors
export function errorText(res) {
  const d = res.data || {}
  if (Array.isArray(d.fields) && d.fields.length) {
    return `${d.error || 'Invalid input'}: ${d.fields.map((f) => `${f.field} – ${f.problem}`).join('; ')}`
  }
  return d.error || d.reason || `Request failed (HTTP ${res.status})`
}

export function busy(button, text) {
  const original = button.textContent
  button.disabled = true
  button.textContent = text
  return () => {
    button.disabled = false
    button.textContent = original
  }
}

// Gate for auditor-only screens (SR-09 least privilege): asks for AUDITOR_TOKEN
export function auditorGate(container, onReady, probePath) {
  if (state.auditorToken) return onReady()
  const input = h('input', { type: 'password', id: 'auditor-token', autocomplete: 'off', required: true })
  const msg = h('div')
  const form = h('form', { class: 'panel stack', onsubmit: async (e) => {
    e.preventDefault()
    state.auditorToken = input.value.trim()
    const res = await api(probePath, { auth: 'auditor' })
    if (res.ok) return onReady()
    state.auditorToken = null
    clear(msg, notice('bad', res.status === 403 ? 'That token is not correct.' : 'Could not check the token.', errorText(res)))
  } },
  h('h2', null, 'Auditor access'),
  h('p', { class: 'lead' }, 'This screen is read-only and limited to the auditor. Enter the auditor token (AUDITOR_TOKEN in the server’s .env file). It is kept only until you close this tab.'),
  h('label', { class: 'field', for: 'auditor-token' }, 'Auditor token', input),
  h('div', { class: 'row' }, h('button', { class: 'btn', type: 'submit' }, 'Unlock')),
  msg)
  container.append(form)
  input.focus()
}
