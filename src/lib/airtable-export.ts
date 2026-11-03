export type ExportTask = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  assigneeName: string | null;
};

export type AirtableRow = {
  id: string;
  fields: Record<string, unknown>;
};

export type AirtableTableClient = {
  list(): Promise<AirtableRow[]>;
  create(input: { fields: Record<string, unknown>; id?: string }): Promise<AirtableRow>;
  update(id: string, fields: Record<string, unknown>): Promise<AirtableRow>;
};

export type ExportFailure = {
  taskId: string;
  message: string;
};

export type ExportDuplicate = {
  taskId: string;
  airtableRecordId: string;
};

export type ExportSummary = {
  created: number;
  updated: number;
  failed: ExportFailure[];
  duplicates: ExportDuplicate[];
};

export class AirtableExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AirtableExportError";
  }
}

const RETRY_WAITS_MS = [200, 400, 800];

type Sleep = (ms: number) => Promise<void>;

const defaultSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function readError(err: unknown): { statusCode: number | null; retryAfterMs: number; message: string } {
  const record = typeof err === "object" && err !== null ? (err as { statusCode?: unknown; retryAfterMs?: unknown; message?: unknown }) : {};
  const statusCode = typeof record.statusCode === "number" ? record.statusCode : null;
  const retryAfterMs = typeof record.retryAfterMs === "number" ? record.retryAfterMs : 0;
  const message = typeof record.message === "string" && record.message ? record.message : "airtable request failed";
  return { statusCode, retryAfterMs, message };
}

function isFatal(statusCode: number | null): boolean {
  return statusCode === 401 || statusCode === 403 || statusCode === 404;
}

function isTransient(statusCode: number | null): boolean {
  return (
    statusCode === null ||
    statusCode === 0 ||
    statusCode === 429 ||
    statusCode === 500 ||
    statusCode === 502 ||
    statusCode === 503
  );
}

async function withRetry<T>(op: () => Promise<T>, sleep: Sleep): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await op();
    } catch (err) {
      const info = readError(err);
      if (isFatal(info.statusCode)) throw new AirtableExportError(info.message);
      if (!isTransient(info.statusCode) || attempt >= RETRY_WAITS_MS.length) throw err;
      await sleep(Math.max(RETRY_WAITS_MS[attempt], info.retryAfterMs));
      attempt += 1;
    }
  }
}

function airtableStatus(status: string): "Todo" | "In progress" | "Done" {
  if (status === "todo") return "Todo";
  if (status === "done") return "Done";
  return "In progress";
}

function taskFields(task: ExportTask, projectName: string): Record<string, unknown> {
  const status = airtableStatus(task.status);
  return {
    Name: task.title,
    Status: status,
    Notes: [
      `Task ID: ${task.id}`,
      `Description: ${task.description ?? ""}`,
      `Status: ${status}`,
      `Assignee: ${task.assigneeName ?? "Unassigned"}`,
      `Project: ${projectName}`,
    ].join("\n"),
  };
}

function taskIdFrom(fields: Record<string, unknown>): string | null {
  const notes = fields.Notes;
  if (typeof notes !== "string") return null;
  const match = notes.match(/^Task ID: (\S+)/);
  return match ? match[1] : null;
}

export async function exportProjectTasks(input: {
  projectName: string;
  tasks: ExportTask[];
  client: AirtableTableClient;
  sleep?: Sleep;
}): Promise<ExportSummary> {
  const summary: ExportSummary = { created: 0, updated: 0, failed: [], duplicates: [] };
  if (input.tasks.length === 0) return summary;

  const sleep = input.sleep ?? defaultSleep;
  let existing: AirtableRow[];
  try {
    existing = await withRetry(() => input.client.list(), sleep);
  } catch (err) {
    if (err instanceof AirtableExportError) throw err;
    throw new AirtableExportError(readError(err).message);
  }

  const airtableIdByTaskId = new Map<string, string>();
  for (const row of existing) {
    const taskId = taskIdFrom(row.fields);
    if (!taskId) continue;
    const first = airtableIdByTaskId.get(taskId);
    if (first) {
      summary.duplicates.push({ taskId, airtableRecordId: row.id });
      continue;
    }
    airtableIdByTaskId.set(taskId, row.id);
  }

  for (const task of input.tasks) {
    const fields = taskFields(task, input.projectName);
    const airtableId = airtableIdByTaskId.get(task.id);
    try {
      if (airtableId) {
        await withRetry(() => input.client.update(airtableId, fields), sleep);
        summary.updated += 1;
      } else {
        await withRetry(() => input.client.create({ fields }), sleep);
        summary.created += 1;
      }
    } catch (err) {
      if (err instanceof AirtableExportError) throw err;
      summary.failed.push({ taskId: task.id, message: readError(err).message });
    }
  }

  return summary;
}
