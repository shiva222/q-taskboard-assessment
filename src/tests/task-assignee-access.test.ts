import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PATCH } from "@/app/api/tasks/[id]/route";
import { getCurrentUser, getProjectMembership } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    task: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
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

const task = {
  id: "task_1",
  projectId: "project_1",
};

function patchRequest(body: unknown) {
  return new NextRequest("http://localhost/api/tasks/task_1", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer test-token",
    },
    body: JSON.stringify(body),
  });
}

function callPatch(body: unknown) {
  return PATCH(patchRequest(body), { params: Promise.resolve({ id: task.id }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getCurrentUser).mockResolvedValue({
    id: "editor_1",
    email: "editor@example.com",
    name: "Editor",
  });
  vi.mocked(prisma.task.findUnique).mockResolvedValue(task as never);
  vi.mocked(prisma.task.update).mockImplementation((async (args: { data: { assigneeId?: string | null } }) => ({
    ...task,
    assigneeId: args.data.assigneeId ?? null,
    assignee: null,
  })) as never);
});

describe("PATCH /api/tasks/:id assignee project access", () => {
  it("rejects an assignee who is not a member of the project", async () => {
    vi.mocked(getProjectMembership).mockResolvedValue(null);

    const res = await callPatch({ assigneeId: "outsider_1" });

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: "assignee does not have access to this project",
    });
    expect(getProjectMembership).toHaveBeenCalledWith("outsider_1", "project_1");
    expect(prisma.task.update).not.toHaveBeenCalled();
  });

  it("updates the task when the assignee is a project member", async () => {
    vi.mocked(getProjectMembership).mockResolvedValue({ role: "member" });

    const res = await callPatch({ assigneeId: "member_1", status: "review" });

    expect(res.status).toBe(200);
    expect(getProjectMembership).toHaveBeenCalledWith("member_1", "project_1");
    expect(prisma.task.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "task_1" },
        data: { assigneeId: "member_1", status: "review" },
      }),
    );
    await expect(res.json()).resolves.toMatchObject({
      task: { id: "task_1", assigneeId: "member_1" },
    });
  });

  it("treats a viewer as having project access", async () => {
    vi.mocked(getProjectMembership).mockResolvedValue({ role: "viewer" });

    const res = await callPatch({ assigneeId: "viewer_1" });

    expect(res.status).toBe(200);
    expect(prisma.task.update).toHaveBeenCalled();
  });

  it("allows clearing the assignee without a membership lookup", async () => {
    const res = await callPatch({ assigneeId: null });

    expect(res.status).toBe(200);
    expect(getProjectMembership).not.toHaveBeenCalled();
    expect(prisma.task.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { assigneeId: null },
      }),
    );
  });

  it("does not check membership when the assignee is left unchanged", async () => {
    const res = await callPatch({ title: "Rename only" });

    expect(res.status).toBe(200);
    expect(getProjectMembership).not.toHaveBeenCalled();
    expect(prisma.task.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { title: "Rename only" },
      }),
    );
  });
});
