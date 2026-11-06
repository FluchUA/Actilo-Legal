import {firebaseConfig, workerUrl} from './firebase-config.js';
import {deleteActiloAccount} from './delete-account-flow.mjs';

const signInButton = document.getElementById('sign-in');
const signedInPanel = document.getElementById('signed-in');
const email = document.getElementById('account-email');
const confirmation = document.getElementById('confirm-delete');
const deleteButton = document.getElementById('delete-account');
const signOutButton = document.getElementById('sign-out');
const status = document.getElementById('deletion-status');
let currentUser = null, busy = true, finished = false, needsSignIn = false;

function showStatus(message, state = '') {
  status.textContent = message;
  status.dataset.state = state;
}
function render() {
  signInButton.hidden = finished || (currentUser !== null && !needsSignIn);
  signedInPanel.hidden = finished || currentUser === null;
  signInButton.disabled = busy;
  signInButton.textContent = needsSignIn ? 'Confirm Google sign-in again' : 'Continue with Google ↗';
  signOutButton.disabled = busy;
  deleteButton.disabled = busy || needsSignIn || !confirmation.checked;
  confirmation.disabled = busy;
  email.textContent = currentUser ? `Signed in as ${currentUser.email || 'your Google account'}` : '';
}
function marker(uid) { return `actilo.account-deletion.${uid}`; }
function rememberCloudDeletion(uid) {
  try { sessionStorage.setItem(marker(uid), 'cloud-removed'); } catch { /* Storage may be blocked. */ }
}
function clearMarker(uid) {
  try { sessionStorage.removeItem(marker(uid)); } catch { /* Optional state only. */ }
}

async function initialize() {
  render();
  showStatus('Loading secure Google sign-in…', 'busy');
  // Load Auth only on this page; there is no Analytics SDK on the legal site.
  const [appSdk, authSdk] = await Promise.all([
    import('https://www.gstatic.com/firebasejs/13.2.0/firebase-app.js'),
    import('https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js'),
  ]);
  const auth = authSdk.getAuth(appSdk.initializeApp(firebaseConfig));
  await authSdk.setPersistence(auth, authSdk.browserSessionPersistence);
  const provider = new authSdk.GoogleAuthProvider();
  provider.setCustomParameters({prompt: 'select_account'});
  authSdk.onAuthStateChanged(auth, user => {
    currentUser = user;
    render();
    if (user && !busy && !finished) {
      try {
        if (sessionStorage.getItem(marker(user.uid))) showStatus('Your cloud data was removed. Confirm deletion below to finish removing your sign-in account.');
      } catch { /* No persistent marker is required for a safe retry. */ }
    }
  });
  signInButton.addEventListener('click', async () => {
    if (busy) return;
    busy = true; render(); showStatus('Opening Google sign-in…', 'busy');
    try {
      const result = await authSdk.signInWithPopup(auth, provider);
      currentUser = result.user;
      needsSignIn = false;
      confirmation.checked = false;
      showStatus('Review the warning, then confirm only if you want to delete this account.');
    } catch (error) {
      const messages = {
        'auth/popup-closed-by-user': 'Sign-in was cancelled. Nothing has been deleted.',
        'auth/cancelled-popup-request': 'Sign-in was cancelled. Please try again.',
        'auth/popup-blocked': 'Your browser blocked the Google window. Allow pop-ups for this page and try again.',
        'auth/unauthorized-domain': 'Google sign-in is not available on this address yet. Please use Actilo Settings or contact support.',
      };
      showStatus(messages[error.code] || 'Google sign-in could not finish. Check your connection and try again.', 'error');
    } finally { busy = false; render(); }
  });
  confirmation.addEventListener('change', render);
  signOutButton.addEventListener('click', async () => {
    if (busy) return;
    busy = true; render();
    try {
      await authSdk.signOut(auth);
      currentUser = null;
      needsSignIn = false;
      confirmation.checked = false;
      showStatus('Choose the Google account you use for Actilo.');
    } catch { showStatus('Could not switch accounts. Reload this page and try again.', 'error'); }
    finally { busy = false; render(); }
  });
  deleteButton.addEventListener('click', async () => {
    if (busy || !currentUser || !confirmation.checked || needsSignIn) return;
    busy = true; render(); showStatus('Removing your Actilo cloud data…', 'busy');
    const user = currentUser;
    try {
      await deleteActiloAccount({
        user, confirmed: confirmation.checked,
        async removeCloud(token) {
          const response = await fetch(`${workerUrl}/account`, {
            method: 'DELETE', headers: {Authorization: `Bearer ${token}`},
            credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(30000),
          });
          const body = await response.json().catch(() => null);
          if (!response.ok || body?.ok !== true) {
            const error = new Error('Cloud deletion unavailable');
            error.code = body?.error?.code;
            throw error;
          }
        },
        onCloudRemoved(uid) {
          rememberCloudDeletion(uid);
          showStatus('Cloud data removed. Finishing account deletion…', 'busy');
        },
        removeIdentity: authSdk.deleteUser,
      });
      clearMarker(user.uid);
      finished = true;
      currentUser = null;
      showStatus('Your Actilo account has been deleted. Your Google account and Google Play purchases are unchanged.', 'success');
    } catch (error) {
      const code = error.cause?.code;
      needsSignIn = code === 'auth/requires-recent-login' || code === 'recent_sign_in' || code === 'unauthorized' || code === 'auth/user-token-expired';
      confirmation.checked = false;
      const message = error.stage === 'identity'
        ? 'Your Actilo cloud data was removed, but sign-in account deletion did not finish. Continue below to complete it.'
        : 'Account deletion was not confirmed. Check your connection and try again. If the issue continues, contact support.';
      showStatus(needsSignIn ? `${message} Sign in with Google again first.` : message, 'error');
    } finally { busy = false; render(); }
  });
  busy = false;
  showStatus('Sign-in only identifies your account. It does not delete anything.');
  render();
}
initialize().catch(() => {
  busy = true;
  render();
  showStatus('Secure sign-in could not load. Reload the page, or delete your account from Actilo Settings. You can email support if you need help.', 'error');
});
