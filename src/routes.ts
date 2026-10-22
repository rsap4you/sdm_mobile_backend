import { Router, Request, Response, NextFunction } from "express";
import rateLimit from "express-rate-limit";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import multer from "multer";

import { Repair, Product, User, Message, STATUSES } from "./models";
import cloudinary, {
  productImageStorage,
  profileImageStorage,
  repairImageStorage,
} from "./Cloudinary";

const r = Router();

// ================= HELPERS =================

const fail = (status: number, message: string) =>
  Object.assign(new Error(message), { status });

const esc = (value: unknown) => String(value ?? "").trim().slice(0, 300);

const same = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

// ================= AHMEDABAD PINCODE =================
// ================= AHMEDABAD PINCODE =================

// Ahmedabad city: 380001 to 380063 (this range is all city)
// Outer areas (Naroda, Odhav, Vatva, Nikol, Vastral, Chandkheda...) use 382xxx codes.
// Careful: 382xxx also covers Gandhinagar, Sanand, Dholka, etc., so list these one by one.
const AMD_EXTRA = new Set<string>([
  "382210", // Sarkhej
  "382330", // Naroda, Medra, Limbadia
  "382340", // Kubernagar, Noblenagar
  "382345", // Krishnanagar, Naroda Road
  "382346",
  "382350", // Khodiyarnagar, Nikol, T B Nagar
  "382352",
  "382405", // Gyaspur, Shahwadi, Lambha
  "382410",
  "382415", // Odhav
  "382418", // Vastral
  "382424", // Chandkheda
  "382430", // Kathwada
  "382435", // Nandej
  "382440", // Vatva
  "382443", // Ramol
  "382445", // Vatva / Hathijan area
  "382470", // Kali
  "382481", // Nirnaynagar
]);

const validPin = (p: string) =>
  /^\d{6}$/.test(p) &&
  ((+p >= 380001 && +p <= 380063) || AMD_EXTRA.has(p));


// ================= ADDRESS =================
// JSON body: body.address = {...}
// multipart body: nested ya flat "address[line1]" dono handle

const addr = (body: any) => {
  const a =
    body?.address && typeof body.address === "object"
      ? body.address
      : {
          line1: body?.["address[line1]"],
          line2: body?.["address[line2]"],
          landmark: body?.["address[landmark]"],
          pincode: body?.["address[pincode]"],
        };

  const x = {
    line1: esc(a.line1),
    line2: esc(a.line2),
    landmark: esc(a.landmark),
    city: "Ahmedabad",
    pincode: esc(a.pincode),
  };

  if (x.line1.length < 5) throw fail(400, "Please enter your full address.");
  if (!validPin(x.pincode)) throw fail(400, "Sorry, we currently serve Ahmedabad pincodes only.");

  return x;
};

// ================= GPS LOCATION (optional) =================
// Handles nested object (body.location) and flat "location[lat]" keys.
// Returns undefined if missing, invalid, or clearly outside the Ahmedabad area,
// because the typed address is the main pickup location anyway.

const AMD_BOX = { minLat: 22.8, maxLat: 23.3, minLng: 72.3, maxLng: 72.9 };

const loc = (body: any) => {
  const l =
    body?.location && typeof body.location === "object"
      ? body.location
      : {
          lat: body?.["location[lat]"],
          lng: body?.["location[lng]"],
          accuracy: body?.["location[accuracy]"],
        };

  if (l.lat === undefined || l.lat === "" || l.lng === undefined || l.lng === "") return undefined;

  const lat = Number(l.lat);
  const lng = Number(l.lng);
  const acc = Number(l.accuracy);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return undefined;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return undefined;
  if (
    lat < AMD_BOX.minLat ||
    lat > AMD_BOX.maxLat ||
    lng < AMD_BOX.minLng ||
    lng > AMD_BOX.maxLng
  ) {
    return undefined;
  }

  return {
    lat,
    lng,
    accuracy: Number.isFinite(acc) && acc >= 0 ? Math.round(acc) : undefined,
  };
};

// ================= PASSWORD =================

const hash = (password: string) => {
  const salt = crypto.randomBytes(16).toString("hex");
  const key = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${key}`;
};

const check = (password: string, storedHash: string) => {
  const [salt, key] = (storedHash || ":").split(":");
  if (!salt || !key) return false;
  const calculated = crypto.scryptSync(password, salt, 64).toString("hex");
  return same(calculated, key);
};

// ================= JWT =================

const tok = (id: string) =>
  jwt.sign({ u: id }, process.env.JWT_SECRET!, { expiresIn: "30d" });

const getUid = (req: Request): string | undefined => {
  try {
    const header = req.headers.authorization || "";
    const token = header.replace(/^Bearer\s+/i, "");
    if (!token) return undefined;
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as any;
    return payload.u;
  } catch {
    return undefined;
  }
};

const user = (req: any, _res: Response, next: NextFunction) => {
  const id = getUid(req);
  if (!id) return next(fail(401, "Please log in."));
  req.uid = id;
  next();
};

const admin = (req: Request, _res: Response, next: NextFunction) => {
  try {
    const header = req.headers.authorization || "";
    const token = header.replace(/^Bearer\s+/i, "");
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as any;
    if (!payload.a) throw new Error();
    next();
  } catch {
    next(fail(401, "Login required."));
  }
};

const mail = /^\S+@\S+\.\S+$/;

// ================= UPLOADS =================

const imageFilter = (_req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  cb(null, /^image\/(jpeg|png|webp)$/.test(file.mimetype));
};

const upload = multer({
  storage: productImageStorage,
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: imageFilter,
});

const uploadProfile = multer({
  storage: profileImageStorage,
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: imageFilter,
});

// Repair photos: max 5 images, 5 MB each
const uploadRepair = multer({
  storage: repairImageStorage,
  limits: { fileSize: 5 * 1024 * 1024, files: 5 },
  fileFilter: (_req, file, cb) => {
    if (/^image\/(jpeg|png|webp)$/.test(file.mimetype)) return cb(null, true);
    cb(new Error("BAD_TYPE"));
  },
});

const repairImages = (req: any, res: Response, next: NextFunction) => {
  uploadRepair.array("images", 5)(req, res, (err: any) => {
    if (!err) return next();
    const msg =
      err.code === "LIMIT_FILE_SIZE"
        ? "Each image must be under 5 MB."
        : err.code === "LIMIT_UNEXPECTED_FILE" || err.code === "LIMIT_FILE_COUNT"
        ? "Maximum 5 images allowed."
        : err.message === "BAD_TYPE"
        ? "Only JPG, PNG or WebP images are allowed."
        : "Image upload failed.";
    next(fail(400, msg));
  });
};

// ================= RATE LIMIT =================

const strict = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20 });

// ================= PUBLIC: CREATE REPAIR =================

r.post("/repairs", strict, repairImages, async (req: any, res) => {
  const files = (req.files || []) as any[];
  const urls = files.map((f) => f.path);

  try {
    const b = req.body || {};

    if (!esc(b.name) || !/^\d{10}$/.test(b.phone || "") || !esc(b.issue)) {
      throw fail(400, "Enter name, a 10-digit phone number and the issue.");
    }

    // pickup (we collect) or walkin (customer brings it). Default = pickup.
    const pickup = esc(b.pickup) === "walkin" ? "walkin" : "pickup";

    // Address is required (and validated) only for pickup
    const address = pickup === "pickup" ? addr(b) : undefined;
    const location = pickup === "pickup" ? loc(b) : undefined;

    const imei = esc(b.imei).replace(/[\s-]/g, "");
    if (imei && !/^\d{15}$/.test(imei)) throw fail(400, "IMEI must be 15 digits.");

    if (!esc(b.brand) || !esc(b.model)) {
      throw fail(400, "Enter the phone brand and model number.");
    }

    const whatsapp = esc(b.whatsapp).replace(/[\s-]/g, "");
    const email = esc(b.email).toLowerCase();

    if (whatsapp && !/^\d{10}$/.test(whatsapp)) {
      throw fail(400, "WhatsApp number must be 10 digits.");
    }
    if (email && !mail.test(email)) throw fail(400, "Enter a valid email address.");

    const ticket =
      "SDM-" + crypto.randomBytes(3).toString("hex").slice(0, 5).toUpperCase();

    await Repair.create({
      ticket,
      userId: getUid(req),
      name: esc(b.name),
      phone: b.phone,
      whatsapp,
      email,
      brand: esc(b.brand),
      company: esc(b.company),
      model: esc(b.model),
      imei,
      issue: esc(b.issue),
      notes: esc(b.notes),
      images: urls,
      pickup,
      address,
      location,
    });

    res.json({ ticket });
  } catch (e) {
    // Validation fail hui to Cloudinary se uploaded images hata do
    await Promise.all(
      files.map((f) => cloudinary.uploader.destroy(f.filename).catch(() => {}))
    );
    throw e;
  }
});

// ================= TRACK REPAIR =================

r.get("/repairs", strict, async (req, res) => {
  const x: any = await Repair.findOne({
    ticket: esc(req.query.ticket).toUpperCase(),
    phone: esc(req.query.phone),
  }).lean();

  if (!x) throw fail(404, "No repair found. Check the ticket and phone number.");

  res.json({
    ticket: x.ticket,
    brand: x.brand,
    model: x.model,
    issue: x.issue,
    status: x.status,
    estimate: x.estimate,
  });
});

// ================= PRODUCTS =================

r.get("/products", async (_req, res) => {
  const products = await Product.find({ inStock: true }).sort({ createdAt: -1 }).lean();
  res.json(products);
});

// ================= AUTH =================

const userOut = (u: any) => ({
  id: String(u._id),
  name: u.name,
  email: u.email,
  phone: u.phone,
  address: u.address,
  profileImage: u.profileImage || "",
});

r.post("/auth/signup", strict, async (req, res) => {
  const b = req.body || {};
  const email = esc(b.email).toLowerCase();

  if (
    !esc(b.name) ||
    !mail.test(email) ||
    !/^\d{10}$/.test(b.phone || "") ||
    String(b.password || "").length < 8
  ) {
    throw fail(
      400,
      "Enter your name, valid email, 10-digit phone and password of 8 or more characters."
    );
  }

  const address = addr(b);

  if (await User.findOne({ email })) {
    throw fail(409, "This email is already registered. Please log in.");
  }

  const u: any = await User.create({
    name: esc(b.name),
    email,
    phone: b.phone,
    password: hash(String(b.password)),
    address,
    profileImage: "",
  });

  res.json({ token: tok(String(u._id)), user: userOut(u) });
});

r.post("/auth/login", strict, async (req, res) => {
  const u: any = await User.findOne({ email: esc(req.body?.email).toLowerCase() });

  if (!u || !check(String(req.body?.password || ""), u.password)) {
    throw fail(401, "Wrong email or password.");
  }

  res.json({ token: tok(String(u._id)), user: userOut(u) });
});

r.get("/auth/me", user, async (req: any, res) => {
  const u: any = await User.findById(req.uid).lean();
  if (!u) throw fail(401, "Please log in.");
  res.json(userOut(u));
});

r.post("/auth/profile-image", user, uploadProfile.single("image"), async (req: any, res) => {
  if (!req.file) throw fail(400, "No image uploaded.");

  const updatedUser: any = await User.findByIdAndUpdate(
    req.uid,
    { profileImage: req.file.path },
    { new: true }
  ).lean();

  if (!updatedUser) throw fail(404, "User not found.");

  res.json({
    success: true,
    message: "Profile image uploaded successfully.",
    profileImage: updatedUser.profileImage,
  });
});

r.patch("/auth/address", user, async (req: any, res) => {
  const address = addr(req.body);
  const u: any = await User.findByIdAndUpdate(req.uid, { address }, { new: true }).lean();
  if (!u) throw fail(401, "Please log in.");
  res.json({ address: u.address });
});

r.get("/my/repairs", user, async (req: any, res) => {
  const repairs = await Repair.find({ userId: req.uid })
    .sort({ createdAt: -1 })
    .select("-adminNote -userId")
    .lean();
  res.json(repairs);
});

// ================= CONTACT =================

r.post("/contact", strict, async (req, res) => {
  const b = req.body || {};
  const email = esc(b.email);
  const phone = esc(b.phone);

  if (!esc(b.name) || !esc(b.message) || (!mail.test(email) && !/^\d{10}$/.test(phone))) {
    throw fail(400, "Enter your name, message and email or phone.");
  }

  await Message.create({
    name: esc(b.name),
    email,
    phone,
    message: String(b.message).trim().slice(0, 1500),
  });

  res.json({ ok: true });
});

// ================= ADMIN =================

r.post("/admin/login", strict, (req, res) => {
  if (!same(String(req.body?.password || ""), process.env.ADMIN_PASSWORD || "\0")) {
    throw fail(401, "Wrong password.");
  }
  res.json({
    token: jwt.sign({ a: 1 }, process.env.JWT_SECRET!, { expiresIn: "7d" }),
  });
});

r.get("/admin/dashboard", admin, async (_req, res) => {
  const start = new Date();
  start.setHours(0, 0, 0, 0);

  const [by, today, products] = await Promise.all([
    Repair.aggregate([{ $group: { _id: "$status", n: { $sum: 1 } } }]),
    Repair.countDocuments({ createdAt: { $gte: start } }),
    Product.countDocuments(),
  ]);

  res.json({
    today,
    products,
    byStatus: Object.fromEntries(
      STATUSES.map((s) => [s, by.find((b: any) => b._id === s)?.n || 0])
    ),
  });
});

r.get("/admin/repairs", admin, async (req, res) => {
  const q = esc(req.query.q);
  const status = esc(req.query.status);
  const filter: any = {};

  if (status) filter.status = status;

  if (q) {
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$or = [
      { ticket: rx },
      { name: rx },
      { phone: rx },
      { whatsapp: rx },
      { email: rx },
      { model: rx },
      { imei: rx },
      { "address.pincode": rx },
    ];
  }

  const repairs = await Repair.find(filter).sort({ createdAt: -1 }).limit(200).lean();

  // Add a ready-to-open Google Maps link for pickup repairs that have GPS
  res.json(
    repairs.map((x: any) => ({
      ...x,
      mapUrl: x.location?.lat
        ? `https://www.google.com/maps?q=${x.location.lat},${x.location.lng}`
        : "",
    }))
  );
});

r.patch("/admin/repairs/:id", admin, async (req, res) => {
  const { status, estimate, adminNote } = req.body || {};
  const update: any = {};

  if (status !== undefined) {
    if (!STATUSES.includes(status)) throw fail(400, "Invalid status.");
    update.status = status;
  }
  if (estimate !== undefined) update.estimate = Number(estimate) || 0;
  if (adminNote !== undefined) update.adminNote = esc(adminNote);

  const repair = await Repair.findByIdAndUpdate(req.params.id, update, { new: true });
  res.json(repair);
});

r.delete("/admin/repairs/:id", admin, async (req, res) => {
  await Repair.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});

r.get("/admin/products", admin, async (_req, res) => {
  const products = await Product.find().sort({ createdAt: -1 }).lean();
  res.json(products);
});

r.post("/admin/products", admin, upload.single("image"), async (req, res) => {
  const b = req.body || {};

  if (!esc(b.name) || b.price === "" || !(Number(b.price) >= 0)) {
    throw fail(400, "Name and price are required.");
  }

  const product = await Product.create({
    name: esc(b.name),
    price: Number(b.price),
    category: esc(b.category),
    image: (req.file as any)?.path || "",
  });

  res.json(product);
});

r.patch("/admin/products/:id", admin, async (req, res) => {
  const product = await Product.findByIdAndUpdate(
    req.params.id,
    { inStock: !!req.body?.inStock },
    { new: true }
  );
  res.json(product);
});

r.delete("/admin/products/:id", admin, async (req, res) => {
  await Product.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});

r.get("/admin/messages", admin, async (_req, res) => {
  const messages = await Message.find().sort({ createdAt: -1 }).limit(200).lean();
  res.json(messages);
});

r.delete("/admin/messages/:id", admin, async (req, res) => {
  await Message.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});

export default r;