const Module = require('module'); const original = Module._load; const assert = require('node:assert/strict');
const store = new Map(); let protectedReads = 0;
Module._load = function(name, parent, main) {
 if (name === 'expo-secure-store') return { canUseBiometricAuthentication: () => true, getItemAsync: async (k,o) => { if (o?.requireAuthentication) protectedReads++; return store.get(k) ?? null; }, setItemAsync: async (k,v) => { store.set(k,v); }, deleteItemAsync: async (k) => { store.delete(k); } };
 if (name === 'react-native') return { AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) }, Platform: { OS: 'android' } };
 if (name === 'expo-constants') return { __esModule: true, default: { expoConfig: { extra: {} } } };
 return original.apply(this, arguments);
};
(async () => { const h = require('../mobile/src/lib/http.ts'); await h.persistAuthToken('jwt-test'); await h.setBiometricLoginEnabled(true); assert.equal(store.has('pulse_android_jwt_v1'), false); assert.equal(store.get('pulse_android_jwt_biometric_v1'),'jwt-test'); assert(await h.verifyBiometricUnlock()); assert(protectedReads>=2); await h.setBiometricLoginEnabled(false); assert.equal(store.get('pulse_android_jwt_v1'),'jwt-test'); assert.equal(store.has('pulse_android_jwt_biometric_v1'),false); await h.persistAuthToken(null); assert.equal(store.size,0); console.log('Biométrie mockée : activation, déverrouillage, désactivation et déconnexion OK'); })().catch(e=>{console.error(e);process.exit(1)});
