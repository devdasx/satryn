# Contributing to Satryn

Thank you for your interest in contributing to Satryn. This document covers the development setup, coding standards, and pull request process.

## Development Setup

### Prerequisites

- Node.js 18+ (22 recommended)
- npm 9+
- Xcode 15+ with iOS 17+ simulator
- An Apple Developer account (for device builds)

### First-Time Setup

```bash
git clone https://github.com/devdasx/satryn.git
cd satryn
npm install
npx expo prebuild
```

### Running Locally

```bash
# Start Metro bundler
npm start

# Run on iOS Simulator
npx expo run:ios

# Run on a physical device (requires signing)
npx expo run:ios --device
```

### Building with EAS

```bash
npm install -g eas-cli
eas login
eas build --profile development --platform ios
```

## Project Conventions

### File Structure

- **Screens** go in `app/` following Expo Router file-based routing.
- **Components** go in `src/components/`. Group by feature (e.g., `src/components/send/`).
- **Services** go in `src/services/`. One file per service, exported through `index.ts`.
- **Stores** go in `src/stores/`. One Zustand store per domain.
- **Hooks** go in `src/hooks/`. Each hook gets its own file, exported through `index.ts`.

### Code Style

- TypeScript strict mode is enabled. All code must type-check with `npx tsc --noEmit`.
- Use functional components and hooks.
- Prefer `const` over `let`. Never use `var`.
- Use `useCallback` and `useMemo` where they reduce re-renders.
- Destructure props and store selectors.

### Naming

- Files: `camelCase.ts` for services/utils, `PascalCase.tsx` for components, `camelCase.tsx` for screens.
- Components: `PascalCase`.
- Hooks: `useCamelCase`.
- Services: `PascalCase` (static class pattern) or `camelCase` (function exports).
- Stores: `useCamelCaseStore`.
- Constants: `UPPER_SNAKE_CASE` for true constants, `camelCase` for config objects.

### Styling

- Use `StyleSheet.create()` for all styles. No inline style objects in render.
- Support both light and dark mode. Use `useTheme()` hook for colors.
- Brand color is black. Avoid introducing accent colors without discussion.
- No toast alerts. Use haptic feedback for confirmations.

### State Management

- Zustand stores for global state. Persisted stores use MMKV.
- Local component state with `useState` for UI-only state.
- No Redux, no Context API for state (except theme).

### Bitcoin / Security Rules

- **Never log sensitive data**: seed phrases, private keys, xprv/yprv/zprv, addresses, TXIDs.
- **Never persist private keys**. Derive on-demand from the encrypted seed.
- **Always gate key access** through `SensitiveSession.ensureAuth()`.
- **Use expo-secure-store** for any secret that must be stored.
- **Test on mainnet with caution**. Use testnet or signet for development.

## Making Changes

### Branch Naming

- `feature/short-description` for new features
- `fix/short-description` for bug fixes
- `refactor/short-description` for refactoring

### Commit Messages

Write clear, concise commit messages. Focus on *why*, not *what*.

```
Add UTXO freezing to coin control screen

Users can now freeze individual UTXOs to prevent them from being
selected during transaction building. Frozen UTXOs show an orange
status indicator in the UTXO list.
```

### Pull Request Process

1. Fork the repository and create a feature branch.
2. Make your changes. Ensure `npx tsc --noEmit` passes with zero errors.
3. Test on both light and dark mode.
4. Test on an iOS simulator or device.
5. Open a pull request against `main` with a clear description of the change.
6. Wait for review. Address feedback promptly.

### What We Look For in PRs

- Does the code type-check cleanly?
- Does it work in both light and dark mode?
- Are there any security implications (key handling, data exposure)?
- Is the UI consistent with the existing design system?
- Are haptics used appropriately (no toasts)?
- Is the change scoped tightly? Small PRs are reviewed faster.

## Reporting Bugs

Open a GitHub issue with:
- Steps to reproduce
- Expected behavior
- Actual behavior
- iOS version and device model
- App version

Do NOT include wallet addresses, TXIDs, seed phrases, or any private data in bug reports.

## Security Vulnerabilities

**Do not open a public issue for security vulnerabilities.** See [SECURITY.md](SECURITY.md) for our responsible disclosure policy.

## License

By contributing to Satryn, you agree that your contributions will be licensed under the MIT License.
