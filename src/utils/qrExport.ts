import { Share, Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

/**
 * Captures a QR code SVG ref to a base64 PNG data URL.
 * Uses the react-native-qrcode-svg getRef → toDataURL API.
 */
export function captureQRToBase64(svgRef: any): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!svgRef || typeof svgRef.toDataURL !== 'function') {
      reject(new Error('Invalid SVG ref — missing toDataURL'));
      return;
    }
    try {
      svgRef.toDataURL((data: string) => {
        resolve(data);
      });
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Shares a QR code as a PNG image via the native share sheet.
 * Falls back to text sharing if image export fails.
 *
 * @param svgRef - The SVG ref from react-native-qrcode-svg (via getRef/onRef)
 * @param fallbackText - Text to share if PNG export fails (e.g. bitcoin URI)
 * @param filename - Name for the exported file (without extension)
 */
export async function shareQRAsPNG(
  svgRef: any,
  fallbackText?: string,
  filename: string = 'qr-code',
): Promise<void> {
  try {
    const base64 = await captureQRToBase64(svgRef);
    const file = new File(Paths.cache, `${filename}.png`);

    // Write base64 PNG data to temp file
    file.write(base64, { encoding: 'base64' });

    if (Platform.OS === 'ios') {
      await Sharing.shareAsync(file.uri, {
        mimeType: 'image/png',
        UTI: 'public.png',
      });
    } else {
      await Sharing.shareAsync(file.uri, {
        mimeType: 'image/png',
      });
    }
  } catch (err) {
    if (fallbackText) {
      await Share.share({ message: fallbackText });
    }
  }
}
