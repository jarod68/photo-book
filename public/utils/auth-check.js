export async function requireLogin() {
  try {
    const { user } = await fetch('/api/auth/me').then(r => r.json());
    if (!user) window.location.replace('/login.html');
  } catch (_) {
    window.location.replace('/login.html');
  }
}
