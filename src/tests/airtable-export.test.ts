import { describe, expect, it, vi } from "vitest";
import { AirtableMockClient } from "@/lib/airtable-mock";
import {
  AirtableExportError,
  exportProjectTasks,
  type AirtableTableClient,
  type ExportTask,
} from "@/lib/airtable-export";

const sleep = async () => {};

const launch: ExportTask = {
  id: "task_1",
  title: "Draft press release",
  description: "Send to marketing",
  status: "review",
  assigneeName: "Arjun Rao",
};

const followUp: ExportTask = {
  id: "task_2",
  title: "Record demo video",
  description: null,
  status: "todo",
  assigneeName: null,
};

function failure(statusCode: number, message: string, retryAfterMs?: number): Error {
  const err = new Error(message) as Error & { statusCode: number; retryAfterMs?: number };
  err.statusCode = statusCode;
  if (retryAfterMs !== undefined) err.retryAfterMs = retryAfterMs;
  return err;
}

describe("exportProjectTasks", () => {
  it("creates one Airtable row per task", async () => {
    const client = new AirtableMockClient();

    const summary = await exportProjectTasks({
      projectName: "Q3 Launch",
      tasks: [launch, followUp],
      client,
      sleep,
    });

    expect(summary).toEqual({ created: 2, updated: 0, failed: [], duplicates: [] });
    expect(client.__getRecordCount()).toBe(2);
    expect(client.__getRecords().map((row) => row.fields)).toEqual([
      {
        Name: "Draft press release",
        Status: "In progress",
        Notes: [
          "Task ID: task_1",
          "Description: Send to marketing",
          "Status: In progress",
          "Assignee: Arjun Rao",
          "Project: Q3 Launch",
        ].join("\n"),
      },
      {
        Name: "Record demo video",
        Status: "Todo",
        Notes: [
          "Task ID: task_2",
          "Description: ",
          "Status: Todo",
          "Assignee: Unassigned",
          "Project: Q3 Launch",
        ].join("\n"),
      },
    ]);
  });

  it("updates existing rows when the export runs again", async () => {
    const client = new AirtableMockClient();
    await exportProjectTasks({
      projectName: "Q3 Launch",
      tasks: [launch],
      client,
      sleep,
    });

    const summary = await exportProjectTasks({
      projectName: "Q3 Launch",
      tasks: [{ ...launch, title: "Draft press release v2" }],
      client,
      sleep,
    });

    expect(summary.created).toBe(0);
    expect(summary.updated).toBe(1);
    expect(client.__getRecordCount()).toBe(1);
    expect(client.__getRecords()[0].fields.Name).toBe("Draft press release v2");
  });

  it("reports a duplicate Task ID and updates the first row only", async () => {
    const client = new AirtableMockClient();
    await client.create({ fields: { Name: "first", Notes: `Task ID: ${launch.id}` } });
    await client.create({ fields: { Name: "second", Notes: `Task ID: ${launch.id}` } });

    const summary = await exportProjectTasks({
      projectName: "Q3 Launch",
      tasks: [launch],
      client,
      sleep,
    });

    expect(summary.created).toBe(0);
    expect(summary.updated).toBe(1);
    expect(summary.duplicates).toHaveLength(1);
    expect(summary.duplicates[0].taskId).toBe(launch.id);
    expect(client.__getRecordCount()).toBe(2);
    expect(client.__getRecords()[0].fields.Name).toBe(launch.title);
    expect(client.__getRecords()[1].fields.Name).toBe("second");
  });

  it("retries a transient 500 and then writes the row", async () => {
    let attempts = 0;
    const client: AirtableTableClient = {
      async list() {
        return [];
      },
      async create(input) {
        attempts += 1;
        if (attempts === 1) throw failure(500, "server error");
        return { id: "rec_1", fields: input.fields };
      },
      async update() {
        throw new Error("update should not run");
      },
    };

    const summary = await exportProjectTasks({
      projectName: "Q3 Launch",
      tasks: [launch],
      client,
      sleep,
    });

    expect(attempts).toBe(2);
    expect(summary).toEqual({ created: 1, updated: 0, failed: [], duplicates: [] });
  });

  it("does not retry a permanent 422 and still exports the next task", async () => {
    const attempts = new Map<string, number>();
    const written: string[] = [];
    const client: AirtableTableClient = {
      async list() {
        return [];
      },
      async create(input) {
        const taskId = String(input.fields.Notes).match(/^Task ID: (\S+)/)?.[1] ?? "";
        attempts.set(taskId, (attempts.get(taskId) ?? 0) + 1);
        if (taskId === launch.id) throw failure(422, "Unknown field name: Title");
        written.push(taskId);
        return { id: `rec_${taskId}`, fields: input.fields };
      },
      async update() {
        throw new Error("update should not run");
      },
    };

    const summary = await exportProjectTasks({
      projectName: "Q3 Launch",
      tasks: [launch, followUp],
      client,
      sleep,
    });

    expect(attempts.get(launch.id)).toBe(1);
    expect(written).toEqual([followUp.id]);
    expect(summary.created).toBe(1);
    expect(summary.failed).toEqual([{ taskId: launch.id, message: "Unknown field name: Title" }]);
  });

  it("stops the export when Airtable returns 401", async () => {
    const client: AirtableTableClient = {
      async list() {
        throw failure(401, "authentication required");
      },
      async create() {
        throw new Error("create should not run");
      },
      async update() {
        throw new Error("update should not run");
      },
    };

    await expect(
      exportProjectTasks({ projectName: "Q3 Launch", tasks: [launch, followUp], client, sleep }),
    ).rejects.toBeInstanceOf(AirtableExportError);
  });

  it("waits at least Retry-After on a 429", async () => {
    const waits: number[] = [];
    let attempts = 0;
    const client: AirtableTableClient = {
      async list() {
        return [];
      },
      async create(input) {
        attempts += 1;
        if (attempts === 1) throw failure(429, "rate limited", 1500);
        return { id: "rec_1", fields: input.fields };
      },
      async update() {
        throw new Error("update should not run");
      },
    };

    await exportProjectTasks({
      projectName: "Q3 Launch",
      tasks: [launch],
      client,
      sleep: async (ms) => {
        waits.push(ms);
      },
    });

    expect(waits).toEqual([1500]);
  });

  it("does not call Airtable when the project has no tasks", async () => {
    const client: AirtableTableClient = {
      list: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    };

    const summary = await exportProjectTasks({
      projectName: "Q3 Launch",
      tasks: [],
      client,
      sleep,
    });

    expect(summary).toEqual({ created: 0, updated: 0, failed: [], duplicates: [] });
    expect(client.list).not.toHaveBeenCalled();
  });
});
