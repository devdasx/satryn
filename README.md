# Satryn

A self-custody Bitcoin wallet for iOS. Open source, Bitcoin-only, built with React Native and Expo.

Satryn gives you full control over your Bitcoin. Your keys are generated and stored on your device. No accounts, no servers holding your funds, no third-party custody.

## Features

### Core

- **HD Wallet** -- BIP39 seed generation, BIP44/84/86 derivation (Legacy, SegWit, Taproot)
- **Send & Receive** -- Full transaction building with BIP21 URI and QR code support
- **Fee Control** -- Choose your fee rate in sat/vB, or use mempool-based estimates
- **Transaction Details** -- Inputs, outputs, confirmation count, fee breakdown, RBF status
- **Multiple Wallets** -- Create and manage multiple wallets in a single app
- **Real-Time Prices** -- Live BTC price in 50+ fiat currencies

### Security

- **Self-Custody** -- Keys never leave your device
- **Encrypted Storage** -- Seed phrases encrypted with AES-256 in the iOS Keychain
- **PIN Protection** -- 6-digit PIN required for all sensitive operations
- **Face ID / Touch ID** -- Optional biometric authentication
- **Auto-Lock** -- Configurable inactivity timeout
- **Screenshot Prevention** -- Blocks screenshots on sensitive screens

### Advanced

- **Coin Control** -- Full UTXO management: freeze, label, tag, and select individual UTXOs
- **Custom Electrum Server** -- Connect to your own Electrum server for full network privacy
- **Multisig Vaults** -- Create and manage multi-signature wallets
- **Watch-Only Wallets** -- Import via xpub, output descriptor, or address list
- **PSBT Support** -- Partially Signed Bitcoin Transactions for hardware wallet workflows
- **Encrypted iCloud Backup** -- AES-256-GCM encrypted backups to iCloud with auto-backup daily
- **Message Signing** -- Sign and verify messages with your Bitcoin keys
- **Bluetooth P2P** -- Send payment requests to nearby devices
- **RBF Fee Bumping** -- Replace-by-fee for stuck transactions
- **Address Formats** -- Native SegWit (bc1q), Taproot (bc1p), Wrapped SegWit (3...), Legacy (1...)

### Privacy

- **No Analytics by Default** -- Optional diagnostics that you control, always off by default
- **No Accounts** -- No email, no registration, no identity
- **Custom Server** -- Route all queries through your own Electrum node
- **Local-First** -- All wallet data stored on-device

## Screenshots

<!-- Add App Store screenshots here -->

## Getting Started

### Prerequisites

- Node.js 18+ (tested with Node 22)
- npm 9+
- Xcode 15+ (for iOS builds)
- An Apple Developer account (for device builds)
- EAS CLI (`npm install -g eas-cli`) for cloud builds

### Installation

```bash
# Clone the repository
git clone https://github.com/devdasx/satryn.git
cd satryn

# Install dependencies
npm install

# Generate native iOS project
npx expo prebuild

# Start the development server
npm start
```

### Running on iOS Simulator

```bash
npx expo run:ios
```

### Running on a Physical Device

```bash
# Build a development client
eas build --profile development --platform ios

# Or build locally with Xcode
npx expo prebuild
open ios/Satryn.xcworkspace
# Select your device in Xcode and press Run
```

### Building for Production

```bash
# Production build via EAS
eas build --profile production --platform ios

# Submit to App Store
eas submit --platform ios
```

## Project Structure

```
satryn/
├── app/                          # Screens (Expo Router, file-based routing)
│   ├── (auth)/                   # Authenticated app screens
│   │   ├── (tabs)/               # Bottom tab navigation
│   │   │   ├── index.tsx         # Portfolio / Dashboard
│   │   │   ├── wallet.tsx        # Wallet details
│   │   │   ├── contacts.tsx      # Address book
│   │   │   └── settings.tsx      # Settings
│   │   ├── send-*.tsx            # Send flow (recipient, amount, review, PIN, broadcast)
│   │   ├── receive.tsx           # Receive with QR code
│   │   ├── transaction-details   # Transaction inspector
│   │   ├── utxo-management.tsx   # Coin control
│   │   ├── electrum-server.tsx   # Custom server config
│   │   ├── icloud-backup.tsx     # iCloud backup management
│   │   └── ...                   # 40+ additional screens
│   ├── (onboarding)/             # Wallet creation & import
│   ├── (lock)/                   # Lock screen
│   └── pay.tsx                   # Deep link handler (satryn://)
│
├── src/
│   ├── components/               # Reusable UI components
│   │   ├── ui/                   # Design system (buttons, sheets, inputs)
│   │   ├── backup/               # Backup-related components
│   │   ├── wallet/               # Wallet cards, selectors
│   │   └── send/                 # Send flow step components
│   ├── core/                     # Bitcoin protocol logic
│   │   ├── wallet/               # BIP39/44/84/86 key derivation
│   │   └── transaction/          # Transaction building & signing
│   ├── services/                 # Application services
│   │   ├── electrum/             # Electrum protocol client
│   │   ├── backup/               # Backup & iCloud services
│   │   ├── auth/                 # PIN, biometrics, sensitive session
│   │   ├── api/                  # Price & fee estimation APIs
│   │   └── vault/                # Secure key storage
│   ├── stores/                   # Zustand state stores
│   ├── hooks/                    # React hooks
│   ├── constants/                # Colors, config, theme
│   ├── utils/                    # Formatting, validation, helpers
│   └── types/                    # TypeScript type definitions
│
├── assets/                       # App icons, splash screens
├── patches/                      # Dependency patches (patch-package)
├── app.json                      # Expo configuration
├── eas.json                      # EAS Build configuration
├── metro.config.js               # Metro bundler config (crypto polyfills)
├── shim.js                       # Node.js polyfills for Bitcoin libraries
├── index.js                      # App entry point
└── tsconfig.json                 # TypeScript configuration
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | React Native 0.81 + Expo SDK 54 |
| Language | TypeScript (strict mode) |
| Navigation | Expo Router v6 (file-based) |
| State | Zustand v5 with MMKV persistence |
| Bitcoin | bitcoinjs-lib v7, BIP32, BIP39 |
| Crypto | AES-256-GCM via expo-crypto, PBKDF2 |
| Storage | expo-secure-store (Keychain), AsyncStorage |
| Network | Electrum protocol over TCP/TLS |
| Animations | React Native Reanimated v3 |
| UI | Custom design system, React Native Gesture Handler |

## Architecture

### Key Principles

- **Offline-first** -- The wallet works without an internet connection for viewing balances and preparing transactions. Network is only needed for broadcasting and syncing.
- **Zero-trust networking** -- All Electrum communication is over TLS. Users can point to their own server to eliminate third-party trust.
- **Ephemeral key access** -- Private keys are decrypted only when signing, then immediately discarded from memory. The `SensitiveSession` class manages PIN-gated key access with an automatic TTL.
- **No remote telemetry** -- No analytics SDKs, no crash reporting services, no network calls except for Electrum sync and price data from public APIs.

### Security Model

1. **Seed Generation** -- BIP39 mnemonic generated using `expo-crypto` CSPRNG
2. **Seed Storage** -- Encrypted with AES-256 and stored in iOS Keychain via `expo-secure-store`
3. **Key Derivation** -- BIP32 HD keys derived on-demand from the encrypted seed
4. **PIN Gating** -- All operations requiring key access go through `SensitiveSession.ensureAuth()`
5. **Auto-Lock** -- Configurable timeout clears the session and returns to lock screen
6. **Biometrics** -- Optional Face ID/Touch ID as a convenience layer over PIN entry

### Data Flow

```
User Action → Screen → Zustand Store → Service Layer → Electrum/iCloud/Keychain
                                            ↓
                                     Core (bitcoinjs-lib)
                                            ↓
                                    Transaction / Keys
```

## Configuration

### Environment

The app uses no environment variables. All configuration is either:
- Hardcoded public defaults (Electrum servers, API endpoints)
- User-configurable at runtime (custom server, fee preferences, theme)

### Electrum Servers

Default public servers are defined in `src/constants/index.ts`. Users can connect to their own server from Settings > Electrum Server.

### EAS Build

Build profiles are defined in `eas.json`:
- `development` -- Development client for local testing
- `preview` -- Internal distribution builds
- `production` -- App Store builds with auto-incrementing version

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, coding standards, and how to submit pull requests.

## Security

If you discover a security vulnerability, please report it responsibly. See [SECURITY.md](SECURITY.md) for our disclosure policy.

**Do not open a public GitHub issue for security vulnerabilities.**

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.

## Acknowledgments

Satryn is built on the work of many open-source projects:

- [bitcoinjs-lib](https://github.com/bitcoinjs/bitcoinjs-lib) -- Bitcoin protocol implementation
- [Expo](https://expo.dev) -- React Native development platform
- [Zustand](https://github.com/pmndrs/zustand) -- State management
- [mempool.space](https://mempool.space) -- Fee estimation API
- [Electrum](https://electrum.org) -- Server protocol

## Disclaimer

This software is provided as-is. You are solely responsible for the security of your Bitcoin. Always back up your seed phrase and store it securely offline. The developers assume no liability for lost funds. See [LICENSE](LICENSE) for full terms.
