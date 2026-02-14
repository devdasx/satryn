# 000 - Full Codebase Analysis & Audit
**Date**: 2026-02-06
**Type**: PLAN / RESEARCH

## Overview
Complete deep-dive analysis of the Satryn Bitcoin Wallet iOS app. Three parallel exploration agents read every file in the project.

## Project Identity
- **App Name**: Satryn
- **Bundle ID**: `com.satryn.bitcoinapp`
- **Deep Link Schemes**: `satryn://`, `bitcoin-wallet://`
- **Owner**: yousefbitq
- **Apple Team ID**: ALH96JDA6X

## Tech Stack
| Layer | Technology |
|-------|-----------|
| Framework | React Native 0.81.5, React 19.1.0 |
| Platform | Expo SDK 54 |
| Language | TypeScript 5.9 |
| Navigation | Expo Router 6 (file-based) |
| State | Zustand 5 (16 stores) |
| Bitcoin | bitcoinjs-lib 7, bip32, bip39, ecpair, @bitcoinerlab/secp256k1 |
| Networking | react-native-tcp-socket (Electrum TCP/TLS) |
| Data | @tanstack/react-query 5 |
| Security | expo-secure-store, expo-local-authentication, expo-crypto |
| Backup | expo-icloud-storage (patched), node-forge, pako |
| UI | react-native-reanimated, expo-blur, expo-linear-gradient, expo-glass-effect |

## Scale
- 40+ screens in app/ directory
- 90+ React components in src/components/
- 16 Zustand stores in src/stores/
- ~134KB walletStore.ts (largest file)
- ~80KB SecureStorage.ts

## Key Features Found
1. HD Wallet (BIP39/32/44/49/84/86), 12/24 word mnemonics
2. 4 Address Types: Native SegWit, Wrapped SegWit, Legacy, Taproot
3. Multi-Wallet support with wallet switching
4. Multisig (M-of-N, up to 15 cosigners, BIP48)
5. Watch-Only (xpub/descriptor/address list)
6. Universal Import (BIP39, WIF, BIP38, xprv, descriptors, Electrum files, UR codes)
7. Manual Entropy (coin flips, dice, touch, numbers with HKDF-SHA256)
8. PSBT support, UTXO coin control, Fee bumping (RBF + CPFP)
9. PIN + Face ID/Touch ID + auto-lock + progressive lockout
10. iCloud encrypted backup (AES-256-GCM, PBKDF2 100k)
11. Contacts, deep links, push notifications, message signing, PDF export
12. iOS 26 Liquid Glass design system

## Data Flow
1. Wallet Creation: SeedGenerator -> SecureVault -> KeyDerivation
2. Unlock: PinCodeScreen -> SecureStorage -> decrypt seed -> derive keys
3. Sync: WalletManager -> SyncPipeline (3-stage) -> ElectrumAPI -> walletStore
4. Send: SendContext -> UTXOSelector -> TransactionBuilder -> ElectrumAPI.broadcast
5. Price: PriceAPI/BinanceWebSocket -> priceStore -> UI

## Cryptography
- BIP39 mnemonic generation/validation
- BIP32 HD key derivation
- secp256k1 ECDSA + Schnorr (Taproot) signatures
- AES-256-GCM seed encryption at rest
- SHA-256 key derivation from PIN
- HKDF-SHA256 entropy mixing
- PBKDF2 backup encryption (100k iterations)
- iOS Keychain via expo-secure-store

## Directory Structure
```
/
├── app/                    # Expo Router screens (40+)
│   ├── _layout.tsx         # Root layout
│   ├── index.tsx           # Entry redirect
│   ├── (lock)/             # PIN lock screen
│   ├── (onboarding)/       # 9 screens
│   └── (auth)/             # Main app (40+)
│       ├── (tabs)/         # 3 tabs: Portfolio, Wallet, Settings
│       └── ...             # send, receive, scan, contacts, backup, multisig, etc.
├── src/
│   ├── components/         # 90+ components
│   ├── constants/          # Bitcoin constants, theme system
│   ├── core/               # wallet/ (KeyDerivation, SeedGenerator, Multisig, WatchOnly)
│   │                       # transaction/ (TransactionBuilder, UTXOSelector, FeeBumper)
│   ├── services/           # electrum/, storage/, vault/, sync/, backup/, import/, etc.
│   ├── stores/             # 16 Zustand stores
│   ├── hooks/              # useTheme, useHaptics, useBackgroundWalletSync, etc.
│   ├── types/              # TypeScript types
│   ├── utils/              # formatting, validation, descriptor, qrParser
│   └── __tests__/          # Jest tests for sync/backup
├── server/                 # Push notification server (Express + APNs + Electrum)
├── patches/                # expo-icloud-storage patch
├── shim.js                 # Crypto polyfills
├── index.js                # Entry point
└── metro.config.js         # Node.js module polyfills
```

## Build Status at Time of Audit
- TypeScript: Zero errors
- Expo Doctor: 16/17 passed (1 warning: react-native-tcp-socket + expo-icloud-storage untested on New Architecture)

## Sensitive Files Found in Repo
- `AuthKey_Q9A4V46FYC.p8` - Apple Push Notification key
- `server/AuthKey_653BV2V2JS.p8` - APNs key for server
- `credentials.json` - iOS push key configuration

## TODOs Found
- Only 1: `app/(onboarding)/import.tsx:357` - "TODO: multi-key import"
