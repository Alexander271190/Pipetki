const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'pipette.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ============================================================
// СХЕМА БД
// ============================================================
db.exec([
  'CREATE TABLE IF NOT EXISTS users (',
  '  id TEXT PRIMARY KEY,',
  '  login TEXT UNIQUE NOT NULL,',
  '  password TEXT NOT NULL,',
  '  full_name TEXT NOT NULL,',
  '  position TEXT NOT NULL,',
  '  department TEXT,',
  '  role TEXT DEFAULT "user",',
  '  extra_permissions TEXT DEFAULT "[]",',
  '  only_own_department INTEGER DEFAULT 0,',
  '  created_at TEXT DEFAULT CURRENT_TIMESTAMP,',
  '  updated_at TEXT DEFAULT CURRENT_TIMESTAMP',
  ');',

  'CREATE TABLE IF NOT EXISTS pipettes (',
  '  id TEXT PRIMARY KEY,',
  '  serial TEXT,',
  '  manufacturer TEXT,',
  '  model TEXT NOT NULL,',
  '  volume TEXT,',
  '  department TEXT,',
  '  subdivision TEXT,',
  '  interval INTEGER DEFAULT 12,',
  '  last_calibration TEXT,',
  '  cert TEXT,',
  '  last_result TEXT DEFAULT "pass",',
  '  active INTEGER DEFAULT 1,',
  '  responsible TEXT,',
  '  location TEXT,',
  '  notes TEXT,',
  '  created_at TEXT DEFAULT CURRENT_TIMESTAMP,',
  '  updated_at TEXT DEFAULT CURRENT_TIMESTAMP',
  ');',

  'CREATE TABLE IF NOT EXISTS calibration_history (',
  '  id INTEGER PRIMARY KEY AUTOINCREMENT,',
  '  pipette_id TEXT NOT NULL,',
  '  date TEXT NOT NULL,',
  '  cert TEXT,',
  '  result TEXT DEFAULT "pass",',
  '  org TEXT,',
  '  note TEXT,',
  '  created_at TEXT DEFAULT CURRENT_TIMESTAMP,',
  '  FOREIGN KEY (pipette_id) REFERENCES pipettes(id) ON DELETE CASCADE',
  ');',

  'CREATE TABLE IF NOT EXISTS audit_log (',
  '  id INTEGER PRIMARY KEY AUTOINCREMENT,',
  '  user_id TEXT NOT NULL,',
  '  user_full_name TEXT NOT NULL,',
  '  action TEXT NOT NULL,',
  '  details TEXT,',
  '  timestamp TEXT DEFAULT CURRENT_TIMESTAMP',
  ');',

  'CREATE TABLE IF NOT EXISTS departments (',
  '  id INTEGER PRIMARY KEY AUTOINCREMENT,',
  '  name TEXT UNIQUE NOT NULL,',
  '  enabled INTEGER DEFAULT 1,',
  '  created_at TEXT DEFAULT CURRENT_TIMESTAMP',
  ');',
   'CREATE TABLE IF NOT EXISTS subdivisions (',
  '  id INTEGER PRIMARY KEY AUTOINCREMENT,',
  '  name TEXT UNIQUE NOT NULL,',
  '  enabled INTEGER DEFAULT 1,',
  '  created_at TEXT DEFAULT CURRENT_TIMESTAMP',
  ');',

  'CREATE TABLE IF NOT EXISTS filter_config (',
  '  id TEXT PRIMARY KEY,',
  '  label TEXT NOT NULL,',
  '  type TEXT NOT NULL,',
  '  field_id TEXT,',
  '  enabled INTEGER DEFAULT 1,',
  '  options_source TEXT,',
  '  filter_order INTEGER DEFAULT 0,',
  '  created_at TEXT DEFAULT CURRENT_TIMESTAMP,',
  '  updated_at TEXT DEFAULT CURRENT_TIMESTAMP',
  ');',

  'CREATE TABLE IF NOT EXISTS system_settings (',
  '  setting_key TEXT PRIMARY KEY,',
  '  setting_value TEXT,',
  '  updated_at TEXT DEFAULT CURRENT_TIMESTAMP',
  ');',

  'CREATE TABLE IF NOT EXISTS field_config (',
  '  id TEXT PRIMARY KEY,',
  '  label TEXT NOT NULL,',
  '  type TEXT NOT NULL,',
  '  required INTEGER DEFAULT 0,',
  '  enabled INTEGER DEFAULT 1,',
  '  options TEXT DEFAULT "[]",',
  '  default_value TEXT DEFAULT "",',
  '  field_order INTEGER DEFAULT 0,',
  '  created_at TEXT DEFAULT CURRENT_TIMESTAMP,',
  '  updated_at TEXT DEFAULT CURRENT_TIMESTAMP',
  ');',

  'CREATE TABLE IF NOT EXISTS export_settings (',
  '  id INTEGER PRIMARY KEY CHECK (id = 1),',
  '  fields TEXT NOT NULL,',
  '  updated_at TEXT DEFAULT CURRENT_TIMESTAMP',
  ');'
].join('\n'));

// ============================================================
// МИГРАЦИИ (для уже существующих БД)
// ============================================================
function columnExists(table, column) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  return cols.some(c => c.name === column);
}

if (!columnExists('users', 'only_own_department')) {
  db.exec('ALTER TABLE users ADD COLUMN only_own_department INTEGER DEFAULT 0');
  db.exec("UPDATE users SET only_own_department = 1 WHERE role = 'user'");
}

if (!columnExists('departments', 'enabled')) {
  db.exec('ALTER TABLE departments ADD COLUMN enabled INTEGER DEFAULT 1');
}

if (!columnExists('pipettes', 'subdivision')) {
  db.exec('ALTER TABLE pipettes ADD COLUMN subdivision TEXT');
}
// ============================================================
// НАЧАЛЬНЫЕ ДАННЫЕ
// ============================================================

// --- Пользователи ---
const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
if (userCount === 0) {
  const insUser = db.prepare(
    'INSERT INTO users (id, login, password, full_name, position, department, role, extra_permissions) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );
  insUser.run('admin1', 'admin', 'admin', 'Администратор', 'Главный метролог', null, 'admin', '[]');
  insUser.run('senior1', 'senior', 'senior', 'Петров Петр', 'Старший лаборант', 'Гематологический отдел', 'senior_lab', '[]');
  insUser.run('user1', 'user', 'user', 'Иванов Иван', 'Лаборант', 'Биохимический отдел', 'user', '[]');
}

// --- Отделы ---
const deptCount = db.prepare('SELECT COUNT(*) AS c FROM departments').get().c;
if (deptCount === 0) {
  const insDept = db.prepare('INSERT INTO departments (name) VALUES (?)');
  const defaultDepts = [
    'Гематологический отдел',
    'Биохимический отдел',
    'Коагулогический отдел',
    'Экспресс отдел',
    'Изосерологический отдел',
    'Серологический отдел',
    'ГИМИ',
    'Бактериологический отдел'
  ];
  defaultDepts.forEach(function (d) { insDept.run(d); });
}

// --- Системные настройки ---
const setCount = db.prepare('SELECT COUNT(*) AS c FROM system_settings').get().c;
if (setCount === 0) {
  db.prepare('INSERT INTO system_settings (setting_key, setting_value) VALUES (?, ?)').run('warn_days', '30');
}

// --- Конфигурация полей формы ---
const fieldCount = db.prepare('SELECT COUNT(*) AS c FROM field_config').get().c;
if (fieldCount === 0) {
  const insField = db.prepare(
    'INSERT INTO field_config (id, label, type, required, enabled, options, default_value, field_order) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );
  insField.run('id', 'Внутренний номер', 'text', 1, 1, '[]', '', 1);
  insField.run('serial', 'Серийный номер', 'text', 0, 1, '[]', '', 2);
  insField.run('manufacturer', 'Производитель', 'text', 0, 1, '[]', '', 3);
  insField.run('model', 'Модель', 'text', 1, 1, '[]', '', 4);
  insField.run('volume', 'Объём (мкл)', 'text', 0, 1, '[]', '', 5);
  insField.run('department', 'Отдел', 'select', 0, 1, '[]', '', 6);
  insField.run('subdivision', 'Подразделение', 'select', 0, 1, '[]', '', 7);
  insField.run('interval', 'Межповерочный интервал (мес.)', 'number', 1, 1, '[]', '12', 8);
  insField.run('lastCalibration', 'Дата последней поверки', 'date', 1, 1, '[]', '', 9);
  insField.run('cert', 'Номер свидетельства', 'text', 0, 1, '[]', '', 10);
  insField.run('result', 'Результат поверки', 'select', 0, 1, '["pass","fail","wip"]', 'pass', 11);
  insField.run('active', 'Статус эксплуатации', 'select', 0, 1, '["true","false"]', 'true', 12);
  insField.run('responsible', 'Ответственный сотрудник', 'text', 0, 1, '[]', '', 13);
  insField.run('location', 'Место хранения', 'text', 0, 1, '[]', '', 14);
  insField.run('notes', 'Примечание', 'textarea', 0, 1, '[]', '', 15);
}

// --- Настройки экспорта ---
const expCount = db.prepare('SELECT COUNT(*) AS c FROM export_settings').get().c;
if (expCount === 0) {
  const defaultExport = [
    'id', 'serial', 'manufacturer', 'model', 'volume', 'department',
    'lastCalibration', 'nextCalibration', 'interval', 'daysLeft',
    'responsible', 'location', 'status', 'cert', 'notes'
  ];
  db.prepare('INSERT INTO export_settings (id, fields) VALUES (1, ?)').run(JSON.stringify(defaultExport));
}

// --- Демо-пипетки ---
const pipCount = db.prepare('SELECT COUNT(*) AS c FROM pipettes').get().c;
if (pipCount === 0) {
  const today = new Date();
  const ago = function (m) {
    const d = new Date(today);
    d.setMonth(d.getMonth() - m);
    return d.toISOString().slice(0, 10);
  };

  const insPip = db.prepare(
    'INSERT INTO pipettes ' +
    '(id, serial, manufacturer, model, volume, department, subdivision, interval, ' +
    'last_calibration, cert, last_result, active, responsible, location, notes) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );

  insPip.run('P-001', 'EP2024001', 'Eppendorf', 'Research Plus', '1000', 'Гематологический отдел',
             'Клинико-диагностическая лаборатория', 12, ago(11), 'С-АБ-1234567/2025', 'pass', 1,
             'Иванова М.С.', 'Лаб. 201, шкаф 3', '');
  insPip.run('P-002', 'EP2024002', 'Eppendorf', 'Research Plus', '100', 'Биохимический отдел',
             'Клинико-диагностическая лаборатория', 12, ago(10), 'С-АБ-1234568/2025', 'pass', 1,
             'Петров А.В.', 'Лаб. 201, шкаф 3', '');
  insPip.run('P-003', 'GT2023005', 'Gilson', 'Pipetman L', '5000', 'Коагулогический отдел',
             'Клинико-диагностическая лаборатория', 6, ago(7), 'С-АБ-1234569/2025', 'pass', 1,
             'Иванова М.С.', 'Лаб. 105', 'Требует внеочередной проверки');
  insPip.run('P-004', 'BT2022003', 'Biohit', 'mLINE', '200', 'Экспресс отдел',
             'Экспресс-лаборатория', 12, ago(14), 'С-АБ-9876546/2024', 'pass', 1,
             'Сидорова Е.К.', 'Лаб. 302', '');
  insPip.run('P-005', 'TR2024008', 'Thermo', 'Finnpipette F2', '20', 'Серологический отдел',
             'Микробиологическая лаборатория', 12, ago(2), 'С-АБ-1234570/2025', 'pass', 0,
             'Петров А.В.', 'Склад', 'В резерве');

  const insHist = db.prepare(
    'INSERT INTO calibration_history (pipette_id, date, cert, result, org, note) ' +
    'VALUES (?, ?, ?, ?, ?, ?)'
  );
  insHist.run('P-001', ago(23), 'С-АБ-9876543/2024', 'pass', 'ФБУ Красноярский ЦСМ', 'Годна');
  insHist.run('P-001', ago(11), 'С-АБ-1234567/2025', 'pass', 'ФБУ Красноярский ЦСМ', 'Годна');
  insHist.run('P-003', ago(13), 'С-АБ-9876545/2024', 'fail', 'ФБУ Красноярский ЦСМ', 'Брак');
  insHist.run('P-003', ago(7),  'С-АБ-1234569/2025', 'pass', 'ФБУ Красноярский ЦСМ', 'После ремонта');
}

  // --- Подразделения (вынесено наружу!) ---
const subdivCount = db.prepare('SELECT COUNT(*) AS c FROM subdivisions').get().c;
if (subdivCount === 0) {
  const insSub = db.prepare('INSERT INTO subdivisions (name, enabled) VALUES (?, ?)');
  insSub.run('Клинико-диагностическая лаборатория', 1);
  insSub.run('ГИМИ', 1);
  insSub.run('Микробиологическая лаборатория', 1);
}

// --- Фильтры по умолчанию ---
const filtCount = db.prepare('SELECT COUNT(*) AS c FROM filter_config').get().c;
if (filtCount === 0) {
  const insF = db.prepare(`INSERT INTO filter_config 
    (id, label, type, field_id, enabled, options_source, filter_order)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);

  insF.run('status',       'Статус',          'select',      'status',           1, 'status_list', 1);
  insF.run('subdivision',  'Подразделение',   'select',      'subdivision',      1, 'subdivisions', 2);
  insF.run('department',   'Отдел',           'select',      'department',       1, 'departments', 3);
  insF.run('responsible',  'Ответственный',   'text',        'responsible',      1, '', 4);
  insF.run('model',        'Модель',          'text',        'model',            1, '', 5);
  insF.run('manufacturer', 'Производитель',   'text',        'manufacturer',     1, '', 6);
  insF.run('active',       'Активность',      'select',      'active',           1, 'active_list', 7);
  insF.run('calPeriod',    'Дата поверки',    'date-period', 'last_calibration', 1, '', 8);

}

// ============================================================
// АДАПТЕР ПОД mysql2/promise
// ============================================================
function adapt(sql) {
  return sql.replace(
    /INSERT\s+INTO\s+system_settings\s*\([^)]+\)\s*VALUES\s*\([^)]+\)\s*ON\s+DUPLICATE\s+KEY\s+UPDATE\s+value\s*=\s*\?/gi,
    'INSERT INTO system_settings (setting_key, setting_value) VALUES (?, ?) ' +
    'ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value'
  );
}

async function query(sql, params) {
  if (!params) params = [];
  sql = adapt(sql);
  const stmt = db.prepare(sql);
  const upper = sql.trim().toUpperCase();
  if (upper.startsWith('SELECT') || upper.startsWith('WITH')) {
    return [stmt.all.apply(stmt, params)];
  }
  const info = stmt.run.apply(stmt, params);
  return [{ insertId: info.lastInsertRowid, affectedRows: info.changes }];
}

async function getConnection() {
  return {
    query: query,
    beginTransaction: async function () { db.exec('BEGIN'); },
    commit: async function () { db.exec('COMMIT'); },
    rollback: async function () { try { db.exec('ROLLBACK'); } catch (e) {} },
    release: function () {}
  };
}

module.exports = { query: query, getConnection: getConnection, db: db };
