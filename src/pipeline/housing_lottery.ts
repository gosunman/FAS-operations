// Housing Lottery Scanner — public housing subscription announcement monitoring
// Purpose: track new apartment lottery announcements from applyhome.co.kr
// Stateless config + matching logic. Actual crawling delegated to hunter via web_crawl.
//
// Owner criteria (from memory):
//   - Homeless (무주택)
//   - Investment property: any region OK
//   - Residential: within 1 hour of Gangnam, 50m2+

// === Types ===

export type HousingType =
  | 'public_sale'        // 공공분양
  | 'private_sale'       // 민간분양
  | 'national_rental'    // 국민임대
  | 'public_rental'      // 공공임대
  | 'newlywed'           // 신혼희망타운
  | 'special_supply'     // 특별공급
  | 'other';

export type Region =
  | 'seoul'
  | 'gyeonggi'
  | 'incheon'
  | 'busan'
  | 'daegu'
  | 'gwangju'
  | 'daejeon'
  | 'ulsan'
  | 'sejong'
  | 'gangwon'
  | 'chungbuk'
  | 'chungnam'
  | 'jeonbuk'
  | 'jeonnam'
  | 'gyeongbuk'
  | 'gyeongnam'
  | 'jeju'
  | 'other';

export type Announcement = {
  id: string;
  title: string;
  housing_type: HousingType;
  region: Region;
  area_m2: number;            // exclusive area in m2
  announcement_date: string;  // YYYY-MM-DD
  deadline: string;           // YYYY-MM-DD
  url: string;
  complex_name: string;       // apartment complex name
  total_units: number;
  notes?: string;
};

export type FilterConfig = {
  min_area_m2?: number;
  regions?: Region[];
  housing_types?: HousingType[];
  exclude_expired?: boolean;
};

export type ScanReport = {
  announcements: Announcement[];
  summary: string;
  generated_at: string;
};

// === Constants ===

// Regions within ~1 hour of Gangnam (for residential use)
export const GANGNAM_ACCESSIBLE_REGIONS: Region[] = [
  'seoul',
  'gyeonggi',
  'incheon',
] as const satisfies readonly Region[];

// All regions (for investment property)
export const ALL_REGIONS: Region[] = [
  'seoul', 'gyeonggi', 'incheon', 'busan', 'daegu', 'gwangju',
  'daejeon', 'ulsan', 'sejong', 'gangwon', 'chungbuk', 'chungnam',
  'jeonbuk', 'jeonnam', 'gyeongbuk', 'gyeongnam', 'jeju',
] as const satisfies readonly Region[];

// Default filter: residential criteria (50m2+, capital region, no expired)
export const DEFAULT_FILTER: Required<FilterConfig> = {
  min_area_m2: 50,
  regions: [...GANGNAM_ACCESSIBLE_REGIONS],
  housing_types: [
    'public_sale',
    'private_sale',
    'national_rental',
    'public_rental',
    'newlywed',
    'special_supply',
  ],
  exclude_expired: true,
};

// Investment filter: all regions, any size
export const INVESTMENT_FILTER: Required<FilterConfig> = {
  min_area_m2: 0,
  regions: [...ALL_REGIONS],
  housing_types: [
    'public_sale',
    'private_sale',
    'national_rental',
    'public_rental',
    'newlywed',
    'special_supply',
  ],
  exclude_expired: true,
};

// === Housing Type Korean Names ===

const HOUSING_TYPE_NAMES: Record<HousingType, string> = {
  public_sale: '공공분양',
  private_sale: '민간분양',
  national_rental: '국민임대',
  public_rental: '공공임대',
  newlywed: '신혼희망타운',
  special_supply: '특별공급',
  other: '기타',
};

// === Region Korean Names ===

const REGION_NAMES: Record<Region, string> = {
  seoul: '서울',
  gyeonggi: '경기',
  incheon: '인천',
  busan: '부산',
  daegu: '대구',
  gwangju: '광주',
  daejeon: '대전',
  ulsan: '울산',
  sejong: '세종',
  gangwon: '강원',
  chungbuk: '충북',
  chungnam: '충남',
  jeonbuk: '전북',
  jeonnam: '전남',
  gyeongbuk: '경북',
  gyeongnam: '경남',
  jeju: '제주',
  other: '기타',
};

// === Utility Functions ===

// Check if an announcement is expired relative to a reference date
export const is_expired = (
  deadline: string,
  reference_date?: Date,
): boolean => {
  const ref = reference_date ?? new Date();
  const deadline_date = new Date(deadline + 'T23:59:59');
  return deadline_date.getTime() < ref.getTime();
};

// Check if an announcement matches the filter criteria
export const matches_filter = (
  announcement: Announcement,
  config: FilterConfig = DEFAULT_FILTER,
  reference_date?: Date,
): boolean => {
  const effective = { ...DEFAULT_FILTER, ...config };

  // Check area
  if (announcement.area_m2 < effective.min_area_m2) {
    return false;
  }

  // Check region
  if (!effective.regions.includes(announcement.region)) {
    return false;
  }

  // Check housing type
  if (!effective.housing_types.includes(announcement.housing_type)) {
    return false;
  }

  // Check expiration
  if (effective.exclude_expired && is_expired(announcement.deadline, reference_date)) {
    return false;
  }

  return true;
};

// Filter announcements by criteria
export const filter_announcements = (
  announcements: Announcement[],
  config: FilterConfig = DEFAULT_FILTER,
  reference_date?: Date,
): Announcement[] => {
  return announcements.filter((a) => matches_filter(a, config, reference_date));
};

// Sort announcements by deadline (earliest first)
export const sort_by_deadline = (
  announcements: Announcement[],
): Announcement[] => {
  return [...announcements].sort((a, b) =>
    a.deadline.localeCompare(b.deadline),
  );
};

// === Report Generator ===

export const generate_scan_report = (
  announcements: Announcement[],
  config: FilterConfig = DEFAULT_FILTER,
  reference_date?: Date,
): ScanReport => {
  const now = new Date().toISOString();
  const date_str = now.split('T')[0];

  // Filter and sort
  const filtered = filter_announcements(announcements, config, reference_date);
  const sorted = sort_by_deadline(filtered);

  if (sorted.length === 0) {
    return {
      announcements: [],
      summary: `=== 청약홈 공고 스캔 (${date_str}) ===\n\n조건에 맞는 공고가 없습니다.\n`,
      generated_at: now,
    };
  }

  const lines: string[] = [];
  lines.push(`=== 청약홈 공고 스캔 (${date_str}) ===`);
  lines.push(`조건: ${config.min_area_m2 ?? DEFAULT_FILTER.min_area_m2}m2+, ${(config.regions ?? DEFAULT_FILTER.regions).map((r) => REGION_NAMES[r]).join('/')}`);
  lines.push(`총 ${sorted.length}건`);
  lines.push('');

  for (const ann of sorted) {
    const housing_name = HOUSING_TYPE_NAMES[ann.housing_type];
    const region_name = REGION_NAMES[ann.region];
    lines.push(`  [${region_name}] ${ann.complex_name} (${housing_name})`);
    lines.push(`    면적: ${ann.area_m2}m2 | 세대수: ${ann.total_units}`);
    lines.push(`    마감: ${ann.deadline}`);
    lines.push(`    URL: ${ann.url}`);
    if (ann.notes) lines.push(`    비고: ${ann.notes}`);
    lines.push('');
  }

  return {
    announcements: sorted,
    summary: lines.join('\n'),
    generated_at: now,
  };
};

// === Hunter Prompt Generator ===
// Generates the instruction prompt for hunter to crawl applyhome.co.kr

export const generate_hunter_prompt = (
  config: FilterConfig = DEFAULT_FILTER,
): string => {
  const effective = { ...DEFAULT_FILTER, ...config };
  const region_names = effective.regions.map((r) => REGION_NAMES[r]).join(', ');
  const type_names = effective.housing_types.map((t) => HOUSING_TYPE_NAMES[t]).join(', ');

  return [
    '=== 청약홈 공고 스캔 ===',
    '',
    '## 대상 사이트',
    '- https://www.applyhome.co.kr/ (청약홈)',
    '- 신규 분양/임대 공고 목록 확인',
    '',
    '## 필터 조건',
    `- 지역: ${region_names}`,
    `- 최소 면적: ${effective.min_area_m2}m2 (전용면적)`,
    `- 유형: ${type_names}`,
    '- 마감 전 공고만 (기한 만료 제외)',
    '',
    '## 소유자 조건',
    '- 무주택자',
    '- 수익형 부동산: 지역 무관',
    '- 거주용: 강남 1시간 이내, 50m2+',
    '',
    '## 출력 형식',
    '각 공고별로 다음 정보를 제공:',
    '| 단지명 | 지역 | 유형 | 전용면적(m2) | 세대수 | 공고일 | 마감일 | URL |',
    '',
    '마감 임박 순으로 정렬.',
  ].join('\n');
};
