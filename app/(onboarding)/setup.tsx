import '../../shim';
import React, { useState, useEffect, useRef, useCallback, useLayoutEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  AccessibilityInfo,
  Easing,
  BackHandler,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, useNavigation } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useWalletStore, useMultiWalletStore } from '../../src/stores';
import { getUniqueWalletName } from '../../src/stores/multiWalletStore';
import { SecureStorage } from '../../src/services/storage/SecureStorage';
import { WalletDatabase } from '../../src/services/database';
import { ADDRESS_TYPES, AddressType } from '../../src/constants';
import { useTheme } from '../../src/hooks/useTheme';
import { scriptToAddressType } from '../../src/utils/addressTypeMap';
import { SecureSessionTransfer, type TransferPayload } from '../../src/services/auth/SecureSessionTransfer';

// Import the createMultisigWallet type
type MultisigCosignerDisplay = {
  name: string;
  fingerprint: string;
  xpub: string;
  derivationPath: string;
  isLocal: boolean;
};

type MultisigConfig = {
  m: number;
  n: number;
  scriptType: string;
  cosigners: MultisigCosignerDisplay[];
  descriptor: string;
  walletName: string;
};

// Timeline-driven status messages - context-aware for CREATE vs IMPORT vs MULTISIG
const CREATE_STATUS_SEQUENCE = [
  'Creating wallet',
  'Generating keys',
  'Encrypting keys locally',
  'Finalizing setup',
];

const IMPORT_STATUS_SEQUENCE = [
  'Importing wallet',
  'Restoring keys from recovery phrase',
  'Encrypting keys locally',
  'Finalizing setup',
];

const MULTISIG_STATUS_SEQUENCE = [
  'Creating multisig wallet',
  'Configuring cosigners',
  'Generating wallet descriptor',
  'Finalizing setup',
];

const ICLOUD_RESTORE_STATUS_SEQUENCE = [
  'Restoring from iCloud',
  'Recovering wallet data',
  'Encrypting keys locally',
  'Finalizing setup',
];

const FULL_RESTORE_STATUS_SEQUENCE = [
  'Restoring full backup',
  'Recovering all wallets',
  'Encrypting keys locally',
  'Finalizing setup',
];

// Helper to convert script type from URL param format to AddressType
// Handles both DB script types ('p2wpkh') and AddressType strings ('native_segwit')
const parseScriptTypeToAddressType = (scriptType: string | undefined): AddressType => {
  if (!scriptType) return ADDRESS_TYPES.NATIVE_SEGWIT;
  return scriptToAddressType(scriptType);
};

// Import-specific status sequences
const XPRV_IMPORT_STATUS_SEQUENCE = [
  'Importing wallet',
  'Parsing extended private key',
  'Deriving addresses',
  'Finalizing setup',
];

const WIF_IMPORT_STATUS_SEQUENCE = [
  'Importing key',
  'Validating private key',
  'Encrypting key locally',
  'Finalizing setup',
];

const SEED_IMPORT_STATUS_SEQUENCE = [
  'Importing wallet',
  'Processing seed bytes',
  'Deriving addresses',
  'Finalizing setup',
];

// Timeline intervals (ms)
const TIMELINE = {
  SCREEN_FADE: 250,
  ICON_DELAY: 100,
  FIRST_TEXT_DELAY: 0, // Title appears immediately with the page
  TEXT_DISPLAY_TIME: 1000,
  TEXT_FADE_OUT: 180,
  TEXT_FADE_IN: 220,
  CTA_DELAY: 400,
};

export default function WalletSetupScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const rawParams = useLocalSearchParams<{ _sst?: string }>();

  // Consume SecureSessionTransfer payload (one-time read on first mount)
  const [sstPayload] = React.useState<TransferPayload | null>(
    () => SecureSessionTransfer.consume(rawParams._sst),
  );

  // Use SST payload as the canonical params source
  const params = (sstPayload ?? {}) as {
    mnemonic?: string;
    pin: string;
    passphrase?: string;
    isImport?: string;
    isMultisig?: string;
    walletName?: string;
    descriptor?: string;
    multisigConfig?: string;
    localCosignerSeeds?: string;
    source?: string;
    restorePayload?: string;
    derivationConfig?: string;
    importXprv?: string;
    importKeyWIF?: string;
    importKeyCompressed?: string;
    importKeyName?: string;
    importKeyScriptType?: string;
    importSeedHex?: string;
  };

  const { isDark, colors } = useTheme();

  // Parse multisig config if present
  const multisigConfig = params.multisigConfig
    ? (() => {
        try {
          return JSON.parse(params.multisigConfig);
        } catch {
          return null;
        }
      })()
    : null;

  // Parse derivation config if present (for mnemonic imports)
  const derivationConfig = params.derivationConfig
    ? (() => {
        try {
          return JSON.parse(params.derivationConfig);
        } catch {
          return null;
        }
      })()
    : null;

  // Parse local cosigner seeds if present
  const localCosignerSeeds = params.localCosignerSeeds
    ? (() => {
        try {
          return JSON.parse(params.localCosignerSeeds) as { localIndex: number; mnemonic: string; name: string }[];
        } catch {
          return [];
        }
      })()
    : [];
  const insets = useSafeAreaInsets();

  // Disable back gesture and hardware back button completely
  useLayoutEffect(() => {
    navigation.setOptions({
      gestureEnabled: false,
      headerBackVisible: false,
      headerLeft: () => null,
      fullScreenGestureEnabled: false,
    });
  }, [navigation]);

  // Block Android hardware back button
  useEffect(() => {
    const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
      // Return true to prevent default back behavior
      return true;
    });

    return () => backHandler.remove();
  }, []);

  // Determine which flow we're in: CREATE, IMPORT, MULTISIG, or ICLOUD_RESTORE
  const isImportFlow = params.isImport === 'true';
  const isMultisigFlow = params.isMultisig === 'true';
  const isICloudRestore = params.source === 'icloud_restore';

  // Import-specific flow detection
  const isXprvImport = !!params.importXprv;
  const isWifImport = !!params.importKeyWIF;
  const isSeedImport = !!params.importSeedHex;
  const isSpecialImport = isXprvImport || isWifImport || isSeedImport;

  // Check if this is a full backup restore
  const isFullRestore = (() => {
    if (!isICloudRestore || !params.restorePayload) return false;
    try {
      const parsed = JSON.parse(params.restorePayload);
      return parsed.type === 'full_backup';
    } catch {
      return false;
    }
  })();

  // Select the appropriate status sequence based on flow type
  const STATUS_SEQUENCE = isMultisigFlow
    ? MULTISIG_STATUS_SEQUENCE
    : isFullRestore
      ? FULL_RESTORE_STATUS_SEQUENCE
      : isICloudRestore
        ? ICLOUD_RESTORE_STATUS_SEQUENCE
        : isXprvImport
          ? XPRV_IMPORT_STATUS_SEQUENCE
          : isWifImport
            ? WIF_IMPORT_STATUS_SEQUENCE
            : isSeedImport
              ? SEED_IMPORT_STATUS_SEQUENCE
              : isImportFlow
                ? IMPORT_STATUS_SEQUENCE
                : CREATE_STATUS_SEQUENCE;

  const createWallet = useWalletStore((state) => state.createWallet);
  const createMultisigWallet = useWalletStore((state) => state.createMultisigWallet);
  const importPrivateKey = useWalletStore((state) => state.importPrivateKey);
  const importFromXprv = useWalletStore((state) => state.importFromXprv);
  const importFromSeedBytes = useWalletStore((state) => state.importFromSeedBytes);

  // UI State
  const [currentTextIndex, setCurrentTextIndex] = useState(0);
  const [isComplete, setIsComplete] = useState(false);
  const [isError, setIsError] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reduceMotion, setReduceMotion] = useState(false);

  // Backend state
  const backendCompleteRef = useRef(false);
  const animationCompleteRef = useRef(false);
  const hasStartedRef = useRef(false);
  const isTransitioningRef = useRef(false);

  // Animation values - icon and text start visible immediately
  const screenOpacity = useRef(new Animated.Value(1)).current;
  const iconOpacity = useRef(new Animated.Value(1)).current;
  const iconScale = useRef(new Animated.Value(1)).current;
  const iconGlow = useRef(new Animated.Value(0.2)).current;
  const ringRotation = useRef(new Animated.Value(0)).current;
  const ringOpacity = useRef(new Animated.Value(1)).current;
  const textOpacity = useRef(new Animated.Value(1)).current; // Start visible
  const textTranslateY = useRef(new Animated.Value(0)).current; // Start in position
  const ctaOpacity = useRef(new Animated.Value(0)).current;
  const ctaTranslateY = useRef(new Animated.Value(20)).current;

  const ringAnimRef = useRef<Animated.CompositeAnimation | null>(null);
  const glowAnimRef = useRef<Animated.CompositeAnimation | null>(null);

  // Check for reduce motion preference
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => subscription.remove();
  }, []);

  // Show CTA when both backend AND animation are complete
  const tryShowCTA = useCallback(() => {
    if (backendCompleteRef.current && animationCompleteRef.current && !isError) {
      setTimeout(() => {
        // Stop loading animations
        ringAnimRef.current?.stop();
        glowAnimRef.current?.stop();

        // Fade out ring
        Animated.timing(ringOpacity, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }).start();

        // Set icon to success state
        iconGlow.setValue(0.6);

        setIsComplete(true);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

        // Animate CTA in
        const duration = reduceMotion ? 0 : 350;
        Animated.parallel([
          Animated.timing(ctaOpacity, {
            toValue: 1,
            duration,
            useNativeDriver: true,
          }),
          Animated.spring(ctaTranslateY, {
            toValue: 0,
            tension: 50,
            friction: 9,
            useNativeDriver: true,
          }),
        ]).start();
      }, TIMELINE.CTA_DELAY);
    }
  }, [ctaOpacity, ctaTranslateY, ringOpacity, iconGlow, isError, reduceMotion]);

  // Text is now visible immediately - no initial animation needed

  // Loading ring rotation animation
  useEffect(() => {
    if (reduceMotion || isComplete || isError) {
      ringAnimRef.current?.stop();
      return;
    }

    ringAnimRef.current = Animated.loop(
      Animated.timing(ringRotation, {
        toValue: 1,
        duration: 2000,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    ringAnimRef.current.start();

    return () => {
      ringAnimRef.current?.stop();
    };
  }, [ringRotation, isComplete, isError, reduceMotion]);

  // Icon glow pulse animation
  useEffect(() => {
    if (reduceMotion || isComplete || isError) {
      glowAnimRef.current?.stop();
      return;
    }

    glowAnimRef.current = Animated.loop(
      Animated.sequence([
        Animated.timing(iconGlow, {
          toValue: 0.5,
          duration: 1200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(iconGlow, {
          toValue: 0.2,
          duration: 1200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    glowAnimRef.current.start();

    return () => {
      glowAnimRef.current?.stop();
    };
  }, [iconGlow, isComplete, isError, reduceMotion]);

  // Text sequence animation
  useEffect(() => {
    if (isError || isComplete) return;

    const advanceToNextText = (nextIndex: number) => {
      if (nextIndex >= STATUS_SEQUENCE.length) {
        animationCompleteRef.current = true;
        tryShowCTA();
        return;
      }

      const delay = TIMELINE.TEXT_DISPLAY_TIME;

      const timer = setTimeout(() => {
        if (isTransitioningRef.current) return;
        isTransitioningRef.current = true;

        if (reduceMotion) {
          setCurrentTextIndex(nextIndex);
          isTransitioningRef.current = false;
          advanceToNextText(nextIndex + 1);
          return;
        }

        // Fade out current text
        Animated.parallel([
          Animated.timing(textOpacity, {
            toValue: 0,
            duration: TIMELINE.TEXT_FADE_OUT,
            useNativeDriver: true,
          }),
          Animated.timing(textTranslateY, {
            toValue: -8,
            duration: TIMELINE.TEXT_FADE_OUT,
            useNativeDriver: true,
          }),
        ]).start(() => {
          setCurrentTextIndex(nextIndex);
          textTranslateY.setValue(8);

          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

          // Fade in new text
          Animated.parallel([
            Animated.timing(textOpacity, {
              toValue: 1,
              duration: TIMELINE.TEXT_FADE_IN,
              useNativeDriver: true,
            }),
            Animated.timing(textTranslateY, {
              toValue: 0,
              duration: TIMELINE.TEXT_FADE_IN,
              useNativeDriver: true,
            }),
          ]).start(() => {
            isTransitioningRef.current = false;
            advanceToNextText(nextIndex + 1);
          });
        });
      }, delay);

      return timer;
    };

    // Start sequence after first text is shown
    const startTimer = setTimeout(() => {
      advanceToNextText(1);
    }, TIMELINE.FIRST_TEXT_DELAY + TIMELINE.TEXT_DISPLAY_TIME);

    return () => clearTimeout(startTimer);
  }, [textOpacity, textTranslateY, isError, isComplete, reduceMotion, tryShowCTA]);

  // Backend: Run wallet creation in parallel
  useEffect(() => {
    if (hasStartedRef.current) return;
    hasStartedRef.current = true;

    const runBackend = async () => {
      const { mnemonic, pin, passphrase, descriptor } = params;

      // Handle iCloud restore with restorePayload (non-HD wallet types + full backups)
      if (isICloudRestore && params.restorePayload) {
        try {
          const payload = JSON.parse(params.restorePayload);
          const { BackupService } = await import('../../src/services/backup');

          // Check if this is a full backup (contains multiple wallets)
          if (payload.type === 'full_backup') {
            // Find the first HD wallet to initialize the main wallet store
            const firstHDWallet = payload.wallets.find(
              (w: any) => w.walletType === 'hd' && w.mnemonic
            );

            if (firstHDWallet) {
              // Initialize the main wallet store with the first HD wallet's seed.
              // This stores the PIN hash, generates addresses, and sets walletId
              // so the app recognizes that a wallet exists on next launch.
              const success = await createWallet(
                firstHDWallet.mnemonic,
                pin,
                firstHDWallet.passphrase || '',
                undefined,
                undefined,
                firstHDWallet.name || 'Restored Wallet',
              );
              if (!success) {
                throw new Error('Failed to initialize wallet. Please try again.');
              }
            }

            // Restore all wallets into multi-wallet store + SecureStorage
            const restoredIds = await BackupService.restoreFullBackup(payload, pin);

            if (restoredIds.length === 0 && !firstHDWallet) {
              throw new Error('Failed to restore any wallets. Please try again.');
            }

            // Set the first restored wallet as active
            const multiWalletStore = useMultiWalletStore.getState();
            if (restoredIds.length > 0) {
              await multiWalletStore.setActiveWallet(restoredIds[0]);
            }

            // Trigger sync for all restored wallets to fetch balances and transactions
            // This is done in background so the setup screen can complete
            const { WalletManager } = await import('../../src/services/wallet/WalletManager');
            WalletManager.syncAllWallets().catch(() => {
              // Background sync after restore failed
            });

            backendCompleteRef.current = true;
            tryShowCTA();
          } else {
            // Single wallet restore
            const walletId = await BackupService.restoreFromPayload(payload, pin);

            if (!walletId) {
              throw new Error('Failed to restore wallet data. Please try again.');
            }

            // Set as active wallet
            const multiWalletStore = useMultiWalletStore.getState();
            await multiWalletStore.setActiveWallet(walletId);

            // Trigger sync for the restored wallet to fetch balances and transactions
            const { WalletManager } = await import('../../src/services/wallet/WalletManager');
            const walletInfo = multiWalletStore.getWallet(walletId);
            if (walletInfo) {
              WalletManager.syncWallet(walletInfo).catch(() => {
                // Background sync after restore failed
              });
            }

            backendCompleteRef.current = true;
            tryShowCTA();
          }
        } catch (err) {
          // iCloud restore failed
          setErrorMessage(err instanceof Error ? err.message : 'Restore failed. Please try again.');
          setIsError(true);
          ringAnimRef.current?.stop();
          glowAnimRef.current?.stop();
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        }
        return;
      }

      // Handle multisig flow
      if (isMultisigFlow) {
        // Validate multisig prerequisites
        if (!descriptor) {
          const errorMsg = 'Missing wallet descriptor. Please go back and try again.';
          setErrorMessage(errorMsg);
          setIsError(true);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          return;
        }

        if (!pin) {
          const errorMsg = 'Missing PIN. Please go back and try again.';
          setErrorMessage(errorMsg);
          setIsError(true);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          return;
        }

        // Validate descriptor format
        if (!descriptor.startsWith('wsh(') && !descriptor.startsWith('sh(')) {
          const errorMsg = 'Invalid descriptor format. Expected wsh() or sh() wrapper.';
          setErrorMessage(errorMsg);
          setIsError(true);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          return;
        }

        // Validate m-of-n from config
        if (multisigConfig) {
          const { m, n, cosigners } = multisigConfig;
          if (m < 1 || m > n) {
            const errorMsg = `Invalid policy: ${m}-of-${n} is not valid.`;
            setErrorMessage(errorMsg);
            setIsError(true);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
            return;
          }
          if (n < 2 || n > 15) {
            const errorMsg = `Invalid signer count: ${n} signers not supported.`;
            setErrorMessage(errorMsg);
            setIsError(true);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
            return;
          }
          if (cosigners?.length !== n) {
            const errorMsg = `Signer mismatch: expected ${n}, got ${cosigners?.length || 0}.`;
            setErrorMessage(errorMsg);
            setIsError(true);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
            return;
          }

          // Validate each cosigner has required fields
          for (let i = 0; i < cosigners.length; i++) {
            const cosigner = cosigners[i];
            if (!cosigner.xpub || !cosigner.fingerprint || !cosigner.derivationPath) {
              const errorMsg = `Cosigner "${cosigner.name || `#${i+1}`}" is missing required data (xpub, fingerprint, or derivationPath).`;
              setErrorMessage(errorMsg);
              setIsError(true);
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
              return;
            }
          }
        }

        try {
          // Multisig prerequisites validated, proceeding with creation

          // Create multisig wallet using the wallet store
          const multisigWalletConfig = {
            m: multisigConfig?.m || 2,
            n: multisigConfig?.n || 3,
            scriptType: multisigConfig?.scriptType || 'p2wsh',
            cosigners: multisigConfig?.cosigners || [],
            descriptor: descriptor,
            walletName: getUniqueWalletName(params.walletName || 'Multisig Wallet'),
          };

          const success = await createMultisigWallet(multisigWalletConfig, pin);

          if (!success) {
            throw new Error('Multisig wallet creation failed. Please try again.');
          }

          // Store local cosigner seeds for backup/recovery
          // IMPORTANT: Clear any stale seeds from previous wallet creations first
          await SecureStorage.clearLocalCosignerSeeds();

          if (localCosignerSeeds.length > 0) {
            for (const seedData of localCosignerSeeds) {
              if (seedData.localIndex !== undefined && seedData.mnemonic) {
                await SecureStorage.storeLocalCosignerSeed(
                  seedData.localIndex,
                  seedData.mnemonic,
                  pin
                );
              }
            }

            // Also store local cosigner mnemonics in the DB wallet row
            // so preserve-on-delete can back them up from a single source.
            try {
              const msWalletId = useWalletStore.getState().walletId;
              if (msWalletId) {
                const db = WalletDatabase.shared();
                // Store as JSON in the mnemonic column (multisig wallets use
                // secretType 'mnemonic' but for local cosigner seeds, not a single seed)
                const cosignerSeedsJson = JSON.stringify(
                  localCosignerSeeds
                    .filter(s => s.localIndex !== undefined && s.mnemonic)
                    .map(s => ({ localIndex: s.localIndex, mnemonic: s.mnemonic, name: s.name }))
                );
                db.updateWallet(msWalletId, { mnemonic: cosignerSeedsJson });
              }
            } catch {}
          }

          // Add multisig wallet to multi-wallet store
          const multisigWalletName = getUniqueWalletName(params.walletName || 'Multisig Wallet');
          const multiWalletStore = useMultiWalletStore.getState();

          // Generate a unique ID for this multisig wallet
          const multisigWalletId = `multisig-${Date.now()}`;

          const newMultisigWallet = await multiWalletStore.addWallet({
            id: multisigWalletId,
            name: multisigWalletName,
            type: 'multisig',
          });

          // Set as active wallet
          await multiWalletStore.setActiveWallet(newMultisigWallet.id);

          backendCompleteRef.current = true;
          tryShowCTA();

        } catch (err) {
          setErrorMessage(
            err instanceof Error
              ? err.message
              : 'Multisig wallet creation failed. Please try again.'
          );
          setIsError(true);
          ringAnimRef.current?.stop();
          glowAnimRef.current?.stop();
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        }

        return;
      }

      // ─────────────────────────────────────────────────────────────────
      // Special Import Flows: xprv, WIF, seed bytes
      // ─────────────────────────────────────────────────────────────────
      if (isSpecialImport) {
        try {
          const scriptType = parseScriptTypeToAddressType(params.importKeyScriptType);
          const walletName = getUniqueWalletName(params.importKeyName || params.walletName || 'Imported Wallet');

          let success = false;

          if (isXprvImport && params.importXprv) {
            // Parse derivation config if present
            const xprvDerivationConfig = params.derivationConfig
              ? (() => {
                  try {
                    return JSON.parse(params.derivationConfig);
                  } catch {
                    return undefined;
                  }
                })()
              : undefined;

            success = await importFromXprv(
              params.importXprv,
              pin,
              walletName,
              scriptType,
              xprvDerivationConfig
            );

            if (!success) {
              throw new Error('Failed to import extended private key. Please check the key format and try again.');
            }
          } else if (isWifImport && params.importKeyWIF) {
            const compressed = params.importKeyCompressed !== 'false';

            success = await importPrivateKey(
              params.importKeyWIF,
              compressed,
              pin,
              walletName,
              scriptType
            );

            if (!success) {
              throw new Error('Failed to import private key. Please check the key format and try again.');
            }
          } else if (isSeedImport && params.importSeedHex) {
            // Parse derivation config if present
            const seedDerivationConfig = params.derivationConfig
              ? (() => {
                  try {
                    return JSON.parse(params.derivationConfig);
                  } catch {
                    return undefined;
                  }
                })()
              : undefined;

            success = await importFromSeedBytes(
              params.importSeedHex,
              pin,
              walletName,
              scriptType,
              seedDerivationConfig
            );

            if (!success) {
              throw new Error('Failed to import from seed bytes. Please check the data and try again.');
            }
          }

          if (success) {
            backendCompleteRef.current = true;
            tryShowCTA();
          }

        } catch (err) {
          setErrorMessage(
            err instanceof Error
              ? err.message
              : 'Import failed. Please try again.'
          );
          setIsError(true);
          ringAnimRef.current?.stop();
          glowAnimRef.current?.stop();
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        }

        return;
      }

      // ─────────────────────────────────────────────────────────────────
      // Standard wallet flow (mnemonic-based)
      // ─────────────────────────────────────────────────────────────────
      if (!mnemonic || !pin) {
        const errorMsg = isImportFlow
          ? 'Missing recovery data. Please go back and try again.'
          : 'Missing wallet data. Please go back and try again.';
        setErrorMessage(errorMsg);
        setIsError(true);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        return;
      }

      try {
        // Add wallet to multi-wallet store FIRST to get the wallet ID
        const multiWalletStore = useMultiWalletStore.getState();

        // Generate unique wallet name
        const baseName = isICloudRestore
          ? 'Restored Wallet'
          : isImportFlow
            ? 'Imported Wallet'
            : (multiWalletStore.wallets.length === 0 ? 'Main Wallet' : 'Wallet');
        const walletName = params.walletName
          ? getUniqueWalletName(params.walletName)
          : getUniqueWalletName(baseName);

        // Generate a unique ID for this wallet
        const walletId = `hd-${Date.now()}`;

        // Store the seed with this specific wallet ID for multi-wallet support
        await SecureStorage.storeWalletSeed(walletId, mnemonic, pin, passphrase || '');

        const success = await createWallet(mnemonic, pin, passphrase || '', derivationConfig || undefined, walletId, walletName);

        if (!success) {
          // Clean up the wallet-specific seed if creation failed
          await SecureStorage.deleteWalletData(walletId);
          throw new Error(
            isImportFlow
              ? 'Unable to restore this wallet. Please check your recovery phrase and try again.'
              : 'Wallet creation failed. Please try again.'
          );
        }

        // Add new HD wallet to multi-wallet store
        const newWallet = await multiWalletStore.addWallet({
          id: walletId,
          name: walletName,
          type: 'hd',
        });

        // Set as active wallet
        await multiWalletStore.setActiveWallet(newWallet.id);

        backendCompleteRef.current = true;
        tryShowCTA();

      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : 'An unexpected error occurred.');
        setIsError(true);
        ringAnimRef.current?.stop();
        glowAnimRef.current?.stop();
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    };

    runBackend();
  }, [params, createWallet, tryShowCTA, isMultisigFlow, isICloudRestore, multisigConfig, isSpecialImport, isXprvImport, isWifImport, isSeedImport, importFromXprv, importPrivateKey, importFromSeedBytes]);

  const handleContinue = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.replace('/(auth)');
  }, [router]);

  const handleRetry = useCallback(() => {
    hasStartedRef.current = false;
    backendCompleteRef.current = false;
    animationCompleteRef.current = false;
    isTransitioningRef.current = false;
    setCurrentTextIndex(0);
    setIsComplete(false);
    setIsError(false);
    setErrorMessage(null);
    // Reset animation values to initial state
    iconOpacity.setValue(1);
    iconScale.setValue(1);
    ringOpacity.setValue(1);
    iconGlow.setValue(0.2);
    textOpacity.setValue(1); // Text visible immediately
    textTranslateY.setValue(0);
    ctaOpacity.setValue(0);
    ctaTranslateY.setValue(20);
  }, [iconOpacity, iconScale, ringOpacity, iconGlow, textOpacity, textTranslateY, ctaOpacity, ctaTranslateY]);

  const handleBack = useCallback(() => {
    router.back();
  }, [router]);

  // Interpolate ring rotation
  const ringRotationInterpolate = ringRotation.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar style={isDark ? 'light' : 'dark'} />

      <Animated.View
        style={[
          styles.content,
          {
            opacity: screenOpacity,
            paddingTop: insets.top,
          },
        ]}
      >
        {/* Centered content area */}
        <View style={styles.mainContent}>
          {/* Icon with loading ring */}
          <Animated.View
            style={[
              styles.iconContainer,
              {
                opacity: iconOpacity,
                transform: [{ scale: iconScale }],
              },
            ]}
          >
            {/* Glow layer */}
            <Animated.View
              style={[
                styles.iconGlow,
                {
                  opacity: iconGlow,
                  backgroundColor: isComplete
                    ? 'rgba(48,209,88,0.4)'
                    : isError
                      ? 'rgba(255,69,58,0.4)'
                      : isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.08)',
                },
              ]}
            />

            {/* Loading ring */}
            {!isComplete && !isError && (
              <Animated.View
                style={[
                  styles.loadingRing,
                  {
                    opacity: ringOpacity,
                    transform: [{ rotate: ringRotationInterpolate }],
                  },
                ]}
              >
                <View style={[styles.ringSegment, { backgroundColor: colors.textTertiary }]} />
              </Animated.View>
            )}

            {/* Icon background */}
            <View
              style={[
                styles.iconBackground,
                { backgroundColor: colors.glass, borderColor: colors.border },
                isComplete && styles.iconBackgroundSuccess,
                isError && styles.iconBackgroundError,
              ]}
            >
              {isComplete ? (
                <Ionicons name="shield-checkmark" size={48} color={colors.success} />
              ) : isError ? (
                <Ionicons name="alert-circle" size={48} color={colors.error} />
              ) : (
                <Ionicons name="shield-half" size={48} color={colors.textSecondary} />
              )}
            </View>
          </Animated.View>

          {/* Main status text */}
          <Animated.View
            style={[
              styles.textContainer,
              {
                opacity: textOpacity,
                transform: [{ translateY: textTranslateY }],
              },
            ]}
          >
            {isComplete ? (
              <>
                <Text style={[styles.mainText, { color: colors.text }]}>
                  {isFullRestore ? 'Wallets restored' : isICloudRestore ? 'Wallet restored' : isImportFlow ? 'Wallet imported' : 'Wallet secured'}
                </Text>
                <Text style={[styles.subtitleText, { color: colors.textTertiary }]}>
                  {isFullRestore ? 'All wallets are ready' : 'Your wallet is ready'}
                </Text>
              </>
            ) : isError ? (
              <>
                <Text style={[styles.mainText, { color: colors.text }]}>
                  {isICloudRestore ? 'Restore failed' : isImportFlow ? 'Import failed' : 'Setup failed'}
                </Text>
                <Text style={[styles.errorText, { color: colors.error }]}>{errorMessage}</Text>
              </>
            ) : (
              <Text style={[styles.mainText, { color: colors.text }]}>
                {STATUS_SEQUENCE[currentTextIndex]}
              </Text>
            )}
          </Animated.View>

          {/* Reassurance - fixed height container to prevent layout shift */}
          <View style={styles.reassuranceContainer}>
            <Text style={[
              styles.reassuranceText,
              { opacity: !isComplete && !isError ? 1 : 0, color: colors.textDisabled }
            ]}>
              Your keys never leave this device
            </Text>
          </View>
        </View>

      </Animated.View>

      {/* Bottom CTA - Absolutely positioned to not affect layout */}
      <Animated.View
        style={[
          styles.ctaContainer,
          { paddingBottom: insets.bottom + 32 },
        ]}
        pointerEvents={isComplete || isError ? 'auto' : 'none'}
      >
        {isComplete && (
          <Animated.View
            style={{
              opacity: ctaOpacity,
              transform: [{ translateY: ctaTranslateY }],
            }}
          >
            <TouchableOpacity
              onPress={handleContinue}
              activeOpacity={0.85}
              style={[styles.primaryButton, { backgroundColor: colors.text }]}
            >
              <Text style={[styles.primaryButtonText, { color: colors.background }]}>Continue</Text>
            </TouchableOpacity>
          </Animated.View>
        )}

        {isError && (
          <Animated.View
            style={{
              opacity: 1,
            }}
          >
            <View style={styles.errorButtons}>
              <TouchableOpacity
                onPress={handleRetry}
                activeOpacity={0.85}
                style={[styles.primaryButton, { backgroundColor: colors.text }]}
              >
                <Text style={[styles.primaryButtonText, { color: colors.background }]}>Try Again</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={handleBack}
                activeOpacity={0.7}
                style={styles.secondaryButton}
              >
                <Text style={[styles.secondaryButtonText, { color: colors.textTertiary }]}>Go Back</Text>
              </TouchableOpacity>
            </View>
          </Animated.View>
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
  },
  mainContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },

  // Icon
  iconContainer: {
    width: 140,
    height: 140,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 40,
  },
  iconGlow: {
    position: 'absolute',
    width: 140,
    height: 140,
    borderRadius: 70,
  },
  loadingRing: {
    position: 'absolute',
    width: 130,
    height: 130,
    borderRadius: 65,
    borderWidth: 2,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  ringSegment: {
    width: 20,
    height: 2,
    backgroundColor: 'rgba(255,255,255,0.5)',
    borderRadius: 1,
    marginTop: -1,
  },
  iconBackground: {
    width: 100,
    height: 100,
    borderRadius: 30,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBackgroundSuccess: {
    backgroundColor: 'rgba(48,209,88,0.1)',
    borderColor: 'rgba(48,209,88,0.25)',
  },
  iconBackgroundError: {
    backgroundColor: 'rgba(255,69,58,0.1)',
    borderColor: 'rgba(255,69,58,0.25)',
  },

  // Text
  textContainer: {
    alignItems: 'center',
    height: 80, // Fixed height to prevent layout shift
    justifyContent: 'center',
  },
  mainText: {
    fontSize: 28,
    fontWeight: '700',
    color: '#FFFFFF',
    textAlign: 'center',
    letterSpacing: -0.5,
    lineHeight: 36,
  },
  subtitleText: {
    fontSize: 17,
    fontWeight: '400',
    color: 'rgba(255,255,255,0.5)',
    textAlign: 'center',
    marginTop: 8,
  },
  errorTitle: {
    color: '#FFFFFF',
  },
  errorText: {
    fontSize: 15,
    fontWeight: '400',
    color: 'rgba(255,69,58,0.85)',
    textAlign: 'center',
    marginTop: 10,
    paddingHorizontal: 16,
  },
  reassuranceContainer: {
    height: 70, // Fixed height to prevent layout shift
    justifyContent: 'center',
    alignItems: 'center',
  },
  reassuranceText: {
    fontSize: 14,
    fontWeight: '400',
    color: 'rgba(255,255,255,0.25)',
    textAlign: 'center',
  },

  // CTA - Absolutely positioned to not push content up
  ctaContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 24,
  },
  primaryButton: {
    height: 50,
    borderRadius: 24,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000000',
    letterSpacing: 0.1,
  },
  errorButtons: {
    gap: 12,
  },
  secondaryButton: {
    height: 45,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    fontSize: 15,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.45)',
  },
});
