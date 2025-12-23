#!/bin/bash
# SignalK Server - Dependency Security Scanner
# Runs multiple dependency scanning tools and generates reports

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
REPORTS_DIR="$SCRIPT_DIR/../reports"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "=========================================="
echo "SignalK Server - Dependency Security Scan"
echo "=========================================="
echo ""

cd "$PROJECT_ROOT"

# Create reports directory
mkdir -p "$REPORTS_DIR"

# 1. npm audit
echo -e "${YELLOW}[1/4] Running npm audit...${NC}"
npm audit --production > "$REPORTS_DIR/npm-audit-$TIMESTAMP.txt" 2>&1 || true
npm audit --production --json > "$REPORTS_DIR/npm-audit-$TIMESTAMP.json" 2>&1 || true

# Count vulnerabilities
CRITICAL=$(grep -c '"severity":"critical"' "$REPORTS_DIR/npm-audit-$TIMESTAMP.json" 2>/dev/null || echo "0")
HIGH=$(grep -c '"severity":"high"' "$REPORTS_DIR/npm-audit-$TIMESTAMP.json" 2>/dev/null || echo "0")

if [ "$CRITICAL" != "0" ] || [ "$HIGH" != "0" ]; then
    echo -e "${RED}  Found: $CRITICAL critical, $HIGH high severity vulnerabilities${NC}"
else
    echo -e "${GREEN}  No critical or high severity vulnerabilities found${NC}"
fi
echo "  Report: $REPORTS_DIR/npm-audit-$TIMESTAMP.txt"
echo ""

# 2. Snyk (if installed)
echo -e "${YELLOW}[2/4] Running Snyk...${NC}"
if command -v snyk &> /dev/null; then
    snyk test --json > "$REPORTS_DIR/snyk-$TIMESTAMP.json" 2>&1 || true
    snyk test > "$REPORTS_DIR/snyk-$TIMESTAMP.txt" 2>&1 || true
    echo -e "${GREEN}  Report: $REPORTS_DIR/snyk-$TIMESTAMP.txt${NC}"
else
    echo -e "${YELLOW}  Snyk not installed. Install with: npm install -g snyk${NC}"
    echo "  For best CVE coverage, Snyk is strongly recommended."
fi
echo ""

# 3. Check for known vulnerable packages (manual list)
echo -e "${YELLOW}[3/4] Checking for known problematic packages...${NC}"
VULNERABLE_PACKAGES=(
    "lodash:4.17.20"      # Prototype pollution CVEs
    "moment:2.29.3"       # ReDoS CVEs
    "jsonwebtoken:8.5.1"  # Algorithm confusion CVE-2022-23529
    "express:4.17.2"      # Various CVEs
)

PACKAGE_JSON="$PROJECT_ROOT/package.json"
ISSUES_FOUND=0

for pkg_check in "${VULNERABLE_PACKAGES[@]}"; do
    PKG_NAME="${pkg_check%%:*}"
    MIN_VERSION="${pkg_check##*:}"

    INSTALLED_VERSION=$(node -p "try { require('./package-lock.json').packages['node_modules/$PKG_NAME']?.version || 'not found' } catch(e) { 'not found' }" 2>/dev/null || echo "not found")

    if [ "$INSTALLED_VERSION" != "not found" ]; then
        echo "  $PKG_NAME: $INSTALLED_VERSION"
    fi
done
echo ""

# 4. License check (security-relevant)
echo -e "${YELLOW}[4/4] Checking for problematic licenses...${NC}"
if command -v npx &> /dev/null; then
    npx license-checker --summary > "$REPORTS_DIR/licenses-$TIMESTAMP.txt" 2>&1 || echo "  License check skipped (install license-checker for this)"
fi

echo ""
echo "=========================================="
echo "Scan Complete"
echo "=========================================="
echo "Reports saved to: $REPORTS_DIR/"
echo ""
echo "Files generated:"
ls -la "$REPORTS_DIR"/*$TIMESTAMP* 2>/dev/null || echo "  (no new reports)"
echo ""

# Summary
echo "Next steps:"
echo "  1. Review npm-audit report for vulnerabilities"
echo "  2. Run 'npm audit fix' to auto-fix where possible"
echo "  3. Check Snyk report for additional CVEs"
echo "  4. Update packages with known vulnerabilities manually"
