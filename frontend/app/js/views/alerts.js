// Security alerts (SR-11): high-priority alerts raised for the SOC.
import { h, api, clear, notice, pageHead, fmtTime, errorText, auditorGate } from '../core.js'

export default function alerts(main) {
  main.append(pageHead('Security alerts',
    'High-priority alerts sent to the Security Operations Centre, such as an account locked after repeated wrong passwords.',
    ['SR-11']))
  const body = h('div')
  main.append(body)
  auditorGate(body, () => load(body), '/api/alerts')
}

function parse(details) {
  try {
    return JSON.parse(details || '{}')
  } catch {
    return {}
  }
}

async function load(body) {
  const r = await api('/api/alerts', { auth: 'auditor' })
  if (!r.ok) return clear(body, notice('bad', 'Alerts could not be loaded.', errorText(r)))
  const list = r.data
  clear(body,
    h('div', { class: 'row', style: 'margin-bottom:1rem' },
      h('button', { class: 'btn secondary', type: 'button', onclick: () => load(body) }, 'Refresh')),
    list.length === 0
      ? notice('info', 'No alerts yet.', h('p', null, 'To raise one, go to ', h('a', { href: '#/sign-in' }, 'Sign in'), ' and enter a wrong password three times for voter2.'))
      : h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
        h('thead', null, h('tr', null, ['Raised', 'Severity', 'Type', 'Account', 'Details', 'Delivered to SOC'].map((t) => h('th', null, t)))),
        h('tbody', null, list.map((a) => {
          const d = parse(a.details)
          const detail = d.lockedUntil ? `${d.failedAttempts} failed attempts in ${d.windowMinutes} min, locked until ${fmtTime(d.lockedUntil)}` : a.details
          const delivered = a.delivered_at
            ? h('span', { class: 'pill ok' }, `Yes, in ${a.delivered_at - a.created_at} ms`)
            : h('span', { class: 'pill neutral', title: a.delivery_error || '' }, a.delivery_error ? 'Not delivered' : 'Stored only')
          return h('tr', null,
            h('td', null, fmtTime(a.created_at)),
            h('td', null, h('span', { class: 'pill bad' }, a.severity)),
            h('td', null, a.type),
            h('td', null, a.username || ''),
            h('td', { class: 'details' }, detail),
            h('td', null, delivered))
        })))),
    h('p', { class: 'side-note', style: 'margin-top:1rem' }, 'Alerts are always stored. To send them to a SOC as they happen, set SOC_WEBHOOK_URL in .env. For a demo, set ENABLE_MOCK_SOC=true and point SOC_WEBHOOK_URL at http://localhost:3000/api/alerts/mock-soc.'))
}
