/**
 * Minimal CSV parser สำหรับ legacy MySQL dump
 * Format: ทุก field เป็น "..." หรือ NULL (literal, ไม่ quote)
 * รองรับ embedded comma, escaped quote ("")
 */
export function parseCsv(content: string): Record<string, string | null>[] {
  const rows = parseRows(content);
  if (rows.length === 0) return [];
  const headers = rows[0];
  return rows.slice(1).map((row) => {
    const obj: Record<string, string | null> = {};
    headers.forEach((h, i) => {
      obj[h] = row[i] === undefined ? null : row[i];
    });
    return obj;
  });
}

function parseRows(content: string): (string | null)[][] {
  const rows: (string | null)[][] = [];
  let row: (string | null)[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  let fieldStarted = false;

  const pushField = () => {
    if (!fieldStarted && field === '') {
      // empty unquoted = NULL marker (e.g. NULL or just blank)
      row.push(null);
    } else if (!inQuotes && field === 'NULL') {
      row.push(null);
    } else {
      row.push(field);
    }
    field = '';
    fieldStarted = false;
  };

  while (i < content.length) {
    const c = content[i];
    if (inQuotes) {
      if (c === '"') {
        if (content[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
    } else {
      if (c === '"') {
        inQuotes = true;
        fieldStarted = true;
        i++;
      } else if (c === ',') {
        pushField();
        i++;
      } else if (c === '\r') {
        i++;
      } else if (c === '\n') {
        pushField();
        if (row.length > 0 && !(row.length === 1 && row[0] === null)) {
          rows.push(row);
        }
        row = [];
        i++;
      } else {
        field += c;
        fieldStarted = true;
        i++;
      }
    }
  }
  if (field !== '' || fieldStarted || row.length > 0) {
    pushField();
    if (row.length > 0) rows.push(row);
  }
  // headers row will have all strings, so cast
  return rows as any;
}
