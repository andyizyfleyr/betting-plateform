"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Copy, Download, Eye, EyeOff, Share2, X } from "lucide-react";
import type { ClientBet } from "@/lib/api";
import { sortComboBetLegsChronologically } from "@/lib/combo-math";
import { cn, eur, formatOdds, formatPlacedAt } from "@/lib/format";

interface Props {
  bet: ClientBet | null;
  onClose: () => void;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function truncateText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let out = text;
  while (out.length > 3 && ctx.measureText(`${out}…`).width > maxWidth) {
    out = out.slice(0, -1);
  }
  return `${out}…`;
}

function drawTicketCanvas(canvas: HTMLCanvasElement, bet: ClientBet, hideAmounts: boolean) {
  const W = 1080;
  const legs =
    bet.kind === "combo" && bet.legs
      ? sortComboBetLegsChronologically(bet.legs)
      : [];
  const visibleLegs = legs.slice(0, 6);
  const extraLegs = Math.max(0, legs.length - visibleLegs.length);
  const H = bet.kind === "combo" ? Math.max(1220, 880 + visibleLegs.length * 92) : 1140;

  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  // Fond sombre élégant avec halo cramoisi / émeraude selon le statut
  const bgGrad = ctx.createLinearGradient(0, 0, W, H);
  bgGrad.addColorStop(0, "#0f1116");
  bgGrad.addColorStop(0.55, "#151923");
  bgGrad.addColorStop(1, "#0b0d12");
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, W, H);

  const isWon = bet.status === "won";
  const isCashed = bet.status === "cashed";
  const isVoid = bet.status === "void";
  const accentColor = isWon ? "#10b981" : isCashed ? "#0ea5e9" : isVoid ? "#d97706" : "#e11d48";

  const glow = ctx.createRadialGradient(W * 0.5, 160, 40, W * 0.5, 160, 560);
  glow.addColorStop(0, isWon ? "rgba(16,185,129,0.26)" : "rgba(225,29,72,0.28)");
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // Carte principale du coupon
  const cardX = 72;
  const cardY = 84;
  const cardW = W - 144;
  const cardH = H - 168;

  ctx.save();
  roundRect(ctx, cardX, cardY, cardW, cardH, 44);
  ctx.fillStyle = "#ffffff";
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = 48;
  ctx.shadowOffsetY = 20;
  ctx.fill();
  ctx.restore();

  // Bandeau supérieur rouge signature
  ctx.save();
  roundRect(ctx, cardX, cardY, cardW, 148, 44);
  ctx.clip();
  const topGrad = ctx.createLinearGradient(cardX, cardY, cardX + cardW, cardY + 148);
  topGrad.addColorStop(0, isWon ? "#059669" : "#d91438");
  topGrad.addColorStop(1, isWon ? "#10b981" : "#9f1239");
  ctx.fillStyle = topGrad;
  ctx.fillRect(cardX, cardY, cardW, 148);
  ctx.restore();

  // Marque & référence
  ctx.fillStyle = "#ffffff";
  ctx.font = "900 38px system-ui, -apple-system, sans-serif";
  ctx.fillText("PULSE BET", cardX + 52, cardY + 78);

  ctx.fillStyle = "rgba(255,255,255,0.82)";
  ctx.font = "600 22px system-ui, -apple-system, sans-serif";
  const kindTitle =
    bet.kind === "combo"
      ? `COUPON COMBINÉ · ${legs.length} ÉVÉNEMENTS`
      : bet.kind === "prediction"
        ? "COUPON PRÉDICTION · COTES FIXES"
        : "COUPON DE PARI · COTES FIXES";
  ctx.fillText(kindTitle, cardX + 52, cardY + 114);

  // Badge de statut en haut à droite
  const statusText = isWon
    ? "GAGNÉ ✓"
    : isCashed
      ? "COUPON VENDU"
      : isVoid
        ? "REMBOURSÉ"
        : bet.status === "lost"
          ? "PERDU"
          : "EN COURS";
  ctx.font = "800 24px system-ui, -apple-system, sans-serif";
  const badgeW = ctx.measureText(statusText).width + 52;
  roundRect(ctx, cardX + cardW - badgeW - 48, cardY + 46, badgeW, 56, 28);
  ctx.fillStyle = "rgba(255,255,255,0.22)";
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.fillText(statusText, cardX + cardW - badgeW - 22, cardY + 82);

  // Corps du ticket : événement(s) & sélection(s)
  let y = cardY + 216;

  if (bet.kind === "combo" && visibleLegs.length > 0) {
    for (const leg of visibleLegs) {
      roundRect(ctx, cardX + 48, y, cardW - 96, 78, 20);
      ctx.fillStyle = "#f4f5f8";
      ctx.fill();

      const dotColor =
        leg.status === "won"
          ? "#10b981"
          : leg.status === "lost"
            ? "#ef4444"
            : leg.status === "void"
              ? "#d97706"
              : "#64748b";
      ctx.beginPath();
      ctx.arc(cardX + 78, y + 39, 9, 0, Math.PI * 2);
      ctx.fillStyle = dotColor;
      ctx.fill();

      ctx.fillStyle = "#0f172a";
      ctx.font = "700 24px system-ui, -apple-system, sans-serif";
      const matchTxt = truncateText(ctx, leg.title, cardW - 310);
      ctx.fillText(matchTxt, cardX + 102, y + 34);

      ctx.fillStyle = "#64748b";
      ctx.font = "600 20px system-ui, -apple-system, sans-serif";
      const selTxt = truncateText(ctx, leg.selectionLabel, cardW - 310);
      ctx.fillText(selTxt, cardX + 102, y + 62);

      // Cote individuelle
      const oddStr = formatOdds(leg.odds);
      ctx.font = "800 25px system-ui, -apple-system, sans-serif";
      const oddW = ctx.measureText(oddStr).width;
      ctx.fillStyle = "#d91438";
      ctx.fillText(oddStr, cardX + cardW - 76 - oddW, y + 48);

      y += 90;
    }

    if (extraLegs > 0) {
      ctx.fillStyle = "#64748b";
      ctx.font = "600 22px system-ui, -apple-system, sans-serif";
      ctx.fillText(`+ ${extraLegs} autre(s) sélection(s) sur ce ticket`, cardX + 54, y + 26);
      y += 44;
    }
  } else {
    // Pari simple ou prédiction
    ctx.fillStyle = "#64748b";
    ctx.font = "700 23px system-ui, -apple-system, sans-serif";
    ctx.fillText(
      `${bet.league.toUpperCase()} · ${formatPlacedAt(bet.placedAt).toUpperCase()}`,
      cardX + 52,
      y
    );
    y += 54;

    const eventTitle =
      bet.kind === "prediction"
        ? (bet.question ?? "Prédiction")
        : `${bet.homeTeam} – ${bet.awayTeam}`;

    ctx.fillStyle = "#0f172a";
    ctx.font = "800 40px system-ui, -apple-system, sans-serif";
    const words = eventTitle.split(" ");
    let line = "";
    let linesDrawn = 0;
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (ctx.measureText(test).width > cardW - 104 && line) {
        ctx.fillText(line, cardX + 52, y);
        line = w;
        y += 48;
        linesDrawn += 1;
        if (linesDrawn >= 2) break;
      } else {
        line = test;
      }
    }
    if (line && linesDrawn < 3) {
      ctx.fillText(truncateText(ctx, line, cardW - 104), cardX + 52, y);
      y += 56;
    }

    // Boîte sélection
    y += 16;
    roundRect(ctx, cardX + 48, y, cardW - 96, 112, 26);
    ctx.fillStyle = "#f4f5f8";
    ctx.fill();

    ctx.fillStyle = "#64748b";
    ctx.font = "600 22px system-ui, -apple-system, sans-serif";
    ctx.fillText("SÉLECTION RETENUE", cardX + 80, y + 42);

    ctx.fillStyle = "#0f172a";
    ctx.font = "800 32px system-ui, -apple-system, sans-serif";
    ctx.fillText(truncateText(ctx, bet.selectionLabel, cardW - 280), cardX + 80, y + 84);

    y += 148;
  }

  // Ligne pointillée avec encoches de ticket sur les bords
  const perfY = cardY + cardH - 290;
  ctx.fillStyle = "#12151e";
  ctx.beginPath();
  ctx.arc(cardX, perfY, 22, 0, Math.PI * 2);
  ctx.arc(cardX + cardW, perfY, 22, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.setLineDash([12, 12]);
  ctx.strokeStyle = "#cbd5e1";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cardX + 36, perfY);
  ctx.lineTo(cardX + cardW - 36, perfY);
  ctx.stroke();
  ctx.restore();

  // Bloc récapitulatif bas : Cote Totale + Mise / Gain (ou Mode Multiplicateur)
  const bottomY = perfY + 54;

  // Cote totale
  ctx.fillStyle = "#64748b";
  ctx.font = "700 22px system-ui, -apple-system, sans-serif";
  ctx.fillText("COTE TOTALE", cardX + 52, bottomY);

  ctx.fillStyle = accentColor;
  ctx.font = "900 62px system-ui, -apple-system, sans-serif";
  const totalOddsText = `×${formatOdds(bet.odds)}`;
  ctx.fillText(totalOddsText, cardX + 52, bottomY + 68);

  if (bet.boostPct && bet.boostPct > 0) {
    ctx.fillStyle = "#059669";
    ctx.font = "800 22px system-ui, -apple-system, sans-serif";
    ctx.fillText(`+${bet.boostPct}% BONUS COMBINÉ INCLUS`, cardX + 52, bottomY + 104);
  }

  // Côté droit : Montants ou Mode Cote seule
  const rightX = cardX + cardW - 52;
  ctx.textAlign = "right";

  if (hideAmounts) {
    ctx.fillStyle = "#64748b";
    ctx.font = "700 22px system-ui, -apple-system, sans-serif";
    ctx.fillText("MULTIPLICATEUR", rightX, bottomY);

    ctx.fillStyle = "#0f172a";
    ctx.font = "900 54px system-ui, -apple-system, sans-serif";
    ctx.fillText(`${formatOdds(bet.odds)}x`, rightX, bottomY + 66);

    ctx.fillStyle = "#94a3b8";
    ctx.font = "600 20px system-ui, -apple-system, sans-serif";
    ctx.fillText("Montants masqués", rightX, bottomY + 102);
  } else {
    const winLabel = isWon
      ? "GAIN REMPORTÉ"
      : isCashed
        ? "COUPON VENDU"
        : isVoid
          ? "MISE REMBOURSÉE"
          : "GAIN POTENTIEL";
    const winAmount = isCashed
      ? (bet.cashOutAmount ?? 0)
      : isVoid
        ? bet.stake
        : bet.potentialWin;

    ctx.fillStyle = "#64748b";
    ctx.font = "700 22px system-ui, -apple-system, sans-serif";
    ctx.fillText(winLabel, rightX, bottomY);

    ctx.fillStyle = isWon ? "#059669" : "#0f172a";
    ctx.font = "900 56px system-ui, -apple-system, sans-serif";
    ctx.fillText(eur(winAmount), rightX, bottomY + 66);

    ctx.fillStyle = "#64748b";
    ctx.font = "600 22px system-ui, -apple-system, sans-serif";
    ctx.fillText(`Mise engagée : ${eur(bet.stake)}`, rightX, bottomY + 104);
  }

  // Pied de ticket
  ctx.textAlign = "left";
  ctx.fillStyle = "#94a3b8";
  ctx.font = "600 20px system-ui, -apple-system, sans-serif";
  ctx.fillText(
    `Réf. #PB-${String(bet.id).padStart(4, "0")} · ${formatPlacedAt(bet.placedAt)}`,
    cardX + 52,
    cardY + cardH - 36
  );
  ctx.textAlign = "right";
  ctx.fillText("Cotes fixes garanties", rightX, cardY + cardH - 36);
  ctx.textAlign = "left";
}

export function ShareTicketModal({ bet, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hideAmounts, setHideAmounts] = useState(false);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!bet) return;
    const canvas = canvasRef.current ?? document.createElement("canvas");
    canvasRef.current = canvas;
    drawTicketCanvas(canvas, bet, hideAmounts);
    setDataUrl(canvas.toDataURL("image/png"));
  }, [bet, hideAmounts]);

  if (!bet) return null;

  const shareText = (() => {
    const title =
      bet.kind === "combo"
        ? `Combiné ${bet.legs?.length ?? 2} sélections`
        : bet.kind === "prediction"
          ? (bet.question ?? "Prédiction")
          : `${bet.homeTeam} – ${bet.awayTeam} (${bet.selectionLabel})`;
    const statusLabel =
      bet.status === "won"
        ? "✅ GAGNÉ"
        : bet.status === "cashed"
          ? "💰 COUPON VENDU"
          : bet.status === "void"
            ? "↺ REMBOURSÉ"
            : "🔥 EN COURS";
    const gainPart = hideAmounts
      ? `Cote ×${formatOdds(bet.odds)}`
      : `Cote ×${formatOdds(bet.odds)} → ${eur(bet.status === "cashed" ? (bet.cashOutAmount ?? 0) : bet.status === "void" ? bet.stake : bet.potentialWin)}`;
    return `${statusLabel} sur Pulse Bet !\n${title}\n${gainPart}`;
  })();

  const shareNative = async () => {
    try {
      const canvas = canvasRef.current;
      if (canvas && typeof navigator !== "undefined" && navigator.share) {
        const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/png"));
        if (blob) {
          const file = new File([blob], `ticket-pulsebet-${bet.id}.png`, { type: "image/png" });
          if (!navigator.canShare || navigator.canShare({ files: [file] })) {
            await navigator.share({
              title: "Mon ticket Pulse Bet",
              text: shareText,
              files: [file],
            });
            return;
          }
        }
        await navigator.share({ title: "Mon ticket Pulse Bet", text: shareText });
        return;
      }
      // Repli téléchargement direct
      downloadImage();
    } catch {
      /* fermeture volontaire du menu natif */
    }
  };

  const downloadImage = () => {
    if (!dataUrl) return;
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `ticket-pulsebet-${bet.id}.png`;
    a.click();
  };

  const shareWhatsApp = () => {
    const url = `https://wa.me/?text=${encodeURIComponent(shareText)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const copySummary = async () => {
    try {
      await navigator.clipboard.writeText(shareText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* silencieux */
    }
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[80]">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="absolute inset-0 bg-black/55 backdrop-blur-[2px]"
        />
        <motion.div
          initial={{ y: "100%" }}
          animate={{ y: 0 }}
          exit={{ y: "100%" }}
          transition={{ type: "spring", stiffness: 380, damping: 36 }}
          className="absolute inset-x-0 bottom-0 mx-auto flex max-h-[90dvh] w-full max-w-[440px] flex-col rounded-t-3xl border-t border-edge bg-surface shadow-2xl lg:inset-0 lg:m-auto lg:h-fit lg:max-h-[86dvh] lg:max-w-[500px] lg:rounded-3xl lg:border"
        >
          <div className="flex shrink-0 items-center justify-between border-b border-edge px-4 py-3">
            <div>
              <h2 className="font-display text-[16px] font-bold text-ink">
                Partager mon coupon
              </h2>
              <p className="text-[11px] text-dim">Carte haute définition prête à partager</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="grid h-8 w-8 place-items-center rounded-full bg-elev text-mist active:scale-95"
              aria-label="Fermer"
            >
              <X className="h-4 w-4" strokeWidth={2.2} />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-3">
            {/* Aperçu visuel du ticket généré */}
            <div className="overflow-hidden rounded-2xl border border-edge bg-[#0f1116] p-2 shadow-sm">
              {dataUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={dataUrl}
                  alt="Aperçu du ticket"
                  className="mx-auto max-h-[340px] w-auto rounded-xl object-contain"
                />
              )}
            </div>

            {/* Option confidentialité des montants */}
            <button
              type="button"
              onClick={() => setHideAmounts((s) => !s)}
              className="mt-3 flex w-full items-center justify-between rounded-xl border border-edge bg-elev/65 px-3.5 py-2.5 text-left"
            >
              <div className="flex items-center gap-2">
                {hideAmounts ? (
                  <EyeOff className="h-4 w-4 text-betclic-red" strokeWidth={2.1} />
                ) : (
                  <Eye className="h-4 w-4 text-ink" strokeWidth={2.1} />
                )}
                <span className="text-[12.5px] font-semibold text-ink">
                  Masquer ma mise et mes montants (€)
                </span>
              </div>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 font-display text-[10px] font-bold",
                  hideAmounts ? "bg-betclic-red text-white" : "bg-white text-dim"
                )}
              >
                {hideAmounts ? "Activé" : "Désactivé"}
              </span>
            </button>

            {/* Boutons d'action mobile */}
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={shareNative}
                className="col-span-2 flex h-11 items-center justify-center gap-2 rounded-2xl bg-betclic-red font-display text-[13.5px] font-bold text-white active:scale-[0.99]"
              >
                <Share2 className="h-4 w-4" strokeWidth={2.3} />
                Partager l&apos;image du ticket
              </button>

              <button
                type="button"
                onClick={shareWhatsApp}
                className="flex h-10 items-center justify-center gap-1.5 rounded-xl bg-[#25D366]/14 font-display text-[12px] font-bold text-[#128C7E] active:scale-[0.98]"
              >
                WhatsApp
              </button>

              <button
                type="button"
                onClick={downloadImage}
                className="flex h-10 items-center justify-center gap-1.5 rounded-xl border border-edge bg-white font-display text-[12px] font-bold text-ink active:scale-[0.98]"
              >
                <Download className="h-3.5 w-3.5" strokeWidth={2.2} />
                Télécharger PNG
              </button>
            </div>

            <button
              type="button"
              onClick={copySummary}
              className="mt-2 flex h-9 w-full items-center justify-center gap-1.5 rounded-xl bg-elev font-display text-[11.5px] font-semibold text-mist active:bg-edge"
            >
              {copied ? (
                <>
                  <Check className="h-3.5 w-3.5 text-win" strokeWidth={2.5} />
                  Résumé copié !
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" strokeWidth={2.1} />
                  Copier le texte du ticket
                </>
              )}
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
