# SDM Backend + Admin Panel
1. `cp .env.example .env` and fill in the values
2. `npm install && npm run dev`
3. API: http://localhost:5000/api   Admin panel: http://localhost:5000/admin

Public API (used by the website): POST /api/repairs, GET /api/repairs?ticket=&phone=, GET /api/products
Customer API: POST /api/auth/signup, /api/auth/login, GET /api/auth/me, GET /api/my/repairs; POST /api/contact
Admin API (Bearer token from POST /api/admin/login): /api/admin/dashboard, /repairs, /products
Uploaded images are served from /uploads. Deploy on Render/Railway; set CLIENT_URL to your website URL.
