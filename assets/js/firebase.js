// Configuracion Firebase
const firebaseConfig = {
  apiKey:            "AIzaSyAGt43raW8IYHm-jwj4lj3sH011XiS4WDY",
  authDomain:        "control-gastos-3424e.firebaseapp.com",
  projectId:         "control-gastos-3424e",
  storageBucket:     "control-gastos-3424e.firebasestorage.app",
  messagingSenderId: "93760597653",
  appId:             "1:93760597653:web:03b7ab76fe6ef8ee62759c"
};

firebase.initializeApp(firebaseConfig);

const db   = firebase.firestore();
const auth = firebase.auth();
const googleProvider = new firebase.auth.GoogleAuthProvider();

// Referencia al documento del usuario actual
function userDocRef(uid) {
  return db.collection('ctrl_gastos').doc(uid);
}
