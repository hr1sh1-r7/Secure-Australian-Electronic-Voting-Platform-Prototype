const crypto = require('crypto')
const db = require('../db')
const { applySchema } = require('./ballotIntegrity/tables')
const { logEvent } = require('./auditLogger')

// SR-15 / SR-16: alerts to the State Electoral Officer (Muzammil s4175334).
// Every alert is stored (shown on recount.html) and written to the SR-09 audit
// log. If SEO_ALERT_WEBHOOK is set it is also POSTed there immediately
// (e.g. a Teams/Slack/SOC webhook). Delivery takes seconds - well inside
// SR-15's 10-minute limit.

applySchema(db)

const SYSTEM_ACTOR = 0
const insertAlert = db.prepare(`
  INSERT INTO seo_alerts (alert_id, raised_at, severity, subject, detail, delivered_via)
  VALUES (?, ?, ?, ?, ?, ?)
`)
const recentAlerts = db.prepare(
  'SELECT alert_id, raised_at, severity, subject, delivered_via FROM seo_alerts ORDER BY raised_at DESC LIMIT 20'
)

async function alertStateElectoralOfficer({ severity = 'CRITICAL', subject, detail }) {
  const alertId = crypto.randomUUID()
  let deliveredVia = 'dashboard'

  const webhook = process.env.SEO_ALERT_WEBHOOK
  if (webhook) {
    try {
      const res = await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alertId, severity, subject, detail }),
        signal: AbortSignal.timeout(5000)
      })
      deliveredVia = res.ok ? 'dashboard+webhook' : `dashboard (webhook HTTP ${res.status})`
    } catch (err) {
      deliveredVia = `dashboard (webhook failed: ${err.name})`
    }
  }

  insertAlert.run(alertId, new Date().toISOString(), severity, subject, JSON.stringify(detail), deliveredVia)
  logEvent(SYSTEM_ACTOR, 'SEO_ALERT_RAISED', { alertId, severity, subject, deliveredVia })
  if (process.env.NODE_ENV !== 'test') console.error(`[SEO ALERT ${severity}] ${subject}`)
  return { alertId, deliveredVia }
}

function listAlerts() {
  return recentAlerts.all()
}

module.exports = { alertStateElectoralOfficer, listAlerts }
