import {
  Router,
  Request,
  Response,
  NextFunction,
} from "express";

import rateLimit from "express-rate-limit";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import multer from "multer";

import {
  Repair,
  Product,
  User,
  Message,
  STATUSES,
} from "./models";

import {
  productImageStorage,
  profileImageStorage,
} from "./Cloudinary";

const r = Router();

// ======================================================
// ERROR HELPER
// ======================================================

const fail = (
  status: number,
  message: string
) => {
  return Object.assign(
    new Error(message),
    { status }
  );
};

// ======================================================
// SAFE STRING
// ======================================================

const esc = (value: unknown) =>
  String(value ?? "")
    .trim()
    .slice(0, 300);

// ======================================================
// TIMING SAFE STRING COMPARE
// ======================================================

const same = (
  a: string,
  b: string
) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);

  return (
    x.length === y.length &&
    crypto.timingSafeEqual(x, y)
  );
};

// ======================================================
// AHMEDABAD PINCODE
// ======================================================

const AMD_EXTRA = new Set<string>([
  "382330",
  "382350",
  "382424",
  "382445",
  "382481",
]);

const validPin = (p: string) => {
  return (
    /^\d{6}$/.test(p) &&
    (
      (+p >= 380001 && +p <= 380063) ||
      AMD_EXTRA.has(p)
    )
  );
};

// ======================================================
// ADDRESS
// ======================================================

const addr = (body: any) => {
  const a = body?.address || {};

  const x = {
    line1: esc(a.line1),
    line2: esc(a.line2),
    landmark: esc(a.landmark),
    city: "Ahmedabad",
    pincode: esc(a.pincode),
  };

  if (x.line1.length < 5) {
    throw fail(
      400,
      "Please enter your full address."
    );
  }

  if (!validPin(x.pincode)) {
    throw fail(
      400,
      "Sorry, we currently serve Ahmedabad pincodes only."
    );
  }

  return x;
};

// ======================================================
// PASSWORD HASH
// ======================================================

const hash = (password: string) => {
  const salt = crypto
    .randomBytes(16)
    .toString("hex");

  const key = crypto
    .scryptSync(password, salt, 64)
    .toString("hex");

  return `${salt}:${key}`;
};

// ======================================================
// PASSWORD CHECK
// ======================================================

const check = (
  password: string,
  storedHash: string
) => {
  const [salt, key] =
    (storedHash || ":").split(":");

  if (!salt || !key) {
    return false;
  }

  const calculated = crypto
    .scryptSync(password, salt, 64)
    .toString("hex");

  return same(calculated, key);
};

// ======================================================
// JWT
// ======================================================

const tok = (id: string) => {
  return jwt.sign(
    {
      u: id,
    },
    process.env.JWT_SECRET!,
    {
      expiresIn: "30d",
    }
  );
};

// ======================================================
// GET USER ID FROM JWT
// ======================================================

const getUid = (
  req: Request
): string | undefined => {
  try {
    const header =
      req.headers.authorization || "";

    const token =
      header.replace(/^Bearer\s+/i, "");

    if (!token) {
      return undefined;
    }

    const payload =
      jwt.verify(
        token,
        process.env.JWT_SECRET!
      ) as any;

    return payload.u;
  } catch {
    return undefined;
  }
};

// ======================================================
// USER AUTH MIDDLEWARE
// ======================================================

const user = (
  req: any,
  _res: Response,
  next: NextFunction
) => {
  const id = getUid(req);

  if (!id) {
    return next(
      fail(
        401,
        "Please log in."
      )
    );
  }

  req.uid = id;

  next();
};

// ======================================================
// ADMIN AUTH
// ======================================================

const admin = (
  req: Request,
  _res: Response,
  next: NextFunction
) => {
  try {
    const header =
      req.headers.authorization || "";

    const token =
      header.replace(/^Bearer\s+/i, "");

    const payload =
      jwt.verify(
        token,
        process.env.JWT_SECRET!
      ) as any;

    if (!payload.a) {
      throw new Error();
    }

    next();
  } catch {
    next(
      fail(
        401,
        "Login required."
      )
    );
  }
};

// ======================================================
// EMAIL
// ======================================================

const mail =
  /^\S+@\S+\.\S+$/;

// ======================================================
// PRODUCT UPLOAD
// ======================================================

const upload = multer({
  storage: productImageStorage,

  limits: {
    fileSize: 3 * 1024 * 1024,
  },

  fileFilter: (
    _req,
    file,
    cb
  ) => {
    const valid =
      /^image\/(jpeg|png|webp)$/
        .test(file.mimetype);

    cb(null, valid);
  },
});

// ======================================================
// PROFILE IMAGE UPLOAD
// ======================================================

const uploadProfile = multer({
  storage: profileImageStorage,

  limits: {
    fileSize: 3 * 1024 * 1024,
  },

  fileFilter: (
    _req,
    file,
    cb
  ) => {
    const valid =
      /^image\/(jpeg|png|webp)$/
        .test(file.mimetype);

    cb(null, valid);
  },
});

// ======================================================
// RATE LIMIT
// ======================================================

const strict = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
});

// ======================================================
// PUBLIC - CREATE REPAIR
// ======================================================

r.post(
  "/repairs",
  strict,
  async (req, res) => {
    const b = req.body || {};

    if (
      !esc(b.name) ||
      !/^\d{10}$/.test(
        b.phone || ""
      ) ||
      !esc(b.issue)
    ) {
      throw fail(
        400,
        "Enter name, a 10-digit phone number and the issue."
      );
    }

    const address = addr(b);

    const imei = esc(b.imei)
      .replace(/[\s-]/g, "");

    if (
      imei &&
      !/^\d{15}$/.test(imei)
    ) {
      throw fail(
        400,
        "IMEI must be 15 digits."
      );
    }

    if (
      !esc(b.brand) ||
      !esc(b.model)
    ) {
      throw fail(
        400,
        "Enter the phone brand and model number."
      );
    }

    const whatsapp = esc(
      b.whatsapp
    ).replace(/[\s-]/g, "");

    const email = esc(
      b.email
    ).toLowerCase();

    if (
      whatsapp &&
      !/^\d{10}$/.test(
        whatsapp
      )
    ) {
      throw fail(
        400,
        "WhatsApp number must be 10 digits."
      );
    }

    if (
      email &&
      !mail.test(email)
    ) {
      throw fail(
        400,
        "Enter a valid email address."
      );
    }

    const ticket =
      "SDM-" +
      crypto
        .randomBytes(3)
        .toString("hex")
        .slice(0, 5)
        .toUpperCase();

    const userId =
      getUid(req);

    await Repair.create({
      ticket,
      userId,

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

      address,
    });

    res.json({
      ticket,
    });
  }
);

// ======================================================
// TRACK REPAIR
// ======================================================

r.get(
  "/repairs",
  strict,
  async (req, res) => {
    const x: any =
      await Repair.findOne({
        ticket: esc(
          req.query.ticket
        ).toUpperCase(),

        phone: esc(
          req.query.phone
        ),
      }).lean();

    if (!x) {
      throw fail(
        404,
        "No repair found. Check the ticket and phone number."
      );
    }

    res.json({
      ticket: x.ticket,
      brand: x.brand,
      model: x.model,
      issue: x.issue,
      status: x.status,
      estimate: x.estimate,
    });
  }
);

// ======================================================
// PRODUCTS
// ======================================================

r.get(
  "/products",
  async (_req, res) => {
    const products =
      await Product.find({
        inStock: true,
      })
        .sort({
          createdAt: -1,
        })
        .lean();

    res.json(products);
  }
);

// ======================================================
// SIGNUP
// ======================================================

r.post(
  "/auth/signup",
  strict,
  async (req, res) => {
    const b = req.body || {};

    const email =
      esc(b.email).toLowerCase();

    if (
      !esc(b.name) ||
      !mail.test(email) ||
      !/^\d{10}$/.test(
        b.phone || ""
      ) ||
      String(
        b.password || ""
      ).length < 8
    ) {
      throw fail(
        400,
        "Enter your name, valid email, 10-digit phone and password of 8 or more characters."
      );
    }

    const address = addr(b);

    const existing =
      await User.findOne({
        email,
      });

    if (existing) {
      throw fail(
        409,
        "This email is already registered. Please log in."
      );
    }

    const u: any =
      await User.create({
        name: esc(b.name),

        email,

        phone: b.phone,

        password: hash(
          String(b.password)
        ),

        address,

        profileImage: "",
      });

    res.json({
      token: tok(
        String(u._id)
      ),

      user: {
        id: String(u._id),

        name: u.name,

        email: u.email,

        phone: u.phone,

        address: u.address,

        profileImage:
          u.profileImage || "",
      },
    });
  }
);

// ======================================================
// LOGIN
// ======================================================

r.post(
  "/auth/login",
  strict,
  async (req, res) => {
    const u: any =
      await User.findOne({
        email: esc(
          req.body?.email
        ).toLowerCase(),
      });

    if (
      !u ||
      !check(
        String(
          req.body?.password || ""
        ),
        u.password
      )
    ) {
      throw fail(
        401,
        "Wrong email or password."
      );
    }

    res.json({
      token: tok(
        String(u._id)
      ),

      user: {
        id: String(u._id),

        name: u.name,

        email: u.email,

        phone: u.phone,

        address: u.address,

        profileImage:
          u.profileImage || "",
      },
    });
  }
);

// ======================================================
// CURRENT USER
// ======================================================

r.get(
  "/auth/me",
  user,
  async (req: any, res) => {
    const u: any =
      await User.findById(
        req.uid
      ).lean();

    if (!u) {
      throw fail(
        401,
        "Please log in."
      );
    }

    res.json({
      id: String(u._id),

      name: u.name,

      email: u.email,

      phone: u.phone,

      address: u.address,

      profileImage:
        u.profileImage || "",
    });
  }
);

// ======================================================
// PROFILE IMAGE
// ======================================================

r.post(
  "/auth/profile-image",
  user,
  uploadProfile.single("image"),
  async (req: any, res) => {
    if (!req.file) {
      throw fail(
        400,
        "No image uploaded."
      );
    }

    const url =
      req.file.path;

    const updatedUser: any =
      await User.findByIdAndUpdate(
        req.uid,

        {
          profileImage: url,
        },

        {
          new: true,
        }
      ).lean();

    if (!updatedUser) {
      throw fail(
        404,
        "User not found."
      );
    }

    res.json({
      success: true,

      message:
        "Profile image uploaded successfully.",

      profileImage:
        updatedUser.profileImage,
    });
  }
);

// ======================================================
// UPDATE ADDRESS
// ======================================================

r.patch(
  "/auth/address",
  user,
  async (req: any, res) => {
    const address =
      addr(req.body);

    const u: any =
      await User.findByIdAndUpdate(
        req.uid,

        {
          address,
        },

        {
          new: true,
        }
      ).lean();

    if (!u) {
      throw fail(
        401,
        "Please log in."
      );
    }

    res.json({
      address: u.address,
    });
  }
);

// ======================================================
// MY REPAIRS
// ======================================================

r.get(
  "/my/repairs",
  user,
  async (req: any, res) => {
    const repairs =
      await Repair.find({
        userId: req.uid,
      })
        .sort({
          createdAt: -1,
        })
        .select(
          "-adminNote -userId"
        )
        .lean();

    res.json(repairs);
  }
);

// ======================================================
// CONTACT
// ======================================================

r.post(
  "/contact",
  strict,
  async (req, res) => {
    const b =
      req.body || {};

    const email =
      esc(b.email);

    const phone =
      esc(b.phone);

    if (
      !esc(b.name) ||
      !esc(b.message) ||
      (
        !mail.test(email) &&
        !/^\d{10}$/.test(phone)
      )
    ) {
      throw fail(
        400,
        "Enter your name, message and email or phone."
      );
    }

    await Message.create({
      name: esc(b.name),

      email,

      phone,

      message: String(
        b.message
      )
        .trim()
        .slice(0, 1500),
    });

    res.json({
      ok: true,
    });
  }
);

// ======================================================
// ADMIN LOGIN
// ======================================================

r.post(
  "/admin/login",
  strict,
  (req, res) => {
    if (
      !same(
        String(
          req.body?.password ||
            ""
        ),
        process.env
          .ADMIN_PASSWORD ||
          "\0"
      )
    ) {
      throw fail(
        401,
        "Wrong password."
      );
    }

    res.json({
      token: jwt.sign(
        {
          a: 1,
        },
        process.env
          .JWT_SECRET!,
        {
          expiresIn: "7d",
        }
      ),
    });
  }
);

// ======================================================
// ADMIN DASHBOARD
// ======================================================

r.get(
  "/admin/dashboard",
  admin,
  async (_req, res) => {
    const start =
      new Date();

    start.setHours(
      0,
      0,
      0,
      0
    );

    const [
      by,
      today,
      products,
    ] = await Promise.all([
      Repair.aggregate([
        {
          $group: {
            _id: "$status",
            n: {
              $sum: 1,
            },
          },
        },
      ]),

      Repair.countDocuments({
        createdAt: {
          $gte: start,
        },
      }),

      Product.countDocuments(),
    ]);

    res.json({
      today,

      products,

      byStatus:
        Object.fromEntries(
          STATUSES.map(
            (s) => [
              s,
              by.find(
                (b) =>
                  b._id === s
              )?.n || 0,
            ]
          )
        ),
    });
  }
);

// ======================================================
// ADMIN REPAIRS
// ======================================================

r.get(
  "/admin/repairs",
  admin,
  async (req, res) => {
    const q =
      esc(req.query.q);

    const status =
      esc(req.query.status);

    const filter: any = {};

    if (status) {
      filter.status =
        status;
    }

    if (q) {
      const escaped =
        q.replace(
          /[.*+?^${}()|[\]\\]/g,
          "\\$&"
        );

      const rx =
        new RegExp(
          escaped,
          "i"
        );

      filter.$or = [
        {
          ticket: rx,
        },
        {
          name: rx,
        },
        {
          phone: rx,
        },
        {
          whatsapp: rx,
        },
        {
          email: rx,
        },
        {
          model: rx,
        },
        {
          imei: rx,
        },
        {
          "address.pincode":
            rx,
        },
      ];
    }

    const repairs =
      await Repair.find(
        filter
      )
        .sort({
          createdAt: -1,
        })
        .limit(200)
        .lean();

    res.json(repairs);
  }
);

// ======================================================
// ADMIN UPDATE REPAIR
// ======================================================

r.patch(
  "/admin/repairs/:id",
  admin,
  async (req, res) => {
    const {
      status,
      estimate,
      adminNote,
    } = req.body || {};

    const update: any =
      {};

    if (
      status !== undefined
    ) {
      if (
        !STATUSES.includes(
          status
        )
      ) {
        throw fail(
          400,
          "Invalid status."
        );
      }

      update.status =
        status;
    }

    if (
      estimate !== undefined
    ) {
      update.estimate =
        Number(
          estimate
        ) || 0;
    }

    if (
      adminNote !== undefined
    ) {
      update.adminNote =
        esc(adminNote);
    }

    const repair =
      await Repair.findByIdAndUpdate(
        req.params.id,
        update,
        {
          new: true,
        }
      );

    res.json(repair);
  }
);

// ======================================================
// ADMIN DELETE REPAIR
// ======================================================

r.delete(
  "/admin/repairs/:id",
  admin,
  async (req, res) => {
    await Repair.findByIdAndDelete(
      req.params.id
    );

    res.json({
      ok: true,
    });
  }
);

// ======================================================
// ADMIN PRODUCTS
// ======================================================

r.get(
  "/admin/products",
  admin,
  async (_req, res) => {
    const products =
      await Product.find()
        .sort({
          createdAt: -1,
        })
        .lean();

    res.json(products);
  }
);

// ======================================================
// ADMIN CREATE PRODUCT
// ======================================================

r.post(
  "/admin/products",
  admin,
  upload.single("image"),
  async (req, res) => {
    const b =
      req.body || {};

    if (
      !esc(b.name) ||
      b.price === "" ||
      !(Number(b.price) >= 0)
    ) {
      throw fail(
        400,
        "Name and price are required."
      );
    }

    const product =
      await Product.create({
        name: esc(b.name),

        price: Number(
          b.price
        ),

        category:
          esc(b.category),

        image:
          (req.file as any)
            ?.path || "",
      });

    res.json(product);
  }
);

// ======================================================
// ADMIN PRODUCT STOCK
// ======================================================

r.patch(
  "/admin/products/:id",
  admin,
  async (req, res) => {
    const product =
      await Product.findByIdAndUpdate(
        req.params.id,

        {
          inStock:
            !!req.body?.inStock,
        },

        {
          new: true,
        }
      );

    res.json(product);
  }
);

// ======================================================
// ADMIN DELETE PRODUCT
// ======================================================

r.delete(
  "/admin/products/:id",
  admin,
  async (req, res) => {
    await Product.findByIdAndDelete(
      req.params.id
    );

    res.json({
      ok: true,
    });
  }
);

// ======================================================
// ADMIN MESSAGES
// ======================================================

r.get(
  "/admin/messages",
  admin,
  async (_req, res) => {
    const messages =
      await Message.find()
        .sort({
          createdAt: -1,
        })
        .limit(200)
        .lean();

    res.json(messages);
  }
);

// ======================================================
// ADMIN DELETE MESSAGE
// ======================================================

r.delete(
  "/admin/messages/:id",
  admin,
  async (req, res) => {
    await Message.findByIdAndDelete(
      req.params.id
    );

    res.json({
      ok: true,
    });
  }
);

export default r;