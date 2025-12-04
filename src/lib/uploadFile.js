// src/lib/uploadFile.js
import { supabase } from "../supabaseClient";

export async function uploadFile(file, folder = "attachments") {
  console.log("UPLOAD start", { name: file.name, type: file.type, size: file.size });

  const ext = file.name.split(".").pop();
  const path = `${folder}/${crypto.randomUUID()}.${ext}`;

  const { data, error } = await supabase.storage
    .from("chat-files")
    .upload(path, file, {
      cacheControl: "3600",
      upsert: false,
    });

  if (error) {
    console.error("UPLOAD storage error", error);
    throw error;
  }

  console.log("UPLOAD ok", data);

  const {
    data: { publicUrl },
  } = supabase.storage.from("chat-files").getPublicUrl(path);

  console.log("UPLOAD url", publicUrl);
  return publicUrl;
}
