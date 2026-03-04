export type AuthStrategyType = "password" | "firebase";

export interface AuthConfig {
  strategy: AuthStrategyType;
  jwtTtl: string;
  firebase: { projectId: string };
}

function parseStrategy(raw: string | undefined): AuthStrategyType {
  if (raw === "firebase") return "firebase";
  return "password";
}

export const authConfig: AuthConfig = {
  strategy: parseStrategy(process.env["AUTH_STRATEGY"]),
  jwtTtl: parseStrategy(process.env["AUTH_STRATEGY"]) === "firebase" ? "1h" : "7d",
  firebase: {
    projectId: process.env["FIREBASE_PROJECT_ID"] ?? "",
  },
};
