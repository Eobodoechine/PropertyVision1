var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// server/vertex-freeform.js
var vertex_freeform_exports = {};
__export(vertex_freeform_exports, {
  vertexGenerate: () => vertexGenerate2
});
import "dotenv/config";
import https2 from "https";
import fetch from "node-fetch";
async function httpsPostJson2(url, payload, headers, timeoutMs = 12e4) {
  return await new Promise((resolve, reject) => {
    const u = new URL(url);
    const body = JSON.stringify(payload);
    const req = https2.request({ method: "POST", hostname: u.hostname, path: u.pathname + u.search, headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body).toString(), ...headers } }, (res) => {
      let data = "";
      res.on("data", (c) => data += c);
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve({ raw: data });
        }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}
async function getServiceAccountToken2(sa, scope) {
  console.log("\u{1F50D} TOKEN DEBUG 1: getServiceAccountToken called");
  console.log("\u{1F50D} TOKEN DEBUG 2: sa type:", typeof sa);
  console.log("\u{1F50D} TOKEN DEBUG 3: sa is null/undefined:", sa === null || sa === void 0);
  console.log("\u{1F50D} TOKEN DEBUG 4: sa keys:", sa ? Object.keys(sa) : "NO SA OBJECT");
  console.log("\u{1F50D} TOKEN DEBUG 5: sa.private_key exists:", !!sa?.private_key);
  console.log("\u{1F50D} TOKEN DEBUG 6: sa.private_key type:", typeof sa?.private_key);
  console.log("\u{1F50D} TOKEN DEBUG 7: sa.private_key length:", sa?.private_key?.length || "NO LENGTH");
  console.log("\u{1F50D} TOKEN DEBUG 8: sa.client_email:", sa?.client_email || "NO CLIENT EMAIL");
  const iat = Math.floor(Date.now() / 1e3);
  const exp = iat + 3600;
  const header = { alg: "RS256", typ: "JWT" };
  const claims = { iss: sa.client_email, scope, aud: sa.token_uri, exp, iat };
  const base64url = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  const unsigned = `${base64url(header)}.${base64url(claims)}`;
  const { createSign } = await import("node:crypto");
  const sign = createSign("RSA-SHA256");
  sign.update(unsigned);
  console.log("\u{1F50D} TOKEN DEBUG 9: About to call sign.sign(sa.private_key)");
  console.log("\u{1F50D} TOKEN DEBUG 10: Final sa.private_key check:", !!sa.private_key);
  const formattedPrivateKey = sa.private_key.replace(/\\n/g, "\n");
  console.log("\u{1F50D} TOKEN DEBUG 11: Private key formatted, checking format...");
  const signature = sign.sign(formattedPrivateKey).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  const assertion = `${unsigned}.${signature}`;
  const body = new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion });
  const resp = await httpsPostForm2(sa.token_uri, body.toString(), { "Content-Type": "application/x-www-form-urlencoded" }, 2e4);
  if (!resp?.access_token)
    throw new Error("sa-token-failed");
  return resp.access_token;
}
async function httpsPostForm2(url, body, headers, timeoutMs) {
  return await new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https2.request({ method: "POST", hostname: u.hostname, path: u.pathname + u.search, headers: { ...headers, "Content-Length": Buffer.byteLength(body).toString() } }, (res) => {
      let data = "";
      res.on("data", (chunk) => data += chunk);
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(null);
        }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}
async function vertexGenerate2(opts) {
  console.log(`\u{1F50D} VERTEX DEBUG 1: vertexGenerate called with opts keys:`, Object.keys(opts));
  console.log(`\u{1F50D} VERTEX DEBUG 2: projectId="${opts.projectId}", location="${opts.location}", model="${opts.model}"`);
  console.log(`\u{1F50D} VERTEX DEBUG 3: prompt length=${opts.prompt?.length}, grounded=${opts.grounded}, json=${opts.json}`);
  console.log(`\u{1F50D} VERTEX DEBUG 4: timeoutMs=${opts.timeoutMs}`);
  const FORCE_VERTEX_PROXY = ["true", "1", "yes"].includes((process.env.FORCE_VERTEX_PROXY || "").toLowerCase());
  const USE_VERTEX_PROXY = ["true", "1", "yes"].includes((process.env.USE_VERTEX_PROXY || "").toLowerCase());
  const VERTEX_PROXY_URL = process.env.VERTEX_PROXY_URL;
  const PROXY_SHARED_KEY = process.env.PROXY_SHARED_KEY;
  console.log(`\u{1F50D} VERTEX DEBUG 4.1: FORCE=${FORCE_VERTEX_PROXY}, USE=${USE_VERTEX_PROXY}, URL=${VERTEX_PROXY_URL ? "SET" : "UNSET"}, KEY=${PROXY_SHARED_KEY ? "SET" : "UNSET"}, grounded=${opts.grounded}`);
  if ((FORCE_VERTEX_PROXY || USE_VERTEX_PROXY) && VERTEX_PROXY_URL && PROXY_SHARED_KEY) {
    console.log(`\u{1F50D} VERTEX DEBUG 4.5: \u2705 Routing to vertex-proxy (forced=${FORCE_VERTEX_PROXY})`);
    const callStartTime = Date.now();
    try {
      const controller = new AbortController();
      const timeoutMs = opts.timeoutMs || 3e4;
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      const proxyResponse = await fetch(`${VERTEX_PROXY_URL}/vertex/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-proxy-key": PROXY_SHARED_KEY
        },
        body: JSON.stringify({
          prompt: opts.prompt,
          model: opts.model || "gemini-2.0-flash-001",
          timeoutMs,
          temperature: 0.1,
          maxOutputTokens: 8192,
          grounded: opts.grounded || false,
          jobId: opts.jobId,
          searchId: opts.searchId
        }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      const clientLatencyMs = Date.now() - callStartTime;
      if (!proxyResponse.ok) {
        const errorBody = await proxyResponse.text().catch(() => "no body");
        console.error(JSON.stringify({
          event: "vertex.proxy.client_error",
          jobId: opts.jobId,
          searchId: opts.searchId,
          model: opts.model,
          http: {
            status: proxyResponse.status,
            statusText: proxyResponse.statusText
          },
          error: {
            snippet: errorBody.substring(0, 300)
          },
          timingMs: {
            client_total: clientLatencyMs
          }
        }));
        throw new Error(`Vertex proxy failed: ${proxyResponse.status} - ${errorBody.substring(0, 100)}`);
      }
      const proxyResult = await proxyResponse.json();
      console.log(JSON.stringify({
        event: "vertex.proxy.client_success",
        jobId: opts.jobId,
        searchId: opts.searchId,
        model: opts.model,
        http: {
          status: 200
        },
        timingMs: {
          client_total: clientLatencyMs,
          proxy_elapsed: proxyResult.elapsedMs,
          proxy_latency: proxyResult.latencyMs
        },
        responseChars: proxyResult.text?.length || 0,
        reqId: proxyResult.reqId
      }));
      return proxyResult.text || "";
    } catch (proxyError) {
      const clientLatencyMs = Date.now() - callStartTime;
      if (proxyError.name === "AbortError") {
        console.error(JSON.stringify({
          event: "vertex.proxy.client_timeout",
          jobId: opts.jobId,
          searchId: opts.searchId,
          model: opts.model,
          timeoutMs: opts.timeoutMs,
          timingMs: {
            client_total: clientLatencyMs
          }
        }));
        throw new Error(`Vertex proxy timeout after ${opts.timeoutMs}ms`);
      }
      console.error(JSON.stringify({
        event: "vertex.proxy.client_error",
        jobId: opts.jobId,
        searchId: opts.searchId,
        model: opts.model,
        error: {
          message: proxyError.message,
          name: proxyError.name,
          code: proxyError.code
        },
        timingMs: {
          client_total: clientLatencyMs
        }
      }));
      throw new Error(`Vertex proxy failed: ${proxyError.message}`);
    }
  }
  console.log(`\u{1F50D} VERTEX DEBUG 5: Getting service account token (direct path)`);
  const token = await getServiceAccountToken2(opts.sa, "https://www.googleapis.com/auth/cloud-platform");
  console.log(`\u{1F50D} VERTEX DEBUG 6: Token obtained, length=${token?.length}`);
  const endpoint = `https://${opts.location}-aiplatform.googleapis.com/v1/projects/${opts.projectId}/locations/${opts.location}/publishers/google/models/${opts.model}:generateContent`;
  console.log(`\u{1F50D} VERTEX DEBUG 7: Endpoint=${endpoint}`);
  const payload = {
    contents: [{ role: "user", parts: [{ text: opts.prompt }] }],
    generationConfig: {
      temperature: 0,
      // Maximum determinism
      seed: 12345,
      // Fixed seed for reproducibility
      maxOutputTokens: 8192,
      // Maximum tokens for Gemini 2.0 Flash on Vertex AI (reduced from 65535)
      ...opts.json ? { responseMimeType: "application/json" } : {}
    }
  };
  if (opts.grounded)
    payload.tools = [{ google_search: {} }];
  if (opts.responseSchema)
    payload.generationConfig.responseSchema = opts.responseSchema;
  console.log(`\u{1F50D} VERTEX DEBUG 8: Payload created, contents length=${payload.contents.length}`);
  console.log(`\u{1F50D} VERTEX DEBUG 9: Payload generationConfig:`, JSON.stringify(payload.generationConfig));
  console.log(`\u{1F50D} VERTEX DEBUG 10: About to call httpsPostJson`);
  const res = await httpsPostJson2(endpoint, payload, { Authorization: `Bearer ${token}` }, opts.timeoutMs);
  console.log(`\u{1F50D} VERTEX DEBUG 11: httpsPostJson returned, response type:`, typeof res);
  console.log(`\u{1F50D} VERTEX DEBUG 12: Response keys:`, res ? Object.keys(res) : "null");
  console.log(`\u{1F50D} VERTEX DEBUG 13: Full response:`, JSON.stringify(res, null, 2));
  if (!res) {
    console.log(`\u{1F50D} VERTEX DEBUG 14: NULL RESPONSE - returning empty string`);
    return "";
  }
  if (!res.candidates) {
    console.log(`\u{1F50D} VERTEX DEBUG 15: NO CANDIDATES - response:`, res);
    if (res.error) {
      console.log(`\u{1F50D} VERTEX DEBUG 15.1: ERROR DETAILS:`, JSON.stringify(res.error, null, 2));
    }
    return "";
  }
  console.log(`\u{1F50D} VERTEX DEBUG 16: Candidates found, length=${res.candidates.length}`);
  if (!res.candidates[0]) {
    console.log(`\u{1F50D} VERTEX DEBUG 17: NO FIRST CANDIDATE`);
    return "";
  }
  console.log(`\u{1F50D} VERTEX DEBUG 18: First candidate:`, JSON.stringify(res.candidates[0], null, 2));
  if (!res.candidates[0].content) {
    console.log(`\u{1F50D} VERTEX DEBUG 19: NO CONTENT in first candidate`);
    return "";
  }
  console.log(`\u{1F50D} VERTEX DEBUG 20: Content found:`, JSON.stringify(res.candidates[0].content, null, 2));
  if (!res.candidates[0].content.parts) {
    console.log(`\u{1F50D} VERTEX DEBUG 21: NO PARTS in content`);
    return "";
  }
  console.log(`\u{1F50D} VERTEX DEBUG 22: Parts found, length=${res.candidates[0].content.parts.length}`);
  const parts = res.candidates[0].content.parts;
  for (let i = 0; i < parts.length; i++) {
    console.log(`\u{1F50D} VERTEX DEBUG 23.${i}: Part ${i}:`, JSON.stringify(parts[i], null, 2));
  }
  const text = res?.candidates?.[0]?.content?.parts?.map((p) => p?.text || "").join("") || "";
  console.log(`\u{1F50D} VERTEX DEBUG 24: Final extracted text: "${text}"`);
  console.log(`\u{1F50D} VERTEX DEBUG 25: Final text length: ${text.length}`);
  return text;
}
var init_vertex_freeform = __esm({
  "server/vertex-freeform.js"() {
    console.log("\u{1F6A8}\u{1F6A8}\u{1F6A8} VERTEX-FREEFORM.JS v7.1 - PROXY ROUTING ENABLED \u{1F6A8}\u{1F6A8}\u{1F6A8}");
    console.log(`\u{1F4CA} VERTEX CONFIG AT LOAD: USE_VERTEX_PROXY=${process.env.USE_VERTEX_PROXY}, FORCE=${process.env.FORCE_VERTEX_PROXY}, URL=${process.env.VERTEX_PROXY_URL ? "SET" : "UNSET"}`);
  }
});

// server/index.ts
import "dotenv/config";
import express from "express";
import cors from "cors";

// server/step3-find-comparables.ts
import "dotenv/config";
import fs2 from "fs";
import crypto2 from "crypto";
import https3 from "https";

// server/vertex-details.ts
import "dotenv/config";
import fs from "fs";
import https from "https";
import crypto from "crypto";
function hasServiceAccount() {
  const p = process.env.GCP_SA_JSON || process.env.SERVICE_ACCOUNT_JSON;
  return Boolean(p && p.trim().length > 0);
}
async function getServiceAccountToken(sa, scope) {
  const iat = Math.floor(Date.now() / 1e3);
  const exp = iat + 3600;
  const header = { alg: "RS256", typ: "JWT" };
  const claims = { iss: sa.client_email, scope, aud: sa.token_uri, exp, iat };
  const base64url = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  const unsigned = `${base64url(header)}.${base64url(claims)}`;
  const sign = crypto.createSign("RSA-SHA256");
  sign.update(unsigned);
  const signature = sign.sign(sa.private_key).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  const assertion = `${unsigned}.${signature}`;
  const body = new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion });
  const resp = await httpsPostForm(sa.token_uri, body.toString(), { "Content-Type": "application/x-www-form-urlencoded" }, 2e4);
  if (!resp?.access_token) throw new Error("sa-token-failed");
  return resp.access_token;
}
async function httpsPostForm(url, body, headers, timeoutMs) {
  return await new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({ method: "POST", hostname: u.hostname, path: u.pathname + u.search, headers: { ...headers, "Content-Length": Buffer.byteLength(body).toString() } }, (res) => {
      let data = "";
      res.on("data", (chunk) => data += chunk);
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(null);
        }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}
async function httpsPostJson(url, payload, headers, timeoutMs) {
  return await new Promise((resolve, reject) => {
    const u = new URL(url);
    const body = JSON.stringify(payload);
    const req = https.request({ method: "POST", hostname: u.hostname, path: u.pathname + u.search, headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body).toString(), ...headers } }, (res) => {
      let data = "";
      res.on("data", (chunk) => data += chunk);
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(null);
        }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}
async function vertexGenerate(opts) {
  const token = await getServiceAccountToken(opts.sa, "https://www.googleapis.com/auth/cloud-platform");
  const endpoint = `https://${opts.location}-aiplatform.googleapis.com/v1/projects/${opts.projectId}/locations/${opts.location}/publishers/google/models/${opts.model}:generateContent`;
  const payload = {
    contents: [{ role: "user", parts: [{ text: opts.prompt }] }],
    generationConfig: {
      temperature: 0,
      // Maximum determinism
      seed: 12345,
      // Fixed seed for reproducibility
      maxOutputTokens: 1500,
      ...opts.json ? { responseMimeType: "application/json" } : {}
    }
  };
  if (opts.grounded) payload.tools = [{ google_search: {} }];
  if (opts.responseSchema) payload.generationConfig.responseSchema = opts.responseSchema;
  const res = await httpsPostJson(endpoint, payload, { Authorization: `Bearer ${token}` }, opts.timeoutMs);
  const text = res?.candidates?.[0]?.content?.parts?.map((p) => p?.text || "").join("") || "";
  return text;
}
async function parseFreeformWithLLM(text, sa, projectId, location, model) {
  try {
    const sqftPrompt = `What is the house square footage (interior/living space only, not lot size) in this text?

"${text}"

Give only the number, no commas or units.`;
    const sqftResponse = await vertexGenerate({
      sa,
      projectId,
      location,
      model,
      prompt: sqftPrompt,
      grounded: false,
      json: false,
      timeoutMs: 1e4
    });
    const sqft = sqftResponse.match(/\d+/) ? Number(sqftResponse.replace(/[^\d]/g, "")) : null;
    const bedsPrompt = `How many bedrooms are in this property?

"${text}"

Give only the number.`;
    const bedsResponse = await vertexGenerate({
      sa,
      projectId,
      location,
      model,
      prompt: bedsPrompt,
      grounded: false,
      json: false,
      timeoutMs: 1e4
    });
    const beds = bedsResponse.match(/\d+/) ? Number(bedsResponse.replace(/[^\d]/g, "")) : null;
    const bathsPrompt = `How many bathrooms (including half baths as 0.5) are in this property?

"${text}"

Give only the number (use decimals like 2.5).`;
    const bathsResponse = await vertexGenerate({
      sa,
      projectId,
      location,
      model,
      prompt: bathsPrompt,
      grounded: false,
      json: false,
      timeoutMs: 1e4
    });
    const baths = bathsResponse.match(/[\d.]+/) ? Number(bathsResponse.match(/[\d.]+/)?.[0]) : null;
    const yearPrompt = `What year was this property built?

"${text}"

Give only the 4-digit year.`;
    const yearResponse = await vertexGenerate({
      sa,
      projectId,
      location,
      model,
      prompt: yearPrompt,
      grounded: false,
      json: false,
      timeoutMs: 1e4
    });
    const yearBuilt = yearResponse.match(/\b(19|20)\d{2}\b/) ? Number(yearResponse.match(/\b(19|20)\d{2}\b/)?.[0]) : null;
    let subdivision = null;
    try {
      const subPrompt = `From this text, what is the subdivision or neighborhood name of the property? If not present, answer UNKNOWN.

"${text}"

Respond with only the name or UNKNOWN.`;
      const subResp = await vertexGenerate({ sa, projectId, location, model, prompt: subPrompt, grounded: false, json: false, timeoutMs: 6e5 });
      const cleaned = (subResp || "").trim();
      if (cleaned && !/^unknown$/i.test(cleaned)) {
        subdivision = cleaned.replace(/^[-\s:]+/, "").trim();
      }
    } catch {
    }
    console.log(`   \u{1F916} LLM Extraction: SQFT=${sqft}, Beds=${beds}, Baths=${baths}, Built=${yearBuilt}${subdivision ? `, Subdivision=${subdivision}` : ""}`);
    return { sqft, beds, baths, yearBuilt, lotSize: null, subdivision };
  } catch (error) {
    console.log(`   \u26A0\uFE0F  LLM parsing failed, falling back to regex: ${error}`);
    return parseFreeformRegex(text);
  }
}
function parseFreeformRegex(text) {
  const clean = (s) => s.replace(/[,\s]/g, "").trim();
  const sqftMatch = text.match(/([0-9,]+)\s*(?:sq\s*ft|square\s*feet)/i);
  let sqft = null;
  if (sqftMatch) {
    const val = Number(clean(sqftMatch[1]));
    if (val >= 500 && val <= 1e4) {
      sqft = val;
    }
  }
  const bedsMatch = text.match(/([0-9]{1,2})\s*(?:bedroom|bed|BR)/i);
  const beds = bedsMatch ? Number(bedsMatch[1]) : null;
  const bathsMatch = text.match(/([0-9]+(?:\.[0-9]+)?)\s*(?:bathroom|bath|BA)/i);
  const baths = bathsMatch ? Number(bathsMatch[1]) : null;
  const yearMatch = text.match(/\b(19|20)\d{2}\b/);
  const yearBuilt = yearMatch ? Number(yearMatch[0]) : null;
  return { sqft, beds, baths, yearBuilt, lotSize: null };
}
async function fetchPropertyDetailsViaVertex(address) {
  if (!hasServiceAccount()) return null;
  const saPath = process.env.GCP_SA_JSON || process.env.SERVICE_ACCOUNT_JSON;
  const sa = JSON.parse(fs.readFileSync(saPath, "utf-8"));
  const projectId = sa.project_id;
  const location = process.env.VERTEX_LOCATION || "us-central1";
  const model = process.env.VERTEX_MODEL || "gemini-2.5-pro";
  const timeoutMs = Number(process.env.VERTEX_TIMEOUT_MS || "600000");
  let propertyDetails = {};
  try {
    const prompt = `Use Google Search grounding with authoritative real estate sources (Zillow, Redfin, Realtor.com, county records) to find COMPLETE property details for: ${address}

CRITICAL REQUIRED DATA (must find all):
- Exact square footage (living area only, not lot size)
- Number of bedrooms (exact count)
- Number of bathrooms (including half baths as 0.5)
- Year built (exact year)
- Property type (single-family detached, townhome, condo, duplex)

ADDITIONAL HELPFUL DATA:
- Lot size in square feet or acres
- Subdivision/neighborhood name
- Garage/parking spaces
- Stories/levels
- Special features (pool, basement, etc.)

Search specific sites:
- site:zillow.com "${address}"
- site:redfin.com "${address}"
- site:realtor.com "${address}"
- "${address}" county records property details

Provide specific facts with numbers. If any critical data is missing, clearly state "MISSING" for that field.`;
    const text = await vertexGenerate({ sa, projectId, location, model, prompt, grounded: true, json: false, timeoutMs });
    console.log(`   \u{1F4C4} Primary search response: ${text.substring(0, 200)}...`);
    propertyDetails = await parseFreeformWithLLM(text, sa, projectId, location, model);
    console.log(`   \u{1F4CA} Parsed data: sqft=${propertyDetails.sqft}, beds=${propertyDetails.beds}, baths=${propertyDetails.baths}, yearBuilt=${propertyDetails.yearBuilt}`);
  } catch (err) {
    console.log(`   \u26A0\uFE0F  Primary grounded search failed: ${err}`);
  }
  const hasCriticalData = propertyDetails.sqft && propertyDetails.beds && propertyDetails.baths && propertyDetails.yearBuilt;
  if (!hasCriticalData) {
    console.log(`   \u{1F6D1} MISSING CRITICAL DATA - Attempting targeted fallback searches...`);
    const missingFields = [];
    if (!propertyDetails.sqft) missingFields.push("square footage");
    if (!propertyDetails.beds) missingFields.push("bedrooms");
    if (!propertyDetails.baths) missingFields.push("bathrooms");
    if (!propertyDetails.yearBuilt) missingFields.push("year built");
    try {
      const countyPrompt = `Use Google Search grounding to find missing property data from county records and tax assessor for: ${address}

MISSING FIELDS TO FIND: ${missingFields.join(", ")}

Search county assessor and tax records:
- "${address}" tax assessor records
- "${address}" property tax records
- "${address}" county property details
- "${address}" square feet bedrooms bathrooms

Focus only on finding: ${missingFields.join(", ")}. Provide exact numbers.`;
      const countyText = await vertexGenerate({ sa, projectId, location, model, prompt: countyPrompt, grounded: true, json: false, timeoutMs });
      const countyData = await parseFreeformWithLLM(countyText, sa, projectId, location, model);
      if (!propertyDetails.sqft && countyData.sqft) propertyDetails.sqft = countyData.sqft;
      if (!propertyDetails.beds && countyData.beds) propertyDetails.beds = countyData.beds;
      if (!propertyDetails.baths && countyData.baths) propertyDetails.baths = countyData.baths;
      if (!propertyDetails.yearBuilt && countyData.yearBuilt) propertyDetails.yearBuilt = countyData.yearBuilt;
      console.log(`   \u{1F50D} County records filled: sqft=${propertyDetails.sqft}, beds=${propertyDetails.beds}, baths=${propertyDetails.baths}, yearBuilt=${propertyDetails.yearBuilt}`);
    } catch (err) {
      console.log(`   \u26A0\uFE0F  County records search failed: ${err}`);
    }
  }
  const finalValidation = propertyDetails.sqft && propertyDetails.beds && propertyDetails.baths && propertyDetails.yearBuilt;
  if (!finalValidation) {
    const stillMissing = [];
    if (!propertyDetails.sqft) stillMissing.push("square footage");
    if (!propertyDetails.beds) stillMissing.push("bedrooms");
    if (!propertyDetails.baths) stillMissing.push("bathrooms");
    if (!propertyDetails.yearBuilt) stillMissing.push("year built");
    console.log(`   \u274C ANALYSIS STOPPED - Missing critical data: ${stillMissing.join(", ")}`);
    console.log(`   \u{1F6D1} Cannot proceed with ARV analysis without complete property details`);
    return null;
  }
  console.log(`   \u2705 All critical data found - Proceeding with analysis`);
  return normalize(address, propertyDetails);
}
function normalize(address, obj) {
  return {
    address,
    sqft: obj?.sqft != null && Number.isFinite(Number(obj.sqft)) ? Number(obj.sqft) : null,
    beds: obj?.beds != null && Number.isFinite(Number(obj.beds)) ? Number(obj.beds) : null,
    baths: obj?.baths != null ? Number(obj.baths) : null,
    yearBuilt: obj?.yearBuilt != null && Number.isFinite(Number(obj.yearBuilt)) ? Number(obj.yearBuilt) : null,
    lotSize: obj?.lotSize != null && Number.isFinite(Number(obj.lotSize)) ? Number(obj.lotSize) : null,
    subdivision: typeof obj?.subdivision === "string" && obj.subdivision.trim().length > 0 ? obj.subdivision.trim() : null,
    success: true
  };
}

// server/step3-find-comparables.ts
var VertexComparableSearchService = class {
  rawCompsFound = 0;
  googleMapsApiKey;
  geocodeCache;
  constructor() {
    this.googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY || "";
    if (!this.googleMapsApiKey) {
      throw new Error("GOOGLE_MAPS_API_KEY environment variable is required");
    }
    this.geocodeCache = /* @__PURE__ */ new Map();
  }
  async findComparables(subjectAddress, subjectPropertyType, maxResults = 10, searchRadius = 3, timeWindowMonths = 18, subjectDetails, extra) {
    try {
      const subjectCoords = await this.geocodeWithTimeout(subjectAddress, 5e3);
      if (!subjectCoords) {
        throw new Error("Failed to geocode subject property");
      }
      const saPath = process.env.GCP_SA_JSON || process.env.SERVICE_ACCOUNT_JSON;
      if (!saPath) {
        throw new Error("GCP_SA_JSON environment variable is required for Vertex AI");
      }
      const sa = JSON.parse(fs2.readFileSync(saPath, "utf-8"));
      const projectId = sa.project_id;
      const location = process.env.VERTEX_LOCATION || "us-central1";
      const model = process.env.VERTEX_MODEL || "gemini-2.5-pro";
      const token = await this.getServiceAccountToken(sa, "https://www.googleapis.com/auth/cloud-platform");
      const subdivision = (extra?.subdivision?.trim() || process.env.SUBDIVISION)?.trim();
      const composeAnalystPipePrompt = (withSubdivision) => {
        const sd = subjectDetails || null;
        const subjBeds = sd?.beds ?? void 0;
        const subjBaths = sd?.baths ?? void 0;
        const subjSqft = sd?.sqft ?? void 0;
        const subjYear = sd?.yearBuilt ?? void 0;
        const lowSqft = subjSqft ? Math.round(subjSqft * 0.8) : "\xB120% lower bound";
        const highSqft = subjSqft ? Math.round(subjSqft * 1.2) : "\xB120% upper bound";
        const lowYear = subjYear ? subjYear - 10 : "subject-10";
        const highYear = subjYear ? subjYear + 10 : "subject+10";
        return `You are an experienced real estate analyst.

Your task is to identify the best comparable sales ("comps") for the subject property below.
Follow the step-by-step instructions exactly and only return comps that meet the criteria.

SUBJECT PROPERTY:
- Address: ${subjectAddress}
${subjBeds != null ? `- Beds: ${subjBeds}
` : ""}${subjBaths != null ? `- Baths: ${subjBaths}
` : ""}${subjSqft != null ? `- Square Footage: ${subjSqft} sqft
` : ""}${subjYear != null ? `- Year Built: ${subjYear}
` : ""}${withSubdivision && subdivision ? `- Subdivision: ${subdivision}
` : ""}
COMPARABLE SELECTION CRITERIA:
1. Location: Within ${searchRadius} miles of the subject property.
2. Sale Date: Sold within the last ${timeWindowMonths} months.
3. Size: Between ~${lowSqft} sqft and ~${highSqft} sqft (\xB120% of subject).
4. Bedrooms: ${subjBeds != null ? `${Math.max(1, subjBeds - 1)}\u2013${subjBeds + 1}` : "\xB11 of subject"} bedrooms.
5. Bathrooms: ${subjBaths != null ? `${Math.max(1, Math.floor(subjBaths - 1))}\u2013${Math.ceil(subjBaths + 1)}` : "\xB11 of subject"} bathrooms.
6. Year Built: Between ${lowYear} and ${highYear} (within \xB110 years of subject\u2019s build year).

OUTPUT FORMAT (STRICT):
Return ONLY pipe-separated lines, one per property, no commentary, no headers:
address | sold_price | sold_date(YYYY-MM-DD) | beds | baths | sqft | year_built | source_url`;
      };
      const aggregatedComps = /* @__PURE__ */ new Map();
      const fetchAndParse = async (p) => {
        const { vertexGenerate: vertexGenerate3 } = await Promise.resolve().then(() => (init_vertex_freeform(), vertex_freeform_exports));
        const r = await vertexGenerate3({
          sa,
          projectId,
          location,
          model,
          prompt: p,
          grounded: true,
          timeoutMs: 6e4
        });
        let parsed = await this.parseVertexResponse(r, subjectCoords.lat, subjectCoords.lon, subjectDetails);
        if (parsed.length === 0) {
          const strictP = `Return ONLY pipe-separated lines for SOLD properties near "${subjectAddress}" within ${searchRadius} miles and ${timeWindowMonths} months. No commentary, no headers.
address | sold_price | sold_date(YYYY-MM-DD) | beds | baths | sqft | year_built | source_url`;
          const sr = await vertexGenerate3({
            sa,
            projectId,
            location,
            model,
            prompt: strictP,
            grounded: true,
            timeoutMs: 6e4
          });
          parsed = await this.parseVertexResponse(sr, subjectCoords.lat, subjectCoords.lon, subjectDetails);
        }
        return parsed;
      };
      const prompts = [];
      if (subdivision) {
        for (let i = 1; i <= 3; i++) prompts.push(composeAnalystPipePrompt(true));
      } else {
      }
      for (let i = 1; i <= 3; i++) prompts.push(composeAnalystPipePrompt(false));
      const batches = await Promise.all(prompts.map((p) => fetchAndParse(p)));
      for (const list of batches) {
        list.forEach((c) => {
          if (!aggregatedComps.has(c.address)) aggregatedComps.set(c.address, c);
        });
      }
      let comps = Array.from(aggregatedComps.values());
      comps.forEach((comp, index) => {
        const bedroomDiff = Math.abs((comp.beds || 0) - (subjectDetails?.beds || 0));
        if (bedroomDiff <= 1) {
        } else {
        }
        if (subjectDetails?.sqft) {
          const sizeVariance = Math.abs(comp.sqft - subjectDetails.sqft) / subjectDetails.sqft * 100;
          if (sizeVariance <= 20) {
          } else {
          }
        }
      });
      comps = this.deduplicateComparables(comps);
      comps = this.filterByPPSFVariance(comps);
      const prioritized = this.prioritizeForEnrichment(comps);
      comps = await this.enrichAndRevalidate(prioritized, subjectDetails);
      comps = await this.geocodeAndFilterDistance(comps, subjectCoords.lat, subjectCoords.lon, 1, 2);
      comps.sort((a, b) => {
        const af = Number.isFinite(a.distance) ? a.distance : Number.POSITIVE_INFINITY;
        const bf = Number.isFinite(b.distance) ? b.distance : Number.POSITIVE_INFINITY;
        return af - bf;
      });
      const finalComps = comps.slice(0, maxResults);
      const foundCount = this.rawCompsFound || 0;
      const qualifiedCount = finalComps.length;
      const rejectedCount = foundCount - qualifiedCount;
      if (qualifiedCount > 0) {
        const distances = finalComps.map((c) => c.distance);
        const sizes = finalComps.map((c) => c.sqft);
        const ppsfValues = finalComps.map((c) => c.price / c.sqft);
      }
      const MIN_COMPS_REQUIRED = 3;
      if (finalComps.length < MIN_COMPS_REQUIRED) {
        if (finalComps.length === 0) {
          return {
            comparables: [],
            success: false,
            error: `No qualified comparables found after strict filtering. Consider expanding search criteria.`
          };
        }
      }
      const recentComps = finalComps.filter((c) => {
        const soldDate = new Date(c.soldDate);
        const ageInMonths = Math.floor((Date.now() - soldDate.getTime()) / (1e3 * 60 * 60 * 24 * 30.44));
        return ageInMonths <= 12;
      });
      const idealDistance = finalComps.filter((c) => c.distance <= 1);
      const extendedDistance = finalComps.filter((c) => c.distance > 1);
      try {
        const outPath = process.env.FINAL_COMPS_CACHE;
        if (outPath) {
          const payload = finalComps.map((c) => ({
            address: c.address,
            price: c.price,
            soldDate: c.soldDate,
            beds: c.beds,
            baths: c.baths,
            sqft: c.sqft,
            yearBuilt: c.yearBuilt,
            distance: c.distance,
            source: c.source,
            confidence: c.confidence
          }));
          fs2.writeFileSync(outPath, JSON.stringify({ comps: payload }, null, 2));
        }
      } catch {
      }
      return {
        comparables: finalComps,
        success: true
      };
    } catch (error) {
      console.error(`   \u274C Comparable search failed: ${error.message}`);
      return {
        comparables: [],
        success: false,
        error: error.message
      };
    }
  }
  getVertexConfig() {
    const saPath = process.env.GCP_SA_JSON || process.env.SERVICE_ACCOUNT_JSON;
    if (!saPath) {
      throw new Error("GCP_SA_JSON environment variable is required for Vertex AI");
    }
    const serviceAccount = JSON.parse(fs2.readFileSync(saPath, "utf-8"));
    const projectId = serviceAccount.project_id;
    const location = process.env.VERTEX_LOCATION || "us-central1";
    const model = process.env.VERTEX_MODEL || "gemini-2.5-pro";
    return { serviceAccount, projectId, location, model };
  }
  async parsePropertyDataWithLLM(propertyLine) {
    try {
      const { vertexGenerate: vertexGenerate3 } = await Promise.resolve().then(() => (init_vertex_freeform(), vertex_freeform_exports));
      const { serviceAccount, projectId, location, model } = this.getVertexConfig();
      const allFieldsPrompt = `Extract all property data from this line and return ONLY valid JSON (no prose, no markdown fences):

"${propertyLine}"

Return exactly this JSON structure:
{
  "address": "complete street address",
  "price": number (no commas or dollar signs),
  "soldDate": "YYYY-MM-DD format (or INVALID if date is missing/invalid)",
  "beds": number,
  "baths": number (can be decimal),
  "sqft": number (no commas),
  "yearBuilt": 4-digit year,
  "source": "website name or URL"
}`;
      const responseSchema = {
        type: "OBJECT",
        properties: {
          address: { type: "STRING" },
          price: { type: "NUMBER" },
          soldDate: { type: "STRING" },
          beds: { type: "NUMBER" },
          baths: { type: "NUMBER" },
          sqft: { type: "NUMBER" },
          yearBuilt: { type: "NUMBER" },
          source: { type: "STRING" }
        }
      };
      const response = await vertexGenerate3({
        sa: serviceAccount,
        projectId,
        location,
        model,
        prompt: allFieldsPrompt,
        grounded: false,
        json: true,
        timeoutMs: 6e5,
        responseSchema
      });
      const extractJsonBlock = (text) => {
        if (!text) return null;
        const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
        if (fenced && fenced[1]) return fenced[1].trim();
        const start = text.indexOf("{");
        const end = text.lastIndexOf("}");
        if (start !== -1 && end !== -1 && end > start) return text.slice(start, end + 1);
        return null;
      };
      let parsedJson;
      try {
        parsedJson = JSON.parse(response);
      } catch {
        const block = extractJsonBlock(response);
        parsedJson = block ? JSON.parse(block) : null;
      }
      if (!parsedJson || typeof parsedJson !== "object") {
        throw new Error("invalid-json-from-llm");
      }
      const addressRes = parsedJson.address || "";
      const priceRes = String(parsedJson.price || 0);
      const dateRes = parsedJson.soldDate || "INVALID";
      const bedsRes = String(parsedJson.beds || 0);
      const bathsRes = String(parsedJson.baths || 0);
      const sqftRes = String(parsedJson.sqft || 0);
      const yearRes = parsedJson.yearBuilt != null ? String(parsedJson.yearBuilt) : "";
      const sourceRes = parsedJson.source || "unknown";
      const address = addressRes.trim();
      const price = Number(priceRes.replace(/[^\d.]/g, ""));
      const dateStr = dateRes.trim();
      const beds = Number(bedsRes.replace(/[^\d.]/g, ""));
      const normalizedBaths = bathsRes.replace(/½/g, ".5").replace(/¼/g, ".25").replace(/¾/g, ".75");
      const baths = Number(normalizedBaths.replace(/[^\d.]/g, ""));
      const sqft = Number(sqftRes.replace(/[^\d.]/g, ""));
      const yearBuilt = yearRes ? Number(yearRes.replace(/[^\d]/g, "")) : NaN;
      const source = sourceRes.trim();
      let soldDate = null;
      if (dateStr && dateStr !== "INVALID") {
        soldDate = new Date(dateStr);
        if (isNaN(soldDate.getTime())) {
          let dateMatch = dateStr.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
          if (dateMatch) {
            soldDate = new Date(parseInt(dateMatch[1], 10), parseInt(dateMatch[2], 10) - 1, parseInt(dateMatch[3], 10));
          } else {
            dateMatch = dateStr.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
            if (dateMatch) {
              soldDate = new Date(parseInt(dateMatch[3], 10), parseInt(dateMatch[1], 10) - 1, parseInt(dateMatch[2], 10));
            } else {
              soldDate = null;
            }
          }
        }
      }
      return {
        address,
        price,
        soldDate,
        beds,
        baths,
        sqft,
        yearBuilt,
        source: source || "unknown"
      };
    } catch (error) {
      return null;
    }
  }
  // Batch LLM parsing for multiple problematic lines in one request
  async batchParsePropertyDataWithLLM(propertyLines) {
    const results = {};
    if (propertyLines.length === 0) return results;
    try {
      const { vertexGenerate: vertexGenerate3 } = await Promise.resolve().then(() => (init_vertex_freeform(), vertex_freeform_exports));
      const { serviceAccount, projectId, location, model } = this.getVertexConfig();
      const header = `Parse each of the following real-estate comp lines into JSON. Return ONLY a JSON array (no prose). Each element MUST include the provided id and these fields: address, price (number), soldDate (YYYY-MM-DD or INVALID), beds (number), baths (number), sqft (number), yearBuilt (number), source (string).`;
      const items = propertyLines.map(({ id, line }) => `${id}) ${line}`).join("\n");
      const prompt = `${header}

LINES:
${items}`;
      const responseSchema = {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            id: { type: "NUMBER" },
            address: { type: "STRING" },
            price: { type: "NUMBER" },
            soldDate: { type: "STRING" },
            beds: { type: "NUMBER" },
            baths: { type: "NUMBER" },
            sqft: { type: "NUMBER" },
            yearBuilt: { type: "NUMBER" },
            source: { type: "STRING" }
          }
        }
      };
      const text = await vertexGenerate3({
        sa: serviceAccount,
        projectId,
        location,
        model,
        prompt,
        grounded: false,
        json: true,
        timeoutMs: 6e5,
        responseSchema
      });
      const extractJsonBlock = (t) => {
        if (!t) return null;
        const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
        if (fenced && fenced[1]) return fenced[1].trim();
        const start = t.indexOf("[");
        const end = t.lastIndexOf("]");
        if (start !== -1 && end !== -1 && end > start) return t.slice(start, end + 1);
        return null;
      };
      let arr = null;
      try {
        arr = JSON.parse(text);
      } catch {
        const block = extractJsonBlock(text);
        if (block) {
          try {
            arr = JSON.parse(block);
          } catch {
            arr = null;
          }
        }
      }
      if (!Array.isArray(arr)) return results;
      for (const item of arr) {
        if (!item || typeof item !== "object") continue;
        const id = Number(item.id);
        if (!Number.isFinite(id)) continue;
        const soldDateStr = String(item.soldDate || "").trim();
        let soldDate = null;
        if (soldDateStr && soldDateStr.toUpperCase() !== "INVALID") {
          let d = new Date(soldDateStr);
          if (!isNaN(d.getTime())) soldDate = d;
          else {
            let m = soldDateStr.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
            if (m) soldDate = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
            else {
              m = soldDateStr.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
              if (m) soldDate = new Date(parseInt(m[3], 10), parseInt(m[1], 10) - 1, parseInt(m[2], 10));
            }
          }
        }
        results[id] = {
          address: item.address || void 0,
          price: Number.isFinite(Number(item.price)) ? Number(item.price) : void 0,
          soldDate,
          beds: Number.isFinite(Number(item.beds)) ? Number(item.beds) : void 0,
          baths: Number.isFinite(Number(item.baths)) ? Number(item.baths) : void 0,
          sqft: Number.isFinite(Number(item.sqft)) ? Number(item.sqft) : void 0,
          yearBuilt: Number.isFinite(Number(item.yearBuilt)) ? Number(item.yearBuilt) : void 0,
          source: item.source || void 0
        };
      }
      return results;
    } catch (err) {
      return results;
    }
  }
  async parseVertexResponse(text, subjectLat, subjectLon, subjectDetails) {
    const lines = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    const comps = [];
    const useLazyParse = String(process.env.LAZY_PARSE || "true").toLowerCase() !== "false";
    const cheapParse = (parts) => {
      if (parts.length < 7) return null;
      const [addrOld, priceStr, dateStr, bedsStr, bathsStr, sqftStr, ybStr, url] = parts;
      if (!addrOld) return null;
      const address = addrOld.trim();
      const price = parseInt(String(priceStr).replace(/[^\d]/g, ""), 10);
      const beds = parseFloat(String(bedsStr).replace(/[^\d.]/g, ""));
      const baths = parseFloat(String(bathsStr).replace(/[^\d.]/g, "").replace(/½/g, ".5"));
      const sqft = parseInt(String(sqftStr).replace(/[^\d]/g, ""), 10);
      const yearBuilt = parseInt(String(ybStr).replace(/[^\d]/g, ""), 10);
      let soldDate = null;
      const ds = (dateStr || "").trim();
      if (ds) {
        let d = new Date(ds);
        if (!isNaN(d.getTime())) soldDate = d;
        else {
          let m = ds.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
          if (m) {
            soldDate = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
          } else {
            m = ds.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
            if (m) soldDate = new Date(parseInt(m[3], 10), parseInt(m[1], 10) - 1, parseInt(m[2], 10));
          }
        }
      }
      const hasAddress = !!address;
      const hasPrice = Number.isFinite(price) && price > 0;
      const hasDate = soldDate != null && !isNaN(soldDate.getTime());
      const hasSqft = Number.isFinite(sqft) && sqft > 0;
      const hasYear = Number.isFinite(yearBuilt) && yearBuilt >= 1900 && yearBuilt <= (/* @__PURE__ */ new Date()).getFullYear();
      const hasBeds = Number.isFinite(beds) && beds > 0;
      const hasBaths = Number.isFinite(baths) && baths > 0;
      if (!hasAddress || !hasPrice || !hasDate) return null;
      return {
        address,
        price,
        soldDate,
        beds: hasBeds ? beds : NaN,
        baths: hasBaths ? baths : NaN,
        sqft: hasSqft ? sqft : NaN,
        yearBuilt: hasYear ? yearBuilt : NaN,
        source: (url || "").trim() || "unknown"
      };
    };
    const lineParts = [];
    const validLineIndex = [];
    const initialParsed = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const parts = line.split("|").map((s) => s.trim());
      lineParts[i] = parts;
      if (parts.length < 7) {
        initialParsed[i] = null;
        continue;
      }
      const [addrOld] = parts;
      if (!addrOld || /^(address|123\s+main\s+st|example)/i.test(addrOld)) {
        initialParsed[i] = null;
        continue;
      }
      validLineIndex.push(i);
      this.rawCompsFound++;
      initialParsed[i] = useLazyParse ? cheapParse(parts) : null;
    }
    const badEntries = [];
    for (const idx of validLineIndex) {
      if (!initialParsed[idx]) {
        badEntries.push({ id: idx, line: lines[idx] });
      }
    }
    const batchSize = Math.max(1, parseInt(String(process.env.LLM_BATCH_SIZE || "12"), 10));
    const batchedParsed = {};
    for (let i = 0; i < badEntries.length; i += batchSize) {
      const slice = badEntries.slice(i, i + batchSize);
      const mapped = await this.batchParsePropertyDataWithLLM(slice);
      Object.assign(batchedParsed, mapped);
      await new Promise((r) => setTimeout(r, 150));
    }
    for (const idx of validLineIndex) {
      const parts = lineParts[idx];
      const line = lines[idx];
      const [addrOld, priceStr, dateStr, bedsStr, bathsStr, sqftStr, ybStr, url] = parts;
      let parsedData = initialParsed[idx] || batchedParsed[idx] || null;
      if (!parsedData) {
        parsedData = await this.parsePropertyDataWithLLM(line);
      }
      let address = parsedData?.address;
      let price = parsedData?.price;
      let soldDate = parsedData?.soldDate ?? null;
      let beds = parsedData?.beds;
      let baths = parsedData?.baths;
      let sqft = parsedData?.sqft;
      let yearBuilt = parsedData?.yearBuilt;
      let source = parsedData?.source;
      const parseIntSafe = (s) => {
        const n = parseInt(String(s).replace(/[^\d]/g, ""), 10);
        return Number.isFinite(n) ? n : NaN;
      };
      const parseFloatSafe = (s) => {
        const normalized = String(s).replace(/½/g, ".5").replace(/¼/g, ".25").replace(/¾/g, ".75");
        const n = parseFloat(normalized.replace(/[^\d.]/g, ""));
        return Number.isFinite(n) ? n : NaN;
      };
      const parseDateSafe = (s) => {
        if (!s) return null;
        let d = new Date(s);
        if (!isNaN(d.getTime())) return d;
        let m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
        if (m) return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
        m = s.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
        if (m) return new Date(parseInt(m[3], 10), parseInt(m[1], 10) - 1, parseInt(m[2], 10));
        return null;
      };
      if (!address) address = addrOld;
      if (!price || !Number.isFinite(price)) price = parseIntSafe(priceStr);
      if (!soldDate) soldDate = parseDateSafe(dateStr);
      if (!beds || !Number.isFinite(beds)) beds = parseIntSafe(bedsStr);
      if (!baths || !Number.isFinite(baths)) baths = parseFloatSafe(bathsStr);
      if (!sqft || !Number.isFinite(sqft)) sqft = parseIntSafe(sqftStr);
      if (!yearBuilt || !Number.isFinite(yearBuilt)) yearBuilt = parseIntSafe(ybStr);
      if (!source || source === "unknown") source = url || "unknown";
      if (!address) {
        continue;
      }
      if (!Number.isFinite(price) || price <= 0) {
        continue;
      }
      if (!Number.isFinite(sqft) || sqft <= 0) {
        continue;
      }
      if (sqft < 500 || sqft > 1e4) {
        continue;
      }
      if (!Number.isFinite(beds) || beds < 1 || beds > 10) {
        continue;
      }
      if (!Number.isFinite(baths) || baths < 1 || baths > 10) {
        continue;
      }
      if (Number.isFinite(yearBuilt) && (yearBuilt < 1900 || yearBuilt > (/* @__PURE__ */ new Date()).getFullYear())) {
        continue;
      }
      let ageInMonths = Infinity;
      if (soldDate) {
        const today = /* @__PURE__ */ new Date();
        const futureBuffer = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1e3);
        if (soldDate > futureBuffer) {
          continue;
        }
        ageInMonths = Math.floor((today.getTime() - soldDate.getTime()) / (1e3 * 60 * 60 * 24 * 30.44));
      }
      if (subjectDetails) {
        if (Number.isFinite(beds)) {
          const bedroomDiff = Math.abs(beds - subjectDetails.beds);
          if (bedroomDiff > 1) {
            continue;
          } else {
          }
        } else {
        }
        if (!Number.isFinite(baths)) {
        } else if (subjectDetails.baths <= 2) {
          if (baths > 2) {
          }
        } else {
          const bathDiff = Math.abs(baths - subjectDetails.baths);
          if (bathDiff > 1.5) {
            continue;
          }
        }
        const sqftVariance = Math.abs(sqft - subjectDetails.sqft) / subjectDetails.sqft;
        if (sqftVariance > 0.2) {
          continue;
        }
        if (Number.isFinite(yearBuilt)) {
          const ageGroup = this.getAgeGroup(subjectDetails.yearBuilt);
          const compAgeGroup = this.getAgeGroup(yearBuilt);
          if (!this.isAdjacentAgeGroup(ageGroup, compAgeGroup)) {
            continue;
          }
        } else {
        }
      }
      let distance = NaN;
      if (subjectDetails) {
        const sizeVariance = Math.abs(sqft - subjectDetails.sqft) / subjectDetails.sqft;
        const MAX_SIZE_VARIANCE = 0.2;
        if (sizeVariance > MAX_SIZE_VARIANCE) {
          continue;
        }
      }
      const IDEAL_TIME_MONTHS = 12;
      const MAX_TIME_MONTHS = 18;
      if (Number.isFinite(ageInMonths) && ageInMonths <= IDEAL_TIME_MONTHS) {
      } else if (Number.isFinite(ageInMonths) && ageInMonths <= MAX_TIME_MONTHS) {
      } else if (!Number.isFinite(ageInMonths)) {
      } else {
        continue;
      }
      const soldDateStr = (() => {
        if (!soldDate) return "";
        const d = new Date(soldDate.getTime() - soldDate.getTimezoneOffset() * 6e4);
        return d.toISOString().split("T")[0];
      })();
      comps.push({
        address,
        price,
        sqft,
        beds: Number.isFinite(beds) ? beds : NaN,
        baths: Number.isFinite(baths) ? baths : NaN,
        yearBuilt: Number.isFinite(yearBuilt) ? yearBuilt : null,
        soldDate: soldDateStr,
        distance,
        source: source || "Vertex AI Grounded Search",
        confidence: Number.isFinite(beds) && Number.isFinite(baths) && Number.isFinite(yearBuilt) ? "high" : "medium",
        condition: "renovated"
        // Assume renovated for ARV analysis
      });
    }
    return comps;
  }
  // Prioritize comps for enrichment: prefer those with more complete fields and newer sold dates
  prioritizeForEnrichment(comps) {
    const score = (c) => {
      let s = 0;
      if (Number.isFinite(c.price)) s += 2;
      if (Number.isFinite(c.sqft)) s += 2;
      if (Number.isFinite(c.beds)) s += 1;
      if (Number.isFinite(c.baths)) s += 1;
      if (c.yearBuilt != null) s += 1;
      if (c.soldDate) s += 1;
      return s;
    };
    const dateValue = (c) => {
      const d = c.soldDate ? new Date(c.soldDate) : null;
      return d && !isNaN(d.getTime()) ? d.getTime() : 0;
    };
    return [...comps].sort((a, b) => score(b) - score(a) || dateValue(b) - dateValue(a));
  }
  // Geocode surviving comps at the end and filter by distance limits
  async geocodeAndFilterDistance(comps, subjectLat, subjectLon, idealMiles = 1, maxMiles = 2) {
    const out = [];
    const GEOCODE_CONCURRENCY = parseInt(process.env.GEOCODE_CONCURRENCY || "6", 10);
    let index = 0;
    let active = 0;
    await new Promise((resolve) => {
      const next = () => {
        if (index >= comps.length && active === 0) return resolve();
        while (active < GEOCODE_CONCURRENCY && index < comps.length) {
          const c = comps[index++];
          active++;
          (async () => {
            let dist = await this.calculateDistance(c.address, subjectLat, subjectLon, 7e3);
            if (!Number.isFinite(dist)) {
              out.push({ ...c, distance: NaN });
              return;
            }
            if (dist > maxMiles) {
              return;
            }
            if (dist > idealMiles) {
            }
            out.push({ ...c, distance: dist });
          })().finally(() => {
            active--;
            next();
          });
        }
      };
      next();
    });
    return out;
  }
  getAgeGroup(yearBuilt) {
    if (yearBuilt >= 2020) return "2020+";
    if (yearBuilt >= 2016) return "2016-2019";
    if (yearBuilt >= 2010) return "2010-2015";
    if (yearBuilt >= 2e3) return "2000-2009";
    if (yearBuilt >= 1980) return "1980-1999";
    if (yearBuilt >= 1960) return "1960-1979";
    if (yearBuilt >= 1940) return "1940-1959";
    return "Pre-1940";
  }
  isAdjacentAgeGroup(group1, group2) {
    const groups = ["Pre-1940", "1940-1959", "1960-1979", "1980-1999", "2000-2009", "2010-2015", "2016-2019", "2020+"];
    const index1 = groups.indexOf(group1);
    const index2 = groups.indexOf(group2);
    return Math.abs(index1 - index2) <= 1;
  }
  deduplicateComparables(comps) {
    const seen = /* @__PURE__ */ new Set();
    const deduplicated = [];
    for (const comp of comps) {
      const normalizedAddress = comp.address.toLowerCase().trim().replace(/\s+/g, " ");
      if (!seen.has(normalizedAddress)) {
        seen.add(normalizedAddress);
        deduplicated.push(comp);
      } else {
        const existing = deduplicated.find((d) => d.address.toLowerCase().trim().replace(/\s+/g, " ") === normalizedAddress);
        if (existing) {
        }
      }
    }
    return deduplicated;
  }
  filterByPPSFVariance(comps) {
    if (comps.length < 3) return comps;
    const valid = comps.filter((c) => Number.isFinite(c.price) && Number.isFinite(c.sqft));
    const missing = comps.filter((c) => !Number.isFinite(c.price) || !Number.isFinite(c.sqft));
    if (valid.length < 3) return comps;
    const withPpsf = valid.map((c) => ({ ...c, ppsf: c.price / c.sqft }));
    const ppsfValues = withPpsf.map((c) => c.ppsf).sort((a, b) => a - b);
    const median = ppsfValues[Math.floor(ppsfValues.length / 2)];
    const kept = withPpsf.filter((c) => {
      const variance = Math.abs(c.ppsf - median) / median;
      if (variance > 0.25) {
        return false;
      }
      return true;
    }).map(({ ppsf, ...rest }) => rest);
    const result = [...kept, ...missing];
    return result;
  }
  async enrichAndRevalidate(comps, subjectDetails) {
    const enriched = [];
    for (const comp of comps) {
      let updated = { ...comp };
      const needsEnrich = !Number.isFinite(updated.beds) || !Number.isFinite(updated.baths) || updated.yearBuilt == null;
      if (needsEnrich) {
        try {
          const details = await fetchPropertyDetailsViaVertex(updated.address);
          if (details) {
            if (!Number.isFinite(updated.beds) && details.beds != null) updated.beds = details.beds;
            if (!Number.isFinite(updated.baths) && details.baths != null) updated.baths = details.baths;
            if (updated.yearBuilt == null && details.yearBuilt != null) updated.yearBuilt = details.yearBuilt;
            if (!Number.isFinite(updated.sqft) && details.sqft != null) updated.sqft = details.sqft;
          }
        } catch {
        }
      }
      const hasAll = updated.address && Number.isFinite(updated.price) && typeof updated.soldDate === "string" && updated.soldDate.length >= 8 && Number.isFinite(updated.sqft) && Number.isFinite(updated.beds) && Number.isFinite(updated.baths) && updated.yearBuilt != null;
      if (!hasAll) continue;
      if (!Number.isFinite(updated.price) || updated.price <= 0) continue;
      if (Number.isFinite(updated.sqft) && (updated.sqft < 500 || updated.sqft > 1e4)) continue;
      if (Number.isFinite(updated.beds) && (updated.beds < 1 || updated.beds > 10)) continue;
      if (Number.isFinite(updated.baths) && (updated.baths < 1 || updated.baths > 10)) continue;
      if (subjectDetails) {
        if (Number.isFinite(updated.beds)) {
          const bedDiff = Math.abs(updated.beds - subjectDetails.beds);
          if (bedDiff > 1) continue;
        }
        if (Number.isFinite(updated.baths)) {
          const bathDiff = Math.abs(updated.baths - subjectDetails.baths);
          if (subjectDetails.baths > 2 && bathDiff > 1.5) continue;
        }
        if (Number.isFinite(updated.sqft)) {
          const variance = Math.abs(updated.sqft - subjectDetails.sqft) / subjectDetails.sqft;
          if (variance > 0.2) continue;
        }
        if (Number.isFinite(updated.yearBuilt)) {
          const ageGroup = this.getAgeGroup(subjectDetails.yearBuilt);
          const compAge = this.getAgeGroup(updated.yearBuilt);
          if (!this.isAdjacentAgeGroup(ageGroup, compAge)) continue;
        }
      }
      updated.confidence = "high";
      enriched.push(updated);
    }
    return enriched;
  }
  async getServiceAccountToken(sa, scope) {
    const iat = Math.floor(Date.now() / 1e3);
    const exp = iat + 3600;
    const header = { alg: "RS256", typ: "JWT" };
    const claims = { iss: sa.client_email, scope, aud: sa.token_uri, exp, iat };
    const base64url = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
    const unsigned = `${base64url(header)}.${base64url(claims)}`;
    const sign = crypto2.createSign("RSA-SHA256");
    sign.update(unsigned);
    const signature = sign.sign(sa.private_key).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
    const assertion = `${unsigned}.${signature}`;
    const body = new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion });
    const resp = await this.httpsPostForm(sa.token_uri, body.toString(), { "Content-Type": "application/x-www-form-urlencoded" }, 2e4);
    if (!resp?.access_token) throw new Error("sa-token-failed");
    return resp.access_token;
  }
  async httpsPostForm(url, body, headers, timeoutMs) {
    return await new Promise((resolve, reject) => {
      const u = new URL(url);
      const req = https3.request({ method: "POST", hostname: u.hostname, path: u.pathname + u.search, headers: { ...headers, "Content-Length": Buffer.byteLength(body).toString() } }, (res) => {
        let data = "";
        res.on("data", (chunk) => data += chunk);
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve(null);
          }
        });
      });
      req.on("error", reject);
      req.write(body);
      req.end();
    });
  }
  async calculateDistance(address, subjectLat, subjectLon, timeoutMs = 3e3) {
    try {
      const geocoded = await this.geocodeWithTimeout(address, timeoutMs);
      if (!geocoded) throw new Error("geocode-timeout");
      const lat1 = subjectLat * Math.PI / 180;
      const lat2 = geocoded.lat * Math.PI / 180;
      const deltaLat = (geocoded.lat - subjectLat) * Math.PI / 180;
      const deltaLon = (geocoded.lon - subjectLon) * Math.PI / 180;
      const a = Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) * Math.sin(deltaLon / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      return 3959 * c;
    } catch {
      return NaN;
    }
  }
  async geocodeWithTimeout(address, timeoutMs) {
    if (this.geocodeCache.has(address)) {
      return this.geocodeCache.get(address);
    }
    return new Promise((resolve) => {
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${this.googleMapsApiKey}`;
      const req = https3.get(url, (res) => {
        let data = "";
        res.on("data", (chunk) => data += chunk);
        res.on("end", () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.results?.[0]?.geometry?.location) {
              const coords = { lat: parsed.results[0].geometry.location.lat, lon: parsed.results[0].geometry.location.lng };
              this.geocodeCache.set(address, coords);
              resolve(coords);
            } else {
              resolve(null);
            }
          } catch {
            resolve(null);
          }
        });
      });
      req.on("error", () => resolve(null));
    });
  }
};
async function testFindComparables() {
  const address = process.env.ADDRESS;
  if (!address) {
    console.error("\u274C ADDRESS environment variable is required");
    process.exit(1);
  }
  const service = new VertexComparableSearchService();
  const coords = await service["geocodeWithTimeout"](address, 5e3);
  if (coords) {
  }
  const result = await service.findComparables(address);
  if (result.success && result.comparables.length > 0) {
    result.comparables.forEach((comp, i) => {
    });
  } else {
    if (result.error) {
    }
  }
}
if (import.meta.url === `file://${process.argv[1]}`) {
  testFindComparables().catch((err) => {
    console.error("\u274C Error:", err.message);
    process.exit(1);
  });
}

// server/step4-arv-calculation.ts
var ARVCalculationService = class {
  /**
   * Calculate ARV using zero-intercept linear regression (y = mx)
   * This finds the best-fit line through the origin using comparable sales data
   */
  calculateARV(comparables, subjectSqft, subjectBaths) {
    if (comparables.length === 0) {
      return {
        arv: 0,
        slope: 0,
        r2: 0,
        dataPoints: 0,
        confidence: "low",
        method: "no-data"
      };
    }
    const filteredComparables = this.detectAndFilterOutliers(comparables, subjectSqft);
    if (filteredComparables.length === 0) {
    }
    const subjectBathsNormalized = Number.isFinite(subjectBaths) ? Number(subjectBaths) : null;
    const finalComparables = filteredComparables.length > 0 ? filteredComparables : comparables;
    let dataPoints;
    const needsBathAdjustments = subjectBathsNormalized != null && finalComparables.some((comp) => Number.isFinite(comp.baths) && comp.baths > subjectBathsNormalized);
    if (needsBathAdjustments) {
      const bathPremium = this.estimateSecondBathPremium(subjectSqft, finalComparables);
      const adjustedComparables = finalComparables.map((comp) => {
        const compBaths = Number(comp.baths);
        if (Number.isFinite(compBaths) && subjectBathsNormalized != null && compBaths > subjectBathsNormalized) {
          const adjustedPrice = this.applyBathPenaltyToIndication(subjectSqft, subjectBathsNormalized, comp, bathPremium);
          return {
            ...comp,
            price: adjustedPrice,
            originalPrice: comp.price,
            bathroomAdjusted: true
          };
        }
        return comp;
      });
      dataPoints = adjustedComparables.map((comp) => ({
        x: comp.sqft,
        y: comp.price,
        address: comp.address,
        originalPrice: comp.originalPrice || comp.price,
        bathroomAdjusted: comp.bathroomAdjusted || false
      }));
    } else {
      dataPoints = finalComparables.map((comp) => ({
        x: comp.sqft,
        y: comp.price,
        address: comp.address
      }));
    }
    dataPoints.forEach((point) => {
    });
    const arvResult = this.calculateARVFromComps(dataPoints, subjectSqft);
    return arvResult;
  }
  /**
   * Calculate ARV directly from comparable data
   */
  calculateARVFromComps(dataPoints, subjectSqft) {
    const n = dataPoints.length;
    if (n === 0) {
      return {
        arv: 0,
        method: "No comparables",
        dataPoints: 0,
        confidence: "low"
      };
    }
    const ppsfData = dataPoints.map((point) => ({
      address: point.address,
      sqft: point.x,
      price: point.y,
      ppsf: point.y / point.x
    }));
    ppsfData.forEach((comp) => {
    });
    const ppsfValues = ppsfData.map((comp) => comp.ppsf);
    const meanPpsf = ppsfValues.reduce((sum, ppsf) => sum + ppsf, 0) / n;
    const medianPpsf = this.calculatePercentile(ppsfValues.sort((a, b) => a - b), 50);
    const arv = Math.round(medianPpsf * subjectSqft);
    let confidence;
    if (n >= 4) {
      confidence = "high";
    } else if (n >= 3) {
      confidence = "medium";
    } else {
      confidence = "low";
    }
    return {
      arv,
      method: `Median PPSF (${medianPpsf.toFixed(2)}/sqft)`,
      dataPoints: n,
      confidence
    };
  }
  /**
   * Zero-intercept linear regression: y = mx
   * Minimizes sum of squared residuals: Σ(y - mx)²
   */
  zeroInterceptLinearRegression(dataPoints) {
    const n = dataPoints.length;
    if (n === 0) {
      return { slope: 0, r2: 0 };
    }
    const sumXY = dataPoints.reduce((sum, point) => sum + point.x * point.y, 0);
    const sumX2 = dataPoints.reduce((sum, point) => sum + point.x * point.x, 0);
    const slope = sumXY / sumX2;
    const sumY = dataPoints.reduce((sum, point) => sum + point.y, 0);
    const meanY = sumY / n;
    const totalSumSquares = dataPoints.reduce((sum, point) => sum + Math.pow(point.y - meanY, 2), 0);
    const residualSumSquares = dataPoints.reduce((sum, point) => {
      const predicted = slope * point.x;
      return sum + Math.pow(point.y - predicted, 2);
    }, 0);
    const r2 = 1 - residualSumSquares / totalSumSquares;
    return { slope, r2 };
  }
  /**
   * Full linear regression (with intercept): y = mx + b
   */
  fullLinearRegression(dataPoints) {
    const n = dataPoints.length;
    if (n === 0) {
      return { slope: 0, intercept: 0, r2: 0 };
    }
    const meanX = dataPoints.reduce((sum, point) => sum + point.x, 0) / n;
    const meanY = dataPoints.reduce((sum, point) => sum + point.y, 0) / n;
    const numerator = dataPoints.reduce((sum, point) => sum + (point.x - meanX) * (point.y - meanY), 0);
    const denominator = dataPoints.reduce((sum, point) => sum + Math.pow(point.x - meanX, 2), 0);
    const slope = denominator === 0 ? 0 : numerator / denominator;
    const intercept = meanY - slope * meanX;
    const totalSumSquares = dataPoints.reduce((sum, point) => sum + Math.pow(point.y - meanY, 2), 0);
    const residualSumSquares = dataPoints.reduce((sum, point) => {
      const predicted = slope * point.x + intercept;
      return sum + Math.pow(point.y - predicted, 2);
    }, 0);
    const r2 = totalSumSquares === 0 ? 0 : 1 - residualSumSquares / totalSumSquares;
    return { slope, intercept, r2 };
  }
  /**
   * Alternative ARV calculation using weighted regression
   * Weights comps by inverse distance (closer comps have more influence)
   */
  calculateWeightedARV(comparables, subjectSqft) {
    if (comparables.length === 0) {
      return {
        arv: 0,
        slope: 0,
        r2: 0,
        dataPoints: 0,
        confidence: "low",
        method: "weighted-no-data"
      };
    }
    const dataPoints = comparables.map((comp) => ({
      x: comp.sqft,
      y: comp.price,
      weight: 1 / (comp.distance + 0.1),
      // +0.1 to avoid division by zero
      address: comp.address
    }));
    dataPoints.forEach((point) => {
    });
    const regression = this.weightedZeroInterceptLinearRegression(dataPoints);
    const arv = Math.round(regression.slope * subjectSqft);
    let confidence;
    if (dataPoints.length >= 4 && regression.r2 >= 0.8) {
      confidence = "high";
    } else if (dataPoints.length >= 3 && regression.r2 >= 0.6) {
      confidence = "medium";
    } else {
      confidence = "low";
    }
    return {
      arv,
      slope: regression.slope,
      r2: regression.r2,
      dataPoints: dataPoints.length,
      confidence,
      method: "weighted-regression"
    };
  }
  /**
   * Weighted zero-intercept linear regression
   */
  weightedZeroInterceptLinearRegression(dataPoints) {
    const n = dataPoints.length;
    if (n === 0) {
      return { slope: 0, r2: 0 };
    }
    const sumWXY = dataPoints.reduce((sum, point) => sum + point.weight * point.x * point.y, 0);
    const sumWX2 = dataPoints.reduce((sum, point) => sum + point.weight * point.x * point.x, 0);
    const slope = sumWXY / sumWX2;
    const sumWY = dataPoints.reduce((sum, point) => sum + point.weight * point.y, 0);
    const sumW = dataPoints.reduce((sum, point) => sum + point.weight, 0);
    const weightedMeanY = sumWY / sumW;
    const weightedTotalSumSquares = dataPoints.reduce((sum, point) => sum + point.weight * Math.pow(point.y - weightedMeanY, 2), 0);
    const weightedResidualSumSquares = dataPoints.reduce((sum, point) => {
      const predicted = slope * point.x;
      return sum + point.weight * Math.pow(point.y - predicted, 2);
    }, 0);
    const r2 = 1 - weightedResidualSumSquares / weightedTotalSumSquares;
    return { slope, r2 };
  }
  /**
   * Enhanced Outlier Detection using Ensemble approach with sample-size modes
   */
  detectAndFilterOutliers(comparables, subjectSqft) {
    if (comparables.length < 3) {
      return comparables;
    }
    const glaFilteredComps = this.applyGLABucketing(comparables, subjectSqft);
    if (glaFilteredComps.length === 0) {
      return comparables;
    }
    if (glaFilteredComps.length < 3) {
      return glaFilteredComps;
    }
    const filteredComps = this.sequentialGapOutlierDetection(glaFilteredComps);
    if (filteredComps.length < 3) {
      return this.applyComplexEscalation(comparables, subjectSqft, 2);
    }
    return filteredComps;
  }
  /**
   * Sequential Gap Outlier Detection
   * 1. Sort both price and PPSF arrays from highest to lowest
   * 2. Remove single high anomalies at the top (if gap >7.5%)
   * 3. Find first big gap (>7.5%) and remove everything below it
   * 4. Only flag properties that fail BOTH price and PPSF tests
   */
  sequentialGapOutlierDetection(comparables, gapThreshold = 0.075) {
    const sortedByPrice = [...comparables].sort((a, b) => b.price - a.price);
    const sortedByPpsf = [...comparables].sort((a, b) => b.price / b.sqft - a.price / a.sqft);
    const priceFailures = /* @__PURE__ */ new Set();
    let priceGapFound = false;
    if (sortedByPrice.length >= 3) {
      const highest = sortedByPrice[0];
      const second = sortedByPrice[1];
      const gap = highest.price - second.price;
      const gapPercentage = gap / highest.price;
      if (gapPercentage > gapThreshold) {
        priceFailures.add(highest.address);
      }
    }
    const startIndex = priceFailures.has(sortedByPrice[0].address) ? 2 : 1;
    for (let i = startIndex; i < sortedByPrice.length; i++) {
      const higher = sortedByPrice[i - 1];
      const lower = sortedByPrice[i];
      if (priceFailures.has(higher.address)) continue;
      const gap = higher.price - lower.price;
      const gapPercentage = gap / higher.price;
      if (!priceGapFound && gapPercentage > gapThreshold) {
        priceGapFound = true;
        for (let j = i; j < sortedByPrice.length; j++) {
          priceFailures.add(sortedByPrice[j].address);
        }
        break;
      }
    }
    const ppsfFailures = /* @__PURE__ */ new Set();
    let ppsfGapFound = false;
    if (sortedByPpsf.length >= 3) {
      const highest = sortedByPpsf[0];
      const second = sortedByPpsf[1];
      const highestPpsf = highest.price / highest.sqft;
      const secondPpsf = second.price / second.sqft;
      const gap = highestPpsf - secondPpsf;
      const gapPercentage = gap / highestPpsf;
      if (gapPercentage > gapThreshold) {
        ppsfFailures.add(highest.address);
      }
    }
    const ppsfStartIndex = ppsfFailures.has(sortedByPpsf[0].address) ? 2 : 1;
    for (let i = ppsfStartIndex; i < sortedByPpsf.length; i++) {
      const higher = sortedByPpsf[i - 1];
      const lower = sortedByPpsf[i];
      if (ppsfFailures.has(higher.address)) continue;
      const higherPpsf = higher.price / higher.sqft;
      const lowerPpsf = lower.price / lower.sqft;
      const gap = higherPpsf - lowerPpsf;
      const gapPercentage = gap / higherPpsf;
      if (!ppsfGapFound && gapPercentage > gapThreshold) {
        ppsfGapFound = true;
        for (let j = i; j < sortedByPpsf.length; j++) {
          ppsfFailures.add(sortedByPpsf[j].address);
        }
        break;
      }
    }
    const outliers = [];
    const kept = [];
    comparables.forEach((comp) => {
      const failsPrice = priceFailures.has(comp.address);
      const failsPpsf = ppsfFailures.has(comp.address);
      const isOutlier = failsPrice && failsPpsf;
      if (isOutlier) {
        outliers.push(comp);
      } else {
        kept.push(comp);
      }
    });
    return kept;
  }
  // OLD OUTLIER DETECTION METHODS ARCHIVED
  // Previous MAD-based and median-ratio methods moved to:
  // /archive/legacy/server/outlier-detection-old-methods.ts
  /**
   * Complex escalation process with multiple steps
   * This implements the full escalation method: Timeline → GLA → Bathroom → Distance → Municipal
   */
  applyComplexEscalation(originalComparables, subjectSqft, escalationStep = 1) {
    let currentComps = [...originalComparables];
    let stepName = "";
    switch (escalationStep) {
      case 1:
        stepName = "Timeline Expansion (18 months)";
        return this.applyComplexEscalation(originalComparables, subjectSqft, 2);
      case 2:
        stepName = "GLA Bucket Expansion (\xB125%)";
        currentComps = this.applyExpandedGLABucketing(originalComparables, subjectSqft);
        break;
      case 3:
        stepName = "Bathroom Escalation (Allow 2-bath comps)";
        currentComps = this.applyBathroomEscalation(currentComps, subjectSqft);
        break;
      case 4:
        stepName = "Distance Expansion (Same Municipality)";
        return this.applyComplexEscalation(originalComparables, subjectSqft, 5);
      case 5:
        stepName = "Municipal Boundary Expansion (Last Resort)";
        return originalComparables;
      // Return what we have
      default:
        return originalComparables;
    }
    if (currentComps.length >= 3) {
      const reFilteredComps = this.applyCompleteAnalysisPipeline(currentComps, subjectSqft);
      if (reFilteredComps.length >= 3) {
        return reFilteredComps;
      } else {
        return this.applyComplexEscalation(originalComparables, subjectSqft, escalationStep + 1);
      }
    } else {
      return this.applyComplexEscalation(originalComparables, subjectSqft, escalationStep + 1);
    }
  }
  /**
   * Apply complete analysis pipeline (GLA + outlier detection + bathroom analysis)
   */
  applyCompleteAnalysisPipeline(comparables, subjectSqft) {
    const glaFilteredComps = this.applyGLABucketing(comparables, subjectSqft);
    const outlierFilteredComps = this.applyCoreOutlierDetection(glaFilteredComps);
    return outlierFilteredComps;
  }
  /**
   * Bathroom escalation: Allow 2-bath comps with penalty system
   */
  applyBathroomEscalation(originalComparables, subjectSqft) {
    return originalComparables;
  }
  /**
   * Core outlier detection without escalation (to avoid recursion)
   */
  applyCoreOutlierDetection(comparables) {
    if (comparables.length < 3) {
      return comparables;
    }
    return this.sequentialGapOutlierDetection(comparables);
  }
  /**
   * Expanded GLA bucketing for thin-data escalation
   */
  applyExpandedGLABucketing(comparables, subjectSqft) {
    const expandedRange = subjectSqft * 0.25;
    const minSqft = subjectSqft - expandedRange;
    const maxSqft = subjectSqft + expandedRange;
    const filtered = comparables.filter((comp) => {
      const inRange = comp.sqft >= minSqft && comp.sqft <= maxSqft;
      return inRange;
    });
    return filtered;
  }
  /**
   * Calculate percentile value from sorted array
   */
  calculatePercentile(sortedValues, percentile) {
    const index = percentile / 100 * (sortedValues.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    const weight = index % 1;
    if (upper >= sortedValues.length) {
      return sortedValues[sortedValues.length - 1];
    }
    return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
  }
  /**
   * Bathroom adjustment system for 2-bath comparables
   */
  estimateSecondBathPremium(subjectSqft, comps) {
    const bucket = (c) => Math.abs(c.sqft - subjectSqft) <= subjectSqft * 0.1;
    const ones = comps.filter((c) => c.baths === 1 && bucket(c));
    const twos = comps.filter((c) => c.baths >= 2 && bucket(c));
    const pairs = [];
    for (const oneBath of ones) {
      const nearest = twos.reduce((best, twoBath) => {
        const distance = Math.abs(twoBath.sqft - oneBath.sqft);
        const premium = (twoBath.price / twoBath.sqft - oneBath.price / oneBath.sqft) * subjectSqft;
        const val = { distance, premium };
        return !best || distance < best.distance ? val : best;
      }, null);
      if (nearest) {
        pairs.push(nearest.premium);
      }
    }
    let fullPremium = NaN;
    if (pairs.length >= 2) {
      pairs.sort((x, y) => x - y);
      fullPremium = pairs.length % 2 ? pairs[Math.floor(pairs.length / 2)] : (pairs[pairs.length / 2 - 1] + pairs[pairs.length / 2]) / 2;
    }
    if (!Number.isFinite(fullPremium)) {
      fullPremium = subjectSqft < 1e3 ? 1e4 : subjectSqft < 1500 ? 14e3 : 16e3;
    }
    return { full: fullPremium, halfFactor: 0.35 };
  }
  /**
   * Apply bathroom penalty to 2-bath comparable
   */
  applyBathPenaltyToIndication(subjectSqft, subjectBaths, comp, premium) {
    const ppsf = comp.price / comp.sqft;
    let adjustedIndication = ppsf * subjectSqft;
    const deltaFull = Math.max(0, Math.floor(comp.baths) - subjectBaths);
    const deltaHalf = Math.max(0, comp.baths - Math.floor(comp.baths));
    let penalty = premium.full * deltaFull + premium.full * premium.halfFactor * deltaHalf;
    if (deltaFull >= 1) {
      penalty *= 1.15;
    }
    const finalIndication = Math.max(0, adjustedIndication - penalty);
    return finalIndication;
  }
  /**
   * GLA (Gross Living Area) Bucketing
   * Filters comparables by similar size to ensure apples-to-apples PPSF comparisons
   */
  applyGLABucketing(comparables, subjectSqft) {
    let bucketRange;
    if (subjectSqft < 800) {
      bucketRange = {
        min: subjectSqft - 150,
        max: subjectSqft + 150
      };
    } else if (subjectSqft > 3e3) {
      const margin = Math.round(subjectSqft * 0.1);
      bucketRange = {
        min: subjectSqft - margin,
        max: subjectSqft + margin
      };
    } else {
      const margin20 = Math.round(subjectSqft * 0.2);
      const margin25 = Math.round(subjectSqft * 0.25);
      bucketRange = {
        min: subjectSqft - margin20,
        max: subjectSqft + margin20
      };
    }
    const glaFiltered = comparables.filter((comp) => {
      const inBucket = comp.sqft >= bucketRange.min && comp.sqft <= bucketRange.max;
      return inBucket;
    });
    if (glaFiltered.length < 3 && subjectSqft >= 800 && subjectSqft <= 3e3) {
      const margin25 = Math.round(subjectSqft * 0.25);
      bucketRange = {
        min: subjectSqft - margin25,
        max: subjectSqft + margin25
      };
      const expandedFiltered = comparables.filter((comp) => {
        const inBucket = comp.sqft >= bucketRange.min && comp.sqft <= bucketRange.max;
        return inBucket;
      });
      return expandedFiltered;
    }
    return glaFiltered;
  }
};
async function testARVCalculation() {
  const subjectSqftStr = process.env.SUBJECT_SQFT;
  if (!subjectSqftStr) {
    throw new Error("SUBJECT_SQFT environment variable is required");
  }
  const subjectSqft = parseInt(subjectSqftStr);
  const comparablesData = process.env.COMPARABLES_DATA;
  if (!comparablesData) {
    throw new Error("COMPARABLES_DATA environment variable is required");
  }
  let comparables;
  try {
    comparables = JSON.parse(comparablesData);
  } catch (error) {
    throw new Error("Invalid COMPARABLES_DATA JSON format");
  }
  const arvService = new ARVCalculationService();
  const standardResult = arvService.calculateARV(comparables, subjectSqft);
  const weightedResult = arvService.calculateWeightedARV(comparables, subjectSqft);
  return { standardResult, weightedResult };
}
if (import.meta.url === `file://${process.argv[1]}`) {
  testARVCalculation().catch(console.error);
}

// server/utils/propertyDataNormalizer.ts
var PropertyDataNormalizer = class {
  seenProperties = /* @__PURE__ */ new Map();
  conflictLog = [];
  /**
   * Generate a property fingerprint for duplicate detection
   */
  generateFingerprint(property) {
    const key = `${property.address?.toLowerCase().trim()}|${property.price}|${property.sqft}`;
    return key;
  }
  /**
   * Validate individual property fields
   */
  validateProperty(property) {
    const flags = [];
    if (!property.address || property.address.trim().length < 10) {
      flags.push("invalid_address");
    }
    if (!property.price || property.price < 5e4 || property.price > 5e6) {
      flags.push("invalid_price");
    }
    if (!property.sqft || property.sqft < 500 || property.sqft > 1e4) {
      flags.push("invalid_sqft");
    }
    if (!property.beds || property.beds < 1 || property.beds > 10) {
      flags.push("invalid_beds");
    }
    if (!property.baths || property.baths < 1 || property.baths > 8) {
      flags.push("invalid_baths");
    }
    if (property.yearBuilt && (property.yearBuilt < 1800 || property.yearBuilt > (/* @__PURE__ */ new Date()).getFullYear())) {
      flags.push("invalid_year");
    }
    if (property.price && property.sqft) {
      const ppsf = property.price / property.sqft;
      if (ppsf < 50 || ppsf > 1e3) {
        flags.push("invalid_ppsf");
      }
    }
    return {
      isValid: flags.length === 0,
      flags
    };
  }
  /**
   * Determine confidence level based on validation and source
   */
  calculateConfidence(property, validationFlags) {
    if (validationFlags.length === 0) {
      if (property.source?.includes("MLS") || property.source?.includes("verified")) {
        return "high";
      }
      return "medium";
    } else if (validationFlags.length <= 2) {
      return "medium";
    } else {
      return "low";
    }
  }
  /**
   * Resolve conflicts between multiple instances of the same property
   */
  resolveConflicts(address, properties) {
    const conflicts = [];
    const merged = {
      address,
      fingerprint: "",
      confidence: "medium",
      validationFlags: [],
      primarySource: "merged",
      source: "merged"
    };
    const fieldsToCheck = ["price", "sqft", "beds", "baths", "yearBuilt"];
    for (const field of fieldsToCheck) {
      const values = properties.map((p) => p[field]).filter((v) => v != null);
      const uniqueValues = [...new Set(values)];
      if (uniqueValues.length > 1) {
        const sources = properties.map((p) => p.source || "unknown");
        let resolution;
        let reason;
        if (field === "sqft" || field === "price") {
          const valueCounts = values.reduce((acc, val) => {
            acc[val] = (acc[val] || 0) + 1;
            return acc;
          }, {});
          const mostCommon = Object.entries(valueCounts).sort(([, a], [, b]) => Number(b) - Number(a))[0][0];
          resolution = Number(mostCommon);
          reason = `most_common_value (${valueCounts[mostCommon]}/${values.length} instances)`;
        } else {
          resolution = uniqueValues[0];
          reason = "first_valid_value";
        }
        conflicts.push({
          field: String(field),
          values: uniqueValues,
          sources,
          resolution,
          reason
        });
        merged[field] = resolution;
      } else if (uniqueValues.length === 1) {
        merged[field] = uniqueValues[0];
      }
    }
    merged.fingerprint = this.generateFingerprint(merged);
    const validation = this.validateProperty(merged);
    merged.validationFlags = validation.flags;
    merged.confidence = this.calculateConfidence(merged, validation.flags);
    return {
      address,
      conflicts,
      merged
    };
  }
  /**
   * Normalize a single property
   */
  normalizeProperty(property) {
    const validation = this.validateProperty(property);
    const fingerprint = this.generateFingerprint(property);
    const confidence = this.calculateConfidence(property, validation.flags);
    return {
      ...property,
      fingerprint,
      confidence,
      validationFlags: validation.flags,
      primarySource: property.source || "unknown"
    };
  }
  /**
   * Process multiple properties, handling duplicates and conflicts
   */
  processProperties(properties) {
    const addressGroups = /* @__PURE__ */ new Map();
    for (const property of properties) {
      const normalizedAddress = property.address?.toLowerCase().trim();
      if (!normalizedAddress) continue;
      if (!addressGroups.has(normalizedAddress)) {
        addressGroups.set(normalizedAddress, []);
      }
      addressGroups.get(normalizedAddress).push(property);
    }
    const normalized = [];
    const conflicts = [];
    for (const [address, groupProperties] of addressGroups) {
      if (groupProperties.length === 1) {
        const normalizedProp = this.normalizeProperty(groupProperties[0]);
        normalized.push(normalizedProp);
      } else {
        const conflictResolution = this.resolveConflicts(address, groupProperties);
        conflicts.push(conflictResolution);
        normalized.push(conflictResolution.merged);
        if (conflictResolution.conflicts.length > 0) {
          conflictResolution.conflicts.forEach((conflict) => {
          });
        }
      }
    }
    const summary = {
      originalCount: properties.length,
      duplicatesFound: properties.length - addressGroups.size,
      conflictsResolved: conflicts.reduce((sum, c) => sum + c.conflicts.length, 0),
      finalCount: normalized.length,
      highConfidence: normalized.filter((p) => p.confidence === "high").length,
      mediumConfidence: normalized.filter((p) => p.confidence === "medium").length,
      lowConfidence: normalized.filter((p) => p.confidence === "low").length
    };
    return {
      normalized,
      conflicts,
      summary
    };
  }
  /**
   * Get conflict report for debugging
   */
  getConflictReport() {
    return [...this.conflictLog];
  }
  /**
   * Clear internal state
   */
  reset() {
    this.seenProperties.clear();
    this.conflictLog = [];
  }
};

// server/utils/smartDeduplicator.ts
var SmartDeduplicator = class {
  duplicateGroups = /* @__PURE__ */ new Map();
  processedProperties = /* @__PURE__ */ new Set();
  /**
   * Normalize address for comparison
   */
  normalizeAddress(address) {
    return address.toLowerCase().trim().replace(/\s+/g, " ").replace(/[^\w\s]/g, "").replace(/\b(street|st|avenue|ave|road|rd|drive|dr|lane|ln|circle|cir|court|ct|place|pl|way|blvd|boulevard)\b/g, "").trim();
  }
  /**
   * Generate price range bucket (±5%)
   */
  getPriceRange(price) {
    const bucket = Math.round(price / (price * 0.05)) * (price * 0.05);
    return `${Math.round(bucket / 1e3)}k`;
  }
  /**
   * Generate size range bucket (±10%)
   */
  getSizeRange(sqft) {
    const bucket = Math.round(sqft / (sqft * 0.1)) * (sqft * 0.1);
    return `${Math.round(bucket / 100)}h`;
  }
  /**
   * Generate composite deduplication key
   */
  generateKey(property) {
    return {
      normalizedAddress: this.normalizeAddress(property.address),
      priceRange: this.getPriceRange(property.price),
      sizeRange: this.getSizeRange(property.sqft)
    };
  }
  /**
   * Convert key to string for Map usage
   */
  keyToString(key) {
    return `${key.normalizedAddress}|${key.priceRange}|${key.sizeRange}`;
  }
  /**
   * Calculate similarity score between two properties
   */
  calculateSimilarity(prop1, prop2) {
    let score = 0;
    let factors = 0;
    const addr1 = this.normalizeAddress(prop1.address);
    const addr2 = this.normalizeAddress(prop2.address);
    if (addr1 === addr2) {
      score += 40;
    } else if (addr1.includes(addr2) || addr2.includes(addr1)) {
      score += 20;
    }
    factors += 40;
    const priceDiff = Math.abs(prop1.price - prop2.price) / Math.max(prop1.price, prop2.price);
    if (priceDiff <= 0.05) score += 20;
    else if (priceDiff <= 0.1) score += 15;
    else if (priceDiff <= 0.2) score += 10;
    factors += 20;
    const sizeDiff = Math.abs(prop1.sqft - prop2.sqft) / Math.max(prop1.sqft, prop2.sqft);
    if (sizeDiff <= 0.05) score += 15;
    else if (sizeDiff <= 0.1) score += 10;
    else if (sizeDiff <= 0.2) score += 5;
    factors += 15;
    if (prop1.beds === prop2.beds) score += 10;
    if (prop1.baths === prop2.baths) score += 10;
    factors += 20;
    if (prop1.yearBuilt && prop2.yearBuilt) {
      const yearDiff = Math.abs(prop1.yearBuilt - prop2.yearBuilt);
      if (yearDiff <= 2) score += 5;
      else if (yearDiff <= 5) score += 3;
      factors += 5;
    }
    return score / factors * 100;
  }
  /**
   * Merge conflicting property data intelligently
   */
  mergeProperties(properties) {
    const merged = { ...properties[0] };
    const conflicts = [];
    const mergeStrategies = {
      address: "longest",
      // Use the most complete address
      price: "median",
      // Use median price to avoid outliers
      sqft: "mode",
      // Use most common sqft
      beds: "mode",
      baths: "mode",
      yearBuilt: "mode",
      soldDate: "most_recent",
      distance: "minimum",
      // Use closest distance
      source: "best_quality",
      // Prefer MLS over other sources
      confidence: "highest"
    };
    for (const [field, strategy] of Object.entries(mergeStrategies)) {
      const values = properties.map((p) => p[field]).filter((v) => v != null && v !== void 0 && v !== "");
      if (values.length === 0) continue;
      const uniqueValues = [...new Set(values)];
      if (uniqueValues.length === 1) {
        merged[field] = uniqueValues[0];
        continue;
      }
      let resolution;
      let method;
      switch (strategy) {
        case "longest":
          resolution = values.reduce((a, b) => a.length > b.length ? a : b);
          method = "longest_value";
          break;
        case "median":
          const sorted = values.sort((a, b) => a - b);
          resolution = sorted[Math.floor(sorted.length / 2)];
          method = "median_value";
          break;
        case "mode":
          const counts = values.reduce((acc, val) => {
            acc[val] = (acc[val] || 0) + 1;
            return acc;
          }, {});
          resolution = Object.entries(counts).sort(([, a], [, b]) => Number(b) - Number(a))[0][0];
          method = "most_common_value";
          break;
        case "most_recent":
          resolution = values.map((v) => ({ date: new Date(v), value: v })).sort((a, b) => b.date.getTime() - a.date.getTime())[0].value;
          method = "most_recent_date";
          break;
        case "minimum":
          resolution = Math.min(...values);
          method = "minimum_value";
          break;
        case "best_quality":
          const qualityOrder = ["MLS", "verified", "public_records", "estimate"];
          resolution = values.find((v) => qualityOrder.some((q) => v.includes(q))) || values[0];
          method = "quality_preference";
          break;
        case "highest":
          const confidenceOrder = { "high": 3, "medium": 2, "low": 1 };
          resolution = values.sort(
            (a, b) => (confidenceOrder[b] || 0) - (confidenceOrder[a] || 0)
          )[0];
          method = "highest_confidence";
          break;
        default:
          resolution = values[0];
          method = "first_value";
      }
      conflicts.push({
        field,
        values: uniqueValues,
        resolution,
        method
      });
      merged[field] = resolution;
    }
    merged.mergedFrom = properties.length;
    merged.mergeConflicts = conflicts.length;
    merged.searchIds = properties.map((p) => p.searchId).filter(Boolean);
    return merged;
  }
  /**
   * Add property to deduplication pool
   */
  addProperty(property) {
    const key = this.generateKey(property);
    const keyString = this.keyToString(key);
    if (!this.duplicateGroups.has(keyString)) {
      this.duplicateGroups.set(keyString, {
        key,
        properties: [],
        merged: property,
        confidence: "high",
        conflicts: []
      });
    }
    const group = this.duplicateGroups.get(keyString);
    const isDuplicate = group.properties.some(
      (existing) => this.calculateSimilarity(property, existing) > 80
    );
    if (isDuplicate || group.properties.length === 0) {
      group.properties.push(property);
      group.merged = this.mergeProperties(group.properties);
      if (group.properties.length === 1) {
        group.confidence = "high";
      } else if (group.conflicts.length <= 2) {
        group.confidence = "medium";
      } else {
        group.confidence = "low";
      }
    } else {
      const newKeyString = `${keyString}_alt_${group.properties.length}`;
      this.duplicateGroups.set(newKeyString, {
        key: { ...key, normalizedAddress: `${key.normalizedAddress}_alt` },
        properties: [property],
        merged: property,
        confidence: "high",
        conflicts: []
      });
    }
  }
  /**
   * Process multiple properties and return deduplicated results
   */
  deduplicateProperties(properties) {
    this.duplicateGroups.clear();
    this.processedProperties.clear();
    properties.forEach((property) => {
      this.addProperty(property);
    });
    const duplicateGroups = Array.from(this.duplicateGroups.values());
    const deduplicated = duplicateGroups.map((group) => group.merged);
    const summary = {
      originalCount: properties.length,
      duplicatesRemoved: properties.length - deduplicated.length,
      finalCount: deduplicated.length,
      conflictsResolved: duplicateGroups.reduce((sum, group) => sum + group.conflicts.length, 0),
      highConfidenceGroups: duplicateGroups.filter((g) => g.confidence === "high").length,
      mediumConfidenceGroups: duplicateGroups.filter((g) => g.confidence === "medium").length,
      lowConfidenceGroups: duplicateGroups.filter((g) => g.confidence === "low").length
    };
    duplicateGroups.forEach((group) => {
      if (group.properties.length > 1) {
        if (group.conflicts.length > 0) {
          group.conflicts.forEach((conflict) => {
          });
        }
      }
    });
    return {
      deduplicated,
      duplicateGroups,
      summary
    };
  }
  /**
   * Get duplicate groups for analysis
   */
  getDuplicateGroups() {
    return Array.from(this.duplicateGroups.values());
  }
  /**
   * Clear internal state
   */
  reset() {
    this.duplicateGroups.clear();
    this.processedProperties.clear();
  }
};

// server/utils/progressiveSearchStrategy.ts
var ProgressiveSearchStrategy = class {
  cache = /* @__PURE__ */ new Map();
  CACHE_TTL = 15 * 60 * 1e3;
  // 15 minutes
  /**
   * Define search levels with progressive expansion
   */
  getSearchLevels(hasSubdivision) {
    const levels = [
      {
        level: 1,
        name: "Tight Local",
        criteria: {
          radius: 1,
          timeWindow: 12,
          subdivision: hasSubdivision,
          sizeVariance: 15,
          maxResults: 30
        },
        targetComps: 6,
        description: hasSubdivision ? "Same subdivision, 1 mile, 12 months" : "Local area, 1 mile, 12 months"
      },
      {
        level: 2,
        name: "Extended Local",
        criteria: {
          radius: 2,
          timeWindow: 15,
          subdivision: hasSubdivision,
          sizeVariance: 20,
          maxResults: 40
        },
        targetComps: 4,
        description: hasSubdivision ? "Same subdivision, 2 miles, 15 months" : "Local area, 2 miles, 15 months"
      },
      {
        level: 3,
        name: "Broader Market",
        criteria: {
          radius: 3,
          timeWindow: 18,
          subdivision: false,
          // Remove subdivision filter
          sizeVariance: 20,
          maxResults: 50
        },
        targetComps: 3,
        description: "Market area, 3 miles, 18 months, no subdivision filter"
      },
      {
        level: 4,
        name: "Extended Market",
        criteria: {
          radius: 4,
          timeWindow: 24,
          subdivision: false,
          sizeVariance: 25,
          maxResults: 75
        },
        targetComps: 2,
        description: "Extended market, 4 miles, 24 months, relaxed size criteria"
      }
    ];
    return levels;
  }
  /**
   * Generate cache key for search parameters
   */
  generateCacheKey(address, level, subjectDetails) {
    const key = [
      address.toLowerCase().trim(),
      level.level,
      level.criteria.radius,
      level.criteria.timeWindow,
      level.criteria.subdivision ? "sub" : "nosub",
      level.criteria.sizeVariance,
      subjectDetails ? `${subjectDetails.sqft}_${subjectDetails.beds}_${subjectDetails.baths}` : "nosubject"
    ].join("|");
    return key;
  }
  /**
   * Check if we have a valid cached result
   */
  getCachedResult(cacheKey) {
    const cached = this.cache.get(cacheKey);
    if (!cached) return null;
    const isExpired = Date.now() - cached.timestamp > this.CACHE_TTL;
    if (isExpired) {
      this.cache.delete(cacheKey);
      return null;
    }
    return cached.result;
  }
  /**
   * Cache search result
   */
  setCachedResult(cacheKey, result) {
    this.cache.set(cacheKey, {
      result: [...result],
      // Deep copy
      timestamp: Date.now()
    });
  }
  /**
   * Check if we have enough comps for dual ARV analysis (baseline + upgrade)
   */
  checkDualARVRequirements(properties, subjectDetails) {
    if (!subjectDetails) {
      return { sufficient: true, reason: "no subject details for bathroom analysis", baseline: 0, upgrade: 0 };
    }
    const subjectBaths = subjectDetails.baths;
    const epsilon = 1e-9;
    const baselineComps = properties.filter((prop) => {
      const compBaths = parseFloat(prop.baths?.toString() || "NaN");
      return Number.isFinite(compBaths) && compBaths <= subjectBaths + epsilon;
    });
    const upgradeComps = properties.filter((prop) => {
      const compBaths = parseFloat(prop.baths?.toString() || "NaN");
      return Number.isFinite(compBaths) && compBaths >= 2;
    });
    const needsUpgradeAnalysis = subjectBaths < 2;
    const hasEnoughBaseline = baselineComps.length >= 3;
    const hasEnoughUpgrade = upgradeComps.length >= 3;
    if (!needsUpgradeAnalysis) {
      return {
        sufficient: hasEnoughBaseline,
        reason: hasEnoughBaseline ? "sufficient baseline comps" : `need ${3 - baselineComps.length} more baseline comps (\u2264${subjectBaths} baths)`,
        baseline: baselineComps.length,
        upgrade: upgradeComps.length
      };
    } else {
      const sufficient = hasEnoughBaseline && hasEnoughUpgrade;
      let reason = "dual ARV requirements: ";
      if (!hasEnoughBaseline && !hasEnoughUpgrade) {
        reason += `need ${3 - baselineComps.length} more baseline (\u2264${subjectBaths} baths) and ${3 - upgradeComps.length} more upgrade (2+ baths) comps`;
      } else if (!hasEnoughBaseline) {
        reason += `need ${3 - baselineComps.length} more baseline comps (\u2264${subjectBaths} baths)`;
      } else if (!hasEnoughUpgrade) {
        reason += `need ${3 - upgradeComps.length} more upgrade comps (2+ baths)`;
      } else {
        reason = "dual ARV requirements satisfied";
      }
      return {
        sufficient,
        reason,
        baseline: baselineComps.length,
        upgrade: upgradeComps.length
      };
    }
  }
  /**
   * Calculate quality score based on results
   */
  calculateQualityScore(finalProperties, searchHistory) {
    const count = finalProperties.length;
    const stoppedAtLevel = Math.max(...searchHistory.map((s) => s.level.level));
    const avgDistance = finalProperties.reduce((sum, p) => sum + (p.distance || 0), 0) / count;
    const recentComps = finalProperties.filter((p) => {
      if (!p.soldDate) return false;
      const soldDate = new Date(p.soldDate);
      const monthsAgo = (Date.now() - soldDate.getTime()) / (1e3 * 60 * 60 * 24 * 30);
      return monthsAgo <= 12;
    }).length;
    if (count >= 6 && stoppedAtLevel <= 2 && avgDistance <= 1.5 && recentComps >= 4) {
      return "excellent";
    } else if (count >= 4 && stoppedAtLevel <= 3 && avgDistance <= 2.5 && recentComps >= 2) {
      return "good";
    } else if (count >= 3 && avgDistance <= 3.5) {
      return "fair";
    } else {
      return "poor";
    }
  }
  /**
   * Execute search at specific level
   */
  async executeSearchLevel(level, address, subjectDetails, searchService) {
    const startTime = Date.now();
    const cacheKey = this.generateCacheKey(address, level, subjectDetails);
    const cachedResult = this.getCachedResult(cacheKey);
    if (cachedResult) {
      return {
        level,
        properties: cachedResult,
        qualified: cachedResult,
        // Assume cached results are already qualified
        searchTime: Date.now() - startTime,
        success: true,
        cacheHit: true
      };
    }
    try {
      const originalSubdivision = process.env.SUBDIVISION;
      if (level.criteria.subdivision && subjectDetails) {
      } else {
        process.env.SUBDIVISION = "";
      }
      const searchResult = await searchService.findComparables(
        address,
        void 0,
        // propertyType
        level.criteria.maxResults,
        level.criteria.radius,
        level.criteria.timeWindow,
        subjectDetails
      );
      process.env.SUBDIVISION = originalSubdivision;
      const searchTime = Date.now() - startTime;
      const qualified = searchResult.comparables || [];
      this.setCachedResult(cacheKey, qualified);
      return {
        level,
        properties: qualified,
        qualified,
        searchTime,
        success: true,
        cacheHit: false
      };
    } catch (error) {
      return {
        level,
        properties: [],
        qualified: [],
        searchTime: Date.now() - startTime,
        success: false,
        cacheHit: false
      };
    }
  }
  /**
   * Execute progressive search with early termination
   */
  async executeProgressiveSearch(address, subjectDetails, searchService, subdivision) {
    if (subjectDetails) {
    }
    const hasSubdivision = Boolean(subdivision || process.env.SUBDIVISION);
    const searchLevels = this.getSearchLevels(hasSubdivision);
    const searchHistory = [];
    const allProperties = /* @__PURE__ */ new Map();
    let stoppedAtLevel = 0;
    const startTime = Date.now();
    for (const level of searchLevels) {
      const result = await this.executeSearchLevel(level, address, subjectDetails, searchService);
      searchHistory.push(result);
      stoppedAtLevel = level.level;
      if (result.success && result.qualified.length > 0) {
        result.qualified.forEach((prop) => {
          const key = `${prop.address}|${prop.price}|${prop.sqft}`;
          if (!allProperties.has(key)) {
            allProperties.set(key, { ...prop, foundAtLevel: level.level });
          }
        });
        const totalQualified = allProperties.size;
        const hasEnoughForDualARV = this.checkDualARVRequirements(Array.from(allProperties.values()), subjectDetails);
        if (totalQualified >= level.targetComps && hasEnoughForDualARV.sufficient) {
          break;
        } else {
          const reason = hasEnoughForDualARV.sufficient ? `need ${level.targetComps - totalQualified} more general comps` : hasEnoughForDualARV.reason;
        }
      } else {
      }
    }
    const finalProperties = Array.from(allProperties.values());
    const totalTime = Date.now() - startTime;
    const cacheHits = searchHistory.filter((s) => s.cacheHit).length;
    const qualityScore = this.calculateQualityScore(finalProperties, searchHistory);
    searchHistory.forEach((result) => {
      const icon = result.success ? "\u2705" : "\u274C";
      const cache = result.cacheHit ? "\u{1F4BE}" : "\u{1F50D}";
    });
    return {
      finalProperties,
      searchHistory,
      stoppedAtLevel,
      summary: {
        totalSearches: searchHistory.length,
        totalTime,
        cacheHits,
        finalCount: finalProperties.length,
        qualityScore
      }
    };
  }
  /**
   * Clear cache (useful for testing)
   */
  clearCache() {
    this.cache.clear();
  }
  /**
   * Get cache statistics
   */
  getCacheStats() {
    const now = Date.now();
    let oldestEntry = now;
    let totalSize = 0;
    for (const [key, entry] of this.cache) {
      if (entry.timestamp < oldestEntry) {
        oldestEntry = entry.timestamp;
      }
      totalSize += entry.result.length;
    }
    return {
      entries: this.cache.size,
      oldestEntry: now - oldestEntry,
      totalSize
    };
  }
};

// server/utils/distanceValidator.ts
import https4 from "https";
var DistanceValidator = class {
  geocodeCache = /* @__PURE__ */ new Map();
  distanceCache = /* @__PURE__ */ new Map();
  CACHE_TTL = 24 * 60 * 60 * 1e3;
  // 24 hours
  googleMapsApiKey;
  failedAddresses = /* @__PURE__ */ new Set();
  constructor() {
    this.googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY || "";
    if (!this.googleMapsApiKey) {
    }
  }
  /**
   * Normalize address for consistent cache keys
   */
  normalizeAddress(address) {
    return address.toLowerCase().trim().replace(/\s+/g, " ").replace(/[^\w\s,]/g, "");
  }
  /**
   * Estimate coordinates based on address patterns (fallback)
   */
  estimateCoordinates(address) {
    const georgiaPattern = /georgia|ga\s*\d{5}/i;
    const fayettevillePattern = /fayetteville/i;
    if (fayettevillePattern.test(address)) {
      const baseLat = 33.4484;
      const baseLon = -84.4555;
      const offset = 0.02;
      return {
        lat: baseLat + (Math.random() - 0.5) * offset,
        lon: baseLon + (Math.random() - 0.5) * offset,
        confidence: "low",
        source: "estimated",
        timestamp: Date.now()
      };
    } else if (georgiaPattern.test(address)) {
      return {
        lat: 33.76 + (Math.random() - 0.5) * 2,
        // ±1 degree
        lon: -84.39 + (Math.random() - 0.5) * 2,
        confidence: "low",
        source: "estimated",
        timestamp: Date.now()
      };
    }
    return null;
  }
  /**
   * Geocode address using Google Maps API
   */
  async geocodeWithGoogle(address) {
    if (!this.googleMapsApiKey) {
      return this.estimateCoordinates(address);
    }
    return new Promise((resolve) => {
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${this.googleMapsApiKey}`;
      const timeout = setTimeout(() => {
        resolve(this.estimateCoordinates(address));
      }, 5e3);
      https4.get(url, (res) => {
        let body = "";
        res.on("data", (chunk) => body += chunk);
        res.on("end", () => {
          clearTimeout(timeout);
          try {
            const data = JSON.parse(body);
            if (data.status === "OK" && data.results?.[0]) {
              const location = data.results[0].geometry.location;
              const locationType = data.results[0].geometry.location_type;
              let confidence = "medium";
              if (locationType === "ROOFTOP") {
                confidence = "high";
              } else if (locationType === "RANGE_INTERPOLATED") {
                confidence = "medium";
              } else {
                confidence = "low";
              }
              resolve({
                lat: location.lat,
                lon: location.lng,
                confidence,
                source: "google_maps",
                timestamp: Date.now()
              });
            } else {
              resolve(this.estimateCoordinates(address));
            }
          } catch (e) {
            resolve(this.estimateCoordinates(address));
          }
        });
      }).on("error", () => {
        clearTimeout(timeout);
        resolve(this.estimateCoordinates(address));
      });
    });
  }
  /**
   * Get coordinates for address (with caching)
   */
  async geocodeAddress(address) {
    const normalizedAddress = this.normalizeAddress(address);
    if (this.failedAddresses.has(normalizedAddress)) {
      return {
        address,
        coords: this.estimateCoordinates(address),
        success: false,
        error: "Previously failed - using estimation",
        fromCache: false
      };
    }
    const cached = this.geocodeCache.get(normalizedAddress);
    if (cached) {
      const isExpired = Date.now() - cached.timestamp > this.CACHE_TTL;
      if (!isExpired) {
        return {
          address,
          coords: cached,
          success: true,
          fromCache: true
        };
      } else {
        this.geocodeCache.delete(normalizedAddress);
      }
    }
    const coords = await this.geocodeWithGoogle(address);
    if (coords) {
      this.geocodeCache.set(normalizedAddress, coords);
      return {
        address,
        coords,
        success: true,
        fromCache: false
      };
    } else {
      this.failedAddresses.add(normalizedAddress);
      return {
        address,
        coords: null,
        success: false,
        error: "Geocoding failed completely",
        fromCache: false
      };
    }
  }
  /**
   * Calculate distance using Haversine formula
   */
  calculateHaversineDistance(lat1, lon1, lat2, lon2) {
    const R = 3959;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }
  /**
   * Calculate distance between two addresses
   */
  async calculateDistance(address1, address2) {
    const cacheKey = `${this.normalizeAddress(address1)}|${this.normalizeAddress(address2)}`;
    const cached = this.distanceCache.get(cacheKey);
    if (cached && Date.now() - cached.coords1.timestamp < this.CACHE_TTL) {
      return cached;
    }
    const [result1, result2] = await Promise.all([
      this.geocodeAddress(address1),
      this.geocodeAddress(address2)
    ]);
    if (!result1.coords || !result2.coords) {
      return null;
    }
    const distance = this.calculateHaversineDistance(
      result1.coords.lat,
      result1.coords.lon,
      result2.coords.lat,
      result2.coords.lon
    );
    const confidenceScore = {
      "high": 3,
      "medium": 2,
      "low": 1
    };
    const avgConfidence = (confidenceScore[result1.coords.confidence] + confidenceScore[result2.coords.confidence]) / 2;
    let confidence = "medium";
    if (avgConfidence >= 2.5) confidence = "high";
    else if (avgConfidence >= 1.5) confidence = "medium";
    else confidence = "low";
    const calculation = {
      address1,
      address2,
      distance,
      method: "haversine",
      confidence,
      coords1: result1.coords,
      coords2: result2.coords
    };
    this.distanceCache.set(cacheKey, calculation);
    return calculation;
  }
  /**
   * Validate distances for multiple comparables
   */
  async validateComparableDistances(subjectAddress, comparables, maxDistance = 2) {
    const validated = [];
    const rejected = [];
    const validationDetails = [];
    let geocodingErrors = 0;
    let cacheHits = 0;
    const batchSize = 5;
    for (let i = 0; i < comparables.length; i += batchSize) {
      const batch = comparables.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(async (comp) => {
          const distanceCalc = await this.calculateDistance(subjectAddress, comp.address);
          if (!distanceCalc) {
            geocodingErrors++;
            return {
              comp,
              distance: null,
              error: "geocoding_failed",
              valid: false
            };
          }
          if (distanceCalc.coords1.source === "cached" || distanceCalc.coords2.source === "cached") {
            cacheHits++;
          }
          const valid = distanceCalc.distance <= maxDistance;
          const result = {
            comp: {
              ...comp,
              distance: distanceCalc.distance,
              distanceConfidence: distanceCalc.confidence,
              geocodingSource: `${distanceCalc.coords1.source}/${distanceCalc.coords2.source}`
            },
            distance: distanceCalc.distance,
            valid,
            confidence: distanceCalc.confidence
          };
          if (valid) {
            validated.push(result.comp);
          } else {
            rejected.push({
              ...result.comp,
              rejectionReason: `Too far (${distanceCalc.distance.toFixed(2)}mi > ${maxDistance}mi limit)`
            });
          }
          return result;
        })
      );
      validationDetails.push(...batchResults);
      if (i + batchSize < comparables.length) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    const validDistances = validationDetails.filter((v) => v.valid && v.distance !== null).map((v) => v.distance);
    const avgDistance = validDistances.length > 0 ? validDistances.reduce((sum, d) => sum + d, 0) / validDistances.length : 0;
    const validationSummary = {
      totalProcessed: comparables.length,
      validCount: validated.length,
      rejectedCount: rejected.length,
      avgDistance,
      geocodingErrors,
      cacheHits
    };
    if (rejected.length > 0) {
      rejected.forEach((r) => {
      });
    }
    return {
      validated,
      rejected,
      validationSummary
    };
  }
  /**
   * Get cache statistics
   */
  getCacheStats() {
    const now = Date.now();
    let oldestEntry = now;
    for (const coords of this.geocodeCache.values()) {
      if (coords.timestamp < oldestEntry) {
        oldestEntry = coords.timestamp;
      }
    }
    return {
      geocodeEntries: this.geocodeCache.size,
      distanceEntries: this.distanceCache.size,
      failedAddresses: this.failedAddresses.size,
      oldestEntry: now - oldestEntry
    };
  }
  /**
   * Clear caches
   */
  clearCaches() {
    this.geocodeCache.clear();
    this.distanceCache.clear();
    this.failedAddresses.clear();
  }
  /**
   * Export debug information
   */
  getDebugInfo() {
    return {
      geocodeCache: Array.from(this.geocodeCache.entries()).map(([address, coords]) => ({
        address,
        coords
      })),
      distanceCache: Array.from(this.distanceCache.values()),
      failedAddresses: Array.from(this.failedAddresses)
    };
  }
};

// server/comprehensive-comp-search-v3.ts
var ComprehensiveCompSearchV3 = class {
  compService;
  arvService;
  normalizer;
  deduplicator;
  progressiveSearch;
  distanceValidator;
  constructor() {
    this.compService = new VertexComparableSearchService();
    this.arvService = new ARVCalculationService();
    this.normalizer = new PropertyDataNormalizer();
    this.deduplicator = new SmartDeduplicator();
    this.progressiveSearch = new ProgressiveSearchStrategy();
    this.distanceValidator = new DistanceValidator();
  }
  async findComparables(address) {
    const startTime = Date.now();
    try {
      const subjectDetails = await fetchPropertyDetailsViaVertex(address);
      if (!subjectDetails) {
        throw new Error("Could not fetch subject property details");
      }
      if (subjectDetails.subdivision) {
      }
      let allComps = [];
      let searchLevel = 0;
      const maxSearchLevels = 3;
      if (subjectDetails.beds && subjectDetails.baths && subjectDetails.sqft && subjectDetails.yearBuilt) {
        if (subjectDetails.subdivision) {
          process.env.SUBDIVISION = subjectDetails.subdivision;
        }
        const progressiveResult = await this.progressiveSearch.executeProgressiveSearch(
          address,
          subjectDetails,
          this.compService,
          subjectDetails.subdivision
        );
        allComps = progressiveResult.finalProperties;
      } else {
        for (searchLevel = 0; searchLevel < maxSearchLevels; searchLevel++) {
          const radius = 1.5 + searchLevel * 0.5;
          const timeWindow = 12 + searchLevel * 6;
          const maxResults = 15 + searchLevel * 5;
          const result = await this.compService.findComparables(
            address,
            void 0,
            // propertyType
            maxResults,
            radius,
            timeWindow,
            subjectDetails
          );
          if (result.success && result.comparables.length > 0) {
            allComps.push(...result.comparables);
          }
          if (allComps.length >= 10) {
            break;
          }
        }
      }
      if (allComps.length === 0) {
        throw new Error("No comparables found in progressive search");
      }
      const normalizationResult = this.normalizer.processProperties(allComps);
      const normalizedComps = normalizationResult.normalized;
      const normalizationSummary = normalizationResult.summary;
      const deduplicationResult = this.deduplicator.deduplicateProperties(normalizedComps);
      const deduplicatedComps = deduplicationResult.deduplicated;
      const deduplicationSummary = deduplicationResult.summary;
      const distanceResult = await this.distanceValidator.validateComparableDistances(
        address,
        deduplicatedComps,
        2.5
        // max miles
      );
      const distanceValidatedComps = distanceResult.validated;
      const distanceValidationSummary = distanceResult.validationSummary;
      const consistencyScores = this.calculateConsistencyScores(distanceValidatedComps);
      const qualifiedComps = distanceValidatedComps.filter(
        (_, index) => consistencyScores.get(index.toString()) && consistencyScores.get(index.toString()) > 0.6
      );
      const renovationAnalysis = this.analyzeRenovationLevels(qualifiedComps);
      const subjectBaths = this.computeSubjectBathrooms(subjectDetails);
      let arvResult = void 0;
      let twoBathARV = void 0;
      let bathroomAnalysis = {
        subjectBaths,
        recommendAction: "sell_as_is",
        baselineCompsUsed: 0
      };
      if (qualifiedComps.length >= 3 && subjectDetails.sqft) {
        const baselineComps = this.filterComparablesForBaseline(qualifiedComps, subjectBaths);
        if (baselineComps.length >= 3) {
          const baselineARV = this.arvService.calculateARV(baselineComps, subjectDetails.sqft);
          arvResult = {
            method: "comprehensive_v3_baseline",
            estimate: baselineARV.arv,
            confidence: baselineARV.confidence,
            dataPoints: baselineComps.length
          };
          bathroomAnalysis.baselineCompsUsed = baselineComps.length;
        }
        if (subjectBaths < 2 && arvResult) {
          const twoBathComps = this.filterComparablesForTwoBath(qualifiedComps, subjectDetails);
          if (twoBathComps.length >= 3 && baselineComps.length >= 3) {
            const upgradeARV = this.arvService.calculateARV(twoBathComps, subjectDetails.sqft);
            const baselineEstimate = arvResult ? arvResult.estimate : upgradeARV.arv * 0.85;
            const valueAdd = upgradeARV.arv - baselineEstimate;
            const valueAddPercent = valueAdd / baselineEstimate * 100;
            const estimatedRenovationCost = 12e3;
            const netGain = valueAdd - estimatedRenovationCost;
            const roi = netGain / estimatedRenovationCost * 100;
            twoBathARV = {
              method: "comprehensive_v3_upgrade",
              estimate: upgradeARV.arv,
              confidence: upgradeARV.confidence,
              dataPoints: twoBathComps.length,
              valueAdd,
              valueAddPercent,
              roiEstimate: roi
            };
            bathroomAnalysis.upgradeCompsUsed = twoBathComps.length;
            bathroomAnalysis.recommendAction = this.generateRecommendation(
              arvResult.estimate,
              upgradeARV.arv,
              arvResult.confidence
            );
          } else {
          }
        } else {
        }
      } else {
      }
      const qualityScore = this.assessOverallQuality(qualifiedComps.length, consistencyScores);
      const totalSearchTime = Date.now() - startTime;
      const subjectSummary = this.buildSubjectSummary(address, subjectDetails);
      return {
        subject: subjectSummary,
        all_comps: allComps,
        qualified_comps: qualifiedComps,
        consistency_scores: consistencyScores,
        renovation_analysis: renovationAnalysis,
        arv: arvResult,
        twoBathARV,
        bathroomAnalysis,
        searchMetadata: {
          version: "v3.0",
          strategy: "progressive_expansion",
          searchLevels: searchLevel + 1,
          totalSearchTime,
          qualityScore,
          cacheHits: 0,
          // Could be implemented
          normalizationSummary,
          deduplicationSummary,
          distanceValidationSummary
        }
      };
    } catch (error) {
      console.error(`   \u274C Comprehensive search failed: ${error.message}`);
      throw error;
    }
  }
  /**
   * Enhanced bathroom computation derived from legacy CLI tooling
   */
  computeSubjectBathrooms(subjectDetails) {
    const directBaths = Number(subjectDetails.baths);
    if (Number.isFinite(directBaths) && directBaths > 0) {
      return directBaths;
    }
    if (subjectDetails?.description) {
      const desc = subjectDetails.description;
      const descBaths = Number(desc.baths);
      if (Number.isFinite(descBaths) && descBaths > 0) {
        return descBaths;
      }
      const fullCalc = Number(desc.baths_full_calc) || 0;
      const halfCalc = Number(desc.baths_partial_calc) || 0;
      const full = Number(desc.baths_full) || 0;
      const half = Number(desc.baths_half) || 0;
      let total = 0;
      total += fullCalc || full;
      total += 0.5 * (halfCalc || half);
      if (total > 0) return total;
    }
    return 1;
  }
  /**
   * BASELINE filtering - Conservative estimate using similar/lower bathroom counts
   */
  filterComparablesForBaseline(comps, subjectBaths) {
    const epsilon = 1e-9;
    return comps.filter((comp) => {
      const compBaths = parseFloat(comp.baths?.toString() || "NaN");
      if (!Number.isFinite(compBaths)) return false;
      if (compBaths > subjectBaths + epsilon) return false;
      if (!Number.isFinite(comp.price) || !Number.isFinite(comp.sqft)) return false;
      if (comp.price <= 0 || comp.sqft <= 0) return false;
      return true;
    });
  }
  /**
   * TWO-BATHROOM filtering - Upgrade scenario using 2+ bathroom comps
   */
  filterComparablesForTwoBath(comps, subjectDetails) {
    return comps.filter((comp) => {
      const compBaths = parseFloat(comp.baths?.toString() || "NaN");
      if (!Number.isFinite(compBaths) || compBaths < 2 || compBaths > 3) return false;
      if (!Number.isFinite(comp.price) || !Number.isFinite(comp.sqft)) return false;
      if (subjectDetails.sqft) {
        const sizeVariance = Math.abs(comp.sqft - subjectDetails.sqft) / subjectDetails.sqft;
        if (sizeVariance > 0.2) return false;
      }
      return true;
    });
  }
  /**
   * Generate renovation recommendation based on analysis
   */
  generateRecommendation(baselineARV, twoBathARV, confidence) {
    if (!twoBathARV) return "sell_as_is";
    const valueAdd = twoBathARV - baselineARV;
    const estimatedRenovationCost = 12e3;
    const netGain = valueAdd - estimatedRenovationCost;
    const roi = netGain / estimatedRenovationCost * 100;
    if (confidence === "high" && roi > 25) return "renovate";
    if (confidence === "medium" && roi > 40) return "renovate";
    if (confidence === "low" && roi > 60) return "renovate";
    if (baselineARV > 2e5) return "hold";
    return "sell_as_is";
  }
  calculateConsistencyScores(properties) {
    const scores = /* @__PURE__ */ new Map();
    properties.forEach((prop, index) => {
      let score = 1;
      if (!prop.price || prop.price <= 0) score -= 0.3;
      if (!prop.sqft || prop.sqft <= 0) score -= 0.3;
      if (!prop.beds || prop.beds <= 0) score -= 0.2;
      if (!prop.baths || prop.baths <= 0) score -= 0.1;
      if (!prop.soldDate) score -= 0.1;
      scores.set(index.toString(), Math.max(0, score));
    });
    return scores;
  }
  analyzeRenovationLevels(properties) {
    const ppsf = properties.map((p) => p.price / p.sqft).filter((p) => !isNaN(p) && p > 0);
    if (ppsf.length === 0) {
      return {
        likely_renovated: [],
        likely_unrenovated: [],
        market_average: properties
      };
    }
    const sortedPpsf = ppsf.sort((a, b) => a - b);
    const medianPpsf = sortedPpsf[Math.floor(sortedPpsf.length / 2)];
    const threshold = medianPpsf * 1.075;
    const likely_renovated = properties.filter((p) => {
      const propPpsf = p.price / p.sqft;
      return propPpsf >= threshold;
    });
    const likely_unrenovated = properties.filter((p) => {
      const propPpsf = p.price / p.sqft;
      return propPpsf < threshold * 0.9;
    });
    const market_average = properties.filter((p) => {
      const propPpsf = p.price / p.sqft;
      return propPpsf >= threshold * 0.9 && propPpsf < threshold;
    });
    return {
      likely_renovated,
      likely_unrenovated,
      market_average
    };
  }
  assessOverallQuality(compCount, consistencyScores) {
    const avgConsistency = Array.from(consistencyScores.values()).reduce((a, b) => a + b, 0) / consistencyScores.size;
    if (compCount >= 8 && avgConsistency >= 0.8) return "excellent";
    if (compCount >= 5 && avgConsistency >= 0.7) return "good";
    if (compCount >= 3 && avgConsistency >= 0.6) return "fair";
    return "poor";
  }
  buildSubjectSummary(address, details) {
    const toNumber = (value) => {
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    };
    return {
      address: details?.address || address,
      sqft: toNumber(details?.sqft),
      beds: toNumber(details?.beds),
      baths: toNumber(details?.baths),
      yearBuilt: toNumber(details?.yearBuilt),
      lotSize: toNumber(details?.lotSize),
      subdivision: details?.subdivision ?? null,
      success: details?.success ?? true
    };
  }
};
async function testComprehensiveSearchV3() {
  const address = process.env.ADDRESS;
  if (!address) {
    console.error("\u274C ADDRESS environment variable is required");
    process.exit(1);
  }
  try {
    const service = new ComprehensiveCompSearchV3();
    const result = await service.findComparables(address);
    if (result.arv) {
    }
    if (result.twoBathARV) {
    }
  } catch (error) {
    console.error("\u274C Test failed:", error.message);
    process.exit(1);
  }
}
if (import.meta.url === `file://${process.argv[1]}`) {
  testComprehensiveSearchV3().catch((err) => {
    console.error("\u274C Error:", err.message);
    process.exit(1);
  });
}

// server/utils/logger.ts
import winston from "winston";
import { LoggingWinston } from "@google-cloud/logging-winston";
import path from "path";
import { fileURLToPath } from "url";
var __filename = fileURLToPath(import.meta.url);
var __dirname = path.dirname(__filename);
var loggingWinston = new LoggingWinston({
  projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
  keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
  logName: "propertyvision-api"
});
var isProduction = process.env.NODE_ENV === "production";
var logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: {
    service: "propertyvision-backend",
    environment: process.env.NODE_ENV || "development"
  },
  transports: [
    // Console transport for all environments
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    }),
    // Production: Google Cloud Logging
    ...isProduction ? [loggingWinston] : [],
    // Development/Local: File-based logging
    ...!isProduction ? [
      new winston.transports.File({
        filename: path.join(__dirname, "../../logs/error.log"),
        level: "error",
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.json()
        )
      }),
      new winston.transports.File({
        filename: path.join(__dirname, "../../logs/searches.log"),
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.json()
        )
      })
    ] : []
  ]
});
function logSearchRequest(data) {
  logger.info("Search request received", {
    eventType: "SEARCH_REQUEST",
    ...data
  });
}
function logSearchResult(data) {
  logger.info("Search completed", {
    eventType: "SEARCH_RESULT",
    ...data
  });
}
function logSearchError(data) {
  logger.error("Search failed", {
    eventType: "SEARCH_ERROR",
    address: data.address,
    userId: data.userId,
    sessionId: data.sessionId,
    stage: data.stage,
    errorMessage: data.error.message,
    errorStack: data.error.stack
  });
}
var logger_default = logger;

// server/index.ts
var app = express();
var port = Number(process.env.PORT) || 3001;
var host = process.env.HOST || "0.0.0.0";
var corsOrigins = process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(",").map((origin) => origin.trim()).filter(Boolean) : void 0;
app.use(corsOrigins?.length ? cors({ origin: corsOrigins, credentials: true }) : cors());
app.use(express.json({ limit: "1mb" }));
var analysisService = new ComprehensiveCompSearchV3();
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, time: (/* @__PURE__ */ new Date()).toISOString() });
});
app.post("/api/analyze", async (req, res) => {
  const startTime = Date.now();
  const address = String(req.body?.address || "").trim();
  const userId = req.body?.userId || req.headers["x-user-id"];
  const sessionId = req.body?.sessionId || req.headers["x-session-id"];
  const ip = req.ip || req.headers["x-forwarded-for"] || req.socket.remoteAddress;
  try {
    if (!address) {
      logSearchError({
        address: "",
        userId,
        sessionId,
        error: new Error("Address is required"),
        stage: "validation"
      });
      return res.status(400).json({ error: "Address is required" });
    }
    logSearchRequest({
      address,
      userId,
      sessionId,
      ip: String(ip)
    });
    const result = await analysisService.findComparables(address);
    const executionTimeMs = Date.now() - startTime;
    const responsePayload = {
      subject: result.subject,
      arv: result.arv ?? null,
      twoBathArv: result.twoBathARV ?? null,
      bathroomAnalysis: result.bathroomAnalysis,
      renovationAnalysis: result.renovation_analysis,
      compsUsed: result.qualified_comps,
      allComps: result.all_comps,
      confidenceScores: Object.fromEntries(result.consistency_scores.entries()),
      searchMetadata: result.searchMetadata
    };
    logSearchResult({
      address,
      userId,
      sessionId,
      arv: typeof result.arv === "number" ? result.arv : result.arv?.estimate ?? null,
      twoBathArv: typeof result.twoBathARV === "number" ? result.twoBathARV : result.twoBathARV?.estimate ?? null,
      compsCount: result.all_comps?.length || 0,
      qualifiedCompsCount: result.qualified_comps?.length || 0,
      executionTimeMs,
      success: true
    });
    res.json(responsePayload);
  } catch (error) {
    const executionTimeMs = Date.now() - startTime;
    const message = error?.message || "Analysis failed";
    logSearchError({
      address,
      userId,
      sessionId,
      error: error instanceof Error ? error : new Error(message),
      stage: "analysis"
    });
    logger_default.error("Analysis failed", {
      eventType: "SEARCH_ERROR",
      address,
      userId,
      sessionId,
      executionTimeMs,
      errorMessage: message,
      errorStack: error?.stack
    });
    res.status(500).json({ error: "Analysis failed", details: message });
  }
});
app.listen(port, host, () => {
  logger_default.info(`Comprehensive analysis API ready on http://${host}:${port}`, {
    eventType: "SERVER_START",
    port,
    host,
    environment: process.env.NODE_ENV
  });
});
