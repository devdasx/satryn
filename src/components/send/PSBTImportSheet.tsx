/**
 * PSBTImportSheet — Bottom sheet for importing signed PSBTs from external cosigners.
 * Supports three import methods: QR scan, clipboard paste, and file picker.
 */

import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
import { File as ExpoFile } from 'expo-file-system';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks';
import { THEME } from '../../constants';
import { AppBottomSheet } from '../ui/AppBottomSheet';
import { AppButton } from '../ui/AppButton';
import { QRScanner } from '../scanner/QRScanner';

interface PSBTImportSheetProps {
  visible: boolean;
  onClose: () => void;
  onImport: (base64: string) => Promise<{ success: boolean; newSignatures: number; error?: string }>;
}

export function PSBTImportSheet({ visible, onClose, onImport }: PSBTImportSheetProps) {
  const { colors } = useTheme();
  const [isImporting, setIsImporting] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [importResult, setImportResult] = useState<{ success: boolean; count: number } | null>(null);

  const handleImportResult = useCallback(async (base64: string) => {
    setIsImporting(true);
    setImportResult(null);

    try {
      const result = await onImport(base64);

      if (result.success) {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setImportResult({ success: true, count: result.newSignatures });

        if (result.newSignatures === 0) {
          Alert.alert('No New Signatures', 'This PSBT does not contain any new signatures that are not already present.');
        } else {
          // Auto-close after brief delay on success
          setTimeout(() => {
            onClose();
            setImportResult(null);
          }, 1500);
        }
      } else {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        Alert.alert('Import Failed', result.error || 'Could not import the signed PSBT.');
      }
    } catch (err: any) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Import Error', err.message || 'An unexpected error occurred.');
    } finally {
      setIsImporting(false);
    }
  }, [onImport, onClose]);

  const handleScanQR = useCallback(() => {
    setShowScanner(true);
  }, []);

  const handleQRScanned = useCallback((data: string) => {
    setShowScanner(false);
    // QR data could be raw base64 PSBT
    const trimmed = data.trim();
    if (trimmed) {
      handleImportResult(trimmed);
    }
  }, [handleImportResult]);

  const handlePasteClipboard = useCallback(async () => {
    try {
      const text = await Clipboard.getStringAsync();
      if (!text || !text.trim()) {
        Alert.alert('Empty Clipboard', 'No PSBT data found in the clipboard.');
        return;
      }
      handleImportResult(text.trim());
    } catch (err: any) {
      Alert.alert('Clipboard Error', 'Could not read from clipboard.');
    }
  }, [handleImportResult]);

  const handleImportFile = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/octet-stream', 'application/x-psbt', '*/*'],
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        return; // User cancelled
      }

      const asset = result.assets[0];
      setIsImporting(true);

      // Read the file content using expo-file-system v19 File API
      const expoFile = new ExpoFile(asset.uri);
      const arrayBuffer = await expoFile.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);

      if (bytes.length === 0) {
        Alert.alert('Empty File', 'The selected file appears to be empty.');
        return;
      }

      // Try to interpret the file contents:
      // 1. If it looks like a text file (valid UTF-8 base64 string), treat as base64 PSBT
      // 2. Otherwise, treat as binary PSBT and convert to base64
      const textDecoder = new TextDecoder('utf-8', { fatal: true });
      let textContent: string | null = null;
      try {
        textContent = textDecoder.decode(bytes).trim();
      } catch {
        // Not valid UTF-8 text — treat as binary
      }

      if (textContent && /^[A-Za-z0-9+/=\s]+$/.test(textContent)) {
        // Looks like base64 text — use directly
        await handleImportResult(textContent.replace(/\s/g, ''));
      } else {
        // Binary PSBT file — convert to base64
        // Build base64 from raw bytes
        let binaryStr = '';
        for (let i = 0; i < bytes.length; i++) {
          binaryStr += String.fromCharCode(bytes[i]);
        }
        const base64Content = btoa(binaryStr);
        await handleImportResult(base64Content);
      }
    } catch (err: any) {
      Alert.alert('File Error', err.message || 'Could not read the selected file.');
    } finally {
      setIsImporting(false);
    }
  }, [handleImportResult]);

  return (
    <>
      <AppBottomSheet
        visible={visible}
        onClose={onClose}
        title="Import Signed PSBT"
        subtitle="Import signatures from external cosigners"
        sizing="auto"
      >
        <View style={styles.content}>
          {isImporting ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={THEME.brand.bitcoin} />
              <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
                Merging signatures...
              </Text>
            </View>
          ) : importResult?.success ? (
            <View style={styles.successContainer}>
              <View style={[styles.successIcon, { backgroundColor: `${THEME.brand.bitcoin}15` }]}>
                <Ionicons name="checkmark-circle" size={48} color={THEME.brand.bitcoin} />
              </View>
              <Text style={[styles.successText, { color: colors.text }]}>
                {importResult.count === 1
                  ? '1 new signature merged'
                  : `${importResult.count} new signatures merged`}
              </Text>
            </View>
          ) : (
            <View style={styles.options}>
              <AppButton
                title="Scan QR Code"
                onPress={handleScanQR}
                variant="secondary"
                icon="qr-code-outline"
              />
              <AppButton
                title="Paste from Clipboard"
                onPress={handlePasteClipboard}
                variant="secondary"
                icon="clipboard-outline"
              />
              <AppButton
                title="Import File"
                onPress={handleImportFile}
                variant="secondary"
                icon="document-outline"
              />
            </View>
          )}
        </View>
      </AppBottomSheet>

      {/* QR Scanner overlay */}
      <QRScanner
        visible={showScanner}
        onClose={() => setShowScanner(false)}
        onScan={handleQRScanned}
        title="Scan Signed PSBT"
        subtitle="Scan a QR code containing the signed PSBT"
      />
    </>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  options: {
    gap: 10,
  },
  loadingContainer: {
    alignItems: 'center',
    paddingVertical: 32,
    gap: 12,
  },
  loadingText: {
    fontSize: 15,
    fontWeight: '500',
  },
  successContainer: {
    alignItems: 'center',
    paddingVertical: 24,
    gap: 12,
  },
  successIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  successText: {
    fontSize: 16,
    fontWeight: '600',
  },
});
