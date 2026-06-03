const admin = require('firebase-admin');
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const Tesseract = require('tesseract.js');
const path = require('path');

// Inicialização do Firebase Admin
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
} else {
  admin.initializeApp();
}
const db = admin.firestore();

const JWT_SECRET = process.env.JWT_SECRET || 'troque-essa-chave-em-producao';

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// Configuração do multer para guardar a imagem na memória
const upload = multer({ storage: multer.memoryStorage() });

// ===============================
// HELPERS
// ===============================
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
  if (!source) throw new Error('Unidade de entrada inválida.');

  const target = UNIT_META[normalizeUnitInput(targetBaseUnit) || ''];
  if (!target) throw new Error('Unidade de destino inválida.');

  if (source.base_unit !== target.base_unit) {
    throw new Error(`Unidade incompatível com o insumo (esperado família do ${target.base_unit}).`);
  }

  return (q * source.factor_to_base) / target.factor_to_base;
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

// ===============================
// OCR PARSER
// ===============================
function parseReceiptText(text) {
  const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
  const itemsMap = new Map();
  let totalPurchase = 0;

  const pricePattern = /(?:(\d*)\s*(UN|IUN|KG|G|L)[\s,\.\—\-]*)?(\d+[\.,]\d{2})[\s\.\—\-]+(\d+[\.,]\d{2})\s*.*?$/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(pricePattern);

    if (match) {
      let qty = parseInt(match[1], 10);
      if (isNaN(qty)) qty = 1;

      const unitPrice = parseFloat(match[3].replace(',', '.'));
      const totalPrice = parseFloat(match[4].replace(',', '.'));

      let itemName = line.replace(match[0], '').trim();

      if (itemName.length < 5 && i > 0) {
        itemName = lines[i - 1];
      }

      const nameMatch = itemName.match(/[A-Z]{2,}.*$/);
      if (nameMatch) {
        itemName = nameMatch[0];
      }

      itemName = itemName.replace(/\s+[^A-Z0-9]{1,2}$/i, '').trim();

      let normalizedName = itemName.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
      let groupKey = normalizedName.split(' ').slice(0, 3).join(' ');

      if (itemsMap.has(groupKey)) {
        const existingItem = itemsMap.get(groupKey);
        existingItem.quantity += qty;
        existingItem.total_price += totalPrice;
      } else {
        itemsMap.set(groupKey, {
          name: normalizedName,
          quantity: qty,
          unit_price: unitPrice,
          total_price: totalPrice
        });
      }
    }

    if (line.toUpperCase().includes('PAGAR R$') || line.toUpperCase().includes('VALOR PAGO')) {
       const totalMatch = line.match(/(\d+,\d{2})/);
       if (totalMatch) {
           totalPurchase = parseFloat(totalMatch[1].replace(',', '.'));
       }
    }
  }

  return {
    items: Array.from(itemsMap.values()),
    total_purchase: totalPurchase
  };
}

// ===============================
// AUTH MIDDLEWARE
// ===============================
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

// ===============================
// FIRESTORE HELPERS
// ===============================
async function seedDefaults() {
  const metaRef = db.collection('_meta').doc('seeded');
  const metaDoc = await metaRef.get();
  if (metaDoc.exists) return;

  const usersRef = db.collection('users');
  const userSnapshot = await usersRef.where('email', '==', 'binho@local').get();
  
  if (userSnapshot.empty) {
    const password_hash = await bcrypt.hash('admin123', 10);
    await usersRef.add({
      name: 'Binho',
      email: 'binho@local',
      password_hash,
      must_change_password: 1,
      created_at: nowIso(),
      updated_at: nowIso()
    });
  }

  const accountsRef = db.collection('accounts');
  const defaultAccounts = [
    { name: 'Nubank', type: 'Conta Corrente' },
    { name: 'Caixa', type: 'Conta Corrente' },
    { name: 'Poupança', type: 'Poupança' },
  ];

  for (const acc of defaultAccounts) {
    const snap = await accountsRef.where('name', '==', acc.name).get();
    if (snap.empty) {
      await accountsRef.add({
        ...acc,
        opening_balance: 0,
        is_active: 1,
        created_at: nowIso(),
        updated_at: nowIso()
      });
    }
  }

  const categoriesRef = db.collection('categories');
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
    const snap = await categoriesRef.where('name', '==', name).get();
    if (snap.empty) {
      await categoriesRef.add({
        name,
        type,
        is_personal,
        created_at: nowIso(),
        updated_at: nowIso()
      });
    }
  }

  await metaRef.set({ at: nowIso() });
}

async function ensureDasRows(year) {
  const y = Number(year);
  const dasRef = db.collection('das_payments');
  for (let month = 1; month <= 12; month++) {
    const snap = await dasRef.where('year', '==', y).where('month', '==', month).get();
    if (snap.empty) {
      const dueDate = new Date(Date.UTC(y, month, 20, 12, 0, 0)).toISOString();
      await dasRef.add({
        year: y,
        month,
        status: 'pending',
        due_date: dueDate,
        amount: null,
        created_at: nowIso(),
        updated_at: nowIso()
      });
    }
  }
}

async function getCategoryByName(name) {
  const snap = await db.collection('categories').where('name', '==', name).limit(1).get();
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ...snap.docs[0].data() };
}

async function getProductCostSummary(productId) {
  const productDoc = await db.collection('products').doc(productId).get();
  if (!productDoc.exists) {
    const err = new Error('Produto não encontrado.');
    err.status = 404;
    throw err;
  }
  const product = productDoc.data();
  product.id = productDoc.id;

  const compositionSnap = await db.collection('products').doc(productId).collection('composition').get();
  const composition = [];
  
  let calculated_cost = 0;
  for (const doc of compositionSnap.docs) {
    const data = doc.data();
    const ingDoc = await db.collection('ingredients').doc(data.ingredient_id).get();
    const ing = ingDoc.exists ? ingDoc.data() : { name: 'Desconhecido', unit: 'un', cost_per_unit: 0 };
    
    const factor = 1 + toNumber(data.waste_pct, 0) / 100;
    const ingredient_cost = toNumber(data.quantity, 0) * toNumber(ing.cost_per_unit || ing.last_cost_per_base_unit, 0) * factor;
    calculated_cost += ingredient_cost;
    
    composition.push({
      ingredient_id: data.ingredient_id,
      quantity: toNumber(data.quantity),
      waste_pct: toNumber(data.waste_pct),
      ingredient_name: ing.name,
      unit: ing.unit || ing.base_unit || 'un',
      cost_per_unit: toNumber(ing.cost_per_unit || ing.last_cost_per_base_unit),
      ingredient_cost,
    });
  }

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
    composition,
    calculated_cost,
    margin_amount,
    margin_percent,
  };
}

// ===============================
// AUTH ROUTES
// ===============================
app.post('/auth/login', async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'E-mail e senha são obrigatórios.' });

    const snap = await db.collection('users').where('email', '==', String(email).trim()).limit(1).get();
    if (snap.empty) return res.status(401).json({ error: 'Credenciais inválidas.' });

    const userDoc = snap.docs[0];
    const user = userDoc.data();
    const ok = await bcrypt.compare(String(password), user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Credenciais inválidas.' });

    const token = jwt.sign(
      { id: userDoc.id, email: user.email, name: user.name },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      token,
      user: {
        id: userDoc.id,
        name: user.name,
        email: user.email,
        must_change_password: Number(user.must_change_password || 0),
      },
    });
  } catch (err) { next(err); }
});

app.get('/auth/me', authRequired, async (req, res, next) => {
  try {
    const doc = await db.collection('users').doc(req.user.id).get();
    if (!doc.exists) return res.status(404).json({ error: 'Usuário não encontrado.' });
    const user = doc.data();
    res.json({ user: { id: doc.id, name: user.name, email: user.email, must_change_password: user.must_change_password } });
  } catch (err) { next(err); }
});

app.post('/auth/first-access', authRequired, async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'E-mail e senha são obrigatórios.' });
    if (String(password).length < 6) return res.status(400).json({ error: 'A senha deve ter pelo menos 6 caracteres.' });

    const snap = await db.collection('users').where('email', '==', String(email).trim()).get();
    if (!snap.empty && snap.docs.some(d => d.id !== req.user.id)) {
      return res.status(400).json({ error: 'Este e-mail já está em uso.' });
    }

    const password_hash = await bcrypt.hash(String(password), 10);
    await db.collection('users').doc(req.user.id).update({
      email: String(email).trim(),
      password_hash,
      must_change_password: 0,
      updated_at: nowIso()
    });

    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ===============================
// HEALTH
// ===============================
app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'Binho Estrutura API (Firebase)', timestamp: nowIso() });
});

// Protege tudo daqui pra baixo
app.use(authRequired);

// ===============================
// ACCOUNTS
// ===============================
app.get('/accounts', async (_req, res, next) => {
  try {
    const snap = await db.collection('accounts').orderBy('is_active', 'desc').get();
    const accounts = snap.docs.map(doc => ({ id: doc.id, ...doc.data(), current_balance: toNumber(doc.data().opening_balance, 0) }));

    const txSnap = await db.collection('transactions').get();
    const balanceMap = {};
    txSnap.forEach(t => {
      const tdata = t.data();
      if (!tdata.account_id) return;
      const amount = toNumber(tdata.amount);
      if (!balanceMap[tdata.account_id]) balanceMap[tdata.account_id] = 0;
      if (tdata.type === 'income') balanceMap[tdata.account_id] += amount;
      else balanceMap[tdata.account_id] -= amount;
    });

    accounts.forEach(acc => {
      acc.current_balance += (balanceMap[acc.id] || 0);
    });

    res.json(accounts);
  } catch (err) { next(err); }
});

app.post('/accounts', async (req, res, next) => {
  try {
    const { name, type, opening_balance, is_active } = req.body || {};
    if (!String(name || '').trim()) return res.status(400).json({ error: 'Nome da conta é obrigatório.' });

    const snap = await db.collection('accounts').where('name', '==', String(name).trim()).get();
    if (!snap.empty) return res.status(400).json({ error: 'Já existe uma conta com esse nome.' });

    const docRef = await db.collection('accounts').add({
      name: String(name).trim(),
      type: String(type || 'Conta Corrente'),
      opening_balance: toNumber(opening_balance, 0),
      is_active: Number(is_active ?? 1) ? 1 : 0,
      created_at: nowIso(),
      updated_at: nowIso(),
    });

    const doc = await docRef.get();
    res.status(201).json({ id: doc.id, ...doc.data() });
  } catch (err) { next(err); }
});

app.put('/accounts/:id', async (req, res, next) => {
  try {
    const { name, type, opening_balance, is_active } = req.body || {};
    await db.collection('accounts').doc(req.params.id).update({
      name: String(name || '').trim(),
      type: String(type || 'Conta Corrente'),
      opening_balance: toNumber(opening_balance, 0),
      is_active: Number(is_active ?? 1) ? 1 : 0,
      updated_at: nowIso(),
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

app.delete('/accounts/:id', async (req, res, next) => {
  try {
    const txSnap = await db.collection('transactions').where('account_id', '==', req.params.id).limit(1).get();
    const orderSnap = await db.collection('orders').where('account_id', '==', req.params.id).limit(1).get();
    if (!txSnap.empty || !orderSnap.empty) {
      return res.status(400).json({ error: 'Conta possui registros vinculados e não pode ser excluída.' });
    }
    await db.collection('accounts').doc(req.params.id).delete();
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ===============================
// CATEGORIES
// ===============================
app.get('/categories', async (_req, res, next) => {
  try {
    const snap = await db.collection('categories').orderBy('name').get();
    res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  } catch (err) { next(err); }
});

app.post('/categories', async (req, res, next) => {
  try {
    const { name, type, is_personal } = req.body || {};
    if (!String(name || '').trim()) return res.status(400).json({ error: 'Nome é obrigatório.' });

    const snap = await db.collection('categories').where('name', '==', String(name).trim()).get();
    if (!snap.empty) return res.status(400).json({ error: 'Categoria já existe.' });

    const docRef = await db.collection('categories').add({
      name: String(name).trim(),
      type: ['income', 'expense', 'both'].includes(String(type)) ? String(type) : 'both',
      is_personal: Number(is_personal || 0) ? 1 : 0,
      created_at: nowIso(),
      updated_at: nowIso()
    });
    const doc = await docRef.get();
    res.status(201).json({ id: doc.id, ...doc.data() });
  } catch (err) { next(err); }
});

app.put('/categories/:id', async (req, res, next) => {
  try {
    const { name, type, is_personal } = req.body || {};
    await db.collection('categories').doc(req.params.id).update({
      name: String(name).trim(),
      type: ['income', 'expense', 'both'].includes(String(type)) ? String(type) : 'both',
      is_personal: Number(is_personal || 0) ? 1 : 0,
      updated_at: nowIso()
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

app.delete('/categories/:id', async (req, res, next) => {
  try {
    const snap = await db.collection('transactions').where('category_id', '==', req.params.id).limit(1).get();
    if (!snap.empty) return res.status(400).json({ error: 'Categoria possui transações e não pode ser excluída.' });
    await db.collection('categories').doc(req.params.id).delete();
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ===============================
// CLIENTS
// ===============================
app.get('/clients', async (_req, res, next) => {
  try {
    const snap = await db.collection('clients').orderBy('name').get();
    res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  } catch (err) { next(err); }
});

app.get('/clients/:id/history', async (req, res, next) => {
  try {
    const ordersSnap = await db.collection('orders').where('client_id', '==', req.params.id).orderBy('created_at', 'desc').get();
    const orders = ordersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    
    let total_spent = 0;
    let total_orders = 0;
    orders.forEach(o => {
      if (o.status === 'delivered') {
        total_spent += toNumber(o.total_amount);
        total_orders++;
      }
    });
    
    res.json({ orders, stats: { total_orders, total_spent } });
  } catch (err) { next(err); }
});

app.post('/clients', async (req, res, next) => {
  try {
    const { name, phone, email, notes } = req.body || {};
    if (!String(name || '').trim()) return res.status(400).json({ error: 'Nome do cliente é obrigatório.' });

    const docRef = await db.collection('clients').add({
      name: String(name).trim(),
      phone: phone ? String(phone).trim() : null,
      email: email ? String(email).trim() : null,
      notes: notes ? String(notes) : null,
      created_at: nowIso(),
      updated_at: nowIso()
    });
    const doc = await docRef.get();
    res.status(201).json({ id: doc.id, ...doc.data() });
  } catch (err) { next(err); }
});

app.put('/clients/:id', async (req, res, next) => {
  try {
    const { name, phone, email, notes } = req.body || {};
    await db.collection('clients').doc(req.params.id).update({
      name: String(name || '').trim(),
      phone: phone ? String(phone).trim() : null,
      email: email ? String(email).trim() : null,
      notes: notes ? String(notes) : null,
      updated_at: nowIso()
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

app.delete('/clients/:id', async (req, res, next) => {
  try {
    const ordersSnap = await db.collection('orders').where('client_id', '==', req.params.id).get();
    const batch = db.batch();
    ordersSnap.forEach(doc => batch.update(doc.ref, { client_id: null }));
    await batch.commit();
    await db.collection('clients').doc(req.params.id).delete();
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ===============================
// INGREDIENTS
// ===============================
app.post('/ingredients/extract-receipt', upload.single('receipt'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Nenhuma imagem enviada.' });
    const { data: { text } } = await Tesseract.recognize(req.file.buffer, 'por', {
        langPath: path.join(__dirname)
    });
    res.json(parseReceiptText(text));
  } catch (err) { next(err); }
});

app.get('/ingredients', async (_req, res, next) => {
  try {
    const snap = await db.collection('ingredients').orderBy('name').get();
    res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  } catch (err) { next(err); }
});

app.post('/ingredients', async (req, res, next) => {
  try {
    const body = req.body || {};
    const name = String(body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Nome do insumo é obrigatório.' });

    const snap = await db.collection('ingredients').where('name', '==', name).get();
    if (!snap.empty) return res.status(400).json({ error: 'Já existe um insumo com esse nome.' });

    let unit, measurement_type, base_unit, stock_qty, min_stock_qty, cost_per_unit;

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
      const meta = inferMeasurementFromUnit(base_unit);
      unit = base_unit;
      measurement_type = String(body.measurement_type || meta.measurement_type);
      stock_qty = toNumber(body.stock_qty_base, 0);
      min_stock_qty = toNumber(body.min_stock_qty_base, 0);
      cost_per_unit = toNumber(body.last_cost_per_base_unit, 0);
    }

    const docRef = await db.collection('ingredients').add({
      name, unit, stock_qty, min_stock_qty, cost_per_unit,
      notes: body.notes ? String(body.notes) : null,
      measurement_type, base_unit, stock_qty_base: stock_qty, min_stock_qty_base: min_stock_qty, last_cost_per_base_unit: cost_per_unit,
      created_at: nowIso(), updated_at: nowIso(),
    });
    const doc = await docRef.get();
    res.status(201).json({ id: doc.id, ...doc.data() });
  } catch (err) { next(err); }
});

app.put('/ingredients/:id', async (req, res, next) => {
  try {
    const body = req.body || {};
    const docRef = db.collection('ingredients').doc(req.params.id);
    const doc = await docRef.get();
    if (!doc.exists) return res.status(404).json({ error: 'Insumo não encontrado.' });
    const current = doc.data();

    const name = String(body.name ?? current.name).trim();
    let unit = current.unit, measurement_type = current.measurement_type, base_unit = current.base_unit;
    let stock_qty = current.stock_qty, min_stock_qty = current.min_stock_qty, cost_per_unit = current.cost_per_unit;

    if (body.unit !== undefined) {
      const meta = inferMeasurementFromUnit(body.unit);
      unit = meta.unit; measurement_type = meta.measurement_type; base_unit = meta.base_unit;
      stock_qty = toNumber(body.stock_qty, stock_qty);
      min_stock_qty = toNumber(body.min_stock_qty, min_stock_qty);
      cost_per_unit = toNumber(body.cost_per_unit, cost_per_unit);
    } else if (body.base_unit || body.measurement_type) {
      const normalizedBase = normalizeUnitInput(body.base_unit || current.base_unit);
      const meta = inferMeasurementFromUnit(normalizedBase);
      unit = normalizedBase; base_unit = meta.base_unit;
      measurement_type = String(body.measurement_type || meta.measurement_type);
      stock_qty = toNumber(body.stock_qty_base, current.stock_qty_base);
      min_stock_qty = toNumber(body.min_stock_qty_base, current.min_stock_qty_base);
      cost_per_unit = toNumber(body.last_cost_per_base_unit, current.last_cost_per_base_unit);
    }

    await docRef.update({
      name, unit, stock_qty, min_stock_qty, cost_per_unit,
      notes: body.notes !== undefined ? body.notes : current.notes,
      measurement_type, base_unit, stock_qty_base: stock_qty, min_stock_qty_base: min_stock_qty, last_cost_per_base_unit: cost_per_unit,
      updated_at: nowIso(),
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

app.delete('/ingredients/:id', async (req, res, next) => {
  try {
    const productsSnap = await db.collection('products').get();
    for (const p of productsSnap.docs) {
      const compSnap = await p.ref.collection('composition').where('ingredient_id', '==', req.params.id).limit(1).get();
      if (!compSnap.empty) return res.status(400).json({ error: 'Insumo está vinculado a fichas técnicas.' });
    }
    await db.collection('ingredients').doc(req.params.id).delete();
    res.json({ ok: true });
  } catch (err) { next(err); }
});

app.post('/ingredients/purchase', async (req, res, next) => {
  try {
    const { items } = req.body || {};
    if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'Nenhum item.' });

    await db.runTransaction(async (transaction) => {
      for (const item of items) {
        const { ingredient_id, quantity, purchase_unit, total_cost, note } = item;
        const ingRef = db.collection('ingredients').doc(ingredient_id);
        const doc = await transaction.get(ingRef);
        if (!doc.exists) throw new Error(`Insumo não encontrado: ${ingredient_id}`);
        const ing = doc.data();

        const qtyBase = convertToSpecificBase(quantity, purchase_unit, ing.base_unit || ing.unit);
        const unitCost = toNumber(total_cost) / qtyBase;
        const newStock = toNumber(ing.stock_qty_base ?? ing.stock_qty) + qtyBase;

        transaction.update(ingRef, {
          stock_qty: newStock, stock_qty_base: newStock,
          cost_per_unit: unitCost, last_cost_per_base_unit: unitCost,
          updated_at: nowIso()
        });

        transaction.set(db.collection('stock_movements').doc(), {
          ingredient_id, movement_type: 'purchase', quantity_base: qtyBase,
          unit_base: ing.base_unit || ing.unit, unit_cost_base: unitCost,
          total_cost: toNumber(total_cost), note: note || `Compra: ${quantity} ${purchase_unit}`,
          created_at: nowIso()
        });
      }
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ===============================
// PRODUCTS
// ===============================
app.get('/products', async (_req, res, next) => {
  try {
    const snap = await db.collection('products').orderBy('name').get();
    res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  } catch (err) { next(err); }
});

app.post('/products', async (req, res, next) => {
  try {
    const { name, sale_price, unit_label, is_active, notes } = req.body || {};
    if (!String(name || '').trim()) return res.status(400).json({ error: 'Nome é obrigatório.' });

    const snap = await db.collection('products').where('name', '==', String(name).trim()).get();
    if (!snap.empty) return res.status(400).json({ error: 'Já existe um produto com esse nome.' });

    const docRef = await db.collection('products').add({
      name: String(name).trim(),
      sale_price: toNumber(sale_price),
      unit_label: String(unit_label || 'un'),
      is_active: Number(is_active ?? 1) ? 1 : 0,
      notes: notes ? String(notes) : null,
      created_at: nowIso(), updated_at: nowIso()
    });
    const doc = await docRef.get();
    res.status(201).json({ id: doc.id, ...doc.data() });
  } catch (err) { next(err); }
});

app.put('/products/:id', async (req, res, next) => {
  try {
    const { name, sale_price, unit_label, is_active, notes } = req.body || {};
    await db.collection('products').doc(req.params.id).update({
      name: String(name || '').trim(),
      sale_price: toNumber(sale_price),
      unit_label: String(unit_label || 'un'),
      is_active: Number(is_active ?? 1) ? 1 : 0,
      notes: notes ? String(notes) : null,
      updated_at: nowIso()
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

app.delete('/products/:id', async (req, res, next) => {
  try {
    const snap = await db.collectionGroup('order_items').where('product_id', '==', req.params.id).limit(1).get();
    if (!snap.empty) return res.status(400).json({ error: 'Produto possui pedidos e não pode ser excluído.' });
    
    // Deleta composição
    const compSnap = await db.collection('products').doc(req.params.id).collection('composition').get();
    const batch = db.batch();
    compSnap.forEach(d => batch.delete(d.ref));
    batch.delete(db.collection('products').doc(req.params.id));
    await batch.commit();
    res.json({ ok: true });
  } catch (err) { next(err); }
});

app.get('/products/:id/composition', async (req, res, next) => {
  try { res.json(await getProductCostSummary(req.params.id)); } catch (err) { next(err); }
});

app.put('/products/:id/composition', async (req, res, next) => {
  try {
    const { items } = req.body || [];
    const productRef = db.collection('products').doc(req.params.id);
    const snap = await productRef.get();
    if (!snap.exists) return res.status(404).json({ error: 'Produto não encontrado.' });

    const compRef = productRef.collection('composition');
    const existing = await compRef.get();
    const batch = db.batch();
    existing.forEach(d => batch.delete(d.ref));
    
    for (const item of items) {
      if (!item.ingredient_id || toNumber(item.quantity) <= 0) continue;
      batch.set(compRef.doc(), {
        ingredient_id: item.ingredient_id,
        quantity: toNumber(item.quantity),
        waste_pct: toNumber(item.waste_pct, 0),
        created_at: nowIso(), updated_at: nowIso()
      });
    }
    await batch.commit();
    res.json(await getProductCostSummary(req.params.id));
  } catch (err) { next(err); }
});

// ===============================
// TRANSACTIONS
// ===============================
app.get('/transactions', async (req, res, next) => {
  try {
    let query = db.collection('transactions').orderBy('occurred_at', 'desc');
    const { from, to } = req.query;
    if (from) query = query.where('occurred_at', '>=', new Date(from).toISOString());
    if (to) query = query.where('occurred_at', '<=', new Date(to).toISOString());
    
    const snap = await query.get();
    const transactions = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    const accountIds = [...new Set(transactions.map(t => t.account_id).filter(id => id))];
    const categoryIds = [...new Set(transactions.map(t => t.category_id).filter(id => id))];

    const [accountSnaps, categorySnaps] = await Promise.all([
      accountIds.length ? Promise.all(accountIds.map(id => db.collection('accounts').doc(id).get())) : [],
      categoryIds.length ? Promise.all(categoryIds.map(id => db.collection('categories').doc(id).get())) : []
    ]);

    const accountMap = {};
    accountSnaps.forEach(s => { if (s.exists) accountMap[s.id] = s.data().name; });

    const categoryMap = {};
    categorySnaps.forEach(s => { if (s.exists) categoryMap[s.id] = s.data().name; });

    transactions.forEach(t => {
      t.account_name = t.account_id ? accountMap[t.account_id] || null : null;
      t.category_name = t.category_id ? categoryMap[t.category_id] || null : null;
    });

    res.json(transactions);
  } catch (err) { next(err); }
});

app.post('/transactions', async (req, res, next) => {
  try {
    const data = req.body || {};
    let personalFlag = Number(data.is_personal_withdrawal) ? 1 : 0;
    if (data.category_id) {
      const cat = await db.collection('categories').doc(data.category_id).get();
      if (cat.exists && cat.data().is_personal) personalFlag = 1;
    }

    const docRef = await db.collection('transactions').add({
      type: data.type,
      amount: toNumber(data.amount),
      description: data.description || null,
      account_id: data.account_id || null,
      category_id: data.category_id || null,
      occurred_at: data.occurred_at ? new Date(data.occurred_at).toISOString() : nowIso(),
      is_personal_withdrawal: personalFlag,
      affects_mei_revenue: Number(data.affects_mei_revenue) ? 1 : 0,
      source: data.source || null,
      source_order_id: data.source_order_id || null,
      created_at: nowIso(), updated_at: nowIso()
    });
    const doc = await docRef.get();
    res.status(201).json({ id: doc.id, ...doc.data() });
  } catch (err) { next(err); }
});

app.delete('/transactions/:id', async (req, res, next) => {
  try {
    const doc = await db.collection('transactions').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: 'Não encontrado.' });
    if (doc.data().source === 'order_auto') return res.status(400).json({ error: 'Exclua o pedido para remover esta transação.' });
    await doc.ref.delete();
    res.json({ ok: true });
  } catch (err) { next(err); }
});

app.get('/finance/dre', async (req, res, next) => {
  try {
    const year = Number(req.query.year || new Date().getUTCFullYear());
    const month = Number(req.query.month || new Date().getUTCMonth() + 1);
    const { startIso, endIso } = monthRangeUtc(year, month);

    const txSnap = await db.collection('transactions').where('occurred_at', '>=', startIso).where('occurred_at', '<', endIso).get();
    let revenue = 0, operational_expenses = 0, personal_withdrawals = 0;
    txSnap.forEach(d => {
      const data = d.data();
      const amount = toNumber(data.amount);
      if (data.type === 'income') revenue += amount;
      else {
        if (data.is_personal_withdrawal) personal_withdrawals += amount;
        else operational_expenses += amount;
      }
    });

    res.json({
      dre: {
        revenue,
        operational_expenses,
        net_profit: revenue - operational_expenses,
        personal_withdrawals,
      },
    });
  } catch (err) { next(err); }
});

// ===============================
// ORDERS
// ===============================
app.get('/orders', async (_req, res, next) => {
  try {
    const snap = await db.collection('orders').orderBy('created_at', 'desc').limit(50).get();
    res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  } catch (err) { next(err); }
});

app.get('/kanban/orders', async (_req, res, next) => {
  try {
    const snap = await db.collection('orders').where('status', 'in', ['todo', 'prep', 'ready']).orderBy('delivery_date').get();
    const orders = [];
    const allProductIds = new Set();
    const allClientIds = new Set();

    for (const d of snap.docs) {
      const data = d.data();
      const itemsSnap = await d.ref.collection('items').get();
      const items = itemsSnap.docs.map(idoc => ({ id: idoc.id, ...idoc.data() }));
      items.forEach(i => allProductIds.add(i.product_id));
      if (data.client_id) allClientIds.add(data.client_id);
      orders.push({ id: d.id, ...data, items });
    }

    const [productSnaps, clientSnaps] = await Promise.all([
      allProductIds.size ? Promise.all([...allProductIds].map(id => db.collection('products').doc(id).get())) : [],
      allClientIds.size ? Promise.all([...allClientIds].map(id => db.collection('clients').doc(id).get())) : []
    ]);

    const productMap = {};
    productSnaps.forEach(s => { if (s.exists) productMap[s.id] = s.data().name; });

    const clientMap = {};
    clientSnaps.forEach(s => { if (s.exists) clientMap[s.id] = s.data().name; });

    orders.forEach(o => {
      o.client_name = o.client_id ? clientMap[o.client_id] || null : null;
      o.items.forEach(i => {
        i.product_name = productMap[i.product_id] || '?';
      });
    });

    res.json(orders);
  } catch (err) { next(err); }
});

app.post('/orders', async (req, res, next) => {
  try {
    const body = req.body || {};
    const items = body.items || [];
    if (!items.length) return res.status(400).json({ error: 'Sem itens.' });

    let totalAmount = 0, totalCost = 0;
    const normalizedItems = [];
    for (const item of items) {
      const summary = await getProductCostSummary(item.product_id);
      const lineTotal = item.quantity * item.unit_price;
      const lineCost = item.quantity * summary.calculated_cost;
      totalAmount += lineTotal;
      totalCost += lineCost;
      normalizedItems.push({ ...item, line_total: lineTotal, unit_cost_snapshot: summary.calculated_cost, line_cost: lineCost });
    }

    const orderRef = await db.collection('orders').add({
      customer_name: body.customer_name || null,
      client_id: body.client_id || null,
      channel: body.channel || 'balcao',
      order_type: body.order_type || 'balcao',
      status: 'todo',
      account_id: body.account_id || null,
      total_amount: totalAmount,
      total_cost: totalCost,
      notes: body.notes || null,
      delivery_date: body.delivery_date ? new Date(body.delivery_date).toISOString() : null,
      created_at: nowIso(), updated_at: nowIso()
    });

    const batch = db.batch();
    for (const item of normalizedItems) {
      const itemRef = orderRef.collection('items').doc();
      batch.set(itemRef, { ...item, created_at: nowIso() });
    }
    await batch.commit();
    res.status(201).json({ ok: true, order: { id: orderRef.id } });
  } catch (err) { next(err); }
});

app.put('/orders/:id/status', async (req, res, next) => {
  try {
    const { status } = req.body;
    const orderRef = db.collection('orders').doc(req.params.id);
    const orderDoc = await orderRef.get();
    if (!orderDoc.exists) return res.status(404).json({ error: 'Não encontrado.' });
    const order = orderDoc.data();

    if (status === 'delivered' && order.status !== 'delivered') {
      await db.runTransaction(async (transaction) => {
        const itemsSnap = await orderRef.collection('items').get();
        const ingredientNeeds = new Map();
        const snapshot_items = [];
        const productIds = [...new Set(itemsSnap.docs.map(d => d.data().product_id))];
        
        // Buscar produtos para snapshot_items e getProductCostSummary (via transaction)
        const productDocsMap = {};
        for (const pid of productIds) {
          const pDoc = await transaction.get(db.collection('products').doc(pid));
          if (pDoc.exists) productDocsMap[pid] = pDoc.data();
        }

        for (const itemDoc of itemsSnap.docs) {
          const item = itemDoc.data();
          const summary = await getProductCostSummary(item.product_id); // Nota: getProductCostSummary faz buscas internas fora da transaction. 
          // Re-implementando lógica de custo para usar transaction se possível, mas o prompt diz "reutilizar documentos de produtos já lidos".
          // getProductCostSummary busca composição e ingredientes. 
          
          snapshot_items.push({
            product_id: item.product_id,
            product_name: productDocsMap[item.product_id]?.name || '?',
            quantity: item.quantity,
            unit_price: item.unit_price,
            line_total: item.line_total,
            unit_cost_snapshot: item.unit_cost_snapshot,
            line_cost: item.line_cost
          });

          for (const comp of summary.composition) {
            const factor = 1 + toNumber(comp.waste_pct) / 100;
            const required = item.quantity * toNumber(comp.quantity) * factor;
            ingredientNeeds.set(comp.ingredient_id, (ingredientNeeds.get(comp.ingredient_id) || 0) + required);
          }
        }

        for (const [ingId, need] of ingredientNeeds.entries()) {
          const ingRef = db.collection('ingredients').doc(ingId);
          const ingDoc = await transaction.get(ingRef);
          if (ingDoc.exists) {
            const ing = ingDoc.data();
            const newStock = toNumber(ing.stock_qty_base ?? ing.stock_qty) - need;
            transaction.update(ingRef, { stock_qty: newStock, stock_qty_base: newStock, updated_at: nowIso() });
            transaction.set(db.collection('stock_movements').doc(), {
              ingredient_id: ingId, movement_type: 'sale_consumption', quantity_base: -need,
              unit_base: ing.base_unit || ing.unit, unit_cost_base: toNumber(ing.cost_per_unit),
              total_cost: need * toNumber(ing.cost_per_unit), note: `Consumo #${orderDoc.id}`,
              created_at: nowIso()
            });
          }
        }

        const salesCat = await getCategoryByName('Vendas');
        transaction.set(db.collection('transactions').doc(), {
          type: 'income', amount: order.total_amount, description: `Venda #${orderDoc.id}`,
          account_id: order.account_id, category_id: salesCat?.id || null,
          occurred_at: nowIso(), is_personal_withdrawal: 0, affects_mei_revenue: 1,
          source: 'order_auto', source_order_id: orderDoc.id, created_at: nowIso(), updated_at: nowIso()
        });

        transaction.update(orderRef, { status, delivered_at: nowIso(), snapshot_items, updated_at: nowIso() });
      });
      return res.json({ ok: true });
    }

    await orderRef.update({ status, updated_at: nowIso() });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ===============================
// DASHBOARD & DRE
// ===============================
app.get('/dashboard/summary', async (req, res, next) => {
  try {
    const year = Number(req.query.year || new Date().getUTCFullYear());
    const month = Number(req.query.month || new Date().getUTCMonth() + 1);
    const { startIso, endIso } = monthRangeUtc(year, month);

    const txSnap = await db.collection('transactions').where('occurred_at', '>=', startIso).where('occurred_at', '<', endIso).get();
    let revenue = 0, expenses = 0, personal_withdrawals = 0;
    txSnap.forEach(d => {
      const data = d.data();
      if (data.type === 'income') revenue += toNumber(data.amount);
      else {
        if (data.is_personal_withdrawal) personal_withdrawals += toNumber(data.amount);
        else expenses += toNumber(data.amount);
      }
    });

    const activeOrdersSnap = await db.collection('orders').where('status', 'in', ['todo', 'prep', 'ready']).get();
    const active_orders = activeOrdersSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    const ingSnap = await db.collection('ingredients').get();
    const critical_ingredients = ingSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(i => toNumber(i.stock_qty) <= toNumber(i.min_stock_qty))
      .map(i => ({ ...i, shortage: Math.max(0, toNumber(i.min_stock_qty) - toNumber(i.stock_qty)) }))
      .sort((a, b) => b.shortage - a.shortage)
      .slice(0, 20);

    // Top Products & Clients (Based on delivered orders in the month using snapshot)
    const deliveredOrdersSnap = await db.collection('orders')
      .where('status', '==', 'delivered')
      .where('delivered_at', '>=', startIso)
      .where('delivered_at', '<', endIso)
      .get();
    
    const productStats = {};
    const clientStats = {};
    let total_revenue = 0;
    let total_cost = 0;

    for (const oDoc of deliveredOrdersSnap.docs) {
      const order = oDoc.data();
      total_revenue += toNumber(order.total_amount);
      total_cost += toNumber(order.total_cost);

      if (order.client_id) {
        if (!clientStats[order.client_id]) {
          clientStats[order.client_id] = { client_id: order.client_id, order_count: 0, total_spent: 0 };
        }
        clientStats[order.client_id].order_count++;
        clientStats[order.client_id].total_spent += toNumber(order.total_amount);
      }

      const items = order.snapshot_items || [];
      items.forEach(item => {
        if (!productStats[item.product_id]) {
          productStats[item.product_id] = { product_id: item.product_id, product_name: item.product_name, qty_sold: 0, revenue: 0, cost: 0 };
        }
        productStats[item.product_id].qty_sold += toNumber(item.quantity);
        productStats[item.product_id].revenue += toNumber(item.line_total);
        productStats[item.product_id].cost += toNumber(item.line_cost);
      });
    }

    const top_products = Object.values(productStats)
      .map(p => ({ ...p, margin: p.revenue - p.cost }))
      .sort((a, b) => b.qty_sold - a.qty_sold)
      .slice(0, 10);

    const business_margin_percent = total_revenue > 0 ? ((total_revenue - total_cost) / total_revenue) * 100 : 0;

    // Enriquecer top_clients com nomes em paralelo
    const topClientsRaw = Object.values(clientStats)
      .sort((a, b) => b.total_spent - a.total_spent)
      .slice(0, 5);
    
    const clientNamesSnaps = await Promise.all(
      topClientsRaw.map(c => db.collection('clients').doc(c.client_id).get())
    );
    
    const top_clients = topClientsRaw.map((c, i) => ({
      ...c,
      client_name: clientNamesSnaps[i].exists ? clientNamesSnaps[i].data().name : 'Desconhecido'
    }));

    // Monthly Trend (last 6 months)
    const monthly_trend = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(Date.UTC(year, month - 1, 1));
      d.setUTCMonth(d.getUTCMonth() - i);
      const ty = d.getUTCFullYear();
      const tm = d.getUTCMonth() + 1;
      const range = monthRangeUtc(ty, tm);
      
      const tSnap = await db.collection('transactions')
        .where('occurred_at', '>=', range.startIso)
        .where('occurred_at', '<', range.endIso)
        .get();
      
      let r = 0, e = 0;
      tSnap.forEach(doc => {
        const data = doc.data();
        if (data.type === 'income') r += toNumber(data.amount);
        else if (!data.is_personal_withdrawal) e += toNumber(data.amount);
      });
      monthly_trend.push({ month: monthLabel(ty, tm), revenue: r, expenses: e });
    }

    res.json({
      cards: { revenue, expenses, net_profit: revenue - expenses, personal_withdrawals, business_margin_percent },
      active_orders,
      critical_ingredients,
      top_products,
      top_clients,
      monthly_trend
    });
  } catch (err) { next(err); }
});

// ===============================
// MEI / DAS
// ===============================
app.get('/mei/status', async (req, res, next) => {
  try {
    const year = Number(req.query.year || new Date().getUTCFullYear());
    await ensureDasRows(year);
    const { startIso, endIso } = yearRangeUtc(year);
    const txSnap = await db.collection('transactions').where('occurred_at', '>=', startIso).where('occurred_at', '<', endIso).get();
    
    let business_revenue = 0, business_expenses = 0, personal_withdrawals = 0;
    txSnap.forEach(d => {
      const data = d.data();
      if (data.type === 'income' && data.affects_mei_revenue) business_revenue += toNumber(data.amount);
      else if (data.type === 'expense') {
        if (data.is_personal_withdrawal) personal_withdrawals += toNumber(data.amount);
        else business_expenses += toNumber(data.amount);
      }
    });

    const dasSnap = await db.collection('das_payments').where('year', '==', year).get();
    const das_stats = { paid: 0, pending: 0, overdue: 0 };
    dasSnap.forEach(d => {
      const s = d.data().status;
      if (s === 'paid') das_stats.paid++;
      else if (s === 'overdue') das_stats.overdue++;
      else das_stats.pending++;
    });

    const mei_limit = 81000;
    const used_percentage = (business_revenue / mei_limit) * 100;
    let alert_level = "ok";
    if (used_percentage >= 80) alert_level = "danger";
    else if (used_percentage >= 60) alert_level = "warning";

    res.json({
      year, mei_limit, business_revenue, business_expenses, personal_withdrawals,
      remaining_limit: Math.max(0, mei_limit - business_revenue),
      used_percentage,
      alert_level,
      das_stats
    });
  } catch (err) { next(err); }
});

app.get('/mei/das', async (req, res, next) => {
    try {
        const year = Number(req.query.year || new Date().getUTCFullYear());
        await ensureDasRows(year);
        const snap = await db.collection('das_payments').where('year', '==', year).orderBy('month').get();
        res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (err) { next(err); }
});

app.put('/mei/das/:id', async (req, res, next) => {
    try {
        const data = req.body || {};
        const s = ['pending', 'paid', 'overdue'].includes(data.status) ? data.status : 'pending';
        await db.collection('das_payments').doc(req.params.id).update({
            status: s,
            paid_at: s === 'paid' ? (data.paid_at ? new Date(data.paid_at).toISOString() : nowIso()) : null,
            amount: data.amount !== undefined ? toNumber(data.amount) : null,
            note: data.note || null,
            updated_at: nowIso()
        });
        res.json({ ok: true });
    } catch (err) { next(err); }
});

// Inicialização automática
(async () => {
  try {
    await seedDefaults();
    await ensureDasRows(new Date().getUTCFullYear());
  } catch (err) { console.error('Seed error:', err); }
})();

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`API rodando na porta ${PORT}`));
