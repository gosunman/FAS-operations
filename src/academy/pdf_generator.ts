// PDF generator for EIDOS SCIENCE test sheets and answer keys
// Uses PDFKit with Korean font support (AppleSDGothicNeo on macOS)

import PDFDocument from 'pdfkit';
import { createWriteStream, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { join } from 'node:path';
import type { GeneratedTest } from './test_generator.js';

// ─── Configuration ──────────────────────────────────────────

export type PdfConfig = {
  page_size: 'A4' | 'Letter';
  margin: number;
  font_size_title: number;
  font_size_body: number;
  font_size_small: number;
  header_color: string; // EIDOS SCIENCE brand: black/gold
};

const DEFAULT_CONFIG: PdfConfig = {
  page_size: 'A4',
  margin: 50,
  font_size_title: 18,
  font_size_body: 11,
  font_size_small: 9,
  header_color: '#1a1a1a',
};

// Korean font paths — ordered by preference
// .ttc files don't work with PDFKit (fontkit subset issue), prefer .ttf/.otf
const KOREAN_FONT_PATHS = [
  `${process.env.HOME}/Library/Fonts/NotoSansKR-VariableFont_wght.ttf`,
  '/Library/Fonts/NotoSansKR-Regular.ttf',
  '/Library/Fonts/NotoSansKR-VariableFont_wght.ttf',
  '/System/Library/Fonts/Supplemental/AppleGothic.ttf',
];

const SUBJECT_NAMES: Record<string, string> = {
  physics: '물리학',
  chemistry: '화학',
  biology: '생명과학',
  earth_science: '지구과학',
  integrated_science: '통합과학',
};

// ─── Font Helper ────────────────────────────────────────────

/**
 * Find a Korean font that exists on the system.
 * Returns the path if found, null otherwise (will fallback to Helvetica).
 */
function find_korean_font(): string | null {
  for (const font_path of KOREAN_FONT_PATHS) {
    if (existsSync(font_path)) return font_path;
  }
  return null;
}

/**
 * Register Korean font on a PDFDocument and set it as active.
 * Falls back to Helvetica if Korean font is not available.
 */
function setup_font(doc: InstanceType<typeof PDFDocument>): void {
  const korean_font = find_korean_font();
  if (korean_font) {
    doc.registerFont('Korean', korean_font);
    doc.font('Korean');
  } else {
    // Fallback — Korean characters will show as boxes
    doc.font('Helvetica');
  }
}

// ─── PDF Utilities ──────────────────────────────────────────

/** Ensure parent directory exists */
function ensure_dir(file_path: string): void {
  const dir = dirname(file_path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/** Create a PDFDocument with default settings and Korean font */
function create_document(config: PdfConfig = DEFAULT_CONFIG): InstanceType<typeof PDFDocument> {
  const doc = new PDFDocument({
    size: config.page_size,
    margin: config.margin,
    bufferPages: true,
    info: {
      Title: 'EIDOS SCIENCE Test',
      Author: 'EIDOS SCIENCE',
      Creator: 'FAS Test Generator',
    },
  });
  setup_font(doc);
  return doc;
}

/** Write a document to file and return a promise that resolves when done */
function write_to_file(
  doc: InstanceType<typeof PDFDocument>,
  output_path: string,
): Promise<string> {
  ensure_dir(output_path);
  return new Promise((resolve, reject) => {
    const stream = createWriteStream(output_path);
    stream.on('finish', () => resolve(output_path));
    stream.on('error', reject);
    doc.pipe(stream);
    doc.end();
  });
}

/** Add page numbers to all pages (must be called before doc.end()) */
function add_page_numbers(
  doc: InstanceType<typeof PDFDocument>,
  config: PdfConfig = DEFAULT_CONFIG,
): void {
  const page_count = doc.bufferedPageRange().count;
  for (let i = 0; i < page_count; i++) {
    doc.switchToPage(i);
    const page_width = doc.page.width;
    doc.fontSize(config.font_size_small)
      .fillColor('#888888')
      .text(
        `${i + 1} / ${page_count}`,
        0,
        doc.page.height - config.margin + 10,
        { align: 'center', width: page_width },
      );
  }
}

// ─── Header / Footer ────────────────────────────────────────

/** Draw the test sheet header */
function draw_header(
  doc: InstanceType<typeof PDFDocument>,
  test: GeneratedTest,
  config: PdfConfig = DEFAULT_CONFIG,
  is_answer_key: boolean = false,
): void {
  const { test_sheet } = test;
  const subject_name = SUBJECT_NAMES[test_sheet.subject] ?? test_sheet.subject;

  // Brand name
  doc.fontSize(config.font_size_title)
    .fillColor(config.header_color)
    .text('EIDOS SCIENCE', { align: 'center' });

  doc.moveDown(0.3);

  // Subtitle: subject + chapter + type
  const subtitle = is_answer_key
    ? `${subject_name} - ${test_sheet.chapter} 정답 및 해설`
    : `${subject_name} - ${test_sheet.chapter} 주간 테스트`;

  doc.fontSize(config.font_size_title - 4)
    .fillColor('#333333')
    .text(subtitle, { align: 'center' });

  doc.moveDown(0.5);

  // Separator line
  const x_start = config.margin;
  const x_end = doc.page.width - config.margin;
  doc.moveTo(x_start, doc.y)
    .lineTo(x_end, doc.y)
    .strokeColor('#cccccc')
    .lineWidth(1)
    .stroke();

  doc.moveDown(0.5);

  // Info line
  doc.fontSize(config.font_size_body)
    .fillColor('#333333');

  if (is_answer_key) {
    doc.text(`날짜: ${test_sheet.date}    난이도: ${test_sheet.difficulty}    총점: ${test_sheet.total_points}점`, {
      align: 'left',
    });
  } else {
    doc.text(
      `날짜: ${test_sheet.date}    난이도: ${test_sheet.difficulty}    제한 시간: ${test_sheet.time_limit_minutes}분`,
      { align: 'left' },
    );
    doc.moveDown(0.3);
    doc.text(`이름: ________________    학년: ________    총점: ${test_sheet.total_points}점`, {
      align: 'left',
    });
  }

  doc.moveDown(0.5);

  // Second separator
  doc.moveTo(x_start, doc.y)
    .lineTo(x_end, doc.y)
    .strokeColor('#cccccc')
    .lineWidth(0.5)
    .stroke();

  doc.moveDown(0.8);
}

// ─── Test Sheet PDF ─────────────────────────────────────────

/**
 * Generate a test sheet PDF from a GeneratedTest.
 * Returns the output file path.
 */
export async function generate_test_pdf(
  test: GeneratedTest,
  output_path: string,
  config: PdfConfig = DEFAULT_CONFIG,
): Promise<string> {
  const doc = create_document(config);

  // Header
  draw_header(doc, test, config, false);

  // Questions
  const { questions } = test.test_sheet;
  const content_width = doc.page.width - config.margin * 2;

  for (const q of questions) {
    // Check if we need a new page (leave room for question + choices)
    const estimated_height = 20 + q.choices.length * 16 + 15;
    if (doc.y + estimated_height > doc.page.height - config.margin - 30) {
      doc.addPage();
    }

    // Question stem
    doc.fontSize(config.font_size_body)
      .fillColor('#000000')
      .text(`${q.number}. ${q.stem}`, config.margin, doc.y, {
        width: content_width,
      });

    doc.moveDown(0.2);

    // Choices — indented
    for (const choice of q.choices) {
      doc.fontSize(config.font_size_body)
        .fillColor('#333333')
        .text(`   ${choice.label} ${choice.text}`, config.margin + 15, doc.y, {
          width: content_width - 15,
        });
    }

    doc.moveDown(0.6);
  }

  // Page numbers
  add_page_numbers(doc, config);

  return write_to_file(doc, output_path);
}

// ─── Answer Key PDF ─────────────────────────────────────────

/**
 * Generate an answer key PDF from a GeneratedTest.
 * Includes compact answer grid and full explanations.
 * Returns the output file path.
 */
export async function generate_answer_key_pdf(
  test: GeneratedTest,
  output_path: string,
  config: PdfConfig = DEFAULT_CONFIG,
): Promise<string> {
  const doc = create_document(config);
  const content_width = doc.page.width - config.margin * 2;

  // Header
  draw_header(doc, test, config, true);

  // Compact answer grid
  doc.fontSize(config.font_size_body + 1)
    .fillColor('#000000')
    .text('[ 정답 ]', { align: 'left' });

  doc.moveDown(0.3);

  const { answers } = test.answer_key;
  const cols = 5;

  for (let i = 0; i < answers.length; i += cols) {
    const row = answers.slice(i, i + cols);
    const row_text = row.map((a) => `${a.number}번: ${a.correct}`).join('    ');
    doc.fontSize(config.font_size_body)
      .fillColor('#333333')
      .text(`  ${row_text}`, { align: 'left' });
  }

  doc.moveDown(1);

  // Separator
  const x_start = config.margin;
  const x_end = doc.page.width - config.margin;
  doc.moveTo(x_start, doc.y)
    .lineTo(x_end, doc.y)
    .strokeColor('#cccccc')
    .lineWidth(0.5)
    .stroke();

  doc.moveDown(0.8);

  // Explanations section
  const has_explanations = answers.some((a) => a.explanation.length > 0);
  if (has_explanations) {
    doc.fontSize(config.font_size_body + 1)
      .fillColor('#000000')
      .text('[ 해설 ]', { align: 'left' });

    doc.moveDown(0.5);

    for (const a of answers) {
      if (!a.explanation) continue;

      // Check page overflow
      if (doc.y + 40 > doc.page.height - config.margin - 30) {
        doc.addPage();
      }

      doc.fontSize(config.font_size_body)
        .fillColor('#000000')
        .text(`${a.number}번 (${a.correct}):`, config.margin, doc.y, {
          width: content_width,
          continued: true,
        })
        .fillColor('#555555')
        .text(` ${a.explanation}`, {
          width: content_width,
        });

      doc.moveDown(0.3);
    }
  }

  // Page numbers
  add_page_numbers(doc, config);

  return write_to_file(doc, output_path);
}

// ─── Combined PDF ───────────────────────────────────────────

type CombinedOptions = {
  test_filename?: string;
  answer_filename?: string;
  config?: PdfConfig;
};

/**
 * Generate both test sheet and answer key PDFs.
 * Returns paths to both files.
 */
export async function generate_combined_pdf(
  test: GeneratedTest,
  output_dir: string,
  options: CombinedOptions = {},
): Promise<{ test_path: string; answer_path: string }> {
  const {
    test_filename = 'test_sheet.pdf',
    answer_filename = 'answer_key.pdf',
    config = DEFAULT_CONFIG,
  } = options;

  const test_path = join(output_dir, test_filename);
  const answer_path = join(output_dir, answer_filename);

  // Generate both in parallel
  const [result_test, result_answer] = await Promise.all([
    generate_test_pdf(test, test_path, config),
    generate_answer_key_pdf(test, answer_path, config),
  ]);

  return { test_path: result_test, answer_path: result_answer };
}
