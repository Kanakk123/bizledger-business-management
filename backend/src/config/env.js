import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const envPath = path.join(backendRoot, ".env");

// Keep backend settings independent of the process working directory. Existing
// environment variables (e.g. container or CI settings) take precedence.
dotenv.config({ path: envPath });

export { backendRoot };
