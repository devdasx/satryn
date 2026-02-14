# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Satryn, please report it responsibly. **Do not open a public GitHub issue.**

### How to Report

Email your findings to: **security@satryn.app**

Include:
- A description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if you have one)

### What to Expect

- We will acknowledge your report within 48 hours.
- We will investigate and provide an initial assessment within 7 days.
- We will work with you to understand the issue and coordinate a fix.
- We will credit you in the fix (unless you prefer to remain anonymous).

### Scope

The following are in scope:
- Key generation and derivation flaws
- Seed phrase / private key exposure (logging, storage, network)
- Transaction signing vulnerabilities
- PIN / biometric bypass
- iCloud backup encryption weaknesses
- Electrum protocol implementation issues
- Any path that leaks sensitive wallet data

The following are out of scope:
- Social engineering attacks
- Physical device access attacks (beyond what the OS provides)
- Denial-of-service attacks against public Electrum servers
- Issues in third-party dependencies (report those upstream, but let us know)

## Security Design

For details on how Satryn handles key storage, encryption, and authentication, see the [Architecture section](README.md#architecture) of the README.

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.x     | Yes       |
| < 1.0   | No        |

We only provide security patches for the latest released version.
