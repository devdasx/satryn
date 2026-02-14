// Polyfills for Bitcoin libraries in React Native
// IMPORTANT: This must be imported before any Bitcoin/crypto libraries

// Crypto polyfill - MUST be first!
import 'react-native-get-random-values';

import { Buffer } from 'buffer';
import * as expoCrypto from 'expo-crypto';

// Make Buffer globally available
global.Buffer = Buffer;

// Ensure crypto.getRandomValues is available globally
if (typeof global.crypto === 'undefined') {
  global.crypto = {};
}

if (typeof global.crypto.getRandomValues === 'undefined') {
  global.crypto.getRandomValues = (array) => {
    // Use expo-crypto as fallback
    const randomBytes = expoCrypto.getRandomBytes(array.length);
    for (let i = 0; i < array.length; i++) {
      array[i] = randomBytes[i];
    }
    return array;
  };
}

// Process polyfill
if (typeof process === 'undefined') {
  global.process = require('process/browser');
}

// Ensure process.version exists (needed by some crypto modules at load time)
if (global.process && !global.process.version) {
  global.process.version = 'v16.0.0';
}
