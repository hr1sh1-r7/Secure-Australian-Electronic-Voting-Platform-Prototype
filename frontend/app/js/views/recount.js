// Recount and results (SR-15): two independent counting programs must agree.
import { state, h, api, clear, notice, pageHead, errorText, busy, fmtTime } from '../core.js'
import { roleName } from '../session.js'

export default async function recount(main) {
  main.append(pageHead('Recount and results',
    'Two counting programs, written separately in JavaScript and Python, count every ballot in full. If they differ by even one vote in any round, the result cannot be published and the State Electoral Officer is alerted.',
    ['SR-15', 'SR-10']))

  if (!state.user || state.user.role !== 'admin') {
    return main.append(notice('info', state.user ? `You are signed in as ${roleName(state.user.role)}.` : 'Sign in as an election official.',
      h('p', null, 'This screen is for election officials. ', h('a', { href: '#/sign-in' }, 'Sign in'), ' as admin1 / AdminPass123!, or use the quick demo sign-in with the Election official role.')))
  }

  const cands = await api('/api/ballots/candidates')
  const names = new Map((cands.ok ? cands.data : []).map((c) => [c.id, c.name]))
  const nameOf = (id) => names.get(Number(id)) || `Candidate ${id}`

  const statusPanel = h('section', { class: 'panel' })
  const runPanel = h('section', { class: 'panel' })
  const alertsPanel = h('section', { class: 'panel' })
  main.append(statusPanel, runPanel, alertsPanel)

  let lastRun = null
  const message = h('div', { 'aria-live': 'polite' })
  const engines = h('div', { class: 'engines' })
  const fault = h('input', { type: 'checkbox', id: 'fault' })
  const faultLabel = h('label', { class: 'check', for: 'fault', hidden: true }, fault, 'Demo: make Engine B count one extra vote')
  const runBtn = h('button', { class: 'btn', type: 'button' }, 'Run both counting programs')
  const publishBtn = h('button', { class: 'btn go', type: 'button', disabled: true }, 'Publish result')

  async function refreshStatus() {
    const r = await api('/api/recount/status', { auth: 'session' })
    if (!r.ok) return clear(statusPanel, notice('bad', 'Status could not be loaded.', errorText(r)))
    const s = r.data
    faultLabel.hidden = !s.faultDemoEnabled
    const closeBtn = h('button', { class: 'btn danger', type: 'button', disabled: s.status !== 'OPEN', onclick: async () => {
      if (!confirm('Close voting? Polling terminals should finish sending their queues first.')) return
      await api('/api/recount/close-voting', { method: 'POST', auth: 'session' })
      refreshStatus()
    } }, 'Close voting')
    clear(statusPanel,
      h('div', { class: 'row', style: 'justify-content:space-between' },
        h('h2', null, 'Election'),
        h('span', { class: 'pill ' + (s.status === 'OPEN' ? 'ok' : 'neutral') }, s.status === 'OPEN' ? 'Voting open' : 'Voting closed')),
      h('div', { class: 'stats' },
        h('div', null, h('b', null, s.ballots), h('span', null, 'ballots stored')),
        h('div', null, h('b', null, s.markedOff), h('span', null, 'marked off at polling places')),
        h('div', null, h('b', null, s.enrolled), h('span', null, 'on the electoral roll'))),
      h('div', { class: 'row' }, closeBtn, h('button', { class: 'btn secondary', type: 'button', onclick: refreshStatus }, 'Refresh')))

    clear(alertsPanel,
      h('h2', null, 'Alerts to the State Electoral Officer'),
      s.alerts.length === 0 ? h('p', { class: 'empty' }, 'No alerts raised.') :
        h('ul', { class: 'stack', style: 'padding-left:1.1rem;margin:0' }, s.alerts.map((a) =>
          h('li', null, h('strong', null, a.subject), h('br'), h('span', { class: 'side-note' }, `${fmtTime(a.raised_at)}, ${a.severity.toLowerCase()}, sent via ${a.delivered_via}`)))))
  }

  function table(result, diffs) {
    if (result.error) return notice('bad', 'Refused to count.', `${result.error}: ballot ${result.ballot_ids.join(', ')} failed its fingerprint check.`)
    const ids = Object.keys(result.rounds[0].counts).map(Number).sort((a, b) => a - b)
    return h('div', null,
      h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
        h('thead', null, h('tr', null, h('th', null, 'Candidate'), result.rounds.map((r) => h('th', { class: 'num' }, `Round ${r.round}`)))),
        h('tbody', null,
          ids.map((id) => h('tr', null, h('td', null, nameOf(id)), result.rounds.map((r) => {
            const has = String(id) in r.counts
            let cls = has ? 'num' : 'num out'
            if (r.elected === id) cls = 'num win'
            if (diffs.has(`${r.round}:${id}`)) cls = 'num diff'
            return h('td', { class: cls }, has ? r.counts[id] : 'out')
          }))),
          h('tr', null, h('td', null, 'Exhausted'), result.rounds.map((r) => h('td', { class: 'num' }, r.exhausted)))))),
      h('p', { class: 'side-note', style: 'margin-top:0.5rem' }, `Elected: ${result.winner === null ? 'no one' : nameOf(result.winner)}. ${result.formal} formal, ${result.informal} informal.`))
  }

  runBtn.addEventListener('click', async () => {
    const done = busy(runBtn, 'Counting…')
    const r = await api('/api/recount/run', { method: 'POST', auth: 'session', body: { simulateFault: fault.checked } })
    done()
    if (!r.ok) return clear(message, notice('bad', 'The recount could not run.', errorText(r)))
    lastRun = r.data
    const d = lastRun.discrepancy
    const diffs = new Set(d && d.type === 'VOTE_COUNT_MISMATCH' ? d.diffs.map((x) => `${d.round}:${x.candidate}`) : [])
    publishBtn.disabled = lastRun.status !== 'MATCHED'
    if (lastRun.status === 'MATCHED') {
      clear(message, notice('ok', 'Both programs agree on every round.', `${lastRun.ballots} ballots counted in ${lastRun.ms} ms. The result can be published once voting is closed.`))
    } else if (d && d.type === 'VOTE_COUNT_MISMATCH') {
      clear(message, notice('bad', 'Publication blocked: the programs disagree.',
        `Round ${d.round}: ${d.diffs.map((x) => `${nameOf(x.candidate)} has ${x.engineA} in JavaScript and ${x.engineB} in Python`).join('; ')}. The State Electoral Officer has been alerted.`))
    } else {
      clear(message, notice('bad', 'Publication blocked.', `${d ? d.type : 'Integrity failure'}. The State Electoral Officer has been alerted.`))
    }
    clear(engines,
      h('div', null, h('h3', null, 'Engine A (JavaScript)'), table(lastRun.engineA, diffs)),
      h('div', null, h('h3', null, 'Engine B (Python)'), table(lastRun.engineB, diffs)))
    refreshStatus()
  })

  publishBtn.addEventListener('click', async () => {
    const r = await api(`/api/recount/runs/${lastRun.runId}/publish`, { method: 'POST', auth: 'session' })
    if (r.ok) {
      publishBtn.disabled = true
      return clear(message, notice('ok', `Result published. Elected: ${nameOf(r.data.winner)}.`, 'The published result is now public and this count cannot be published again.'))
    }
    const why = {
      VOTING_STILL_OPEN: 'Close voting first, then run the count again.',
      BALLOTS_CHANGED_SINCE_COUNT: 'Ballots changed after this count. Run it again.',
      NOT_LATEST_RUN: 'A newer count exists. Publish that one instead.',
      ALREADY_PUBLISHED: 'A result has already been published.'
    }
    clear(message, notice('bad', 'Not published.', why[r.data.error] || errorText(r)))
  })

  clear(runPanel,
    h('h2', null, 'Count every ballot twice'),
    h('div', { class: 'row', style: 'margin-top:0.5rem' }, runBtn, faultLabel, publishBtn),
    message,
    engines)

  refreshStatus()
}
