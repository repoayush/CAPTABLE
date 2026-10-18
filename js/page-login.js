import { watchAuth, signInWithGoogle, isDemo } from './backend.js';
import { GOOGLE_SVG } from './ui.js';

const btn = document.getElementById('gbtn');
const err = document.getElementById('err');
btn.innerHTML = GOOGLE_SVG + '<span>' + (isDemo ? 'Continue as Demo Founder' : 'Continue with Google') + '</span>';
if (isDemo) document.getElementById('demo-note').classList.remove('hide');

Promise.resolve(
  watchAuth((u) => {
    if (u) location.replace('home.html');
  }),
).catch((e) => {
  console.error(e);
  err.textContent = 'Could not connect to Firebase. Check your internet connection and the values in js/config.js, then reload. (' + (e.code || e.message) + ')';
  err.classList.remove('hide');
});

const messages = {
  'auth/popup-closed-by-user': 'The sign-in window was closed before it finished. Try again.',
  'auth/cancelled-popup-request': 'Another sign-in window is already open.',
  'auth/unauthorized-domain': 'This website address is not allowed yet. In the Firebase console go to Authentication, Settings, Authorized domains and add it.',
  'auth/operation-not-allowed': 'Google sign-in is switched off. In the Firebase console go to Authentication, Sign-in method and turn on Google.',
  'auth/network-request-failed': 'No internet connection. Check it and try again.',
};

btn.addEventListener('click', async () => {
  err.classList.add('hide');
  btn.disabled = true;
  try {
    const u = await signInWithGoogle();
    if (u) location.replace('home.html');
  } catch (e) {
    err.textContent = messages[e.code] || 'Sign-in did not work: ' + (e.message || e.code || 'unknown error');
    err.classList.remove('hide');
  } finally {
    btn.disabled = false;
  }
});
