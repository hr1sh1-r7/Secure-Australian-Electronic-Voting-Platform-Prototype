// Adds sample audit log entries for testing and demos (SR-09).
// Run from the backend folder:  node scripts/seedAudit.js
const { logEvent } = require('../services/auditLogger')

logEvent(1, 'ADD_CANDIDATE', { candidateId: 7, name: 'Sample Candidate' })
logEvent(1, 'EXCLUDE_CANDIDATE', { candidateId: 3, reason: 'Court of Disputed Returns order' })
logEvent(2, 'LOGIN_FAILED', { username: 'admin2' })

console.log('Added 3 sample audit log entries')