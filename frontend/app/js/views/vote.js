// Cast your vote: SR-05 (decoupled from identity), SR-10 (validated), SR-07 (signed receipt)
import { state, h, api, clear, notice, pageHead, errorText, busy, toast } from '../core.js'
import { roleName } from '../session.js'

// "Alex Morgan" -> surname in capitals first, as on a real ballot paper
function ballotName(full) {
  const parts = String(full).trim().split(/\s+/)
  const surname = parts.pop() || ''
  return [h('span', { class: 'surname' }, surname.toUpperCase()), parts.length ? ', ' + parts.join(' ') : '']
}

export default async function vote(main) {
  main.append(pageHead('Cast your vote',
    'Number the candidates in your order of preference. Your ballot is checked, separated from your identity and stored, and you receive a signed receipt.',
    ['SR-05', 'SR-07', 'SR-10']))

  if (!state.user) {
    return main.append(notice('info', 'Sign in as a voter to cast a ballot.',
      h('p', null, h('a', { href: '#/sign-in' }, 'Go to sign in'), ' (demo account: voter1 / VoterPass123!).')))
  }
  if (state.user.role !== 'voter') {
    main.append(notice('warn', `You are signed in as ${roleName(state.user.role)}.`,
      'Only voters can cast a ballot. The server will refuse it with HTTP 403. You can still see the ballot below.'))
  }

  const res = await api('/api/ballots/candidates')
  if (!res.ok) return main.append(notice('bad', 'The ballot could not be loaded.', errorText(res)))
  if (res.data.length === 0) {
    return main.append(notice('warn', 'There are no candidates yet.', 'Run node scripts/seedCandidates.js in the backend folder, then reload.'))
  }
  const candidates = res.data
  let order = []

  const list = h('ol', { class: 'ballot-list' })
  const count = h('span', { class: 'count' })
  const castBtn = h('button', { class: 'btn go', type: 'button', disabled: true }, 'Cast my vote')
  const clearBtn = h('button', { class: 'btn secondary', type: 'button' }, 'Start again')
  const result = h('div', { 'aria-live': 'polite' })

  function render() {
    clear(list, candidates.map((c) => {
      const rank = order.indexOf(c.id)
      const label = rank >= 0 ? `${c.name}, preference ${rank + 1}. Select to remove.` : `${c.name}, not numbered. Select to number next.`
      return h('li', null, h('button', {
        class: 'ballot-option', type: 'button', 'aria-pressed': rank >= 0 ? 'true' : 'false', 'aria-label': label,
        onclick: () => {
          order = rank >= 0 ? order.filter((id) => id !== c.id) : [...order, c.id]
          render()
        }
      },
      h('span', { class: 'ballot-box', 'aria-hidden': 'true' }, rank >= 0 ? String(rank + 1) : ''),
      h('span', { class: 'cand-name' }, ballotName(c.name), c.party ? h('span', { class: 'cand-party' }, c.party) : null)))
    }))
    count.textContent = order.length === 0 ? 'No boxes numbered yet' : `${order.length} of ${candidates.length} boxes numbered`
    castBtn.disabled = order.length === 0
  }

  clearBtn.addEventListener('click', () => { order = []; render() })

  castBtn.addEventListener('click', async () => {
    const done = busy(castBtn, 'Casting…')
    const r = await api('/api/ballots/cast', { method: 'POST', auth: 'session', body: { preferences: order } })
    done()
    if (r.ok) {
      castBtn.disabled = true
      clearBtn.disabled = true
      list.querySelectorAll('button').forEach((b) => { b.disabled = true })
      state.lastReceipt = r.data.receipt
      return clear(result,
        notice('ok', 'Your vote has been recorded.',
          `It was separated from your identity in ${r.data.decouplingMs} ms. The stored ballot holds only your preferences, with no user ID, address or time.`),
        receiptStub(r.data.receipt, r.data.receiptMs))
    }
    if (r.status === 409) return clear(result, notice('warn', 'You have already voted.', 'Each voter can vote once, whether online or at a polling place. Your earlier ballot stands.'))
    if (r.status === 401) return clear(result, notice('bad', 'Your session has ended.', h('p', null, h('a', { href: '#/sign-in' }, 'Sign in again'), ' to vote.')))
    if (r.status === 403) return clear(result, notice('bad', 'Only voters can cast a ballot.', 'The server refused this request (HTTP 403).'))
    clear(result, notice('bad', 'The ballot was not accepted.', errorText(r)))
  })

  render()

  main.append(h('div', { class: 'ballot-wrap' },
    h('div', null,
      h('section', { class: 'ballot', 'aria-label': 'Ballot paper' },
        h('div', { class: 'ballot-head' },
          h('p', { class: 'house' }, 'House of Representatives'),
          h('p', { class: 'paper-name' }, 'Ballot paper'),
          h('p', { class: 'instr' }, 'Number the boxes from 1 in the order of your choice. Select a numbered box again to remove it.')),
        list,
        h('div', { class: 'ballot-foot' }, count, h('div', { class: 'row' }, clearBtn, castBtn))),
      result),
    h('aside', { class: 'side-note' },
      h('h2', null, 'What protects this ballot'),
      h('ul', null,
        h('li', null, 'Only the list of candidate numbers is sent. Any extra fields are thrown away by the allow-list check (SR-10).'),
        h('li', null, '“Who voted” and “what was voted” are written to separate tables in one step, so they can never be joined (SR-05).'),
        h('li', null, 'A SHA-384 fingerprint of the ballot is saved, so any later change is caught before counting (SR-10).'),
        h('li', null, 'Your receipt is signed by the AEC key and proves arrival without showing your choices (SR-07).')))))
}

function receiptStub(receipt, ms) {
  const save = () => {
    const blob = new Blob([JSON.stringify(receipt, null, 2)], { type: 'application/json' })
    const a = h('a', { href: URL.createObjectURL(blob), download: `aec-receipt-${receipt.receiptId.slice(0, 8)}.json` })
    a.click()
    URL.revokeObjectURL(a.href)
    toast('Receipt saved to your downloads.')
  }
  return h('section', { class: 'stub', 'aria-label': 'Your receipt' },
    h('h3', null, 'Your receipt'),
    h('p', { class: 'side-note' }, `Issued in ${ms} ms. Keep it to confirm later that your ballot was received. It does not show how you voted.`),
    h('dl', { class: 'kv' },
      h('dt', null, 'Receipt ID'), h('dd', null, receipt.receiptId),
      h('dt', null, 'Ballot commitment'), h('dd', null, receipt.commitment),
      h('dt', null, 'AEC signature'), h('dd', null, receipt.signature)),
    h('div', { class: 'row' },
      h('button', { class: 'btn', type: 'button', onclick: save }, 'Save receipt'),
      h('a', { class: 'btn secondary', href: '#/verify' }, 'Check this receipt')))
}
