import { NextResponse } from "next/server";

export type DbErrorCode =
  | "MISSING_DATABASE_URL"
  | "DB_QUOTA_EXCEEDED"
  | "DB_UNREACHABLE"
  | "DB_TIMEOUT"
  | "INSUFFICIENT_BALANCE"
  | "SERVER_ERROR";

export interface ClassifiedServerError {
  code: DbErrorCode;
  message: string;
  detail: string | null;
  status: number;
}

function sanitizeDiagnosticLine(input: string): string {
  return input
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "[url-masquee]")
    .replace(/password=\S+/gi, "password=***")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

/**
 * Extrait récursivement toutes les causes sous-jacentes (`DrizzleQueryError.cause`,
 * `AggregateError.errors[]`, codes PostgreSQL `code` / `detail` / `hint`).
 */
export function extractErrorChain(err: unknown): {
  combinedText: string;
  rootReason: string | null;
} {
  const parts: string[] = [];
  const leafMessages: string[] = [];
  const visited = new Set<unknown>();

  const walk = (node: unknown, depth: number) => {
    if (node == null || depth > 6 || visited.has(node)) return;
    if (typeof node === "object") visited.add(node);

    if (typeof node === "string") {
      if (node.trim()) {
        parts.push(node);
        leafMessages.push(node);
      }
      return;
    }

    if (typeof node === "object") {
      const rec = node as Record<string, unknown>;
      const name = typeof rec.name === "string" ? rec.name : "";
      const msg = typeof rec.message === "string" ? rec.message : "";
      const code = typeof rec.code === "string" ? rec.code : "";
      const detail = typeof rec.detail === "string" ? rec.detail : "";
      const hint = typeof rec.hint === "string" ? rec.hint : "";

      if (name || msg || code) {
        parts.push(`${name} ${code} ${msg} ${detail} ${hint}`);
      }

      const isDrizzleWrapper = /^Failed query:/i.test(msg);
      if (!isDrizzleWrapper && (msg.trim() || code.trim())) {
        const cleanLeaf = [code ? `[${code}]` : "", msg.trim(), detail.trim()]
          .filter(Boolean)
          .join(" ");
        if (cleanLeaf) leafMessages.push(cleanLeaf);
      }

      if (Array.isArray(rec.errors)) {
        for (const sub of rec.errors) walk(sub, depth + 1);
      }
      if ("cause" in rec && rec.cause != null) {
        walk(rec.cause, depth + 1);
      }
    }
  };

  walk(err, 0);

  const combinedText = parts.join(" | ");
  const bestLeaf =
    leafMessages[leafMessages.length - 1] ??
    (err instanceof Error && !/^Failed query:/i.test(err.message)
      ? err.message
      : null);

  return {
    combinedText,
    rootReason: bestLeaf ? sanitizeDiagnosticLine(bestLeaf) : null,
  };
}

export function classifyServerError(err: unknown): ClassifiedServerError {
  const { combinedText, rootReason } = extractErrorChain(err);
  const lower = combinedText.toLowerCase();

  if (lower.includes("database_url is required")) {
    return {
      code: "MISSING_DATABASE_URL",
      message:
        "Aucune base PostgreSQL n'est connectée à ce projet Vercel (variable DATABASE_URL absente). Allez dans Vercel → be-plateform → Storage → Connect Database puis redéployez.",
      detail: rootReason,
      status: 503,
    };
  }

  if (
    /\[53000\]|\b53000\b|compute time quota|network transfer|quota.*exceeded|exceeded.*(quota|limit|compute|transfer|size|storage)|project size limit|data transfer/i.test(
      lower
    )
  ) {
    return {
      code: "DB_QUOTA_EXCEEDED",
      message:
        "Le quota mensuel de votre base PostgreSQL (Neon — ex. 5 Go Network Transfer du plan Free) est atteint. Passez le projet Neon en plan supérieur pour conserver vos données ou rattachez un nouveau projet Neon dans Vercel → Storage.",
      detail: rootReason,
      status: 503,
    };
  }

  if (
    /enotfound|getaddrinfo|endpoint\b.*?\b(disabled|not found|does not exist|suspended|inactive)|project\b.*?\bnot found|branch\b.*?\bnot found|tenant or user not found|password authentication failed|authentication failed|caller is not authorized|database .* does not exist|role .* does not exist/i.test(
      lower
    )
  ) {
    return {
      code: "DB_UNREACHABLE",
      message: `La base PostgreSQL liée à DATABASE_URL est désactivée ou a été supprimée avec l'ancien projet doublon${
        rootReason ? ` (${rootReason})` : ""
      }. Dans Vercel → be-plateform → Storage, connectez une base PostgreSQL active puis redéployez.`,
      detail: rootReason,
      status: 503,
    };
  }

  if (
    /app_user_balance_nonneg_chk|(\b23514\b.*balance)/i.test(lower)
  ) {
    return {
      code: "INSUFFICIENT_BALANCE",
      message: "Solde disponible insuffisant pour effectuer cette opération.",
      detail: rootReason,
      status: 400,
    };
  }

  if (
    /\[55p03\]|\b55p03\b|\[40p01\]|\b40p01\b|lock timeout|canceling statement due to lock timeout|deadlock detected/i.test(
      lower
    )
  ) {
    return {
      code: "DB_TIMEOUT",
      message:
        "Forte affluence momentanée sur ce marché — veuillez réessayer dans un instant.",
      detail: rootReason,
      status: 503,
    };
  }

  if (
    /timeout|etimedout|econnrefused|econnreset|connection terminated|server closed the connection|57p01/i.test(
      lower
    )
  ) {
    return {
      code: "DB_TIMEOUT",
      message: `Connexion à la base PostgreSQL interrompue${
        rootReason ? ` (${rootReason})` : ""
      } — appuyez sur Réessayer ou vérifiez l'onglet Storage sur Vercel.`,
      detail: rootReason,
      status: 503,
    };
  }

  return {
    code: "SERVER_ERROR",
    message: rootReason
      ? `Erreur serveur (${rootReason}).`
      : "Service temporairement indisponible — veuillez réessayer.",
    detail: rootReason,
    status: 503,
  };
}

export function formatServerErrorResponse(
  err: unknown,
  context: string
): NextResponse {
  console.error(`[${context}]`, err);
  const classified = classifyServerError(err);
  return NextResponse.json(
    {
      ok: false,
      error: classified.message,
      detail: classified.detail,
      code: classified.code,
    },
    { status: classified.status }
  );
}
