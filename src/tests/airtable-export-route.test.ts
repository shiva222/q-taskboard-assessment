import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/projects/[id]/airtable-export/route";
import { getCurrentUser, getProjectMembership } from "@/lib/auth";
import { createAirtableClient } from "@/lib/airtable";
import { AirtableMockClient } from "@/lib/airtable-mock";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@/lib/airtable", () => ({
  createAirtableClient: vi.fn(),
}));

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth");
  return {
    ...actual,
    getCurrentUser: vi.fn(),
    getProjectMembership: vi.fn(),
  };
});

const member = { id: "member_1", email: "member@example.com", name: "Member" };

function callExport() {
  const req = new NextRequest("http://localhost/api/projects/project_1/airtable-export", {
    method: "POST",
    headers: { Authorization: "Bearer test-token" },
  });
  return POST(req, { params: Promise.resolve({ id: "project_1" }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getCurrentUser).mockResolvedValue(member);
  vi.mocked(getProjectMembership).mockResolvedValue({ role: "member" });
  vi.mocked(prisma.project.findUnique).mockResolvedValue({
    name: "Q3 Launch",
    tasks: [
      {
        id: "task_1",
        title: "Draft press release",
        description: "Send to marketing",
        status: "review",
        assignee: { name: "Arjun Rao" },
      },
    ],
  } as never);
});

describe("POST /api/projects/:id/airtable-export", () => {
  it("lets a member export project tasks", async () => {
    const client = new AirtableMockClient();
    vi.mocked(createAirtableClient).mockReturnValue(client);

    const res = await callExport();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      export: { created: 1, updated: 0, failed: [], duplicates: [] },
    });
    expect(client.__getRecords()[0].fields.Name).toBe("Draft press release");
    expect(client.__getRecords()[0].fields.Notes).toContain("Task ID: task_1");
    expect(client.__getRecords()[0].fields.Notes).toContain("Project: Q3 Launch");
    expect(client.__getRecords()[0].fields.Notes).toContain("Assignee: Arjun Rao");
  });

  it("rejects a viewer before calling Airtable", async () => {
    vi.mocked(getProjectMembership).mockResolvedValue({ role: "viewer" });

    const res = await callExport();

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "viewers cannot export tasks" });
    expect(createAirtableClient).not.toHaveBeenCalled();
    expect(prisma.project.findUnique).not.toHaveBeenCalled();
  });

  it("rejects a caller who is not a member of the project", async () => {
    vi.mocked(getProjectMembership).mockResolvedValue(null);

    const res = await callExport();

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "you are not a member of this project" });
    expect(createAirtableClient).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated request", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);

    const res = await callExport();

    expect(res.status).toBe(401);
    expect(getProjectMembership).not.toHaveBeenCalled();
    expect(createAirtableClient).not.toHaveBeenCalled();
  });
});
