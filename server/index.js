import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = express();
const httpsMode = process.argv.includes('--https') || process.env.HTTPS === 'true';
const port = Number(process.env.PORT || (httpsMode ? 8443 : 4000));
const host = process.env.HOST || '0.0.0.0';
const mongoUri = process.env.MONGODB_URI
  || process.env.MONGO_URL
  || process.env.MONGO_PRIVATE_URL
  || process.env.MONGO_PUBLIC_URL
  || 'mongodb://127.0.0.1:27017/MobileShopDB';
const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const defaultPfxPath = path.join(projectRoot, '..', 'certs', 'omar-shop-local.pfx');
const httpsPfxPath = process.env.HTTPS_PFX_PATH || (httpsMode && fs.existsSync(defaultPfxPath) ? defaultPfxPath : '');
const httpsPassphrase = process.env.HTTPS_PFX_PASSPHRASE || (httpsMode ? 'omar-shop-local' : '');

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(projectRoot, '..', 'dist')));
app.get('/omar-shop-local.cer', (_request, response) => response.sendFile(path.join(projectRoot, '..', 'certs', 'omar-shop-local.cer')));

const productSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  type: { type: String, required: true, trim: true },
  quantity: { type: Number, required: true, min: 0 },
  purchasePrice: { type: Number, required: true, min: 0 },
  sellingPrice: { type: Number, required: true, min: 0 },
  minQuantity: { type: Number, required: true, min: 0 },
  createdAt: { type: Date, default: Date.now },
});
productSchema.index({ name: 1 });
productSchema.index({ type: 1 });

const customerSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  phone: { type: String, required: true, trim: true, unique: true },
  address: { type: String, default: '' },
  balance: { type: Number, default: 0, min: 0 },
});

const invoiceSchema = new mongoose.Schema({
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
  items: [{ productId: mongoose.Schema.Types.ObjectId, name: String, quantity: Number, unitPrice: Number, total: Number }],
  subtotal: { type: Number, required: true, min: 0 },
  paid: { type: Number, default: 0, min: 0 },
  remaining: { type: Number, required: true, min: 0 },
  status: { type: String, enum: ['unpaid', 'partial', 'paid'], default: 'unpaid' },
  createdAt: { type: Date, default: Date.now },
});

const paymentSchema = new mongoose.Schema({
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
  invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice' },
  amount: { type: Number, required: true, min: 0.01 },
  paymentMethod: { type: String, enum: ['cash', 'card', 'transfer', 'instapay', 'other'], required: true },
  createdAt: { type: Date, default: Date.now },
});

const Product = mongoose.model('Product', productSchema);
const Customer = mongoose.model('Customer', customerSchema);
const Invoice = mongoose.model('Invoice', invoiceSchema);
const Payment = mongoose.model('Payment', paymentSchema);

app.get('/api/health', (_request, response) => response.json({ ok: true, database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected' }));

app.get('/api/products', async (request, response, next) => {
  try {
    const filter = request.query.search ? { $or: [{ name: new RegExp(request.query.search, 'i') }, { type: new RegExp(request.query.search, 'i') }] } : {};
    response.json(await Product.find(filter).sort({ createdAt: -1 }).lean());
  } catch (error) { next(error); }
});

app.post('/api/products', async (request, response, next) => {
  try {
    const product = await Product.create(request.body);
    response.status(201).json(product);
  } catch (error) { next(error); }
});

app.patch('/api/products/:id', async (request, response, next) => {
  try {
    const product = await Product.findByIdAndUpdate(request.params.id, request.body, { new: true, runValidators: true });
    if (!product) return response.status(404).json({ message: 'المنتج غير موجود' });
    response.json(product);
  } catch (error) { next(error); }
});

app.delete('/api/products/:id', async (request, response, next) => {
  try {
    const product = await Product.findByIdAndDelete(request.params.id);
    if (!product) return response.status(404).json({ message: 'المنتج غير موجود' });
    response.status(204).end();
  } catch (error) { next(error); }
});

app.get('/api/customers', async (_request, response, next) => {
  try { response.json(await Customer.find().sort({ name: 1 }).lean()); } catch (error) { next(error); }
});
app.post('/api/customers', async (request, response, next) => {
  try { response.status(201).json(await Customer.create(request.body)); } catch (error) { next(error); }
});
app.delete('/api/customers/:id', async (request, response, next) => {
  try {
    const customer = await Customer.findByIdAndDelete(request.params.id);
    if (!customer) return response.status(404).json({ message: 'العميل غير موجود' });
    response.status(204).end();
  } catch (error) { next(error); }
});
app.patch('/api/customers/:id', async (request, response, next) => {
  try {
    const customer = await Customer.findByIdAndUpdate(request.params.id, request.body, { new: true, runValidators: true });
    if (!customer) return response.status(404).json({ message: 'العميل غير موجود' });
    response.json(customer);
  } catch (error) { next(error); }
});

app.get('/api/invoices', async (_request, response, next) => {
  try { response.json(await Invoice.find().populate('customerId', 'name phone').sort({ createdAt: -1 }).lean()); } catch (error) { next(error); }
});
app.post('/api/invoices', async (request, response, next) => {
  try {
    const { customerId, items, paid = 0 } = request.body;
    if (!customerId || !Array.isArray(items) || items.length === 0) return response.status(400).json({ message: 'العميل والمنتجات مطلوبان' });
    const normalizedPaid = Number(paid);
    if (!Number.isFinite(normalizedPaid) || normalizedPaid < 0) return response.status(400).json({ message: 'المبلغ المدفوع غير صحيح' });
    const productIds = items.map((item) => item.productId);
    if (new Set(productIds.map(String)).size !== productIds.length) return response.status(400).json({ message: 'لا يمكن تكرار المنتج داخل الفاتورة' });
    const products = await Product.find({ _id: { $in: productIds } }).lean();
    const customer = await Customer.findById(customerId).lean();
    if (!customer) return response.status(404).json({ message: 'العميل غير موجود' });
    const productMap = new Map(products.map((product) => [String(product._id), product]));
    for (const item of items) {
      const product = productMap.get(String(item.productId));
      if (!product) return response.status(404).json({ message: 'أحد المنتجات غير موجود' });
      if (!Number.isInteger(item.quantity) || item.quantity < 1 || product.quantity < item.quantity) return response.status(400).json({ message: `الكمية غير متاحة للمنتج: ${product.name}` });
    }
    const normalizedItems = items.map((item) => ({ productId: item.productId, name: productMap.get(String(item.productId)).name, quantity: item.quantity, unitPrice: item.unitPrice ?? productMap.get(String(item.productId)).sellingPrice, total: item.quantity * (item.unitPrice ?? productMap.get(String(item.productId)).sellingPrice) }));
    const subtotal = normalizedItems.reduce((sum, item) => sum + item.total, 0);
    if (normalizedPaid > subtotal) return response.status(400).json({ message: 'المبلغ المدفوع غير صحيح' });
    const remaining = subtotal - normalizedPaid;
    const status = remaining === 0 ? 'paid' : normalizedPaid > 0 ? 'partial' : 'unpaid';
    const createdInvoice = await Invoice.create({ customerId, items: normalizedItems, subtotal, paid: normalizedPaid, remaining, status });
    await Customer.findByIdAndUpdate(customerId, { $inc: { balance: remaining } });
    await Promise.all(normalizedItems.map((item) => Product.findByIdAndUpdate(item.productId, { $inc: { quantity: -item.quantity } })));
    response.status(201).json(createdInvoice);
  } catch (error) { next(error); }
});

app.get('/api/payments', async (_request, response, next) => {
  try { response.json(await Payment.find().populate('customerId invoiceId').sort({ createdAt: -1 }).lean()); } catch (error) { next(error); }
});
app.post('/api/payments', async (request, response, next) => {
  try {
    const { customerId, invoiceId, amount, paymentMethod } = request.body;
    if (!customerId || !amount || !paymentMethod) return response.status(400).json({ message: 'العميل والمبلغ وطريقة الدفع مطلوبة' });
    const normalizedAmount = Number(amount);
    if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) return response.status(400).json({ message: 'المبلغ يجب أن يكون أكبر من صفر' });
    const customer = await Customer.findById(customerId);
    if (!customer) return response.status(404).json({ message: 'العميل غير موجود' });
    const invoice = invoiceId ? await Invoice.findById(invoiceId) : null;
    if (invoiceId && !invoice) return response.status(404).json({ message: 'الفاتورة غير موجودة' });
    if (invoice && String(invoice.customerId) !== String(customerId)) return response.status(400).json({ message: 'الفاتورة لا تخص هذا العميل' });
    if (invoice && normalizedAmount > invoice.remaining) return response.status(400).json({ message: 'المبلغ أكبر من المتبقي على الفاتورة' });
    if (!invoice && normalizedAmount > customer.balance) return response.status(400).json({ message: 'المبلغ أكبر من رصيد العميل المستحق' });
    const payment = await Payment.create({ customerId, invoiceId, amount: normalizedAmount, paymentMethod });
    if (invoice) {
      invoice.paid += normalizedAmount;
      invoice.remaining = Math.max(invoice.subtotal - invoice.paid, 0);
      invoice.status = invoice.remaining === 0 ? 'paid' : 'partial';
      await invoice.save();
    }
    await Customer.findByIdAndUpdate(customerId, { $inc: { balance: -amount } });
    response.status(201).json(payment);
  } catch (error) { next(error); }
});

app.use((error, _request, response, _next) => {
  const duplicate = error?.code === 11000;
  response.status(duplicate ? 409 : 400).json({ message: duplicate ? 'رقم الهاتف مستخدم بالفعل' : error.message });
});

app.get('/{*splat}', (_request, response, next) => {
  if (_request.path.startsWith('/api/')) return next();
  response.sendFile(path.join(projectRoot, '..', 'dist', 'index.html'));
});

mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000 })
  .then(() => {
    if (httpsPfxPath) {
      const server = https.createServer({ pfx: fs.readFileSync(httpsPfxPath), passphrase: httpsPassphrase }, app);
      server.listen(port, host, () => console.log(`HTTPS app running on https://${host}:${port}`));
      return;
    }
    app.listen(port, host, () => console.log(`API running on http://${host}:${port}`));
  })
  .catch((error) => {
    console.error(`MongoDB connection failed at ${mongoUri}: ${error.message}`);
    console.error('Install/start MongoDB or run Docker before starting the API.');
    process.exitCode = 1;
  });
