#!/bin/bash
# SignalK Server - OWASP ZAP Security Scanner
# Runs ZAP baseline scan against running SignalK server

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPORTS_DIR="$SCRIPT_DIR/../reports"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# Default target
TARGET_URL="${1:-http://localhost:3000}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "=========================================="
echo "SignalK Server - OWASP ZAP Scan"
echo "=========================================="
echo ""
echo "Target: $TARGET_URL"
echo ""

mkdir -p "$REPORTS_DIR"

# Check if target is reachable
echo -e "${YELLOW}Checking if target is reachable...${NC}"
if ! curl -s --connect-timeout 5 "$TARGET_URL" > /dev/null; then
    echo -e "${RED}Target $TARGET_URL is not reachable!${NC}"
    echo ""
    echo "Make sure SignalK server is running:"
    echo "  cd $(dirname "$SCRIPT_DIR")/.. && npm start"
    exit 1
fi
echo -e "${GREEN}Target is reachable${NC}"
echo ""

# Check for Docker
if ! command -v docker &> /dev/null; then
    echo -e "${RED}Docker not installed!${NC}"
    echo "OWASP ZAP requires Docker. Install Docker first."
    exit 1
fi

# Run ZAP baseline scan
echo -e "${YELLOW}Running ZAP baseline scan...${NC}"
echo "This may take several minutes..."
echo ""

docker run --rm \
    --network="host" \
    -v "$REPORTS_DIR:/zap/wrk:rw" \
    -t ghcr.io/zaproxy/zaproxy:stable \
    zap-baseline.py \
    -t "$TARGET_URL" \
    -r "zap-report-$TIMESTAMP.html" \
    -J "zap-report-$TIMESTAMP.json" \
    -I \
    || true

echo ""
echo "=========================================="
echo "ZAP Scan Complete"
echo "=========================================="
echo ""

if [ -f "$REPORTS_DIR/zap-report-$TIMESTAMP.html" ]; then
    echo -e "${GREEN}Reports generated:${NC}"
    echo "  - HTML: $REPORTS_DIR/zap-report-$TIMESTAMP.html"
    echo "  - JSON: $REPORTS_DIR/zap-report-$TIMESTAMP.json"
else
    echo -e "${YELLOW}Reports may be in Docker volume. Check $REPORTS_DIR${NC}"
fi

echo ""
echo "ZAP detects:"
echo "  - XSS vulnerabilities"
echo "  - Auth bypass issues"
echo "  - CORS misconfigurations"
echo "  - Insecure headers"
echo "  - WebSocket exposure"
echo ""
echo "For full API scan, use:"
echo "  docker run -t ghcr.io/zaproxy/zaproxy:stable zap-api-scan.py -t $TARGET_URL/doc/openapi"
