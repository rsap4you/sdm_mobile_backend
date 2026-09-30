import { Router, Request, Response, NextFunction } from "express";
import rateLimit from "express-rate-limit";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import multer from "multer";
import { Repair, Product, User, Message, STATUSES } from "./models";
import { productImageStorage, profileImageStorage } from "./Cloudnary";

const r = Router();
const fail = (status: number, message: string) => Object.assign(new Error(message), { status });
const same = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const esc = (s: unknown) => String(s ?? "").trim().slice(0, 300);

// ---- Ahmedabad address + pincode validation ----
// City range 380001-380063. Outskirts use 382xxx: add/verify yours in AMD_EXTRA (India Post list).
const AMD_EXTRA = new Set<string>(["382330", "382350", "382424", "382481"]);
const validPin = (p: string) => /^\d{6}$/.test(p) && ((+p >= 380001 && +p <= 380063) || AMD_EXTRA.has(p));

const addr = (b: any) => {
  const a = b?.address || {};
  const x = { line1: esc(a.line1), line2: esc(a.line2), landmark: esc(a.landmark), city: "Ahmedabad", pincode: esc(a.pincode) };
  if (x.line1.length < 5) throw fail(400, "Please enter your full address (house no., society, area).");
  if (!validPin(x.pincode)) throw fail(400, "Sorry, we currently serve Ahmedabad pincodes only.");
  return x;
};

const hash = (pw: string) => { const s = crypto.randomBytes(16).toString("hex"); return s + ":" + crypto.scryptSync(pw, s, 64).toString("hex"); };
const check = (pw: string, h: string) => { const [s, k] = (h || ":").split(":"); return same(crypto.scryptSync(pw, s, 64).toString("hex"), k || ""); };
const tok = (id: string) => jwt.sign({ u: id }, process.env.JWT_SECRET!, { expiresIn: "30d" });
const getUid = (req: Request): string | undefined => { try { return (jwt.verify((req.headers.authorization || "").replace("Bearer ", ""), process.env.JWT_SECRET!) as any).u; } catch { return undefined; } };
const user = (req: any, _res: Response, next: NextFunction) => { const id = getUid(req); if (!id) return next(fail(401, "Please log in.")); req.uid = id; next(); };
const mail = /^\S+@\S+\.\S+$/;
const admin = (req: Request, _res: Response, next: NextFunction) => {
  try { const p: any = jwt.verify((req.headers.authorization || "").replace("Bearer ", ""), process.env.JWT_SECRET!); if (!p.a) throw 0; next(); }
  catch { next(fail(401, "Login required.")); }
};

// Product images now upload straight to Cloudinary instead of local disk
// (see ./cloudinary.ts for the storage engine + folder/transform config).
const upload = multer({
  storage: productImageStorage,
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (_q, f, cb) => cb(null, /^image\/(jpeg|png|webp)$/.test(f.mimetype)),
});
const uploadProfile = multer({
  storage: profileImageStorage,
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (_q, f, cb) => cb(null, /^image\/(jpeg|png|webp)$/.test(f.mimetype)),
});
const strict = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20 });

// ---- public ----
r.post("/repairs", strict, async (req, res) => {
  const b = req.body || {};
  if (!esc(b.name) || !/^\d{10}$/.test(b.phone || "") || !esc(b.issue)) throw fail(400, "Enter name, a 10-digit phone number and the issue.");
  const address = addr(b);
  const imei = esc(b.imei).replace(/[\s-]/g, "");
  if (imei && !/^\d{15}$/.test(imei)) throw fail(400, "IMEI must be 15 digits (dial *#06# on the phone to see it).");
  if (!esc(b.brand) || !esc(b.model)) throw fail(400, "Enter the phone brand and model number.");
  const whatsapp = esc(b.whatsapp).replace(/[\s-]/g, ""), email = esc(b.email).toLowerCase();
  if (whatsapp && !/^\d{10}$/.test(whatsapp)) throw fail(400, "WhatsApp number must be 10 digits.");
  if (email && !mail.test(email)) throw fail(400, "Enter a valid email address.");
  const ticket = "SDM-" + crypto.randomBytes(3).toString("hex").slice(0, 5).toUpperCase();
  await Repair.create({ ticket, userId: getUid(req), name: esc(b.name), phone: b.phone, whatsapp, email, brand: esc(b.brand), company: esc(b.company), model: esc(b.model), imei, issue: esc(b.issue), notes: esc(b.notes), address });
  res.json({ ticket });
});
r.get("/repairs", strict, async (req, res) => {
  const x: any = await Repair.findOne({ ticket: esc(req.query.ticket).toUpperCase(), phone: esc(req.query.phone) }).lean();
  if (!x) throw fail(404, "No repair found. Check the ticket and phone number.");
  res.json({ ticket: x.ticket, brand: x.brand, model: x.model, issue: x.issue, status: x.status, estimate: x.estimate });
});
r.get("/products", async (_q, res) => res.json(await Product.find({ inStock: true }).sort({ createdAt: -1 }).lean()));

// ---- customer accounts ----
r.post("/auth/signup", strict, async (req, res) => {
  const b = req.body || {}, email = esc(b.email).toLowerCase();
  if (!esc(b.name) || !mail.test(email) || !/^\d{10}$/.test(b.phone || "") || String(b.password || "").length < 8) throw fail(400, "Enter your name, a valid email, a 10-digit phone number and a password of 8 or more characters.");
  const address = addr(b);
  if (await User.findOne({ email })) throw fail(409, "This email is already registered. Please log in.");
  const u: any = await User.create({ name: esc(b.name), email, phone: b.phone, password: hash(String(b.password)), address });
  res.json({ token: tok(String(u._id)), user: { name: u.name, email: u.email, phone: u.phone, address: u.address, profileImage: u.profileImage || "" } });
});
r.post("/auth/login", strict, async (req, res) => {
  const u: any = await User.findOne({ email: esc(req.body?.email).toLowerCase() });
  if (!u || !check(String(req.body?.password || ""), u.password)) throw fail(401, "Wrong email or password.");
  res.json({ token: tok(String(u._id)), user: { name: u.name, email: u.email, phone: u.phone, address: u.address, profileImage: u.profileImage || "" } });
});
r.get("/auth/me", user, async (req: any, res) => {
  const u: any = await User.findById(req.uid).lean();
  if (!u) throw fail(401, "Please log in.");
  res.json({ name: u.name, email: u.email, phone: u.phone, address: u.address, profileImage: u.profileImage || "" });
});
// Upload / replace the logged-in user's profile picture
r.post("/auth/profile-image", user, uploadProfile.single("image"), async (req: any, res) => {
  if (!req.file) throw fail(400, "No image uploaded.");
  const url = (req.file as any).path;
  await User.findByIdAndUpdate(req.uid, { profileImage: url });
  res.json({ profileImage: url });
});
// Update saved address (for old users who signed up before address was added)
r.patch("/auth/address", user, async (req: any, res) => {
  const address = addr(req.body);
  const u: any = await User.findByIdAndUpdate(req.uid, { address }, { new: true }).lean();
  if (!u) throw fail(401, "Please log in.");
  res.json({ address: u.address });
});
r.get("/my/repairs", user, async (req: any, res) => res.json(await Repair.find({ userId: req.uid }).sort({ createdAt: -1 }).select("-adminNote -userId").lean()));

// ---- contact form ----
r.post("/contact", strict, async (req, res) => {
  const b = req.body || {};
  if (!esc(b.name) || !esc(b.message) || (!mail.test(esc(b.email)) && !/^\d{10}$/.test(esc(b.phone)))) throw fail(400, "Enter your name, a message, and an email or 10-digit phone number.");
  await Message.create({ name: esc(b.name), email: esc(b.email), phone: esc(b.phone), message: String(b.message).trim().slice(0, 1500) });
  res.json({ ok: true });
});

// ---- admin ----
r.post("/admin/login", strict, (req, res) => {
  if (!same(String(req.body?.password || ""), process.env.ADMIN_PASSWORD || "\0")) throw fail(401, "Wrong password.");
  res.json({ token: jwt.sign({ a: 1 }, process.env.JWT_SECRET!, { expiresIn: "7d" }) });
});
r.get("/admin/dashboard", admin, async (_q, res) => {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const [by, today, products] = await Promise.all([
    Repair.aggregate([{ $group: { _id: "$status", n: { $sum: 1 } } }]),
    Repair.countDocuments({ createdAt: { $gte: start } }), Product.countDocuments(),
  ]);
  res.json({ today, products, byStatus: Object.fromEntries(STATUSES.map(s => [s, by.find(b => b._id === s)?.n || 0])) });
});
r.get("/admin/repairs", admin, async (req, res) => {
  const q = esc(req.query.q), status = esc(req.query.status), f: any = {};
  if (status) f.status = status;
  if (q) { const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"); f.$or = [{ ticket: rx }, { name: rx }, { phone: rx }, { whatsapp: rx }, { email: rx }, { model: rx }, { imei: rx }, { "address.pincode": rx }]; }
  res.json(await Repair.find(f).sort({ createdAt: -1 }).limit(200).lean());
});
r.patch("/admin/repairs/:id", admin, async (req, res) => {
  const { status, estimate, adminNote } = req.body || {}, u: any = {};
  if (status !== undefined) { if (!STATUSES.includes(status)) throw fail(400, "Invalid status."); u.status = status; }
  if (estimate !== undefined) u.estimate = Number(estimate) || 0;
  if (adminNote !== undefined) u.adminNote = esc(adminNote);
  res.json(await Repair.findByIdAndUpdate(req.params.id, u, { new: true }));
});
r.delete("/admin/repairs/:id", admin, async (req, res) => { await Repair.findByIdAndDelete(req.params.id); res.json({ ok: true }); });
r.get("/admin/products", admin, async (_q, res) => res.json(await Product.find().sort({ createdAt: -1 }).lean()));
r.post("/admin/products", admin, upload.single("image"), async (req, res) => {
  const b = req.body || {};
  if (!esc(b.name) || !(Number(b.price) >= 0) || b.price === "") throw fail(400, "Name and price are required.");
  res.json(await Product.create({
    name: esc(b.name),
    price: Number(b.price),
    category: esc(b.category),
    image: (req.file as any)?.path || "",   // Cloudinary's hosted URL, e.g. https://res.cloudinary.com/...
  }));
});
r.patch("/admin/products/:id", admin, async (req, res) => res.json(await Product.findByIdAndUpdate(req.params.id, { inStock: !!req.body?.inStock }, { new: true })));
r.delete("/admin/products/:id", admin, async (req, res) => { await Product.findByIdAndDelete(req.params.id); res.json({ ok: true }); });

r.get("/admin/messages", admin, async (_q, res) => res.json(await Message.find().sort({ createdAt: -1 }).limit(200).lean()));
r.delete("/admin/messages/:id", admin, async (req, res) => { await Message.findByIdAndDelete(req.params.id); res.json({ ok: true }); });

export default r;