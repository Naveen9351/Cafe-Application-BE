# DINEVIQ — Deployment & Environment Architecture Reference

This document tracks all production and development environments, live URLs, repository branches, and database isolation rules for the Dineviq platform.

---

## 1. Quick Link Directory

| Layer | Environment | Branch | Live URL | Platform |
| :--- | :--- | :--- | :--- | :--- |
| **Frontend** | **Production** | `main` | [https://www.dineviq.com](https://www.dineviq.com) | Vercel (`cafe-application-fe`) |
| **Frontend** | **Development** | `dev` | [https://dev.dineviq.com](https://dev.dineviq.com)<br>*(Fallback: `cafe-application-fe-dev.vercel.app`)* | Vercel (`cafe-application-fe-dev`) |
| **Backend** | **Production** | `main` | [https://cafe-application-be-1.onrender.com](https://cafe-application-be-1.onrender.com) | Render (`Cafe-Application-BE-1`) |
| **Backend** | **Development** | `dev` | [https://cafe-application-be.onrender.com](https://cafe-application-be.onrender.com) | Render (`Cafe-Application-BE`) |
| **Database** | **Production** | — | MongoDB Atlas (`test` database) | MongoDB Atlas (Cluster 0) |
| **Database** | **Development** | — | MongoDB Atlas (`dineviq_dev` database) | MongoDB Atlas (Cluster 0) |

---

## 2. GitHub Repositories & Active Branches

- **Frontend**: [https://github.com/Naveen9351/Cafe-Application-FE](https://github.com/Naveen9351/Cafe-Application-FE)
  - `main` → Live Production (auto-deploys to `www.dineviq.com`)
  - `dev` → Live Development (auto-deploys to `dev.dineviq.com`)
- **Backend**: [https://github.com/Naveen9351/Cafe-Application-BE](https://github.com/Naveen9351/Cafe-Application-BE)
  - `main` → Live Production (auto-deploys to `cafe-application-be-1.onrender.com`)
  - `dev` → Live Development (auto-deploys to `cafe-application-be.onrender.com`)

---

## 3. Database Status & One-Way Isolation Rules

### How Real-Time One-Way Mirroring Works
1. **Real-Time Prod -> Dev Replication**:
   - The Production backend uses native **MongoDB Change Streams** (`utils/prodToDevMirror.js`).
   - Every time a customer places an order, an admin adds a dish, creates a table, or updates a customer in **Production**, MongoDB immediately mirrors that insert, update, or delete into `dineviq_dev` in milliseconds.
   - It runs completely in the background (asynchronous & non-blocking), so production response times are 100% unaffected.

2. **Strict One-Way Protection (Dev CANNOT touch Prod)**:
   - The Dev backend connects strictly to `MONGO_URI=.../dineviq_dev`.
   - The Change Stream only watches `test` (production) and writes to `dineviq_dev`.
   - Dev tests, mock orders, and staging edits remain strictly within `dineviq_dev` and **never write back to production**.

3. **Manual Batch Refresh**:
   - You can also trigger an immediate full snapshot sync anytime:
     ```bash
     cd Cafe-Application-BE
     npm run sync:prod-to-dev
     ```

---

## 4. Current Database Live Status

Verified on MongoDB Atlas (`cluster0.n5ytpsh.mongodb.net`):

| Collection | Production (`test`) Count | Development (`dineviq_dev`) Count | Status |
| :--- | :--- | :--- | :--- |
| **Users** | 10 | 10 | Isolated & Synced |
| **Tenants** | 6 | 6 | Isolated & Synced |
| **Menu Items** | 221 | 221 | Isolated & Synced |
| **Customers** | 55 | 55 | Isolated & Synced |
| **Tables** | 93 | 89 | Isolated (Dev has test sandbox) |
| **Orders** | 129 | 128 | Isolated (Live orders stay in prod) |
| **Activity Logs**| 3,553 | 3,534 | Isolated |
| **All Other Collections** | 10 collections | 10 collections | Fully created with indexes |

---

## 5. Domain DNS Setup

- **Production**: `www.dineviq.com` → CNAME `cname.vercel-dns.com` (Active)
- **Development**: `dev.dineviq.com` → CNAME `cname.vercel-dns.com` (In GoDaddy DNS)

