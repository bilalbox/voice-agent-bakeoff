-- Mock Workiz source-of-truth (WORKIZ_MODE=mock)
CREATE TABLE customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  zone TEXT
);

CREATE TABLE technicians (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  skills TEXT NOT NULL, -- comma-separated
  zone TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  phone TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  appliance TEXT NOT NULL,
  model_serial TEXT,
  status TEXT NOT NULL,
  parts_status TEXT NOT NULL DEFAULT 'none', -- in_stock | backordered | none
  parts_eta TEXT,
  assigned_tech_id TEXT,
  scheduled_at TEXT,
  zone TEXT,
  skill TEXT,
  FOREIGN KEY (assigned_tech_id) REFERENCES technicians(id)
);

CREATE INDEX idx_jobs_phone ON jobs(phone);
CREATE INDEX idx_jobs_scheduled ON jobs(scheduled_at);

-- Mid-call read path (always used by ScheduleService)
CREATE TABLE jobs_cache (
  id TEXT PRIMARY KEY,
  phone TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  appliance TEXT NOT NULL,
  model_serial TEXT,
  status TEXT NOT NULL,
  parts_status TEXT NOT NULL DEFAULT 'none',
  parts_eta TEXT,
  assigned_tech_id TEXT,
  assigned_tech_name TEXT,
  scheduled_at TEXT,
  zone TEXT,
  skill TEXT,
  synced_at TEXT NOT NULL
);

CREATE INDEX idx_jobs_cache_phone ON jobs_cache(phone);

CREATE TABLE technicians_cache (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  skills TEXT NOT NULL,
  zone TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  synced_at TEXT NOT NULL
);

CREATE TABLE availability_slots (
  id TEXT PRIMARY KEY,
  tech_id TEXT NOT NULL,
  tech_name TEXT NOT NULL,
  zone TEXT NOT NULL,
  skill TEXT NOT NULL,
  window_start TEXT NOT NULL,
  window_end TEXT NOT NULL,
  synced_at TEXT NOT NULL
);

CREATE INDEX idx_slots_zone_skill ON availability_slots(zone, skill, window_start);
