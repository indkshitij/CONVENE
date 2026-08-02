import { INDIAN_CITIES, INTERNATIONAL_CITIES } from "./cities";
import { INTERESTS, LANGUAGES, SKILLS } from "./taxonomies";
import type { IntentType } from "./complementarity";

// P2.5: deterministic (seeded) Bengaluru-dense population generator.
// Pure data generation — packages/db/scripts/db-seed.ts (via scripts/db-seed.ts)
// owns turning this into actual INSERTs.

// mulberry32 — small, fast, deterministic PRNG. Same seed -> same population,
// every time, so a bug found in seeded data reproduces exactly.
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, items: readonly T[]): T {
  const item = items[Math.floor(rng() * items.length)];
  if (item === undefined) throw new Error("pick() called on an empty array");
  return item;
}

function pickN<T>(rng: () => number, items: readonly T[], n: number): T[] {
  const pool = [...items];
  const result: T[] = [];
  for (let i = 0; i < n && pool.length > 0; i++) {
    const index = Math.floor(rng() * pool.length);
    result.push(pool.splice(index, 1)[0] as T);
  }
  return result;
}

// Real Bengaluru neighbourhoods (approximate centroids) — the "Bengaluru-dense"
// requirement scatters users around these, not just the single city centroid.
const BENGALURU_NEIGHBOURHOODS: { name: string; lat: number; lng: number }[] = [
  { name: "Koramangala", lat: 12.9352, lng: 77.6245 },
  { name: "Indiranagar", lat: 12.9719, lng: 77.6412 },
  { name: "HSR Layout", lat: 12.9121, lng: 77.6446 },
  { name: "Whitefield", lat: 12.9698, lng: 77.75 },
  { name: "Electronic City", lat: 12.8452, lng: 77.6602 },
  { name: "Jayanagar", lat: 12.925, lng: 77.5938 },
  { name: "Malleshwaram", lat: 13.0034, lng: 77.5709 },
  { name: "MG Road", lat: 12.9756, lng: 77.6068 },
  { name: "JP Nagar", lat: 12.9077, lng: 77.5851 },
  { name: "Bellandur", lat: 12.9257, lng: 77.6761 },
  { name: "Marathahalli", lat: 12.9591, lng: 77.6974 },
  { name: "BTM Layout", lat: 12.9166, lng: 77.6101 },
  { name: "Yelahanka", lat: 13.1007, lng: 77.5963 },
  { name: "Hebbal", lat: 13.0358, lng: 77.597 },
  { name: "Rajajinagar", lat: 12.9915, lng: 77.5526 },
];

const FIRST_NAMES = [
  "Aarav",
  "Vivaan",
  "Aditya",
  "Vihaan",
  "Arjun",
  "Sai",
  "Reyansh",
  "Ayaan",
  "Krishna",
  "Ishaan",
  "Rohan",
  "Kabir",
  "Aryan",
  "Dhruv",
  "Karthik",
  "Nikhil",
  "Rahul",
  "Siddharth",
  "Varun",
  "Yash",
  "Ananya",
  "Diya",
  "Saanvi",
  "Aadhya",
  "Kavya",
  "Myra",
  "Anika",
  "Ira",
  "Riya",
  "Priya",
  "Sneha",
  "Neha",
  "Pooja",
  "Divya",
  "Meera",
  "Nisha",
  "Shreya",
  "Tanvi",
  "Aditi",
  "Isha",
  "Rajesh",
  "Suresh",
  "Ramesh",
  "Vikram",
  "Sanjay",
  "Anil",
  "Deepak",
  "Manoj",
  "Ravi",
  "Ajay",
  "Sunita",
  "Anjali",
  "Kiran",
  "Lakshmi",
  "Sarita",
  "Vandana",
  "Geeta",
  "Rekha",
  "Shalini",
  "Uma",
];

const LAST_NAMES = [
  "Sharma",
  "Verma",
  "Gupta",
  "Reddy",
  "Rao",
  "Nair",
  "Menon",
  "Iyer",
  "Iyengar",
  "Pillai",
  "Patel",
  "Shah",
  "Mehta",
  "Desai",
  "Kulkarni",
  "Joshi",
  "Deshpande",
  "Kumar",
  "Singh",
  "Yadav",
  "Chatterjee",
  "Banerjee",
  "Mukherjee",
  "Bose",
  "Das",
  "Gowda",
  "Shetty",
  "Hegde",
  "Bhat",
  "Kamath",
  "Krishnan",
  "Subramaniam",
  "Raman",
  "Pandey",
  "Mishra",
  "Tiwari",
  "Agarwal",
  "Bansal",
  "Jain",
  "Malhotra",
];

const INTERNATIONAL_FIRST_NAMES = [
  "James",
  "Emma",
  "Liam",
  "Olivia",
  "Noah",
  "Ava",
  "Ethan",
  "Sophia",
  "Mason",
  "Isabella",
  "Wei",
  "Yuki",
  "Min-jun",
  "Hana",
  "Chen",
  "Aisha",
  "Omar",
  "Fatima",
  "Lucas",
  "Mia",
];

const INTERNATIONAL_LAST_NAMES = [
  "Smith",
  "Johnson",
  "Williams",
  "Brown",
  "Jones",
  "Garcia",
  "Miller",
  "Davis",
  "Wilson",
  "Anderson",
  "Chen",
  "Tanaka",
  "Kim",
  "Park",
  "Wang",
  "Ahmed",
  "Ali",
  "Khan",
  "Muller",
  "Schmidt",
];

const HEADLINE_TEMPLATES = [
  "Building {role} at {company}",
  "{role} passionate about {domain}",
  "Helping teams ship {domain} products",
  "{role} | {domain} enthusiast",
  "Ex-{company} {role}",
];

const JOB_TITLES_BY_AREA: Record<string, string[]> = {
  engineering: [
    "Software Engineer",
    "Senior Software Engineer",
    "Staff Engineer",
    "Engineering Manager",
    "Backend Engineer",
    "Frontend Engineer",
    "Full-Stack Engineer",
    "DevOps Engineer",
  ],
  data: [
    "Data Scientist",
    "Machine Learning Engineer",
    "Data Analyst",
    "Data Engineer",
    "Analytics Lead",
  ],
  design: ["Product Designer", "UX Designer", "UI Designer", "Design Lead", "Visual Designer"],
  product: [
    "Product Manager",
    "Senior Product Manager",
    "Associate Product Manager",
    "Head of Product",
  ],
  growth: [
    "Growth Marketer",
    "Marketing Manager",
    "Content Marketer",
    "SEO Specialist",
    "Growth Lead",
  ],
  sales: [
    "Account Executive",
    "Business Development Manager",
    "Sales Manager",
    "Sales Development Rep",
  ],
  finance: ["Financial Analyst", "Finance Manager", "Controller", "VP Finance"],
  ops: ["Operations Manager", "Program Manager", "Chief of Staff", "Operations Lead"],
  legal: ["Legal Counsel", "Compliance Manager", "General Counsel", "Legal Operations Manager"],
};

const COMPANY_NAMES = [
  "Northwind Labs",
  "Bluepeak Technologies",
  "Verdant Systems",
  "Riverstone AI",
  "Clearline Software",
  "Solstice Analytics",
  "Ember Robotics",
  "Harborview Cloud",
  "Lumen Data",
  "Ridgeline Ventures",
  "Meridian Fintech",
  "Cobalt Health",
  "Wavecrest Commerce",
  "Ironwood Security",
  "Skyward Logistics",
];

const INTENT_TYPES: IntentType[] = [
  "looking_for_job",
  "hiring",
  "need_cofounder",
  "need_mentor",
  "need_mentee",
  "internship",
  "freelancer",
  "startup_discussion",
  "ai_collaboration",
  "business_networking",
  "coffee_chat",
  "learning",
  "investment_discussion",
  "partnerships",
];

// Complementary pairs, so the generated population actually exercises
// matching (e.g. some hiring managers exist for the looking_for_job crowd).
const INTENT_PAIRS: [IntentType, IntentType][] = [
  ["looking_for_job", "hiring"],
  ["need_mentor", "need_mentee"],
  ["need_cofounder", "need_cofounder"],
  ["startup_discussion", "investment_discussion"],
  ["freelancer", "hiring"],
  ["coffee_chat", "business_networking"],
  ["learning", "need_mentee"],
];

function weightedExperienceYears(rng: () => number): number {
  // Weighted toward 0-8 years (P2.5): 85% of users fall in that band,
  // skewed toward the low end (Math.pow pulls the distribution left, so it
  // peaks around 2-3 years rather than being uniform); a thin 8-12 year tail
  // for realism, kept small enough that it doesn't drag the average out of
  // the intended 0-8 range.
  const roll = rng();
  if (roll < 0.85) return Math.round(Math.pow(rng(), 1.5) * 8 * 10) / 10;
  return Math.round((8 + rng() * 4) * 10) / 10;
}

export type GeneratedUser = {
  email: string;
  fullName: string;
  dateOfBirth: string;
  termsVersion: string;
  headline: string;
  about: string;
  jobTitle: string;
  companyName: string;
  industrySlug: string;
  yearsExperience: number;
  cityName: string;
  countryCode: string;
  lat: number;
  lng: number;
  timezone: string;
  remotePreference: "onsite" | "hybrid" | "remote" | "any";
  skillSlugs: string[];
  interestNames: string[];
  languageCodes: string[];
  intents: { type: IntentType; isPrimary: boolean; detail: string | null }[];
  availableNow: boolean;
};

export type GeneratedPopulation = {
  users: GeneratedUser[];
  /** Index pairs into `users`, already-connected. */
  connections: { userIndexA: number; userIndexB: number }[];
  /** Index pairs into `users`, a pending connection request sender -> recipient. */
  pendingRequests: { senderIndex: number; recipientIndex: number }[];
  /** Connected pairs that additionally get a conversation with message history. */
  conversationsWithHistory: { userIndexA: number; userIndexB: number; messages: string[] }[];
};

const SAMPLE_MESSAGES = [
  "Hey! Really enjoyed reading your profile, would love to connect.",
  "Thanks for accepting — what are you currently focused on?",
  "I'm exploring a similar space right now, happy to compare notes.",
  "That's a great point. Have you looked at how others in the space handle it?",
  "Let's find some time this week to chat further.",
  "Sounds good, I'll follow up with a few times that work for me.",
];

export function generateSeedPopulation(count: number, seed = 42): GeneratedPopulation {
  const rng = mulberry32(seed);
  const users: GeneratedUser[] = [];

  const functionalAreas = Object.keys(JOB_TITLES_BY_AREA);

  for (let i = 0; i < count; i++) {
    // ~70% Bengaluru (scattered across neighbourhoods), ~20% other Indian
    // cities, ~10% international — the "Bengaluru-dense" requirement.
    const locationRoll = rng();
    let cityName: string;
    let countryCode: string;
    let lat: number;
    let lng: number;
    let timezone: string;

    if (locationRoll < 0.7) {
      const neighbourhood = pick(rng, BENGALURU_NEIGHBOURHOODS);
      cityName = "Bengaluru";
      countryCode = "IN";
      // Jitter within roughly a couple of km of the neighbourhood centroid.
      lat = neighbourhood.lat + (rng() - 0.5) * 0.03;
      lng = neighbourhood.lng + (rng() - 0.5) * 0.03;
      timezone = "Asia/Kolkata";
    } else if (locationRoll < 0.9) {
      const city = pick(rng, INDIAN_CITIES);
      cityName = city.name;
      countryCode = city.countryCode;
      lat = city.lat + (rng() - 0.5) * 0.05;
      lng = city.lng + (rng() - 0.5) * 0.05;
      timezone = city.timezone;
    } else {
      const city = pick(rng, INTERNATIONAL_CITIES);
      cityName = city.name;
      countryCode = city.countryCode;
      lat = city.lat + (rng() - 0.5) * 0.05;
      lng = city.lng + (rng() - 0.5) * 0.05;
      timezone = city.timezone;
    }

    const isIndian = countryCode === "IN";
    const firstName = pick(rng, isIndian ? FIRST_NAMES : INTERNATIONAL_FIRST_NAMES);
    const lastName = pick(rng, isIndian ? LAST_NAMES : INTERNATIONAL_LAST_NAMES);
    const fullName = `${firstName} ${lastName}`;
    const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}${i}@example.com`;

    const area = pick(rng, functionalAreas);
    const areaSkills = SKILLS.filter((s) => s.functionalArea === area);
    const skillSlugs = pickN(rng, areaSkills, 3 + Math.floor(rng() * 6)).map((s) => s.slug);
    const jobTitle = pick(rng, JOB_TITLES_BY_AREA[area] ?? ["Professional"]);
    const companyName = pick(rng, COMPANY_NAMES);
    const yearsExperience = weightedExperienceYears(rng);

    const headline = pick(rng, HEADLINE_TEMPLATES)
      .replace("{role}", jobTitle)
      .replace("{company}", companyName)
      .replace("{domain}", area);
    const about = `${jobTitle} with ${yearsExperience} years of experience in ${area}. Based in ${cityName}, open to new connections.`;

    const interestNames = pickN(rng, INTERESTS, 3 + Math.floor(rng() * 6));
    const languageCodes = pickN(
      rng,
      isIndian
        ? ["en", "hi"].concat(
            pickN(
              rng,
              LANGUAGES.map((l) => l.code),
              2,
            ),
          )
        : ["en"],
      2 + Math.floor(rng() * 2),
    );

    // Intents: draw from a complementary pair ~60% of the time (so demand
    // and supply actually overlap), a random single intent otherwise.
    const intents: GeneratedUser["intents"] = [];
    if (rng() < 0.6) {
      const [a, b] = pick(rng, INTENT_PAIRS);
      const chosen = rng() < 0.5 ? a : b;
      intents.push({ type: chosen, isPrimary: true, detail: null });
    } else {
      intents.push({ type: pick(rng, INTENT_TYPES), isPrimary: true, detail: null });
    }
    if (rng() < 0.3) {
      const secondary = pick(rng, INTENT_TYPES);
      if (secondary !== intents[0]?.type) {
        intents.push({ type: secondary, isPrimary: false, detail: null });
      }
    }

    const industrySlug = ["software", "saas", "fintech", "healthtech", "e-commerce"][
      Math.floor(rng() * 5)
    ] as string;

    users.push({
      email,
      fullName,
      dateOfBirth: `${1985 + Math.floor(rng() * 20)}-${String(1 + Math.floor(rng() * 12)).padStart(2, "0")}-${String(1 + Math.floor(rng() * 28)).padStart(2, "0")}`,
      termsVersion: "v1",
      headline,
      about,
      jobTitle,
      companyName,
      industrySlug,
      yearsExperience,
      cityName,
      countryCode,
      lat,
      lng,
      timezone,
      remotePreference: pick(rng, ["onsite", "hybrid", "remote", "any"] as const),
      skillSlugs,
      interestNames,
      languageCodes,
      intents,
      // ~15% currently available (P2.5 acceptance criterion).
      availableNow: rng() < 0.15,
    });
  }

  // Relationships: connect ~8% of all possible adjacent-index pairs (cheap
  // proxy for "some connected pairs" without an O(n^2) pass), a handful of
  // pending requests, and give a third of connections a short message history.
  const connections: GeneratedPopulation["connections"] = [];
  const pendingRequests: GeneratedPopulation["pendingRequests"] = [];
  const conversationsWithHistory: GeneratedPopulation["conversationsWithHistory"] = [];

  for (let i = 0; i < users.length; i++) {
    for (let j = i + 1; j < Math.min(i + 12, users.length); j++) {
      if (rng() < 0.12) {
        connections.push({ userIndexA: i, userIndexB: j });
        if (rng() < 0.35) {
          const messageCount = 2 + Math.floor(rng() * 4);
          conversationsWithHistory.push({
            userIndexA: i,
            userIndexB: j,
            messages: pickN(rng, SAMPLE_MESSAGES, messageCount),
          });
        }
      } else if (rng() < 0.03) {
        pendingRequests.push({ senderIndex: i, recipientIndex: j });
      }
    }
  }

  return { users, connections, pendingRequests, conversationsWithHistory };
}
