import { useKanban } from "../hooks/useApi";

type Column = { title: string; cards: string[] };

function parseKanban(content: string): Column[] {
  const columns: Column[] = [];
  let current: Column | null = null;
  for (const line of content.split("\n")) {
    const headerMatch = line.match(/^##\s+(.+)/);
    if (headerMatch) {
      current = { title: headerMatch[1].trim(), cards: [] };
      columns.push(current);
    } else if (current) {
      const itemMatch = line.match(/^[-*]\s+(.+)/);
      if (itemMatch) {
        current.cards.push(itemMatch[1].trim());
      }
    }
  }
  return columns;
}

const colStyle: React.CSSProperties = {
  background: "#161b22",
  border: "1px solid #30363d",
  borderRadius: 8,
  padding: 12,
  minWidth: 180,
  flex: 1,
};
const cardStyle: React.CSSProperties = {
  background: "#21262d",
  borderRadius: 4,
  padding: "6px 10px",
  color: "#c9d1d9",
  fontSize: 13,
  marginBottom: 6,
};

export function KanbanBoard({ projectId, teamId }: { projectId: string; teamId: string }) {
  const { data, isLoading, error } = useKanban(projectId, teamId);

  if (isLoading) return <div style={{ color: "#8b949e" }}>Loading kanban...</div>;
  if (error) return <div style={{ color: "#f85149" }}>Error loading kanban.</div>;
  if (!data?.content) return <div style={{ color: "#8b949e" }}>No kanban board found.</div>;

  const columns = parseKanban(data.content);
  if (columns.length === 0) return <div style={{ color: "#8b949e" }}>Empty kanban board.</div>;

  return (
    <div style={{ display: "flex", gap: 12, overflowX: "auto" }}>
      {columns.map((col) => (
        <div key={col.title} style={colStyle}>
          <h4 style={{ margin: "0 0 8px", color: "#f0f6fc", fontSize: 13, fontWeight: 600 }}>
            {col.title} ({col.cards.length})
          </h4>
          {col.cards.map((card, i) => (
            <div key={i} style={cardStyle}>
              {card}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
