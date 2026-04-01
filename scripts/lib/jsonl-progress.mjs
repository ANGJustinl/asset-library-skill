import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export function appendJsonlRecord(filePath, record) {
  mkdirSync(dirname(filePath), { recursive: true });
  appendFileSync(filePath, `${JSON.stringify(record)}\n`, "utf8");
}

export function pushRecentEvent(buffer, event, maxItems = 50) {
  const next = [...buffer, event];
  if (next.length <= maxItems) {
    return next;
  }
  return next.slice(next.length - maxItems);
}
