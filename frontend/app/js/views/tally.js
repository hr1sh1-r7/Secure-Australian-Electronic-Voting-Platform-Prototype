// Ballot integrity and first-preference count (SR-10).
import { h, api, clear, notice, pageHead, errorText, auditorGate } from '../core.js'

export default function tally(main) {
  main.append(pageHead('Ballot integrity',
    'Before anything is counted, every stored ballot is re-fingerprinted with SHA-384 and compared with the fingerprint saved when it was cast. If even one differs, the count is refused.',
    ['SR-10']))
  const body = h('div')
  main.append(body)
  auditorGate(body, () => load(body), '/api/tally/integrity')
}

async function load(body) {
  const r = await api('/api/tally', { auth: 'auditor' })
  const integrity = r.data && r.data.integrity
  if (!integrity) return clear(body, notice('bad', 'The check could not be run.', errorText(r)))

  const banner = integrity.valid
    ? notice('ok', 'All ballots are intact.', `${integrity.checked} ${integrity.checked === 1 ? 'ballot' : 'ballots'} checked. None changed since ${integrity.checked === 1 ? 'it was' : 'they were'} cast.`)
    : notice('bad', 'Count refused: ballots have been changed.',
      [integrity.tampered.length ? `Changed: ballot ${integrity.tampered.join(', ')}.` : '',
        integrity.missingHash.length ? `Missing fingerprint: ballot ${integrity.missingHash.join(', ')}.` : ''].join(' ').trim())

  let results = null
  if (r.ok) {
    const max = Math.max(1, ...r.data.results.map((c) => c.firstPreferences))
    results = h('section', { class: 'panel' },
      h('h2', null, 'First preferences'),
      h('p', { class: 'lead' }, 'A quick first-preference count. The full preferential count, done twice by independent programs, is on the Recount screen.'),
      h('ol', { class: 'bars' }, r.data.results.map((c) => h('li', null,
        h('span', null, c.name, c.party ? h('span', { class: 'cand-party' }, c.party) : null),
        h('span', { class: 'bar-track', 'aria-hidden': 'true' }, h('span', { class: 'bar-fill', style: `width:${(c.firstPreferences / max) * 100}%; display:block` })),
        h('span', { class: 'n' }, c.firstPreferences)))))
  }

  clear(body,
    banner,
    h('div', { class: 'row', style: 'margin:0.5rem 0 1rem' }, h('button', { class: 'btn secondary', type: 'button', onclick: () => load(body) }, 'Run the check again')),
    results,
    h('p', { class: 'side-note', style: 'margin-top:1rem' }, 'To see a refusal, stop the server and run node scripts/tamperBallot.js in the backend folder, which edits a ballot directly in the database file. Then start the server and run this check again.'))
}
