// Polling terminal (SR-13, SR-14, SR-16). The terminal is a separate device
// program, so this screen explains it and opens it.
import { h, pageHead, notice } from '../core.js'

const TERMINAL_URL = 'http://127.0.0.1:4100'

export default function polling(main) {
  main.append(pageHead('Polling terminal',
    'The kiosk used at a polling place. The official marks the voter off the national roll, the voter numbers the ballot, and the terminal sends signed batches to the Ballot Store, even after a network outage.',
    ['SR-13', 'SR-14', 'SR-16']))

  main.append(h('div', { class: 'grid-2' },
    h('section', { class: 'panel stack' },
      h('h2', null, 'Open the terminal'),
      h('p', { class: 'lead' }, 'The terminal runs as its own program, like a separate machine at the polling place. Start it in a second terminal window:'),
      h('code', { class: 'cmd' }, 'cd terminal\nnpm.cmd start'),
      h('div', { class: 'row' },
        h('a', { class: 'btn', href: TERMINAL_URL, target: '_blank', rel: 'noopener' }, 'Open polling terminal')),
      notice('info', null, 'First time only: copy terminal/.env.example to terminal/.env, set TERMINAL_ENROLMENT_SECRET to the same value as the main .env, and set TERMINAL_QUEUE_KEY.')),
    h('section', { class: 'panel' },
      h('h2', null, 'Demo in six steps'),
      h('ol', { class: 'steps' },
        h('li', null, 'Mark off V0001, number the ballot and cast it. A signed receipt from the Ballot Store appears (SR-14).'),
        h('li', null, 'Try V0001 again. It is refused: the voter has already been marked off (SR-13).'),
        h('li', null, 'Sign in here as voter user 1 and try to vote online. It is refused too: one vote across both channels.'),
        h('li', null, 'Tick “Simulate network outage”. Vote as V0006 and V0007, and as V0003 a second time. The queue counter rises; ballots are stored encrypted (SR-16).'),
        h('li', null, 'Untick it. Within seconds the queue empties. The receipt shows V0003’s offline ballot was rejected because they had already voted.'),
        h('li', null, h('a', { href: '#/recount' }, 'Run the recount'), ' as an election official to count every ballot twice (SR-15).')))),
  h('section', { class: 'panel', style: 'margin-top:1rem' },
    h('h2', null, 'What protects these ballots'),
    h('div', { class: 'grid-2' },
      h('div', { class: 'side-note' },
        h('h3', null, 'One voter, one ballot'),
        h('p', null, 'The voter’s roll entry is locked before it is read, so two terminals asking at the same moment cannot both succeed. The ballot token issued afterwards holds no identity.')),
      h('div', { class: 'side-note' },
        h('h3', null, 'Signed batches'),
        h('p', null, 'Each terminal signs its batches with its own key. Altered, unsigned, replayed or unknown-terminal batches are refused, and every accepted batch gets a signed receipt.')),
      h('div', { class: 'side-note' },
        h('h3', null, 'Offline queue'),
        h('p', null, 'Ballots queued during an outage are encrypted with AES-256-GCM and hash-chained, so deleting one is detected. The terminal stops accepting ballots after 12 hours offline.')))))
}
