/**
 * Offline copies (step M4): the last copy of each plan this person opened, their unsent edits, Home's
 * list and who they are, kept in IndexedDB on this device so plans open and edits survive a reload
 * without a connection. Everything is stored per signed-in person and wiped on sign-out. Storage
 * can be unavailable (private windows, blocked site data): then everything still works online,
 * there's just no offline copy.
 */
import type { OpEnvelope, Plan } from "@rakuplan/shared";
import type { Me, PlanDetail, PlanSummary } from "./api";

const DB = "offline";
const STORE = "kv";

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

let db: Promise<IDBDatabase | null> | null = null;
const conn = () => (db ??= open());

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const d = await conn();
  if (!d) return undefined;
  return new Promise((resolve) => {
    try {
      const tx = d.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req ? (req.result as T) : undefined);
      tx.onerror = () => resolve(undefined);
      tx.onabort = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
}

const get = <T>(key: string) => run<T>("readonly", (s) => s.get(key));
const put = (key: string, value: unknown) => run("readwrite", (s) => void s.put(value, key));

/** One plan as last seen, plus edits made here that the server hasn't confirmed yet. */
export interface PlanCopy {
  detail: PlanDetail;
  /** The plan as the server last confirmed it, and at which version. */
  confirmed: Plan;
  version: number;
  /** This device's edit stream for the plan: its ID and how many edits it has made, so edit IDs never repeat. */
  clientId: string;
  sent: number;
  pending: OpEnvelope[];
  savedAt: number;
}

export const offline = {
  me: (m: Me) => put("me", m),
  lastMe: () => get<Me>("me"),
  plans: (userId: string, list: PlanSummary[]) => put(`${userId}:plans`, { list, savedAt: Date.now() }),
  lastPlans: (userId: string) => get<{ list: PlanSummary[]; savedAt: number }>(`${userId}:plans`),
  savePlan: (userId: string, planId: string, copy: PlanCopy) => put(`${userId}:plan:${planId}`, copy),
  plan: (userId: string, planId: string) => get<PlanCopy>(`${userId}:plan:${planId}`),
  /** Everything, for sign-out (a shared computer shouldn't keep someone's plans). */
  clear: () => run("readwrite", (s) => void s.clear()),
};

/** True when a request failed because there's no connection (not because the server said no). */
export const isNetworkError = (e: unknown) => e instanceof TypeError || (typeof navigator !== "undefined" && !navigator.onLine);
