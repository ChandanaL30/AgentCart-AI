import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().optional().default(""),
  SESSION_SECRET: z
    .string()
    .min(16, "SESSION_SECRET must be at least 16 characters for secure guest session tokens")
    .default("agentcart_dev_secret_must_change_in_production_32chars"),
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  NEXT_PUBLIC_PAYPAL_CLIENT_ID: z.string().default("sandbox_paypal_client_id_placeholder"),
  PAYPAL_CLIENT_SECRET: z.string().default("sandbox_paypal_client_secret_placeholder"),
  PAYPAL_ENVIRONMENT: z.enum(["sandbox", "production"]).default("sandbox"),
  LLM_PROVIDER: z.enum(["mock", "openai", "gemini", "anthropic"]).default("mock"),
  OPENAI_API_KEY: z.string().optional().default(""),
  GEMINI_API_KEY: z.string().optional().default(""),
  ANTHROPIC_API_KEY: z.string().optional().default(""),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export type Env = z.infer<typeof envSchema>;

function getValidatedEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error(
      "[AgentCart AI] Environment validation warning:",
      parsed.error.flatten().fieldErrors
    );
    // Return schema defaults to prevent breaking static build steps
    return envSchema.parse({
      DATABASE_URL: process.env.DATABASE_URL,
      SESSION_SECRET: process.env.SESSION_SECRET,
      NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
      NEXT_PUBLIC_PAYPAL_CLIENT_ID: process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID,
      PAYPAL_CLIENT_SECRET: process.env.PAYPAL_CLIENT_SECRET,
      PAYPAL_ENVIRONMENT: process.env.PAYPAL_ENVIRONMENT,
      LLM_PROVIDER: process.env.LLM_PROVIDER,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      GEMINI_API_KEY: process.env.GEMINI_API_KEY,
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
      NODE_ENV: process.env.NODE_ENV,
    });
  }
  return parsed.data;
}

export const env = getValidatedEnv();
