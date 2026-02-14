import '../../shim';
import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Keyboard,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, useHaptics } from '../../src/hooks';
import { SeedGenerator } from '../../src/core/wallet';
import { useWalletStore } from '../../src/stores/walletStore';
import { KeyboardSafeBottomBar } from '../../src/components/ui';
import { PremiumInput, PremiumInputCard } from '../../src/components/ui/PremiumInput';

export default function WalletCreateScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, theme, isDark } = useTheme();
  const haptics = useHaptics();
  const scrollViewRef = useRef<ScrollView>(null);

  const [walletName, setWalletName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [step, setStep] = useState<'name' | 'seed' | 'confirm'>('name');
  const [generatedMnemonic, setGeneratedMnemonic] = useState<string[]>([]);
  const [confirmWords, setConfirmWords] = useState<{ index: number; word: string }[]>([]);
  const [userInputs, setUserInputs] = useState<string[]>(['', '', '']);

  const createWallet = useWalletStore(state => state.createWallet);

  // Auto-generate wallet name
  const getDefaultWalletName = () => {
    // In production, count existing wallets and increment
    const walletNumber = Math.floor(Math.random() * 100) + 1;
    return `Wallet ${walletNumber}`;
  };

  const handleBack = async () => {
    await haptics.trigger('light');
    Keyboard.dismiss();
    if (step === 'seed') {
      setStep('name');
    } else if (step === 'confirm') {
      setStep('seed');
    } else {
      router.back();
    }
  };

  const handleGenerateSeed = async () => {
    await haptics.trigger('medium');
    Keyboard.dismiss();
    setIsCreating(true);

    try {
      // Generate a new mnemonic
      const mnemonic = SeedGenerator.generate(12);
      const words = mnemonic.split(' ');
      setGeneratedMnemonic(words);

      // Pick 3 random words for confirmation
      const indices: number[] = [];
      while (indices.length < 3) {
        const idx = Math.floor(Math.random() * 12);
        if (!indices.includes(idx)) {
          indices.push(idx);
        }
      }
      indices.sort((a, b) => a - b);
      setConfirmWords(indices.map(i => ({ index: i, word: words[i] })));
      setUserInputs(['', '', '']);

      setStep('seed');
    } catch (error) {
      Alert.alert('Error', 'Failed to generate seed phrase');
    } finally {
      setIsCreating(false);
    }
  };

  const handleContinueToConfirm = async () => {
    await haptics.trigger('selection');
    setStep('confirm');
  };

  const handleCreateWallet = async () => {
    // Verify the confirmation words
    for (let i = 0; i < confirmWords.length; i++) {
      if (userInputs[i].toLowerCase().trim() !== confirmWords[i].word.toLowerCase()) {
        await haptics.trigger('error');
        Alert.alert('Incorrect', `Word #${confirmWords[i].index + 1} is incorrect. Please try again.`);
        return;
      }
    }

    await haptics.trigger('medium');
    Keyboard.dismiss();
    setIsCreating(true);

    try {
      const mnemonic = generatedMnemonic.join(' ');
      const finalName = walletName.trim() || getDefaultWalletName();

      Alert.alert(
        'Create Wallet',
        'This will create a new HD wallet. In a future update, you will be able to set a separate PIN for this wallet.',
        [
          { text: 'Cancel', style: 'cancel', onPress: () => setIsCreating(false) },
          {
            text: 'Create',
            onPress: async () => {
              Alert.alert(
                'Wallet Created!',
                `Your wallet "${finalName}" has been created successfully.\n\nIMPORTANT: Make sure you have written down your seed phrase and stored it safely!`,
                [
                  {
                    text: 'OK',
                    onPress: () => router.replace('/(auth)/(tabs)/wallet'),
                  },
                ]
              );
              setIsCreating(false);
            },
          },
        ]
      );
    } catch (error) {
      Alert.alert('Error', 'Failed to create wallet');
      setIsCreating(false);
    }
  };

  const allWordsEntered = userInputs.every(w => w.trim().length > 0);
  const styles = createStyles(colors, theme, isDark);

  // Name Entry Step
  if (step === 'name') {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
          <TouchableOpacity onPress={handleBack} style={styles.headerButton}>
            <View style={[styles.headerButtonBg, { backgroundColor: colors.fill }]}>
              <Ionicons name="arrow-back" size={20} color={colors.text} />
            </View>
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.text }]}>New Wallet</Text>
          <View style={styles.headerButton} />
        </View>

        <View style={styles.scrollWrapper}>
          <ScrollView
            ref={scrollViewRef}
            style={styles.scrollView}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <View style={[styles.heroCard, { backgroundColor: colors.surface }]}>
              <View style={[styles.heroIcon, { backgroundColor: theme.brand.bitcoin + '15' }]}>
                <Ionicons name="add-circle" size={32} color={theme.brand.bitcoin} />
              </View>
              <Text style={[styles.heroTitle, { color: colors.text }]}>Create HD Wallet</Text>
              <Text style={[styles.heroDesc, { color: colors.textSecondary }]}>
                Generate a new wallet with a fresh seed phrase.
                Each wallet has its own set of addresses.
              </Text>
            </View>

            <PremiumInputCard label="WALLET NAME (OPTIONAL)">
              <PremiumInput
                icon="pencil"
                iconColor="#007AFF"
                placeholder={getDefaultWalletName()}
                value={walletName}
                onChangeText={setWalletName}
                autoCapitalize="words"
                returnKeyType="done"
                onSubmitEditing={() => Keyboard.dismiss()}
              />
            </PremiumInputCard>

            <View style={[styles.infoCard, { backgroundColor: colors.surface }]}>
              <Text style={[styles.infoTitle, { color: colors.text }]}>What you should know</Text>

              <View style={styles.infoList}>
                <View style={styles.infoRow}>
                  <View style={[styles.infoIconBg, { backgroundColor: theme.brand.bitcoin + '15' }]}>
                    <Ionicons name="key" size={16} color={theme.brand.bitcoin} />
                  </View>
                  <Text style={[styles.infoText, { color: colors.textSecondary }]}>
                    A new 12-word seed phrase will be generated
                  </Text>
                </View>
                <View style={styles.infoRow}>
                  <View style={[styles.infoIconBg, { backgroundColor: colors.success + '15' }]}>
                    <Ionicons name="shield-checkmark" size={16} color={colors.success} />
                  </View>
                  <Text style={[styles.infoText, { color: colors.textSecondary }]}>
                    You must back up the seed phrase securely
                  </Text>
                </View>
                <View style={styles.infoRow}>
                  <View style={[styles.infoIconBg, { backgroundColor: '#5856D6' + '15' }]}>
                    <Ionicons name="wallet" size={16} color="#5856D6" />
                  </View>
                  <Text style={[styles.infoText, { color: colors.textSecondary }]}>
                    Separate addresses and balance from other wallets
                  </Text>
                </View>
              </View>
            </View>

            {/* Spacer for button */}
            <View style={{ height: 120 }} />
          </ScrollView>
        </View>

        {/* Fixed bottom button - Keyboard Safe */}
        <KeyboardSafeBottomBar backgroundColor={colors.background}>
          <TouchableOpacity
            style={[styles.createButton, { backgroundColor: theme.brand.bitcoin }]}
            onPress={handleGenerateSeed}
            disabled={isCreating}
            activeOpacity={0.8}
          >
            {isCreating ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <>
                <Ionicons name="key" size={20} color="#FFFFFF" />
                <Text style={styles.createButtonText}>Generate Seed Phrase</Text>
              </>
            )}
          </TouchableOpacity>
        </KeyboardSafeBottomBar>
      </View>
    );
  }

  // Seed Display Step
  if (step === 'seed') {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
          <TouchableOpacity onPress={handleBack} style={styles.headerButton}>
            <View style={[styles.headerButtonBg, { backgroundColor: colors.fill }]}>
              <Ionicons name="arrow-back" size={20} color={colors.text} />
            </View>
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Backup Seed</Text>
          <View style={styles.headerButton} />
        </View>

        <View style={styles.progressContainer}>
          <View style={[styles.progressBar, { backgroundColor: colors.fill }]}>
            <View style={[styles.progressFill, { backgroundColor: theme.brand.bitcoin, width: '50%' }]} />
          </View>
          <Text style={[styles.progressText, { color: colors.textSecondary }]}>Step 1 of 2</Text>
        </View>

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={[styles.warningCard, { backgroundColor: colors.error + '10', borderColor: colors.error + '30' }]}>
            <View style={[styles.warningIconBg, { backgroundColor: colors.error + '20' }]}>
              <Ionicons name="warning" size={18} color={colors.error} />
            </View>
            <Text style={[styles.warningText, { color: colors.text }]}>
              Write down these words in order and store them safely. Never share your seed phrase!
            </Text>
          </View>

          <View style={[styles.seedCard, { backgroundColor: colors.surface }]}>
            <View style={styles.seedGrid}>
              {generatedMnemonic.map((word, index) => (
                <View key={index} style={[styles.seedWord, { backgroundColor: colors.fill }]}>
                  <Text style={[styles.seedIndex, { color: theme.brand.bitcoin }]}>{index + 1}</Text>
                  <Text style={[styles.seedWordText, { color: colors.text }]}>{word}</Text>
                </View>
              ))}
            </View>
          </View>

          <View style={[styles.tipCard, { backgroundColor: colors.fill }]}>
            <View style={[styles.tipIconBg, { backgroundColor: colors.success + '20' }]}>
              <Ionicons name="shield-checkmark" size={16} color={colors.success} />
            </View>
            <Text style={[styles.tipText, { color: colors.textSecondary }]}>
              Anyone with these words can access your funds. Store them offline in a secure location.
            </Text>
          </View>

          {/* Spacer for button */}
          <View style={{ height: 120 }} />
        </ScrollView>

        {/* Fixed bottom button - Keyboard Safe */}
        <KeyboardSafeBottomBar backgroundColor={colors.background}>
          <TouchableOpacity
            style={[styles.createButton, { backgroundColor: theme.brand.bitcoin }]}
            onPress={handleContinueToConfirm}
            activeOpacity={0.8}
          >
            <Text style={styles.createButtonText}>I've Written It Down</Text>
            <Ionicons name="arrow-forward" size={20} color="#FFFFFF" />
          </TouchableOpacity>
        </KeyboardSafeBottomBar>
      </View>
    );
  }

  // Confirmation Step
  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={handleBack} style={styles.headerButton}>
          <View style={[styles.headerButtonBg, { backgroundColor: colors.fill }]}>
            <Ionicons name="arrow-back" size={20} color={colors.text} />
          </View>
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Verify Backup</Text>
        <View style={styles.headerButton} />
      </View>

      <View style={styles.progressContainer}>
        <View style={[styles.progressBar, { backgroundColor: colors.fill }]}>
          <View style={[styles.progressFill, { backgroundColor: theme.brand.bitcoin, width: '100%' }]} />
        </View>
        <Text style={[styles.progressText, { color: colors.textSecondary }]}>Step 2 of 2</Text>
      </View>

      <View style={styles.scrollWrapper}>
        <ScrollView
          ref={scrollViewRef}
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={[styles.verifyHeader, { backgroundColor: colors.surface }]}>
            <View style={[styles.verifyIconBg, { backgroundColor: theme.brand.bitcoin + '15' }]}>
              <Ionicons name="checkmark-done" size={24} color={theme.brand.bitcoin} />
            </View>
            <Text style={[styles.verifyTitle, { color: colors.text }]}>
              Verify Your Backup
            </Text>
            <Text style={[styles.verifyDesc, { color: colors.textSecondary }]}>
              Enter the following words from your seed phrase to confirm you've saved it correctly.
            </Text>
          </View>

          {confirmWords.map((item, idx) => (
            <View key={idx} style={styles.confirmInputRow}>
              <View style={[styles.confirmLabel, { backgroundColor: theme.brand.bitcoin }]}>
                <Text style={styles.confirmLabelText}>Word #{item.index + 1}</Text>
              </View>
              <PremiumInputCard>
                <PremiumInput
                  icon="text"
                  iconColor="#30D158"
                  placeholder={`Enter word #${item.index + 1}`}
                  value={userInputs[idx]}
                  onChangeText={(text) => {
                    const newInputs = [...userInputs];
                    newInputs[idx] = text;
                    setUserInputs(newInputs);
                  }}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType={idx < 2 ? 'next' : 'done'}
                />
              </PremiumInputCard>
            </View>
          ))}

          {/* Spacer for button */}
          <View style={{ height: 120 }} />
        </ScrollView>
      </View>

      {/* Fixed bottom button - Keyboard Safe */}
      <KeyboardSafeBottomBar backgroundColor={colors.background}>
        <TouchableOpacity
          style={[
            styles.createButton,
            { backgroundColor: theme.brand.bitcoin },
            !allWordsEntered && { opacity: 0.5 },
          ]}
          onPress={handleCreateWallet}
          disabled={!allWordsEntered || isCreating}
          activeOpacity={0.8}
        >
          {isCreating ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <>
              <Ionicons name="checkmark-circle" size={20} color="#FFFFFF" />
              <Text style={styles.createButtonText}>Create Wallet</Text>
            </>
          )}
        </TouchableOpacity>
      </KeyboardSafeBottomBar>
    </View>
  );
}

const createStyles = (colors: any, theme: any, isDark: boolean) =>
  StyleSheet.create({
    container: {
      flex: 1,
    },
    scrollWrapper: {
      flex: 1,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 20,
      paddingBottom: 12,
    },
    headerButton: {
      width: 44,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerButtonBg: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerTitle: {
      fontSize: 18,
      fontWeight: '700',
    },
    progressContainer: {
      paddingHorizontal: 20,
      marginBottom: 16,
    },
    progressBar: {
      height: 4,
      borderRadius: 2,
      marginBottom: 8,
    },
    progressFill: {
      height: '100%',
      borderRadius: 2,
    },
    progressText: {
      fontSize: 12,
      fontWeight: '500',
    },
    scrollView: {
      flex: 1,
    },
    scrollContent: {
      paddingHorizontal: 20,
      paddingTop: 4,
    },
    heroCard: {
      alignItems: 'center',
      padding: 24,
      borderRadius: 20,
      marginBottom: 24,
    },
    heroIcon: {
      width: 64,
      height: 64,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 16,
    },
    heroTitle: {
      fontSize: 20,
      fontWeight: '700',
      marginBottom: 8,
    },
    heroDesc: {
      fontSize: 14,
      textAlign: 'center',
      lineHeight: 20,
    },
    sectionTitle: {
      fontSize: 12,
      fontWeight: '600',
      letterSpacing: 1,
      marginBottom: 10,
    },
    nameInput: {
      fontSize: 16,
      paddingHorizontal: 16,
      paddingVertical: 16,
      borderRadius: 14,
      borderWidth: 1.5,
      marginBottom: 24,
    },
    infoCard: {
      padding: 20,
      borderRadius: 18,
      marginBottom: 16,
    },
    infoTitle: {
      fontSize: 16,
      fontWeight: '700',
      marginBottom: 18,
    },
    infoList: {
      gap: 16,
    },
    infoRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
    },
    infoIconBg: {
      width: 36,
      height: 36,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
    },
    infoText: {
      flex: 1,
      fontSize: 14,
      lineHeight: 20,
    },
    technicalCard: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 14,
      borderRadius: 12,
      gap: 10,
    },
    technicalText: {
      flex: 1,
      fontSize: 12,
      lineHeight: 16,
    },
    warningCard: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      padding: 16,
      borderRadius: 16,
      borderWidth: 1,
      gap: 14,
      marginBottom: 20,
    },
    warningIconBg: {
      width: 32,
      height: 32,
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
    },
    warningText: {
      flex: 1,
      fontSize: 14,
      lineHeight: 20,
      fontWeight: '500',
    },
    seedCard: {
      padding: 18,
      borderRadius: 18,
      marginBottom: 20,
    },
    seedGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 10,
      justifyContent: 'space-between',
    },
    seedWord: {
      width: '31%',
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 12,
      paddingHorizontal: 10,
      borderRadius: 12,
      gap: 6,
    },
    seedIndex: {
      fontSize: 11,
      fontWeight: '700',
      width: 18,
    },
    seedWordText: {
      fontSize: 14,
      fontWeight: '600',
    },
    tipCard: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 14,
      borderRadius: 14,
      gap: 12,
    },
    tipIconBg: {
      width: 32,
      height: 32,
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
    },
    tipText: {
      flex: 1,
      fontSize: 13,
      lineHeight: 18,
    },
    verifyHeader: {
      alignItems: 'center',
      padding: 24,
      borderRadius: 18,
      marginBottom: 24,
    },
    verifyIconBg: {
      width: 56,
      height: 56,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 14,
    },
    verifyTitle: {
      fontSize: 18,
      fontWeight: '700',
      marginBottom: 8,
    },
    verifyDesc: {
      fontSize: 14,
      textAlign: 'center',
      lineHeight: 20,
    },
    confirmInputRow: {
      marginBottom: 18,
    },
    confirmLabel: {
      alignSelf: 'flex-start',
      paddingHorizontal: 14,
      paddingVertical: 7,
      borderRadius: 10,
      marginBottom: 10,
    },
    confirmLabelText: {
      fontSize: 13,
      fontWeight: '700',
      color: '#FFFFFF',
    },
    confirmInput: {
      fontSize: 16,
      paddingHorizontal: 16,
      paddingVertical: 16,
      borderRadius: 14,
      borderWidth: 1.5,
    },
    createButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      height: 50,
      borderRadius: 24,
      gap: 10,
    },
    createButtonText: {
      fontSize: 17,
      fontWeight: '700',
      color: '#FFFFFF',
    },
  });
