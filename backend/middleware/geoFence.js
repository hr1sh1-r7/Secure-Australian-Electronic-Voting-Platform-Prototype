const net = require('net')
const { logEvent } = require('../services/auditLogger')

// SR-06: Diplomatic mission IP geo-fencing.
// Only connections from the approved diplomatic mission networks may reach the
// overseas voting subsystem. The approved networks are CIDR ranges listed in .env:
//   MISSION_ALLOWED_CIDRS=10.20.0.0/16,203.0.113.0/24
// Anything else is refused immediately (well under the 100 ms requirement) and logged.
// If no ranges are configured, ALL connections are refused (fail closed).

const SYSTEM_ACTOR = 0

// Turn "10.20.0.0/16,2001:db8::/32" into a BlockList used as an allow-list.
// Invalid entries are skipped so one typo can't open up access.
function buildAllowList(cidrText = '') {
  const list = new net.BlockList()
  const ranges = []

  for (const entry of cidrText.split(',').map((s) => s.trim()).filter(Boolean)) {
    const [address, prefixText] = entry.split('/')
    const family = net.isIPv4(address) ? 'ipv4' : net.isIPv6(address) ? 'ipv6' : null
    const prefix = Number(prefixText)
    const maxPrefix = family === 'ipv4' ? 32 : 128

    if (!family || !Number.isInteger(prefix) || prefix < 0 || prefix > maxPrefix) {
      console.warn(`[SR-06] Ignoring invalid CIDR range: "${entry}"`)
      continue
    }
    list.addSubnet(address, prefix, family)
    ranges.push(entry)
  }
  return { list, ranges }
}

// "::ffff:10.20.1.5" is how Node shows IPv4 clients on an IPv6 socket
function normaliseIp(ip = '') {
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip
}

function isAllowedIp(ip, allowList) {
  const address = normaliseIp(ip)
  const family = net.isIPv4(address) ? 'ipv4' : net.isIPv6(address) ? 'ipv6' : null
  if (!family) return false
  return allowList.list.check(address, family)
}

// Rebuilt only when the .env value changes
let cached = { text: null, allowList: null }
function currentAllowList() {
  const text = process.env.MISSION_ALLOWED_CIDRS || ''
  if (cached.text !== text) cached = { text, allowList: buildAllowList(text) }
  return cached.allowList
}

function geoFence(req, res, next) {
  const started = process.hrtime.bigint()

  // The real socket address is used, NOT the X-Forwarded-For header,
  // because that header can be faked by the client.
  const ip = normaliseIp(req.socket.remoteAddress)

  if (isAllowedIp(ip, currentAllowList())) {
    req.missionIp = ip
    return next()
  }

  const decisionMs = Number(process.hrtime.bigint() - started) / 1e6
  logEvent(SYSTEM_ACTOR, 'MISSION_ACCESS_BLOCKED', {
    ip,
    path: req.originalUrl,
    decisionMs: Number(decisionMs.toFixed(3))
  })

  res.status(403).json({ error: 'Access denied: connection is not from an approved diplomatic mission network' })
}

module.exports = { geoFence, buildAllowList, isAllowedIp, normaliseIp }