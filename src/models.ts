import mongoose, { Schema } from "mongoose";

export const STATUSES = [
  "received",
  "diagnosing",
  "in repair",
  "ready for pickup",
  "delivered",
];

// Shared address shape
const A = {
  line1: String,
  line2: String,
  landmark: String,
  city: {
    type: String,
    default: "Ahmedabad",
  },
  pincode: {
    type: String,
    index: true,
  },
};

// Repair
const R = new Schema(
  {
    ticket: {
      type: String,
      unique: true,
      index: true,
    },

    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      index: true,
    },

    name: String,

    phone: {
      type: String,
      index: true,
    },

    whatsapp: String,

    email: String,

    brand: String,

    company: String,

    model: String,

    imei: {
      type: String,
      index: true,
    },

    issue: String,

    notes: String,

    address: A,

    adminNote: String,

    estimate: Number,

    status: {
      type: String,
      enum: STATUSES,
      default: "received",
    },
  },
  {
    timestamps: true,
  }
);

// Product
const P = new Schema(
  {
    name: String,

    price: Number,

    category: String,

    image: String,

    inStock: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

// User
const U = new Schema(
  {
    name: {
      type: String,
      required: true,
    },

    email: {
      type: String,
      unique: true,
      lowercase: true,
      required: true,
    },

    phone: String,

    password: {
      type: String,
      required: true,
    },

    address: A,

    // Cloudinary profile image URL
    profileImage: {
      type: String,
      default: "",
    },
  },
  {
    timestamps: true,
  }
);

// Contact messages
const M = new Schema(
  {
    name: String,
    email: String,
    phone: String,
    message: String,
  },
  {
    timestamps: true,
  }
);

export const Repair =
  mongoose.models.Repair || mongoose.model("Repair", R);

export const Product =
  mongoose.models.Product || mongoose.model("Product", P);

export const User =
  mongoose.models.User || mongoose.model("User", U);

export const Message =
  mongoose.models.Message || mongoose.model("Message", M);