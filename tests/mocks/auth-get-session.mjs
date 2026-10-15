let session = {};

export function setSession(value) {
  session = value;
}

export async function getSession() {
  return session;
}
