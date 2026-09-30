import mongoose, { Schema } from "mongoose";

export const STATUSES = ["received", "diagnosing", "in repair", "ready for pickup", "delivered"];

// Shared address shape (Ahmedabad only)
const A = {
  line1: String,
  line2: String,
  landmark: String,
  city: { type: String, default: "Ahmedabad" },
  pincode: { type: String, index: true },
};

const R = new Schema({
  ticket: { type: String, unique: true, index: true },
  userId: { type: Schema.Types.ObjectId, ref: "User", index: true },
  name: String,
  phone: { type: String, index: true },
  brand: String,
  model: String,
  issue: String,
  notes: String,
  address: A,
  adminNote: String,
  estimate: Number,
  status: { type: String, enum: STATUSES, default: "received" },
}, { timestamps: true });

const P = new Schema({
  name: String,
  price: Number,
  category: String,
  image: String,
  inStock: { type: Boolean, default: true },
}, { timestamps: true });

const U = new Schema({
  name: String,
  email: { type: String, unique: true, lowercase: true },
  phone: String,
  password: String,
  address: A,
}, { timestamps: true });

const M = new Schema({ name: String, email: String, phone: String, message: String }, { timestamps: true });

export const Repair = mongoose.model("Repair", R);
export const Product = mongoose.model("Product", P);
export const User = mongoose.model("User", U);
export const Message = mongoose.model("Message", M);