// src/components/FriendRequestsSupabase.jsx
import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";

export default function FriendRequestsSupabase({ currentUser }) {
  const [incoming, setIncoming] = useState([]);

  useEffect(() => {
    if (!currentUser?.id) return;

    const load = async () => {
      const { data, error } = await supabase
        .from("friendships")
        .select("id, user_id, friend_id, status")
        .eq("friend_id", currentUser.id)
        .eq("status", "pending");

      if (!error && data) setIncoming(data);
    };

    load();

    // realtime subscription for new/updated requests
    const channel = supabase
      .channel(`friend-requests:${currentUser.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "friendships",
          filter: `friend_id=eq.${currentUser.id}`,
        },
        () => load()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentUser?.id]);

  const accept = async (req) => {
    // 1) mark original request as accepted
    const { error } = await supabase
      .from("friendships")
      .update({ status: "accepted" })
      .eq("id", req.id);

    if (error) {
      console.error("accept error", error);
      return;
    }

    // 2) create mirror row so receiver also has this friend
    const { error: mirrorErr } = await supabase.from("friendships").insert({
      user_id: req.friend_id,   // receiver
      friend_id: req.user_id,   // original sender
      status: "accepted",
    });

    if (mirrorErr) {
      console.error("mirror insert error", mirrorErr);
    }

    // 3) update UI immediately: remove this request from list
    setIncoming((prev) => prev.filter((r) => r.id !== req.id));
  };

  const decline = async (req) => {
    const { error } = await supabase
      .from("friendships")
      .delete()
      .eq("id", req.id);

    if (!error) {
      setIncoming((prev) => prev.filter((r) => r.id !== req.id));
    }
  };

  if (!incoming.length) return null;

  return (
    <div className="panel">
      <h3>Friend requests</h3>
      {incoming.map((r) => (
        <div key={r.id} className="request-row">
          <span>{r.user_id}</span>
          <button onClick={() => accept(r)}>Accept</button>
          <button onClick={() => decline(r)}>Decline</button>
        </div>
      ))}
    </div>
  );
}
