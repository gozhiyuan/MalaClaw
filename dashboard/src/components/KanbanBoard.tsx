import { useState, useCallback } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useKanban, useUpdateKanban } from "../hooks/useApi";

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

function serializeKanban(columns: Column[]): string {
  return columns
    .map((col) => {
      const header = `## ${col.title}`;
      const items = col.cards.map((c) => `- ${c}`).join("\n");
      return items ? `${header}\n${items}` : header;
    })
    .join("\n\n");
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
  cursor: "grab",
  userSelect: "none",
};

const draggingCardStyle: React.CSSProperties = {
  ...cardStyle,
  opacity: 0.5,
  cursor: "grabbing",
};

function SortableCard({ id, label }: { id: string; label: string }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: React.CSSProperties = {
    ...(isDragging ? draggingCardStyle : cardStyle),
    transform: CSS.Transform.toString(transform),
    transition,
  };
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      {label}
    </div>
  );
}

export function KanbanBoard({ projectId, teamId }: { projectId: string; teamId: string }) {
  const { data, isLoading, error } = useKanban(projectId, teamId);
  const updateKanban = useUpdateKanban();
  const [localColumns, setLocalColumns] = useState<Column[] | null>(null);

  const columns = localColumns ?? (data?.content ? parseKanban(data.content) : null);

  const sensors = useSensors(useSensor(PointerSensor));

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id || !columns) return;

      // Find which column contains the active card
      const activeColIdx = columns.findIndex((col) =>
        col.cards.some((c, i) => `${col.title}::${i}` === active.id)
      );
      const overColIdx = columns.findIndex((col) =>
        col.cards.some((c, i) => `${col.title}::${i}` === over.id)
      );

      if (activeColIdx === -1) return;

      const newColumns = columns.map((col) => ({ ...col, cards: [...col.cards] }));

      if (activeColIdx === overColIdx) {
        // Reorder within same column
        const col = newColumns[activeColIdx];
        const activeIdx = col.cards.findIndex((_, i) => `${col.title}::${i}` === active.id);
        const overIdx = col.cards.findIndex((_, i) => `${col.title}::${i}` === over.id);
        newColumns[activeColIdx].cards = arrayMove(col.cards, activeIdx, overIdx);
      } else if (overColIdx !== -1) {
        // Move between columns
        const activeCol = newColumns[activeColIdx];
        const overCol = newColumns[overColIdx];
        const activeIdx = activeCol.cards.findIndex((_, i) => `${activeCol.title}::${i}` === active.id);
        const overIdx = overCol.cards.findIndex((_, i) => `${overCol.title}::${i}` === over.id);
        const [moved] = activeCol.cards.splice(activeIdx, 1);
        overCol.cards.splice(overIdx >= 0 ? overIdx : overCol.cards.length, 0, moved);
      }

      setLocalColumns(newColumns);
      const content = serializeKanban(newColumns);
      updateKanban.mutate({ projectId, teamId, content });
    },
    [columns, projectId, teamId, updateKanban]
  );

  if (isLoading) return <div style={{ color: "#8b949e" }}>Loading kanban...</div>;
  if (error) return <div style={{ color: "#f85149" }}>Error loading kanban.</div>;
  if (!columns || columns.length === 0) return <div style={{ color: "#8b949e" }}>No kanban board found.</div>;

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <div style={{ display: "flex", gap: 12, overflowX: "auto" }}>
        {columns.map((col) => {
          const itemIds = col.cards.map((_, i) => `${col.title}::${i}`);
          return (
            <div key={col.title} style={colStyle}>
              <h4 style={{ margin: "0 0 8px", color: "#f0f6fc", fontSize: 13, fontWeight: 600 }}>
                {col.title} ({col.cards.length})
              </h4>
              <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
                {col.cards.map((card, i) => (
                  <SortableCard key={`${col.title}::${i}`} id={`${col.title}::${i}`} label={card} />
                ))}
              </SortableContext>
            </div>
          );
        })}
      </div>
    </DndContext>
  );
}
