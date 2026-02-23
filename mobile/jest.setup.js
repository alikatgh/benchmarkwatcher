import mockAsyncStorage from '@react-native-async-storage/async-storage/jest/async-storage-mock';
jest.mock('@react-native-async-storage/async-storage', () => mockAsyncStorage);

// Force evaluation of Expo's lazy global getters before tests run to prevent Jest teardown ReferenceErrors
const expoModules = ['__ExpoImportMetaRegistry', 'URL', 'URLSearchParams', 'TextDecoder', 'TextEncoderStream', 'structuredClone'];
expoModules.forEach(name => {
    try { !!global[name]; } catch (e) { }
});
