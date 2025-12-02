# Enable WASM Debug Logs in journalctl

WASM plugin debug logs provide detailed information about plugin loading, endpoint registration, and runtime operations. There are two ways to enable these logs.

## Method 1: Web GUI (Recommended)

The easiest way to enable WASM debug logging is through the SignalK Admin UI:

1. **Navigate to Server Settings**: Open `http://localhost:3000/@signalk/server-admin-ui/` and go to **Server** → **Settings**

2. **Enable WASM Logging**: Check the **enableWasmLogging** checkbox

3. **Submit**: Click **Submit** to save

4. **Verify the logs appear**:
   ```bash
   journalctl -u signalk -f
   ```

   You should now see lines like:
   ```
   signalk:wasm:loader Intercepting /api/logs for logviewer - handling in Node.js +0ms
   signalk:wasm:loader [logviewer] Fetching 2000 log lines via Node.js streaming +1ms
   ```

**Note**: Changes take effect immediately without requiring a server restart. WASM logging is **enabled by default**.

## Method 2: Systemd Service File (Advanced)

1. **Edit the SignalK service file**:
   ```bash
   sudo systemctl edit signalk
   ```

2. **Add the DEBUG environment variable**:
   ```ini
   [Service]
   Environment="DEBUG=signalk:wasm:*"
   ```

   Or for all SignalK debug output:
   ```ini
   [Service]
   Environment="DEBUG=signalk:*"
   ```

3. **Reload and restart the service**:
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl restart signalk
   ```

4. **Verify the logs appear**:
   ```bash
   journalctl -u signalk -f
   ```

   You should now see lines like:
   ```
   signalk:wasm:loader Intercepting /api/logs for logviewer - handling in Node.js +0ms
   signalk:wasm:loader [logviewer] Fetching 2000 log lines via Node.js streaming +1ms
   ```

## Selective Debug Output

You can enable specific debug namespaces:

| Environment Variable | What it shows |
|---------------------|---------------|
| `DEBUG=signalk:wasm:*` | All WASM-related logs |
| `DEBUG=signalk:wasm:loader` | Only WASM plugin loading |
| `DEBUG=signalk:wasm:runtime` | Only WASM runtime operations |
| `DEBUG=signalk:*` | All SignalK debug output |
| `DEBUG=*` | All debug output (very verbose!) |

## Manual Testing

To temporarily test with debug logs without modifying the service:

```bash
DEBUG=signalk:wasm:* signalk-server
```

## Disabling WASM Debug Logs

### Via Web GUI (Recommended)

1. Navigate to **Server** → **Settings**
2. Uncheck the **enableWasmLogging** checkbox
3. Click **Submit**

### Via Systemd Service File

1. **Edit the service again**:
   ```bash
   sudo systemctl edit signalk
   ```

2. **Remove or comment out the DEBUG line**:
   ```ini
   [Service]
   # Environment="DEBUG=signalk:wasm:*"
   ```

3. **Reload and restart**:
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl restart signalk
   ```
