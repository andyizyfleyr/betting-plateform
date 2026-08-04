import { db } from "../src/db";
import { ensureSeeded } from "../src/db/seed";

async function main() {
  await ensureSeeded();
  console.log("Seed OK");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  });