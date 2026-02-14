# Bitcoin Wallet for iPhone

A secure, self-custodial Bitcoin wallet built with React Native and Expo.

## Features

- **HD Wallet** - BIP39/BIP44 compliant hierarchical deterministic wallet
- **Native SegWit** - Uses bc1 (bech32) addresses for lower fees
- **Secure Storage** - Encrypted seed storage in iOS Keychain
- **Face ID / Touch ID** - Biometric authentication support
- **PIN Protection** - 6-digit PIN for wallet access
- **Send & Receive** - Full Bitcoin transaction support
- **QR Codes** - Scan and generate BIP21 URIs
- **Real-time Prices** - Live BTC/USD price updates
- **Transaction History** - View all wallet activity
- **Testnet Support** - Safe testing with testnet Bitcoin

## Tech Stack

- **React Native** - Cross-platform mobile framework
- **Expo** - Development toolchain and SDK
- **TypeScript** - Type-safe code
- **Expo Router** - File-based navigation
- **Zustand** - State management
- **bitcoinjs-lib** - Bitcoin protocol implementation
- **Mempool.space API** - Blockchain data

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn
- Expo CLI
- iOS Simulator or physical device

### Installation

```bash
# Install dependencies
npm install

# Start development server
npm start

# Run on iOS
npm run ios
```

### Running on Device

1. Install Expo Go from the App Store
2. Scan the QR code from the terminal
3. Or run `npm run ios` with Xcode installed

## Project Structure

```
bitcoin_app_for_iPhone/
├── app/                    # Expo Router screens
│   ├── (auth)/            # Main app (authenticated)
│   ├── (onboarding)/      # Wallet setup
│   └── (lock)/            # Lock screen
├── src/
│   ├── components/        # UI components
│   ├── core/              # Bitcoin logic
│   │   ├── wallet/        # Key derivation
│   │   └── transaction/   # TX building
│   ├── services/          # APIs & storage
│   ├── stores/            # Zustand stores
│   ├── utils/             # Helpers
│   └── types/             # TypeScript types
└── assets/                # Images & fonts
```

## Security

- Seed phrases are encrypted with AES before storage
- Private keys are derived on-demand and never persisted
- PIN is required for all sensitive operations
- Auto-lock after inactivity

## Testing

For testing, use Bitcoin Testnet:
1. Create a new wallet
2. Get free testnet BTC from a faucet
3. Test sending and receiving

Testnet faucet: https://testnet-faucet.mempool.co/

## License

MIT
