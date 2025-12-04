// src/supabaseClient.js
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
const supabaseAnonKey = process.env.REACT_APP_SUPABASE_ANON_KEY;

console.log("SUPABASE URL =", supabaseUrl);
console.log("HAS KEY =", !!supabaseAnonKey);

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
