import { NextRequest, NextResponse } from "next/server";
import {
  getOfficialCurrencyForCountry,
  isValidCountryCode,
} from "@/lib/countries";

export const dynamic = "force-dynamic";

/**
 * GET /api/geo — Détection légère sans base de données du pays visiteur
 * à partir des en-têtes Edge (Vercel `x-vercel-ip-country` / Cloudflare `cf-ipcountry`).
 * Utilisé pour pré-sélectionner automatiquement le pays à l'inscription et la devise visiteur.
 */
export async function GET(req: NextRequest) {
  const candidates = [
    req.headers.get("x-vercel-ip-country"),
    req.headers.get("cf-ipcountry"),
    req.headers.get("x-country-code"),
  ];

  for (const raw of candidates) {
    if (raw && isValidCountryCode(raw)) {
      const countryCode = raw.trim().toUpperCase();
      return NextResponse.json(
        {
          detected: true,
          countryCode,
          currency: getOfficialCurrencyForCountry(countryCode),
        },
        {
          headers: {
            "Cache-Control": "private, max-age=300",
          },
        }
      );
    }
  }

  return NextResponse.json(
    {
      detected: false,
      countryCode: null,
      currency: null,
    },
    {
      headers: {
        "Cache-Control": "private, no-store",
      },
    }
  );
}
