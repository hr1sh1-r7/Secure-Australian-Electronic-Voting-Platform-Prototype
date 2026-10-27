// Diplomatic missions (SR-06): only approved overseas mission networks get in.
import { h, api, clear, notice, pageHead, busy } from '../core.js'

export default function mission(main) {
  main.append(pageHead('Diplomatic mission voting',
    'Overseas voting at Australian embassies and consulates is only reachable from approved mission networks. Every other connection is refused and logged.',
    ['SR-06']))

  const result = h('div', { 'aria-live': 'polite' })
  const btn = h('button', { class: 'btn', type: 'button' }, 'Check this connection')

  btn.addEventListener('click', async () => {
    const done = busy(btn, 'Checking…')
    const started = performance.now()
    const r = await api('/api/mission/status')
    const ms = Math.round(performance.now() - started)
    done()
    if (r.ok) {
      return clear(result, notice('ok', 'Access granted.',
        h('dl', { class: 'kv' },
          h('dt', null, 'Your address'), h('dd', null, r.data.clientIp),
          h('dt', null, 'Subsystem'), h('dd', { class: 'plain' }, r.data.subsystem),
          h('dt', null, 'Round trip'), h('dd', { class: 'plain' }, `${ms} ms`))))
    }
    if (r.status === 403) {
      return clear(result, notice('bad', 'Access refused.',
        `This connection is not from an approved mission network. The decision and your address were written to the audit log. Round trip: ${ms} ms.`))
    }
    clear(result, notice('bad', 'The check could not be completed.', (r.data && r.data.error) || `HTTP ${r.status}`))
  })

  main.append(h('div', { class: 'grid-2' },
    h('section', { class: 'panel stack' },
      h('h2', null, 'Is this computer allowed in?'),
      h('p', { class: 'lead' }, 'The server checks the real network address of your connection against the approved list. It ignores headers a client could fake.'),
      h('div', { class: 'row' }, btn),
      result),
    h('aside', { class: 'side-note' },
      h('h2', null, 'Try both outcomes'),
      h('p', null, 'The approved networks are set in .env as MISSION_ALLOWED_CIDRS. The default (10.20.0.0/16) does not include your own computer, so you will be refused.'),
      h('p', null, 'To see access granted, add your own address and restart the server:'),
      h('code', { class: 'cmd' }, 'MISSION_ALLOWED_CIDRS=10.20.0.0/16,127.0.0.1/32,::1/128'),
      h('p', null, 'If the list is empty, everyone is refused. The check fails closed.'))))
}
