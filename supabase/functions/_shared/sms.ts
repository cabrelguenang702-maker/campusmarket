// -----------------------------------------------------------------------------
// Abstraction d'envoi de SMS — AUCUN prestataire n'est branché ici. Contrairement
// à CamPay pour les paiements (choisi et intégré), aucun fournisseur SMS n'a
// été désigné pour CampusMarket. sendSms() lève volontairement une erreur
// explicite tant qu'un vrai prestataire n'est pas configuré, plutôt que de
// silencieusement ne rien envoyer — pour que l'absence de configuration soit
// immédiatement visible en test, pas découverte en prod quand un utilisateur
// ne reçoit jamais son code.
//
// Options courantes pour des numéros camerounais : Twilio (couverture
// MTN/Orange Cameroun via SMS international, plus cher), ou un agrégateur
// local (ex. Nexah, Nimba SMS) en général plus fiable et moins cher sur le
// marché camerounais — à valider selon les volumes attendus.
// -----------------------------------------------------------------------------

export async function sendSms(phoneNumber: string, message: string): Promise<void> {
  const provider = Deno.env.get("SMS_PROVIDER");

  if (!provider) {
    throw new Error(
      "Aucun prestataire SMS configuré (variable SMS_PROVIDER absente). " +
      "Voir _shared/sms.ts : choisir un prestataire (Twilio, Nexah, Nimba SMS...) " +
      "et implémenter l'appel HTTP correspondant avant la mise en production.",
    );
  }

  // TODO Cabrel : brancher l'appel réel une fois le prestataire choisi, ex. :
  //   if (provider === "twilio") { ...fetch vers l'API Twilio... ; return; }
  throw new Error(`Prestataire SMS "${provider}" déclaré mais pas encore implémenté dans _shared/sms.ts`);
}
