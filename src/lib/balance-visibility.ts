"use client";

import { useSyncExternalStore } from "react";

const BALANCE_HIDDEN_STORAGE_KEY = "pulsebet_balance_hidden_v1";

let hidden = false;
let loaded = false;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function ensureLoaded() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    hidden = window.localStorage.getItem(BALANCE_HIDDEN_STORAGE_KEY) === "1";
  } catch {
    hidden = false;
  }
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

function getServerSnapshot() {
  return false;
}

/** Masque / démasque le solde (choix conservé entre les sessions). */
export function toggleBalanceHidden() {
  setBalanceHidden(!getSnapshot());
}

export function setBalanceHidden(value: boolean) {
  ensureLoaded();
  if (hidden === value) return;
  hidden = value;
  try {
    if (value) window.localStorage.setItem(BALANCE_HIDDEN_STORAGE_KEY, "1");
    else window.localStorage.removeItem(BALANCE_HIDDEN_STORAGE_KEY);
  } catch {
    /* silencieux */
  }
  emit();
}

export function useBalanceHidden(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
