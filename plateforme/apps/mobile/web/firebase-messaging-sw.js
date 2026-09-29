/*
 * LE SERVICE WORKER DES NOTIFICATIONS POUSSÉES, POUR LE WEB.
 *
 * Firebase Messaging exige ce fichier à cette adresse exacte. Il tourne hors de
 * l'application, donc sans ses --dart-define : la configuration est écrite ici
 * par l'étape de construction (`tools/packager.sh web`) depuis les mêmes
 * variables, et le fichier commité ne porte que des places vides.
 *
 * ⚠ Sans configuration, `initializeApp` reçoit des chaînes vides et le
 * worker ne fait rien — l'application web interroge, comme avant.
 */
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');

const config = {
  apiKey: '__FIREBASE_API_KEY__',
  appId: '__FIREBASE_APP_ID__',
  projectId: '__FIREBASE_PROJECT_ID__',
  messagingSenderId: '__FIREBASE_SENDER_ID__',
};

if (!config.apiKey.startsWith('__')) {
  firebase.initializeApp(config);
  firebase.messaging();
}
