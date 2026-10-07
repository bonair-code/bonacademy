import type { Lang } from "./lang";

/**
 * Sınav giriş ve sınav ekranının metinleri. Öğrenci giriş ekranında sınav
 * dilini bayrakla seçiyor; ekran da o dile dönüyor. Uygulamanın geri kalanı
 * İngilizce.
 */
export type ExamText = {
  eyebrow: string;
  intro: string;
  questions: string;
  duration: string;
  noLimit: string;
  minutes: (n: number) => string;
  passMark: string;
  attempt: string;
  language: string;
  shuffled: (bank: number) => string;
  perQuestion: (pts: string) => string;
  rulesTitle: string;
  rules: (o: { timed: boolean; maxAttempts: number }) => string[];
  agree: string;
  start: string;
  starting: string;
  back: string;
  noQuestions: string;
  resumeTitle: string;
  resumeBody: (min: number | null) => string;
  resume: string;
  // Sınav ekranı
  examLabel: (attempt: number) => string;
  answered: (n: number, total: number) => string;
  timeLeft: string;
  questionOf: (i: number, total: number) => string;
  clear: string;
  prev: string;
  next: string;
  submit: string;
  submitting: string;
  unanswered: (n: number) => string;
  unansweredHint: string;
  submitAnyway: string;
  firstUnanswered: string;
  timeUp: string;
  lastMinute: string;
};

const TR: ExamText = {
  eyebrow: "Final Sınavı",
  intro: "Tüm bölümleri tamamladınız. Başlamadan önce sınav bilgilerini okuyun.",
  questions: "Soru",
  duration: "Süre",
  noLimit: "Sınırsız",
  minutes: (n) => `${n} dk`,
  passMark: "Geçme notu",
  attempt: "Deneme hakkı",
  language: "Sınav dili",
  shuffled: (bank) => `Sorular ${bank} soruluk bankadan karışık seçilir`,
  perQuestion: (pts) => `Her soru ${pts} puan`,
  rulesTitle: "Sınav kuralları",
  rules: ({ timed, maxAttempts }) => [
    ...(timed
      ? ["Sınav başladığında süre işlemeye başlar; süre dolunca cevaplarınız otomatik gönderilir."]
      : []),
    "Sorular arasında serbestçe ileri-geri geçebilir, göndermeden önce cevabınızı değiştirebilirsiniz.",
    "“Sınavı bitir ve gönder” dediğinizde sınav kapanır, cevaplar değiştirilemez.",
    timed
      ? "Sayfayı kapatsanız da süre işlemeye devam eder; döndüğünüzde kaldığınız yerden devam edersiniz."
      : "Sayfayı kapatırsanız döndüğünüzde aynı sorularla kaldığınız yerden devam edersiniz.",
    `Toplam ${maxAttempts} deneme hakkınız var. ${maxAttempts}. denemede de geçemezseniz eğitim materyalini yeniden tamamlamanız gerekir.`,
  ],
  agree: "Kuralları okudum ve sınava hazırım.",
  start: "Sınavı başlat",
  starting: "Hazırlanıyor…",
  back: "← Panele dön",
  noQuestions: "Bu dilde soru yok",
  resumeTitle: "Devam eden bir sınavınız var",
  resumeBody: (min) =>
    min == null
      ? "Kaldığınız yerden, aynı sorularla devam edeceksiniz."
      : `Kalan süre yaklaşık ${min} dakika. Süre siz yokken de işlemeye devam etti.`,
  resume: "Sınava devam et",
  examLabel: (n) => `Sınav · ${n}. deneme`,
  answered: (n, t) => `${n} / ${t} cevaplandı`,
  timeLeft: "Kalan süre",
  questionOf: (i, t) => `Soru ${i} / ${t}`,
  clear: "Cevabı temizle",
  prev: "← Önceki",
  next: "Sonraki →",
  submit: "Sınavı bitir ve gönder",
  submitting: "Gönderiliyor…",
  unanswered: (n) => `${n} soru cevapsız.`,
  unansweredHint: "Cevapsız sorular yanlış sayılır. Geri dönüp tamamlayabilirsiniz.",
  submitAnyway: "Yine de gönder",
  firstUnanswered: "İlk cevapsız soruya git",
  timeUp: "Süre doldu — cevaplarınız gönderiliyor…",
  lastMinute: "Son dakika!",
};

const EN: ExamText = {
  eyebrow: "Final Exam",
  intro: "You have completed every section. Read the exam details before you begin.",
  questions: "Questions",
  duration: "Duration",
  noLimit: "No limit",
  minutes: (n) => `${n} min`,
  passMark: "Pass mark",
  attempt: "Attempt",
  language: "Exam language",
  shuffled: (bank) => `Questions are drawn at random from a bank of ${bank}`,
  perQuestion: (pts) => `${pts} points per question`,
  rulesTitle: "Exam rules",
  rules: ({ timed, maxAttempts }) => [
    ...(timed
      ? ["The timer starts when the exam begins; when time is up your answers are submitted automatically."]
      : []),
    "You can move freely between questions and change an answer until you submit.",
    "Once you choose “Finish and submit”, the exam closes and answers can no longer be changed.",
    timed
      ? "Closing the page does not stop the timer; when you come back you continue where you left off."
      : "If you close the page you continue with the same questions where you left off.",
    `You have ${maxAttempts} attempts. If you do not pass on attempt ${maxAttempts}, you must complete the training material again.`,
  ],
  agree: "I have read the rules and I am ready.",
  start: "Start exam",
  starting: "Preparing…",
  back: "← Back to dashboard",
  noQuestions: "No questions in this language",
  resumeTitle: "You have an exam in progress",
  resumeBody: (min) =>
    min == null
      ? "You will continue where you left off, with the same questions."
      : `About ${min} minute(s) left. The timer kept running while you were away.`,
  resume: "Continue exam",
  examLabel: (n) => `Exam · attempt ${n}`,
  answered: (n, t) => `${n} / ${t} answered`,
  timeLeft: "Time left",
  questionOf: (i, t) => `Question ${i} of ${t}`,
  clear: "Clear this answer",
  prev: "← Previous",
  next: "Next →",
  submit: "Finish and submit",
  submitting: "Submitting…",
  unanswered: (n) => `${n} question${n === 1 ? "" : "s"} left unanswered.`,
  unansweredHint: "Unanswered questions are scored as wrong. You can go back and finish them.",
  submitAnyway: "Submit anyway",
  firstUnanswered: "Go to first unanswered",
  timeUp: "Time is up — submitting your answers…",
  lastMinute: "Last minute!",
};

export const EXAM_TEXT: Record<Lang, ExamText> = { TR, EN };
