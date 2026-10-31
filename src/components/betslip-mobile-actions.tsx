"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Bookmark, Copy, Download, Loader2, MoreVertical, Trash2, X } from "lucide-react";
import { api } from "@/lib/api";
import { normalizeCouponCode } from "@/lib/coupon-code";
import { validateLoadedCoupon } from "@/lib/coupon-load-validation";
import { useApp } from "@/components/providers";
import type { ComboSelection } from "@/components/combo-slip";

type Mode = "menu" | "load" | "saving" | "saved" | null;

export function BetslipMobileActions({ onClear }: { onClear: () => void }) {
  const { comboLegs, loadComboLegs, bettingLimits, bettingLimitsReady, toast } = useApp();
  const [mode, setMode] = useState<Mode>(null);
  const [code, setCode] = useState("");
  const [savedCode, setSavedCode] = useState("");
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!mode) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !loading && mode !== "saving") setMode(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, loading]);

  const close = () => {
    if (loading || mode === "saving") return;
    setMode(null);
    setError("");
  };
  const save = async () => {
    if (!comboLegs.length || mode === "saving") return;
    setMode("saving");
    try {
      const result = await api.saveCoupon([...comboLegs]);
      setSavedCode(result.code);
      setCopied(false);
      setMode("saved");
    } catch (err) {
      setMode(null);
      toast({ kind: "error", title: "Enregistrement impossible", description: err instanceof Error ? err.message : "Veuillez réessayer." });
    }
  };
  const load = async () => {
    const normalized = normalizeCouponCode(code);
    if (loading || !bettingLimitsReady) return;
    if (!normalized || normalized.length < 5) { setError("Saisissez un code de coupon valide."); return; }
    setLoading(true);
    setError("");
    try {
      const result = await api.loadCoupon(normalized);
      if (result.skippedClosedCount) {
        const names = (result.unavailable ?? []).map(x => `• ${x.title} (${x.reason})`).join("\n");
        if (!window.confirm(`${result.skippedClosedCount} sélection(s) commencée(s) ou indisponible(s) :\n${names}\n\nRetirer ces sélections du coupon chargé ?`)) return;
      }
      if (!result.legs.length) throw new Error("Aucune sélection disponible dans ce coupon.");
      const problem = validateLoadedCoupon(result.legs, bettingLimits.maxComboLegs);
      if (problem) throw new Error(problem);
      if (comboLegs.length && !window.confirm("Le coupon chargé remplacera les sélections actuelles. Continuer ?")) return;
      loadComboLegs(result.legs as ComboSelection[]);
      setCode("");
      setMode(null);
      toast({ kind: "success", title: `Coupon ${result.code} chargé`, description: `${result.legs.length} sélection(s) prête(s) à miser.` });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible de charger le coupon. Réessayez.");
    } finally { setLoading(false); }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(savedCode);
      setCopied(true);
    } catch {
      toast({ kind: "error", title: "Copie indisponible", description: "Sélectionnez le code pour le copier." });
    }
  };

  return <>
    <div className="flex shrink-0 items-center gap-1 lg:hidden">
      <button type="button" aria-label="Vider le Betslip" disabled={!comboLegs.length} onClick={onClear} className="grid h-9 w-9 place-items-center rounded-xl text-mist disabled:opacity-40 active:bg-elev"><Trash2 size={18} /></button>
      <button type="button" aria-label="Options du coupon" aria-haspopup="dialog" onClick={() => setMode("menu")} className="grid h-9 w-9 place-items-center rounded-xl text-ink active:bg-elev"><MoreVertical size={20} /></button>
    </div>
    {mode && typeof document !== "undefined" && createPortal(
      <div className="fixed inset-0 z-[100] flex items-end bg-black/50 lg:hidden" onClick={close}>
        <section role="dialog" aria-modal="true" aria-label={mode === "load" ? "Charger le coupon de pari" : mode === "saved" ? "Coupon enregistré" : "Coupon de pari"} onClick={e => e.stopPropagation()} className={mode === "saved" || mode === "saving" ? "mx-6 my-auto w-full rounded-2xl bg-white p-4" : "w-full rounded-t-[22px] bg-white px-4 pt-2.5 pb-[max(16px,env(safe-area-inset-bottom))]"}>
          {(mode === "menu" || mode === "load") && <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-edge" />}
          <div className="flex items-start justify-between gap-2">
            <div><h2 className="text-[14px] font-bold text-ink">{mode === "menu" ? "Coupon de pari" : mode === "load" ? "Charger le coupon de pari" : mode === "saving" ? "Enregistrement du coupon…" : "Coupon enregistré"}</h2>
              {mode === "load" && <p className="mt-1 text-[11px] text-mist">Retrouvez les sélections d’un coupon avec son code.</p>}
            </div>
            {mode !== "saving" && <button type="button" onClick={close} aria-label="Fermer" className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-elev text-mist"><X size={17} /></button>}
          </div>
          {mode === "menu" && <div className="mt-3">
            <button type="button" onClick={() => { setError(""); setMode("load"); }} className="flex min-h-11 w-full items-center gap-2.5 border-b border-edge px-2 text-left text-[11px] text-ink"><Download size={18} />Charger le coupon de pari</button>
            <button type="button" disabled={!comboLegs.length} onClick={() => void save()} className="flex min-h-11 w-full items-center gap-2.5 px-2 text-left text-[11px] text-ink disabled:opacity-40"><Bookmark size={18} />Enregistrer le coupon de pari</button>
          </div>}
          {mode === "load" && <form onSubmit={e => { e.preventDefault(); void load(); }} className="mt-4 space-y-3">
            <label htmlFor="mobile-coupon-code" className="block text-[11px] text-ink">Saisissez le code du coupon de pari</label>
            <input id="mobile-coupon-code" value={code} onChange={e => { setCode(e.target.value.toUpperCase()); setError(""); }} placeholder="Ex. D6M8A" maxLength={48} autoCapitalize="characters" autoComplete="off" className="h-[46px] w-full rounded-xl border border-edge bg-elev px-3 text-[12px] text-ink outline-none focus:border-ink" />
            {error && <p role="alert" className="text-[11px] text-betclic-red">{error}</p>}
            {!bettingLimitsReady && <p className="text-[11px] text-mist">Chargement des limites du coupon…</p>}
            <button type="submit" disabled={!code.trim() || loading || !bettingLimitsReady} className="flex h-11 w-full items-center justify-center rounded-xl bg-betclic-red text-[11px] text-white disabled:opacity-40">{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Charger"}</button>
          </form>}
          {mode === "saving" && <Loader2 className="mt-4 h-5 w-5 animate-spin text-betclic-red" />}
          {mode === "saved" && <div className="mt-2 space-y-3"><p className="text-[11px] text-mist">Copiez ce code pour retrouver votre coupon de pari.</p><p className="select-all rounded-xl bg-elev p-3 text-center text-[18px] tracking-widest text-ink">{savedCode}</p><button type="button" onClick={() => void copy()} className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-betclic-red text-[11px] text-white"><Copy size={14} />{copied ? "Code copié" : "Copier le code"}</button></div>}
        </section>
      </div>, document.body)}
  </>;
}
