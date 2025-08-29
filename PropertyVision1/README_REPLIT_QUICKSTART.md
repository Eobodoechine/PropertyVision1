# PropertyVision1 — Quickstart (Replit)

## 1) Import & install
- Create a fresh Replit (Node.js) project.
- Upload this ZIP and extract it so the folder structure is `PropertyVision1/...` in your workspace root.
- Open the Replit Shell and run:
  ```bash
  cd PropertyVision1
  npm install
  ```

## 2) Configure environment
- In the Replit "Secrets" panel (Environment Variables), add:
  - `RAPIDAPI_KEY` — your **realty-in-us.p.rapidapi.com** key
  - `GOOGLE_MAPS_API_KEY` — your Google Maps key

(Alternatively: copy `.env.example` to `.env` and paste your keys there.)

## 3) Run the server (API)
```bash
cd PropertyVision1
npm run dev
```
- The API will bind to port `5000` by default (`/api/property/analyze`).

## 4) Run the client (optional local React dev)
This repo includes a client UI under `client/`. If you want to run it locally:
```bash
cd PropertyVision1/client
npm install
npm run dev
```
- Open the printed local URL; it will make calls to the server running on port 5000.
- If needed, set up a proxy or adjust the API base in `client/src/lib/api.ts`.

## Notes
- This code matches the structure/contract expected by the included front‑end (see `shared/schema.ts`). 
- If you previously customized other endpoints: remove them or update the client to match their shapes.
- For issues, check the Replit console logs for any 429 rate‑limit responses from RapidAPI and adjust request pacing.
