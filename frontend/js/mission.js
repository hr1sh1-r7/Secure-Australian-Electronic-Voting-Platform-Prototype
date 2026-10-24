// SR-06 demo page: shows whether this computer's network is on the mission allow-list.
document.getElementById('checkBtn').addEventListener('click', async () => {
  const result = document.getElementById('result')
  result.hidden = false

  try {
    const response = await fetch('/api/mission/status')
    const data = await response.json()

    if (response.ok) {
      result.textContent = `Access granted - connected from approved network (${data.clientIp}).`
      result.className = 'result granted'
    } else {
      result.textContent = data.error
      result.className = 'result denied'
    }
  } catch {
    result.textContent = 'Server not reachable'
    result.className = 'result denied'
  }
})