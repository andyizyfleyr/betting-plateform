"use client";

import { useState, useSyncExternalStore } from "react";
import { Delete, Keyboard } from "lucide-react";
import {
  formatLocalInputString,
  formatPresetChip,
  maxSpendableLocalFromEur,
  type CurrencyCode,
} from "@/lib/countries";
import { triggerHaptic } from "@/lib/feedback";
import { cn, eur } from "@/lib/format";
import { useApp } from "./providers";

const MOBILE_MEDIA_QUERY = "(max-width: 1023px)";

function subscribeMobile(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const mql = window.matchMedia(MOBILE_MEDIA_QUERY);
  mql.addEventListener("change", cb);
  return () => mql.removeEventListener("change", cb);
}

function getMobileSnapshot(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia(MOBILE_MEDIA_QUERY).matches;
}

function getServerSnapshot(): boolean {
  return false;
}

function sanitizeStakeInput(
  raw: string,
  decimals: 0 | 2,
  maxCap: number
): string | null {
  const clean = raw.replace(",", ".").replace(/[^0-9.]/g, "");
  if (decimals === 0 && clean.includes(".")) return null;
  const parts = clean.split(".");
  if (parts.length > 2) return null;
  if (parts[1] && parts[1].length > decimals) return null;
  const num = Number(clean);
  if (clean !== "" && clean !== "." && (!Number.isFinite(num) || num > maxCap)) {
    return null;
  }
  return clean;
}

function formatNumberClean(val: number, currency: CurrencyCode): string {
  return formatLocalInputString(val, currency, ".");
}

export interface TouchStakePadProps {
  id?: string;
  label?: string;
  stakeText: string;
  onChangeStakeText: (next: string) => void;
  balance: number;
  maxCap?: number;
  hasError?: boolean;
  haptics?: boolean;
  /** Sur une page longue (ex. /betslip), replie la grille 0-9 tant qu'on ne touche pas le champ */
  collapsibleOnMobile?: boolean;
  defaultExpandedOnMobile?: boolean;
}

export function TouchStakePad({
  id = "stake-input",
  label = "Votre mise",
  stakeText,
  onChangeStakeText,
  balance,
  maxCap,
  hasError = false,
  haptics = true,
  collapsibleOnMobile = false,
  defaultExpandedOnMobile = true,
}: TouchStakePadProps) {
  const { currency, currencyConfig } = useApp();
  const resolvedMaxCap = maxCap ?? currencyConfig.maxInputLocal;
  const isMobile = useSyncExternalStore(
    subscribeMobile,
    getMobileSnapshot,
    getServerSnapshot
  );
  const [padOpen, setPadOpen] = useState(defaultExpandedOnMobile);
  const [pristine, setPristine] = useState(true);

  const parsed = Number(stakeText.replace(",", "."));
  const numericStake =
    Number.isFinite(parsed) && parsed > 0
      ? currencyConfig.decimals === 0
        ? Math.round(parsed)
        : Math.round(parsed * 100) / 100
      : 0;

  const effectiveMax = Math.max(
    0,
    Math.min(resolvedMaxCap, maxSpendableLocalFromEur(balance, currency))
  );

  const emitChange = (next: string, markTouched = true) => {
    if (markTouched) setPristine(false);
    onChangeStakeText(next);
  };

  const handleDesktopTyping = (raw: string) => {
    const next = sanitizeStakeInput(raw, currencyConfig.decimals, resolvedMaxCap);
    if (next !== null) emitChange(next, true);
  };

  const pressDigit = (digit: string) => {
    triggerHaptic(haptics, 8);
    const base = pristine ? "" : stakeText.replace(",", ".");
    if (digit === ".") {
      if (currencyConfig.decimals === 0 || base.includes(".")) return;
      emitChange(base === "" ? "0." : `${base}.`);
      return;
    }
    const candidate = base === "0" ? digit : `${base}${digit}`;
    const valid = sanitizeStakeInput(
      candidate,
      currencyConfig.decimals,
      resolvedMaxCap
    );
    if (valid !== null) emitChange(valid);
  };

  const pressBackspace = () => {
    triggerHaptic(haptics, 8);
    if (pristine) {
      emitChange("");
      return;
    }
    emitChange(stakeText.slice(0, -1));
  };

  const pressDoubleZero = () => {
    triggerHaptic(haptics, 8);
    const base = pristine ? "" : stakeText.replace(",", ".");
    if (base === "" || base === "0") {
      emitChange("0");
      return;
    }
    const valid = sanitizeStakeInput(
      `${base}00`,
      currencyConfig.decimals,
      resolvedMaxCap
    );
    if (valid !== null) emitChange(valid);
  };

  const pressTripleZero = () => {
    triggerHaptic(haptics, 8);
    const base = pristine ? "" : stakeText.replace(",", ".");
    if (base === "" || base === "0") {
      emitChange("0");
      return;
    }
    const valid = sanitizeStakeInput(
      `${base}000`,
      currencyConfig.decimals,
      resolvedMaxCap
    );
    if (valid !== null) emitChange(valid);
  };

  const pressPreset = (amount: number) => {
    triggerHaptic(haptics, 10);
    const capped = Math.min(resolvedMaxCap, amount);
    emitChange(formatNumberClean(capped, currency));
  };

  const pressMax = () => {
    triggerHaptic(haptics, 12);
    if (effectiveMax <= 0) {
      emitChange("0");
      return;
    }
    emitChange(formatNumberClean(effectiveMax, currency));
  };

  const showMobilePad = !collapsibleOnMobile || padOpen;

  return (
    <div>
      <div className="flex items-center justify-between text-[10.5px]">
        <label htmlFor={id} className="font-medium text-mist">
          {label}
        </label>
        <span className="text-dim">
          Solde : <strong className="font-medium text-ink">{eur(balance)}</strong>
        </span>
      </div>

      {/* Zone d'affichage / saisie de la mise (sans clavier natif iOS/Android sur mobile) */}
      <div
        onClick={() => {
          if (isMobile && collapsibleOnMobile && !padOpen) {
            triggerHaptic(haptics, 6);
            setPadOpen(true);
          }
        }}
        className={cn(
          "mt-1.5 flex h-12 items-center rounded-2xl border bg-white px-3.5 transition-colors",
          hasError
            ? "border-betclic-red"
            : isMobile && showMobilePad
              ? "border-ink ring-2 ring-ink/8"
              : "border-edge focus-within:border-ink"
        )}
      >
        <input
          id={id}
          type="text"
          inputMode={isMobile ? "none" : "decimal"}
          readOnly={isMobile}
          value={stakeText}
          onFocus={() => {
            if (isMobile && collapsibleOnMobile) setPadOpen(true);
          }}
          onChange={(e) => handleDesktopTyping(e.target.value)}
          placeholder="0"
          className="w-full cursor-pointer bg-transparent font-display text-[14.5px] font-medium tabular-nums text-ink outline-none placeholder:text-dim/50 lg:cursor-text"
        />

        {stakeText !== "" && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              triggerHaptic(haptics, 8);
              emitChange("");
            }}
            className="mr-2 shrink-0 rounded-md bg-elev px-2 py-1 text-[10px] font-medium text-mist active:bg-edge"
          >
            Effacer
          </button>
        )}

        {collapsibleOnMobile && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              triggerHaptic(haptics, 6);
              setPadOpen((o) => !o);
            }}
            aria-label={padOpen ? "Replier le pavé tactile" : "Ouvrir le pavé tactile"}
            className={cn(
              "mr-2 grid h-7 w-7 shrink-0 place-items-center rounded-lg transition-colors lg:hidden",
              padOpen ? "bg-ink text-white" : "bg-elev text-mist"
            )}
          >
            <Keyboard className="h-3.5 w-3.5" strokeWidth={2.2} />
          </button>
        )}

        <span className="shrink-0 font-display text-[12px] font-medium text-dim">
          {currencyConfig.symbol}
        </span>
      </div>

      {/* ── MOBILE (< lg) : Jetons rapides adaptés à la devise + Pavé 0-9 repliable ── */}
      <div className="mt-2 space-y-1.5 lg:hidden">
        <div className="grid grid-cols-5 gap-1.5">
          {currencyConfig.stakePresets.map((amount) => {
            const active = numericStake === amount;
            return (
              <button
                key={amount}
                type="button"
                onClick={() => pressPreset(amount)}
                className={cn(
                  "flex h-8.5 touch-manipulation items-center justify-center rounded-xl border px-1 font-display text-[9.5px] font-medium transition-transform active:scale-95",
                  active
                    ? "border-ink bg-ink text-white"
                    : "border-edge bg-elev text-ink active:bg-edge"
                )}
              >
                <span className="truncate">{formatPresetChip(amount, currency)}</span>
              </button>
            );
          })}
          <button
            type="button"
            onClick={pressMax}
            className="flex h-8.5 touch-manipulation items-center justify-center rounded-xl border border-betclic-red/30 bg-betclic-red/10 font-display text-[10.5px] font-medium text-betclic-red transition-transform active:scale-95"
          >
            MAX
          </button>
        </div>

        {/* Grille chiffres compacte (zéro remontée du clavier système) */}
        {showMobilePad && (
          <div className="grid grid-cols-4 gap-1.5 rounded-2xl border border-edge/80 bg-elev/55 p-1.5 select-none">
            {["1", "2", "3"].map((d) => (
              <NumKey key={d} label={d} onPress={() => pressDigit(d)} />
            ))}
            <button
              type="button"
              onClick={pressBackspace}
              aria-label="Effacer un chiffre"
              className="flex h-9.5 touch-manipulation items-center justify-center rounded-xl border border-edge/80 bg-white text-mist shadow-2xs transition-transform active:scale-95 active:bg-elev active:text-ink"
            >
              <Delete className="h-4 w-4" strokeWidth={2.2} />
            </button>

            {["4", "5", "6"].map((d) => (
              <NumKey key={d} label={d} onPress={() => pressDigit(d)} />
            ))}
            <NumKey label="00" subtle onPress={pressDoubleZero} />

            {["7", "8", "9"].map((d) => (
              <NumKey key={d} label={d} onPress={() => pressDigit(d)} />
            ))}
            {currencyConfig.decimals === 0 ? (
              <NumKey label="000" subtle onPress={pressTripleZero} />
            ) : (
              <NumKey label="," subtle onPress={() => pressDigit(".")} />
            )}

            <NumKey label="0" className={collapsibleOnMobile ? "col-span-3" : "col-span-4"} onPress={() => pressDigit("0")} />
            {collapsibleOnMobile && (
              <button
                type="button"
                onClick={() => {
                  triggerHaptic(haptics, 8);
                  setPadOpen(false);
                }}
                className="flex h-9.5 touch-manipulation items-center justify-center rounded-xl bg-ink font-display text-[10.5px] font-medium text-white shadow-2xs active:scale-95"
              >
                OK
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── DESKTOP (>= lg) : Mises rapides adaptées à la devise ── */}
      <div className="mt-2 hidden grid-cols-5 gap-1.5 lg:grid">
        {currencyConfig.stakePresets.map((amount) => {
          const active = numericStake === amount;
          return (
            <button
              key={amount}
              type="button"
              onClick={() => {
                onChangeStakeText(String(amount));
              }}
              className={cn(
                "h-8.5 rounded-xl border px-1 font-display text-[10px] font-medium transition-colors active:scale-95",
                active
                  ? "border-ink bg-ink text-white"
                  : "border-edge bg-elev text-ink hover:bg-edge/70"
              )}
            >
              <span className="truncate">{formatPresetChip(amount, currency)}</span>
            </button>
          );
        })}
        <button
          type="button"
          onClick={pressMax}
          className="h-8.5 rounded-xl border border-betclic-red/30 bg-betclic-red/10 font-display text-[10.5px] font-medium text-betclic-red hover:bg-betclic-red/15 active:scale-95"
        >
          MAX
        </button>
      </div>
    </div>
  );
}

function NumKey({
  label,
  onPress,
  subtle = false,
  className,
}: {
  label: string;
  onPress: () => void;
  subtle?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onPress}
      className={cn(
        "flex h-9.5 touch-manipulation items-center justify-center rounded-xl border border-edge/80 font-display text-[12px] font-medium shadow-2xs transition-transform active:scale-95",
        subtle
          ? "bg-elev/80 text-mist active:bg-edge active:text-ink"
          : "bg-white text-ink active:bg-elev",
        className
      )}
    >
      {label}
    </button>
  );
}
