const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const original = Module._load;
const calls = [];
let handler;
Module._load = function(name) {
  if (name === 'expo-haptics') return {
    ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' },
    NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
    impactAsync: async style => { calls.push(style); },
    notificationAsync: async style => { calls.push(style); },
  };
  if (name === 'react') return { useEffect: callback => callback() };
  if (name === '@/context/app-context') return { useApp: () => ({ user: null }) };
  if (name === '@/lib/router') return { useRouter: () => ({ push() {} }) };
  if (name === '@/lib/push-notifications') return { loadNotifications: () => ({
    setNotificationHandler: h => { handler = h; },
    addNotificationResponseReceivedListener: () => ({ remove() {} }),
    getLastNotificationResponseAsync: async () => null,
  }) };
  return original.apply(this, arguments);
};
(async () => {
  const { triggerHaptic } = require('../mobile/src/theme/tokens.ts');
  triggerHaptic('light', true);
  triggerHaptic('light', false);
  assert.deepEqual(calls, ['light']);
  const { PushCoordinator } = require('../mobile/src/components/push-coordinator.tsx');
  PushCoordinator();
  const foreground = await handler.handleNotification();
  assert.equal(foreground.shouldShowAlert, false);
  assert.equal(foreground.shouldPlaySound, false);
  const read = path => fs.readFileSync(path, 'utf8');
  for (const path of ['mobile/src/components/match-card.tsx', 'mobile/src/components/market-sheet.tsx', 'mobile/app/(main)/predictions/index.tsx', 'mobile/app/(main)/predictions/[id].tsx']) {
    assert(read(path).includes('onLongPress'));
    assert(!read(path).includes('triggerHaptic("medium"'));
  }
  const context = read('mobile/src/context/app-context.tsx');
  const toggle = context.slice(context.indexOf('  const toggleComboLeg ='), context.indexOf('  const removeComboLeg ='));
  assert(toggle.includes('persistCombo(next)'));
  assert(toggle.includes('triggerHaptic("light", hapticsEnabled)'));
  assert(!read('mobile/App.tsx').includes('ToastHost'));
  assert(!read('mobile/app/(main)/_layout.tsx').includes('ToastHost'));
  assert(!read('src/components/providers.tsx').includes('<Toasts'));
  console.log('Notifications au premier plan supprimées et retour haptique léger vérifiés (modules simulés).');
})().catch(e => { console.error(e); process.exit(1); });
