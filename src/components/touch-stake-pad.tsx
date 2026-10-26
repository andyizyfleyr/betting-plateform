"use client";

import { useState, useSyncExternalStore } from "react";
import { Delete, Keyboard } from "lucide-react";
import { triggerHaptic } from "@/lib/feedback";
import { cn, eur } from "@/lib/format";

const DESKTOP_QUICK_STAKES = [5, 10, 25, 50] as const;
const MOBILE_ADD_CHIPS = [5, 10, 50] as const;
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

function sanitizeStakeInput(raw: string): string | null {
  const clean = raw.replace(",", ".").replace(/[^0-9.]/g, "");
  const parts = clean.split(".");
  if (parts.length > 2) return null;
  if (parts[1] && parts[1].length > 2) return null;
  const num = Number(clean);
  if (clean !== "" && clean !== "." && (!Number.isFinite(num) || num > 99999)) {
    return null;
  }
  return clean;
}

function formatNumberClean(val: number): string {
  const rounded = Math.round(val * 100) / 100;
  if (rounded <= 0) return "";
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/\.?0+$/, "");
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
  maxCap = 99999,
  hasError = false,
  haptics = true,
  collapsibleOnMobile = false,
  defaultExpandedOnMobile = true,
}: TouchStakePadProps) {
  const isMobile = useSyncExternalStore(
    subscribeMobile,
    getMobileSnapshot,
    getServerSnapshot
  );
  const [padOpen, setPadOpen] = useState(defaultExpandedOnMobile);
  const [pristine, setPristine] = useState(true);

  const parsed = Number(stakeText.replace(",", "."));
  const numericStake =
    Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) / 100 : 0;

  const effectiveMax = Math.max(
    0,
    Math.min(maxCap, Math.floor(Math.max(0, balance) * 100) / 100)
  );

  const emitChange = (next: string, markTouched = true) => {
    if (markTouched) setPristine(false);
    onChangeStakeText(next);
  };

  const handleDesktopTyping = (raw: string) => {
    const next = sanitizeStakeInput(raw);
    if (next !== null) emitChange(next, true);
  };

  const pressDigit = (digit: string) => {
    triggerHaptic(haptics, 8);
    const base = pristine ? "" : stakeText.replace(",", ".");
    if (digit === ".") {
      if (base.includes(".")) return;
      emitChange(base === "" ? "0." : `${base}.`);
      return;
    }
    const candidate = base === "0" ? digit : `${base}${digit}`;
    const valid = sanitizeStakeInput(candidate);
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
    const valid = sanitizeStakeInput(`${base}00`);
    if (valid !== null) emitChange(valid);
  };

  const pressAdd = (delta: number) => {
    triggerHaptic(haptics, 10);
    const nextVal = Math.min(99999, Math.round((numericStake + delta) * 100) / 100);
    emitChange(formatNumberClean(nextVal));
  };

  const pressMax = () => {
    triggerHaptic(haptics, 12);
    if (effectiveMax <= 0) {
      emitChange("0");
      return;
    }
    emitChange(formatNumberClean(effectiveMax));
  };

  const showMobilePad = !collapsibleOnMobile || padOpen;

  return (
    <div>
      <div className="flex items-center justify-between text-[11.5px]">
        <label htmlFor={id} className="font-semibold text-mist">
          {label}
        </label>
        <span className="text-dim">
          Solde : <strong className="font-semibold text-ink">{eur(balance)}</strong>
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
          className="w-full cursor-pointer bg-transparent font-display text-[20px] font-bold tabular-nums text-ink outline-none placeholder:text-dim/50 lg:cursor-text"
        />

        {stakeText !== "" && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              triggerHaptic(haptics, 8);
              emitChange("");
            }}
            className="mr-2 shrink-0 rounded-md bg-elev px-2 py-1 text-[11px] font-semibold text-mist active:bg-edge"
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

        <span className="font-display text-[17px] font-bold text-dim">€</span>
      </div>

      {/* ── MOBILE (< lg) : Pavé numérique tactile 1xBet intégré au pouce ── */}
      <div className="mt-2 space-y-1.5 lg:hidden">
        {/* Ligne d'ajouts rapides (+5, +10, +50, MAX) toujours accessible au pouce */}
        <div className="grid grid-cols-4 gap-1.5">
          {MOBILE_ADD_CHIPS.map((delta) => (
            <button
              key={delta}
              type="button"
              onClick={() => pressAdd(delta)}
              className="flex h-8.5 touch-manipulation items-center justify-center rounded-xl border border-edge bg-elev font-display text-[12px] font-bold text-ink transition-transform active:scale-95 active:bg-edge"
            >
              +{delta} €
            </button>
          ))}
          <button
            type="button"
            onClick={pressMax}
            className="flex h-8.5 touch-manipulation items-center justify-center rounded-xl border border-betclic-red/30 bg-betclic-red/10 font-display text-[11.5px] font-extrabold text-betclic-red transition-transform active:scale-95"
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
            <NumKey label="," subtle onPress={() => pressDigit(".")} />

            <NumKey label="0" className={collapsibleOnMobile ? "col-span-3" : "col-span-4"} onPress={() => pressDigit("0")} />
            {collapsibleOnMobile && (
              <button
                type="button"
                onClick={() => {
                  triggerHaptic(haptics, 8);
                  setPadOpen(false);
                }}
                className="flex h-9.5 touch-manipulation items-center justify-center rounded-xl bg-ink font-display text-[12px] font-bold text-white shadow-2xs active:scale-95"
              >
                OK
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── DESKTOP (>= lg) : Mises rapides classiques ── */}
      <div className="mt-2 hidden grid-cols-5 gap-1.5 lg:grid">
        {DESKTOP_QUICK_STAKES.map((amount) => {
          const active = numericStake === amount;
          return (
            <button
              key={amount}
              type="button"
              onClick={() => {
                onChangeStakeText(String(amount));
              }}
              className={cn(
                "h-8.5 rounded-xl border font-display text-[12px] font-bold transition-colors active:scale-95",
                active
                  ? "border-ink bg-ink text-white"
                  : "border-edge bg-elev text-ink hover:bg-edge/70"
              )}
            >
              {amount} €
            </button>
          );
        })}
        <button
          type="button"
          onClick={pressMax}
          className="h-8.5 rounded-xl border border-betclic-red/30 bg-betclic-red/10 font-display text-[11.5px] font-bold text-betclic-red hover:bg-betclic-red/15 active:scale-95"
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
        "flex h-9.5 touch-manipulation items-center justify-center rounded-xl border border-edge/80 font-display text-[15px] font-bold shadow-2xs transition-transform active:scale-95",
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
