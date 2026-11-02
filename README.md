# REXON HR Management System — Phase 1 Foundation

Enterprise multi-portal HR, security, and manpower operations foundation built for **REXON Security & Manpower Solution**.

## Phase 1 Scope

- Unified single-project Firebase architecture serving **five role-isolated portals**
- Firebase Authentication + Cloud Firestore role verification (`users/{uid}`)
- Protected routes blocking manual URL tampering and redirecting unauthorized roles
- Soft White (`#FAF8F5`), Coffee Brown (`#5C3D2E`), and Light Beige (`#F3EDE4`) mobile-first responsive UI
- Clearly labelled **Development Preview Mode** when `VITE_FIREBASE_*` credentials are missing (never fakes live authentication or live database writes)
- Hardened Firestore (`firestore.rules`) and Storage (`storage.rules`) security rules
- Progressive Web App (PWA) foundation (`manifest.webmanifest`, Workbox service worker, PNG & SVG icons, in-app install button)

---

## Five Portal URLs

| Portal | URL | Login URL | Required Firestore `role` |
| :--- | :--- | :--- | :--- |
| **Default Root** | `/` | Opens Admin Portal Login | `admin` |
| **1. Admin Portal** | `/admin` | `/admin/login` | `admin` |
| **2. HR Portal** | `/hr` | `/hr/login` | `hr` |
| **3. Field Officer Portal** | `/field-officer` | `/field-officer/login` | `field_officer` |
| **4. Site Portal** | `/site` | `/site/login` | `site` |
| **5. Employee Portal** | `/employee` | `/employee/login` | `employee` |

---

## Environment Variables

Copy `.env.example` to `.env` and populate your Firebase Web App credentials:

```env
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
```

---

## Firestore User Structure (`users/{uid}`)

Every user authenticating via Firebase Auth must have a matching document in `users/{uid}`:

```json
{
  "uid": "FIREBASE_AUTH_UID",
  "fullName": "Full Name",
  "email": "user@rexonsecurity.com",
  "phone": "+91 9876543210",
  "role": "admin",
  "branchId": "BR-HQ-01",
  "assignedSiteIds": [],
  "permissions": ["branches:manage", "hr:provision", "approvals:decide"],
  "isActive": true,
  "createdAt": "<Firestore Timestamp>",
  "updatedAt": "<Firestore Timestamp>"
}
```

Allowed `role` values:
- `admin`
- `hr`
- `field_officer`
- `site`
- `employee`

---

## Local Development & Production Build

```bash
npm install
npm run dev
npm run build
```

---

## Firebase Deployment (Manual Configuration)

1. Create a Firebase project in the Firebase Console.
2. Enable **Authentication** (Email/Password provider), **Cloud Firestore**, and **Firebase Storage**.
3. Create your initial Administrator user in Firebase Authentication, copy its `UID`, and create `users/{UID}` in Firestore with `role: "admin"` and `isActive: true`.
4. Deploy rules, indexes, and hosting using Firebase CLI:
   ```bash
   firebase login
   firebase use <your-project-id>
   firebase deploy --only firestore:rules,firestore:indexes,storage,hosting
   ```
5. Verify HTTPS hosting and Chrome "Add to Home Screen" installability on your deployed Firebase Hosting domain.
