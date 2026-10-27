// Audit log (SR-09): read-only, auditor only, hash-chained.
import { h, api, clear, notice, pageHead, fmtTime, shortHash, errorText } from '../core.js'
import { auditorGate } from '../core.js'

export default function audit(main) {
  main.append(pageHead('Audit log',
    'Every security event, in order. Each entry includes the fingerprint of the one before it, so editing or deleting any entry breaks the chain.',
    ['SR-09']))
  const body = h('div')
  main.append(body)
  auditorGate(body, () => load(body), '/api/audit/verify')
}

async function load(body) {
  const banner = h('div', { 'aria-live': 'polite' })
  const filter = h('input', { type: 'text', id: 'audit-filter', placeholder: 'For example LOGIN_FAILED or BATCH_ACCEPTED' })
  const tableWrap = h('div', { class: 'table-wrap' })
  const countEl = h('p', { class: 'side-note' })
  let entries = []

  const render = () => {
    const q = filter.value.trim().toLowerCase()
    const rows = entries.filter((e) => !q || e.action.toLowerCase().includes(q) || String(e.details || '').toLowerCase().includes(q))
    countEl.textContent = `${rows.length} of ${entries.length} entries, newest first`
    clear(tableWrap, rows.length === 0 ? h('p', { class: 'empty', style: 'padding:1rem' }, 'No entries match.') :
      h('table', { class: 'data' },
        h('thead', null, h('tr', null, ['#', 'Time', 'Actor', 'Action', 'Details', 'Hash'].map((t, i) => h('th', { class: i === 0 ? 'num' : null }, t)))),
        h('tbody', null, rows.map((e) => h('tr', null,
          h('td', { class: 'num' }, e.id),
          h('td', null, fmtTime(e.created_at)),
          h('td', { class: 'num' }, e.actor_id === 0 ? 'system' : e.actor_id),
          h('td', null, e.action),
          h('td', { class: 'details' }, e.details || ''),
          h('td', { class: 'hash', title: e.hash }, shortHash(e.hash)))))))
  }

  const refresh = async () => {
    const [log, chain] = await Promise.all([api('/api/audit', { auth: 'auditor' }), api('/api/audit/verify', { auth: 'auditor' })])
    if (!log.ok) return clear(banner, notice('bad', 'The log could not be loaded.', errorText(log)))
    entries = log.data.slice().reverse()
    clear(banner, chain.data.valid
      ? notice('ok', 'Chain intact.', `All ${chain.data.entries} entries match their fingerprints, in order.`)
      : notice('bad', `Chain broken at entry ${chain.data.brokenAt}.`, `${chain.data.reason}. Someone changed the log outside the application.`))
    render()
  }

  filter.addEventListener('input', render)
  clear(body,
    banner,
    h('div', { class: 'row', style: 'margin:1rem 0' },
      h('label', { class: 'field', for: 'audit-filter', style: 'flex:1 1 18rem' }, 'Filter by action or detail', filter),
      h('button', { class: 'btn secondary', type: 'button', onclick: refresh, style: 'align-self:end' }, 'Refresh')),
    countEl,
    tableWrap)
  await refresh()
}
