import { createClient, SupabaseClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

export interface DatabaseConfig {
  url: string;
  serviceRoleKey: string;
}

const getDatabaseConfig = (): DatabaseConfig => {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new Error("SUPABASE_URL non configurato in .env");
  }

  if (!serviceRoleKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY non configurata in .env. Il backend deve usare la service role key per operazioni server-side come login Google e creazione utenti."
    );
  }

  return { url, serviceRoleKey };
};

const { url, serviceRoleKey } = getDatabaseConfig();

export const db: SupabaseClient = createClient(url, serviceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

let connectionChecked = false;

export async function connectDatabase(): Promise<SupabaseClient> {
  if (connectionChecked) {
    return db;
  }

  const { error } = await db
    .from("utenti")
    .select("idUtente", { head: true, count: "exact" })
    .limit(1);

  if (error) {
    throw new Error(`Connessione a Supabase fallita: ${error.message}`);
  }

  connectionChecked = true;

  return db;
}

export function getSupabaseClient(): SupabaseClient {
  return db;
}

export async function disconnectDatabase(): Promise<void> {
  connectionChecked = false;
}

export function isDatabaseConnected(): boolean {
  return connectionChecked;
}

export default {
  db,
  connectDatabase,
  getSupabaseClient,
  disconnectDatabase,
  isDatabaseConnected,
};
