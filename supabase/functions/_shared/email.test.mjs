// Test de _shared/email.ts (aucun accès réseau : `fetch` est simulé).
// Exécution, depuis supabase/functions/_shared :
//   tsc --ignoreConfig --target es2022 --module esnext --moduleResolution bundler \
//       --lib es2022,dom --skipLibCheck --outDir /tmp/email-out email.ts
//   echo '{"type":"module"}' > /tmp/email-out/package.json
//   cp email.test.mjs /tmp/email-out/ && node /tmp/email-out/email.test.mjs
// (le message "Cannot find name 'Deno'" de tsc est attendu hors runtime Deno).
import assert from 'node:assert/strict';

const env = {};
globalThis.Deno = { env: { get: (k) => env[k] } };
let calls = [];
let nextResponse = { ok: true, status: 200, text: '' };
let nextThrow = null;
globalThis.fetch = async (url, init) => {
  calls.push({ url, init });
  if (nextThrow) throw nextThrow;
  return { ok: nextResponse.status < 300, status: nextResponse.status, text: async () => nextResponse.text };
};

const { sendEmail, parseSender, EmailError } = await import('./email.js');

function reset(e = {}) {
  for (const k of Object.keys(env)) delete env[k];
  Object.assign(env, e);
  calls = []; nextResponse = { status: 200, text: '' }; nextThrow = null;
}
async function rejects(fn, permanent, msgPart) {
  try { await fn(); } catch (e) {
    assert.ok(e instanceof EmailError, 'doit être une EmailError, reçu: ' + e);
    assert.equal(e.permanent, permanent, `permanent attendu=${permanent} pour: ${e.message}`);
    if (msgPart) assert.ok(e.message.includes(msgPart), `message doit contenir "${msgPart}": ${e.message}`);
    return;
  }
  assert.fail('devait lever une exception');
}
let n = 0; const ok = (name) => console.log(`  ok ${++n} - ${name}`);

// --- configuration ---
reset();
await rejects(() => sendEmail('a@b.c', 's', 't'), true, 'EMAIL_PROVIDER absente');
assert.equal(calls.length, 0); ok('aucun prestataire -> échec explicite, aucun appel réseau');

reset({ EMAIL_PROVIDER: 'resend' });
await rejects(() => sendEmail('a@b.c', 's', 't'), true, 'EMAIL_API_KEY'); ok('clé absente -> échec explicite');

reset({ EMAIL_PROVIDER: 'resend', EMAIL_API_KEY: 'k' });
await rejects(() => sendEmail('a@b.c', 's', 't'), true, 'EMAIL_FROM'); ok('expéditeur absent -> échec explicite');

reset({ EMAIL_PROVIDER: 'sendgrid', EMAIL_API_KEY: 'k', EMAIL_FROM: 'x@y.z' });
await rejects(() => sendEmail('a@b.c', 's', 't'), true, 'inconnu');
assert.equal(calls.length, 0); ok('prestataire inconnu -> échec explicite');

reset({ EMAIL_PROVIDER: 'MailGun', EMAIL_API_KEY: 'k', EMAIL_FROM: 'x@y.z' });
await rejects(() => sendEmail('a@b.c', 's', 't'), true, 'MAILGUN_DOMAIN'); ok('mailgun sans domaine -> échec explicite (et casse insensible)');

// --- Resend ---
reset({ EMAIL_PROVIDER: 'resend', EMAIL_API_KEY: 're_123', EMAIL_FROM: 'CampusMarket <n@campusmarket.cm>' });
await sendEmail('user@ex.com', 'Sujet', 'Corps');
let c = calls[0];
assert.equal(c.url, 'https://api.resend.com/emails');
assert.equal(c.init.headers.Authorization, 'Bearer re_123');
assert.deepEqual(JSON.parse(c.init.body), { from: 'CampusMarket <n@campusmarket.cm>', to: ['user@ex.com'], subject: 'Sujet', text: 'Corps' });
ok('Resend : URL, Bearer, corps {from,to[],subject,text}');

// --- Brevo ---
reset({ EMAIL_PROVIDER: 'brevo', EMAIL_API_KEY: 'xkeysib-1', EMAIL_FROM: 'CampusMarket <n@campusmarket.cm>' });
await sendEmail('user@ex.com', 'Sujet', 'Corps');
c = calls[0];
assert.equal(c.url, 'https://api.brevo.com/v3/smtp/email');
assert.equal(c.init.headers['api-key'], 'xkeysib-1');
assert.equal(c.init.headers.Authorization, undefined);
assert.deepEqual(JSON.parse(c.init.body), { sender: { name: 'CampusMarket', email: 'n@campusmarket.cm' }, to: [{ email: 'user@ex.com' }], subject: 'Sujet', textContent: 'Corps' });
ok('Brevo : URL, en-tête api-key, sender scindé {name,email}, textContent');

reset({ EMAIL_PROVIDER: 'brevo', EMAIL_API_KEY: 'k', EMAIL_FROM: 'n@campusmarket.cm' });
await sendEmail('user@ex.com', 'S', 'T');
assert.deepEqual(JSON.parse(calls[0].init.body).sender, { email: 'n@campusmarket.cm' });
ok('Brevo : expéditeur sans nom accepté');

// --- Mailgun ---
reset({ EMAIL_PROVIDER: 'mailgun', EMAIL_API_KEY: 'key-abc', EMAIL_FROM: 'n@mg.campusmarket.cm', MAILGUN_DOMAIN: 'mg.campusmarket.cm' });
await sendEmail('user@ex.com', 'Sujet é', 'Corps & suite');
c = calls[0];
assert.equal(c.url, 'https://api.mailgun.net/v3/mg.campusmarket.cm/messages');
assert.equal(c.init.headers.Authorization, 'Basic ' + Buffer.from('api:key-abc').toString('base64'));
assert.equal(c.init.headers['Content-Type'], 'application/x-www-form-urlencoded');
const form = new URLSearchParams(c.init.body);
assert.equal(form.get('from'), 'n@mg.campusmarket.cm'); assert.equal(form.get('to'), 'user@ex.com');
assert.equal(form.get('subject'), 'Sujet é'); assert.equal(form.get('text'), 'Corps & suite');
ok('Mailgun : URL avec domaine, Basic api:clé, corps form-urlencoded (accents et & correctement encodés)');

reset({ EMAIL_PROVIDER: 'mailgun', EMAIL_API_KEY: 'k', EMAIL_FROM: 'x@y.z', MAILGUN_DOMAIN: 'd.cm', MAILGUN_REGION: 'EU' });
await sendEmail('a@b.c', 's', 't');
assert.equal(calls[0].url, 'https://api.eu.mailgun.net/v3/d.cm/messages');
ok('Mailgun : région UE (casse insensible)');

// --- classification des erreurs ---
const base = { EMAIL_PROVIDER: 'resend', EMAIL_API_KEY: 'k', EMAIL_FROM: 'x@y.z' };
for (const [status, permanent] of [[401, true], [403, true], [422, true], [400, true], [429, false], [500, false], [503, false]]) {
  reset(base); nextResponse = { status, text: '{"message":"détail"}' };
  await rejects(() => sendEmail('a@b.c', 's', 't'), permanent, `HTTP ${status}`);
  ok(`HTTP ${status} -> ${permanent ? 'permanente (pas de retry)' : 'transitoire (retry)'}`);
}
reset(base); nextResponse = { status: 401, text: 'x'.repeat(5000) };
try { await sendEmail('a@b.c', 's', 't'); } catch (e) { assert.ok(e.message.length < 400, 'le détail doit être tronqué'); }
ok('corps d\'erreur du prestataire tronqué (pas de log géant)');

reset(base); nextThrow = new Error('fetch failed');
await rejects(() => sendEmail('a@b.c', 's', 't'), false, 'appel impossible'); ok('erreur réseau -> transitoire');

// --- parseSender ---
assert.deepEqual(parseSender('"Campus, Market" <a@b.c>'), { name: 'Campus, Market', email: 'a@b.c' });
assert.deepEqual(parseSender('  a@b.c  '), { email: 'a@b.c' });
assert.deepEqual(parseSender('<a@b.c>'), { email: 'a@b.c' });
ok('parseSender : nom entre guillemets avec virgule, espaces, chevrons seuls');

console.log(`\n${n} vérifications OK`);
