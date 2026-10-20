/**
 * Yetki kapsamı seçimi — katlanır liste ("C" tasarımı, onaylandı 20.10.2026;
 * seçenekler docs/tasarim/yetki-atama.html).
 *
 * Neden değişti: aynı soruyu — "bu kişi neyden sorumlu?" — cevaplayan üç şey
 * formun üç ayrı yerinde duruyordu: boş bir "— Select —" açılır kutusu,
 * seçim yapılınca beliren gri bir alt-yetki kutusu ve ikisinden de bağımsız,
 * en altta duran NDT metod satırı. Hiçbiri diğerine bağlı görünmüyordu ve
 * hiçbir yerde bir kapsamın KAÇ EĞİTİM getirdiği yazmıyordu; yönetici
 * kaydetmeden önce sonucunu göremiyordu.
 *
 * Şimdi: her kapsam bir satır, tiklenince alt yetkileri ve (varsa) metodları
 * hemen altında açılıyor; tikli olmasa bile kaç eğitim getirdiği yazıyor ve
 * altta toplam duruyor.
 */
import { useMemo } from "react";
import { requiredCourseIdsFor, type Scope } from "../../lib/requirements";
import type { MethodCourse, ScopeRef } from "./types";

export function ScopePicker({
  scopes,
  methodCourses,
  scopeIds,
  setScopeIds,
  subScopeIds,
  setSubScopeIds,
  courseMethods,
  setCourseMethods,
}: {
  scopes: ScopeRef[];
  methodCourses: MethodCourse[];
  scopeIds: string[];
  setScopeIds: (next: string[]) => void;
  subScopeIds: string[];
  setSubScopeIds: (next: string[]) => void;
  courseMethods: Record<string, string[]>;
  setCourseMethods: (next: Record<string, string[]>) => void;
}) {
  const asScopes = scopes as unknown as Scope[];

  /** Seçimin tamamının zorunlu kıldığı eğitimler — alttaki toplam. */
  const total = useMemo(
    () => requiredCourseIdsFor(scopeIds, asScopes, subScopeIds).size,
    [scopeIds, asScopes, subScopeIds]
  );

  /**
   * Metod bazlı eğitim, onu zorunlu kılan kapsamın ALTINDA gösterilir
   * (bugün NDT Staff). Hiçbir seçili kapsam istemiyorsa listenin sonunda
   * kendi başına durur — gizlemek, girilmiş metod tiklerini görünmez
   * kılardı.
   */
  const methodsByScope = useMemo(() => {
    const m = new Map<string, MethodCourse[]>();
    const orphan: MethodCourse[] = [];
    for (const mc of methodCourses) {
      const owner = scopes.find(
        (s) =>
          ((s as Scope).requiredCourseIds ?? []).includes(mc.id) ||
          (s.subScopes ?? []).some((sub) => (sub.requiredCourseIds ?? []).includes(mc.id))
      );
      if (owner && scopeIds.includes(owner.id)) {
        m.set(owner.id, [...(m.get(owner.id) ?? []), mc]);
      } else if (!owner) {
        orphan.push(mc);
      }
    }
    return { m, orphan };
  }, [methodCourses, scopes, scopeIds]);

  const toggleScope = (id: string) => {
    if (scopeIds.includes(id)) {
      setScopeIds(scopeIds.filter((x) => x !== id));
      // Kapsam kalkınca altındaki tikler de düşmeli; görünmeyen bir alt yetki
      // sessizce eğitim zorunlu tutmaya devam ederdi.
      const subs = (scopes.find((s) => s.id === id)?.subScopes ?? []).map((s) => s.id);
      if (subs.length) setSubScopeIds(subScopeIds.filter((x) => !subs.includes(x)));
    } else {
      setScopeIds([...scopeIds, id]);
    }
  };

  const toggleSub = (id: string) =>
    setSubScopeIds(
      subScopeIds.includes(id) ? subScopeIds.filter((x) => x !== id) : [...subScopeIds, id]
    );

  const toggleMethod = (courseId: string, m: string) => {
    const cur = courseMethods[courseId] ?? [];
    setCourseMethods({
      ...courseMethods,
      [courseId]: cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m],
    });
  };

  return (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <label className="label">Authorisation Scope(s)</label>
        {scopeIds.length > 0 && (
          <span className="text-[11px] font-semibold text-slate-500 mb-1.5">
            {scopeIds.length} selected
          </span>
        )}
      </div>

      <div className="rounded-lg border border-slate-200 overflow-hidden">
        {scopes.length === 0 && (
          <p className="px-3 py-3 text-[12.5px] text-slate-500">
            No authorisation scopes defined yet — add them in Settings.
          </p>
        )}
        {scopes.map((s, i) => {
          const on = scopeIds.includes(s.id);
          const subs = s.subScopes ?? [];
          const mine = methodsByScope.m.get(s.id) ?? [];
          const picked = subs.filter((x) => subScopeIds.includes(x.id)).length;
          // Tikli değilken kapsamın kendi gerekliliği; tikliyken seçilen alt
          // yetkilerin eklediği/düşürdüğüyle birlikte gerçek sayı.
          const count = requiredCourseIdsFor([s.id], asScopes, on ? subScopeIds : []).size;
          const open = on && (subs.length > 0 || mine.length > 0);

          return (
            <div key={s.id} className={i > 0 ? "border-t border-slate-100" : ""}>
              <button
                type="button"
                onClick={() => toggleScope(s.id)}
                aria-pressed={on}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition ${
                  on ? "bg-brand-50/60" : "hover:bg-slate-50"
                }`}
              >
                <span
                  aria-hidden
                  className={`shrink-0 h-[17px] w-[17px] rounded-[5px] border-[1.6px] grid place-items-center text-white text-[11px] font-bold ${
                    on ? "bg-brand-600 border-brand-600" : "border-slate-300 bg-white"
                  }`}
                >
                  {on ? "✓" : ""}
                </span>
                <span
                  className={`flex-1 min-w-0 text-[13.5px] ${
                    on ? "font-semibold text-brand-700" : "text-slate-800"
                  }`}
                >
                  {s.name}
                </span>
                <span
                  className={`text-[11.5px] whitespace-nowrap ${
                    on ? "text-brand-700/80" : "text-slate-400"
                  }`}
                >
                  {on && subs.length > 0 && `${picked}/${subs.length} sub · `}
                  {on && mine.length > 0 &&
                    `${mine.reduce((n, mc) => n + (courseMethods[mc.id] ?? []).length, 0)}/${mine.reduce(
                      (n, mc) => n + mc.methods.length,
                      0
                    )} methods · `}
                  {count} training{count === 1 ? "" : "s"}
                </span>
                {open && (
                  <span aria-hidden className="text-[10px] text-slate-400">
                    ▾
                  </span>
                )}
              </button>

              {open && (
                <div className="bg-slate-50 border-t border-slate-100 pl-[39px] pr-3 py-2.5">
                  {subs.length > 0 && (
                    <>
                      <p className="text-[10.5px] font-bold uppercase tracking-[.06em] text-slate-400 mb-1.5">
                        Sub-authorisations
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {subs.map((sub) => (
                          <Pill
                            key={sub.id}
                            on={subScopeIds.includes(sub.id)}
                            onClick={() => toggleSub(sub.id)}
                            label={sub.name}
                          />
                        ))}
                      </div>
                      <p className="text-[10.5px] text-slate-500 mt-1.5">
                        Only ticked items bring their own required training. Leave one unticked and
                        its courses show as N/A for this person.
                      </p>
                    </>
                  )}

                  {mine.map((mc) => (
                    <div key={mc.id} className={subs.length > 0 ? "mt-3" : ""}>
                      <p className="text-[10.5px] font-bold uppercase tracking-[.06em] text-slate-400 mb-1.5">
                        {mc.title} — methods
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {mc.methods.map((m) => (
                          <Pill
                            key={m}
                            on={(courseMethods[mc.id] ?? []).includes(m)}
                            onClick={() => toggleMethod(mc.id, m)}
                            label={m}
                          />
                        ))}
                      </div>
                      <p className="text-[10.5px] text-slate-500 mt-1.5">
                        Each ticked method is tracked with its own certificate and expiry date.
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {/* Hiçbir kapsamın istemediği metod bazlı eğitim: eskisi gibi kendi
            başına. Gizlemek, girilmiş tikleri görünmez kılardı. */}
        {methodsByScope.orphan.map((mc) => (
          <div key={mc.id} className="border-t border-slate-100 px-3 py-2.5">
            <p className="text-[10.5px] font-bold uppercase tracking-[.06em] text-slate-400 mb-1.5">
              {mc.title} — methods
            </p>
            <div className="flex flex-wrap gap-1.5">
              {mc.methods.map((m) => (
                <Pill
                  key={m}
                  on={(courseMethods[mc.id] ?? []).includes(m)}
                  onClick={() => toggleMethod(mc.id, m)}
                  label={m}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      <p className="text-[11.5px] text-slate-500 mt-1.5">
        {total === 0 ? (
          "No required training yet — tick the scopes this person is authorised for."
        ) : (
          <>
            This selection makes{" "}
            <b className="font-semibold text-brand-700">
              {total} training{total === 1 ? "" : "s"}
            </b>{" "}
            mandatory for this person.
          </>
        )}
      </p>
    </>
  );
}

function Pill({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`inline-flex items-center gap-1.5 h-[27px] px-2.5 rounded-full text-[12px] border transition ${
        on
          ? "bg-brand-600 border-brand-600 text-white font-semibold"
          : "bg-white border-slate-200 text-slate-700 hover:border-slate-300"
      }`}
    >
      {on && (
        <span aria-hidden className="text-[10px] opacity-90">
          ✓
        </span>
      )}
      {label}
    </button>
  );
}
