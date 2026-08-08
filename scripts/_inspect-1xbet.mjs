/**
 * Inspection DOM 1xBet FR — script Node brut (.mjs, sans esbuild/tsx)
 * pour éviter l'injection __name dans page.evaluate.
 * Lancez : node scripts/_inspect-1xbet.mjs
 */
import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
  locale: "fr-FR",
});
const page = await context.newPage();
await page.goto("https://1xbet.com/fr/live/football/", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(12000);
await page.evaluate(() => window.scrollBy(0, 800));

console.log("--- plus petit bloc contenant Lokomotiv/Akron ---");
const smallest = await page.evaluate(() => {
  const all = Array.from(document.querySelectorAll("div,span,a"));
  const withPair = all.filter((el) => {
    const t = (el.innerText || "").replace(/\s+/g, " ").trim();
    const l = t.toLowerCase();
    return l.includes("lokomotiv") && l.includes("akron");
  });
  withPair.sort((x, y) => (x.innerText || "").length - (y.innerText || "").length);
  return withPair.slice(0, 8).map((el) => ({
    tag: el.tagName,
    cls: typeof el.className === "string" ? el.className.slice(0, 80) : "",
    w: Math.round(el.getBoundingClientRect().width),
    h: Math.round(el.getBoundingClientRect().height),
    txt: (el.innerText || "").replace(/\s+/g, " ").trim().slice(0, 130),
  }));
});
for (const i of smallest) console.log(JSON.stringify(i, null, 1));

console.log("--- body innerText (lignes) ---");
const lines = await page.evaluate(() => (document.body.innerText || "").split(/\n/).slice(0, 70));
lines.forEach((l, i) => console.log(i, JSON.stringify(l)));

let sel = "div.dashboard-game-block__row, .c-events__item, .b1-pop";
let raw = await page.evaluate((s) => {
  return Array.from(document.querySelectorAll(s)).slice(0, 20).map((el) =>
    (el.innerText || "").replace(/\s+/g, " ").trim().slice(0, 120)
  );
}, sel);
console.log("--- SELECTOR MATCHES:", raw.length, "---");
raw.forEach((t, i) => console.log(i, JSON.stringify(t)));

sel = "div[class*='dashboard-game'], div[class*='c-events'], div[class*='game-block'], div[class*='event'], li[class*='event']";
raw = await page.evaluate((s) => {
  return Array.from(document.querySelectorAll(s)).slice(0, 20).map((el) => {
    const cls = typeof el.className === "string" ? el.className.slice(0, 60) : "";
    return el.tagName + "." + cls + " => " + (el.innerText || "").replace(/\s+/g, " ").trim().slice(0, 110);
  });
}, sel);
console.log("--- classes génériques ---");
raw.forEach((t, i) => console.log(i, JSON.stringify(t)));

await browser.close();
process.exit(0);