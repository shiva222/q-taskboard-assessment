import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getCurrentUser,
  unauthorized,
  forbidden,
  notFound,
  getProjectMembership,
  canEditTasks,
} from "@/lib/auth";
import { createAirtableClient } from "@/lib/airtable";
import { AirtableExportError, exportProjectTasks } from "@/lib/airtable-export";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const user = await getCurrentUser(req);
  if (!user) return unauthorized();

  const { id } = await params;
  const membership = await getProjectMembership(user.id, id);
  if (!membership) return forbidden("you are not a member of this project");
  if (!canEditTasks(membership.role)) return forbidden("viewers cannot export tasks");

  const project = await prisma.project.findUnique({
    where: { id },
    select: {
      name: true,
      tasks: {
        select: {
          id: true,
          title: true,
          description: true,
          status: true,
          assignee: { select: { name: true } },
        },
        orderBy: [{ status: "asc" }, { position: "asc" }],
      },
    },
  });
  if (!project) return notFound("project not found");

  const tasks = project.tasks.map((task: any) => ({
    id: task.id,
    title: task.title,
    description: task.description,
    status: task.status,
    assigneeName: task.assignee?.name ?? null,
  }));

  if (tasks.length === 0) {
    return NextResponse.json({ export: { created: 0, updated: 0, failed: [], duplicates: [] } });
  }

  try {
    const summary = await exportProjectTasks({
      projectName: project.name,
      tasks,
      client: createAirtableClient(),
    });
    return NextResponse.json({ export: summary });
  } catch (err) {
    if (err instanceof AirtableExportError) {
      return NextResponse.json(
        { error: "airtable export failed", message: err.message },
        { status: 502 },
      );
    }
    throw err;
  }
}
