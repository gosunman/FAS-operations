// Local type definitions for Gemini CLI module
// Kept separate from src/shared/types.ts to avoid cross-session conflicts

export type GeminiAccount = 'a';

export type GeminiConfig = {
  account: GeminiAccount;
  timeout_ms?: number;           // Default: 300_000 (5 min)
  model?: string;                // Default: undefined (use CLI default)
  gemini_command?: string;       // Default: 'gemini'
};

export type GeminiResponse = {
  content: string;               // Parsed/cleaned response content
  raw_output: string;            // Raw stdout from CLI
  success: boolean;
  error?: string;
  duration_ms: number;
};

export type GeminiSessionStatus = 'running' | 'stopped' | 'crashed';

export type GeminiSessionInfo = {
  account: GeminiAccount;
  status: GeminiSessionStatus;
  session_name: string;          // tmux session name (fas-gemini-a)
  pid?: number;
};
