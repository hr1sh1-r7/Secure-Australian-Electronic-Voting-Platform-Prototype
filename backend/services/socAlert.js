const db = require('../db')

// SR-11: raises a high-priority alert for the Security Operations Centre (SOC).
// Every alert is stored in security_alerts. If SOC_WEBHOOK_URL is set in .env,
// it is also sent there immediately as JSON. The send times out after 10 seconds,
// so delivery is always attempted well inside the 15-second requirement.
const WEBHOOK_TIMEOUT_MS = 10 * 1000

const insertAlert = db.prepare(`
  INSERT INTO security_alerts (created_at, severity, type, username, details)
  VALUES (?, ?, ?, ?, ?)
`)
const markDelivered = db.prepare('UPDATE security_alerts SET delivered_at = ? WHERE id = ?')
const markFailed = db.prepare('UPDATE security_alerts SET delivery_error = ? WHERE id = ?')
const listAlerts = db.prepare('SELECT * FROM security_alerts ORDER BY id DESC')

async function sendSocAlert({ type, username, details = {}, severity = 'HIGH' }) {
  const createdAt = Date.now()
  const id = Number(
    insertAlert.run(createdAt, severity, type, username, JSON.stringify(details)).lastInsertRowid
  )

  const alert = {
    id,
    severity,
    type,
    username,
    details,
    createdAt: new Date(createdAt).toISOString()
  }

  const url = process.env.SOC_WEBHOOK_URL
  if (!url) {
    return { ...alert, delivered: false, reason: 'no SOC_WEBHOOK_URL configured' }
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(alert),
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS)
    })
    if (!response.ok) throw new Error(`SOC webhook responded ${response.status}`)

    const deliveredAt = Date.now()
    markDelivered.run(deliveredAt, id)
    return { ...alert, delivered: true, deliveryMs: deliveredAt - createdAt }
  } catch (error) {
    markFailed.run(error.message, id)
    return { ...alert, delivered: false, reason: error.message }
  }
}

function getAlerts() {
  return listAlerts.all()
}

module.exports = { sendSocAlert, getAlerts, WEBHOOK_TIMEOUT_MS }