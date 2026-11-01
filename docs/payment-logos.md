# Logos des moyens de paiement

Les logos sont des PNG transparents stockés localement dans `public/images/payments` (web) et `mobile/assets/payments` (Android). Ils sont servis par l'application, sans CDN ni appel réseau externe, afin de fonctionner hors ligne et d'être inclus dans les exports OTA.

## Sources

Les fichiers ont été collectés depuis des sources officielles ou des banques d'images de marques :

- **Wikimedia Commons** : Visa, Mastercard, American Express, PayPal, SEPA, iDEAL, Bancontact, Giropay, TWINT, MB WAY, Interac, etc.
- **Sites officiels des marques** : Wave (`wave.com`), PCS (`mypcs.com`), Bancomat, Wero, Paylib, Payconiq, Bizum, Postepay, Revolut, Monzo, Cash App, Venmo, Zelle, Ozow, Capitec, M-Pesa, Orange Money, MTN MoMo, Moov Money, Airtel Money, etc.
- **Fiches Google Play officielles** : D17, InstaPay, MTN MoMo, Orange Money, Moov Money, M-Pesa, Airtel Money, PalmPay, Moniepoint, MVola, Wave, etc. Les icônes d'application sont utilisées pour les opérateurs dont le logo carré est le plus lisible dans les interfaces compactes.
- **Hunter Logo API / logos officiels** : Transcash, Paysafecard, Neosurf, Amazon, Apple, Stripe, etc.
- **Images de présentation officielles** : Flooz (Moov Africa Togo).

Les fichiers sont recadrés sur leur contenu et limités à 160 px de côté. Les variantes carrées sont privilégiées pour les cartes de méthode et les bandeaux d'opérateurs ; les wordmarks sont affichés en plus grand dans les sélecteurs de cartes cadeaux.

## Affichage

- `PaymentMethodMark` affiche les logos réels des services pour PayPal, les cartes (Visa / Mastercard / Amex), SEPA et Mobile Money.
- Le bandeau `MobileMoneyBrandStrip` affiche les opérateurs réellement proposés dans le pays sélectionné (`countryConfig.code`). La correspondance pays → opérateurs se trouve dans `src/lib/payment-logos.ts` et `mobile/src/lib/payment-logos.ts`.
- `GiftCardMark` affiche le logo de chaque carte cadeau dans les sélecteurs Transcash, PCS, Paysafecard, Neosurf, Amazon, Apple, Visa, Mastercard et Amex.
- Un repli sur une icône neutre reste utilisé pour les catégories sans marque identifiable ou lorsqu'aucun logo n'est disponible.

## Marques

Les marques et logos restent la propriété exclusive de leurs titulaires. Leur présence dans l'interface identifie le service de paiement proposé ; elle ne garantit ni l'acceptation de chaque carte, ni la disponibilité du service dans tous les pays. Les conditions d'utilisation de chaque marque s'appliquent.
