import { useSyncExternalStore } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

const BALANCE_HIDDEN_STORAGE_KEY = "pulse_balance_hidden_v1";

/** Texte affiché à la place de tout montant quand le solde est masqué. */
export const BALANCE_MASK = "••••••";

let hidden = false;
let loaded = false;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function ensureLoaded() {
  if (loaded || loading) return;
  loading = AsyncStorage.getItem(BALANCE_HIDDEN_STORAGE_KEY)
    .then((value) => {
      hidden = value === "1";
    })
    .catch(() => {
      hidden = false;
    })
    .finally(() => {
      loaded = true;
      loading = null;
      emit();
    });
}

function subscribe(cb: () => void) {
  ensureLoaded();
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot() {
  ensureLoaded();
  return hidden;
}

/** Masque / démasque le solde (choix conservé entre les sessions). */
export function toggleBalanceHidden() {
  setBalanceHidden(!getSnapshot());
}

export function setBalanceHidden(value: boolean) {
  ensureLoaded();
  if (hidden === value) return;
  hidden = value;
  emit();
  if (value) {
    void AsyncStorage.setItem(BALANCE_HIDDEN_STORAGE_KEY, "1").catch(() => {});
  } else {
    void AsyncStorage.removeItem(BALANCE_HIDDEN_STORAGE_KEY).catch(() => {});
  }
}

export function useBalanceHidden(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
