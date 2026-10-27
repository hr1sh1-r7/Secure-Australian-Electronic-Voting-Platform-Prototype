// SR-15 recount page (Muzammil s4175334). Needs an admin session.
// All server data is shown with textContent, never innerHTML (no XSS).

const $ = (id) => document.getElementById(id)
let names = new Map()
let lastRun = null

function api(path, method = 'GET', body) {
  return fetch(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + sessionStorage.getItem('sessionToken')
    },
    body: body ? JSON.stringify(body) : undefined
  }).then(async (res) => ({ ok: res.ok, status: res.status, body: await res.json().catch(() => ({})) }))
}

function cell(tag, text, className) {
  const el = document.createElement(tag)
  el.textContent = text
  if (className) el.className = className
  return el
}

function showMessage(text, kind) {
  $('message').textContent = text
  $('message').className = 'message ' + kind
  $('message').hidden = false
}

async function refresh() {
  const res = await api('/api/recount/status')
  if (!res.ok) {
    showMessage(res.status === 403 ? 'Only election officials (admin role) can use this page.' : res.body.error, 'bad')
    return
  }
  const s = res.body
  $('votingStatus').textContent = s.status
  $('votingStatus').className = 'pill ' + (s.status === 'OPEN' ? 'ok' : 'bad')
  $('enrolled').textContent = s.enrolled
  $('markedOff').textContent = s.markedOff
  $('ballots').textContent = s.ballots
  $('closeBtn').disabled = s.status !== 'OPEN'
  $('faultWrap').hidden = !s.faultDemoEnabled

  const list = $('alerts')
  list.replaceChildren()
  if (s.alerts.length === 0) list.append(cell('li', 'No alerts raised.'))
  for (const a of s.alerts) {
    list.append(cell('li', `${new Date(a.raised_at).toLocaleString()} – ${a.severity} – ${a.subject} (via ${a.delivered_via})`))
  }
}

function renderEngine(result, diffs) {
  const wrap = document.createElement('div')
  if (result.error) {
    wrap.append(cell('p', `Refused to count: ${result.error} (ballots ${result.ballot_ids.join(', ')})`, 'message bad'))
    return wrap
  }
  const ids = Object.keys(result.rounds[0].counts).map(Number).sort((a, b) => a - b)
  const table = document.createElement('table')
  const head = document.createElement('tr')
  head.append(cell('th', 'Candidate'))
  result.rounds.forEach((r) => head.append(cell('th', 'Round ' + r.round)))
  table.append(head)

  for (const id of ids) {
    const row = document.createElement('tr')
    row.append(cell('td', names.get(id) || 'Candidate ' + id))
    for (const r of result.rounds) {
      const has = String(id) in r.counts
      let cls = has ? '' : 'out'
      if (r.elected === id) cls = 'win'
      if (diffs.has(`${r.round}:${id}`)) cls = 'diff'
      row.append(cell('td', has ? r.counts[id] : 'excluded', cls))
    }
    table.append(row)
  }
  const exhausted = document.createElement('tr')
  exhausted.append(cell('td', 'Exhausted'))
  result.rounds.forEach((r) => exhausted.append(cell('td', r.exhausted)))
  table.append(exhausted)
  wrap.append(table)
  wrap.append(cell('p', `Winner: ${names.get(result.winner) || 'none'} · formal ${result.formal}, informal ${result.informal}`))
  return wrap
}

$('runBtn').addEventListener('click', async () => {
  $('runBtn').disabled = true
  showMessage('Counting...', '')
  const res = await api('/api/recount/run', 'POST', { simulateFault: $('faultToggle').checked })
  $('runBtn').disabled = false
  if (!res.ok) return showMessage('Recount failed: ' + res.body.error, 'bad')

  lastRun = res.body
  const matched = lastRun.status === 'MATCHED'
  $('runStatus').textContent = lastRun.status
  $('runStatus').className = 'pill ' + (matched ? 'ok' : 'bad')
  $('runStatus').hidden = false
  $('publishBtn').disabled = !matched

  const diffs = new Set()
  const d = lastRun.discrepancy
  if (matched) {
    showMessage(`Both engines agree on every round (${lastRun.ballots} ballots, ${lastRun.ms} ms).`, 'ok')
  } else if (d && d.type === 'VOTE_COUNT_MISMATCH') {
    d.diffs.forEach((x) => diffs.add(`${d.round}:${x.candidate}`))
    const detail = d.diffs.map((x) => `${names.get(x.candidate)}: A=${x.engineA}, B=${x.engineB}`).join('; ')
    showMessage(`Publication blocked. Round ${d.round} differs (${detail}). The State Electoral Officer has been alerted.`, 'bad')
  } else {
    showMessage(`Publication blocked (${d.type}). The State Electoral Officer has been alerted.`, 'bad')
  }
  $('tableA').replaceChildren(renderEngine(lastRun.engineA, diffs))
  $('tableB').replaceChildren(renderEngine(lastRun.engineB, diffs))
  $('engines').hidden = false
  refresh()
})

$('publishBtn').addEventListener('click', async () => {
  const res = await api(`/api/recount/runs/${lastRun.runId}/publish`, 'POST')
  if (res.ok) {
    showMessage(`Result published. Winner: ${names.get(res.body.winner)}.`, 'ok')
    $('publishBtn').disabled = true
  } else {
    showMessage('Publish refused: ' + res.body.error, 'bad')
  }
})

$('closeBtn').addEventListener('click', async () => {
  if (!confirm('Close voting? Polling terminals must finish sending their queues first.')) return
  await api('/api/recount/close-voting', 'POST')
  refresh()
})
$('refreshBtn').addEventListener('click', refresh)

document.addEventListener('session-ready', async (event) => {
  const { userId, role } = event.detail
  $('who').textContent = `Logged in as user ${userId} (${role})`
  const candidates = await (await fetch('/api/ballots/candidates')).json()
  names = new Map(candidates.map((c) => [c.id, c.name]))
  refresh()
})
