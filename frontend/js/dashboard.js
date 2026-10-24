// Example protected page for SR-12: shows who is logged in and a live
// countdown to the inactivity logout.

let idleTimeoutMs = 0
let lastActivity = Date.now()

;['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'].forEach((event) =>
  document.addEventListener(event, () => { lastActivity = Date.now() }, { passive: true })
)

document.addEventListener('session-ready', (event) => {
  const { userId, role } = event.detail
  idleTimeoutMs = event.detail.idleTimeoutMs
  document.getElementById('who').textContent = `Logged in as user ${userId} (${role})`

  setInterval(() => {
    const remaining = Math.max(0, idleTimeoutMs - (Date.now() - lastActivity))
    const minutes = Math.floor(remaining / 60000)
    const seconds = Math.floor((remaining % 60000) / 1000)
    document.getElementById('idle').textContent =
      `${minutes}:${String(seconds).padStart(2, '0')}`
  }, 500)
})

document.getElementById('logoutBtn').addEventListener('click', () => {
  window.SessionTimeout.logout()
})