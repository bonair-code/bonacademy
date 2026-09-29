import { PageHead } from "../components/PageHead";
export function Placeholder({ title }: { title: string }) {
  return (
    <div>
      <PageHead title={title} subtitle="This module is under construction." />
      <div className="card p-12 text-center text-slate-400 text-sm">
        <div className="text-3xl mb-2">🛠️</div>
        {title} — coming in a later phase.
      </div>
    </div>
  );
}
