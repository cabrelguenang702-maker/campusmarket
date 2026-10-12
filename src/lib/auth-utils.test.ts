import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyAuthError,
  formatCameroonPhone,
  hasAnyRole,
  initialsOf,
  isCameroonMobile,
  isGuestOnlyPath,
  isStrongPassword,
  isValidEmail,
  looksLikeEmail,
  passwordRuleResults,
  safeRedirectPath,
  toE164,
} from "./auth-utils.ts";

test("isValidEmail", () => {
  assert.ok(isValidEmail("nom@universite.cm"));
  assert.ok(isValidEmail("  nom@universite.cm  "));
  for (const bad of ["", "nom", "nom@", "@x.cm", "nom@x", "a b@x.cm", "a@@x.cm"])
    assert.ok(!isValidEmail(bad), bad);
  assert.ok(!isValidEmail("a".repeat(250) + "@x.cm"), "trop long");
});

test("mot de passe : règles et force", () => {
  assert.ok(!isStrongPassword("Court1"));
  assert.ok(!isStrongPassword("sansmajuscule12"));
  assert.ok(!isStrongPassword("SansChiffreDuTout"));
  assert.ok(isStrongPassword("Assez1Longue"));
  assert.deepEqual(
    passwordRuleResults("abc").map((r) => r.ok),
    [false, false, false],
  );
  assert.deepEqual(
    passwordRuleResults("Abcdefghij1").map((r) => r.ok),
    [true, true, true],
  );
});

test("toE164 : mêmes numéros quelle que soit la saisie", () => {
  const expected = "+237612345678";
  for (const input of [
    "612345678",
    "6 12 34 56 78",
    "0612345678",
    "06 12 34 56 78",
    "+237 6 12 34 56 78",
    "+237612345678",
    "00237612345678",
    "(6) 12-34-56.78",
    "  612345678  ",
  ]) {
    assert.equal(toE164("+237", input), expected, input);
  }
  assert.equal(toE164("+237", ""), null);
  assert.equal(toE164("+237", "abc"), null);
  assert.equal(toE164("+237", "000"), null, "que des zéros");
  assert.equal(toE164("+225", "07 12 34 56 78"), "+225712345678");
});

test("toE164 : un 0 de tête n'est retiré qu'une fois l'indicatif traité (pas de chiffres perdus)", () => {
  assert.equal(toE164("+237", "+237 0612345678"), "+237612345678");
  assert.equal(
    toE164("+237", "237612345678"),
    "+237237612345678",
    "sans + ni 00, 237 est une partie du numéro saisi",
  );
});

test("isCameroonMobile : même règle que les Edge Functions", () => {
  assert.ok(isCameroonMobile("+237612345678"));
  assert.ok(isCameroonMobile("+237212345678"));
  for (const bad of [
    "+237112345678",
    "+23761234567",
    "+2376123456789",
    "+225712345678",
    "237612345678",
    "+237 612345678",
  ]) {
    assert.ok(!isCameroonMobile(bad), bad);
  }
});

test("formatCameroonPhone", () => {
  assert.equal(formatCameroonPhone("+237612345678"), "+237 6 12 34 56 78");
  assert.equal(formatCameroonPhone("+225712345678"), "+225712345678", "autre pays : inchangé");
});

test("looksLikeEmail", () => {
  assert.ok(looksLikeEmail("a@b.cm"));
  assert.ok(!looksLikeEmail("+237612345678"));
});

test("classifyAuthError : par code d'abord", () => {
  assert.equal(
    classifyAuthError({ code: "invalid_credentials", status: 400 }),
    "invalid_credentials",
  );
  assert.equal(
    classifyAuthError({ code: "email_not_confirmed", status: 400 }),
    "email_not_confirmed",
  );
  assert.equal(
    classifyAuthError({ code: "user_already_exists", status: 422 }),
    "already_registered",
  );
  assert.equal(
    classifyAuthError({ code: "over_email_send_rate_limit", status: 429 }),
    "rate_limited",
  );
  assert.equal(classifyAuthError({ code: "otp_expired", status: 403 }), "code_invalid_or_expired");
  assert.equal(classifyAuthError({ code: "weak_password", status: 422 }), "weak_password");
  assert.equal(classifyAuthError({ code: "same_password", status: 422 }), "same_password");
  assert.equal(classifyAuthError({ code: "signup_disabled", status: 422 }), "signup_disabled");
});

test("classifyAuthError : réseau, configuration, repli", () => {
  assert.equal(classifyAuthError({ name: "AuthRetryableFetchError", status: 0 }), "network");
  assert.equal(classifyAuthError({ name: "TypeError", message: "Failed to fetch" }), "network");
  assert.equal(classifyAuthError({ name: "ConfigError" }), "not_configured");
  assert.equal(classifyAuthError({ status: 429 }), "rate_limited");
  assert.equal(
    classifyAuthError({ status: 400, message: "Invalid login credentials" }),
    "invalid_credentials",
  );
  assert.equal(
    classifyAuthError({ status: 400, message: "Token has expired or is invalid" }),
    "code_invalid_or_expired",
  );
  assert.equal(classifyAuthError({ status: 500, message: "boom" }), "unknown");
  assert.equal(classifyAuthError(null), "unknown");
  assert.equal(classifyAuthError(undefined), "unknown");
});

test("chemins réservés aux visiteurs : les étapes qui exigent une session n'en font pas partie", () => {
  for (const p of [
    "/connexion",
    "/bienvenue",
    "/inscription/pays",
    "/mot-de-passe-oublie",
    "/connexion/",
  ]) {
    assert.ok(isGuestOnlyPath(p), p);
  }
  // Ces écrans se visitent CONNECTÉ : après la vérification de l'e-mail (session ouverte) ou du code
  // de récupération (session de récupération). Les rediriger vers l'accueil casserait le parcours.
  // /inscription/email et otp-email : la session s'ouvre pendant ces écrans, ils gèrent « déjà connecté » eux-mêmes.
  for (const p of [
    "/inscription/email",
    "/inscription/otp-email",
    "/inscription/telephone",
    "/inscription/otp-telephone",
    "/inscription/universite",
    "/inscription/compte-cree",
    "/reinitialisation/code",
    "/reinitialisation/nouveau-mot-de-passe",
    "/",
    "/marketplace",
  ]) {
    assert.ok(!isGuestOnlyPath(p), p);
  }
});

test("rôles", () => {
  assert.ok(hasAnyRole(["student", "moderator"], ["moderator", "admin"]));
  assert.ok(!hasAnyRole(["student"], ["moderator", "admin"]));
  assert.ok(!hasAnyRole([], ["admin"]));
});

test("initialesOf", () => {
  assert.equal(initialsOf("Jean Dupont"), "JD");
  assert.equal(initialsOf("  jean  "), "J");
  assert.equal(initialsOf("Jean Pierre Dupont"), "JD");
  assert.equal(initialsOf(""), "?");
});

test("safeRedirectPath : seuls les chemins internes sont acceptés (pas de redirection ouverte)", () => {
  assert.equal(safeRedirectPath("/marketplace?q=a"), "/marketplace?q=a");
  assert.equal(safeRedirectPath("/produit/abc"), "/produit/abc");
  for (const bad of [
    "https://pirate.example",
    "//pirate.example",
    "/\\pirate.example",
    "javascript:alert(1)",
    "pirate",
    "",
    "/ok\nSet-Cookie:x",
    "/\u0000x",
  ]) {
    assert.equal(safeRedirectPath(bad), "/", JSON.stringify(bad));
  }
  assert.equal(safeRedirectPath(null), "/");
  assert.equal(safeRedirectPath(undefined, "/accueil"), "/accueil");
  assert.equal(safeRedirectPath("/" + "a".repeat(600)), "/", "trop long");
  // Ne jamais renvoyer vers un écran d'authentification (boucle ou parcours d'inscription rejoué).
  for (const loop of [
    "/connexion",
    "/connexion?x=1",
    "/inscription/pays",
    "/bienvenue",
    "/mot-de-passe-oublie",
    "/reinitialisation/code",
  ]) {
    assert.equal(safeRedirectPath(loop), "/", loop);
  }
  assert.equal(
    safeRedirectPath("/connexions-utiles"),
    "/connexions-utiles",
    "préfixe seulement : autorisé",
  );
});
