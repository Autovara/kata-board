import fs from "node:fs";
import path from "node:path";

import { loadBoardStatus } from "../server/status.mjs";

const outputPath = path.resolve(process.argv[2] || "public/status.json");

async function main() {
  const payload = await loadBoardStatus(process.env);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
  console.log(
    `exported ${payload.lanes?.length || 0} lane(s) to ${path.relative(process.cwd(), outputPath)}`
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "failed to export status");
  process.exit(1);
});
