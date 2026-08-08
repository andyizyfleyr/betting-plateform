import { config } from "dotenv";
config({ path: ".env.local" });
import { runScrape } from "../src/lib/scraper";
import { hasActiveScraped } from "../src/lib/scraper";
import { matches } from "../src/db/schema";
import { db } from "../src/db";
import { eq } from "drizzle-orm";

/**
 * Scraping autonome (lancement CLI ou cron) :
 *   npx tsx scripts/scrape.ts --site=1xbet --limit=20
 *   SCRAPE_URI=/chemin/fixture.html npx tsx scripts/scrape.ts --dryRun
 *
 * Option --purge : nettoie toutes les lignes scrapées avant le run
 * (utile si la cible wholesale a changé de structure).
 */
const args = process.argv.slice(2);
const opt = (name: string) => {
  const a = args.find((a) => a.startsWith(`--${name}=`));
  return a ? a.split("=")[1] : undefined;
};

async function main() {
  if (args.includes("--purge")) {
    await db.delete(matches).where(eq(matches.source, "scraped"));
    console.log("PURGE: lignes scraped supprimées");
  }

  const result = await runScrape({
    site: opt("site") ?? process.env.SCRAPE_SITE,
    url: opt("url") ?? process.env.SCRAPE_URI,
    league: opt("league"),
    limit: opt("limit") ? Number(opt("limit")) : undefined,
    dryRun: args.includes("--dryRun"),
  });

  console.log(`[${result.site}] ${result.url}`);
  console.log(`lignes détectées : ${result.found} — importées : ${result.rows.length}`);
  console.log(`insert : ${result.inserted} — update : ${result.updated} — skipped : ${result.skipped}`);
  console.log(`durée : ${result.durationMs} ms`);

  if (result.finalUrl && result.finalUrl !== result.url) console.log(`URL réelle : ${result.finalUrl}`);
  console.log(`titre page : ${result.title ?? "(vide)"}`);
  if (result.blocked) console.log("⚠️ PAGE BLOQUÉE (défi anti-bot détecté)");
  if (result.textSnippet) console.log(`extrait texte : ${JSON.stringify(result.textSnippet)}`);

  if (result.error) console.error("erreur :", result.error);
  for (const r of result.rows.slice(0, 10)) {
    const score = r.homeScore != null ? `${r.homeScore}-${r.awayScore}` : "—";
    const odds = `${r.oddsHome} / ${r.oddsDraw ?? "-"} / ${r.oddsAway}`;
    console.log(`  ${r.status.padEnd(8)} ${r.homeTeam} vs ${r.awayTeam}  ${score}  @ ${odds}`);
  }

  const active = await hasActiveScraped();
  console.log(active ? ">> données scraped actives — le moteur virtuel est neutralisé" : ">> aucune donnée scraped active");
  process.exit(0);
}

main().catch((e) => {
  console.error("ÉCHEC :", e);
  process.exit(1);
});