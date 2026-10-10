/** Anonymous device identity — no accounts, no sign-in. */

const UID_KEY = "rr_uid";
const NAME_KEY = "rr_name";

export function getPlayerId(): string {
  let uid = localStorage.getItem(UID_KEY);
  if (!uid) {
    uid =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `p-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
    localStorage.setItem(UID_KEY, uid);
  }
  return uid;
}

export function getPlayerName(): string {
  return localStorage.getItem(NAME_KEY) || "Fighter";
}

export function setPlayerName(name: string) {
  localStorage.setItem(NAME_KEY, name.slice(0, 20) || "Fighter");
}
