import { requireRole } from "../../../lib/auth/current-user";
import { getIncomeOverview } from "../../../server/income";
import { parseDateRange } from "../../../lib/date-range";
import { IncomeChart } from "./income-chart";

const STATUS_LABELS: Record<string, string> = {
  scheduled: "запланировано",
  completed: "проведено",
  cancelled: "отменено",
  no_show: "неявка",
};

function formatMoney(cents: number): string {
  return (cents / 100).toLocaleString("ru-RU", { minimumFractionDigits: 0 }) + " ₽";
}

function formatDate(d: Date): string {
  return new Date(d).toLocaleDateString("ru-RU", { dateStyle: "medium" });
}

export default async function IncomePage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const user = await requireRole("teacher");
  const { from: fromRaw, to: toRaw } = await searchParams;
  const range = parseDateRange(fromRaw, toRaw);

  const overview = await getIncomeOverview(user.teacherId!, range.from, range.toExclusive);

  return (
    <div>
      <h1>Доходы</h1>

      <form
        method="get"
        style={{ display: "flex", gap: "0.75rem", alignItems: "end", flexWrap: "wrap", marginBottom: "1.5rem" }}
      >
        <label>
          С
          <input name="from" type="date" defaultValue={range.fromInput} />
        </label>
        <label>
          По
          <input name="to" type="date" defaultValue={range.toInput} />
        </label>
        <button type="submit">Показать</button>
      </form>

      <section style={{ display: "flex", gap: "2rem", flexWrap: "wrap", marginBottom: "1.5rem" }}>
        <div>
          <div style={{ fontSize: "0.8rem", color: "#666" }}>Запланировано за период</div>
          <div style={{ fontSize: "1.4rem", fontWeight: 600 }}>{formatMoney(overview.scheduledCents)}</div>
        </div>
        <div>
          <div style={{ fontSize: "0.8rem", color: "#666" }}>Оплачено</div>
          <div style={{ fontSize: "1.4rem", fontWeight: 600, color: "#0a7d2c" }}>
            {formatMoney(overview.paidCents)}
          </div>
        </div>
        <div>
          <div style={{ fontSize: "0.8rem", color: "#666" }}>Не оплачено</div>
          <div style={{ fontSize: "1.4rem", fontWeight: 600, color: "#b00020" }}>
            {formatMoney(overview.unpaidCents)}
          </div>
        </div>
      </section>

      <section style={{ marginBottom: "1.5rem" }}>
        <h2>Оплаченный доход по дням</h2>
        <IncomeChart points={overview.chart} />
      </section>

      <section>
        <h2>Занятия за период ({overview.records.length})</h2>
        {overview.records.length === 0 ? (
          <p style={{ color: "#666" }}>За этот период занятий нет.</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left" }}>
                <th>Когда</th>
                <th>Ученик / группа</th>
                <th>Статус</th>
                <th>Сумма</th>
                <th>Оплата</th>
              </tr>
            </thead>
            <tbody>
              {overview.records.map((record) => (
                <tr key={record.id} style={{ borderTop: "1px solid #ddd" }}>
                  <td>{formatDate(record.scheduledAt)}</td>
                  <td>{record.studentLabel}</td>
                  <td>{STATUS_LABELS[record.status] ?? record.status}</td>
                  <td>{formatMoney(record.priceCents)}</td>
                  <td>{record.paidAt ? `оплачено ${formatDate(record.paidAt)}` : "не оплачено"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
