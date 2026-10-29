const Module = require('node:module');
const assert = require('node:assert/strict');
const oldLoad = Module._load;
let loadedNotifications = false;
Module._load = function(name) {
  if (name === '@/lib/http') return { requestJson: async () => ({}) };
  if (name === 'expo-modules-core') return { requireOptionalNativeModule: () => null };
  if (name === 'expo-constants') return { __esModule: true, default: {} };
  if (name === 'expo-secure-store') return { getItemAsync: async () => null, setItemAsync: async () => {}, deleteItemAsync: async () => {} };
  if (name === 'react-native') return { Platform: { OS: 'android' }, AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) } };
  if (name === 'expo-notifications') { loadedNotifications = true; throw new Error('Must not load on old APK'); }
  return oldLoad.apply(this, arguments);
};
(async () => {
  const push = require('../mobile/src/lib/push-notifications.ts');
  assert.equal(push.loadNotifications(), null);
  assert.equal(await push.registerPushDevice(false), false);
  assert.equal(loadedNotifications, false);
  await assert.rejects(() => push.registerPushDevice(true), /nouvelle version Android/);
  console.log('Ancienne APK : module push optionnel correctement protégé');
})().catch((e) => { console.error(e); process.exit(1); });
