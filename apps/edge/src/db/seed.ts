/** Programmatic mock CRM seed (15 appliance jobs). */

function hoursFromNow(h: number): string {
  return new Date(Date.now() + h * 3600 * 1000).toISOString();
}

function daysFromNow(d: number, hourUTC = 14): string {
  const t = new Date();
  t.setUTCDate(t.getUTCDate() + d);
  t.setUTCHours(hourUTC, 0, 0, 0);
  return t.toISOString();
}

const TECHS = [
  {
    id: "tech-mike",
    name: "Mike R.",
    skills: "refrigeration,compressor,sub-zero,general",
    zone: "north",
  },
  {
    id: "tech-ana",
    name: "Ana K.",
    skills: "dishwasher,bosch,general",
    zone: "central",
  },
  {
    id: "tech-lee",
    name: "Lee P.",
    skills: "laundry,miele,gaggenau,dishwasher,general",
    zone: "south",
  },
  {
    id: "tech-sam",
    name: "Sam T.",
    skills: "refrigeration,dishwasher,general",
    zone: "north",
  },
  {
    id: "tech-rio",
    name: "Rio V.",
    skills: "cooking,bosch,dishwasher,general",
    zone: "central",
  },
] as const;

const CUSTOMERS = [
  { id: "cust-sarah", name: "Sarah Chen", phone: "+15550104200", zone: "north" },
  { id: "cust-omar", name: "Omar Diaz", phone: "+15550108800", zone: "central" },
  { id: "cust-3", name: "Priya Nair", phone: "+15550100003", zone: "south" },
  { id: "cust-4", name: "James Okonkwo", phone: "+15550100004", zone: "north" },
  { id: "cust-5", name: "Elena Rossi", phone: "+15550100005", zone: "central" },
  { id: "cust-6", name: "Tom Nguyen", phone: "+15550100006", zone: "south" },
  { id: "cust-7", name: "Aisha Rahman", phone: "+15550100007", zone: "north" },
  { id: "cust-8", name: "Ben Adler", phone: "+15550100008", zone: "central" },
] as const;

type SeedJob = {
  id: string;
  phone: string;
  customer_name: string;
  appliance: string;
  model_serial: string | null;
  status: string;
  parts_status: string;
  parts_eta: string | null;
  assigned_tech_id: string | null;
  scheduled_at: string | null;
  zone: string;
  skill: string;
};

function buildJobs(): SeedJob[] {
  return [
    {
      id: "1042",
      phone: "+15550104200",
      customer_name: "Sarah Chen",
      appliance: "Sub-Zero Refrigerator",
      model_serial: "WRF535SWHZ04",
      status: "Pending Parts (Compressor #4201890 - Arrived)",
      parts_status: "in_stock",
      parts_eta: hoursFromNow(-6),
      assigned_tech_id: "tech-mike",
      scheduled_at: daysFromNow(3, 10),
      zone: "north",
      skill: "refrigeration",
    },
    {
      id: "1088",
      phone: "+15550108800",
      customer_name: "Omar Diaz",
      appliance: "Bosch Dishwasher",
      model_serial: "SHPM65Z55N",
      status: "Scheduled",
      parts_status: "none",
      parts_eta: null,
      assigned_tech_id: "tech-ana",
      scheduled_at: hoursFromNow(14),
      zone: "central",
      skill: "dishwasher",
    },
    {
      id: "1101",
      phone: "+15550100003",
      customer_name: "Priya Nair",
      appliance: "Miele Washer",
      model_serial: "WWH860WCS",
      status: "Pending Parts",
      parts_status: "backordered",
      parts_eta: daysFromNow(5, 9),
      assigned_tech_id: "tech-lee",
      scheduled_at: null,
      zone: "south",
      skill: "laundry",
    },
    {
      id: "1102",
      phone: "+15550100004",
      customer_name: "James Okonkwo",
      appliance: "Gaggenau Oven",
      model_serial: "BO481611",
      status: "Diagnostic Complete",
      parts_status: "in_stock",
      parts_eta: hoursFromNow(-24),
      assigned_tech_id: "tech-lee",
      scheduled_at: daysFromNow(2, 12),
      zone: "south",
      skill: "gaggenau",
    },
    {
      id: "1103",
      phone: "+15550100005",
      customer_name: "Elena Rossi",
      appliance: "Bosch Range",
      model_serial: "HGI8056UC",
      status: "Scheduled",
      parts_status: "none",
      parts_eta: null,
      assigned_tech_id: "tech-rio",
      scheduled_at: daysFromNow(1, 8),
      zone: "central",
      skill: "cooking",
    },
    {
      id: "1104",
      phone: "+15550100006",
      customer_name: "Tom Nguyen",
      appliance: "Miele Dishwasher",
      model_serial: "G7566SCVISF",
      status: "Open",
      parts_status: "none",
      parts_eta: null,
      assigned_tech_id: "tech-ana",
      scheduled_at: daysFromNow(4, 14),
      zone: "south",
      skill: "dishwasher",
    },
    {
      id: "1105",
      phone: "+15550100007",
      customer_name: "Aisha Rahman",
      appliance: "Sub-Zero Wine Cooler",
      model_serial: "IW-24",
      status: "Pending Parts",
      parts_status: "backordered",
      parts_eta: daysFromNow(8, 11),
      assigned_tech_id: "tech-mike",
      scheduled_at: null,
      zone: "north",
      skill: "refrigeration",
    },
    {
      id: "1106",
      phone: "+15550100008",
      customer_name: "Ben Adler",
      appliance: "Whirlpool Fridge",
      model_serial: "WRF535SWHZ04",
      status: "Scheduled",
      parts_status: "none",
      parts_eta: null,
      assigned_tech_id: "tech-sam",
      scheduled_at: daysFromNow(2, 16),
      zone: "north",
      skill: "refrigeration",
    },
    {
      id: "1107",
      phone: "+15550100003",
      customer_name: "Priya Nair",
      appliance: "Bosch Dryer",
      model_serial: "WTG86401UC",
      status: "Completed",
      parts_status: "none",
      parts_eta: null,
      assigned_tech_id: "tech-lee",
      scheduled_at: hoursFromNow(-48),
      zone: "south",
      skill: "laundry",
    },
    {
      id: "1108",
      phone: "+15550104200",
      customer_name: "Sarah Chen",
      appliance: "Ice Maker Service",
      model_serial: null,
      status: "cancelled",
      parts_status: "none",
      parts_eta: null,
      assigned_tech_id: "tech-sam",
      scheduled_at: hoursFromNow(-120),
      zone: "north",
      skill: "refrigeration",
    },
    {
      id: "1109",
      phone: "+15550100004",
      customer_name: "James Okonkwo",
      appliance: "Gaggenau Cooktop",
      model_serial: "VI422611",
      status: "Open",
      parts_status: "none",
      parts_eta: null,
      assigned_tech_id: null,
      scheduled_at: null,
      zone: "south",
      skill: "gaggenau",
    },
    {
      id: "1110",
      phone: "+15550100005",
      customer_name: "Elena Rossi",
      appliance: "Bosch Refrigerator",
      model_serial: "B36CL80SNS",
      status: "Pending Parts",
      parts_status: "in_stock",
      parts_eta: hoursFromNow(-2),
      assigned_tech_id: "tech-rio",
      scheduled_at: daysFromNow(2, 10),
      zone: "central",
      skill: "refrigeration",
    },
    {
      id: "1111",
      phone: "+15550100006",
      customer_name: "Tom Nguyen",
      appliance: "Miele Hood",
      model_serial: "DAR1220",
      status: "Scheduled",
      parts_status: "none",
      parts_eta: null,
      assigned_tech_id: "tech-lee",
      scheduled_at: daysFromNow(6, 9),
      zone: "south",
      skill: "miele",
    },
    {
      id: "1112",
      phone: "+15550100007",
      customer_name: "Aisha Rahman",
      appliance: "Whirlpool Washer",
      model_serial: "WTW5000DW",
      status: "Open",
      parts_status: "none",
      parts_eta: null,
      assigned_tech_id: "tech-sam",
      scheduled_at: daysFromNow(1, 14),
      zone: "north",
      skill: "laundry",
    },
    {
      id: "1113",
      phone: "+15550100008",
      customer_name: "Ben Adler",
      appliance: "Sub-Zero Freezer",
      model_serial: "IC-30FI",
      status: "Diagnostic Scheduled",
      parts_status: "none",
      parts_eta: null,
      assigned_tech_id: "tech-mike",
      scheduled_at: daysFromNow(1, 11),
      zone: "north",
      skill: "sub-zero",
    },
  ];
}

export async function seedMockCrm(db: D1Database): Promise<{
  customers: number;
  technicians: number;
  jobs: number;
}> {
  await db.batch([
    db.prepare("DELETE FROM availability_slots"),
    db.prepare("DELETE FROM jobs_cache"),
    db.prepare("DELETE FROM technicians_cache"),
    db.prepare("DELETE FROM jobs"),
    db.prepare("DELETE FROM technicians"),
    db.prepare("DELETE FROM customers"),
  ]);

  for (const c of CUSTOMERS) {
    await db
      .prepare(`INSERT INTO customers (id, name, phone, zone) VALUES (?, ?, ?, ?)`)
      .bind(c.id, c.name, c.phone, c.zone)
      .run();
  }

  for (const t of TECHS) {
    await db
      .prepare(
        `INSERT INTO technicians (id, name, skills, zone, active) VALUES (?, ?, ?, ?, 1)`,
      )
      .bind(t.id, t.name, t.skills, t.zone)
      .run();
  }

  const jobs = buildJobs();
  for (const j of jobs) {
    await db
      .prepare(
        `INSERT INTO jobs (
          id, phone, customer_name, appliance, model_serial, status,
          parts_status, parts_eta, assigned_tech_id, scheduled_at, zone, skill
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        j.id,
        j.phone,
        j.customer_name,
        j.appliance,
        j.model_serial,
        j.status,
        j.parts_status,
        j.parts_eta,
        j.assigned_tech_id,
        j.scheduled_at,
        j.zone,
        j.skill,
      )
      .run();
  }

  return {
    customers: CUSTOMERS.length,
    technicians: TECHS.length,
    jobs: jobs.length,
  };
}
