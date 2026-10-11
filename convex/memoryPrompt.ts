export type MemoryItem = {
  type: string;
  content: string;
  pinned: boolean;
  confidence: number;
};

export type MemoryBlocks = {
  user: MemoryItem[];
  contact: MemoryItem[];
  chat: MemoryItem[];
};

function renderList(items: MemoryItem[]): string {
  return items
    .map((m) => {
      const pin = m.pinned ? "📌 " : "";
      return `- ${pin}(${m.type}) ${m.content}`;
    })
    .join("\n");
}

export function formatMemoryBlock(
  blocks: MemoryBlocks,
  contactName?: string | null,
): string {
  const parts: string[] = [];
  if (blocks.user.length > 0) {
    parts.push(`## About the user\n${renderList(blocks.user)}`);
  }
  if (blocks.contact.length > 0) {
    const heading = contactName ? `About ${contactName}` : "About this contact";
    parts.push(`## ${heading}\n${renderList(blocks.contact)}`);
  }
  if (blocks.chat.length > 0) {
    parts.push(`## About this chat\n${renderList(blocks.chat)}`);
  }
  if (parts.length === 0) return "";
  return `\n\n# Memory\nUse the following as context. Treat pinned items as load-bearing. Don't repeat them back unless the user asks.\n\n${parts.join("\n\n")}\n`;
}
