import { createHash } from 'node:crypto';
import { inputPathSha256, isCalendarDay, overlap } from './inspect';
import type {
  DateRange,
  FileRef,
  ImportIssue,
  InputManifest,
  InspectionReport,
  SourceDecision,
  SourceDecisions,
  SourceRef,
} from './types';

type SalesDecision = Extract<SourceDecision, { action: 'SELECT_SALES' }>;

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value && typeof value === 'object') {
    return (
      '{' +
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, entry]) => JSON.stringify(key) + ':' + canonicalJson(entry))
        .join(',') +
      '}'
    );
  }
  return JSON.stringify(value);
}

export function hashSourceDecisions(decisions: SourceDecisions): string {
  return createHash('sha256').update(canonicalJson(decisions)).digest('hex');
}

function decisionRange(value: { reportFrom: string; reportTo: string }): DateRange {
  return { start: value.reportFrom, end: value.reportTo };
}

function validRange(range: DateRange): boolean {
  return isCalendarDay(range.start) && isCalendarDay(range.end) && range.start <= range.end;
}

function containsRange(outer: DateRange, inner: DateRange): boolean {
  return inner.start >= outer.start && inner.end <= outer.end;
}

function sameRows(left: number[], right: number[]): boolean {
  const rows = new Set(left);
  return (
    left.length === right.length && rows.size === left.length && right.every((row) => rows.has(row))
  );
}

function dateOnly(value: string): string {
  return value.slice(0, 10);
}

function dayAfter(day: string): string {
  const date = new Date(day + 'T00:00:00Z');
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function coversDays(range: DateRange, evidence: DateRange[]): boolean {
  let missing = range.start;
  for (const item of evidence.sort((a, b) =>
    a.start < b.start ? -1 : a.start > b.start ? 1 : 0,
  )) {
    if (item.start > missing) break;
    if (item.end >= range.end) return true;
    if (item.end >= missing) missing = dayAfter(item.end);
  }
  return false;
}

export function validateManifest(
  manifest: InputManifest,
  inspection: InspectionReport,
  decisions: SourceDecisions,
): ImportIssue[] {
  const issues = [...inspection.issues];
  const issue = (code: string, message: string, source: SourceRef | null = null) =>
    issues.push({ code, message, source });

  const cutoverDay = dateOnly(manifest.cutoverAt);
  if (
    manifest.version !== 1 ||
    manifest.companyCode !== 'SHOP' ||
    !manifest.canonicalSetId.trim() ||
    !isCalendarDay(cutoverDay) ||
    !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?\+07:00$/.test(
      manifest.cutoverAt,
    ) ||
    !manifest.files.length
  ) {
    issue('INVALID_MANIFEST', 'manifest ต้องระบุชุดไฟล์และเวลาตัดระบบของ SHOP เป็นเวลาไทย');
  }
  if (hashSourceDecisions(decisions) !== manifest.decisionsSha256) {
    issue('DECISIONS_HASH_MISMATCH', 'checksum ของบัญชีการตัดสินใจไม่ตรงกับ manifest');
  }

  const inspected = new Map(inspection.files.map((file) => [file.sha256, file]));
  const refsByHash = new Map<string, FileRef>();
  const usableDecisions = new Map<string, SourceDecision[]>();
  for (const decision of decisions.entries) {
    const file = inspected.get(decision.fileSha256);
    if (!file) {
      issue('FILE_HASH_MISMATCH', 'checksum ของไฟล์ที่ผูกกับหลักฐานไม่ตรงกับไฟล์ที่ตรวจ');
      continue;
    }
    if (!decision.reason.trim() || !decision.evidenceRef.trim()) {
      issue('MISSING_DECISION_EVIDENCE', 'การตัดสินใจต้องระบุเหตุผลและหลักฐานที่ตรวจย้อนกลับได้');
      continue;
    }
    const availableRows = new Set(file.rows.map(({ row }) => row));
    if (
      decision.sourceRows.some((row) => !availableRows.has(row)) ||
      decision.sourceRows.length !== new Set(decision.sourceRows).size
    ) {
      issue('INVALID_DECISION_ROWS', 'เลขแถวในหลักฐานไม่ตรงกับตารางรายละเอียดของไฟล์');
      continue;
    }
    if (decision.action === 'UNRESOLVED') {
      issue('UNRESOLVED_SOURCE_DECISION', 'หลักฐานต้นทางยังต้องตรวจสอบ');
    }
    const entries = usableDecisions.get(file.sha256) ?? [];
    entries.push(decision);
    usableDecisions.set(file.sha256, entries);
  }

  const snapshots = new Set<string>();
  const selected = new Map<string, Set<number>>();
  const salesWindows: SalesDecision[] = [];
  const salesDays = new Map<string, Set<string>>();
  const exclusions = new Map<string, Set<number>>();
  for (const ref of manifest.files) {
    const file = inspected.get(ref.sha256);
    if (!file || !file.inputs.some(({ pathSha256 }) => pathSha256 === inputPathSha256(ref.path))) {
      issue('FILE_HASH_MISMATCH', 'พาธหรือ checksum ของไฟล์ใน manifest ไม่ตรงกับไฟล์ที่ตรวจ');
      continue;
    }
    if (refsByHash.has(ref.sha256)) {
      issue('DUPLICATE_MANIFEST_FILE', 'manifest ระบุไฟล์เนื้อหาเดียวกันมากกว่าหนึ่งครั้ง');
      continue;
    }
    refsByHash.set(ref.sha256, ref);
    const entries = usableDecisions.get(ref.sha256) ?? [];
    const allRows = file.rows.map(({ row }) => row);
    if (
      file.sections.some(
        ({ label, sourceRowCount, declaredRowCount }) =>
          ['คืนสินค้า', 'ยกเลิกการขาย', 'ส่วนรายงานที่ไม่รู้จัก'].includes(label) &&
          (sourceRowCount > 0 || (declaredRowCount ?? 0) > 0),
      )
    ) {
      issue('UNRECONCILED_SALE_EVENTS', 'ต้องตรวจเหตุการณ์ที่อาจเปลี่ยนยอดและผูกกับบิลเดิม');
    }
    const excludedFile = entries.filter(({ action }) => action === 'EXCLUDE_FILE');
    const placements = entries.filter(
      ({ action }) => action === 'SELECT_SNAPSHOT' || action === 'SELECT_SALES',
    );
    if (excludedFile.length) {
      if (
        excludedFile.length !== 1 ||
        placements.length ||
        !sameRows(excludedFile[0].sourceRows, allRows)
      ) {
        issue('INVALID_FILE_EXCLUSION', 'หลักฐานตัดไฟล์ต้องระบุทุกแถวและไม่มีการเลือกไฟล์เดียวกัน');
      }
      continue;
    }

    if (
      ref.kind !== file.kind ||
      !file.declaredRange ||
      ref.reportFrom !== file.declaredRange.start ||
      ref.reportTo !== file.declaredRange.end
    ) {
      issue('SOURCE_SCOPE_MISMATCH', 'ชนิดหรือช่วงวันที่ตาม manifest ไม่ตรงกับรายงานต้นทาง');
      continue;
    }
    const selectedRows = new Set<number>();
    selected.set(file.sha256, selectedRows);
    const excludeRows = new Set(
      entries.filter(({ action }) => action === 'EXCLUDE_ROW').flatMap((entry) => entry.sourceRows),
    );

    exclusions.set(file.sha256, excludeRows);

    if (ref.kind === 'STOCK_SNAPSHOT') {
      const snapshot =
        placements.length === 1 && placements[0].action === 'SELECT_SNAPSHOT'
          ? placements[0]
          : null;
      if (
        !snapshot ||
        !ref.branchId?.trim() ||
        snapshot.branchId !== ref.branchId ||
        !ref.storeKey.trim() ||
        ref.storeKey === 'UNRESOLVED' ||
        snapshot.storeKey !== ref.storeKey ||
        snapshot.asOf !== manifest.cutoverAt ||
        ref.reportFrom !== cutoverDay ||
        !sameRows(snapshot.sourceRows, allRows)
      ) {
        issue('UNPROVEN_SNAPSHOT', 'ต้องมีหลักฐานเลือกหนึ่ง snapshot ที่เวลาตัดระบบต่อสาขา');
      } else if (snapshots.has(ref.branchId)) {
        issue('MULTIPLE_STOCK_SNAPSHOTS', 'สาขาหนึ่งเลือก snapshot ได้เพียงไฟล์เดียว');
      } else {
        snapshots.add(ref.branchId);
      }
      allRows.forEach((row) => selectedRows.add(row));
    } else if (ref.kind === 'SALES') {
      if (
        !placements.length &&
        (allRows.length || !entries.some(({ action }) => action === 'ZERO_SALES'))
      ) {
        issue('UNPROVEN_SALES_SELECTION', 'รายงานขายต้องมีหลักฐานเลือกข้อมูลหรือยืนยันยอดขายศูนย์');
      }
      for (const entry of placements) {
        if (entry.action !== 'SELECT_SALES') {
          issue('INVALID_SALES_SELECTION', 'ชนิดหลักฐานไม่ตรงกับรายงานขาย');
          continue;
        }
        const range = decisionRange(entry);
        const rows = file.rows.filter(
          ({ occurredAt }) =>
            occurredAt && dateOnly(occurredAt) >= range.start && dateOnly(occurredAt) <= range.end,
        );
        if (
          !validRange(range) ||
          !containsRange(file.declaredRange, range) ||
          range.end > cutoverDay ||
          !entry.branchId.trim() ||
          !entry.storeKey.trim() ||
          entry.storeKey === 'UNRESOLVED' ||
          ref.branchId !== entry.branchId ||
          ref.storeKey !== entry.storeKey ||
          !rows.length ||
          !sameRows(
            entry.sourceRows,
            rows.map(({ row }) => row),
          ) ||
          rows.some(
            ({ row, occurredAt }) =>
              selectedRows.has(row) || Date.parse(occurredAt!) > Date.parse(manifest.cutoverAt),
          )
        ) {
          issue(
            'INVALID_SALES_SELECTION',
            'หลักฐานเลือกขายต้องตรงกับร้านต้นทางของไฟล์ สาขา ช่วงเวลา และแถวต้นทาง',
          );
          continue;
        }
        salesWindows.push(entry);
        const days = salesDays.get(entry.branchId) ?? new Set<string>();
        rows.forEach(({ row, occurredAt }) => {
          selectedRows.add(row);
          days.add(dateOnly(occurredAt!));
        });
        salesDays.set(entry.branchId, days);
      }
      if (allRows.some((row) => !selectedRows.has(row) && !excludeRows.has(row))) {
        issue('UNASSIGNED_SALES_ROWS', 'ทุกแถวขายต้องมีหลักฐานเลือกสาขาหรือตัดออก');
      }
    }
    for (const finding of file.issues) {
      if (!finding.source || !excludeRows.has(finding.source.row)) issues.push(finding);
    }
  }
  if (refsByHash.size !== inspection.files.length) {
    issue('UNLISTED_SOURCE_FILE', 'มีไฟล์ต้นทางที่ไม่มีขอบเขตใน manifest');
  }

  for (const [index, left] of salesWindows.entries()) {
    for (const right of salesWindows.slice(index + 1)) {
      if (
        left.fileSha256 !== right.fileSha256 &&
        left.branchId === right.branchId &&
        overlap(decisionRange(left), decisionRange(right))
      ) {
        issue('SALES_OVERLAP', 'ช่วงขายที่เลือกสำหรับสาขาเดียวกันทับกัน ต้องเลือกชุด canonical');
      }
    }
  }

  const matchedDuplicateDecisions = new Set<SourceDecision>();
  for (const duplicate of inspection.duplicateRows) {
    if (duplicate.kind === 'STOCK_IMEI') {
      // Snapshot duplicates must be corrected in the source before any row exclusions.
      const rows = duplicate.rows.filter(({ fileSha256 }) => selected.has(fileSha256));
      if (rows.length > 1) {
        issue('DUPLICATE_SNAPSHOT_IMEI', 'IMEI ซ้ำในชุด snapshot ที่เลือก', rows[0]);
      }
      continue;
    }

    const byOrigin = new Map<string, SourceRef[]>();
    for (const source of duplicate.rows) {
      const ref = refsByHash.get(source.fileSha256);
      if (!ref || !selected.get(source.fileSha256)?.has(source.row)) continue;
      const rows = byOrigin.get(ref.storeKey) ?? [];
      rows.push(source);
      byOrigin.set(ref.storeKey, rows);
    }
    for (const rows of byOrigin.values()) {
      if (rows.length < 2) continue;
      const [first] = rows;
      const hash = first.fileSha256;
      const numbers = rows.map(({ row }) => row);
      const excluded = exclusions.get(hash);
      const matching = rows.every(({ fileSha256 }) => fileSha256 === hash)
        ? (usableDecisions.get(hash) ?? []).filter((entry) => {
            if (!sameRows(entry.sourceRows, numbers) || numbers.some((row) => excluded?.has(row))) {
              return false;
            }
            if (entry.action === 'DISTINCT_UNITS') return true;
            return (
              entry.action === 'REPORT_DUPLICATE' &&
              numbers.includes(entry.keepRow) &&
              duplicate.equalRowGroups.some((equalRows) =>
                rows.every(({ row }) =>
                  equalRows.some((ref) => ref.fileSha256 === hash && ref.row === row),
                ),
              )
            );
          })
        : [];
      if (matching.length === 1) matchedDuplicateDecisions.add(matching[0]);
      else issue('UNRESOLVED_SALES_DUPLICATE', 'ชุดแถวซ้ำต้องเทียบกับบิลและจำนวนต้นทาง', first);
    }
  }
  for (const decision of decisions.entries) {
    if (
      (decision.action === 'REPORT_DUPLICATE' || decision.action === 'DISTINCT_UNITS') &&
      !matchedDuplicateDecisions.has(decision)
    ) {
      issue('UNMATCHED_SALES_DUPLICATE_DECISION', 'หลักฐานตัดซ้ำไม่ตรงกับกลุ่มแถวขายที่เลือก');
    }
  }

  const coverageByBranch = new Map<string, DateRange>();
  for (const history of manifest.history ?? []) {
    const range = decisionRange(history);
    if (
      coverageByBranch.has(history.branchId) ||
      !history.branchId.trim() ||
      !validRange(range) ||
      range.end !== cutoverDay ||
      !history.evidenceRef.trim()
    ) {
      issue(
        'INVALID_HISTORY_SCOPE',
        'ช่วงประวัติของแต่ละสาขาต้องมีหลักฐานและครอบคลุมถึงวันตัดระบบ',
      );
      continue;
    }
    coverageByBranch.set(history.branchId, range);
  }
  const zeroRanges = new Map<string, DateRange[]>();
  for (const entries of usableDecisions.values()) {
    for (const entry of entries) {
      if (entry.action !== 'ZERO_SALES') continue;
      const range = decisionRange(entry);
      const scope = coverageByBranch.get(entry.branchId);
      const sales = salesDays.get(entry.branchId) ?? new Set<string>();
      const source = inspected.get(entry.fileSha256)!;
      const ref = refsByHash.get(entry.fileSha256);
      if (
        !ref?.storeKey.trim() ||
        ref.storeKey === 'UNRESOLVED' ||
        ref.branchId !== entry.branchId ||
        !scope ||
        !validRange(range) ||
        !containsRange(scope, range) ||
        entry.sourceRows.length ||
        source.kind !== 'SALES' ||
        !source.declaredRange ||
        !containsRange(source.declaredRange, range) ||
        source.issues.some(({ source, code }) => !source || code === 'INVALID_SOURCE_DATE') ||
        [...sales].some((day) => day >= range.start && day <= range.end) ||
        inspection.files.some(
          (other) =>
            other.kind === 'SALES' &&
            refsByHash.get(other.sha256)?.storeKey === ref.storeKey &&
            other.rows.some(({ occurredAt }) => {
              const day = occurredAt && dateOnly(occurredAt);
              return day && day >= range.start && day <= range.end;
            }),
        )
      ) {
        issue(
          'INVALID_ZERO_SALES_PERIOD',
          'ช่วงยอดขายศูนย์ต้องตรงกับขอบเขตและไม่มีรายการขายต้นทางที่ขัดกับหลักฐาน',
        );
        continue;
      }
      const ranges = zeroRanges.get(entry.branchId) ?? [];
      ranges.push(range);
      zeroRanges.set(entry.branchId, ranges);
    }
  }
  for (const window of salesWindows) {
    const scope = coverageByBranch.get(window.branchId);
    if (!scope || !containsRange(scope, decisionRange(window))) {
      issue('UNPROVEN_HISTORY_SCOPE', 'ช่วงขายที่เลือกต้องอยู่ในขอบเขตประวัติที่มีหลักฐานของสาขา');
    }
  }
  for (const [branchId, scope] of coverageByBranch) {
    const evidence = [...(salesDays.get(branchId) ?? [])].map((day) => ({ start: day, end: day }));
    if (!coversDays(scope, evidence.concat(zeroRanges.get(branchId) ?? []))) {
      issue('UNPROVEN_SALES_COVERAGE', 'มีวันที่ขาดรายงานขายหรือหลักฐานยืนยันยอดขายศูนย์');
    }
  }
  if (!selected.size && !coverageByBranch.size) {
    issue('EMPTY_CANONICAL_SET', 'ไม่มี snapshot หรือประวัติขายที่เลือกใน manifest');
  }
  return issues;
}
