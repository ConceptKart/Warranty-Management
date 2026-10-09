import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  const startedAt = Date.now();

  try {
    await prisma.$queryRaw`SELECT 1`;

    const [ticketCount, adminCount] = await Promise.all([
      prisma.warrantyTicket.count(),
      prisma.adminUser.count(),
    ]);

    return NextResponse.json({
      ok: true,
      service: "warranty_management_new",
      database: "connected",
      counts: {
        warrantyTickets: ticketCount,
        adminUsers: adminCount,
      },
      latencyMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown database error";

    return NextResponse.json(
      {
        ok: false,
        service: "warranty_management_new",
        database: "disconnected",
        error: message,
        hint: "Import u590978274_warmanagement (1).sql into MySQL and update DATABASE_URL in .env",
        latencyMs: Date.now() - startedAt,
        timestamp: new Date().toISOString(),
      },
      { status: 503 },
    );
  }
}
