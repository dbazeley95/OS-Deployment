#!/usr/bin/env node
// Computes a technician's salted+peppered password hash the same way the
// Worker verifies it (worker/src/lib/auth.ts), and prints the SQL to insert
// or update that technician. There's no HTTP endpoint for this on purpose -
// self-service account creation would be a hole in the auth boundary that
// gates OS reinstalls.
//
// Usage: PASSWORD_PEPPER=<the same secret set via `wrangler secret put`> \
//        node scripts/add-technician.mjs <username> <password>
//
// Then run the printed SQL, e.g.:
//   npx wrangler d1 execute os-deployment --remote --command "<printed SQL>"

import { createHmac, randomBytes } from "node:crypto";

const [, , username, password] = process.argv;
const pepper = process.env.PASSWORD_PEPPER;

if (!username || !password) {
  console.error("Usage: PASSWORD_PEPPER=<pepper> node scripts/add-technician.mjs <username> <password>");
  process.exit(1);
}
if (!pepper) {
  console.error("Set PASSWORD_PEPPER to the same value used for the Worker's PASSWORD_PEPPER secret.");
  process.exit(1);
}

const salt = randomBytes(16).toString("hex");
const hash = createHmac("sha256", pepper).update(`technician-password:${salt}:${password}`).digest("hex");

const sql = `INSERT INTO technicians (username, password_hash, salt) VALUES ('${username}', '${hash}', '${salt}') ON CONFLICT(username) DO UPDATE SET password_hash = excluded.password_hash, salt = excluded.salt;`;

console.log(sql);
