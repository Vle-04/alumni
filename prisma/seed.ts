/**
 * Realistic fake data for development and demos:
 * 3 programs, 6 cohorts, ~300 graduates with varied outcomes (incl. non-responders),
 * 10 partner companies + non-partners, 25 openings, 60 referrals across every stage.
 *
 *   npm run db:seed            (refuses to run on a non-empty database)
 *   npm run db:reset           (drops everything, migrates, seeds)
 *
 * All data is fictional. Deterministic (fixed random seed).
 */
try {
  process.loadEnvFile(".env");
} catch {
  /* env provided by the environment */
}

import { faker } from "@faker-js/faker";
import { PrismaClient, type EmploymentStatus, type ReferralStatus, type SalaryBand, type RemoteMode, type Seniority } from "@prisma/client";
import { blindIndex, encrypt } from "../src/server/crypto";
import { DEFAULT_SKILL_SYNONYMS } from "../src/domain/skills/normalize";
import { addDays, addMonthsUtc } from "../src/domain/records/staleness";
import { normalizeCompanyName } from "../src/domain/companies/normalize";
import { MILESTONES } from "../src/domain/enums";

const prisma = new PrismaClient();
faker.seed(20261117);
const NOW = new Date();
const POLICY = process.env.PRIVACY_POLICY_VERSION ?? "2026-01";

const pick = <T>(arr: readonly T[]): T => faker.helpers.arrayElement(arr as T[]);
const chance = (p: number) => faker.number.float({ min: 0, max: 1 }) < p;
const int = (min: number, max: number) => faker.number.int({ min, max });

// ─── Reference data ───────────────────────────────────────────────

const PROGRAMS = [
  { name: "Full-Stack Web Development", roles: ["frontend", "backend", "software_engineering"], skills: ["JavaScript", "TypeScript", "React", "Node.js", "HTML", "CSS", "PostgreSQL", "Git", "Docker", "Next.js"] },
  { name: "Data Analytics", roles: ["data_analytics", "data_science"], skills: ["SQL", "Python", "Excel", "Power BI", "Tableau", "Pandas", "Machine Learning", "PostgreSQL", "Git"] },
  { name: "QA & Software Testing", roles: ["qa_testing", "software_engineering"], skills: ["Manual Testing", "Selenium", "JavaScript", "SQL", "Git", "Linux", "Java", "Docker"] },
] as const;

const COHORTS: { program: number; name: string; start: string; grad: string; size: number }[] = [
  { program: 0, name: "Web Dev 2024 Spring", start: "2024-01-15", grad: "2024-06-28", size: 55 },
  { program: 1, name: "Data 2024 Autumn", start: "2024-07-08", grad: "2024-12-20", size: 45 },
  { program: 2, name: "QA 2025 Spring", start: "2025-01-13", grad: "2025-06-27", size: 40 },
  { program: 0, name: "Web Dev 2025 Spring", start: "2025-02-03", grad: "2025-07-18", size: 60 },
  { program: 1, name: "Data 2025 Autumn", start: "2025-07-07", grad: "2025-12-19", size: 50 },
  { program: 0, name: "Web Dev 2026 Spring", start: "2026-01-12", grad: "2026-06-26", size: 50 },
];

const PARTNERS = [
  ["Northwind Software", "Software"], ["Bluepeak Analytics", "Data & analytics"], ["Cedar Health Tech", "Healthcare"],
  ["Lumen Fintech", "Financial services"], ["Orbit Logistics", "Logistics"], ["Brightline Studios", "Media"],
  ["Quanta Cloud", "Cloud infrastructure"], ["Harbor Retail Group", "Retail"], ["Vertex Security", "Cybersecurity"],
  ["Greenfield EdTech", "Education"],
] as const;
const NON_PARTNERS = [
  ["Riverbend Bank", "Banking"], ["Summit Telecom", "Telecom"], ["Pixelwave Media", "Media"], ["Ironclad Systems", "Software"],
  ["Maple Consulting", "Consulting"], ["Nimbus Labs", "Software"], ["Silverline Insurance", "Insurance"], ["Kite Mobility", "Transport"],
  ["Atlas Freight", "Logistics"], ["Coral Commerce", "E-commerce"], ["Pinecrest Games", "Gaming"], ["Delta Data Works", "Data & analytics"],
] as const;

const CITIES = [
  ["Berlin", "Germany"], ["Lisbon", "Portugal"], ["Warsaw", "Poland"], ["Tallinn", "Estonia"], ["Vilnius", "Lithuania"],
  ["Prague", "Czechia"], ["Valencia", "Spain"], ["Remote", null],
] as const;
const TZ: Record<string, string> = { Germany: "Europe/Berlin", Portugal: "Europe/Lisbon", Poland: "Europe/Warsaw", Estonia: "Europe/Tallinn", Lithuania: "Europe/Vilnius", Czechia: "Europe/Prague", Spain: "Europe/Madrid" };

const TITLES: Record<string, string[]> = {
  frontend: ["Junior Frontend Developer", "Frontend Engineer", "UI Developer"],
  backend: ["Junior Backend Developer", "Node.js Developer", "API Developer"],
  software_engineering: ["Junior Software Engineer", "Full-Stack Developer", "Software Developer"],
  data_analytics: ["Junior Data Analyst", "BI Analyst", "Reporting Analyst"],
  data_science: ["Junior Data Scientist", "ML Engineer (Junior)"],
  qa_testing: ["QA Engineer", "Manual Tester", "Test Automation Engineer"],
  other: ["Customer Success Specialist", "Operations Assistant", "Sales Associate"],
};
const BANDS: SalaryBand[] = ["band_500_1000", "band_1000_1500", "band_1000_1500", "band_1500_2500", "band_1500_2500", "band_2500_4000", "prefer_not_to_say"];
const BLOCKERS = ["not enough experience", "no portfolio yet", "interview practice", "few junior openings", "visa / relocation", "time constraints"];
const HELP = ["CV review", "mock interview", "portfolio feedback", "introductions to companies", "mentoring"];

async function main() {
  if ((await prisma.graduate.count()) > 0) {
    console.log("Database already has graduates — skipping seed. Use `npm run db:reset` to start fresh.");
    return;
  }
  console.log("Seeding…");

  // Staff
  await prisma.user.createMany({
    data: [
      { email: "admin@academy.example", name: "Ada Admin", role: "ADMIN" },
      { email: "careers@academy.example", name: "Casey Careers", role: "CAREER_SERVICES" },
      { email: "careers2@academy.example", name: "Robin Placement", role: "CAREER_SERVICES" },
      { email: "marketing@academy.example", name: "Morgan Marketing", role: "LEADERSHIP" },
    ],
  });
  const careers = await prisma.user.findUniqueOrThrow({ where: { email: "careers@academy.example" } });
  const careers2 = await prisma.user.findUniqueOrThrow({ where: { email: "careers2@academy.example" } });
  const staffIds = [careers.id, careers2.id];

  // Skills & synonyms
  const skillIds = new Map<string, string>();
  for (const [name, aliases] of Object.entries(DEFAULT_SKILL_SYNONYMS)) {
    const s = await prisma.skill.create({ data: { canonicalName: name, synonyms: { create: aliases.map((alias) => ({ alias })) } } });
    skillIds.set(name, s.id);
  }

  // Companies
  const companies: { id: string; name: string; partner: boolean }[] = [];
  for (const [name, industry] of PARTNERS) {
    const c = await prisma.company.create({ data: { canonicalName: name, industry, isPartner: true, aliases: { create: { alias: normalizeCompanyName(name) } } } });
    companies.push({ id: c.id, name, partner: true });
  }
  for (const [name, industry] of NON_PARTNERS) {
    const c = await prisma.company.create({ data: { canonicalName: name, industry, aliases: { create: { alias: normalizeCompanyName(name) } } } });
    companies.push({ id: c.id, name, partner: false });
  }
  // A near-duplicate typed by a graduate, waiting for staff to confirm the merge.
  const dup = await prisma.company.create({ data: { canonicalName: "Northwind Software Europe", aliases: { create: { alias: normalizeCompanyName("Northwind Software Europe") } } } });
  await prisma.companyMergeSuggestion.create({ data: { sourceCompanyId: dup.id, targetCompanyId: companies[0]!.id, similarity: 0.85 } });

  // Partner contacts (for the tokenized partner portal)
  for (const c of companies.filter((x) => x.partner)) {
    const email = `hiring@${c.name.toLowerCase().replace(/[^a-z]+/g, "")}.example`;
    await prisma.partnerContact.create({ data: { companyId: c.id, name: `${faker.person.firstName()} ${faker.person.lastName()}`, emailEnc: encrypt(email), emailHash: blindIndex(email) } });
  }

  // Programs & cohorts
  const programIds: string[] = [];
  for (const p of PROGRAMS) programIds.push((await prisma.program.create({ data: { name: p.name } })).id);

  let gradCount = 0;
  const searchingGrads: { id: string; program: number; since: Date }[] = [];

  for (const c of COHORTS) {
    const program = PROGRAMS[c.program]!;
    const gradDate = new Date(`${c.grad}T00:00:00Z`);
    const cohort = await prisma.cohort.create({
      data: { programId: programIds[c.program]!, name: c.name, startDate: new Date(`${c.start}T00:00:00Z`), graduationDate: gradDate, plannedSize: c.size },
    });

    for (let i = 0; i < c.size; i++) {
      const first = faker.person.firstName();
      const last = faker.person.lastName();
      const email = `${first}.${last}.${++gradCount}@mail.example`.toLowerCase().replace(/[^a-z0-9.@]/g, "");
      const [city, country] = pick(CITIES);
      const skills = faker.helpers.arrayElements(program.skills as unknown as string[], int(3, 7));
      const prefRoles = faker.helpers.arrayElements(program.roles as unknown as string[], int(1, 2));

      const g = await prisma.graduate.create({
        data: {
          cohortId: cohort.id,
          fullName: `${first} ${last}`,
          preferredName: chance(0.1) ? first : null,
          emailEnc: encrypt(email),
          emailHash: blindIndex(email),
          phoneEnc: chance(0.6) ? encrypt(faker.phone.number({ style: "international" })) : null,
          linkedinUrlEnc: chance(0.5) ? encrypt(`https://www.linkedin.com/in/${first}-${last}-${gradCount}`.toLowerCase()) : null,
          city: city === "Remote" ? null : city,
          country,
          timezone: country ? TZ[country] ?? null : null,
          remotePreference: pick(["remote_only", "hybrid", "onsite", "any", "any"] as const),
          openToRelocate: chance(0.3),
          preferredRoleCategories: prefRoles,
          skills: { create: skills.map((s) => ({ skillId: skillIds.get(s)!, level: int(2, 5) })) },
        },
      });

      // Consent
      const consents: [string, number][] = [["outcomes_reporting", 0.92], ["job_matching", 0.75], ["share_with_partners", 0.6], ["marketing_testimonial", 0.15]];
      for (const [purpose, p] of consents) {
        if (chance(p)) await prisma.consent.create({ data: { graduateId: g.id, purpose: purpose as never, policyVersion: POLICY, source: "seed", grantedAt: gradDate } });
      }

      // ── Simulated outcome ──
      // responsiveness: 15% never answer anything; others answer each survey with 55–90% probability.
      const neverResponds = chance(0.15);
      const responseRate = neverResponds ? 0 : faker.number.float({ min: 0.55, max: 0.9 });
      const outcomeRoll = faker.number.float({ min: 0, max: 1 });
      // ~72% find work (time to first job skewed: median ~4 months), 8% further study, 5% not searching, rest keep searching.
      let jobStartDays: number | null = null;
      let altStatus: EmploymentStatus = "searching";
      if (outcomeRoll < 0.72) jobStartDays = Math.round(Math.min(420, faker.number.float({ min: 0, max: 1 }) ** 1.6 * 400) - 20); // some start before graduation
      else if (outcomeRoll < 0.8) altStatus = "further_study";
      else if (outcomeRoll < 0.85) altStatus = "not_searching";

      const roleCat = chance(0.82) ? pick(prefRoles) : "other";
      const inField = roleCat !== "other";
      const company = pick(chance(0.35) ? companies.filter((x) => x.partner) : companies.filter((x) => !x.partner));
      const status: EmploymentStatus = pick(["employed_full_time", "employed_full_time", "employed_full_time", "employed_part_time", "freelance_contract", "internship"] as const);
      const jobStart = jobStartDays !== null ? addDays(gradDate, jobStartDays) : null;
      const band = pick(BANDS);
      const title = pick(TITLES[roleCat] ?? TITLES.other!);

      for (const m of MILESTONES) {
        const due = addMonthsUtc(gradDate, m);
        due.setUTCHours(9, 0, 0, 0);
        if (due > NOW) {
          await prisma.surveyInstance.create({ data: { graduateId: g.id, milestone: m, scheduledFor: due, status: "scheduled" } });
          continue;
        }
        const answered = chance(responseRate);
        const sentAt = due;
        if (!answered) {
          const bounced = chance(0.03);
          await prisma.surveyInstance.create({
            data: { graduateId: g.id, milestone: m, scheduledFor: due, sentAt, status: bounced ? "bounced" : "sent", reminderCount: bounced ? 0 : 2, lastReminderAt: bounced ? null : addDays(sentAt, 10), openedAt: chance(0.3) ? addDays(sentAt, 1) : null },
          });
          continue;
        }
        const completedAt = addDays(sentAt, int(0, 9));
        const survey = await prisma.surveyInstance.create({
          data: { graduateId: g.id, milestone: m, scheduledFor: due, sentAt, openedAt: completedAt, completedAt, status: "completed", reminderCount: completedAt > addDays(sentAt, 4) ? 1 : 0 },
        });
        const employedNow = jobStart !== null && jobStart <= completedAt;
        const st: EmploymentStatus = employedNow ? status : altStatus;
        await prisma.employmentRecord.create({
          data: {
            graduateId: g.id,
            status: st,
            source: `survey_${m}m` as never,
            surveyInstanceId: survey.id,
            reportedAt: completedAt,
            ...(employedNow
              ? { companyId: company.id, roleTitle: title, roleCategory: roleCat, inField, startDate: jobStart, employmentType: status === "employed_part_time" ? "part_time" : status === "freelance_contract" ? "contract" : status === "internship" ? "internship" : "full_time", salaryBand: chance(0.7) ? band : null }
              : st === "searching" ? { searchBlockers: faker.helpers.arrayElements(BLOCKERS, int(1, 2)), helpWanted: faker.helpers.arrayElements(HELP, int(1, 2)) } : {}),
          },
        });
        await prisma.surveyResponse.create({ data: { surveyInstanceId: survey.id, answers: { status: st, seeded: true } } });
      }
      // Occasional self-update between surveys
      if (!neverResponds && chance(0.15) && jobStart && jobStart < addDays(NOW, -10)) {
        const at = new Date(Math.min(NOW.getTime() - 86_400_000, jobStart.getTime() + int(1, 20) * 86_400_000));
        await prisma.employmentRecord.create({ data: { graduateId: g.id, status, companyId: company.id, roleTitle: title, roleCategory: roleCat, inField, startDate: jobStart, source: "self_update", reportedAt: at } });
        await prisma.graduate.update({ where: { id: g.id }, data: { lastSelfUpdateAt: at } });
      }

      // Refresh cached current status
      const latest = await prisma.employmentRecord.findFirst({ where: { graduateId: g.id }, orderBy: { reportedAt: "desc" } });
      if (latest) {
        let searchingSince: Date | null = null;
        if (latest.status === "searching") {
          const firstSearch = await prisma.employmentRecord.findFirst({ where: { graduateId: g.id, status: "searching" }, orderBy: { reportedAt: "asc" } });
          searchingSince = firstSearch?.reportedAt ?? latest.reportedAt;
          searchingGrads.push({ id: g.id, program: c.program, since: searchingSince });
        }
        await prisma.graduate.update({ where: { id: g.id }, data: { currentStatus: latest.status, currentStatusAt: latest.reportedAt, currentInField: latest.inField, searchingSince, jobSearchStatus: latest.status === "searching" ? "active" : chance(0.2) ? "open_to_offers" : "not_looking" } });
      } else if (gradDate > addDays(NOW, -40)) {
        // Recent graduates who haven't had a survey yet are actively searching.
        await prisma.graduate.update({ where: { id: g.id }, data: { jobSearchStatus: "active" } });
      }
    }
  }

  // ─── Openings ──────────────────────────────────────────────
  const partnerCos = companies.filter((c) => c.partner);
  const openingSpecs: { program: number; roleCat: string }[] = [
    ...Array.from({ length: 12 }, () => ({ program: 0, roleCat: pick(["frontend", "backend", "software_engineering"]) })),
    ...Array.from({ length: 8 }, () => ({ program: 1, roleCat: pick(["data_analytics", "data_science"]) })),
    ...Array.from({ length: 5 }, () => ({ program: 2, roleCat: "qa_testing" })),
  ];
  const openings: { id: string; program: number; companyId: string; title: string }[] = [];
  for (const [i, spec] of openingSpecs.entries()) {
    const co = partnerCos[i % partnerCos.length]!;
    const skills = faker.helpers.arrayElements(PROGRAMS[spec.program]!.skills as unknown as string[], int(3, 5));
    const status = i < 2 ? "pending_moderation" : i < 4 ? "closed" : i === 4 ? "paused" : "open";
    const [city, country] = pick(CITIES.filter((c) => c[1]));
    const title = pick(TITLES[spec.roleCat]!);
    const o = await prisma.opening.create({
      data: {
        companyId: co.id,
        title,
        description: `${co.name} is hiring a ${title.toLowerCase()} to join a friendly team. You'll work on real products with mentoring from senior colleagues.`,
        roleCategory: spec.roleCat,
        city,
        country,
        remoteMode: pick(["remote", "hybrid", "onsite"] as RemoteMode[]),
        seniority: pick(["junior", "junior", "intern", "mid"] as Seniority[]),
        salaryBand: pick(BANDS.filter((b) => b !== "prefer_not_to_say")),
        deadline: addDays(NOW, int(-20, 60)),
        status,
        source: i < 2 ? "partner_form" : "staff",
        createdById: i < 2 ? null : pick(staffIds),
        createdAt: addDays(NOW, -int(5, 120)),
        skills: { create: skills.map((s, k) => ({ skillId: skillIds.get(s)!, weight: int(2, 5), mustHave: k === 0 })) },
      },
    });
    openings.push({ id: o.id, program: spec.program, companyId: co.id, title });
  }

  // ─── Referrals: 60 across every stage ─────────────────────
  const PIPE: ReferralStatus[] = ["suggested", "graduate_interested", "referred", "interviewing", "offer", "hired"];
  const plan: ReferralStatus[] = [
    ...Array(8).fill("suggested"), ...Array(8).fill("graduate_interested"), ...Array(10).fill("referred"), ...Array(9).fill("interviewing"),
    ...Array(5).fill("offer"), ...Array(9).fill("hired"), ...Array(8).fill("rejected"), ...Array(3).fill("withdrawn"),
  ];
  const used = new Set<string>();
  const shuffled = faker.helpers.shuffle(searchingGrads);
  let gi = 0;
  for (const target of plan) {
    let grad: (typeof searchingGrads)[number] | undefined;
    let opening: (typeof openings)[number] | undefined;
    for (let tries = 0; tries < 50 && !opening; tries++) {
      grad = shuffled[gi++ % shuffled.length]!;
      const candidates = openings.filter((o) => o.program === grad!.program && !used.has(`${o.id}:${grad!.id}`));
      opening = candidates.length ? pick(candidates) : undefined;
    }
    if (!grad || !opening) continue;
    used.add(`${opening.id}:${grad.id}`);
    const path: ReferralStatus[] = target === "rejected" || target === "withdrawn"
      ? [...PIPE.slice(0, int(2, 4)), target]
      : PIPE.slice(0, PIPE.indexOf(target) + 1);
    let at = new Date(Math.max(grad.since.getTime(), addDays(NOW, -150).getTime()));
    const ref = await prisma.referral.create({ data: { openingId: opening.id, graduateId: grad.id, referredById: pick(staffIds), status: path.at(-1)!, createdAt: at, statusChangedAt: at } });
    let prev: ReferralStatus | null = null;
    for (const s of path) {
      at = addDays(at, prev === null ? 0 : int(2, 12));
      if (at > NOW) at = addDays(NOW, -1);
      await prisma.referralTransition.create({ data: { referralId: ref.id, fromStatus: prev, toStatus: s, actorId: pick(staffIds), at } });
      prev = s;
    }
    await prisma.referral.update({ where: { id: ref.id }, data: { statusChangedAt: at } });
    if (path.includes("graduate_interested")) {
      await prisma.matchNotification.create({ data: { openingId: opening.id, graduateId: grad.id, sentById: pick(staffIds), sentAt: ref.createdAt, score: int(55, 92), response: "interested", respondedAt: addDays(ref.createdAt, 1) } });
    }
    if (target === "hired") {
      const rec = await prisma.employmentRecord.create({
        data: { graduateId: grad.id, status: "employed_full_time", companyId: opening.companyId, roleTitle: opening.title, inField: true, startDate: addDays(at, 14), employmentType: "full_time", source: "referral_hire", reportedAt: at, verifiedById: careers.id },
      });
      await prisma.referral.update({ where: { id: ref.id }, data: { hireRecordId: rec.id } });
      await prisma.graduate.update({ where: { id: grad.id }, data: { currentStatus: "employed_full_time", currentStatusAt: at, currentInField: true, searchingSince: null, jobSearchStatus: "not_looking" } });
    }
  }

  const counts = {
    graduates: await prisma.graduate.count(),
    records: await prisma.employmentRecord.count(),
    surveys: await prisma.surveyInstance.count(),
    openings: await prisma.opening.count(),
    referrals: await prisma.referral.count(),
  };
  console.log("Seed complete:", counts);
  console.log("Staff sign-in emails: admin@academy.example, careers@academy.example, marketing@academy.example (links appear in Mailpit at http://localhost:8025)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
