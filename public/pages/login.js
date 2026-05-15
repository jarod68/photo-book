const form     = document.getElementById('login-form');
const errorEl  = document.getElementById('login-error');
const btn      = form.querySelector('button[type="submit"]');

async function checkAlreadyLoggedIn() {
  try {
    const { user } = await fetch('/api/auth/me').then(r => r.json());
    if (user) window.location.replace('/');
  } catch (_) {}
}

checkAlreadyLoggedIn();

form.addEventListener('submit', async e => {
  e.preventDefault();
  errorEl.hidden = true;
  btn.disabled   = true;
  btn.querySelector('.login-btn-text').textContent = 'Signing in…';

  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;

  try {
    const res  = await fetch('/api/auth/login', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ username, password }),
    });
    const data = await res.json();

    if (!res.ok) {
      errorEl.textContent = data.error === 'Invalid credentials'
        ? 'Incorrect username or password.'
        : 'Unable to sign in. Please try again.';
      errorEl.hidden = false;
      return;
    }

    window.location.replace('/');
  } catch (_) {
    errorEl.textContent = 'Network error. Please try again.';
    errorEl.hidden = false;
  } finally {
    btn.disabled    = false;
    btn.querySelector('.login-btn-text').textContent = 'Sign in';
  }
});
