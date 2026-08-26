import { closePool, loadEnvFile } from "../src/db/pool.js";
import { ensureAuthSchema } from "../src/auth/index.js";

loadEnvFile();
await ensureAuthSchema();
console.log("Auth schema applied (app_user, app_session, app_auth_token).");
await closePool();
