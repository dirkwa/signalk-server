# SignalK Installer Auto-Update Setup

This document explains how to configure the auto-update feature for the SignalK Installer.

## Overview

The Tauri updater requires cryptographic signing to verify that updates come from a trusted source. This involves:

1. Generating a signing keypair (one-time setup)
2. Adding the private key as a GitHub secret
3. Adding the public key to `tauri.conf.json`
4. The CI workflow automatically signs builds and generates `latest.json`

## Step 1: Generate Signing Keys

Run the key generation script:

```bash
cd packages/installer
./scripts/generate-signing-keys.sh
```

This will:
- Prompt you for a password (optional but recommended)
- Generate a private key at `.keys/signalk-installer.key`
- Generate a public key at `.keys/signalk-installer.key.pub`

**Important**: The `.keys/` directory is gitignored and should NEVER be committed!

## Step 2: Add GitHub Secrets

Go to your repository's Settings → Secrets and variables → Actions, and add:

| Secret Name | Value |
|-------------|-------|
| `TAURI_SIGNING_PRIVATE_KEY` | Contents of `.keys/signalk-installer.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | The password you entered (or empty if none) |

## Step 3: Update tauri.conf.json

Copy the public key from `.keys/signalk-installer.key.pub` and add it to `tauri.conf.json`:

```json
{
  "plugins": {
    "updater": {
      "endpoints": [
        "https://github.com/SignalK/signalk-server/releases/latest/download/latest.json"
      ],
      "pubkey": "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEFCQ0RFRjEyMzQ1Njc4OTAKUQ=="
    }
  }
}
```

Replace the `pubkey` value with your actual public key.

## Step 4: Commit and Release

1. Commit the updated `tauri.conf.json` with the public key
2. Create a new release tag (e.g., `v2.20.0`)
3. The GitHub Actions workflow will:
   - Build installers for all platforms
   - Sign each installer with your private key
   - Generate `latest.json` with download URLs and signatures
   - Upload everything to the GitHub release

## How Auto-Update Works

1. When the installer starts, it checks the `endpoints` URL for `latest.json`
2. If a newer version is found, it downloads the appropriate package
3. The signature is verified using the `pubkey` in `tauri.conf.json`
4. If valid, the update is installed

## Troubleshooting

### "Signature verification failed"
- Ensure the public key in `tauri.conf.json` matches the private key used for signing
- Check that `TAURI_SIGNING_PRIVATE_KEY` secret is correctly set

### "No update available" when there should be
- Verify `latest.json` exists in the latest release
- Check the version number in `latest.json` is higher than current
- Ensure the platform key matches (e.g., `linux-x86_64`, `darwin-aarch64`)

### Build doesn't generate .sig files
- Ensure `TAURI_SIGNING_PRIVATE_KEY` secret is set
- Check workflow logs for signing errors

## Security Notes

- The private key should only exist in GitHub Secrets
- Never commit the private key to the repository
- If the private key is compromised, generate a new keypair and update the public key
- Users will need to manually update to a version with the new public key
