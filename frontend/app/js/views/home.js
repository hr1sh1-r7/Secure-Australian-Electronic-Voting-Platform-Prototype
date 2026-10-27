// Home: the life of a ballot, step by step, with links to each screen.
import { h, api } from '../core.js'

const STEPS = [
  { title: 'Sign in', reqs: ['SR-11', 'SR-12'], link: '/sign-in', action: 'Sign in',
    text: 'Password check with an automatic lock after three wrong attempts in five minutes. Sessions end after ten minutes without activity.' },
  { title: 'Get marked off the roll', reqs: ['SR-13'], link: '/polling', action: 'Open the polling terminal',
    text: 'At a polling place, the official finds the voter on the certified roll. A second attempt for the same voter, anywhere in the country, is refused.' },
  { title: 'Cast the ballot', reqs: ['SR-05', 'SR-10'], link: '/vote', action: 'Cast a vote',
    text: 'The ballot is checked against strict input rules, then stored with no link back to the voter.' },
  { title: 'Keep the receipt', reqs: ['SR-07'], link: '/verify', action: 'Check a receipt',
    text: 'The voter gets a signed receipt that proves the ballot arrived, without revealing how they voted.' },
  { title: 'Stored safely, even offline', reqs: ['SR-08', 'SR-14', 'SR-16'], link: '/polling', action: 'See how terminals send ballots',
    text: 'Ballots live in a separate database from voter records. Terminals sign every batch, and keep ballots encrypted while the network is down.' },
  { title: 'Counted twice', reqs: ['SR-10', 'SR-15'], link: '/recount', action: 'Run the recount',
    text: 'Every ballot’s fingerprint is re-checked, then two independently written counting programs must agree on every round before a result can be published.' },
  { title: 'Every action logged', reqs: ['SR-09'], link: '/audit', action: 'Open the audit log',
    text: 'Security events go into a hash-chained log that cannot be edited or deleted without detection.' }
]

const ACCOUNTS = [
  ['voter1', 'VoterPass123!', 'Voter'],
  ['admin1', 'AdminPass123!', 'Election official'],
  ['auditor1', 'AuditPass123!', 'Auditor']
]

export default function home(main) {
  const statusList = h('ul', { class: 'status-list' }, h('li', null, 'Checking…'))

  main.append(
    h('section', { class: 'home-hero' },
      h('div', null,
        h('h1', null, 'Follow a ballot from the roll to the result'),
        h('p', { class: 'intro' }, 'This prototype protects every stage of an Australian election. Each step below opens the screen where you can see that protection working.'),
        h('ol', { class: 'journey' }, STEPS.map((s) => h('li', null,
          h('h3', null, s.title),
          h('p', null, s.text),
          h('div', { class: 'step-foot' },
            h('a', { href: '#' + s.link }, s.action),
            h('span', { class: 'reqs-line' }, s.reqs.map((r) => h('span', { class: 'req' }, r)))))))),
      h('aside', null,
        h('section', { class: 'side-card' },
          h('h2', null, 'Demo accounts'),
          h('table', { class: 'accounts' }, h('tbody', null, ACCOUNTS.map(([u, p, r]) =>
            h('tr', null, h('td', null, h('strong', null, u), h('br'), h('code', null, p)), h('td', null, r))))),
          h('p', { class: 'behind' }, 'Created by running node scripts/seedUsers.js in the backend folder.')),
        h('section', { class: 'side-card' },
          h('h2', null, 'System check'),
          statusList),
        h('section', { class: 'side-card' },
          h('h2', null, 'Working behind the scenes'),
          h('p', { class: 'behind' }, 'Some requirements protect the servers and network rather than having a screen of their own: SR-01 to SR-04, SR-08 and SR-17 to SR-20. They are described in the group report.'))))
  )

  ;(async () => {
    const [health, candidates] = await Promise.all([api('/api/health'), api('/api/ballots/candidates')])
    const rows = [
      ['Server', health.ok ? h('span', { class: 'pill ok' }, 'Running') : h('span', { class: 'pill bad' }, 'Not reachable')],
      ['Candidates on the ballot', candidates.ok
        ? (candidates.data.length ? h('span', { class: 'pill ok' }, String(candidates.data.length)) : h('span', { class: 'pill bad' }, 'None – run seedCandidates.js'))
        : h('span', { class: 'pill neutral' }, 'Unknown')]
    ]
    statusList.replaceChildren(...rows.map(([k, v]) => h('li', null, h('span', null, k), v)))
  })()
}
