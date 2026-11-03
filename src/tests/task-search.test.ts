import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/projects/[id]/tasks/route";
import { getCurrentUser, getProjectMembership } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    task: {
      findMany: vi.fn(),
    },
    $queryRawUnsafe: vi.fn(),
    $queryRaw: vi.fn(),
  },
}));

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth");
  return {
    ...actual,
    getCurrentUser: vi.fn(),
    getProjectMembership: vi.fn(),
  };
});

const projectId = "project_1";
const tasks = [
  { id: "task_1", projectId, title: "Finalize launch date" },
];

function callGet(query?: string) {
  const url = new URL(`http://localhost/api/projects/${projectId}/tasks`);
  if (query !== undefined) url.searchParams.set("q", query);
  const req = new NextRequest(url, {
    headers: { Authorization: "Bearer test-token" },
  });
  return GET(req, { params: Promise.resolve({ id: projectId }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getCurrentUser).mockResolvedValue({
    id: "member_1",
    email: "member@example.com",
    name: "Member",
  });
  vi.mocked(getProjectMembership).mockResolvedValue({ role: "member" });
  vi.mocked(prisma.task.findMany).mockResolvedValue(tasks as never);
});

describe("GET /api/projects/:id/tasks search", () => {
  it("passes the search text to Prisma as a bound filter", async () => {
    const payload = "%' OR 1=1 --";

    const res = await callGet(payload);

    expect(res.status).toBe(200);
    expect(prisma.task.findMany).toHaveBeenCalledWith({
      where: {
        projectId,
        OR: [
          { title: { contains: payload, mode: "insensitive" } },
          { description: { contains: payload, mode: "insensitive" } },
        ],
      },
      include: {
        assignee: { select: { id: true, name: true, email: true } },
      },
      orderBy: [{ status: "asc" }, { position: "asc" }],
    });
    expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toEqual({ tasks });
  });

  it("lists every project task when no search is provided", async () => {
    const res = await callGet();

    expect(res.status).toBe(200);
    expect(prisma.task.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { projectId },
      }),
    );
    expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
  });

  it("treats an empty search as no filter", async () => {
    const res = await callGet("");

    expect(res.status).toBe(200);
    expect(prisma.task.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { projectId },
      }),
    );
  });

  it("rejects a caller who is not a member of the project", async () => {
    vi.mocked(getProjectMembership).mockResolvedValue(null);

    const res = await callGet("launch");

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: "you are not a member of this project",
    });
    expect(prisma.task.findMany).not.toHaveBeenCalled();
    expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated request", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);

    const res = await callGet("%' OR 1=1 --");

    expect(res.status).toBe(401);
    expect(getProjectMembership).not.toHaveBeenCalled();
    expect(prisma.task.findMany).not.toHaveBeenCalled();
  });
});
