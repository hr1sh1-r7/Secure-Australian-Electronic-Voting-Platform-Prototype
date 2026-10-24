// Demo login page for SR-12. Explains why the user was logged out, then
// starts a new session and opens the protected dashboard.

const NOTICES = {
  timeout: 'You were logged out after 10 minutes of inactivity. Please log in again.',
  expired: 'Your session has expired. Please log in again.',
  login_required: 'Please log in to continue.',
  logout: 'You have been logged out.'
}

const ended = new URLSearchParams(window.location.search).get('ended')
if (ended && NOTICES[ended]) {
  const notice = document.getElementById('notice')
  notice.textContent = NOTICES[ended]
  notice.hidden = false
}

document.getElementById('loginBtn').addEventListener('click', async () => {
  const errorEl = document.getElementById('error')
  errorEl.textContent = ''

  try {
    const response = await fetch('/api/session/demo-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: Number(document.getElementById('userId').value),
        role: document.getElementById('role').value
      })
    })
    const data = await response.json()

    if (!response.ok) {
      errorEl.textContent = data.error || 'Login failed'
      return
    }

    // sessionStorage is cleared when the tab closes, and on timeout
    sessionStorage.setItem('sessionToken', data.token)
    window.location.href = 'dashboard.html'
  } catch {
    errorEl.textContent = 'Server not reachable'
  }
})