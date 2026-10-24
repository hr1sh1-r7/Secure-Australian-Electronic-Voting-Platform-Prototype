// SR-12 client side: detects physical inactivity (no mouse, keyboard, touch or
// scroll) and logs the user out, wiping session data from the browser.
// Include on any logged-in page:  <script src="js/idleTimeout.js"></script>
// The server enforces the same limit, so disabling this script doesn't bypass it.

(function () {
  const TOKEN_KEY = 'sessionToken'
  const WARNING_BEFORE_MS = 60 * 1000     // warn 1 minute before logout
  const KEEPALIVE_EVERY_MS = 60 * 1000    // tell the server we're active at most once a minute

  let idleTimeoutMs = 10 * 60 * 1000      // replaced by the server's value on start
  let lastActivity = Date.now()
  let lastKeepAlive = 0
  let warningEl = null

  function token() {
    return sessionStorage.getItem(TOKEN_KEY)
  }

  async function api(path, method = 'GET') {
    return fetch(path, { method, headers: { Authorization: 'Bearer ' + token() } })
  }

  // Ephemeral reset: remove everything this browser tab holds, then leave the page
  function clearAndLeave(reason) {
    sessionStorage.clear()
    window.location.replace('session.html?ended=' + encodeURIComponent(reason))
  }

  async function logout(reason) {
    try {
      await api('/api/session/logout', 'POST')
    } catch {
      // Server unreachable: the server-side timeout still expires the session
    }
    clearAndLeave(reason)
  }

  function showWarning(secondsLeft) {
    if (!warningEl) {
      warningEl = document.createElement('div')
      warningEl.setAttribute('role', 'alert')
      warningEl.style.cssText =
        'position:fixed;bottom:1rem;right:1rem;padding:1rem;background:#fff3cd;' +
        'border:1px solid #c9a227;border-radius:6px;font-family:system-ui,sans-serif;z-index:1000'
      document.body.appendChild(warningEl)
    }
    warningEl.textContent =
      `You will be logged out in ${secondsLeft} seconds due to inactivity. Move the mouse or press a key to stay logged in.`
  }

  function hideWarning() {
    if (warningEl) {
      warningEl.remove()
      warningEl = null
    }
  }

  async function keepAlive() {
    lastKeepAlive = Date.now()
    try {
      const res = await api('/api/session/status')
      if (res.status === 401) clearAndLeave('expired')
    } catch {
      // ignore network errors; the next activity will retry
    }
  }

  function onActivity() {
    lastActivity = Date.now()
    hideWarning()
    if (Date.now() - lastKeepAlive > KEEPALIVE_EVERY_MS) keepAlive()
  }

  function tick() {
    const idleFor = Date.now() - lastActivity
    const remaining = idleTimeoutMs - idleFor

    if (remaining <= 0) {
      logout('timeout')
    } else if (remaining <= WARNING_BEFORE_MS) {
      showWarning(Math.ceil(remaining / 1000))
    }
  }

  async function start() {
    if (!token()) {
      clearAndLeave('login_required')
      return
    }

    const res = await api('/api/session/status')
    if (!res.ok) {
      clearAndLeave('expired')
      return
    }

    const status = await res.json()
    idleTimeoutMs = status.idleTimeoutMs
    lastKeepAlive = Date.now()

    ;['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'].forEach((event) =>
      document.addEventListener(event, onActivity, { passive: true })
    )
    setInterval(tick, 1000)

    document.dispatchEvent(new CustomEvent('session-ready', { detail: status }))
  }

  window.SessionTimeout = { logout: () => logout('logout'), TOKEN_KEY }
  start()
})()