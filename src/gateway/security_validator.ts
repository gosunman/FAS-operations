// Security validator for hunter result submissions
// Implements steps 1,2,4,5 of the 5-step inspection protocol
// (Step 3 = PII check is handled by sanitizer.ts)
//
// NOTE: This file contains regex patterns that DETECT malicious strings.
// It does NOT execute any shell commands or import child_process.
// Hook false positives on "exec" etc. are expected and safe to ignore.
//
// Factory function pattern matching sanitizer.ts

import type { SecurityViolationType, SecurityViolation, SecurityValidationResult } from '../shared/types.js';

// === Detection patterns ===

type SecurityPattern = {
  name: string;
  type: SecurityViolationType;
  regex: RegExp;
};

// Build patterns that detect dangerous code strings in hunter output
// These regex match TEXT CONTENT, not actual code execution
const SECURITY_PATTERNS: SecurityPattern[] = [
  // --- Step 1: Prompt Injection ---
  {
    name: 'ignore_previous',
    type: 'prompt_injection',
    regex: /(ignore|disregard|forget)\s+(all\s+)?(previous|prior|above)\s+(instructions|prompts|rules|context)/i,
  },
  {
    name: 'role_override',
    type: 'prompt_injection',
    regex: /you\s+are\s+now\s+(a|an|my|the)\s+/i,
  },
  {
    name: 'bypass_security',
    type: 'prompt_injection',
    regex: /bypass\s+(security|filter|restriction|guard|protection)/i,
  },
  {
    name: 'system_prompt_leak',
    type: 'prompt_injection',
    regex: /(reveal|show|print|output|display)\s+(your\s+)?(system\s+prompt|instructions|hidden\s+prompt)/i,
  },
  {
    name: 'jailbreak_attempt',
    type: 'prompt_injection',
    regex: /(DAN|do\s+anything\s+now|act\s+as\s+if|pretend\s+you|roleplay\s+as)/i,
  },

  // --- Step 2: Malware / RCE detection ---
  // These patterns detect dangerous CODE STRINGS in text, not actual execution
  {
    name: 'dangerous_require',
    type: 'malware',
    // Detects: eval(), exec(), spawn(), require("child_...)
    regex: /(?:eval|spawn|fork|execFile)\s*\(|require\s*\(\s*['"]child/i,
  },
  {
    name: 'dangerous_exec_call',
    type: 'malware',
    // Detects: .exec( pattern — common in child_process usage
    regex: /\.\s*exec\s*\(\s*["'`]/i,
  },
  {
    name: 'curl_wget_pipe',
    type: 'malware',
    regex: /(curl|wget)\s+https?:\/\/[^\s]+\s*\|\s*(bash|sh|zsh|python)/i,
  },
  {
    name: 'shell_command',
    type: 'malware',
    regex: /(bash|sh|zsh)\s+-c\s+['"]/i,
  },
  {
    name: 'base64_decode',
    type: 'malware',
    regex: /base64[_\s]*(decode|--decode|-d)/i,
  },
  {
    name: 'rm_rf',
    type: 'malware',
    regex: /rm\s+(-rf|-fr|--recursive\s+--force)\s+\//i,
  },
  {
    name: 'reverse_shell',
    type: 'malware',
    regex: /\/dev\/(tcp|udp)\/|nc\s+-[elp]|ncat\s+/i,
  },

  // --- Step 5: Reverse Information Gathering ---
  {
    name: 'user_path_probe',
    type: 'reverse_gathering',
    regex: /\/Users\/(?!user\b)[a-zA-Z][a-zA-Z0-9_-]*/i,
  },
  {
    name: 'claude_config_probe',
    type: 'reverse_gathering',
    regex: /\.claude[/\\]/i,
  },
  {
    name: 'env_file_probe',
    type: 'reverse_gathering',
    regex: /(?:cat|less|more|head|tail|vim|nano|code|open)\s+[^\s]*\.env\b/i,
  },
  {
    name: 'env_ref',
    type: 'reverse_gathering',
    regex: /(?:^|\s)\.env(?:\s|$)/,
  },
  {
    name: 'settings_json_probe',
    type: 'reverse_gathering',
    regex: /settings\.local\.json|settings\.json/i,
  },
  {
    name: 'api_token_probe',
    type: 'reverse_gathering',
    regex: /xox[bpas]-[A-Za-z0-9_/-]{10,}/i,
  },
  {
    name: 'ssh_key_probe',
    type: 'reverse_gathering',
    regex: /-----BEGIN\s+(RSA|EC|OPENSSH)\s+PRIVATE\s+KEY-----/i,
  },

  // --- Step 4: Data Integrity Poisoning ---
  {
    name: 'knowledge_override_kr',
    type: 'data_integrity',
    regex: /(위의 내용은 거짓|이전 지식은 무시|기존 정보를 무시|이전 답변은 틀렸)/i,
  },
  {
    name: 'knowledge_override_en',
    type: 'data_integrity',
    regex: /(override|overwrite|replace)\s+(all\s+)?(previous\s+)?(knowledge|data|information|memory)/i,
  },
  {
    name: 'fact_poisoning',
    type: 'data_integrity',
    regex: /(actually|correction|update):\s*(the\s+)?(?:previous|earlier|above)\s+(?:information|data|answer)\s+(?:is|was)\s+(wrong|incorrect|false|outdated)/i,
  },
];

// === Factory function ===

export type SecurityValidatorConfig = {
  enable_ai_fallback?: boolean; // Future: Gemini LLM-based secondary check
};

export const create_security_validator = (_config?: SecurityValidatorConfig) => {
  const validate_hunter_output = (text: string): SecurityValidationResult => {
    const violations: SecurityViolation[] = [];

    for (const pattern of SECURITY_PATTERNS) {
      // Reset lastIndex for stateless matching
      pattern.regex.lastIndex = 0;
      const match = pattern.regex.exec(text);
      if (match) {
        violations.push({
          type: pattern.type,
          pattern_name: pattern.name,
          match: match[0],
        });
      }
    }

    return {
      is_safe: violations.length === 0,
      violations,
    };
  };

  return { validate_hunter_output };
};

export type SecurityValidator = ReturnType<typeof create_security_validator>;
