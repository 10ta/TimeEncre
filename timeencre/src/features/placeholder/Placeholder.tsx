export function Placeholder({ title, phase, desc }: { title: string; phase: string; desc: string }) {
  return (
    <div className="page">
      <header className="page-head">
        <h1>{title}</h1>
      </header>
      <p className="empty">
        {desc}
        <br />
        计划在 {phase} 阶段完成。
      </p>
    </div>
  );
}
