import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import { config } from './config.js';

let db;

export function getDb() {
  if (db) return db;

  mkdirSync(dirname(config.dbPath), { recursive: true });
  db = new Database(config.dbPath);

  db.exec(`
    CREATE TABLE IF NOT EXISTS sent_alerts (
      id TEXT PRIMARY KEY,
      tournament_name TEXT NOT NULL,
      city TEXT,
      country TEXT,
      start_date TEXT,
      end_date TEXT,
      distance_km REAL,
      source TEXT,
      sent_at TEXT DEFAULT (datetime('now'))
    )
  `);

  return db;
}

export function wasAlertSent(id) {
  const db = getDb();
  const row = db.prepare('SELECT 1 FROM sent_alerts WHERE id = ?').get(id);
  return !!row;
}

export function markAlertSent(tournament) {
  const db = getDb();
  db.prepare(`
    INSERT OR IGNORE INTO sent_alerts (id, tournament_name, city, country, start_date, end_date, distance_km, source)
    VALUES (@id, @name, @city, @country, @startDate, @endDate, @distanceKm, @source)
  `).run(tournament);
}
