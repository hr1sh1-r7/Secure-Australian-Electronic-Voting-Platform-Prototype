// SR-09 auditor interface.
// All values are written with textContent (never innerHTML) so log contents
// can't run as code in the page (XSS protection).

const statusEl = document.getElementById('status')
const logBody = document.getElementById('logBody')

function authHeaders() {
  const token = document.getElementById('token').value.trim()
  return { Authorization: 'Bearer ' + token }
}

function showStatus(text, className = '') {
  statusEl.textContent = text
  statusEl.className = className
}

async function callApi(url) {
  const response = await fetch(url, { headers: authHeaders() })
  const data = await response.json()
  if (!response.ok) {
    throw new Error(data.error || 'Request failed')
  }
  return data
}

document.getElementById('loadBtn').addEventListener('click', async () => {
  try {
    const entries = await callApi('/api/audit')
    logBody.replaceChildren()

    for (const entry of entries) {
      const row = document.createElement('tr')
      const values = [
        entry.id,
        entry.created_at,
        entry.actor_id,
        entry.action,
        entry.details ?? '',
        entry.hash
      ]
      values.forEach((value, i) => {
        const cell = document.createElement('td')
        cell.textContent = value
        if (i === 5) cell.className = 'hash'
        row.appendChild(cell)
      })
      logBody.appendChild(row)
    }

    showStatus(`Loaded ${entries.length} entries.`)
  } catch (error) {
    showStatus(error.message, 'invalid')
  }
})

document.getElementById('verifyBtn').addEventListener('click', async () => {
  try {
    const result = await callApi('/api/audit/verify')
    if (result.valid) {
      showStatus(`Chain valid: all ${result.entries} entries are intact.`, 'valid')
    } else {
      showStatus(`Chain BROKEN at entry ${result.brokenAt}: ${result.reason}`, 'invalid')
    }
  } catch (error) {
    showStatus(error.message, 'invalid')
  }
})