// SR-05 voting page.

const messageEl = document.getElementById('message')
const castBtn = document.getElementById('castBtn')

function showMessage(text, type) {
  messageEl.textContent = text
  messageEl.className = 'message ' + type
  messageEl.hidden = false
}

async function loadCandidates() {
  const candidates = await (await fetch('/api/ballots/candidates')).json()
  const body = document.getElementById('candidateBody')

  for (const c of candidates) {
    const row = document.createElement('tr')
    const rankCell = document.createElement('td')
    const input = document.createElement('input')
    input.type = 'number'
    input.min = '1'
    input.dataset.candidateId = c.id
    rankCell.appendChild(input)

    const nameCell = document.createElement('td')
    nameCell.textContent = c.name
    const partyCell = document.createElement('td')
    partyCell.textContent = c.party || ''

    row.append(rankCell, nameCell, partyCell)
    body.appendChild(row)
  }
  castBtn.disabled = false
}

function readPreferences() {
  const ranked = [...document.querySelectorAll('input[data-candidate-id]')]
    .filter((input) => input.value !== '')
    .map((input) => ({ rank: Number(input.value), id: Number(input.dataset.candidateId) }))

  const ranks = ranked.map((r) => r.rank)
  if (ranked.length === 0) throw new Error('Please rank at least one candidate.')
  if (new Set(ranks).size !== ranks.length) throw new Error('Each preference number can only be used once.')

  return ranked.sort((a, b) => a.rank - b.rank).map((r) => r.id)
}

castBtn.addEventListener('click', async () => {
  messageEl.hidden = true

  let preferences
  try {
    preferences = readPreferences()
  } catch (error) {
    return showMessage(error.message, 'error')
  }

  castBtn.disabled = true
  try {
    const response = await fetch('/api/ballots/cast', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + sessionStorage.getItem('sessionToken')
      },
      body: JSON.stringify({ preferences })
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error)

    showMessage(
      `Your vote has been recorded and separated from your identity in ${data.decouplingMs} ms. It cannot be linked back to you.`,
      'ok'
    )
    showReceipt(data.receipt, data.receiptMs)
  } catch (error) {
    showMessage(error.message, 'error')
    castBtn.disabled = false
  }
})
// SR-07: show the signed receipt (it contains no ballot contents)
function showReceipt(receipt, receiptMs) {
  document.getElementById('receiptId').textContent = receipt.receiptId
  document.getElementById('receiptCommitment').textContent = receipt.commitment
  document.getElementById('receiptSignature').textContent = receipt.signature
  document.getElementById('receiptTime').textContent = `Receipt issued in ${receiptMs} ms.`
  document.getElementById('receipt').hidden = false

  document.getElementById('saveReceiptBtn').onclick = () => {
    const file = new Blob([JSON.stringify(receipt, null, 2)], { type: 'application/json' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(file)
    link.download = `aec-receipt-${receipt.receiptId.slice(0, 8)}.json`
    link.click()
    URL.revokeObjectURL(link.href)
  }
}
// Candidates are public, so load them straight away
loadCandidates().catch(() => showMessage('Could not load the ballot', 'error'))

// idleTimeout.js confirms the login (and sends logged-out users to the login page)
document.addEventListener('session-ready', (event) => {
  const { userId, role } = event.detail
  document.getElementById('who').textContent = `Logged in as user ${userId} (${role})`
})