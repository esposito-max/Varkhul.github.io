import {
  consumeOAuthCallback,
  getUsableAuthSession,
  signedInDestination,
  signInWithEmail,
  signUpWithEmail,
  startDiscordAuth,
} from './auth-client.js';

const loginTab = document.querySelector('#login-tab');
const signupTab = document.querySelector('#signup-tab');
const form = document.querySelector('#email-auth-form');
const submitButton = document.querySelector('#email-auth-submit');
const discordButton = document.querySelector('#discord-auth-button');
const discordLabel = document.querySelector('#discord-auth-label');
const confirmRow = document.querySelector('#confirm-password-row');
const confirmInput = document.querySelector('#auth-password-confirm');
const passwordInput = document.querySelector('#auth-password');
const feedback = document.querySelector('#auth-feedback');
let mode = new URLSearchParams(location.search).get('mode') === 'signup' ? 'signup' : 'login';

function showFeedback(message, kind = '') {
  feedback.textContent = message;
  feedback.className = `auth-feedback ${kind}`.trim();
}

function setMode(nextMode) {
  mode = nextMode;
  const signingUp = mode === 'signup';
  loginTab.classList.toggle('active', !signingUp);
  signupTab.classList.toggle('active', signingUp);
  loginTab.setAttribute('aria-selected', String(!signingUp));
  signupTab.setAttribute('aria-selected', String(signingUp));
  confirmRow.hidden = !signingUp;
  confirmInput.required = signingUp;
  passwordInput.autocomplete = signingUp ? 'new-password' : 'current-password';
  submitButton.textContent = signingUp ? 'Criar conta com e-mail' : 'Entrar com e-mail';
  discordLabel.textContent = signingUp ? 'Criar conta com Discord' : 'Entrar com Discord';
  showFeedback('');
}

async function finishAuthentication(session) {
  showFeedback('Acesso confirmado. Abrindo o arquivo...', 'success');
  const destination = await signedInDestination(session);
  window.location.replace(destination);
}

loginTab.addEventListener('click', () => setMode('login'));
signupTab.addEventListener('click', () => setMode('signup'));
discordButton.addEventListener('click', async () => {
  discordButton.disabled = true;
  showFeedback('Abrindo o Discord...');
  try { await startDiscordAuth(); }
  catch (error) { showFeedback(error.message, 'error'); discordButton.disabled = false; }
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = new FormData(form);
  const email = String(data.get('email') || '').trim();
  const password = String(data.get('password') || '');
  const confirmation = String(data.get('passwordConfirm') || '');
  if (mode === 'signup' && password !== confirmation) {
    showFeedback('As senhas não coincidem.', 'error');
    return;
  }
  submitButton.disabled = true;
  showFeedback(mode === 'signup' ? 'Criando sua conta...' : 'Verificando suas credenciais...');
  try {
    if (mode === 'signup') {
      const result = await signUpWithEmail(email, password);
      if (result.confirmationRequired) {
        setMode('login');
        showFeedback('Conta criada. Confirme o e-mail antes de entrar.', 'success');
        return;
      }
      await finishAuthentication(result.session);
    } else {
      await finishAuthentication(await signInWithEmail(email, password));
    }
  } catch (error) {
    showFeedback(error.message, 'error');
  } finally {
    submitButton.disabled = false;
  }
});

setMode(mode);
try {
  const oauthSession = consumeOAuthCallback();
  if (oauthSession) {
    await finishAuthentication(oauthSession);
  } else {
    const activeSession = await getUsableAuthSession();
    if (activeSession) {
      showFeedback('Sessão ativa. Abrindo seu painel...', 'success');
      await finishAuthentication(activeSession);
    }
  }
} catch (error) {
  showFeedback(error.message, 'error');
}
