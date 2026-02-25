const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');

const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'troque-essa-chave-em-producao';
const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'binho_estrutura.db');

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

let db;

function nowIso() {
  return new Date().toISOString();
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeUnitInput(unitRaw) {
  if (!unitRaw) return null;
  const u = String(unitRaw).trim();
  const lower = u.toLowerCase();
  if (lower === 'l') return 'L';
  if (['g', 'kg', 'mg', 'ml', 'L', 'un'].includes(u)) return u;
  if (['g', 'kg', 'mg', 'ml', 'un'].includes(lower)) return lower;
  if (['u', 'und', 'unid', 'unidade'].includes(lower)) return 'un';
  return null;
}

const UNIT_META = {
  mg: { measurement_type: 'mass', base_unit: 'g', factor_to_base: 0.001 },
  g: { measurement_type: 'mass', base_unit: 'g', factor_to_base: 1 },
  kg: { measurement_type: 'mass', base_unit: 'g', factor_to_base: 1000 },
  ml: { measurement_type: 'volume', base_unit: 'ml', factor_to_base: 1 },
  L: { measurement_type: 'volume', base_unit: 'ml', factor_to_base: 1000 },
  un: { measurement_type: 'unit', base_unit: 'un', factor_to_base: 1 },
};

function inferMeasurementFromUnit(unit) {
  const normalized = normalizeUnitInput(unit);
  if (!normalized || !UNIT_META[normalized]) {
    throw new Error('Unidade inválida. Use: mg, g, kg, ml, L ou un.');
  }
  return { unit: normalized, ...UNIT_META[normalized] };
}

function convertToSpecificBase(quantity, inputUnit, targetBaseUnit) {
  const q = toNumber(quantity, NaN);
  if (!Number.isFinite(q)) throw new Error('Quantidade inválida.');

  const source = UNIT_META[normalizeUnitInput(inputUnit) || ''];
  if (!source) throw new Error('Unidade inválida.');
  if (source.base_unit !== targetBaseUnit) {
    throw new Error(`Unidade incompatível com o insumo (base: ${targetBaseUnit}).`);
  }
  return q * source.factor_to_base;
}

function monthRangeUtc(year, month) {
  const y = Number(year);
  const m = Number(month);
  const start = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0));
  const end = new Date(Date.UTC(y, m, 1, 0, 0, 0));
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

function yearRangeUtc(year) {
  const y = Number(year);
  const start = new Date(Date.UTC(y, 0, 1, 0, 0, 0));
  const end = new Date(Date.UTC(y + 1, 0, 1, 0, 0, 0));
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

function monthLabel(year, month) {
  return `${String(month).padStart(2, '0')}/${year}`;
}

function authRequired(req, res, next) {
  try {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Token ausente.' });

    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token inválido.' });
  }
}

async function initDatabase() {
  db = await open({
    filename: DB_FILE,
    driver: sqlite3.Database,
  });

  await db.exec('PRAGMA foreign_keys = ON;');
  await db.exec('PRAGMA journal_mode = WAL;');

  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      must_change_password INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      type TEXT DEFAULT 'Conta Corrente',
      opening_balance REAL DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL DEFAULT 'both',
      is_personal INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS ingredients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      unit TEXT NOT NULL DEFAULT 'g',
      stock_qty REAL NOT NULL DEFAULT 0,
      min_stock_qty REAL NOT NULL DEFAULT 0,
      cost_per_unit REAL NOT NULL DEFAULT 0,
      notes TEXT,

      measurement_type TEXT DEFAULT 'mass',
      base_unit TEXT DEFAULT 'g',
      stock_qty_base REAL DEFAULT 0,
      min_stock_qty_base REAL DEFAULT 0,
      last_cost_per_base_unit REAL DEFAULT 0,

      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS stock_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ingredient_id INTEGER NOT NULL,
      movement_type TEXT NOT NULL,
      quantity_base REAL NOT NULL,
      unit_base TEXT NOT NULL,
      unit_cost_base REAL,
      total_cost REAL,
      note TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (ingredient_id) REFERENCES ingredients(id)
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      sale_price REAL NOT NULL DEFAULT 0,
      unit_label TEXT NOT NULL DEFAULT 'un',
      is_active INTEGER NOT NULL DEFAULT 1,
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS product_composition (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      ingredient_id INTEGER NOT NULL,
      quantity REAL NOT NULL,
      waste_pct REAL NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(product_id, ingredient_id),
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
      FOREIGN KEY (ingredient_id) REFERENCES ingredients(id)
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_name TEXT,
      channel TEXT NOT NULL DEFAULT 'balcao',
      order_type TEXT NOT NULL DEFAULT 'balcao',
      status TEXT NOT NULL DEFAULT 'paid',
      account_id INTEGER,
      total_amount REAL NOT NULL DEFAULT 0,
      total_cost REAL NOT NULL DEFAULT 0,
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (account_id) REFERENCES accounts(id)
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      quantity REAL NOT NULL,
      unit_price REAL NOT NULL,
      line_total REAL NOT NULL,
      unit_cost_snapshot REAL DEFAULT 0,
      line_cost REAL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      amount REAL NOT NULL,
      description TEXT,
      account_id INTEGER,
      category_id INTEGER,
      occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      is_personal_withdrawal INTEGER DEFAULT 0,
      affects_mei_revenue INTEGER DEFAULT 0,
      source TEXT,
      source_order_id INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (account_id) REFERENCES accounts(id),
      FOREIGN KEY (category_id) REFERENCES categories(id),
      FOREIGN KEY (source_order_id) REFERENCES orders(id)
    );

    CREATE TABLE IF NOT EXISTS das_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      year INTEGER NOT NULL,
      month INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      due_date TEXT,
      paid_at TEXT,
      amount REAL,
      note TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(year, month)
    );
  `);

  // Migrações seguras (caso o banco antigo não tenha algumas colunas)
  async function safeAlter(sql) {
    try {
      await db.exec(sql);
    } catch (err) {
      const msg = String(err?.message || '');
      if (!msg.includes('duplicate column name')) {
        console.error('Erro migration:', err.message);
      }
    }
  }

  await safeAlter(`ALTER TABLE users ADD COLUMN must_change_password INTEGER DEFAULT 1`);
  await safeAlter(`ALTER TABLE accounts ADD COLUMN type TEXT DEFAULT 'Conta Corrente'`);
  await safeAlter(`ALTER TABLE accounts ADD COLUMN opening_balance REAL DEFAULT 0`);
  await safeAlter(`ALTER TABLE accounts ADD COLUMN is_active INTEGER DEFAULT 1`);
  await safeAlter(`ALTER TABLE categories ADD COLUMN is_personal INTEGER DEFAULT 0`);
  await safeAlter(`ALTER TABLE ingredients ADD COLUMN measurement_type TEXT DEFAULT 'mass'`);
  await safeAlter(`ALTER TABLE ingredients ADD COLUMN base_unit TEXT DEFAULT 'g'`);
  await safeAlter(`ALTER TABLE ingredients ADD COLUMN stock_qty_base REAL DEFAULT 0`);
  await safeAlter(`ALTER TABLE ingredients ADD COLUMN min_stock_qty_base REAL DEFAULT 0`);
  await safeAlter(`ALTER TABLE ingredients ADD COLUMN last_cost_per_base_unit REAL DEFAULT 0`);
  await safeAlter(`ALTER TABLE products ADD COLUMN notes TEXT`);
  await safeAlter(`ALTER TABLE transactions ADD COLUMN is_personal_withdrawal INTEGER DEFAULT 0`);
  await safeAlter(`ALTER TABLE transactions ADD COLUMN affects_mei_revenue INTEGER DEFAULT 0`);
  await safeAlter(`ALTER TABLE transactions ADD COLUMN source TEXT`);
  await safeAlter(`ALTER TABLE transactions ADD COLUMN source_order_id INTEGER`);
  await safeAlter(`ALTER TABLE order_items ADD COLUMN unit_cost_snapshot REAL DEFAULT 0`);
  await safeAlter(`ALTER TABLE order_items ADD COLUMN line_cost REAL DEFAULT 0`);

  await db.exec(`
    UPDATE ingredients
    SET
      base_unit = CASE
        WHEN base_unit IS NULL OR base_unit = '' THEN COALESCE(unit, 'g')
        ELSE base_unit
      END,
      measurement_type = CASE
        WHEN measurement_type IS NULL OR measurement_type = '' THEN
          CASE
            WHEN COALESCE(unit, 'g') IN ('mg', 'g', 'kg') THEN 'mass'
            WHEN COALESCE(unit, 'g') IN ('ml', 'L') THEN 'volume'
            ELSE 'unit'
          END
        ELSE measurement_type
      END,
      stock_qty_base = CASE
        WHEN stock_qty_base IS NULL THEN COALESCE(stock_qty, 0)
        ELSE stock_qty_base
      END,
      min_stock_qty_base = CASE
        WHEN min_stock_qty_base IS NULL THEN COALESCE(min_stock_qty, 0)
        ELSE min_stock_qty_base
      END,
      last_cost_per_base_unit = CASE
        WHEN last_cost_per_base_unit IS NULL THEN COALESCE(cost_per_unit, 0)
        ELSE last_cost_per_base_unit
      END
  `);

  await seedDefaults();
  await ensureDasRows(new Date().getUTCFullYear());
  await ensureDasRows(2026); // deixa preparado para a tela do MEI 2026
}

async function seedDefaults() {
  const user = await db.get(`SELECT id FROM users WHERE email = ?`, ['binho@local']);
  if (!user) {
    const password_hash = await bcrypt.hash('admin123', 10);
    await db.run(
      `INSERT INTO users (name, email, password_hash, must_change_password, created_at, updated_at)
       VALUES (?, ?, ?, 1, ?, ?)`,
      ['Binho', 'binho@local', password_hash, nowIso(), nowIso()]
    );
  }

  const defaultAccounts = [
    ['Nubank', 'Conta Corrente'],
    ['Caixa', 'Conta Corrente'],
    ['Poupança', 'Poupança'],
  ];

  for (const [name, type] of defaultAccounts) {
    await db.run(
      `INSERT OR IGNORE INTO accounts (name, type, opening_balance, is_active, created_at, updated_at)
       VALUES (?, ?, 0, 1, ?, ?)`,
      [name, type, nowIso(), nowIso()]
    );
  }

  const defaultCategories = [
    ['Insumos', 'expense', 0],
    ['Vendas', 'income', 0],
    ['Luz', 'expense', 0],
    ['Uber', 'expense', 0],
    ['Embalagens', 'expense', 0],
    ['Retirada Pró-labore', 'expense', 1],
    ['Retirada Pessoal', 'expense', 1],
    ['Outros', 'both', 0],
  ];

  for (const [name, type, is_personal] of defaultCategories) {
    await db.run(
      `INSERT OR IGNORE INTO categories (name, type, is_personal, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      [name, type, is_personal, nowIso(), nowIso()]
    );
  }
}

async function ensureDasRows(year) {
  const y = Number(year);
  for (let month = 1; month <= 12; month++) {
    const dueDate = new Date(Date.UTC(y, month, 20, 12, 0, 0)).toISOString(); // dia 20 do mês seguinte
    await db.run(
      `INSERT OR IGNORE INTO das_payments (year, month, status, due_date, amount, created_at, updated_at)
       VALUES (?, ?, 'pending', ?, NULL, ?, ?)`,
      [y, month, dueDate, nowIso(), nowIso()]
    );
  }
}

async function getCategoryByName(name) {
  return db.get(`SELECT * FROM categories WHERE lower(name) = lower(?) LIMIT 1`, [name]);
}

async function getProductCostSummary(productId) {
  const product = await db.get(`SELECT * FROM products WHERE id = ?`, [productId]);
  if (!product) {
    const err = new Error('Produto não encontrado.');
    err.status = 404;
    throw err;
  }

  const composition = await db.all(
    `SELECT
      pc.ingredient_id,
      pc.quantity,
      pc.waste_pct,
      i.name AS ingredient_name,
      COALESCE(i.unit, i.base_unit, 'un') AS unit,
      COALESCE(i.cost_per_unit, i.last_cost_per_base_unit, 0) AS cost_per_unit
     FROM product_composition pc
     JOIN ingredients i ON i.id = pc.ingredient_id
     WHERE pc.product_id = ?
     ORDER BY i.name ASC`,
    [productId]
  );

  let calculated_cost = 0;
  const detailed = composition.map((row) => {
    const factor = 1 + toNumber(row.waste_pct, 0) / 100;
    const ingredient_cost = toNumber(row.quantity, 0) * toNumber(row.cost_per_unit, 0) * factor;
    calculated_cost += ingredient_cost;
    return {
      ingredient_id: row.ingredient_id,
      quantity: toNumber(row.quantity),
      waste_pct: toNumber(row.waste_pct),
      ingredient_name: row.ingredient_name,
      unit: row.unit,
      cost_per_unit: toNumber(row.cost_per_unit),
      ingredient_cost,
    };
  });

  const salePrice = toNumber(product.sale_price, 0);
  const margin_amount = salePrice - calculated_cost;
  const margin_percent = salePrice > 0 ? (margin_amount / salePrice) * 100 : 0;

  return {
    product: {
      id: product.id,
      name: product.name,
      sale_price: toNumber(product.sale_price),
      unit_label: product.unit_label,
      is_active: Number(product.is_active || 0),
      notes: product.notes || null,
    },
    composition: detailed,
    calculated_cost,
    margin_amount,
    margin_percent,
  };
}

async function runInTransaction(work) {
  await db.exec('BEGIN TRANSACTION');
  try {
    const result = await work();
    await db.exec('COMMIT');
    return result;
  } catch (err) {
    await db.exec('ROLLBACK');
    throw err;
  }
}

// ===============================
// AUTH
// ===============================
app.post('/auth/login', async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'E-mail e senha são obrigatórios.' });
    }

    const user = await db.get(`SELECT * FROM users WHERE email = ?`, [String(email).trim()]);
    if (!user) return res.status(401).json({ error: 'Credenciais inválidas.' });

    const ok = await bcrypt.compare(String(password), user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Credenciais inválidas.' });

    const token = jwt.sign(
      { id: user.id, email: user.email, name: user.name },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        must_change_password: Number(user.must_change_password || 0),
      },
    });
  } catch (err) {
    next(err);
  }
});

app.get('/auth/me', authRequired, async (req, res, next) => {
  try {
    const user = await db.get(
      `SELECT id, name, email, must_change_password FROM users WHERE id = ?`,
      [req.user.id]
    );
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });
    res.json({ user });
  } catch (err) {
    next(err);
  }
});

app.post('/auth/first-access', authRequired, async (req, res, next) => {
  try {
    const { email, password } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({ error: 'E-mail e senha são obrigatórios.' });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ error: 'A senha deve ter pelo menos 6 caracteres.' });
    }

    const password_hash = await bcrypt.hash(String(password), 10);
    await db.run(
      `UPDATE users
       SET email = ?, password_hash = ?, must_change_password = 0, updated_at = ?
       WHERE id = ?`,
      [String(email).trim(), password_hash, nowIso(), req.user.id]
    );

    const user = await db.get(`SELECT id, name, email, must_change_password FROM users WHERE id = ?`, [req.user.id]);
    res.json({ ok: true, user });
  } catch (err) {
    if (String(err?.message || '').includes('UNIQUE constraint failed: users.email')) {
      return res.status(400).json({ error: 'Este e-mail já está em uso.' });
    }
    next(err);
  }
});

// ===============================
// HEALTH
// ===============================
app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'Binho Estrutura API', timestamp: nowIso() });
});

// Protege tudo daqui pra baixo
app.use(authRequired);

// ===============================
// ACCOUNTS
// ===============================
app.get('/accounts', async (_req, res, next) => {
  try {
    const rows = await db.all(
      `SELECT
        a.id,
        a.name,
        a.type,
        a.opening_balance,
        a.is_active,
        COALESCE(a.opening_balance, 0) + COALESCE(SUM(CASE WHEN t.type = 'income' THEN t.amount ELSE -t.amount END), 0) AS current_balance
       FROM accounts a
       LEFT JOIN transactions t ON t.account_id = a.id
       GROUP BY a.id
       ORDER BY a.is_active DESC, a.name ASC`
    );
    res.json(rows || []);
  } catch (err) {
    next(err);
  }
});

app.post('/accounts', async (req, res, next) => {
  try {
    const { name, type, opening_balance, is_active } = req.body || {};
    if (!String(name || '').trim()) {
      return res.status(400).json({ error: 'Nome da conta é obrigatório.' });
    }

    const result = await db.run(
      `INSERT INTO accounts (name, type, opening_balance, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        String(name).trim(),
        String(type || 'Conta Corrente'),
        toNumber(opening_balance, 0),
        Number(is_active ?? 1) ? 1 : 0,
        nowIso(),
        nowIso(),
      ]
    );

    const row = await db.get(`SELECT * FROM accounts WHERE id = ?`, [result.lastID]);
    res.status(201).json(row);
  } catch (err) {
    if (String(err?.message || '').includes('UNIQUE constraint failed: accounts.name')) {
      return res.status(400).json({ error: 'Já existe uma conta com esse nome.' });
    }
    next(err);
  }
});

app.put('/accounts/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, type, opening_balance, is_active } = req.body || {};

    await db.run(
      `UPDATE accounts
       SET name = ?, type = ?, opening_balance = ?, is_active = ?, updated_at = ?
       WHERE id = ?`,
      [
        String(name || '').trim(),
        String(type || 'Conta Corrente'),
        toNumber(opening_balance, 0),
        Number(is_active ?? 1) ? 1 : 0,
        nowIso(),
        id,
      ]
    );

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

app.delete('/accounts/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const txCount = await db.get(`SELECT COUNT(*) AS total FROM transactions WHERE account_id = ?`, [id]);
    const orderCount = await db.get(`SELECT COUNT(*) AS total FROM orders WHERE account_id = ?`, [id]);

    if ((txCount?.total || 0) > 0 || (orderCount?.total || 0) > 0) {
      return res.status(400).json({ error: 'Conta possui registros vinculados e não pode ser excluída.' });
    }

    await db.run(`DELETE FROM accounts WHERE id = ?`, [id]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ===============================
// CATEGORIES
// ===============================
app.get('/categories', async (_req, res, next) => {
  try {
    const rows = await db.all(
      `SELECT id, name, type, is_personal FROM categories ORDER BY name ASC`
    );
    res.json(rows || []);
  } catch (err) {
    next(err);
  }
});

app.post('/categories', async (req, res, next) => {
  try {
    const { name, type, is_personal } = req.body || {};
    if (!String(name || '').trim()) return res.status(400).json({ error: 'Nome é obrigatório.' });

    const categoryType = ['income', 'expense', 'both'].includes(String(type)) ? String(type) : 'both';
    const result = await db.run(
      `INSERT INTO categories (name, type, is_personal, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      [String(name).trim(), categoryType, Number(is_personal || 0) ? 1 : 0, nowIso(), nowIso()]
    );
    const row = await db.get(`SELECT id, name, type, is_personal FROM categories WHERE id = ?`, [result.lastID]);
    res.status(201).json(row);
  } catch (err) {
    if (String(err?.message || '').includes('UNIQUE constraint failed: categories.name')) {
      return res.status(400).json({ error: 'Categoria já existe.' });
    }
    next(err);
  }
});

app.put('/categories/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, type, is_personal } = req.body || {};
    const categoryType = ['income', 'expense', 'both'].includes(String(type)) ? String(type) : 'both';

    await db.run(
      `UPDATE categories SET name = ?, type = ?, is_personal = ?, updated_at = ? WHERE id = ?`,
      [String(name).trim(), categoryType, Number(is_personal || 0) ? 1 : 0, nowIso(), id]
    );

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

app.delete('/categories/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const txCount = await db.get(`SELECT COUNT(*) AS total FROM transactions WHERE category_id = ?`, [id]);
    if ((txCount?.total || 0) > 0) {
      return res.status(400).json({ error: 'Categoria possui transações e não pode ser excluída.' });
    }
    await db.run(`DELETE FROM categories WHERE id = ?`, [id]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ===============================
// INGREDIENTS (compatível com frontend atual e versão nova)
// ===============================
app.get('/ingredients', async (_req, res, next) => {
  try {
    const rows = await db.all(
      `SELECT
        id,
        name,
        COALESCE(unit, base_unit, 'un') AS unit,
        COALESCE(stock_qty, stock_qty_base, 0) AS stock_qty,
        COALESCE(min_stock_qty, min_stock_qty_base, 0) AS min_stock_qty,
        COALESCE(cost_per_unit, last_cost_per_base_unit, 0) AS cost_per_unit,
        notes,
        measurement_type,
        base_unit,
        stock_qty_base,
        min_stock_qty_base,
        last_cost_per_base_unit
       FROM ingredients
       ORDER BY name ASC`
    );
    res.json(rows || []);
  } catch (err) {
    next(err);
  }
});

app.post('/ingredients', async (req, res, next) => {
  try {
    const body = req.body || {};
    const name = String(body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Nome do insumo é obrigatório.' });

    let unit;
    let measurement_type;
    let base_unit;
    let stock_qty;
    let min_stock_qty;
    let cost_per_unit;

    if (body.unit) {
      const meta = inferMeasurementFromUnit(body.unit);
      unit = meta.unit;
      measurement_type = meta.measurement_type;
      base_unit = meta.base_unit;
      stock_qty = toNumber(body.stock_qty, 0);
      min_stock_qty = toNumber(body.min_stock_qty, 0);
      cost_per_unit = toNumber(body.cost_per_unit, 0);
    } else {
      base_unit = normalizeUnitInput(body.base_unit);
      if (!base_unit) {
        return res.status(400).json({ error: 'base_unit inválida. Use mg, g, kg, ml, L ou un.' });
      }
      const meta = inferMeasurementFromUnit(base_unit);
      measurement_type = String(body.measurement_type || meta.measurement_type);
      unit = base_unit;
      stock_qty = toNumber(body.stock_qty_base, 0);
      min_stock_qty = toNumber(body.min_stock_qty_base, 0);
      cost_per_unit = toNumber(body.last_cost_per_base_unit, 0);
    }

    const result = await db.run(
      `INSERT INTO ingredients (
        name, unit, stock_qty, min_stock_qty, cost_per_unit, notes,
        measurement_type, base_unit, stock_qty_base, min_stock_qty_base, last_cost_per_base_unit,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        name,
        unit,
        stock_qty,
        min_stock_qty,
        cost_per_unit,
        body.notes ? String(body.notes) : null,
        measurement_type,
        base_unit,
        stock_qty,
        min_stock_qty,
        cost_per_unit,
        nowIso(),
        nowIso(),
      ]
    );

    const row = await db.get(`SELECT * FROM ingredients WHERE id = ?`, [result.lastID]);
    res.status(201).json(row);
  } catch (err) {
    if (String(err?.message || '').includes('UNIQUE constraint failed: ingredients.name')) {
      return res.status(400).json({ error: 'Já existe um insumo com esse nome.' });
    }
    next(err);
  }
});

app.put('/ingredients/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const body = req.body || {};
    const current = await db.get(`SELECT * FROM ingredients WHERE id = ?`, [id]);
    if (!current) return res.status(404).json({ error: 'Insumo não encontrado.' });

    const name = String(body.name ?? current.name).trim();
    if (!name) return res.status(400).json({ error: 'Nome do insumo é obrigatório.' });

    let unit = current.unit;
    let measurement_type = current.measurement_type;
    let base_unit = current.base_unit;
    let stock_qty = toNumber(current.stock_qty, 0);
    let min_stock_qty = toNumber(current.min_stock_qty, 0);
    let cost_per_unit = toNumber(current.cost_per_unit, 0);

    if (body.unit !== undefined) {
      const meta = inferMeasurementFromUnit(body.unit);
      unit = meta.unit;
      measurement_type = meta.measurement_type;
      base_unit = meta.base_unit;
      stock_qty = toNumber(body.stock_qty, stock_qty);
      min_stock_qty = toNumber(body.min_stock_qty, min_stock_qty);
      cost_per_unit = toNumber(body.cost_per_unit, cost_per_unit);
    } else if (body.base_unit || body.measurement_type) {
      const normalizedBase = normalizeUnitInput(body.base_unit || current.base_unit);
      const meta = inferMeasurementFromUnit(normalizedBase);
      unit = normalizedBase;
      base_unit = meta.base_unit;
      measurement_type = String(body.measurement_type || meta.measurement_type);
      stock_qty = toNumber(body.stock_qty_base, current.stock_qty_base);
      min_stock_qty = toNumber(body.min_stock_qty_base, current.min_stock_qty_base);
      cost_per_unit = toNumber(body.last_cost_per_base_unit, current.last_cost_per_base_unit);
    }

    await db.run(
      `UPDATE ingredients
       SET name = ?, unit = ?, stock_qty = ?, min_stock_qty = ?, cost_per_unit = ?, notes = ?,
           measurement_type = ?, base_unit = ?, stock_qty_base = ?, min_stock_qty_base = ?, last_cost_per_base_unit = ?,
           updated_at = ?
       WHERE id = ?`,
      [
        name,
        unit,
        stock_qty,
        min_stock_qty,
        cost_per_unit,
        body.notes !== undefined ? (body.notes ? String(body.notes) : null) : current.notes,
        measurement_type,
        base_unit,
        stock_qty,
        min_stock_qty,
        cost_per_unit,
        nowIso(),
        id,
      ]
    );

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

app.delete('/ingredients/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const usedInRecipe = await db.get(`SELECT COUNT(*) AS total FROM product_composition WHERE ingredient_id = ?`, [id]);
    if ((usedInRecipe?.total || 0) > 0) {
      return res.status(400).json({ error: 'Insumo está vinculado a fichas técnicas.' });
    }

    await db.run(`DELETE FROM ingredients WHERE id = ?`, [id]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

app.post('/ingredients/purchase', async (req, res, next) => {
  try {
    const { ingredient_id, quantity, purchase_unit, total_cost, note } = req.body || {};
    if (!ingredient_id || !quantity || !purchase_unit || !total_cost) {
      return res.status(400).json({
        error: 'Campos obrigatórios: ingredient_id, quantity, purchase_unit, total_cost.',
      });
    }

    const ingredient = await db.get(`SELECT * FROM ingredients WHERE id = ?`, [ingredient_id]);
    if (!ingredient) return res.status(404).json({ error: 'Insumo não encontrado.' });

    const qtyBase = convertToSpecificBase(quantity, purchase_unit, ingredient.base_unit || ingredient.unit);
    if (qtyBase <= 0) return res.status(400).json({ error: 'Quantidade inválida.' });

    const totalCostNum = toNumber(total_cost, 0);
    if (totalCostNum <= 0) return res.status(400).json({ error: 'Valor total inválido.' });

    const unitCost = totalCostNum / qtyBase;
    const newStock = toNumber(ingredient.stock_qty_base ?? ingredient.stock_qty, 0) + qtyBase;

    await runInTransaction(async () => {
      await db.run(
        `UPDATE ingredients
         SET stock_qty = ?, stock_qty_base = ?, cost_per_unit = ?, last_cost_per_base_unit = ?, unit = ?, updated_at = ?
         WHERE id = ?`,
        [newStock, newStock, unitCost, unitCost, ingredient.base_unit || ingredient.unit, nowIso(), ingredient_id]
      );

      await db.run(
        `INSERT INTO stock_movements
         (ingredient_id, movement_type, quantity_base, unit_base, unit_cost_base, total_cost, note, created_at)
         VALUES (?, 'purchase', ?, ?, ?, ?, ?, ?)`,
        [
          ingredient_id,
          qtyBase,
          ingredient.base_unit || ingredient.unit,
          unitCost,
          totalCostNum,
          note || `Compra: ${quantity} ${purchase_unit}`,
          nowIso(),
        ]
      );
    });

    const updated = await db.get(`SELECT * FROM ingredients WHERE id = ?`, [ingredient_id]);
    res.json({ ok: true, ingredient: updated });
  } catch (err) {
    next(err);
  }
});

// ===============================
// PRODUCTS + RECIPES
// ===============================
app.get('/products', async (_req, res, next) => {
  try {
    const rows = await db.all(
      `SELECT id, name, sale_price, unit_label, is_active, notes FROM products ORDER BY name ASC`
    );
    res.json(rows || []);
  } catch (err) {
    next(err);
  }
});

app.post('/products', async (req, res, next) => {
  try {
    const { name, sale_price, unit_label, is_active, notes } = req.body || {};
    if (!String(name || '').trim()) return res.status(400).json({ error: 'Nome do produto é obrigatório.' });

    const result = await db.run(
      `INSERT INTO products (name, sale_price, unit_label, is_active, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        String(name).trim(),
        toNumber(sale_price, 0),
        String(unit_label || 'un'),
        Number(is_active ?? 1) ? 1 : 0,
        notes ? String(notes) : null,
        nowIso(),
        nowIso(),
      ]
    );
    const row = await db.get(`SELECT id, name, sale_price, unit_label, is_active, notes FROM products WHERE id = ?`, [result.lastID]);
    res.status(201).json(row);
  } catch (err) {
    if (String(err?.message || '').includes('UNIQUE constraint failed: products.name')) {
      return res.status(400).json({ error: 'Já existe um produto com esse nome.' });
    }
    next(err);
  }
});

app.put('/products/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, sale_price, unit_label, is_active, notes } = req.body || {};

    await db.run(
      `UPDATE products
       SET name = ?, sale_price = ?, unit_label = ?, is_active = ?, notes = ?, updated_at = ?
       WHERE id = ?`,
      [
        String(name || '').trim(),
        toNumber(sale_price, 0),
        String(unit_label || 'un'),
        Number(is_active ?? 1) ? 1 : 0,
        notes ? String(notes) : null,
        nowIso(),
        id,
      ]
    );

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

app.delete('/products/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const used = await db.get(`SELECT COUNT(*) AS total FROM order_items WHERE product_id = ?`, [id]);
    if ((used?.total || 0) > 0) {
      return res.status(400).json({ error: 'Produto já possui pedidos e não pode ser excluído.' });
    }

    await db.run(`DELETE FROM product_composition WHERE product_id = ?`, [id]);
    await db.run(`DELETE FROM products WHERE id = ?`, [id]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

app.get('/products/:id/composition', async (req, res, next) => {
  try {
    const summary = await getProductCostSummary(req.params.id);
    res.json(summary);
  } catch (err) {
    next(err);
  }
});

app.put('/products/:id/composition', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { items } = req.body || {};
    if (!Array.isArray(items)) {
      return res.status(400).json({ error: 'Payload inválido. Use { items: [] }.' });
    }

    const product = await db.get(`SELECT id FROM products WHERE id = ?`, [id]);
    if (!product) return res.status(404).json({ error: 'Produto não encontrado.' });

    const normalized = [];
    for (const item of items) {
      const ingredientId = Number(item.ingredient_id);
      const quantity = toNumber(item.quantity, NaN);
      const waste_pct = toNumber(item.waste_pct, 0);
      if (!ingredientId || !Number.isFinite(quantity) || quantity <= 0) continue;

      const ing = await db.get(`SELECT id FROM ingredients WHERE id = ?`, [ingredientId]);
      if (!ing) return res.status(400).json({ error: `Ingrediente ${ingredientId} não encontrado.` });

      normalized.push({ ingredient_id: ingredientId, quantity, waste_pct });
    }

    if (normalized.length === 0) {
      return res.status(400).json({ error: 'Adicione ao menos 1 item na composição.' });
    }

    await runInTransaction(async () => {
      await db.run(`DELETE FROM product_composition WHERE product_id = ?`, [id]);
      for (const row of normalized) {
        await db.run(
          `INSERT INTO product_composition (product_id, ingredient_id, quantity, waste_pct, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [id, row.ingredient_id, row.quantity, row.waste_pct, nowIso(), nowIso()]
        );
      }
    });

    const summary = await getProductCostSummary(id);
    res.json({ ok: true, ...summary });
  } catch (err) {
    next(err);
  }
});

// ===============================
// TRANSACTIONS / FINANCE
// ===============================
app.get('/transactions', async (req, res, next) => {
  try {
    const { from, to } = req.query;
    const clauses = [];
    const params = [];

    if (from) {
      clauses.push(`date(t.occurred_at) >= date(?)`);
      params.push(String(from));
    }
    if (to) {
      clauses.push(`date(t.occurred_at) <= date(?)`);
      params.push(String(to));
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = await db.all(
      `SELECT
        t.id,
        t.type,
        t.amount,
        t.description,
        t.account_id,
        t.category_id,
        a.name AS account_name,
        c.name AS category_name,
        t.occurred_at,
        COALESCE(t.is_personal_withdrawal, 0) AS is_personal_withdrawal,
        COALESCE(t.affects_mei_revenue, 0) AS affects_mei_revenue,
        t.source,
        t.source_order_id
       FROM transactions t
       LEFT JOIN accounts a ON a.id = t.account_id
       LEFT JOIN categories c ON c.id = t.category_id
       ${where}
       ORDER BY datetime(t.occurred_at) DESC, t.id DESC`,
      params
    );

    res.json(rows || []);
  } catch (err) {
    next(err);
  }
});

app.post('/transactions', async (req, res, next) => {
  try {
    const {
      type,
      amount,
      description,
      account_id,
      category_id,
      occurred_at,
      is_personal_withdrawal,
      affects_mei_revenue,
      source,
      source_order_id,
    } = req.body || {};

    if (!['income', 'expense'].includes(String(type))) {
      return res.status(400).json({ error: 'Tipo inválido. Use income ou expense.' });
    }
    const amountNum = toNumber(amount, 0);
    if (amountNum <= 0) return res.status(400).json({ error: 'Valor inválido.' });

    let personalFlag = Number(is_personal_withdrawal || 0) ? 1 : 0;
    if (category_id) {
      const cat = await db.get(`SELECT is_personal FROM categories WHERE id = ?`, [category_id]);
      if (cat?.is_personal) personalFlag = 1;
    }

    const result = await db.run(
      `INSERT INTO transactions (
        type, amount, description, account_id, category_id, occurred_at,
        is_personal_withdrawal, affects_mei_revenue, source, source_order_id,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        String(type),
        amountNum,
        description ? String(description) : null,
        account_id ? Number(account_id) : null,
        category_id ? Number(category_id) : null,
        occurred_at ? new Date(occurred_at).toISOString() : nowIso(),
        personalFlag,
        Number(affects_mei_revenue || 0) ? 1 : 0,
        source ? String(source) : null,
        source_order_id ? Number(source_order_id) : null,
        nowIso(),
        nowIso(),
      ]
    );

    const row = await db.get(`SELECT * FROM transactions WHERE id = ?`, [result.lastID]);
    res.status(201).json(row);
  } catch (err) {
    next(err);
  }
});

app.delete('/transactions/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const row = await db.get(`SELECT source FROM transactions WHERE id = ?`, [id]);
    if (!row) return res.status(404).json({ error: 'Lançamento não encontrado.' });

    if (row.source === 'order_auto') {
      return res.status(400).json({ error: 'Transação gerada por pedido. Exclua o pedido para manter consistência.' });
    }

    await db.run(`DELETE FROM transactions WHERE id = ?`, [id]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

app.get('/finance/dre', async (req, res, next) => {
  try {
    const year = Number(req.query.year || new Date().getUTCFullYear());
    const month = Number(req.query.month || new Date().getUTCMonth() + 1);
    const { startIso, endIso } = monthRangeUtc(year, month);

    const sums = await db.get(
      `SELECT
         COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) AS revenue,
         COALESCE(SUM(CASE WHEN type = 'expense' AND COALESCE(is_personal_withdrawal,0) = 0 THEN amount ELSE 0 END), 0) AS operational_expenses,
         COALESCE(SUM(CASE WHEN type = 'expense' AND COALESCE(is_personal_withdrawal,0) = 1 THEN amount ELSE 0 END), 0) AS personal_withdrawals
       FROM transactions
       WHERE datetime(occurred_at) >= datetime(?) AND datetime(occurred_at) < datetime(?)`,
      [startIso, endIso]
    );

    const revenue = toNumber(sums?.revenue, 0);
    const operational_expenses = toNumber(sums?.operational_expenses, 0);
    const personal_withdrawals = toNumber(sums?.personal_withdrawals, 0);

    res.json({
      dre: {
        revenue,
        operational_expenses,
        net_profit: revenue - operational_expenses,
        personal_withdrawals,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ===============================
// ORDERS / POS
// ===============================
app.get('/orders', async (_req, res, next) => {
  try {
    const rows = await db.all(
      `SELECT id, customer_name, status, channel, total_amount, total_cost, created_at
       FROM orders
       ORDER BY datetime(created_at) DESC, id DESC`
    );
    res.json(rows || []);
  } catch (err) {
    next(err);
  }
});

app.post('/orders', async (req, res, next) => {
  try {
    const body = req.body || {};
    const items = Array.isArray(body.items) ? body.items : [];
    if (!items.length) return res.status(400).json({ error: 'Pedido sem itens.' });

    // Carrega produtos, composições e valida estoque
    const productCache = new Map();
    const productCostCache = new Map();
    const ingredientNeeds = new Map();
    const normalizedItems = [];
    let totalAmount = 0;
    let totalCost = 0;

    for (const item of items) {
      const productId = Number(item.product_id);
      const quantity = toNumber(item.quantity, 0);
      const unitPrice = toNumber(item.unit_price, 0);
      if (!productId || quantity <= 0) {
        return res.status(400).json({ error: 'Item inválido no pedido.' });
      }

      let product = productCache.get(productId);
      if (!product) {
        product = await db.get(`SELECT * FROM products WHERE id = ?`, [productId]);
        if (!product) return res.status(400).json({ error: `Produto ${productId} não encontrado.` });
        productCache.set(productId, product);
      }

      const costSummary = await getProductCostSummary(productId);
      productCostCache.set(productId, costSummary);
      if (!Array.isArray(costSummary.composition) || costSummary.composition.length === 0) {
        return res.status(400).json({ error: `Produto "${product.name}" está sem ficha técnica.` });
      }

      for (const comp of costSummary.composition) {
        const factor = 1 + toNumber(comp.waste_pct, 0) / 100;
        const required = quantity * toNumber(comp.quantity, 0) * factor;
        const prev = ingredientNeeds.get(comp.ingredient_id) || {
          ingredient_id: comp.ingredient_id,
          ingredient_name: comp.ingredient_name,
          unit: comp.unit,
          required: 0,
        };
        prev.required += required;
        ingredientNeeds.set(comp.ingredient_id, prev);
      }

      const lineTotal = quantity * unitPrice;
      const lineCost = quantity * toNumber(costSummary.calculated_cost, 0);
      totalAmount += lineTotal;
      totalCost += lineCost;

      normalizedItems.push({
        product_id: productId,
        quantity,
        unit_price: unitPrice,
        line_total: lineTotal,
        unit_cost_snapshot: toNumber(costSummary.calculated_cost, 0),
        line_cost: lineCost,
      });
    }

    // Verifica estoque
    const stockIssues = [];
    for (const need of ingredientNeeds.values()) {
      const ing = await db.get(
        `SELECT id, name, COALESCE(unit, base_unit, 'un') AS unit, COALESCE(stock_qty, stock_qty_base, 0) AS stock_qty
         FROM ingredients WHERE id = ?`,
        [need.ingredient_id]
      );
      const available = toNumber(ing?.stock_qty, 0);
      if (available < need.required) {
        stockIssues.push({
          ingredient_id: need.ingredient_id,
          ingredient_name: need.ingredient_name,
          unit: need.unit,
          stock_required: need.required,
          stock_available: available,
        });
      }
    }

    if (stockIssues.length) {
      return res.status(409).json({
        error: 'Estoque insuficiente para concluir o pedido.',
        details: stockIssues,
      });
    }

    const salesCategory = await getCategoryByName('Vendas');

    const result = await runInTransaction(async () => {
      const orderInsert = await db.run(
        `INSERT INTO orders
         (customer_name, channel, order_type, status, account_id, total_amount, total_cost, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          body.customer_name ? String(body.customer_name) : null,
          String(body.channel || 'balcao'),
          String(body.order_type || 'balcao'),
          String(body.status || 'paid'),
          body.account_id ? Number(body.account_id) : null,
          totalAmount,
          totalCost,
          body.notes ? String(body.notes) : null,
          nowIso(),
          nowIso(),
        ]
      );
      const orderId = orderInsert.lastID;

      for (const item of normalizedItems) {
        await db.run(
          `INSERT INTO order_items
           (order_id, product_id, quantity, unit_price, line_total, unit_cost_snapshot, line_cost, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            orderId,
            item.product_id,
            item.quantity,
            item.unit_price,
            item.line_total,
            item.unit_cost_snapshot,
            item.line_cost,
            nowIso(),
          ]
        );
      }

      for (const need of ingredientNeeds.values()) {
        const ing = await db.get(`SELECT * FROM ingredients WHERE id = ?`, [need.ingredient_id]);
        const currentStock = toNumber(ing.stock_qty ?? ing.stock_qty_base, 0);
        const newStock = currentStock - need.required;
        await db.run(
          `UPDATE ingredients
           SET stock_qty = ?, stock_qty_base = ?, updated_at = ?
           WHERE id = ?`,
          [newStock, newStock, nowIso(), need.ingredient_id]
        );

        await db.run(
          `INSERT INTO stock_movements
           (ingredient_id, movement_type, quantity_base, unit_base, unit_cost_base, total_cost, note, created_at)
           VALUES (?, 'sale_consumption', ?, ?, ?, ?, ?, ?)`,
          [
            need.ingredient_id,
            -Math.abs(need.required),
            ing.base_unit || ing.unit || 'un',
            toNumber(ing.cost_per_unit ?? ing.last_cost_per_base_unit, 0),
            Math.abs(need.required) * toNumber(ing.cost_per_unit ?? ing.last_cost_per_base_unit, 0),
            `Consumo no pedido #${orderId}`,
            nowIso(),
          ]
        );
      }

      if (body.create_financial_transaction) {
        await db.run(
          `INSERT INTO transactions
           (type, amount, description, account_id, category_id, occurred_at, is_personal_withdrawal, affects_mei_revenue, source, source_order_id, created_at, updated_at)
           VALUES ('income', ?, ?, ?, ?, ?, 0, 1, 'order_auto', ?, ?, ?)`,
          [
            totalAmount,
            `Venda pedido #${orderId}`,
            body.account_id ? Number(body.account_id) : null,
            salesCategory?.id || null,
            nowIso(),
            orderId,
            nowIso(),
            nowIso(),
          ]
        );
      }

      const order = await db.get(`SELECT * FROM orders WHERE id = ?`, [orderId]);
      return { order };
    });

    res.status(201).json({
      ok: true,
      ...result,
      totals: {
        total_amount: totalAmount,
        total_cost: totalCost,
        margin_amount: totalAmount - totalCost,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ===============================
// MEI / IMPOSTOS
// ===============================
app.get('/mei/status', async (req, res, next) => {
  try {
    const year = Number(req.query.year || new Date().getUTCFullYear());
    await ensureDasRows(year);

    const { startIso, endIso } = yearRangeUtc(year);
    const sums = await db.get(
      `SELECT
         COALESCE(SUM(CASE WHEN type = 'income' AND COALESCE(affects_mei_revenue,0) = 1 THEN amount ELSE 0 END), 0) AS business_revenue,
         COALESCE(SUM(CASE WHEN type = 'expense' AND COALESCE(is_personal_withdrawal,0) = 0 THEN amount ELSE 0 END), 0) AS business_expenses,
         COALESCE(SUM(CASE WHEN type = 'expense' AND COALESCE(is_personal_withdrawal,0) = 1 THEN amount ELSE 0 END), 0) AS personal_withdrawals
       FROM transactions
       WHERE datetime(occurred_at) >= datetime(?) AND datetime(occurred_at) < datetime(?)`,
      [startIso, endIso]
    );

    const dasStatsRows = await db.all(
      `SELECT status, COUNT(*) AS total FROM das_payments WHERE year = ? GROUP BY status`,
      [year]
    );

    const das_stats = { paid: 0, pending: 0, overdue: 0 };
    for (const row of dasStatsRows) {
      if (row.status === 'paid') das_stats.paid = Number(row.total || 0);
      else if (row.status === 'overdue') das_stats.overdue = Number(row.total || 0);
      else das_stats.pending += Number(row.total || 0);
    }

    // Regra vigente 2026 (limite anual MEI permanece R$ 81.000)
    const mei_limit = 81000;
    const business_revenue = toNumber(sums?.business_revenue, 0);
    const business_expenses = toNumber(sums?.business_expenses, 0);
    const personal_withdrawals = toNumber(sums?.personal_withdrawals, 0);
    const remaining_limit = Math.max(0, mei_limit - business_revenue);
    const used_percentage = mei_limit > 0 ? (business_revenue / mei_limit) * 100 : 0;

    let alert_level = 'ok';
    if (used_percentage >= 100) alert_level = 'danger';
    else if (used_percentage >= 80) alert_level = 'warning';

    res.json({
      year,
      mei_limit,
      business_revenue,
      business_expenses,
      personal_withdrawals,
      remaining_limit,
      used_percentage,
      alert_level,
      das_stats,
    });
  } catch (err) {
    next(err);
  }
});

app.get('/mei/das', async (req, res, next) => {
  try {
    const year = Number(req.query.year || new Date().getUTCFullYear());
    await ensureDasRows(year);
    const rows = await db.all(
      `SELECT id, year, month, status, due_date, paid_at, amount, note
       FROM das_payments
       WHERE year = ?
       ORDER BY month ASC`,
      [year]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

app.put('/mei/das/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, paid_at, amount, note } = req.body || {};
    const allowed = ['pending', 'paid', 'overdue'];
    const s = allowed.includes(String(status)) ? String(status) : 'pending';

    await db.run(
      `UPDATE das_payments
       SET status = ?, paid_at = ?, amount = ?, note = ?, updated_at = ?
       WHERE id = ?`,
      [
        s,
        s === 'paid' ? (paid_at ? new Date(paid_at).toISOString() : nowIso()) : null,
        amount !== undefined ? toNumber(amount, 0) : null,
        note ? String(note) : null,
        nowIso(),
        id,
      ]
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ===============================
// DASHBOARD
// ===============================
app.get('/dashboard/summary', async (req, res, next) => {
  try {
    const year = Number(req.query.year || new Date().getUTCFullYear());
    const month = Number(req.query.month || new Date().getUTCMonth() + 1);
    const { startIso, endIso } = monthRangeUtc(year, month);

    const dre = await db.get(
      `SELECT
         COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) AS revenue,
         COALESCE(SUM(CASE WHEN type = 'expense' AND COALESCE(is_personal_withdrawal,0) = 0 THEN amount ELSE 0 END), 0) AS expenses,
         COALESCE(SUM(CASE WHEN type = 'expense' AND COALESCE(is_personal_withdrawal,0) = 1 THEN amount ELSE 0 END), 0) AS personal_withdrawals
       FROM transactions
       WHERE datetime(occurred_at) >= datetime(?) AND datetime(occurred_at) < datetime(?)`,
      [startIso, endIso]
    );

    const topProducts = await db.all(
      `SELECT
         oi.product_id,
         p.name AS product_name,
         COALESCE(SUM(oi.quantity), 0) AS qty_sold,
         COALESCE(SUM(oi.line_total), 0) AS revenue,
         COALESCE(SUM(oi.line_cost), 0) AS cost,
         COALESCE(SUM(oi.line_total - oi.line_cost), 0) AS margin
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       JOIN products p ON p.id = oi.product_id
       WHERE datetime(o.created_at) >= datetime(?) AND datetime(o.created_at) < datetime(?)
       GROUP BY oi.product_id, p.name
       ORDER BY qty_sold DESC, revenue DESC
       LIMIT 10`,
      [startIso, endIso]
    );

    const marginAgg = await db.get(
      `SELECT
         COALESCE(SUM(oi.line_total), 0) AS revenue,
         COALESCE(SUM(oi.line_cost), 0) AS cost
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       WHERE datetime(o.created_at) >= datetime(?) AND datetime(o.created_at) < datetime(?)`,
      [startIso, endIso]
    );

    const criticalIngredients = await db.all(
      `SELECT
         id,
         name,
         COALESCE(unit, base_unit, 'un') AS unit,
         COALESCE(stock_qty, stock_qty_base, 0) AS stock_qty,
         COALESCE(min_stock_qty, min_stock_qty_base, 0) AS min_stock_qty,
         (COALESCE(min_stock_qty, min_stock_qty_base, 0) - COALESCE(stock_qty, stock_qty_base, 0)) AS shortage
       FROM ingredients
       WHERE COALESCE(stock_qty, stock_qty_base, 0) <= COALESCE(min_stock_qty, min_stock_qty_base, 0)
       ORDER BY shortage DESC, name ASC
       LIMIT 20`
    );

    const monthly_trend = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(Date.UTC(year, month - 1, 1));
      d.setUTCMonth(d.getUTCMonth() - i);
      const y = d.getUTCFullYear();
      const m = d.getUTCMonth() + 1;
      const range = monthRangeUtc(y, m);

      const sums = await db.get(
        `SELECT
           COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) AS revenue,
           COALESCE(SUM(CASE WHEN type = 'expense' AND COALESCE(is_personal_withdrawal,0)=0 THEN amount ELSE 0 END), 0) AS expenses
         FROM transactions
         WHERE datetime(occurred_at) >= datetime(?) AND datetime(occurred_at) < datetime(?)`,
        [range.startIso, range.endIso]
      );

      monthly_trend.push({
        month: monthLabel(y, m),
        revenue: toNumber(sums?.revenue, 0),
        expenses: toNumber(sums?.expenses, 0),
      });
    }

    const revenue = toNumber(dre?.revenue, 0);
    const expenses = toNumber(dre?.expenses, 0);
    const personal_withdrawals = toNumber(dre?.personal_withdrawals, 0);
    const orderRevenue = toNumber(marginAgg?.revenue, 0);
    const orderCost = toNumber(marginAgg?.cost, 0);
    const business_margin_percent = orderRevenue > 0 ? ((orderRevenue - orderCost) / orderRevenue) * 100 : 0;

    res.json({
      cards: {
        revenue,
        expenses,
        net_profit: revenue - expenses,
        personal_withdrawals,
      },
      business_margin_percent,
      top_products: (topProducts || []).map((r) => ({
        product_id: r.product_id,
        product_name: r.product_name,
        qty_sold: toNumber(r.qty_sold, 0),
        revenue: toNumber(r.revenue, 0),
        cost: toNumber(r.cost, 0),
        margin: toNumber(r.margin, 0),
      })),
      critical_ingredients: (criticalIngredients || []).map((r) => ({
        id: r.id,
        name: r.name,
        unit: r.unit,
        stock_qty: toNumber(r.stock_qty, 0),
        min_stock_qty: toNumber(r.min_stock_qty, 0),
        shortage: Math.max(0, toNumber(r.shortage, 0)),
      })),
      monthly_trend,
    });
  } catch (err) {
    next(err);
  }
});

// ===============================
// ERRO GLOBAL
// ===============================
app.use((err, _req, res, _next) => {
  console.error(err);
  const status = Number(err?.status || 500);
  const message = err?.message || 'Erro interno do servidor';
  res.status(status).json({ error: message });
});

// ===============================
// START
// ===============================
(async () => {
  try {
    await initDatabase();
    app.listen(PORT, () => {
      console.log(`✅ Binho Estrutura API rodando em http://localhost:${PORT}`);
      console.log(`📦 Banco SQLite: ${DB_FILE}`);
      console.log(`🔐 Login padrão: binho@local / admin123`);
    });
  } catch (err) {
    console.error('Falha ao iniciar backend:', err);
    process.exit(1);
  }
})();