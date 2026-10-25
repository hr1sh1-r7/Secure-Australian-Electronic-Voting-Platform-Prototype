// Login page (SR-11 lockout, SR-12 session). Messages use textContent only.

const messageEl = document.getElementById('message')

function showMessage(text, type) {
  messageEl.textContent = text
  messageEl.className = 'message ' + type
  messageEl.hidden = false
}

// Explain why the user landed here (e.g. after an SR-12 inactivity logout)
const NOTICES = {
  timeout: 'You were logged out after 10 minutes of inactivity. Please log in again.',
  expired: 'Your session has expired. Please log in again.',
  login_required: 'Please log in to continue.',
  logout: 'You have been logged out.'
}
const ended = new URLSearchParams(window.location.search).get('ended')
if (ended && NOTICES[ended]) showMessage(NOTICES[ended], 'info')

document.getElementById('loginForm').addEventListener('submit', async (event) => {
  event.preventDefault()

  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: document.getElementById('username').value,
        password: document.getElementById('password').value
      })
    })
    const data = await response.json()

    if (response.status === 423) {
      const until = new Date(data.lockedUntil).toLocaleTimeString()
      showMessage(`${data.error} Locked until ${until}.`, 'locked')
      return
    }
    if (!response.ok) {
      showMessage(data.error || 'Login failed', 'error')
      document.getElementById('password').value = ''
      return
    }

    sessionStorage.setItem('sessionToken', data.token)
    // Voters go straight to the ballot; other roles go to the dashboard
    window.location.href = data.role === 'voter' ? 'vote.html' : 'dashboard.html'
  } catch {
    showMessage('Server not reachable', 'error')
  }
})