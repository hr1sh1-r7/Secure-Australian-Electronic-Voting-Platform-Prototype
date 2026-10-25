
const {
  METADATA_IP,
  isMetadataAddress,
  checkMetadataRequest,
  isImdsv2Enabled
} = require('../Security/metadataProtection')

describe('SR-19: Cloud metadata SSRF protection', () => {
  test('identifies the cloud metadata IP address', () => {
    expect(isMetadataAddress(METADATA_IP)).toBe(true)
  })

  test('identifies the IPv4-mapped IPv6 metadata address', () => {
    expect(isMetadataAddress('::ffff:169.254.169.254')).toBe(true)
  })

  test('allows a different address', () => {
    expect(isMetadataAddress('192.168.1.10')).toBe(false)
  })

  test('blocks metadata access and logs the attempt', () => {
    const logger = { warn: jest.fn() }

    const result = checkMetadataRequest(METADATA_IP, logger)

    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('cloud_metadata_address_blocked')
    expect(logger.warn).toHaveBeenCalledTimes(1)
  })

  test('allows a non-metadata address', () => {
    const result = checkMetadataRequest('192.168.1.10', {
      warn: jest.fn()
    })

    expect(result.allowed).toBe(true)
  })

  test('recognises an IMDSv2 token header', () => {
    expect(
      isImdsv2Enabled({
        'x-aws-ec2-metadata-token': 'test-token'
      })
    ).toBe(true)
  })

  test('rejects a missing IMDSv2 token header', () => {
    expect(isImdsv2Enabled({})).toBe(false)
  })
})
