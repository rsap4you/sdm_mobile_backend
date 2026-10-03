import "dotenv/config";
import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import path from "path";
import mongoose from "mongoose";
import routes from "./routes";

for (const k of ["MONGO_URI", "JWT_SECRET", "ADMIN_PASSWORD"]) if (!process.env[k]) { console.error("Missing env: " + k); process.exit(1); }
const app = express();
app.set("trust proxy", 1);
app.use(cors({ origin: (process.env.CLIENT_URL || "http://localhost:3000"||"https://sdmmobile.netlify.app/").split(",") }));
app.use(express.json({ limit: "1mb" }));
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));
app.use("/admin", express.static(path.join(process.cwd(), "public/admin")));
app.use("/api", routes);
app.use((err: any, _q: Request, res: Response, _n: NextFunction) => res.status(err.status || 500).json({ error: err.status ? err.message : "Server error" }));
mongoose.connect(process.env.MONGO_URI!).then(() => {
  const p = Number(process.env.PORT) || 5000;
  app.listen(p, () => console.log(`API http://localhost:${p}/api  Admin http://localhost:${p}/admin`));
});
