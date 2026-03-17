/**
 * generate_review_files.ts
 *
 * Reads all project files, masks sensitive information, and generates
 * categorized markdown files for NotebookLM upload.
 *
 * Usage: npx tsx scripts/generate_review_files.ts
 */

import fs from "node:fs";
import path from "node:path";

// ── Constants ──────────────────────────────────────────────────────────

const PROJECT_ROOT = path.resolve(import.meta.dirname, "..");
const OUTPUT_DIR = path.join(PROJECT_ROOT, "reviews", "notebooklm");
const TODAY = new Date().toISOString().slice(0, 10);

// Directories / files to completely exclude
const EXCLUDE_DIRS = new Set([
  "node_modules",
  ".git",
  "reviews",
  "state",
  "logs",
  "dist",
  ".claude",
]);

const EXCLUDE_FILES = new Set([
  "pnpm-lock.yaml",
  ".env",
]);

// File that should NOT be overwritten
const PRESERVE_FILE = "03_review_prompt.md";

// ── Masking Functions ──────────────────────────────────────────────────

/**
 * Apply all masking rules to file content.
 * Order matters — more specific patterns first to avoid partial matches.
 */
const mask_sensitive = (content: string): string => {
  let result = content;

  // 1. Telegram bot token pattern: digits:alphanumeric (e.g., 123456789:ABCdefGHI_jklMNO)
  result = result.replace(/\b\d{8,10}:[A-Za-z0-9_-]{30,50}\b/g, "[MASKED_TOKEN]");

  // 2. Slack token pattern (xoxb-..., xoxp-..., xoxa-..., xoxs-...)
  result = result.replace(/xox[bpas]-[A-Za-z0-9\-]+/g, "[MASKED_TOKEN]");

  // 3. GitHub URLs with username gosunman
  result = result.replace(/github\.com\/gosunman/g, "github.com/[MASKED_USER]");

  // 4. The word "sunman" (case-insensitive, but preserve surrounding context)
  result = result.replace(/\bsunman\b/gi, "[MASKED_OWNER]");
  // Also catch gosunman as a whole
  result = result.replace(/\bgosunman\b/gi, "[MASKED_OWNER]");

  // 5. File paths containing /Users/user/ → /Users/[MASKED_USER]/
  result = result.replace(/\/Users\/user\//g, "/Users/[MASKED_USER]/");

  // 6. Private IP addresses
  //    100.x.x.x (Tailscale), 192.168.x.x, 10.x.x.x, 172.16-31.x.x
  result = result.replace(/\b100\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, "[MASKED_IP]");
  result = result.replace(/\b192\.168\.\d{1,3}\.\d{1,3}\b/g, "[MASKED_IP]");
  result = result.replace(/\b10\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, "[MASKED_IP]");
  result = result.replace(
    /\b172\.(1[6-9]|2[0-9]|3[01])\.\d{1,3}\.\d{1,3}\b/g,
    "[MASKED_IP]"
  );

  // 7. Token/API key-like strings after = or : (long alphanumeric, 20+ chars)
  //    But skip obvious non-secrets (URLs, version strings, common hex hashes)
  //    Pattern: key= or key: followed by a long alphanumeric string
  result = result.replace(
    /([=:]\s*)([A-Za-z0-9_\-]{32,})(?=\s|$|"|'|`)/gm,
    "$1[MASKED_TOKEN]"
  );

  // 8. Catch Notion/API database IDs (32-char hex with hyphens)
  result = result.replace(
    /([=:]\s*)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
    "$1[MASKED_TOKEN]"
  );

  return result;
};

// ── File Collection ────────────────────────────────────────────────────

type FileEntry = {
  relative_path: string;
  absolute_path: string;
  content: string;
};

/**
 * Recursively collect all files under dir, respecting exclusions.
 */
const collect_files = (dir: string, base: string = PROJECT_ROOT): FileEntry[] => {
  const entries: FileEntry[] = [];
  const items = fs.readdirSync(dir, { withFileTypes: true });

  for (const item of items) {
    const abs = path.join(dir, item.name);
    const rel = path.relative(base, abs);

    if (item.isDirectory()) {
      if (EXCLUDE_DIRS.has(item.name)) continue;
      entries.push(...collect_files(abs, base));
    } else if (item.isFile()) {
      // Exclude specific files
      if (EXCLUDE_FILES.has(item.name)) continue;
      if (rel === ".env") continue;
      // Exclude .claude/settings.local.json
      if (rel.includes(".claude/settings.local.json")) continue;
      // Exclude pnpm-workspace.yaml (not in spec, but it's just a one-liner — include it actually)
      // Exclude binary files
      const ext = path.extname(item.name).toLowerCase();
      if ([".png", ".jpg", ".jpeg", ".gif", ".ico", ".woff", ".woff2", ".ttf", ".db", ".sqlite"].includes(ext)) continue;

      try {
        const content = fs.readFileSync(abs, "utf-8");
        entries.push({ relative_path: rel, absolute_path: abs, content });
      } catch {
        // Skip unreadable files
        console.warn(`  [WARN] Skipped unreadable file: ${rel}`);
      }
    }
  }

  return entries;
};

// ── Categorization ─────────────────────────────────────────────────────

type Category = {
  filename: string;
  title: string;
  files: FileEntry[];
};

/**
 * Determine the file extension for code fences.
 */
const get_lang = (filepath: string): string => {
  const ext = path.extname(filepath).toLowerCase();
  const map: Record<string, string> = {
    ".ts": "typescript",
    ".js": "javascript",
    ".json": "json",
    ".yml": "yaml",
    ".yaml": "yaml",
    ".md": "markdown",
    ".sh": "bash",
    ".plist": "xml",
    ".conf": "conf",
    ".example": "bash",
    ".gitignore": "gitignore",
  };
  // Special case for .gitignore (no extension)
  if (filepath.endsWith(".gitignore")) return "gitignore";
  return map[ext] || "text";
};

/**
 * Categorize a file into one of the three output groups.
 * Returns category index: 0 = docs_and_config, 1 = source_code, 2 = tests_and_scripts
 */
const categorize = (rel: string): number => {
  const ext = path.extname(rel).toLowerCase();
  const basename = path.basename(rel);

  // Category 3: tests and scripts
  // - All *.test.ts files
  // - All .sh files
  // - scripts/*.ts (but NOT the generate_review_files.ts itself)
  if (rel.endsWith(".test.ts")) return 2;
  if (ext === ".sh") return 2;
  if (rel.startsWith("scripts/") && ext === ".ts") return 2;

  // Category 2: source code
  // - All .ts files in src/ that are NOT test files
  if (rel.startsWith("src/") && ext === ".ts" && !rel.endsWith(".test.ts")) return 1;

  // Category 1: docs and config — everything else
  // - .md files, .yml, .yaml, .json, .example, .plist, .gitignore, docker-compose.yml, .conf
  if ([".md", ".yml", ".yaml", ".json", ".example", ".plist", ".conf"].includes(ext)) return 0;
  if (basename === ".gitignore") return 0;

  // Fallback: vitest.config.ts, tsconfig.json → config
  if (basename === "vitest.config.ts") return 0;

  // Anything else → docs_and_config
  return 0;
};

// ── Main ───────────────────────────────────────────────────────────────

const main = () => {
  console.log("=== FAS Review File Generator ===");
  console.log(`Project root: ${PROJECT_ROOT}`);
  console.log(`Output dir: ${OUTPUT_DIR}`);
  console.log(`Date: ${TODAY}\n`);

  // Ensure output directory exists
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Collect all files
  console.log("Collecting files...");
  const all_files = collect_files(PROJECT_ROOT);
  console.log(`  Found ${all_files.length} files total.\n`);

  // Set up categories
  const categories: Category[] = [
    { filename: "01_docs_and_config.md", title: "문서 & 설정 (Docs & Config)", files: [] },
    { filename: "02_source_code.md", title: "소스 코드 (Source Code)", files: [] },
    { filename: "03_tests_and_scripts.md", title: "테스트 & 스크립트 (Tests & Scripts)", files: [] },
  ];

  // Categorize files
  for (const file of all_files) {
    const cat_idx = categorize(file.relative_path);
    categories[cat_idx].files.push(file);
  }

  // Sort files within each category alphabetically
  for (const cat of categories) {
    cat.files.sort((a, b) => a.relative_path.localeCompare(b.relative_path));
  }

  // Generate output files
  for (let i = 0; i < categories.length; i++) {
    const cat = categories[i];
    const out_path = path.join(OUTPUT_DIR, cat.filename);

    // Check for the preserve-file rule:
    // If the output filename matches 03_review_prompt.md, skip
    // (but 03_tests_and_scripts.md is different, so this is fine)
    if (cat.filename === PRESERVE_FILE) {
      console.log(`  [SKIP] ${cat.filename} (preserved)`);
      continue;
    }

    console.log(`Generating ${cat.filename}...`);
    console.log(`  Files in this category: ${cat.files.length}`);

    // Build markdown content
    const lines: string[] = [];

    // Header
    lines.push(`# FAS 전체 코드 리뷰 — Part ${i + 1}: ${cat.title}`);
    lines.push(`> 이 파일은 민감정보가 마스킹된 상태입니다.`);
    lines.push(`> 파일 수: ${cat.files.length}개 | 생성일: ${TODAY}`);
    lines.push("");

    // File entries
    for (const file of cat.files) {
      const lang = get_lang(file.relative_path);
      const masked_content = mask_sensitive(file.content);

      lines.push(`## 파일: ${file.relative_path}`);
      lines.push("");
      lines.push(`\`\`\`${lang}`);
      lines.push(masked_content.trimEnd());
      lines.push("```");
      lines.push("");
      lines.push("---");
      lines.push("");
    }

    fs.writeFileSync(out_path, lines.join("\n"), "utf-8");
    console.log(`  Written to: ${out_path}`);

    // List files included
    for (const file of cat.files) {
      console.log(`    - ${file.relative_path}`);
    }
    console.log("");
  }

  // Also ensure 03_review_prompt.md is not touched
  const prompt_path = path.join(OUTPUT_DIR, PRESERVE_FILE);
  if (fs.existsSync(prompt_path)) {
    console.log(`[OK] ${PRESERVE_FILE} preserved (not overwritten).`);
  }

  console.log("\n=== Generation complete! ===");
};

main();
