import {
  availabilitySchedules,
  type AvailabilitySchedule,
  type NewAvailabilitySchedule,
} from "@convene/db";
import { Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { PostgresService } from "../../../infra/postgres/postgres.service";

@Injectable()
export class SchedulesRepository {
  constructor(private readonly postgres: PostgresService) {}

  async create(values: NewAvailabilitySchedule): Promise<AvailabilitySchedule> {
    const [created] = await this.postgres.db
      .insert(availabilitySchedules)
      .values(values)
      .returning();
    if (!created) throw new Error("SchedulesRepository: insert returned no row");
    return created;
  }

  async findById(id: string, userId: string): Promise<AvailabilitySchedule | null> {
    const [row] = await this.postgres.db
      .select()
      .from(availabilitySchedules)
      .where(and(eq(availabilitySchedules.id, id), eq(availabilitySchedules.userId, userId)))
      .limit(1);
    return row ?? null;
  }

  async update(
    id: string,
    userId: string,
    patch: Partial<NewAvailabilitySchedule>,
  ): Promise<AvailabilitySchedule | null> {
    const [updated] = await this.postgres.db
      .update(availabilitySchedules)
      .set(patch)
      .where(and(eq(availabilitySchedules.id, id), eq(availabilitySchedules.userId, userId)))
      .returning();
    return updated ?? null;
  }

  async delete(id: string, userId: string): Promise<boolean> {
    const deleted = await this.postgres.db
      .delete(availabilitySchedules)
      .where(and(eq(availabilitySchedules.id, id), eq(availabilitySchedules.userId, userId)))
      .returning();
    return deleted.length > 0;
  }

  async listActive(userId: string): Promise<AvailabilitySchedule[]> {
    return this.postgres.db
      .select()
      .from(availabilitySchedules)
      .where(
        and(eq(availabilitySchedules.userId, userId), eq(availabilitySchedules.isActive, true)),
      );
  }

  // BR-AVAIL-09: "Max 20 active recurring rules; free plan max 3
  // windows/week" — read as: at most 20 active schedule rows total
  // (any plan), and free plan additionally capped at 3 active rows.
  async countActive(userId: string): Promise<number> {
    const rows = await this.listActive(userId);
    return rows.length;
  }

  // Every schedule with is_active=true, across all users — the
  // generator worker's own scan set (P10.3's schedule-generator.worker.ts).
  async listAllActive(): Promise<AvailabilitySchedule[]> {
    return this.postgres.db
      .select()
      .from(availabilitySchedules)
      .where(eq(availabilitySchedules.isActive, true));
  }
}
