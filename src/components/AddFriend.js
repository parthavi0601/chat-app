import { useState } from "react";
import { supabase } from "../supabaseClient";

export default function AddFriend({ currentUser }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("");

  const handleAdd = async () => {
    setStatus("");
    if (!email || !currentUser) return;

    // find profile by email (username)
    const { data: users, error } = await supabase
      .from("profiles")
      .select("id, username, nickname")
      .eq("username", email)
      .limit(1);

    if (error) {
      setStatus(error.message);
      return;
    }
    if (!users || users.length === 0) {
      setStatus("User not found");
      return;
    }

    const friend = users[0];
    if (friend.id === currentUser.id) {
      setStatus("You cannot add yourself");
      return;
    }

    // check existing friendship in either direction
    const { data: existing, error: existingErr } = await supabase
      .from("friendships")
      .select("id, user_id, friend_id, status")
      .or(
        `and(user_id.eq.${currentUser.id},friend_id.eq.${friend.id}),and(user_id.eq.${friend.id},friend_id.eq.${currentUser.id})`
      );

    if (!existingErr && existing && existing.length > 0) {
      const row = existing[0];
      if (row.status === "pending") {
        setStatus("Request already sent");
        return;
      }
      if (row.status === "accepted") {
        setStatus("Already friends");
        return;
      }
    }

    // create pending friendship row
    const { error: insertErr } = await supabase.from("friendships").insert({
      user_id: currentUser.id,
      friend_id: friend.id,
      status: "pending",
    });

    if (insertErr) setStatus(insertErr.message);
    else setStatus("Request sent");
  };

  return (
    <div className="panel">
      <h3>Add friend</h3>
      <div className="row">
        <input
          placeholder="Friend email (username)"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <button type="button" onClick={handleAdd}>
          Add
        </button>
      </div>
      {status && <div className="small status">{status}</div>}
    </div>
  );
}
