import Airtable from "airtable";
import { AirtableExportError, type AirtableRow, type AirtableTableClient } from "./airtable-export";

function asRow(record: { id: string; fields: Airtable.FieldSet }): AirtableRow {
  return { id: record.id, fields: record.fields };
}

function wrapRequest<T>(op: () => Promise<T>): Promise<T> {
  return op().catch((err: unknown) => {
    const source = typeof err === "object" && err !== null ? (err as { statusCode?: unknown; message?: unknown }) : {};
    const failure = new Error(
      typeof source.message === "string" && source.message ? source.message : "airtable request failed",
    ) as Error & { statusCode: number | null };
    failure.statusCode = typeof source.statusCode === "number" ? source.statusCode : null;
    throw failure;
  });
}

export function createAirtableClient(): AirtableTableClient {
  const apiKey = process.env.AIRTABLE_API_KEY;
  const baseId = process.env.AIRTABLE_BASE_ID;
  const tableName = process.env.AIRTABLE_TABLE_NAME;
  if (!apiKey || !baseId || !tableName) {
    throw new AirtableExportError("Airtable is not configured");
  }

  const table = new Airtable({ apiKey, noRetryIfRateLimited: true }).base(baseId)(tableName);

  return {
    list() {
      return wrapRequest(() => table.select().all()).then((records) => records.map(asRow));
    },
    create(input) {
      return wrapRequest(() => table.create(input.fields as Airtable.FieldSet)).then(asRow);
    },
    update(id, fields) {
      return wrapRequest(() => table.update(id, fields as Airtable.FieldSet)).then(asRow);
    },
  };
}
