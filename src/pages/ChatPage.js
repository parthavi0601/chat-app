// src/pages/ChatPage.jsx
import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../supabaseClient";
import AddFriend from "../components/AddFriend";
import FriendRequestsSupabase from "../components/FriendRequestsSupabase";
import { uploadFile } from "../lib/uploadFile";

function makeChatId(a, b) {
  return a < b ? `${a}_${b}` : `${b}_${a}`;
}

export default function ChatPage() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [friends, setFriends] = useState([]);
  const [activeFriend, setActiveFriend] = useState(null);
  const [messages, setMessages] = useState([]);
  const [body, setBody] = useState("");
  const [typingStatus, setTypingStatus] = useState("");
  const [unreadCounts, setUnreadCounts] = useState({});
  const [showSettings, setShowSettings] = useState(false);
  const [uploading, setUploading] = useState(false);
  const bottomRef = useRef(null);
  const fileInputRef = useRef(null);
  const avatarInputRef = useRef(null);
  const navigate = useNavigate();

  // load current user + profile
  useEffect(() => {
    const loadUser = async () => {
      const { data, error } = await supabase.auth.getUser();
      if (error || !data.user) {
        navigate("/");
        return;
      }
      const authUser = data.user;
      setUser(authUser);

      const { data: prof, error: profErr } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", authUser.id)
        .single();

      if (profErr || !prof) {
        const defaultNickname = authUser.email?.split("@")[0] || "User";
        const { data: inserted } = await supabase
          .from("profiles")
          .insert({
            id: authUser.id,
            username: authUser.email,
            nickname: defaultNickname,
          })
          .select()
          .single();
        setProfile(inserted);
      } else {
        setProfile(prof);
      }
    };
    loadUser();
  }, [navigate]);

  // load friends (with nicknames) from BOTH directions + realtime updates
  useEffect(() => {
    if (!user) return;

    const loadFriends = async () => {
      const { data: rels, error } = await supabase
        .from("friendships")
        .select("user_id, friend_id, status")
        .eq("status", "accepted")
        .or(`user_id.eq.${user.id},friend_id.eq.${user.id}`);

      if (error || !rels) {
        setFriends([]);
        return;
      }

      const otherIds = rels.map((r) =>
        r.user_id === user.id ? r.friend_id : r.user_id
      );
      const uniqueIds = Array.from(new Set(otherIds));

      if (!uniqueIds.length) {
        setFriends([]);
        return;
      }

      const { data: profiles, error: pErr } = await supabase
        .from("profiles")
        .select("id, nickname, avatar_url, username")
        .in("id", uniqueIds);

      if (pErr || !profiles) {
        setFriends(uniqueIds.map((id) => ({ id, nickname: id })));
        return;
      }

      const byId = Object.fromEntries(
        profiles.map((p) => [
          p.id,
          {
            nickname:
              p.nickname ||
              p.username?.split("@")[0] ||
              p.id,
            avatar_url: p.avatar_url || null,
          },
        ])
      );

      setFriends(
        uniqueIds.map((id) => ({
          id,
          nickname: byId[id]?.nickname ?? id,
          avatar_url: byId[id]?.avatar_url ?? null,
        }))
      );
    };

    loadFriends();

    const channel = supabase
      .channel(`friends:${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "friendships",
          filter: `or(user_id.eq.${user.id},friend_id.eq.${user.id})`,
        },
        () => loadFriends()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  // global realtime listener for all messages to update unread counts + sound
  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel(`inbox:${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `receiver_id=eq.${user.id}`,
        },
        (payload) => {
          const msg = payload.new;

          // if message not in currently open chat, bump unread badge
          if (!activeFriend || msg.sender_id !== activeFriend.id) {
            setUnreadCounts((prev) => ({
              ...prev,
              [msg.sender_id]: (prev[msg.sender_id] || 0) + 1,
            }));
          }

          // play sound whenever page not visible
          if (document.hidden) {
            new Audio("/notify.mp3").play();
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, activeFriend]);

  // load message history + realtime inserts + typing indicator for active chat
  useEffect(() => {
    if (!user || !activeFriend) return;

    const chatId = makeChatId(user.id, activeFriend.id);

    const loadHistory = async () => {
      const { data, error } = await supabase
        .from("messages")
        .select("*")
        .eq("chat_id", chatId)
        .order("created_at", { ascending: true });

      if (!error && data) setMessages(data);
    };

    loadHistory();

    const msgChannel = supabase
      .channel(`room:${chatId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `chat_id=eq.${chatId}`,
        },
        (payload) => {
          setMessages((msg) => [...msg, payload.new]);
          if (document.hidden) {
            new Audio("/notify.mp3").play();
          }
        }
      )
      .subscribe();

    const typingChannel = supabase
      .channel(`typing:${chatId}`)
      .on("broadcast", { event: "typing" }, (payload) => {
        if (payload.senderId === activeFriend.id) {
          setTypingStatus(`${activeFriend.nickname} is typing...`);
          setTimeout(() => setTypingStatus(""), 1200);
        }
      })
      .subscribe();

    // reset unread count for this friend
    setUnreadCounts((prev) => {
      const copy = { ...prev };
      delete copy[activeFriend.id];
      return copy;
    });

    return () => {
      supabase.removeChannel(msgChannel);
      supabase.removeChannel(typingChannel);
    };
  }, [user, activeFriend]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const detectAttachmentType = (file) => {
    if (file.type.startsWith("image/")) return "image";
    if (file.type.startsWith("video/")) return "video";
    return "file";
  };

  const sendMessage = async (attachment = null) => {
    if (!user || !activeFriend) return;
    if (!body.trim() && !attachment) return;

    const chatId = makeChatId(user.id, activeFriend.id);

    const payload = {
      chat_id: chatId,
      sender_id: user.id,
      receiver_id: activeFriend.id,
      body: body.trim() || "",
      attachment_url: attachment?.url || null,
      attachment_type: attachment?.type || null,
    };

    const { data, error } = await supabase
      .from("messages")
      .insert(payload)
      .select();

    if (error) {
      console.error("INSERT MESSAGE ERROR", error);
      return;
    }

    if (data && data[0]) {
      setMessages((m) => [...m, data[0]]);
    }
    setBody("");
  };

  const handleBodyChange = (e) => {
    const value = e.target.value;
    setBody(value);

    if (!user || !activeFriend) return;
    const chatId = makeChatId(user.id, activeFriend.id);

    supabase.channel(`typing:${chatId}`).send({
      type: "broadcast",
      event: "typing",
      payload: { senderId: user.id },
    });
  };

  const handleSelectFriend = (friend) => {
    setActiveFriend(friend);
  };

  const handleSendFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !user || !activeFriend) return;

    try {
      setUploading(true);
      const url = await uploadFile(file, "messages");
      const type = detectAttachmentType(file);
      await sendMessage({ url, type });
    } catch (err) {
      console.error("UPLOAD ERROR", err);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleAvatarChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    try {
      const url = await uploadFile(file, "avatars");
      const { error } = await supabase
        .from("profiles")
        .update({ avatar_url: url })
        .eq("id", user.id);
      if (!error) {
        setProfile((p) => ({ ...(p || {}), avatar_url: url }));
      }
    } catch (err) {
      console.error("AVATAR UPLOAD ERROR", err);
    } finally {
      if (avatarInputRef.current) avatarInputRef.current.value = "";
    }
  };

  if (!user) return null;

  const displayName = profile?.nickname || user.email;

  return (
    <div className="page chat">
      <div className="sidebar">
        <div className="sidebar-header">
          <div className="profile-summary">
            <div className="avatar">
              {profile?.avatar_url ? (
                <img src={profile.avatar_url} alt="avatar" />
              ) : (
                <span>{(displayName || "?")[0]}</span>
              )}
            </div>
            <div>
              <div className="nickname">{displayName}</div>
              <button
                className="link-button small"
                onClick={() => setShowSettings((v) => !v)}
              >
                Settings
              </button>
            </div>
          </div>
          {showSettings && (
            <div className="settings-panel">
              <label className="small">Change avatar</label>
              <input
                type="file"
                accept="image/*"
                ref={avatarInputRef}
                onChange={handleAvatarChange}
              />
            </div>
          )}
        </div>

        <h3>Friends</h3>
        {friends.map((f) => {
          const unread = unreadCounts[f.id] || 0;
          return (
            <button
              key={f.id}
              className={`friend-item ${
                activeFriend && activeFriend.id === f.id ? "active" : ""
              }`}
              onClick={() => handleSelectFriend(f)}
            >
              {f.avatar_url ? (
                <img src={f.avatar_url} alt="" className="friend-avatar" />
              ) : (
                <div className="friend-avatar placeholder">
                  {f.nickname?.[0] || "?"}
                </div>
              )}
              <span>{f.nickname}</span>
              {unread > 0 && (
                <span className="badge">
                  {unread > 99 ? "99+" : unread}
                </span>
              )}
            </button>
          );
        })}

        <AddFriend currentUser={user} />
        <FriendRequestsSupabase currentUser={user} />
      </div>

      <div className="chat-main">
        {activeFriend ? (
          <>
            <div className="chat-header">
              <h2>{activeFriend.nickname}</h2>
            </div>
            <div className="messages-section">
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={`bubble-row ${
                    m.sender_id === user.id ? "self" : "other"
                  }`}
                >
                  <div className="bubble">
                    {m.attachment_url && m.attachment_type === "image" && (
                      <img
                        src={m.attachment_url}
                        alt="attachment"
                        className="msg-image"
                      />
                    )}
                    {m.attachment_url && m.attachment_type === "video" && (
                      <video
                        src={m.attachment_url}
                        controls
                        className="msg-video"
                      />
                    )}
                    {m.attachment_url &&
                      m.attachment_type &&
                      m.attachment_type === "file" && (
                        <a
                          href={m.attachment_url}
                          target="_blank"
                          rel="noreferrer"
                          className="msg-file"
                        >
                          Download file
                        </a>
                      )}
                    {m.body && <div className="bubble-text">{m.body}</div>}
                    <div className="bubble-time">
                      {new Date(m.created_at).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </div>
                  </div>
                </div>
              ))}
              {typingStatus && (
                <div className="typing-indicator">{typingStatus}</div>
              )}
              <div ref={bottomRef} />
            </div>

            <div className="input-row">
              <button
                type="button"
                className="icon-button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                📎
              </button>
              <input
                type="file"
                ref={fileInputRef}
                style={{ display: "none" }}
                accept="image/*,video/*,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                onChange={handleSendFile}
              />
              <input
                className="chat-input"
                placeholder="Type a message…"
                value={body}
                onChange={handleBodyChange}
                onKeyDown={(e) => e.key === "Enter" && sendMessage()}
              />
              <button
                type="button"
                className="send-button"
                onClick={() => sendMessage()}
                disabled={!body.trim() && !uploading}
              >
                Send
              </button>
            </div>
          </>
        ) : (
          <div className="empty-state">Select a friend to start chatting</div>
        )}
      </div>
    </div>
  );
}
