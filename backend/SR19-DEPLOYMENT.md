# SR-19: Cloud Metadata SSRF Protection

## Purpose

Prevent application containers from accessing cloud instance metadata without authorization, and record blocked access attempts.

## Application-Level Protection

The `Security/metadataProtection.js` module identifies the AWS metadata endpoint `169.254.169.254`, returns a blocked result for matching addresses, and logs blocked attempts immediately.

The module also checks for the `X-aws-ec2-metadata-token` request header associated with AWS Instance Metadata Service Version 2 (IMDSv2).

These helper checks support application-level protection but do not independently enforce network isolation or validate an AWS-issued token.

## Required Deployment Controls

1. Configure AWS EC2 instances to require IMDSv2 and disable IMDSv1.
2. Apply host firewall or cloud/container network controls to deny application-container egress to `169.254.169.254`.
3. Apply the deny rule before general outbound allow rules, and verify that the restriction cannot be bypassed through an alternate route.
4. Log denied metadata-access attempts with a timestamp and sufficient context for security monitoring.
5. Verify that blocked attempts are recorded within one second.

## Verification Status

The application helper tests verify metadata-address detection, blocked-result handling, logging invocation, and presence or absence of the IMDSv2 token header.

**Deployment status: Not yet verified.** Docker is not available in the current development environment, and the actual cloud or host network restrictions have not been deployed or tested.

Before production use, validate the egress restriction and IMDSv2 configuration in the target environment.
