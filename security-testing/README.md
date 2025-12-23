# SignalK Server Security Testing Framework

A comprehensive security testing framework for identifying vulnerabilities in the SignalK server.

## Previously Addressed Issues

The following security issues have been identified and addressed in separate branches:
- `issue_2178` - [Describe issue]
- `issue_2180` - [Describe issue]
- `issue_2181` - [Describe issue]

## Directory Structure

```
security-testing/
├── README.md                      # This file
├── VULNERABILITY_CHECKLIST.md     # Detailed testing checklist
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
│   └── fuzzing/                   # Input fuzzing test cases
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

### 2. Dependency Scanning

```bash
# npm audit (built-in)
npm audit --production

# Snyk (better CVE coverage)
snyk test

# Run full dependency scan script
npm run security:scan
```

### 3. Static Analysis (SAST)

```bash
# Semgrep with Node.js rules
npm run security:sast

# Or run manually with custom rules
semgrep --config=security-testing/configs/semgrep-custom.yaml .
```

### 4. Runtime Security Tests

```bash
# All security tests (requires running server)
npm run test:security

# Individual test suites
npm run test:security:websocket   # WebSocket protocol tests
npm run test:security:auth        # Authentication tests
npm run test:security:acl         # Authorization/ACL tests
npm run test:security:api         # REST API tests
npm run test:security:fuzz        # Fuzzing tests
```

### 5. OWASP ZAP (DAST)

```bash
# Start SignalK server first
npm start &

# Run ZAP baseline scan (requires Docker)
./security-testing/scripts/run-zap-scan.sh http://localhost:3000
```

## Key Attack Surfaces

Based on codebase analysis, these are the primary areas to test:

### 1. Authentication
| Vector | Description | File Reference |
|--------|-------------|----------------|
| JWT Algorithm | "none" algorithm attack, algorithm confusion | `src/tokensecurity.js` |
| Token Exposure | Tokens in query params, cookies, headers | `src/tokensecurity.js:680` |
| Rate Limiting | No brute force protection on login | `src/serverroutes.ts` |
| Re-verification | 60-second window for revoked tokens | `src/interfaces/ws.js:680` |

### 2. Authorization/ACL
| Vector | Description | File Reference |
|--------|-------------|----------------|
| Path Traversal | Delta paths not fully sanitized | `src/put.js` |
| Regex DoS | ACL patterns compiled per-check | `src/tokensecurity.js:793` |
| Permission Escalation | readonly -> readwrite -> admin | `src/tokensecurity.js` |
| Context Manipulation | vessels.self vs other vessels | `src/interfaces/rest.js` |

### 3. WebSocket
| Vector | Description | File Reference |
|--------|-------------|----------------|
| Unauthenticated | `allow_readonly` permits connections | `src/interfaces/ws.js` |
| Malformed Messages | JSON parsing, prototype pollution | `src/interfaces/ws.js` |
| DoS | Large payloads, message flooding | `src/interfaces/ws.js` |

### 4. REST API
| Vector | Description | File Reference |
|--------|-------------|----------------|
| Missing Headers | CSP, X-Frame-Options, etc. | `src/serverroutes.ts` |
| CORS | Potential misconfiguration | `src/cors.ts` |
| File Upload | Size limits, type validation | `src/serverroutes.ts` |

### 5. Plugin System
| Vector | Description | File Reference |
|--------|-------------|----------------|
| Code Execution | Plugins have full server access | `src/interfaces/plugins.ts` |
| Path Traversal | Plugin ID manipulation | `src/interfaces/plugins.ts` |

## npm Scripts Reference

| Script | Description |
|--------|-------------|
| `npm run test:security` | Run all security tests |
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

## Current Known Vulnerabilities

Run `npm audit --production` to see current dependency vulnerabilities:

| Package | Severity | Issue |
|---------|----------|-------|
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
3. Update `VULNERABILITY_CHECKLIST.md` if testing new vectors
4. Run full suite to ensure no regressions

---

*Framework version: 1.0.0*
*Compatible with SignalK Server: 2.x*
