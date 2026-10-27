// SR-07: check a receipt with the server. No login needed; reveals no vote.
const resultEl = document.getElementById('result')

function showResult(text, valid) {
  resultEl.textContent = text
  resultEl.className = 'result ' + (valid ? 'valid' : 'invalid')
  resultEl.hidden = false
}

document.getElementById('receiptFile').addEventListener('change', async (event) => {
  const file = event.target.files[0]
  if (file) document.getElementById('receiptText').value = await file.text()
})

document.getElementById('verifyBtn').addEventListener('click', async () => {
  let receipt
  try {
    receipt = JSON.parse(document.getElementById('receiptText').value)
  } catch {
    return showResult('That is not a valid receipt file.', false)
  }

  try {
    const response = await fetch('/api/receipts/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(receipt)
    })
    const data = await response.json()

    if (data.valid) {
      showResult('Genuine receipt: signed by the AEC, and your ballot is on record.', true)
    } else {
      showResult('Not valid: ' + data.reason, false)
    }
  } catch {
    showResult('Server not reachable', false)
  }
})