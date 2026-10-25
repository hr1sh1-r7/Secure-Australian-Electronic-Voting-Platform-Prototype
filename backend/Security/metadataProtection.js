
const METADATA_IP = '169.254.169.254'

function isMetadataAddress(address) {
  if (!address) return false

  const normalized = String(address).toLowerCase()

  return (
    normalized === METADATA_IP ||
    normalized === '::ffff:169.254.169.254'
  )
}

function checkMetadataRequest(address, logger = console) {
  if (isMetadataAddress(address)) {
    // Record the blocked attempt immediately.
    logger.warn('Blocked cloud metadata access attempt')

    return {
      allowed: false,
      reason: 'cloud_metadata_address_blocked'
    }
  }

  return {
    allowed: true,
    reason: 'not_cloud_metadata_address'
  }
}

function isImdsv2Enabled(headers = {}) {
  // AWS IMDSv2 requests must include a token obtained
  // through the IMDSv2 token endpoint.
  return Boolean(headers['x-aws-ec2-metadata-token'])
}

module.exports = {
  METADATA_IP,
  isMetadataAddress,
  checkMetadataRequest,
  isImdsv2Enabled
}
