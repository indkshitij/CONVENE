import { reports, type NewReport, type Report } from "@convene/db";
import { Injectable } from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
import { uuidv7 } from "../../../common/utils/uuidv7";
import { PostgresService } from "../../../infra/postgres/postgres.service";

export interface CreateReportInput {
  reporterId: string | null;
  targetType: string;
  targetId: string;
  targetUserId: string | null;
  category: string;
  severity: string;
  description: string | null;
  evidence: Record<string, unknown>;
  slaDueAt: Date;
}

@Injectable()
export class ReportsRepository {
  constructor(private readonly postgres: PostgresService) {}

  async create(input: CreateReportInput): Promise<Report> {
    const reference = `RPT-${new Date().getUTCFullYear()}-${uuidv7().slice(-6).toUpperCase()}`;
    const values: NewReport = {
      reference,
      reporterId: input.reporterId,
      targetType: input.targetType,
      targetId: input.targetId,
      targetUserId: input.targetUserId,
      category: input.category,
      severity: input.severity,
      description: input.description,
      evidence: input.evidence,
      status: "open",
      slaDueAt: input.slaDueAt,
    };
    const [row] = await this.postgres.db.insert(reports).values(values).returning();
    if (!row) throw new Error("ReportsRepository: create returned no row");
    return row;
  }

  async findById(id: string): Promise<Report | null> {
    const [row] = await this.postgres.db.select().from(reports).where(eq(reports.id, id)).limit(1);
    return row ?? null;
  }

  async listQueue(
    filter: {
      status?: string | undefined;
      severity?: string | undefined;
      category?: string | undefined;
    },
    limit: number,
  ): Promise<Report[]> {
    const conditions = [];
    if (filter.status) conditions.push(eq(reports.status, filter.status));
    if (filter.severity) conditions.push(eq(reports.severity, filter.severity));
    if (filter.category) conditions.push(eq(reports.category, filter.category));
    return this.postgres.db
      .select()
      .from(reports)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(reports.slaDueAt))
      .limit(limit);
  }

  async update(
    id: string,
    patch: { status?: string; assignedTo?: string | null; resolvedAt?: Date | null },
  ): Promise<Report | null> {
    const [row] = await this.postgres.db
      .update(reports)
      .set(patch)
      .where(eq(reports.id, id))
      .returning();
    return row ?? null;
  }
}
