# Security Policy

## Scope

BenchmarkWatcher is a monitoring dashboard that displays publicly available benchmark prices. It does not handle:

- User authentication
- Payment processing
- Personal data
- Trading operations

The security surface is intentionally minimal.

## Reporting a Vulnerability

If you discover a security issue, please:

1. **Do not** open a public issue
2. Email the maintainers directly (or use GitHub's private vulnerability reporting if enabled)
3. Include:
   - Description of the issue
   - Steps to reproduce
   - Potential impact

We will respond within 48 hours and work with you on a fix.

## What We Consider Security Issues

- Exposure of API keys or secrets
- Code injection vulnerabilities
- Path traversal in data handling
- Denial of service vectors

## What We Do Not Consider Security Issues

- Data accuracy (this is a monitoring tool, not a trading system)
- Simulation mode behavior (clearly documented)
- Missing features

## Responsible Disclosure

We appreciate responsible disclosure. If you report a valid security issue, we will:

- Acknowledge your contribution
- Credit you in the fix (if you wish)
- Not pursue legal action for good-faith security research

Thank you for helping keep BenchmarkWatcher safe.
