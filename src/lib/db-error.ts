import { NextResponse } from "next/server";

export type DbErrorCode =
  | "MISSING_DATABASE_URL"
  | "DB_QUOTA_EXCEEDED"
  | "DB_UNREACHABLE"
  | "DB_TIMEOUT"
  | "SERVER_ERROR";

export interface ClassifiedServerError {
  code: DbErrorCode;
  message: string;
  status: number;
}

export function classifyServerError(err: unknown): ClassifiedServerError {
  const raw =
    err instanceof Error
      ? `${err.name}: ${err.message} ${"cause" in err && err.cause instanceof Error ? err.cause.message : ""}`
      : String(err ?? "");
  const lower = raw.toLowerCase();

  if (lower.includes("database_url is required") || lower.includes("database_url")) {
    return {
      code: "MISSING_DATABASE_URL",
      message:
        "Base de données non configurée (DATABASE_URL manquante dans les variables d'environnement Vercel du projet be-plateform).",
      status: 503,
    };
  }

  if (
    lower.includes("compute time quota") ||
    lower.includes("quota exceeded") ||
    lower.includes("data transfer quota") ||
    lower.includes("project size limit")
  ) {
    return {
      code: "DB_QUOTA_EXCEEDED",
      message:
        "Quota gratuit de la base PostgreSQL (Neon) atteint — vérifiez l'onglet Storage sur Vercel.",
      status: 503,
    };
  }

  if (
    lower.includes("enotfound") ||
    lower.includes("endpoint is disabled") ||
    lower.includes("endpoint not found") ||
    lower.includes("password authentication failed") ||
    (lower.includes("database ") && lower.includes(" does not exist")) ||
    lower.includes("project not found")
  ) {
    return {
      code: "DB_UNREACHABLE",
      message:
        "Base PostgreSQL introuvable ou désactivée (possiblement supprimée avec le projet doublon) — reconnectez une base Storage au projet be-plateform sur Vercel.",
      status: 503,
    };
  }

  if (
    lower.includes("timeout") ||
    lower.includes("etimedout") ||
    lower.includes("econnrefused") ||
    lower.includes("econnreset") ||
    lower.includes("connection terminated") ||
    lower.includes("57p01")
  ) {
    return {
      code: "DB_TIMEOUT",
      message:
        "La base de données se réveille ou met trop de temps à répondre — veuillez réessayer dans quelques secondes.",
      status: 503,
    };
  }

  return {
    code: "SERVER_ERROR",
    message: "Service temporairement indisponible — veuillez réessayer.",
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
      code: classified.code,
    },
    { status: classified.status }
  );
}
