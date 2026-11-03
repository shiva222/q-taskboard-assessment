import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import * as commentsRoute from "@/app/api/tasks/[id]/comments/route";
import { GET, POST } from "@/app/api/tasks/[id]/comments/route";
import { getCurrentUser, getProjectMembership } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    task: {
      findUnique: vi.fn(),
    },
    comment: {
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
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

const task = { id: "task_1", projectId: "project_1" };
const member = { id: "member_1", email: "member@example.com", name: "Member" };

const older = {
  id: "comment_1",
  taskId: task.id,
  body: "Started the draft",
  createdAt: "2026-11-01T10:00:00.000Z",
  author: { id: "member_1", name: "Member", email: "member@example.com" },
};
const newer = {
  id: "comment_2",
  taskId: task.id,
  body: "Sent it to review",
  createdAt: "2026-11-02T10:00:00.000Z",
  author: { id: "admin_1", name: "Admin", email: "admin@example.com" },
};

function callGet() {
  const req = new NextRequest(`http://localhost/api/tasks/${task.id}/comments`, {
    headers: { Authorization: "Bearer test-token" },
  });
  return GET(req, { params: Promise.resolve({ id: task.id }) });
}

function callPost(body: unknown) {
  const req = new NextRequest(`http://localhost/api/tasks/${task.id}/comments`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer test-token",
    },
    body: JSON.stringify(body),
  });
  return POST(req, { params: Promise.resolve({ id: task.id }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getCurrentUser).mockResolvedValue(member);
  vi.mocked(getProjectMembership).mockResolvedValue({ role: "member" });
  vi.mocked(prisma.task.findUnique).mockResolvedValue(task as never);
  vi.mocked(prisma.comment.findMany).mockResolvedValue([older, newer] as never);
  vi.mocked(prisma.comment.create).mockResolvedValue(newer as never);
});

describe("task comment thread", () => {
  it("does not expose edit or delete handlers", () => {
    expect(commentsRoute).not.toHaveProperty("PATCH");
    expect(commentsRoute).not.toHaveProperty("PUT");
    expect(commentsRoute).not.toHaveProperty("DELETE");
  });

  it("never updates or deletes a comment while reading or posting", async () => {
    await callGet();
    await callPost({ body: "A new note" });

    expect(prisma.comment.update).not.toHaveBeenCalled();
    expect(prisma.comment.delete).not.toHaveBeenCalled();
  });
});

describe("GET /api/tasks/:id/comments", () => {
  it("returns the thread oldest first with author, body, and time", async () => {
    const res = await callGet();

    expect(res.status).toBe(200);
    expect(prisma.comment.findMany).toHaveBeenCalledWith({
      where: { taskId: task.id },
      orderBy: { createdAt: "asc" },
      include: {
        author: { select: { id: true, name: true, email: true } },
      },
    });
    await expect(res.json()).resolves.toEqual({ comments: [older, newer] });
  });

  it("lets a viewer read the thread", async () => {
    vi.mocked(getProjectMembership).mockResolvedValue({ role: "viewer" });

    const res = await callGet();

    expect(res.status).toBe(200);
    expect(prisma.comment.findMany).toHaveBeenCalled();
  });

  it("rejects a caller who is not a member of the project", async () => {
    vi.mocked(getProjectMembership).mockResolvedValue(null);

    const res = await callGet();

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: "you are not a member of this project",
    });
    expect(prisma.comment.findMany).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated request", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);

    const res = await callGet();

    expect(res.status).toBe(401);
    expect(prisma.task.findUnique).not.toHaveBeenCalled();
    expect(prisma.comment.findMany).not.toHaveBeenCalled();
  });

  it("returns 404 when the task does not exist", async () => {
    vi.mocked(prisma.task.findUnique).mockResolvedValue(null);

    const res = await callGet();

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "task not found" });
    expect(getProjectMembership).not.toHaveBeenCalled();
    expect(prisma.comment.findMany).not.toHaveBeenCalled();
  });
});

describe("POST /api/tasks/:id/comments", () => {
  it("lets a member append a comment as themselves", async () => {
    const res = await callPost({ body: "  Shipped the checklist  ", authorId: "someone_else" });

    expect(res.status).toBe(201);
    expect(prisma.comment.create).toHaveBeenCalledWith({
      data: {
        taskId: task.id,
        authorId: member.id,
        body: "Shipped the checklist",
      },
      include: {
        author: { select: { id: true, name: true, email: true } },
      },
    });
    await expect(res.json()).resolves.toEqual({ comment: newer });
  });

  it("lets an admin append a comment", async () => {
    vi.mocked(getProjectMembership).mockResolvedValue({ role: "admin" });

    const res = await callPost({ body: "Approved" });

    expect(res.status).toBe(201);
    expect(prisma.comment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ authorId: member.id, body: "Approved" }),
      }),
    );
  });

  it("lets a viewer read but not post", async () => {
    vi.mocked(getProjectMembership).mockResolvedValue({ role: "viewer" });

    const res = await callPost({ body: "I should not be able to write this" });

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: "viewers cannot post comments",
    });
    expect(prisma.comment.create).not.toHaveBeenCalled();
  });

  it("rejects a caller who is not a member of the project", async () => {
    vi.mocked(getProjectMembership).mockResolvedValue(null);

    const res = await callPost({ body: "Outside the project" });

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: "you are not a member of this project",
    });
    expect(prisma.comment.create).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated request", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);

    const res = await callPost({ body: "Hello" });

    expect(res.status).toBe(401);
    expect(prisma.comment.create).not.toHaveBeenCalled();
  });

  it("returns 404 when the task does not exist", async () => {
    vi.mocked(prisma.task.findUnique).mockResolvedValue(null);

    const res = await callPost({ body: "Hello" });

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "task not found" });
    expect(prisma.comment.create).not.toHaveBeenCalled();
  });

  it("rejects an empty comment", async () => {
    const res = await callPost({ body: "   " });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "invalid input" });
    expect(prisma.comment.create).not.toHaveBeenCalled();
  });

  it("rejects a comment longer than 5000 characters", async () => {
    const res = await callPost({ body: "a".repeat(5001) });

    expect(res.status).toBe(400);
    expect(prisma.comment.create).not.toHaveBeenCalled();
  });
});
