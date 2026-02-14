const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// Add polyfills for Node.js core modules used by Bitcoin libraries
config.resolver.extraNodeModules = {
  crypto: require.resolve('crypto-browserify'),
  stream: require.resolve('stream-browserify'),
  buffer: require.resolve('buffer/'),
  events: require.resolve('events/'),
  process: require.resolve('process/browser'),
  // Electrum TCP/TLS support via react-native-tcp-socket
  net: require.resolve('react-native-tcp-socket'),
  tls: require.resolve('react-native-tcp-socket'),
};

// Enable package.json "exports" field resolution so Metro respects
// subpath exports (e.g. @noble/hashes/crypto → ./crypto.js).
config.resolver.unstable_enablePackageExports = true;

// Set condition names for export map resolution.
config.resolver.unstable_conditionNames = ['require', 'import', 'default'];

// Fix @noble/hashes/crypto.js export map mismatch.
// The package declares "./crypto" in exports but not "./crypto.js".
// Metro internally appends .js when resolving, causing a warning.
// We resolve it directly to the correct file.
const originalResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === '@noble/hashes/crypto') {
    return {
      filePath: path.resolve(
        __dirname,
        'node_modules/@noble/hashes/crypto.js',
      ),
      type: 'sourceFile',
    };
  }
  if (originalResolveRequest) {
    return originalResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
