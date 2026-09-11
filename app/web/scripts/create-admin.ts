import "dotenv/config";
import { createInterface } from "node:readline";
import { createOrPromoteAdmin } from "../src/server/admin";
import { prisma } from "../src/server/db";

/**
 * docs/AUTH.md §3 — the only way an admin account is created (no self-serve registration
 * route exists for role=admin). Run directly against the target database, e.g. over SSH on
 * the production server or locally against a dev DB:
 *
 *   npm run admin:create -- --email admin@example.com
 *   npm run admin:create -- --email admin@example.com --password "a strong password"
 *
 * Password is prompted for interactively (input hidden, not echoed) when --password is
 * omitted, so it doesn't land in shell history or `ps` output for the common, by-hand case;
 * --password stays available for the scripted/CI case where that risk is already accepted for
 * other secrets passed the same way.
 */

function parseArgs(argv: string[]): { email?: string; password?: string } {
  const result: { email?: string; password?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--email") result.email = argv[++i];
    if (argv[i] === "--password") result.password = argv[++i];
  }
  return result;
}

/**
 * No built-in Node API masks terminal input; overriding the readline interface's internal
 * output writer to swallow echoed keystrokes is the standard workaround (no new dependency
 * for what's a rarely-run maintenance script) — same reasoning as every other "skip the
 * dependency, this is small enough to write directly" call in this project.
 */
function promptHidden(query: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const realWrite = process.stdout.write.bind(process.stdout);
    let masked = false;
    (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (stringToWrite: string) => {
      if (!masked) realWrite(stringToWrite);
    };
    rl.question(query, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
    masked = true;
  });
}

async function main() {
  const { email, password: passwordArg } = parseArgs(process.argv.slice(2));

  if (!email || !email.includes("@")) {
    console.error("Usage: npm run admin:create -- --email <email> [--password <password>]");
    process.exitCode = 1;
    return;
  }

  const password = passwordArg ?? (await promptHidden("Password (min 10 characters): "));
  if (password.length < 10) {
    // Same placeholder minimum as registration (src/app/register/actions.ts) — kept
    // consistent across every place a password is ever set, not a separately-tuned policy.
    console.error("Password must be at least 10 characters.");
    process.exitCode = 1;
    return;
  }

  const result = await createOrPromoteAdmin(email, password);
  switch (result.action) {
    case "created":
      console.log(`Created admin account ${result.email} (id ${result.userId}).`);
      break;
    case "promoted":
      console.log(`Promoted existing user ${result.email} (id ${result.userId}) to admin — their sessions were revoked.`);
      break;
    case "already_admin":
      console.log(`${result.email} (id ${result.userId}) is already an admin. Nothing to do.`);
      break;
  }
}

main()
  .catch((err) => {
    console.error("Failed to create admin account:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
