// Check a receipt (SR-07). Anyone can do this; no sign-in needed.
import { state, h, api, clear, notice, pageHead, busy } from '../core.js'

export default function verify(main) {
  main.append(pageHead('Check a receipt',
    'Confirm that a receipt was issued by the AEC and that the ballot it belongs to is on record. This reveals nothing about how anyone voted.',
    ['SR-07']))

  const text = h('textarea', { id: 'receipt-json', spellcheck: 'false', placeholder: '{ "receiptId": "…", "commitment": "…", "signature": "…" }' })
  if (state.lastReceipt) text.value = JSON.stringify(state.lastReceipt, null, 2)
  const file = h('input', { type: 'file', id: 'receipt-file', accept: 'application/json,.json' })
  const result = h('div', { 'aria-live': 'polite' })
  const checkBtn = h('button', { class: 'btn', type: 'submit' }, 'Check receipt')

  file.addEventListener('change', async () => {
    const f = file.files[0]
    if (f) text.value = (await f.text()).slice(0, 4000)
  })

  const form = h('form', { class: 'panel stack', onsubmit: async (e) => {
    e.preventDefault()
    let receipt
    try {
      receipt = JSON.parse(text.value)
    } catch {
      return clear(result, notice('bad', 'That is not a receipt.', 'Paste the receipt exactly as saved, including the curly brackets, or open the saved file.'))
    }
    const done = busy(checkBtn, 'Checking…')
    const r = await api('/api/receipts/verify', { method: 'POST', body: receipt })
    done()
    if (r.ok && r.data.valid) {
      return clear(result, notice('ok', 'This receipt is genuine.', 'The AEC signature is valid and the matching ballot is on record.'))
    }
    clear(result, notice('bad', 'This receipt could not be confirmed.', (r.data && r.data.reason) || 'Unknown reason.'))
  } },
  h('label', { class: 'field', for: 'receipt-json' }, 'Receipt', h('span', { class: 'hint' }, 'Paste the receipt text, or open the file you saved.'), text),
  h('label', { class: 'field', for: 'receipt-file' }, 'Saved receipt file', file),
  h('div', { class: 'row' }, checkBtn),
  result)

  main.append(h('div', { class: 'grid-2' }, form,
    h('aside', { class: 'side-note' },
      h('h2', null, 'Try it'),
      h('ul', null,
        h('li', null, 'Check a fresh receipt: it is confirmed.'),
        h('li', null, 'Change one character of the signature: the signature check fails.'),
        h('li', null, 'Change the commitment: there is no matching ballot on record.')),
      h('p', null, 'The receipt holds a commitment made with a secret salt that is never given out, so it cannot be used to prove to anyone else how you voted. This stops vote buying.'))))
}
