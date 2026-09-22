export interface ApiConfig {
  mongoUri: string;
  sessionSecret: string;
  port: number;
  corsOrigins: string[];
  isProduction: boolean;
}

export function getApiConfig(env = process.env): ApiConfig {
  const mongoUri = env.MONGODB_URI;
  const sessionSecret = env.SESSION_SECRET;
  if (!mongoUri) throw new Error("MONGODB_URI is required to start the API.");
  if (!sessionSecret || sessionSecret.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters.");
  return {
    mongoUri,
    sessionSecret,
    port: Number(env.PORT ?? 4000),
    corsOrigins: (env.CORS_ORIGIN ?? "http://localhost:3000").split(",").map((origin) => origin.trim()).filter(Boolean),
    isProduction: env.NODE_ENV === "production",
  };
}
