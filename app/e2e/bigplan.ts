/** A generated plan for speed tests: `tasks` tasks in 20 phases, shared by `people` people. */
export function bigPlan(tasks = 2000, people = 50): string {
  const lines = ["---", "ezplan: 1", "title: Big programme", "start: 2027-01-04", "---"];
  const per = tasks / 20;
  for (let p = 0; p < 20; p++) {
    lines.push(`## P${p + 1}: Workstream ${p + 1}`);
    for (let i = 0; i < per; i++) {
      const id = p * per + i + 1;
      // Short chains inside each workstream, so many tasks can run side by side.
      const dep = i % 10 === 0 ? "" : ` depends: T${id - 1}`;
      lines.push(`- [${id % 7 === 0 ? "x" : " "}] T${id}: Task ${id} (${(id % 4) + 1}d) @Person${id % people}${dep}`);
    }
  }
  return lines.join("\n");
}
