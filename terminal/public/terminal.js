// Polling terminal screen (Muzammil s4175334). Data shown with textContent only.
const $ = (id) => document.getElementById(id)
let sessionId = null
let candidates = []
let ranking = []

async function call(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  })
  return { ok: res.ok, body: await res.json().catch(() => ({})) }
}

function show(step) {
  for (const id of ['officialStep', 'ballotStep', 'doneStep']) $(id).hidden = id !== step
}

const MESSAGES = {
  ALREADY_MARKED_OFF: 'This voter has already been marked off (here, at another polling place, or online). Do not issue a ballot.',
  CONCURRENT_REQUEST: 'This voter is being marked off somewhere else right now. Do not issue a ballot.',
  NOT_ON_ROLL: 'Voter ID not found on the electoral roll.',
  INVALID_VOTER_ID: 'Voter ID should be 3 to 20 letters or digits.',
  OFFLINE_LIMIT_REACHED: 'Offline for more than 12 hours: this terminal has stopped accepting ballots.'
}

function addRow(dl, key, value) {
  const dt = document.createElement('dt')
  dt.textContent = key
  const dd = document.createElement('dd')
  dd.textContent = value
  dl.append(dt, dd)
}

async function refreshStatus() {
  const { body: s } = await call('GET', '/api/status')
  $('terminalId').textContent = s.terminalId
  $('pollingPlace').textContent = s.pollingPlace
  $('queued').textContent = s.queued
  $('sent').textContent = s.sent
  $('netToggle').checked = s.networkDisabled
  $('netPill').textContent = s.online ? 'ONLINE' : 'OFFLINE'
  $('netPill').className = 'pill ' + (s.online ? 'on' : 'off')

  const banner = $('banner')
  if (!s.online && s.offlineSince) {
    const mins = Math.floor((Date.now() - s.offlineSince) / 60000)
    const dur = mins < 60 ? `${mins} min` : `${(mins / 60).toFixed(1)} h`
    banner.textContent = s.acceptingBallots
      ? `Offline for ${dur} (limit 12 h). Ballots are encrypted and queued, and will be sent automatically when the network returns.`
      : MESSAGES.OFFLINE_LIMIT_REACHED
    banner.hidden = false
  } else if (s.lastError) {
    banner.textContent = s.lastError
    banner.hidden = false
  } else {
    banner.hidden = true
  }

  const dl = $('receipt')
  dl.replaceChildren()
  const r = s.lastReceipt
  if (!r) return addRow(dl, 'None yet', '')
  addRow(dl, 'Batch', r.batch_id)
  addRow(dl, 'Received', new Date(r.received_at).toLocaleString())
  addRow(dl, 'Ballots', `${r.ballot_count} (${r.accepted.length} accepted, ${r.rejected.length} rejected)`)
  addRow(dl, 'Rejected', r.rejected.map((x) => x.reason).join(', ') || 'none')
  addRow(dl, 'Batch hash', r.batch_hash)
  addRow(dl, 'Signed by', `${r.signer} (signature verified)`)
}

function renderBallot() {
  const list = $('candidates')
  list.replaceChildren()
  for (const c of candidates) {
    const li = document.createElement('li')
    const btn = document.createElement('button')
    btn.type = 'button'
    const rank = ranking.indexOf(c.id)
    if (rank >= 0) btn.classList.add('ranked')
    const box = document.createElement('span')
    box.className = 'box'
    box.textContent = rank >= 0 ? String(rank + 1) : ''
    const name = document.createElement('span')
    name.textContent = c.party ? `${c.name} – ${c.party}` : c.name
    btn.append(box, name)
    btn.setAttribute('aria-label', rank >= 0 ? `${c.name}, preference ${rank + 1}` : `${c.name}, not numbered`)
    btn.addEventListener('click', () => {
      if (!ranking.includes(c.id)) ranking.push(c.id)
      renderBallot()
    })
    li.append(btn)
    list.append(li)
  }
  $('castBtn').disabled = ranking.length === 0
}

$('voterForm').addEventListener('submit', async (e) => {
  e.preventDefault()
  $('voterMsg').textContent = ''
  const res = await call('POST', '/api/voters/authorize', { voter_id: $('voterId').value.trim() })
  if (!res.ok) {
    $('voterMsg').textContent = MESSAGES[res.body.error] || `Refused: ${res.body.error}`
    return refreshStatus()
  }
  sessionId = res.body.sessionId
  $('voterId').value = ''
  ranking = []
  $('modeNote').hidden = res.body.mode !== 'declaration'
  renderBallot()
  show('ballotStep')
  refreshStatus()
})

$('clearBtn').addEventListener('click', () => {
  ranking = []
  renderBallot()
})

$('castBtn').addEventListener('click', async () => {
  $('castBtn').disabled = true
  const res = await call('POST', '/api/ballots', { sessionId, preferences: ranking })
  sessionId = null
  if (!res.ok) {
    show('officialStep')
    $('voterMsg').textContent = MESSAGES[res.body.error] || `Ballot not recorded: ${res.body.error}`
    return
  }
  show('doneStep')
  setTimeout(refreshStatus, 600)
})

$('nextBtn').addEventListener('click', () => show('officialStep'))

$('netToggle').addEventListener('change', async (e) => {
  await call('POST', '/api/demo/network', { offline: e.target.checked })
  refreshStatus()
})

;(async () => {
  candidates = (await call('GET', '/api/candidates')).body
  await refreshStatus()
  setInterval(refreshStatus, 3000)
})()
