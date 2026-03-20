// FAS PII Monitor — Personal Information Leakage Detection
// Monitors outgoing data (especially hunter-bound task descriptions)
// for PII patterns. Uses the same pattern library as the sanitizer
// to ensure consistent detection.
//
// Designed to integrate with file_logger for audit trail logging
// when PII access is detected.

import { contains_pii, contains_critical_pii, detect_pii_types } from './sanitizer.js';

// === Types ===

export type PiiCheckResult = {
  has_pii: boolean;
  has_critical: boolean;
  detected_types: string[];
};

export type PiiMonitorConfig = {
  // Optional callback invoked when PII is detected in log_pii_access
  on_pii_detected?: (agent: string, context: string, types: string[]) => void;
};

// === Factory function ===

export const create_pii_monitor = (config?: PiiMonitorConfig) => {
  const on_detected = config?.on_pii_detected;

  // --- check_for_pii: Scan text for PII patterns ---
  // Returns detection result with severity classification
  const check_for_pii = (text: string): PiiCheckResult => {
    const detected_types = detect_pii_types(text);
    const has_pii = contains_pii(text);
    const has_critical = contains_critical_pii(text);

    return {
      has_pii,
      has_critical,
      detected_types,
    };
  };

  // --- log_pii_access: Record a PII access event ---
  // Invokes the on_pii_detected callback if provided.
  // This should be called when PII is found in hunter-bound data.
  const log_pii_access = (agent: string, context: string, types: string[]): void => {
    if (on_detected) {
      on_detected(agent, context, types);
    }
  };

  return {
    check_for_pii,
    log_pii_access,
  };
};

// === Export type for external use ===

export type PiiMonitor = ReturnType<typeof create_pii_monitor>;
