# SignalK Server Security Testing Framework

A comprehensive security testing framework for identifying vulnerabilities in the SignalK server. This framework provides 500+ automated tests that document real, code-verified security issues.

## Directory Structure

```
security-testing/
├── README.md                      # This file
├── run-all-tests.sh               # Master test runner
├── scripts/
│   ├── run-dependency-scan.sh     # npm audit + Snyk scanning
│   ├── run-semgrep.sh             # Static analysis (SAST)
│   └── run-zap-scan.sh            # OWASP ZAP runtime scanning
├── configs/
│   ├── eslint-security.config.js  # ESLint security plugin config
│   ├── semgrep-custom.yaml        # Custom Semgrep rules for SignalK
│   └── security-ci.yml            # GitHub Actions CI pipeline
├── tests/
│   ├── websocket/                 # WebSocket protocol security tests
│   ├── auth/                      # Authentication bypass tests
│   ├── api/                       # REST API security tests
│   ├── acl/                       # ACL/Authorization tests
│   ├── fuzzing/                   # Input fuzzing test cases
│   └── advanced/                  # Code-verified vulnerability tests
│       ├── additional-real-vulns.test.js  # 43 verified vulnerabilities
│       ├── undiscovered-vulns.test.js     # Vulnerability hunting tests
│       ├── privilege-escalation.test.js   # Privilege escalation tests
│       └── ...
└── reports/                       # Generated security reports
```

## Quick Start

### Prerequisites

```bash
# Optional but recommended tools
npm install -g snyk        # CVE scanning (requires free account)
pip install semgrep        # Static analysis
# Docker required for OWASP ZAP
```

### 1. Run Complete Security Suite

```bash
# Start server in one terminal
npm start

# Run all tests in another terminal
npm run security:all
# or
./security-testing/run-all-tests.sh
```

### 2. Run Specific Test Suites

```bash
# All security tests (requires running server)
npm run test:security

# Code-verified vulnerabilities (no server required)
npx mocha security-testing/tests/advanced/additional-real-vulns.test.js

# Individual test suites
npm run test:security:websocket   # WebSocket protocol tests
npm run test:security:auth        # Authentication tests
npm run test:security:acl         # Authorization/ACL tests
npm run test:security:api         # REST API tests
npm run test:security:fuzz        # Fuzzing tests
```

## Test Results Interpretation

The tests are designed to work with or without security enabled:

- **404 responses**: Security endpoints not available (security not enabled)
- **401/403 responses**: Properly protected endpoints
- **200 responses**: May be a finding if sensitive data is exposed

Watch for these console warnings during test runs:
- `CRITICAL:` - Severe security issues requiring immediate attention
- `SECURITY ISSUE:` - Confirmed vulnerabilities
- `WARNING:` - Potential issues to investigate
- `FINDING:` - Missing security best practices

## npm Scripts Reference

| Script | Description |
|--------|-------------|
| `npm run test:security` | Run all security tests (500+ tests) |
| `npm run test:security:websocket` | WebSocket tests only |
| `npm run test:security:auth` | Authentication tests only |
| `npm run test:security:acl` | ACL/authorization tests only |
| `npm run test:security:api` | REST API tests only |
| `npm run test:security:fuzz` | Input fuzzing tests only |
| `npm run security:scan` | Dependency vulnerability scan |
| `npm run security:sast` | Static analysis with Semgrep |
| `npm run security:all` | Complete security test suite |

## CI Integration

Copy `configs/security-ci.yml` to `.github/workflows/security.yml` for automated security scanning:

```yaml
# Minimal CI security pipeline
jobs:
  security:
    steps:
      - npm audit --production
      - snyk test
      - semgrep --config=p/nodejs
      - npm run test:security
```

## Known Dependency Vulnerabilities

Run `npm audit --production` to see current dependency vulnerabilities:

| Package | Severity | Issue |
|---------|----------|-------|
| json-patch | Critical | Prototype pollution |
| cookie | Low | Out of bounds characters |
| nanoid/primus | Moderate | Predictable generation |
| semver/mdns-js | High | ReDoS vulnerability |
| tmp/inquirer | Low | Symlink write issue |

## Reporting Vulnerabilities

If you find a security vulnerability:

1. **Do NOT** create a public GitHub issue
2. Create a [private security advisory](https://github.com/SignalK/signalk-server/security/advisories/new)
3. Include:
   - Affected version(s)
   - Steps to reproduce
   - Proof of concept (if safe to share)
   - Suggested fix (if available)
   - CVSS score estimate

## Tools Reference

| Purpose | Tool | Installation |
|---------|------|--------------|
| CVE scanning | Snyk | `npm install -g snyk` |
| CVE scanning | npm audit | Built-in |
| SAST | Semgrep | `pip install semgrep` |
| DAST | OWASP ZAP | Docker |
| WebSocket testing | wscat | `npm install -g wscat` |
| Secrets scanning | gitleaks | `brew install gitleaks` |

## Contributing

When adding new security tests:

1. Place tests in appropriate subdirectory under `tests/`
2. Follow existing test patterns (Mocha + Chai)
3. Tests should pass regardless of whether security is enabled
4. Use console warnings (`WARNING:`, `FINDING:`, etc.) to report issues
5. For code-verified vulnerabilities, include file:line references
6. Run full suite to ensure no regressions

---

*Framework version: 2.0.0*
*Compatible with SignalK Server: 2.x*
*Tests: 500+ passing*
*Vulnerabilities documented: 167*
