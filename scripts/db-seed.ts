#!/usr/bin/env node
// P2.5: seeds reference taxonomies (always) and, with --users=N, a
// deterministic dev population dense enough to make Discovery/Available
// Now/messaging immediately exercisable. Safe to re-run — every insert is
// idempotent (ON CONFLICT DO NOTHING keyed on each table's natural unique
// constraint).
import "dotenv/config";
import postgres from "postgres";
import { ALL_CITIES, COUNTRIES } from "../packages/db/seeds/cities";
import { loadIntentComplementarity } from "../packages/db/seeds/complementarity";
import { INDUSTRIES, INTERESTS, LANGUAGES, SKILLS } from "../packages/db/seeds/taxonomies";
import { generateSeedPopulation } from "../packages/db/seeds/users";

function parseUserCount(): number {
  const arg = process.argv.find((a) => a.startsWith("--users="));
  if (!arg) return 0;
  const value = Number.parseInt(arg.split("=")[1] ?? "", 10);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid --users value: ${arg}`);
  }
  return value;
}

async function seedTaxonomies(sql: postgres.Sql) {
  await sql`
    INSERT INTO countries ${sql(
      COUNTRIES.map((c) => ({ code: c.code, name: c.name, default_timezone: c.defaultTimezone })),
    )}
    ON CONFLICT (code) DO NOTHING
  `;

  const statePairs = new Map<string, { countryCode: string; name: string }>();
  for (const city of ALL_CITIES) {
    if (city.stateName) {
      statePairs.set(`${city.countryCode}::${city.stateName}`, {
        countryCode: city.countryCode,
        name: city.stateName,
      });
    }
  }
  const states = [...statePairs.values()];
  if (states.length > 0) {
    await sql`
      INSERT INTO states ${sql(states.map((s) => ({ country_code: s.countryCode, name: s.name })))}
      ON CONFLICT (country_code, name) DO NOTHING
    `;
  }

  const stateRows = await sql<{ id: number; country_code: string; name: string }[]>`
    SELECT id, country_code, name FROM states
  `;
  const stateIdByKey = new Map(stateRows.map((r) => [`${r.country_code}::${r.name}`, r.id]));

  const existingCities = await sql<{ count: string }[]>`SELECT count(*)::text FROM cities`;
  if (Number(existingCities[0]?.count ?? 0) === 0) {
    for (const city of ALL_CITIES) {
      const stateId = city.stateName
        ? (stateIdByKey.get(`${city.countryCode}::${city.stateName}`) ?? null)
        : null;
      await sql`
        INSERT INTO cities (state_id, country_code, name, population, centroid, timezone)
        VALUES (
          ${stateId}, ${city.countryCode}, ${city.name}, ${city.population ?? null},
          ST_MakePoint(${city.lng}, ${city.lat})::geography, ${city.timezone}
        )
      `;
    }
  }

  await sql`
    INSERT INTO industries (name, slug)
    VALUES ${sql(INDUSTRIES.map((i) => [i.name, i.slug]))}
    ON CONFLICT (slug) DO NOTHING
  `;

  // Second pass: now that every industry row exists, resolve adjacency slugs to ids.
  const industryRows = await sql<{ id: number; slug: string }[]>`SELECT id, slug FROM industries`;
  const industryIdBySlug = new Map(industryRows.map((r) => [r.slug, r.id]));
  for (const industry of INDUSTRIES) {
    const adjacentIds = industry.adjacentSlugs
      .map((slug) => industryIdBySlug.get(slug))
      .filter((id): id is number => id !== undefined);
    if (adjacentIds.length > 0) {
      await sql`
        UPDATE industries SET adjacent_industry_ids = ${adjacentIds}
        WHERE slug = ${industry.slug}
      `;
    }
  }

  await sql`
    INSERT INTO skills (name, slug, functional_area, aliases)
    VALUES ${sql(SKILLS.map((s) => [s.name, s.slug, s.functionalArea, s.aliases]))}
    ON CONFLICT (slug) DO NOTHING
  `;

  await sql`
    INSERT INTO interests (name, slug)
    VALUES ${sql(INTERESTS.map((name) => [name, name.toLowerCase().replace(/[^a-z0-9]+/g, "-")]))}
    ON CONFLICT (slug) DO NOTHING
  `;

  await sql`
    INSERT INTO languages (code, name)
    VALUES ${sql(LANGUAGES.map((l) => [l.code, l.name]))}
    ON CONFLICT (code) DO NOTHING
  `;

  const complementarity = loadIntentComplementarity();
  await sql`
    INSERT INTO intent_complementarity (from_type, to_type, weight)
    VALUES ${sql(complementarity.map((c) => [c.fromType, c.toType, c.weight]))}
    ON CONFLICT (from_type, to_type) DO UPDATE SET weight = EXCLUDED.weight
  `;
}

async function ensureCurrentMessagePartition(sql: postgres.Sql) {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  const name = `messages_${start.getUTCFullYear()}_${String(start.getUTCMonth() + 1).padStart(2, "0")}`;
  await sql.unsafe(
    `CREATE TABLE IF NOT EXISTS ${name} PARTITION OF messages FOR VALUES FROM ('${start.toISOString().slice(0, 10)}') TO ('${end.toISOString().slice(0, 10)}')`,
  );
}

async function seedUsers(sql: postgres.Sql, count: number) {
  const population = generateSeedPopulation(count);

  const skillRows = await sql<{ id: number; slug: string }[]>`SELECT id, slug FROM skills`;
  const skillIdBySlug = new Map(skillRows.map((r) => [r.slug, r.id]));
  const industryRows = await sql<{ id: number; slug: string }[]>`SELECT id, slug FROM industries`;
  const industryIdBySlug = new Map(industryRows.map((r) => [r.slug, r.id]));
  const interestRows = await sql<{ id: number; name: string }[]>`SELECT id, name FROM interests`;
  const interestIdByName = new Map(interestRows.map((r) => [r.name, r.id]));
  const cityRows = await sql<{ id: number; name: string; country_code: string }[]>`
    SELECT id, name, country_code FROM cities
  `;
  const cityIdByKey = new Map(cityRows.map((r) => [`${r.country_code}::${r.name}`, r.id]));

  const userIds: string[] = [];

  for (const user of population.users) {
    const [inserted] = await sql<{ id: string }[]>`
      INSERT INTO users (email, full_name, date_of_birth, terms_version)
      VALUES (${user.email}, ${user.fullName}, ${user.dateOfBirth}, ${user.termsVersion})
      ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name
      RETURNING id
    `;
    const userId = inserted!.id;
    userIds.push(userId);

    const cityId = cityIdByKey.get(`${user.countryCode}::${user.cityName}`) ?? null;
    const industryId = industryIdBySlug.get(user.industrySlug) ?? null;

    await sql`
      INSERT INTO profiles (
        user_id, headline, about, industry_id, job_title, company_name,
        years_experience, city_id, coordinates, timezone, remote_preference,
        profile_completion
      ) VALUES (
        ${userId}, ${user.headline}, ${user.about}, ${industryId}, ${user.jobTitle},
        ${user.companyName}, ${user.yearsExperience}, ${cityId},
        ST_MakePoint(${user.lng}, ${user.lat})::geography, ${user.timezone},
        ${user.remotePreference}, 60
      )
      ON CONFLICT (user_id) DO NOTHING
    `;

    for (const slug of user.skillSlugs) {
      const skillId = skillIdBySlug.get(slug);
      if (skillId === undefined) continue;
      await sql`
        INSERT INTO user_skills (user_id, skill_id) VALUES (${userId}, ${skillId})
        ON CONFLICT (user_id, skill_id) DO NOTHING
      `;
    }

    for (const name of user.interestNames) {
      const interestId = interestIdByName.get(name);
      if (interestId === undefined) continue;
      await sql`
        INSERT INTO user_interests (user_id, interest_id) VALUES (${userId}, ${interestId})
        ON CONFLICT (user_id, interest_id) DO NOTHING
      `;
    }

    for (const code of user.languageCodes) {
      await sql`
        INSERT INTO user_languages (user_id, language_code) VALUES (${userId}, ${code})
        ON CONFLICT (user_id, language_code) DO NOTHING
      `;
    }

    for (const intent of user.intents) {
      await sql`
        INSERT INTO user_intents (user_id, type, is_primary, expires_at)
        VALUES (${userId}, ${intent.type}, ${intent.isPrimary}, now() + interval '30 days')
        ON CONFLICT DO NOTHING
      `;
    }

    if (user.availableNow) {
      await sql`
        INSERT INTO availability_sessions (user_id, state, expires_at, duration_minutes, source)
        VALUES (${userId}, 'available_now', now() + interval '60 minutes', 60, 'seed')
        ON CONFLICT DO NOTHING
      `;
    }
  }

  for (const { userIndexA, userIndexB } of population.connections) {
    const idA = userIds[userIndexA];
    const idB = userIds[userIndexB];
    if (!idA || !idB) continue;
    const [lo, hi] = idA < idB ? [idA, idB] : [idB, idA];
    await sql`
      INSERT INTO connections (user_a_id, user_b_id, requester_id)
      VALUES (${lo}, ${hi}, ${lo})
      ON CONFLICT DO NOTHING
    `;
  }

  for (const { senderIndex, recipientIndex } of population.pendingRequests) {
    const senderId = userIds[senderIndex];
    const recipientId = userIds[recipientIndex];
    if (!senderId || !recipientId) continue;
    await sql`
      INSERT INTO connection_requests (sender_id, recipient_id)
      VALUES (${senderId}, ${recipientId})
      ON CONFLICT DO NOTHING
    `;
  }

  for (const { userIndexA, userIndexB, messages } of population.conversationsWithHistory) {
    const idA = userIds[userIndexA];
    const idB = userIds[userIndexB];
    if (!idA || !idB) continue;
    const [lo, hi] = idA < idB ? [idA, idB] : [idB, idA];
    const [connection] = await sql<{ id: string }[]>`
      SELECT id FROM connections WHERE user_a_id = ${lo} AND user_b_id = ${hi} LIMIT 1
    `;
    if (!connection) continue;

    const [conversation] = await sql<{ id: string }[]>`
      INSERT INTO conversations (connection_id) VALUES (${connection.id}) RETURNING id
    `;
    if (!conversation) continue;

    await sql`
      INSERT INTO conversation_participants (conversation_id, user_id)
      VALUES (${conversation.id}, ${idA}), (${conversation.id}, ${idB})
      ON CONFLICT DO NOTHING
    `;

    let sequence = 1;
    for (const body of messages) {
      const sender = sequence % 2 === 1 ? idA : idB;
      await sql`
        INSERT INTO messages (conversation_id, sender_id, client_msg_id, sequence, body)
        VALUES (${conversation.id}, ${sender}, gen_random_uuid(), ${sequence}, ${body})
      `;
      sequence += 1;
    }
  }
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set");
  }
  const userCount = parseUserCount();

  const sql = postgres(databaseUrl, { max: 1 });
  const startedAt = Date.now();

  try {
    console.log("Seeding taxonomies (skills, industries, interests, languages, cities)...");
    await seedTaxonomies(sql);

    if (userCount > 0) {
      console.log(`Seeding ${userCount} users...`);
      await ensureCurrentMessagePartition(sql);
      await seedUsers(sql, userCount);
    }

    const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(`Done in ${elapsedSeconds}s.`);
  } finally {
    await sql.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
