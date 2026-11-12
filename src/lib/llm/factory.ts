import { env } from "@/lib/env";
import { GeminiLlmAdapter } from "./gemini-adapter";
import { MockLlmAdapter } from "./mock-adapter";
import { OpenAiLlmAdapter } from "./openai-adapter";
import { LlmAdapter } from "./types";

let cachedAdapter: LlmAdapter | null = null;

/**
 * Returns the configured LLM adapter based on environment settings.
 * If external credentials are missing or provider is "mock", safely defaults to MockLlmAdapter.
 */
export function getLlmAdapter(): LlmAdapter {
  if (cachedAdapter) {
    return cachedAdapter;
  }

  const provider = env.LLM_PROVIDER;

  switch (provider) {
    case "openai": {
      if (!env.OPENAI_API_KEY) {
        console.warn(
          "[AgentCart AI] OPENAI_API_KEY is not set. Gracefully falling back to deterministic MockLlmAdapter."
        );
        cachedAdapter = new MockLlmAdapter();
      } else {
        cachedAdapter = new OpenAiLlmAdapter(env.OPENAI_API_KEY);
      }
      break;
    }
    case "gemini": {
      if (!env.GEMINI_API_KEY) {
        console.warn(
          "[AgentCart AI] GEMINI_API_KEY is not set. Gracefully falling back to deterministic MockLlmAdapter."
        );
        cachedAdapter = new MockLlmAdapter();
      } else {
        cachedAdapter = new GeminiLlmAdapter(env.GEMINI_API_KEY);
      }
      break;
    }
    case "anthropic": {
      console.warn(
        "[AgentCart AI] Anthropic adapter placeholder configured. Falling back to MockLlmAdapter."
      );
      cachedAdapter = new MockLlmAdapter();
      break;
    }
    case "mock":
    default: {
      cachedAdapter = new MockLlmAdapter();
      break;
    }
  }

  return cachedAdapter;
}
