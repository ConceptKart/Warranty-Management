import { prisma } from "@/lib/db";

export type DashboardStats = {
  total_tickets: number;
  pending_tickets: number;
  completed_tickets: number;
  warranty_tickets: number;
  replacement_tickets: number;
  recent_tickets: number;
  by_type: Array<{ type_name: string; ticket_type_id: number; count: number }>;
  by_priority: Array<{ priority: string; count: number }>;
  by_status: Array<{
    status_id: number;
    status_name: string;
    status_color: string | null;
    count: number;
  }>;
  user_stats?: Array<{
    username: string;
    tickets_handled: number;
    total_actions: number;
    avg_response_hours: number | null;
  }>;
};

export type RecentTicket = {
  ticket_number: string;
  priority: string;
  created_at: Date | null;
  customer_description: string;
  customer_email: string;
  product_name: string;
  status_name: string;
  status_color: string | null;
  issue_name: string;
};

function toNumber(value: unknown): number {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return value;
  return Number(value ?? 0);
}

/** Mirrors AdminController::getEnhancedDashboardStats */
export async function getEnhancedDashboardStats(
  role: string,
): Promise<DashboardStats> {
  const [
    totalRow,
    pendingRow,
    completedRow,
    byType,
    byPriority,
    byStatus,
    recentRow,
  ] = await Promise.all([
    prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) AS count FROM warranty_tickets
    `,
    prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) AS count
      FROM warranty_tickets wt
      JOIN ticket_statuses ts ON wt.status_id = ts.status_id
      WHERE ts.is_final = 0
    `,
    prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) AS count
      FROM warranty_tickets wt
      JOIN ticket_statuses ts ON wt.status_id = ts.status_id
      WHERE ts.is_final = 1
    `,
    prisma.$queryRaw<
      Array<{ type_name: string; ticket_type_id: number; count: bigint }>
    >`
      SELECT tt.type_name, tt.ticket_type_id, COUNT(*) AS count
      FROM warranty_tickets wt
      JOIN ticket_types tt ON wt.ticket_type_id = tt.ticket_type_id
      GROUP BY tt.ticket_type_id, tt.type_name
    `,
    prisma.$queryRaw<Array<{ priority: string; count: bigint }>>`
      SELECT priority, COUNT(*) AS count
      FROM warranty_tickets
      GROUP BY priority
      ORDER BY FIELD(priority, 'urgent', 'high', 'medium', 'low')
    `,
    prisma.$queryRaw<
      Array<{
        status_id: number;
        status_name: string;
        status_color: string | null;
        count: bigint;
      }>
    >`
      SELECT wt.status_id, ts.status_name, ts.status_color, COUNT(*) AS count
      FROM warranty_tickets wt
      JOIN ticket_statuses ts ON wt.status_id = ts.status_id
      GROUP BY wt.status_id, ts.status_name, ts.status_color
      ORDER BY count DESC
    `,
    prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) AS count
      FROM warranty_tickets
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
    `,
  ]);

  const byTypeMapped = byType.map((t) => ({
    type_name: t.type_name,
    ticket_type_id: t.ticket_type_id,
    count: toNumber(t.count),
  }));

  let warranty_tickets = 0;
  let replacement_tickets = 0;
  for (const t of byTypeMapped) {
    const lower = t.type_name.toLowerCase();
    if (lower.includes("warranty")) warranty_tickets = t.count;
    if (lower.includes("replacement")) replacement_tickets = t.count;
  }

  const stats: DashboardStats = {
    total_tickets: toNumber(totalRow[0]?.count),
    pending_tickets: toNumber(pendingRow[0]?.count),
    completed_tickets: toNumber(completedRow[0]?.count),
    warranty_tickets,
    replacement_tickets,
    recent_tickets: toNumber(recentRow[0]?.count),
    by_type: byTypeMapped,
    by_priority: byPriority.map((p) => ({
      priority: p.priority,
      count: toNumber(p.count),
    })),
    by_status: byStatus.map((s) => ({
      status_id: s.status_id,
      status_name: s.status_name,
      status_color: s.status_color,
      count: toNumber(s.count),
    })),
  };

  if (role === "admin") {
    stats.user_stats = await getUserTATStats();
  }

  return stats;
}

/** Mirrors AdminController::getUserTATStats */
export async function getUserTATStats() {
  const rows = await prisma.$queryRaw<
    Array<{
      username: string;
      tickets_handled: bigint;
      total_actions: bigint;
      avg_response_hours: unknown;
    }>
  >`
    SELECT
      h.changed_by AS username,
      COUNT(DISTINCT h.ticket_id) AS tickets_handled,
      COUNT(*) AS total_actions,
      ROUND(AVG(TIMESTAMPDIFF(HOUR, wt.created_at, h.changed_at)), 1) AS avg_response_hours
    FROM ticket_status_history h
    JOIN warranty_tickets wt ON h.ticket_id = wt.ticket_id
    WHERE h.changed_by IS NOT NULL AND h.changed_by != ''
    GROUP BY h.changed_by
    ORDER BY tickets_handled DESC
  `;

  return rows.map((r) => ({
    username: r.username,
    tickets_handled: toNumber(r.tickets_handled),
    total_actions: toNumber(r.total_actions),
    avg_response_hours:
      r.avg_response_hours === null || r.avg_response_hours === undefined
        ? null
        : Number(r.avg_response_hours),
  }));
}

/** Mirrors AdminController::getRecentTickets */
export async function getRecentTickets(limit = 10): Promise<RecentTicket[]> {
  const rows = await prisma.$queryRaw<
    Array<{
      ticket_number: string;
      priority: string;
      created_at: Date | null;
      customer_description: string;
      customer_email: string;
      product_name: string;
      status_name: string;
      status_color: string | null;
      issue_name: string;
    }>
  >`
    SELECT
      wt.ticket_number,
      wt.priority,
      wt.created_at,
      wt.customer_description,
      c.email AS customer_email,
      p.product_name,
      ts.status_name,
      ts.status_color,
      it.issue_name
    FROM warranty_tickets wt
    JOIN orders o ON wt.order_id = o.order_id
    JOIN customers c ON o.customer_id = c.customer_id
    JOIN products p ON wt.product_id = p.product_id
    JOIN ticket_statuses ts ON wt.status_id = ts.status_id
    JOIN issue_types it ON wt.issue_type_id = it.issue_type_id
    ORDER BY wt.created_at DESC
    LIMIT ${limit}
  `;

  return rows;
}
