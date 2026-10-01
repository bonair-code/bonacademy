/* BonAir — sso.js  (BonAppetit, BonCom ve SMS depolarında birebir aynı dosya)
 *
 * TEK ŞİFRE DEVRİ (SSO)
 * ---------------------
 * BonAppetit, BonCom ve SMS ayrı Firebase projeleridir; her birinin kendi
 * kullanıcı havuzu ve kendi şifresi vardır. Bir projedeki oturum diğerinde
 * geçerli değildir. Bu modül, bir kimlik kaynağını (IdP) kabul edip diğer
 * projelere oturum devreder:
 *
 *   1) launcher, IdP'nin ID token'ını hedef projenin `sso` ucuna yollar
 *      (action:'start'). Fonksiyon token'ı doğrular, custom claim'deki
 *      `apps` listesinde bu uygulama var mı bakar, e-postaya karşılık gelen
 *      YEREL hesabı bulur ve tek kullanımlık bir bilet üretir.
 *   2) launcher hedef uygulamayı  https://.../#sso=<bilet>  ile açar.
 *   3) Uygulama açılışta bileti aynı uca gönderir (action:'redeem'),
 *      karşılığında custom token alır ve signInWithCustomToken ile girer.
 *
 * Neden bilet? Custom token doğrudan adres çubuğunda taşınsaydı tarayıcı
 * geçmişinde 1 saat geçerli bir oturum anahtarı kalırdı. Bilet 90 saniye
 * yaşar, ilk kullanımda silinir ve tek başına hiçbir şeye yetmez.
 *
 * Hedef projede hesabı olmayan kullanıcıya oturum AÇILMAZ — sessizce hesap
 * yaratmak, rol/yetki alanları boş bir kullanıcı üretir ve uygulamanın kendi
 * yetki modelini delerdi. "Hesabınız yok" demek doğru cevaptır.
 *
 * HİÇBİR PROJE KİMLİĞİ VE ADRES BU DOSYADA GÖMÜLÜ DEĞİLDİR. Hepsi
 * makeSsoHandler'a parametre olarak gelir; SMS çok kiracılı olduğu için
 * (bkz. src/config/tenants.data.js) burada sabit bir proje kimliği tutmak,
 * kodu devralan başka bir şirketin kurulumuna BonAir'in kimlik kaynağını
 * açık bırakmak olurdu.
 */

const crypto = require("crypto");
/* firebase-admin MODÜLER API.
 *
 * Ad-alanlı sürüm — `admin.auth()`, `admin.firestore()` — firebase-admin
 * v14'te KALDIRILDI ve BonAcademy v14 kullanıyor. Modüler giriş noktaları
 * v10'dan beri var; bu yüzden dosya dört deponun hepsinde (v12, v13, v14)
 * değiştirilmeden çalışıyor ve "her yerde birebir aynı" özelliği korunuyor. */
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");

const TICKET_TTL_MS = 90 * 1000;
const TICKETS = "sso_tickets";

// Geliştirme sunucuları. Bilet üretmek için geçerli bir IdP token'ı
// gerektiğinden, localhost'un listede olması tek başına bir yetki vermez.
const DEV_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:5000",
  "http://localhost:3000",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:5000",
];

// ── Kimlik kaynağının auth handle'ı ───────────────────────────────
// verifyIdToken imzayı Google'ın açık anahtarlarıyla doğrular; başka bir
// projenin token'ı için o projeye erişim yetkisi GEREKMEZ, yalnızca proje
// kimliği gerekir. checkRevoked bilerek kapalı: o, IdP projesine okuma
// erişimi ister ve bizde yok.
const _idpApps = {};
function idpAuth(idpProjectId) {
  const self = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || "";
  if (self === idpProjectId) return getAuth();
  if (!_idpApps[idpProjectId]) {
    _idpApps[idpProjectId] = initializeApp(
      { projectId: idpProjectId },
      "bonair-idp-" + idpProjectId
    );
  }
  return getAuth(_idpApps[idpProjectId]);
}

function hashTicket(raw) {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

function applyCors(req, res, allowed) {
  const origin = req.headers.origin || "";
  if (!allowed.includes(origin)) return false;
  res.set("Access-Control-Allow-Origin", origin);
  res.set("Vary", "Origin");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");
  res.set("Access-Control-Max-Age", "3600");
  return true;
}

function fail(res, status, code, message) {
  res.status(status).json({ error: code, message: message });
}

/**
 * @param {object} cfg
 * @param {string} cfg.appId            Bu uygulamanın kimliği; IdP'deki
 *                                      `apps` claim'inde aranan değer.
 * @param {string} cfg.idpProjectId     Kimlik kaynağı Firebase projesi.
 * @param {string[]} cfg.launcherOrigins  Bilet İSTEYEBİLEN adresler.
 * @param {string[]} cfg.appOrigins       Bileti KULLANABİLEN adresler.
 * @param {boolean} [cfg.selfIssued]    IdP'nin kendisi mi? Öyleyse `apps`
 *                                      claim'i aranmaz — kullanıcı zaten bu
 *                                      projenin token'ıyla geldi.
 * @param {object} [cfg.requireProfile] Auth hesabının yanında personel
 *        kaydı da aransın mı? Aranmazsa kullanıcı oturum açar ve
 *        uygulamanın kendi ekranında ham bir hataya çarpar.
 * @param {string} cfg.requireProfile.collection  Koleksiyon adı, ör. "users".
 * @param {string} [cfg.requireProfile.matchField] Doküman kimliği uid ise
 *        boş bırakın; kayıt uid'yi bir ALANDA tutuyorsa o alanın adı.
 * @param {boolean} [cfg.requireEntitlement=true]  Kişiye özel yetki (IdP'deki
 *        `apps` claim'i) aransın mı? HERKESE AÇIK uygulamalarda false:
 *        o zaman tek kapı, bu uygulamada hesabının olması. Yetki listesini
 *        ayrıca tutmak, "hesabı var ama yetkisi verilmemiş" diye çalışmayan
 *        bir ara durum üretirdi.
 * @returns {(req, res) => Promise<void>}  onRequest gövdesi
 */
function makeSsoHandler(cfg) {
  const appId = cfg.appId;
  const idpProjectId = cfg.idpProjectId;
  const selfIssued = !!cfg.selfIssued;
  // Varsayılan true: yetki aramayı unutmak, yanlışlıkla herkese açmak olur.
  const requireEntitlement = cfg.requireEntitlement !== false;
  const requireProfile = cfg.requireProfile || null;
  const startOrigins = (cfg.launcherOrigins || []).concat(DEV_ORIGINS);
  const redeemOrigins = (cfg.appOrigins || []).concat(DEV_ORIGINS);

  if (!appId || !idpProjectId) {
    throw new Error("makeSsoHandler: appId ve idpProjectId zorunlu.");
  }
  if (requireProfile && !requireProfile.collection) {
    throw new Error("makeSsoHandler: requireProfile.collection zorunlu.");
  }

  return async function ssoHandler(req, res) {
    const action = (req.body || {}).action;

    // Preflight'ta hangi listeye bakacağımızı bilmediğimiz için ikisinin
    // birleşimini kabul ediyoruz; asıl kontrol POST'ta yapılıyor.
    if (req.method === "OPTIONS") {
      applyCors(req, res, startOrigins.concat(redeemOrigins));
      res.status(204).send("");
      return;
    }
    if (req.method !== "POST") {
      fail(res, 405, "method-not-allowed", "POST bekleniyor.");
      return;
    }

    const allowed = action === "redeem" ? redeemOrigins : startOrigins;
    if (!applyCors(req, res, allowed)) {
      /* Origin BAŞLIĞI YOKSA istek bir tarayıcıdan gelmiyor: mobil uygulama
       * (React Native fetch'i Origin göndermez), sunucu ya da curl.
       *
       * Bunlara `start` için izin veriliyor. CORS'u bir güvenlik duvarı
       * sanmamak gerekir: yalnız TARAYICIYI bağlar, başka bir sayfanın
       * kullanıcının kimliğiyle bu ucu çağırmasını engeller. Origin
       * göndermeyen bir istemci zaten en baştan beri çağırabiliyordu —
       * bu izin yeni bir kapı açmıyor, var olanı dürüstçe kabul ediyor.
       * Asıl kapı değişmedi: imzalı ID token, hesap/profil kontrolü ve
       * 90 saniyelik tek kullanımlık bilet.
       *
       * `redeem` ve `roster` DIŞARIDA: ikisi de tarayıcıdan çağrılıyor,
       * orada Origin var ve dar tutmanın bedeli yok. */
      const yerliIstemci = !req.headers.origin && action === "start";
      if (!yerliIstemci) {
        fail(res, 403, "origin-not-allowed", "Bu adres için izin yok.");
        return;
      }
    }

    /* Her istek için tek satır erişim kaydı.
     *
     * Olmadığı sürece hata ayıklamak tahmine dayanıyordu: Cloud Run yalnız
     * HTTP kodunu kaydediyor, hangi adımın (start/redeem/roster) çalıştığını
     * söylemiyor. "Bilet üretildi ama kullanılmadı" ile "bilet hiç
     * üretilmedi" ayrımı bu satır olmadan görünmüyor.
     *
     * Bilet ve token BİLEREK yazılmıyor — log'a düşen bir bilet, oturum
     * açmaya yeter. */
    const t0 = Date.now();
    try {
      if (action === "start") {
        return await start(req, res, appId, idpProjectId,
          selfIssued || !requireEntitlement, requireProfile);
      }
      if (action === "redeem") return await redeem(req, res);
      if (action === "roster") {
        return await roster(req, res, appId, idpProjectId, requireProfile);
      }
      fail(res, 400, "bad-action", "action 'start', 'redeem' veya 'roster' olmali.");
    } catch (err) {
      console.error("[sso:" + appId + "] " + action + " hatasi:", err);
      fail(res, 500, "internal", "Beklenmeyen hata.");
    } finally {
      console.log("[sso:" + appId + "] " + (action || "-") + " -> " +
        res.statusCode + " (" + (Date.now() - t0) + "ms) origin=" + (req.headers.origin || "-"));
    }
  };
}

async function start(req, res, appId, idpProjectId, yetkiSiz, requireProfile) {
  const idToken = (req.body || {}).idToken;
  if (!idToken || typeof idToken !== "string") {
    return fail(res, 400, "missing-token", "idToken zorunlu.");
  }

  let decoded;
  try {
    decoded = await idpAuth(idpProjectId).verifyIdToken(idToken);
  } catch (err) {
    return fail(res, 401, "invalid-token", "Oturum doğrulanamadı, tekrar giriş yapın.");
  }

  // Yetki aranmayan iki durum: (1) kimlik kaynağının kendisi — kullanıcı
  // zaten o projenin hesabıyla doğrulandı; (2) herkese açık uygulama —
  // tek kapı, bu uygulamada hesabının olması. İkisi de çağrı noktasında
  // yetkiSiz olarak geliyor.
  if (!yetkiSiz) {
    const apps = Array.isArray(decoded.apps) ? decoded.apps : [];
    if (!apps.includes(appId)) {
      return fail(res, 403, "not-entitled", "Bu uygulama için yetkiniz yok.");
    }
  }

  const email = (decoded.email || "").toLowerCase().trim();
  if (!email) {
    return fail(res, 400, "no-email", "Hesapta e-posta adresi yok.");
  }

  // Yerel hesabı E-POSTA ile eşleştiriyoruz. uid'ler projeler arasında
  // farklıdır; hedef projede users/{uid} altında duran rol ve geçmişin
  // sahibi o projenin uid'sidir, kimlik kaynağınınki değil.
  let localUser;
  try {
    localUser = await getAuth().getUserByEmail(email);
  } catch (err) {
    if (err && err.code === "auth/user-not-found") {
      return fail(res, 404, "no-account", "Bu uygulamada hesabınız bulunmuyor.");
    }
    throw err;
  }
  if (localUser.disabled) {
    return fail(res, 403, "disabled", "Hesabınız kapatılmış.");
  }

  // Auth hesabı olmak yetmiyor: bu uygulamalar rolü, departmanı ve yetkileri
  // personel kaydında tutuyor ve kaydı olmayan kullanıcıyı zaten içeri
  // almıyorlar. Burada bakmasak oturumu açar, sonra uygulamanın kendi
  // ekranında "profile not found" gibi ham bir hataya çarpardı — üstelik
  // launcher'a dönüp durumu anlaması mümkün olmazdı.
  if (requireProfile) {
    const col = getFirestore().collection(requireProfile.collection);
    let profilVar;
    if (requireProfile.matchField) {
      const q = await col.where(requireProfile.matchField, "==", localUser.uid).limit(1).get();
      profilVar = !q.empty;
    } else {
      const snap = await col.doc(localUser.uid).get();
      profilVar = snap.exists;
    }
    if (!profilVar) {
      return fail(res, 404, "no-profile",
        "Bu uygulamada hesabınız var ama personel kaydınız tanımlı değil.");
    }
  }

  const raw = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + TICKET_TTL_MS);
  // Biletin kendisi değil, özeti saklanır: veritabanını okuyabilen biri
  // (yedek, log, yanlış kural) elindekiyle oturum açamasın.
  await getFirestore().collection(TICKETS).doc(hashTicket(raw)).set({
    uid: localUser.uid,
    email: email,
    appId: appId,
    idpUid: decoded.uid,
    createdAt: FieldValue.serverTimestamp(),
    expiresAt: Timestamp.fromDate(expiresAt),
  });

  res.json({ ticket: raw, expiresIn: Math.floor(TICKET_TTL_MS / 1000) });
}

/* Bu uygulamada GERÇEKTEN kullanıcısı olanların e-posta listesi.
 *
 * Neden var: yetkiyi elle vermek, iki listeyi (buradaki hesaplar ve
 * BonAppetit'teki `uygulamalar` alanı) sürekli el yordamıyla aynı tutmayı
 * gerektiriyor ve kaçınılmaz olarak kayıyorlar. Kaynak listeyi buradan
 * okumak, yetkiyi "kimin hesabı var" gerçeğine bağlıyor.
 *
 * BonAppetit'in fonksiyonları bu projenin veritabanını OKUYAMAZ (ayrı proje,
 * ayrı servis hesabı); bu yüzden liste, isteyene karşı burada üretiliyor.
 *
 * Yalnız BonAppetit yöneticisi çağırabilir: `bonairAdmin` claim'i, personel
 * kaydındaki role alanından türetilip imzalı token'a basılıyor. Personel
 * e-postalarının tamamı, kurum dışına sızmaması gereken bir liste. */
async function roster(req, res, appId, idpProjectId, requireProfile) {
  const idToken = (req.body || {}).idToken;
  if (!idToken || typeof idToken !== "string") {
    return fail(res, 400, "missing-token", "idToken zorunlu.");
  }

  let decoded;
  try {
    decoded = await idpAuth(idpProjectId).verifyIdToken(idToken);
  } catch (err) {
    return fail(res, 401, "invalid-token", "Oturum doğrulanamadı, tekrar giriş yapın.");
  }
  if (decoded.bonairAdmin !== true) {
    return fail(res, 403, "not-admin", "Bu işlem için yönetici yetkisi gerekir.");
  }

  // Auth hesapları — sayfa sayfa, kapatılmış ve e-postasız kayıtlar elenir.
  const hesaplar = [];
  let sayfa;
  do {
    const r = await getAuth().listUsers(1000, sayfa);
    r.users.forEach((u) => {
      if (!u.disabled && u.email) hesaplar.push({ uid: u.uid, email: u.email.toLowerCase().trim() });
    });
    sayfa = r.pageToken;
  } while (sayfa);

  // Personel kaydı da şartsa, koleksiyon TEK SEFERDE okunup kümeye alınır;
  // hesap başına sorgu, birkaç yüz kişide fonksiyonu zaman aşımına düşürürdü.
  let izinli = hesaplar;
  if (requireProfile) {
    const snap = await getFirestore().collection(requireProfile.collection).get();
    const kume = new Set();
    snap.forEach((d) => {
      if (requireProfile.matchField) {
        const v = (d.data() || {})[requireProfile.matchField];
        if (v) kume.add(v);
      } else {
        kume.add(d.id);
      }
    });
    izinli = hesaplar.filter((h) => kume.has(h.uid));
  }

  const emails = Array.from(new Set(izinli.map((h) => h.email))).sort();
  console.log("[sso:" + appId + "] roster: " + emails.length + " kullanici (" +
    hesaplar.length + " auth hesabi)");
  res.json({ appId: appId, emails: emails, authCount: hesaplar.length });
}

async function redeem(req, res) {
  const ticket = (req.body || {}).ticket;
  if (!ticket || typeof ticket !== "string") {
    return fail(res, 400, "missing-ticket", "ticket zorunlu.");
  }

  const ref = getFirestore().collection(TICKETS).doc(hashTicket(ticket));

  // Okuma ve silme tek işlemde: aynı bilet iki sekmede aynı anda
  // kullanılırsa yalnızca biri token alsın.
  let uid;
  try {
    uid = await getFirestore().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new Error("gone");
      const data = snap.data() || {};
      const exp = data.expiresAt && data.expiresAt.toMillis ? data.expiresAt.toMillis() : 0;
      tx.delete(ref);
      if (Date.now() > exp) throw new Error("expired");
      return data.uid;
    });
  } catch (err) {
    if (err && (err.message === "gone" || err.message === "expired")) {
      return fail(res, 401, "ticket-invalid", "Giriş bağlantısının süresi doldu, tekrar deneyin.");
    }
    throw err;
  }

  const token = await getAuth().createCustomToken(uid, { sso: true });
  res.json({ token: token });
}

module.exports = { makeSsoHandler: makeSsoHandler, TICKETS: TICKETS, DEV_ORIGINS: DEV_ORIGINS };
