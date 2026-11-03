"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, getStoredUser } from "@/lib/api-client";
import type { ApiComment, ApiTask, ApiProjectMember, Role, TaskStatus } from "@/types";
import { STATUS_LABELS, STATUS_ORDER } from "@/types";

type Props = {
  task: ApiTask;
  projectId: string;
  members: ApiProjectMember[];
  onClose: () => void;
};

export function TaskDetail({ task, projectId, members, onClose }: Props) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [status, setStatus] = useState<TaskStatus>(task.status);
  const [assigneeId, setAssigneeId] = useState<string>(task.assigneeId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [commentBody, setCommentBody] = useState("");
  const [commentError, setCommentError] = useState<string | null>(null);

  useEffect(() => {
    const user = getStoredUser();
    const mine = members.find((m) => m.user.id === user?.id);
    setRole(mine?.role ?? null);
  }, [members]);

  const canPost = role === "admin" || role === "member";

  const commentsQuery = useQuery({
    queryKey: ["task-comments", task.id],
    queryFn: () =>
      apiFetch<{ comments: ApiComment[] }>(`/api/tasks/${task.id}/comments`),
  });

  const postComment = useMutation({
    mutationFn: (body: string) =>
      apiFetch<{ comment: ApiComment }>(`/api/tasks/${task.id}/comments`, {
        method: "POST",
        body: JSON.stringify({ body }),
      }),
    onSuccess: () => {
      setCommentBody("");
      setCommentError(null);
      queryClient.invalidateQueries({ queryKey: ["task-comments", task.id] });
    },
    onError: (err) =>
      setCommentError(err instanceof Error ? err.message : "comment failed"),
  });

  const updateTask = useMutation({
    mutationFn: (input: Partial<ApiTask>) =>
      apiFetch<{ task: ApiTask }>(`/api/tasks/${task.id}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      onClose();
    },
    onError: (err) => setError(err instanceof Error ? err.message : "save failed"),
  });

  const deleteTask = useMutation({
    mutationFn: () =>
      apiFetch<{ ok: true }>(`/api/tasks/${task.id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      onClose();
    },
    onError: (err) => setError(err instanceof Error ? err.message : "delete failed"),
  });

  function onSave() {
    setError(null);
    updateTask.mutate({
      title,
      description,
      status,
      assigneeId: assigneeId || null,
    });
  }

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center px-4 z-50"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl max-h-[90vh] overflow-y-auto bg-surface border border-border rounded-lg p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">edit task</h2>
          <button onClick={onClose} className="text-muted hover:text-white">
            ✕
          </button>
        </div>

        <label className="block mb-3">
          <span className="text-xs text-muted">title</span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="mt-1 block w-full rounded-md bg-bg border border-border px-3 py-2 text-sm focus:border-accent focus:outline-none"
          />
        </label>

        <label className="block mb-3">
          <span className="text-xs text-muted">description</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            className="mt-1 block w-full rounded-md bg-bg border border-border px-3 py-2 text-sm focus:border-accent focus:outline-none"
          />
        </label>

        <div className="grid grid-cols-2 gap-3 mb-4">
          <label className="block">
            <span className="text-xs text-muted">status</span>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as TaskStatus)}
              className="mt-1 block w-full rounded-md bg-bg border border-border px-3 py-2 text-sm focus:border-accent focus:outline-none"
            >
              {STATUS_ORDER.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-xs text-muted">assignee</span>
            <select
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
              className="mt-1 block w-full rounded-md bg-bg border border-border px-3 py-2 text-sm focus:border-accent focus:outline-none"
            >
              <option value="">unassigned</option>
              {members.map((m) => (
                <option key={m.user.id} value={m.user.id}>
                  {m.user.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        {error && (
          <p className="text-sm text-red-400 mb-3" role="alert">
            {error}
          </p>
        )}

        <section className="mb-4 border-t border-border pt-4">
          <h3 className="text-sm font-medium mb-3">comments</h3>
          {commentsQuery.isLoading && (
            <p className="text-xs text-muted">loading…</p>
          )}
          {commentsQuery.error && (
            <p className="text-sm text-red-400" role="alert">
              {commentsQuery.error instanceof Error
                ? commentsQuery.error.message
                : "failed to load comments"}
            </p>
          )}
          {commentsQuery.data && commentsQuery.data.comments.length === 0 && (
            <p className="text-xs text-muted italic">no comments yet</p>
          )}
          {commentsQuery.data && commentsQuery.data.comments.length > 0 && (
            <ul className="space-y-3 max-h-48 overflow-y-auto">
              {commentsQuery.data.comments.map((comment) => (
                <li key={comment.id} className="text-sm">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-medium">{comment.author.name}</span>
                    <time className="text-xs text-muted shrink-0" dateTime={comment.createdAt}>
                      {new Date(comment.createdAt).toLocaleString()}
                    </time>
                  </div>
                  <p className="text-xs text-muted">{comment.author.email}</p>
                  <p className="mt-1 whitespace-pre-wrap">{comment.body}</p>
                </li>
              ))}
            </ul>
          )}

          {canPost && (
            <form
              className="mt-3 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const body = commentBody.trim();
                if (!body) return;
                setCommentError(null);
                postComment.mutate(body);
              }}
            >
              <input
                type="text"
                value={commentBody}
                onChange={(e) => setCommentBody(e.target.value)}
                placeholder="add a comment"
                maxLength={5000}
                className="flex-1 rounded-md bg-bg border border-border px-3 py-2 text-sm focus:border-accent focus:outline-none"
              />
              <button
                type="submit"
                disabled={postComment.isPending || commentBody.trim().length === 0}
                className="text-sm px-4 py-2 rounded-md bg-accent text-white hover:bg-indigo-500 disabled:opacity-50"
              >
                {postComment.isPending ? "posting…" : "post"}
              </button>
            </form>
          )}
          {commentError && (
            <p className="text-sm text-red-400 mt-2" role="alert">
              {commentError}
            </p>
          )}
        </section>

        <div className="flex items-center justify-between gap-3">
          <button
            onClick={() => deleteTask.mutate()}
            disabled={deleteTask.isPending}
            className="text-sm text-red-400 hover:text-red-300"
          >
            delete task
          </button>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="text-sm px-4 py-2 rounded-md border border-border hover:border-muted"
            >
              cancel
            </button>
            <button
              onClick={onSave}
              disabled={updateTask.isPending}
              className="text-sm px-4 py-2 rounded-md bg-accent text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              {updateTask.isPending ? "saving…" : "save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
