"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, Download, Hash, Loader2, Share2 } from "lucide-react";
import { api } from "@/lib/api";
import {
  cacheCouponLocally,
  decodeSharePayload,
  encodeSharePayload,
  getLocalCachedCoupon,
  normalizeCouponCode,
} from "@/lib/coupon-code";
import { triggerHaptic } from "@/lib/feedback";
import type { ComboSelection } from "./combo-slip";
import { useApp } from "./providers";
import { cn } from "@/lib/format";

export function CouponCodeBox({
  variant = "compact",
  autoCheckUrlCode = false,
  className,
}: {
  variant?: "empty" | "compact";
  autoCheckUrlCode?: boolean;
  className?: string;
}) {
  const { comboLegs, loadComboLegs, toast, user } = useApp();
  const [generatedCode, setGeneratedCode] = useState<string | null>(null);
  const [generatedSignature, setGeneratedSignature] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  const [loadOpen, setLoadOpen] = useState(variant === "empty");
  const [codeInput, setCodeInput] = useState("");
  const [loadingCode, setLoadingCode] = useState(false);
  const autoLoadedRef = useRef<string | null>(null);

  const currentSignature = comboLegs
    .map((l) => `${l.uid}:${l.market}:${l.selection}`)
    .join("|");
  const activeCode =
    generatedCode && generatedSignature === currentSignature ? generatedCode : null;
  const hapticsEnabled = user?.haptics;

  const applyLoadedCode = useCallback(
    async (rawInput: string, urlPayloadToken?: string | null) => {
      const embeddedC = /[?&]c=([A-Za-z0-9_-]+)/.exec(rawInput)?.[1] ?? urlPayloadToken ?? null;
      const normalized = normalizeCouponCode(rawInput);
      if (!normalized || normalized.length < 6) {
        toast({
          kind: "error",
          title: "Code coupon invalide",
          description: "Entrez un code valide (ex. BX-84K2).",
        });
        return;
      }

      setLoadingCode(true);
      try {
        let loadedLegs: ComboSelection[] | null = null;
        let skipped = 0;
        let finalCode = normalized;

        try {
          const res = await api.loadCoupon(normalized);
          loadedLegs = res.legs as ComboSelection[];
          skipped = res.skippedClosedCount ?? 0;
          finalCode = res.code;
        } catch (apiErr) {
          const fallback = getLocalCachedCoupon(normalized) ?? decodeSharePayload(embeddedC);
          if (fallback && fallback.length > 0) {
            loadedLegs = fallback;
          } else {
            throw apiErr;
          }
        }

        if (!loadedLegs || loadedLegs.length === 0) {
          throw new Error("Aucune sélection ouverte trouvée pour ce code.");
        }

        loadComboLegs(loadedLegs);
        cacheCouponLocally(finalCode, loadedLegs);
        triggerHaptic(hapticsEnabled, [15, 25]);
        setCodeInput("");
        setLoadOpen(false);
        toast({
          kind: "success",
          title: `Coupon ${finalCode} chargé`,
          description:
            skipped > 0
              ? `${loadedLegs.length} sélection${loadedLegs.length > 1 ? "s" : ""} ajoutée${loadedLegs.length > 1 ? "s" : ""} (${skipped} expirée${skipped > 1 ? "s" : ""} ignorée${skipped > 1 ? "s" : ""})`
              : `${loadedLegs.length} sélection${loadedLegs.length > 1 ? "s" : ""} prête${loadedLegs.length > 1 ? "s" : ""} à miser`,
        });
      } catch (err) {
        toast({
          kind: "error",
          title: "Chargement impossible",
          description:
            err instanceof Error ? err.message : "Code coupon introuvable ou expiré.",
        });
      } finally {
        setLoadingCode(false);
      }
    },
    [loadComboLegs, toast, hapticsEnabled]
  );

  // Chargement automatique si l'utilisateur ouvre un lien partagé `/betslip?code=BX-84K2`
  useEffect(() => {
    if (!autoCheckUrlCode || typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const urlCode = params.get("code");
    const urlPayload = params.get("c");
    if (!urlCode) return;
    const norm = normalizeCouponCode(urlCode);
    if (!norm || autoLoadedRef.current === norm) return;
    autoLoadedRef.current = norm;
    const cleanUrl = window.location.pathname;
    window.history.replaceState({}, "", cleanUrl);
    void applyLoadedCode(norm, urlPayload);
  }, [autoCheckUrlCode, applyLoadedCode]);

  const handleGenerateCode = async () => {
    if (comboLegs.length === 0 || saving) return;
    setSaving(true);
    try {
      let code: string;
      try {
        const res = await api.saveCoupon(comboLegs);
        code = res.code;
      } catch {
        // Repli local déterministe si hors-ligne temporaire
        const rand = Array.from({ length: 4 }, () =>
          "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"[Math.floor(Math.random() * 32)]
        ).join("");
        code = `BX-${rand}`;
      }
      cacheCouponLocally(code, comboLegs);
      setGeneratedCode(code);
      setGeneratedSignature(currentSignature);
      triggerHaptic(user?.haptics, [12, 22]);

      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(code).catch(() => undefined);
        setCopied(true);
        setTimeout(() => setCopied(false), 2200);
      }
      toast({
        kind: "success",
        title: `Code du coupon : ${code}`,
        description: "Copié ! Partagez-le sur WhatsApp ou Telegram.",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleCopyCode = async () => {
    if (!activeCode) return;
    triggerHaptic(user?.haptics, 8);
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(activeCode).catch(() => undefined);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast({ kind: "success", title: `Code ${activeCode} copié` });
  };

  const handleShareCode = async () => {
    if (!activeCode) return;
    triggerHaptic(user?.haptics, 10);
    const compact = encodeSharePayload(comboLegs);
    const shareUrl =
      typeof window !== "undefined"
        ? `${window.location.origin}/betslip?code=${encodeURIComponent(activeCode)}${compact ? `&c=${compact}` : ""}`
        : "";
    const shareText = `Voici mon code coupon (${comboLegs.length} sélection${comboLegs.length > 1 ? "s" : ""}) : ${activeCode}`;

    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share({
          title: `Coupon ${activeCode}`,
          text: shareText,
          ...(shareUrl ? { url: shareUrl } : {}),
        });
        return;
      } catch {
        /* annulé par l'utilisateur ou non supporté */
      }
    }

    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard
        .writeText(shareUrl ? `${shareText}\n${shareUrl}` : shareText)
        .catch(() => undefined);
    }
    toast({
      kind: "success",
      title: "Lien & code copiés",
      description: `${activeCode} prêt à coller sur WhatsApp / Telegram`,
    });
  };

  if (variant === "empty") {
    return (
      <div className="mt-5 rounded-2xl border border-edge bg-elev/55 p-3.5 text-left">
        <div className="flex items-center gap-1.5 text-[10.5px] font-medium text-ink">
          <Hash className="h-3.5 w-3.5 text-betclic-red" strokeWidth={2.5} />
          <span className="font-display">Charger un code du coupon</span>
        </div>
        <p className="mt-0.5 text-[10px] text-mist">
          Entrez le code partagé par un ami (ex. <strong className="text-ink">BX-84K2</strong>) pour importer ses sélections.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void applyLoadedCode(codeInput);
          }}
          className="mt-2.5 flex items-center gap-2"
        >
          <input
            type="text"
            value={codeInput}
            onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
            placeholder="Ex. BX-84K2"
            maxLength={48}
            className="h-10 min-w-0 flex-1 rounded-xl border border-edge bg-white px-3 font-display text-[11.5px] font-medium tracking-wider text-ink uppercase outline-none placeholder:font-sans placeholder:font-normal placeholder:tracking-normal placeholder:text-dim focus:border-ink"
          />
          <button
            type="submit"
            disabled={loadingCode || !codeInput.trim()}
            className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-ink px-3.5 font-display text-[11px] font-medium text-white transition-transform active:scale-95 disabled:opacity-45"
          >
            {loadingCode ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.4} />
            ) : (
              <Download className="h-3.5 w-3.5" strokeWidth={2.3} />
            )}
            Charger
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className={cn("rounded-2xl border border-edge bg-white p-3", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {activeCode ? (
          <div className="flex min-w-0 flex-1 items-center justify-between gap-2 rounded-xl bg-elev px-3 py-1.5">
            <div className="min-w-0">
              <p className="text-[9.5px] font-medium uppercase tracking-wider text-dim">
                Code du coupon
              </p>
              <p className="truncate font-display text-[12px] font-medium tracking-wider text-ink">
                {activeCode}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                onClick={() => void handleCopyCode()}
                className="inline-flex h-8 items-center gap-1 rounded-lg border border-edge bg-white px-2.5 font-display text-[10.5px] font-medium text-ink active:scale-95"
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5 text-win" strokeWidth={2.6} />
                ) : (
                  <Copy className="h-3.5 w-3.5 text-mist" strokeWidth={2.2} />
                )}
                {copied ? "Copié" : "Copier"}
              </button>
              <button
                type="button"
                onClick={() => void handleShareCode()}
                className="inline-flex h-8 items-center gap-1 rounded-lg bg-betclic-red px-2.5 font-display text-[10.5px] font-medium text-white active:scale-95"
              >
                <Share2 className="h-3.5 w-3.5" strokeWidth={2.3} />
                Partager
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => void handleGenerateCode()}
            disabled={saving || comboLegs.length === 0}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-elev px-3 font-display text-[10.5px] font-medium text-ink transition-colors hover:bg-edge/70 active:scale-95 disabled:opacity-50"
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-betclic-red" strokeWidth={2.4} />
            ) : (
              <Share2 className="h-3.5 w-3.5 text-betclic-red" strokeWidth={2.3} />
            )}
            Enregistrer / Code coupon
          </button>
        )}

        <button
          type="button"
          onClick={() => {
            triggerHaptic(user?.haptics, 6);
            setLoadOpen((o) => !o);
          }}
          className={cn(
            "inline-flex h-9 items-center gap-1.5 rounded-xl border px-3 font-display text-[10.5px] font-medium transition-colors active:scale-95",
            loadOpen
              ? "border-ink bg-ink text-white"
              : "border-edge bg-white text-mist hover:text-ink"
          )}
        >
          <Download className="h-3.5 w-3.5" strokeWidth={2.2} />
          Charger un code
        </button>
      </div>

      {loadOpen && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void applyLoadedCode(codeInput);
          }}
          className="mt-2.5 flex items-center gap-2 border-t border-edge/70 pt-2.5"
        >
          <input
            type="text"
            value={codeInput}
            onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
            placeholder="Code coupon (ex. BX-84K2)"
            maxLength={48}
            className="h-9.5 min-w-0 flex-1 rounded-xl border border-edge bg-elev/50 px-3 font-display text-[11px] font-medium tracking-wider text-ink uppercase outline-none placeholder:font-sans placeholder:font-normal placeholder:tracking-normal placeholder:text-dim focus:border-ink focus:bg-white"
          />
          <button
            type="submit"
            disabled={loadingCode || !codeInput.trim()}
            className="inline-flex h-9.5 shrink-0 items-center gap-1 rounded-xl bg-betclic-red px-3 font-display text-[10.5px] font-medium text-white active:scale-95 disabled:opacity-45"
          >
            {loadingCode ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.4} />
            ) : (
              "Importer"
            )}
          </button>
        </form>
      )}
    </div>
  );
}
