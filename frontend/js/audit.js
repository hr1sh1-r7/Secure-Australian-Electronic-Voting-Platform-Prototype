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

// SR-10: ballot integrity check and tally
function showIntegrity(result) {
  const el = document.getElementById('integrityStatus')
  if (result.valid) {
    el.textContent = `All ${result.checked} ballots passed the SHA-384 integrity check.`
    el.className = 'valid'
  } else {
    const parts = []
    if (result.tampered.length) parts.push(`altered ballots: ${result.tampered.join(', ')}`)
    if (result.missingHash.length) parts.push(`ballots with no hash: ${result.missingHash.join(', ')}`)
    el.textContent = `INTEGRITY FAILURE - ${parts.join('; ')}`
    el.className = 'invalid'
  }
}

document.getElementById('integrityBtn').addEventListener('click', async () => {
  try {
    showIntegrity(await callApi('/api/tally/integrity'))
  } catch (error) {
    document.getElementById('integrityStatus').textContent = error.message
  }
})

document.getElementById('tallyBtn').addEventListener('click', async () => {
  const body = document.getElementById('tallyBody')
  body.replaceChildren()
  const response = await fetch('/api/tally', { headers: authHeaders() })
  const data = await response.json()

  if (!response.ok) {
    if (data.integrity) showIntegrity(data.integrity)
    else document.getElementById('integrityStatus').textContent = data.error
    return
  }

  showIntegrity(data.integrity)
  for (const c of data.results) {
    const row = document.createElement('tr')
    ;[c.name, c.party || '', c.firstPreferences].forEach((value) => {
      const cell = document.createElement('td')
      cell.textContent = value
      row.appendChild(cell)
    })
    body.appendChild(row)
  }
})

// SR-11: show high-priority alerts raised for the SOC
document.getElementById('alertsBtn').addEventListener('click', async () => {
  const alertStatus = document.getElementById('alertStatus')
  const alertBody = document.getElementById('alertBody')

  try {
    const alerts = await callApi('/api/alerts')
    alertBody.replaceChildren()

    for (const a of alerts) {
      const delivered = a.delivered_at
        ? `Yes, after ${((a.delivered_at - a.created_at) / 1000).toFixed(2)} s`
        : (a.delivery_error ? 'Failed: ' + a.delivery_error : 'Not sent (no webhook configured)')

      const row = document.createElement('tr')
      ;[a.id, new Date(a.created_at).toISOString(), a.severity, a.type, a.username, delivered]
        .forEach((value) => {
          const cell = document.createElement('td')
          cell.textContent = value
          row.appendChild(cell)
        })
      alertBody.appendChild(row)
    }

    alertStatus.textContent = `Loaded ${alerts.length} alerts.`
    alertStatus.className = ''
  } catch (error) {
    alertStatus.textContent = error.message
    alertStatus.className = 'invalid'
  }
})