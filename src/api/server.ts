import { createApiApp } from "./app.js";
import { getApiConfig } from "./config.js";
import { connectDatabase } from "./database.js";

const config = getApiConfig();
const database = await connectDatabase(config.mongoUri);
const server = createApiApp(database, config).listen(config.port, () => console.log(`API listening on port ${config.port}`));

async function shutdown() {
  server.close();
  await database.close();
}
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
