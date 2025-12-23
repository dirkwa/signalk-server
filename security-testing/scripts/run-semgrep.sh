#!/bin/bash
# SignalK Server - Semgrep SAST Scanner
# Runs Semgrep with Node.js security rules

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
REPORTS_DIR="$SCRIPT_DIR/../reports"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "=========================================="
echo "SignalK Server - Semgrep SAST Scan"
echo "=========================================="
echo ""

cd "$PROJECT_ROOT"
mkdir -p "$REPORTS_DIR"

# Check if semgrep is installed
if ! command -v semgrep &> /dev/null; then
    echo -e "${RED}Semgrep not installed!${NC}"
    echo ""
    echo "Install with:"
    echo "  pip install semgrep"
    echo "  # or"
    echo "  brew install semgrep"
    echo "  # or"
    echo "  docker run --rm -v \"\${PWD}:/src\" returntocorp/semgrep semgrep --config=p/nodejs"
    exit 1
fi

# Run Semgrep with Node.js security rules
echo -e "${YELLOW}Running Semgrep with p/nodejs rules...${NC}"

semgrep --config=p/nodejs \
    --json \
    --output="$REPORTS_DIR/semgrep-nodejs-$TIMESTAMP.json" \
    --exclude="node_modules" \
    --exclude="dist" \
    --exclude="packages/server-admin-ui/build" \
    . || true

# Also run with additional security rules
echo -e "${YELLOW}Running Semgrep with p/security-audit rules...${NC}"

semgrep --config=p/security-audit \
    --json \
    --output="$REPORTS_DIR/semgrep-security-$TIMESTAMP.json" \
    --exclude="node_modules" \
    --exclude="dist" \
    --exclude="packages/server-admin-ui/build" \
    . || true

# Generate human-readable report
echo -e "${YELLOW}Generating summary report...${NC}"

semgrep --config=p/nodejs \
    --config=p/security-audit \
    --exclude="node_modules" \
    --exclude="dist" \
    --exclude="packages/server-admin-ui/build" \
    . > "$REPORTS_DIR/semgrep-summary-$TIMESTAMP.txt" 2>&1 || true

echo ""
echo "=========================================="
echo "Semgrep Scan Complete"
echo "=========================================="
echo ""
echo "Reports saved to:"
echo "  - $REPORTS_DIR/semgrep-nodejs-$TIMESTAMP.json"
echo "  - $REPORTS_DIR/semgrep-security-$TIMESTAMP.json"
echo "  - $REPORTS_DIR/semgrep-summary-$TIMESTAMP.txt"
echo ""

# Count findings
if [ -f "$REPORTS_DIR/semgrep-nodejs-$TIMESTAMP.json" ]; then
    FINDINGS=$(jq '.results | length' "$REPORTS_DIR/semgrep-nodejs-$TIMESTAMP.json" 2>/dev/null || echo "0")
    echo "Total findings in nodejs ruleset: $FINDINGS"
fi

echo ""
echo "Common issues Semgrep finds:"
echo "  - Unsafe eval() usage"
echo "  - Prototype pollution"
echo "  - Regex DoS (ReDoS)"
echo "  - Insecure deserialization"
echo "  - Path traversal"
echo "  - SQL injection"
echo "  - XSS vulnerabilities"
