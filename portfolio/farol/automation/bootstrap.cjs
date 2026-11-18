// Install only this repository's demo credentials and workflow in its dedicated n8n volume.
const { writeFileSync, mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { execFileSync } = require("node:child_process");
const folder = mkdtempSync(join(tmpdir(), "farol-init-"));
try {
  const credentials = [
    ["farol-inbound", "Farol inbound", "X-Farol-Token", process.env.REVIEW_WEBHOOK_TOKEN],
    ["farol-inbox", "Farol inbox", "X-Inbox-Token", process.env.INBOX_TOKEN],
  ].map(([id, name, header, value]) => ({
    id,
    name,
    type: "httpHeaderAuth",
    data: { name: header, value },
  }));
  const file = join(folder, "credentials.json");
  writeFileSync(file, JSON.stringify(credentials), { mode: 0o600 });
  for (const command of [
    ["import:credentials", "--input=" + file],
    ["import:workflow", "--input=" + join(__dirname, "review.n8n.json")],
    ["publish:workflow", "--id=farolReview001"],
  ])
    execFileSync("n8n", command, { stdio: "inherit" });
} finally {
  rmSync(folder, { recursive: true, force: true });
}
