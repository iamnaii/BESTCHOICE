/**
 * prisma จำลองเฉพาะส่วนที่ RoomManagerService ใช้บันทึก/อ่านข้อความแชท (chatMessage + ห้องเดียว + systemConfig)
 * — ให้เทสต์เดินตรรกะจริงของ RoomManagerService (saveMessage / pageAutoReplyCoversTurn / hasBotReplied ...)
 * บนแถวที่กำหนดเวลาได้เอง แทนการ mock ผลลัพธ์ของเมธอด
 *
 * รองรับตัวกรองที่ RoomManager ใช้จริง: เท่ากับ / null / { in } / { not } / { gt, gte, lt, lte } / { startsWith }
 * / OR / AND / NOT และ orderBy createdAt · ไม่ใช่ prisma ครบชุด — เพิ่มเมื่อเทสต์ต้องใช้
 */
type Row = Record<string, any>;

function asComparable(v: unknown): number | string | boolean | null {
  if (v === undefined || v === null) return null;
  if (v instanceof Date) return v.getTime();
  return v as number | string | boolean;
}

function matchCond(value: unknown, cond: unknown): boolean {
  if (cond === null) return value === null || value === undefined;
  if (cond instanceof Date) return asComparable(value) === cond.getTime();
  if (typeof cond !== 'object') return value === cond;
  const c = cond as Record<string, unknown>;
  const v = asComparable(value);
  if ('in' in c && !(c.in as unknown[]).includes(value)) return false;
  if ('not' in c) {
    if (c.not === null) {
      if (v === null) return false;
    } else if (matchCond(value, c.not)) {
      return false;
    }
  }
  if ('startsWith' in c && !(typeof value === 'string' && value.startsWith(String(c.startsWith))))
    return false;
  const bound = (k: string) => asComparable(c[k]) as number;
  if ('gt' in c && !(v !== null && (v as number) > bound('gt'))) return false;
  if ('gte' in c && !(v !== null && (v as number) >= bound('gte'))) return false;
  if ('lt' in c && !(v !== null && (v as number) < bound('lt'))) return false;
  if ('lte' in c && !(v !== null && (v as number) <= bound('lte'))) return false;
  return true;
}

export function matchWhere(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  for (const [key, cond] of Object.entries(where)) {
    if (key === 'OR') {
      if (!(cond as Row[]).some((w) => matchWhere(row, w))) return false;
    } else if (key === 'AND') {
      if (!(cond as Row[]).every((w) => matchWhere(row, w))) return false;
    } else if (key === 'NOT') {
      const list = Array.isArray(cond) ? (cond as Row[]) : [cond as Row];
      if (list.some((w) => matchWhere(row, w))) return false;
    } else if (!matchCond(row[key], cond)) {
      return false;
    }
  }
  return true;
}

function applyData(target: Row, data: Row) {
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === 'object' && !(v instanceof Date) && 'increment' in (v as Row)) {
      target[k] = (Number(target[k]) || 0) + Number((v as Row).increment);
    } else {
      target[k] = v;
    }
  }
}

export function makeFakeChatPrisma(opts: {
  room: Row;
  markers?: string[] | null;
  rawMarkers?: string;
}) {
  const room: Row = { deletedAt: null, ...opts.room };
  const messages: Row[] = [];
  let seq = 0;

  const byOrder = (orderBy: Row | undefined) => (a: Row, b: Row) => {
    if (!orderBy?.createdAt) return 0;
    const d = a.createdAt.getTime() - b.createdAt.getTime();
    return orderBy.createdAt === 'desc' ? -d : d;
  };

  const chatMessage = {
    create: jest.fn(async ({ data }: { data: Row }) => {
      if (
        data.externalMessageId &&
        messages.some((m) => m.externalMessageId === data.externalMessageId)
      ) {
        throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
      }
      const row: Row = {
        id: `msg-${++seq}`,
        deletedAt: null,
        text: null,
        createdAt: new Date(),
        ...data,
      };
      messages.push(row);
      return row;
    }),
    findMany: jest.fn(async ({ where, orderBy, take }: Row = {}) => {
      const rows = messages.filter((m) => matchWhere(m, where)).sort(byOrder(orderBy));
      return take ? rows.slice(0, take) : rows;
    }),
    findFirst: jest.fn(async ({ where, orderBy }: Row = {}) => {
      return messages.filter((m) => matchWhere(m, where)).sort(byOrder(orderBy))[0] ?? null;
    }),
    findUnique: jest.fn(async ({ where }: Row) => messages.find((m) => m.id === where.id) ?? null),
    count: jest.fn(
      async ({ where }: Row = {}) => messages.filter((m) => matchWhere(m, where)).length,
    ),
  };

  const chatRoom = {
    findUnique: jest.fn(async ({ where }: Row) => (where.id === room.id ? room : null)),
    update: jest.fn(async ({ where, data }: Row) => {
      if (where.id !== room.id) throw new Error('room not found');
      applyData(room, data);
      return room;
    }),
    updateMany: jest.fn(async ({ where, data }: Row) => {
      if (!matchWhere(room, where)) return { count: 0 };
      applyData(room, data);
      return { count: 1 };
    }),
  };

  const markerValue =
    opts.rawMarkers !== undefined
      ? opts.rawMarkers
      : opts.markers
        ? JSON.stringify(opts.markers)
        : null;
  const systemConfig = {
    findFirst: jest.fn(async ({ where }: Row) =>
      where.key === 'shop_bot_page_autoreply_markers' && markerValue !== null
        ? { value: markerValue }
        : null,
    ),
    findMany: jest.fn(async () => []),
  };

  /** ใส่แถวข้อความตรง ๆ พร้อมเวลาที่กำหนด (จำลองสิ่งที่เกิดก่อนเทสต์ หรือ echo ที่มาถึงระหว่างทาง) */
  const addMessage = (row: Row) => {
    const full: Row = { id: `msg-${++seq}`, roomId: room.id, deletedAt: null, text: null, ...row };
    messages.push(full);
    return full;
  };

  return { prisma: { chatMessage, chatRoom, systemConfig }, room, messages, addMessage };
}
